'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import type { Device, Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

interface PeerInfo {
  socketId: string;
  userId: string;
  name: string;
  role: string;
  hasProducers?: boolean;
  producers?: { id: string; kind: string }[];
}

interface RemoteStream {
  peerId: string;
  peerName: string;
  peerRole: string;
  stream: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface ChatMsg {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  type: 'TEXT' | 'FILE';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  createdAt: string;
}

interface UseMediasoupOptions {
  sessionId: string;
  userId: string;
  userName: string;
  userRole: string;
  onSessionEnded?: () => void;
}

export function useMediasoup({ sessionId, userId, userName, userRole, onSessionEnded }: UseMediasoupOptions) {
  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const audioProducerRef = useRef<Producer | null>(null);
  const videoProducerRef = useRef<Producer | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  // Use refs to hold latest callbacks — avoids stale closures in socket listeners
  const onSessionEndedRef = useRef(onSessionEnded);
  const sessionIdRef = useRef(sessionId);
  const userIdRef = useRef(userId);
  const userNameRef = useRef(userName);
  const userRoleRef = useRef(userRole);

  // Keep refs in sync
  useEffect(() => { onSessionEndedRef.current = onSessionEnded; }, [onSessionEnded]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map());
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Helper to emit with callback (promise-based)
  const emitAsync = useCallback((event: string, data: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket) return reject(new Error('Socket not connected'));
      socket.emit(event, data, (response: any) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }, []);

  // Create send transport
  const createSendTransport = useCallback(async () => {
    const device = deviceRef.current;
    if (!device) return;
    const sid = sessionIdRef.current;

    const transportData = await emitAsync('create-transport', { sessionId: sid, direction: 'send' });

    const transport = device.createSendTransport({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
    });

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await emitAsync('connect-transport', { sessionId: sid, transportId: transport.id, dtlsParameters });
        callback();
      } catch (err) { errback(err as Error); }
    });

    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const { id } = await emitAsync('produce', { sessionId: sid, transportId: transport.id, kind, rtpParameters, appData });
        callback({ id });
      } catch (err) { errback(err as Error); }
    });

    sendTransportRef.current = transport;
    return transport;
  }, [emitAsync]);

  // Create receive transport
  const createRecvTransport = useCallback(async () => {
    const device = deviceRef.current;
    if (!device) return;
    const sid = sessionIdRef.current;

    const transportData = await emitAsync('create-transport', { sessionId: sid, direction: 'recv' });

    const transport = device.createRecvTransport({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
    });

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await emitAsync('connect-transport', { sessionId: sid, transportId: transport.id, dtlsParameters });
        callback();
      } catch (err) { errback(err as Error); }
    });

    recvTransportRef.current = transport;
    return transport;
  }, [emitAsync]);

  // Consume a remote producer
  const consumeProducer = useCallback(async (producerId: string, peerSocketId: string) => {
    const device = deviceRef.current;
    let transport = recvTransportRef.current;
    if (!device) return;

    if (!transport) {
      transport = (await createRecvTransport()) || null;
      if (!transport) return;
    }

    try {
      const consumerData = await emitAsync('consume', {
        sessionId: sessionIdRef.current,
        transportId: transport.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities,
      });

      const consumer = await transport.consume({
        id: consumerData.id,
        producerId: consumerData.producerId,
        kind: consumerData.kind,
        rtpParameters: consumerData.rtpParameters,
      });

      consumersRef.current.set(consumer.id, consumer);

      // Resume the consumer FIRST so the track is live before we attach it to a video element
      await emitAsync('resume-consumer', { sessionId: sessionIdRef.current, consumerId: consumer.id });

      setRemoteStreams((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(peerSocketId);
        if (existing) {
          // Only add track if not already present
          const trackIds = existing.stream.getTracks().map((t) => t.id);
          if (!trackIds.includes(consumer.track.id)) {
            existing.stream.addTrack(consumer.track);
          }
          newMap.set(peerSocketId, { ...existing });
        } else {
          const stream = new MediaStream([consumer.track]);
          newMap.set(peerSocketId, {
            peerId: peerSocketId,
            peerName: 'Participant',
            peerRole: 'CUSTOMER',
            stream,
            audioEnabled: true,
            videoEnabled: true,
          });
        }
        return newMap;
      });
    } catch (err) {
      console.error('Failed to consume producer:', err);
    }
  }, [emitAsync, createRecvTransport]);

  // Connect to the room
  const connect = useCallback(async () => {
    // Prevent double-connect
    if (socketRef.current?.connected) return;

    try {
      // Get local media
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
      } catch (mediaErr: any) {
        if (mediaErr.name === 'NotReadableError') {
          throw new Error('Camera/Microphone is already in use by another application. Close other video apps and try again.');
        } else if (mediaErr.name === 'NotAllowedError') {
          throw new Error('Camera/Microphone permission denied. Please allow access in your browser settings.');
        } else if (mediaErr.name === 'NotFoundError') {
          throw new Error('No camera or microphone found. Please connect a device and try again.');
        }
        throw mediaErr;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Connect socket to the mediasoup server
      // Use the LAN IP dynamically so mobile devices on 192.168.1.x also work
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL
        || `${window.location.protocol}//${window.location.hostname}:3001`;

      const socket = io(socketUrl, {
        path: '/socket.io',
        transports: ['polling', 'websocket'], // polling first — avoids raw WS error spam
        reconnection: false,                  // manual retry from user — don't loop silently
        timeout: 8000,
        forceNew: true,
      });
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          reject(new Error('Could not reach the video server. Make sure the SFU server is running on port 3001 (run: npx ts-node server.ts).'));
        }, 8000);
        socket.on('connect', () => { clearTimeout(timeout); resolve(); });
        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          socket.disconnect();
          reject(new Error(`Video server unreachable: ${err.message}. Make sure the SFU server is running (port 3001).`));
        });
      });

      // Join room
      const joinData = await emitAsync('join-room', {
        sessionId: sessionIdRef.current,
        userId: userIdRef.current,
        name: userNameRef.current,
        role: userRoleRef.current,
      });

      // Load mediasoup device
      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });
      deviceRef.current = device;

      // Create send transport and produce
      const sendTransport = await createSendTransport();
      if (sendTransport) {
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioProducerRef.current = await sendTransport.produce({
            track: audioTrack,
            appData: { mediaType: 'audio' },
          });
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoProducerRef.current = await sendTransport.produce({
            track: videoTrack,
            appData: { mediaType: 'video' },
            encodings: [
              { maxBitrate: 100000 },
              { maxBitrate: 300000 },
              { maxBitrate: 900000 },
            ],
            codecOptions: { videoGoogleStartBitrate: 1000 },
          });
        }
      }

      // Create recv transport
      await createRecvTransport();

      // Set existing peers and update remote stream names
      const existingPeers: PeerInfo[] = joinData.existingPeers || [];
      setPeers(existingPeers);

      // Consume existing producers from peers already in the room
      for (const peer of existingPeers) {
        if (peer.producers && peer.producers.length > 0) {
          for (const prod of peer.producers) {
            await consumeProducer(prod.id, peer.socketId);
            // Update peer name in remote streams
            setRemoteStreams((prev) => {
              const newMap = new Map(prev);
              const entry = newMap.get(peer.socketId);
              if (entry) {
                newMap.set(peer.socketId, { ...entry, peerName: peer.name, peerRole: peer.role });
              }
              return newMap;
            });
          }
        }
      }

      // ——— Register all socket event listeners HERE, after joining ———

      socket.on('peer-joined', (peer: PeerInfo) => {
        setPeers((prev) => [...prev.filter((p) => p.socketId !== peer.socketId), peer]);
      });

      socket.on('peer-left', ({ socketId }: { socketId: string }) => {
        setPeers((prev) => prev.filter((p) => p.socketId !== socketId));
        setRemoteStreams((prev) => {
          const newMap = new Map(prev);
          newMap.delete(socketId);
          return newMap;
        });
      });

      socket.on('new-producer', async ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
        await consumeProducer(producerId, socketId);
        // Update peer name from peers list
        setPeers((currentPeers) => {
          const peer = currentPeers.find((p) => p.socketId === socketId);
          if (peer) {
            setRemoteStreams((prev) => {
              const newMap = new Map(prev);
              const entry = newMap.get(socketId);
              if (entry) {
                newMap.set(socketId, { ...entry, peerName: peer.name, peerRole: peer.role });
              }
              return newMap;
            });
          }
          return currentPeers;
        });
      });

      socket.on('producer-closed', ({ producerId }: { producerId: string }) => {
        consumersRef.current.forEach((consumer, consumerId) => {
          if (consumer.producerId === producerId) {
            consumer.close();
            consumersRef.current.delete(consumerId);
          }
        });
      });

      socket.on('consumer-closed', ({ consumerId }: { consumerId: string }) => {
        const consumer = consumersRef.current.get(consumerId);
        if (consumer) {
          consumer.close();
          consumersRef.current.delete(consumerId);
        }
      });

      socket.on('media-state-change', ({ socketId, kind, enabled }: { socketId: string; kind: string; enabled: boolean }) => {
        setRemoteStreams((prev) => {
          const newMap = new Map(prev);
          const remote = newMap.get(socketId);
          if (remote) {
            if (kind === 'audio') remote.audioEnabled = enabled;
            if (kind === 'video') remote.videoEnabled = enabled;
            newMap.set(socketId, { ...remote });
          }
          return newMap;
        });
      });

      // Chat: receive messages from other peers
      socket.on('chat-message', (message: ChatMsg) => {
        setChatMessages((prev) => {
          // Deduplicate by ID
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      });

      socket.on('session-ended', () => {
        onSessionEndedRef.current?.();
      });

      setIsConnected(true);
    } catch (err: any) {
      console.error('Connection error:', err);
      setError(err.message || 'Failed to connect');

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        setLocalStream(null);
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
    }
  }, [emitAsync, createSendTransport, createRecvTransport, consumeProducer]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socketRef.current?.emit('media-state-change', {
          sessionId: sessionIdRef.current,
          kind: 'audio',
          enabled: audioTrack.enabled,
        });
      }
    }
  }, []);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socketRef.current?.emit('media-state-change', {
          sessionId: sessionIdRef.current,
          kind: 'video',
          enabled: videoTrack.enabled,
        });
      }
    }
  }, []);

  // Send chat message (text or file)
  const sendMessage = useCallback(async (
    content: string,
    type: 'TEXT' | 'FILE' = 'TEXT',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number,
  ) => {
    const sid = sessionIdRef.current;
    const uid = userIdRef.current;
    const uname = userNameRef.current;
    const urole = userRoleRef.current;

    const message: ChatMsg = {
      id: crypto.randomUUID(),
      senderId: uid,
      senderName: uname,
      senderRole: urole,
      content,
      type,
      fileUrl,
      fileName,
      fileSize,
      createdAt: new Date().toISOString(),
    };

    // Add to local state immediately
    setChatMessages((prev) => [...prev, message]);

    // Relay to other peers via socket
    socketRef.current?.emit('chat-message', { sessionId: sid, message });

    // Persist to database
    try {
      await fetch(`/api/sessions/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type, fileUrl, fileName, fileSize }),
      });
    } catch (err) {
      console.error('Failed to persist message:', err);
    }
  }, []);

  // End session
  const endSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    socketRef.current?.emit('end-session', { sessionId: sid });
    try {
      await fetch(`/api/sessions/${sid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ENDED' }),
      });
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    audioProducerRef.current?.close();
    videoProducerRef.current?.close();
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    consumersRef.current.forEach((c) => c.close());
    consumersRef.current.clear();
    socketRef.current?.disconnect();
    socketRef.current = null;
    deviceRef.current = null;
    sendTransportRef.current = null;
    recvTransportRef.current = null;
    setIsConnected(false);
    setLocalStream(null);
    setRemoteStreams(new Map());
  }, []);

  // Clear error
  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      consumersRef.current.forEach((c) => c.close());
      socketRef.current?.disconnect();
    };
  }, []);

  return {
    connect,
    disconnect,
    localStream,
    remoteStreams,
    chatMessages,
    setChatMessages,
    isConnected,
    isAudioEnabled,
    isVideoEnabled,
    toggleAudio,
    toggleVideo,
    sendMessage,
    endSession,
    peers,
    error,
    clearError,
  };
}
