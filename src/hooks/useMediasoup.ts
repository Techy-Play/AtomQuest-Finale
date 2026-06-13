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
}

interface RemoteStream {
  peerId: string;
  peerName: string;
  peerRole: string;
  stream: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface ChatMsg {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  type: 'TEXT' | 'FILE';
  fileUrl?: string;
  fileName?: string;
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

    const transportData = await emitAsync('create-transport', {
      sessionId,
      direction: 'send',
    });

    const transport = device.createSendTransport({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
    });

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await emitAsync('connect-transport', {
          sessionId,
          transportId: transport.id,
          dtlsParameters,
        });
        callback();
      } catch (err) {
        errback(err as Error);
      }
    });

    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const { id } = await emitAsync('produce', {
          sessionId,
          transportId: transport.id,
          kind,
          rtpParameters,
          appData,
        });
        callback({ id });
      } catch (err) {
        errback(err as Error);
      }
    });

    sendTransportRef.current = transport;
    return transport;
  }, [sessionId, emitAsync]);

  // Create receive transport
  const createRecvTransport = useCallback(async () => {
    const device = deviceRef.current;
    if (!device) return;

    const transportData = await emitAsync('create-transport', {
      sessionId,
      direction: 'recv',
    });

    const transport = device.createRecvTransport({
      id: transportData.id,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
    });

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await emitAsync('connect-transport', {
          sessionId,
          transportId: transport.id,
          dtlsParameters,
        });
        callback();
      } catch (err) {
        errback(err as Error);
      }
    });

    recvTransportRef.current = transport;
    return transport;
  }, [sessionId, emitAsync]);

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
        sessionId,
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

      // Add track to remote stream
      setRemoteStreams((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(peerSocketId);
        if (existing) {
          existing.stream.addTrack(consumer.track);
          newMap.set(peerSocketId, { ...existing });
        } else {
          const stream = new MediaStream([consumer.track]);
          // Find peer info
          const socket = socketRef.current;
          // We'll update peer info separately
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

      // Resume consumer
      await emitAsync('resume-consumer', {
        sessionId,
        consumerId: consumer.id,
      });
    } catch (err) {
      console.error('Failed to consume producer:', err);
    }
  }, [sessionId, emitAsync, createRecvTransport]);

  // Connect to the room
  const connect = useCallback(async () => {
    try {
      // Get local media
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
      } catch (mediaErr: any) {
        if (mediaErr.name === 'NotReadableError') {
          throw new Error('Camera/Microphone is already in use by another application.');
        } else if (mediaErr.name === 'NotAllowedError') {
          throw new Error('Camera/Microphone permission denied.');
        }
        throw mediaErr;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Connect socket to the mediasoup server
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || `${window.location.protocol}//${window.location.hostname}:3001`;
      const socket = io(socketUrl, {
        path: '/socket.io',
        transports: ['websocket'],
      });
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', (err) => reject(err));
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });

      // Join room
      const joinData = await emitAsync('join-room', {
        sessionId,
        userId,
        name: userName,
        role: userRole,
      });

      // Load mediasoup device
      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });
      deviceRef.current = device;

      // Create send transport and produce
      const sendTransport = await createSendTransport();
      if (sendTransport) {
        // Produce audio
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioProducerRef.current = await sendTransport.produce({
            track: audioTrack,
            appData: { mediaType: 'audio' },
          });
        }

        // Produce video
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
            codecOptions: {
              videoGoogleStartBitrate: 1000,
            },
          });
        }
      }

      // Create recv transport
      await createRecvTransport();

      // Set existing peers
      setPeers(joinData.existingPeers || []);

      // Consume existing producers from peers
      for (const peer of joinData.existingPeers || []) {
        if (peer.producers && peer.producers.length > 0) {
          for (const prod of peer.producers) {
            await consumeProducer(prod.id, peer.socketId);
          }
        }
      }

      // Socket event handlers
      socket.on('peer-joined', (peer: PeerInfo) => {
        setPeers((prev) => [...prev.filter((p) => p.socketId !== peer.socketId), peer]);
      });

      socket.on('peer-left', ({ socketId, name }: { socketId: string; name: string }) => {
        setPeers((prev) => prev.filter((p) => p.socketId !== socketId));
        setRemoteStreams((prev) => {
          const newMap = new Map(prev);
          newMap.delete(socketId);
          return newMap;
        });
      });

      socket.on('new-producer', async ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
        await consumeProducer(producerId, socketId);
      });

      socket.on('producer-closed', ({ producerId, socketId }: { producerId: string; socketId: string }) => {
        // Remove consumer for this producer
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

      socket.on('chat-message', (message: ChatMsg) => {
        setChatMessages((prev) => [...prev, message]);
      });

      socket.on('session-ended', () => {
        onSessionEnded?.();
      });

      setIsConnected(true);
    } catch (err: any) {
      console.error('Connection error:', err);
      setError(err.message || 'Failed to connect');

      // Cleanup media if connection fails
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
        setLocalStream(null);
      }
    }
  }, [sessionId, userId, userName, userRole, emitAsync, createSendTransport, createRecvTransport, consumeProducer, onSessionEnded]);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
        socketRef.current?.emit('media-state-change', {
          sessionId,
          kind: 'audio',
          enabled: audioTrack.enabled,
        });
      }
    }
  }, [localStream, sessionId]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
        socketRef.current?.emit('media-state-change', {
          sessionId,
          kind: 'video',
          enabled: videoTrack.enabled,
        });
      }
    }
  }, [localStream, sessionId]);

  // Send chat message
  const sendMessage = useCallback(async (content: string, type: 'TEXT' | 'FILE' = 'TEXT', fileUrl?: string, fileName?: string) => {
    const message: ChatMsg = {
      id: crypto.randomUUID(),
      senderId: userId,
      senderName: userName,
      senderRole: userRole,
      content,
      type,
      fileUrl,
      fileName,
      createdAt: new Date().toISOString(),
    };

    // Send via socket for real-time
    socketRef.current?.emit('chat-message', { sessionId, message });

    // Add to local state
    setChatMessages((prev) => [...prev, message]);

    // Persist to database
    try {
      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type, fileUrl, fileName }),
      });
    } catch (err) {
      console.error('Failed to persist message:', err);
    }
  }, [sessionId, userId, userName, userRole]);

  // End session
  const endSession = useCallback(async () => {
    socketRef.current?.emit('end-session', { sessionId });
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ENDED' }),
      });
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  }, [sessionId]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    socketRef.current?.disconnect();
    setIsConnected(false);
    setLocalStream(null);
    setRemoteStreams(new Map());
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
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
  };
}
