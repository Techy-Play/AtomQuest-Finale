'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import type { Device, Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

// --- Types --------------------------------------------------------------------

interface PeerInfo {
  socketId: string;
  userId: string;
  name: string;
  role: string;
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

export type SupportMode = 'chat' | 'voice' | 'video';

interface UseMediasoupOptions {
  sessionId: string;
  userId: string;
  userName: string;
  userRole: string;
  onSessionEnded?: () => void;
}

// --- Hook ---------------------------------------------------------------------

export function useMediasoup({ sessionId, userId, userName, userRole, onSessionEnded }: UseMediasoupOptions) {

  const socketRef         = useRef<Socket | null>(null);
  const deviceRef         = useRef<Device | null>(null);
  const sendTransportRef  = useRef<Transport | null>(null);
  const recvTransportRef  = useRef<Transport | null>(null);
  const audioProducerRef  = useRef<Producer | null>(null);
  const videoProducerRef  = useRef<Producer | null>(null);
  const consumersRef      = useRef<Map<string, Consumer>>(new Map());
  const localStreamRef    = useRef<MediaStream | null>(null);

  // Peers ref for synchronous access inside socket event handlers
  // (avoids the async-inside-setState anti-pattern)
  const peersRef          = useRef<PeerInfo[]>([]);

  const onSessionEndedRef = useRef(onSessionEnded);
  const sessionIdRef      = useRef(sessionId);
  const userIdRef         = useRef(userId);
  const userNameRef       = useRef(userName);
  const userRoleRef       = useRef(userRole);

  useEffect(() => { onSessionEndedRef.current = onSessionEnded; }, [onSessionEnded]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { userRoleRef.current = userRole; }, [userRole]);

  const [localStream,          setLocalStream]          = useState<MediaStream | null>(null);
  const [remoteStreams,        setRemoteStreams]         = useState<Map<string, RemoteStream>>(new Map());
  const [chatMessages,         setChatMessages]         = useState<ChatMsg[]>([]);
  const [isConnected,          setIsConnected]          = useState(false);
  const [isConnecting,         setIsConnecting]         = useState(false);
  const [isAudioEnabled,       setIsAudioEnabled]       = useState(false);
  const [isVideoEnabled,       setIsVideoEnabled]       = useState(false);
  const [supportMode,          setSupportMode]          = useState<SupportMode>('chat');
  const [mediaWarning,         setMediaWarning]         = useState<string | null>(null);
  const [error,                setError]                = useState<string | null>(null);
  const [peers,                setPeers]                = useState<PeerInfo[]>([]);
  const [incomingVideoRequest, setIncomingVideoRequest] = useState(false);
  const [videoRequestPending,  setVideoRequestPending]  = useState(false);

  // Helper to update peers state + ref atomically
  const updatePeers = useCallback((updater: (prev: PeerInfo[]) => PeerInfo[]) => {
    setPeers((prev) => {
      const next = updater(prev);
      peersRef.current = next;
      return next;
    });
  }, []);

  // -- emit helper ------------------------------------------------------------

  const emitAsync = useCallback((event: string, data: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const s = socketRef.current;
      if (!s?.connected) return reject(new Error('Socket not connected'));
      s.emit(event, data, (res: any) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }, []);

  // -- transports ------------------------------------------------------------

  const createSendTransport = useCallback(async (): Promise<Transport> => {
    const device = deviceRef.current;
    if (!device) throw new Error('Device not loaded');
    const sid = sessionIdRef.current;
    const d = await emitAsync('create-transport', { sessionId: sid, direction: 'send' });
    const t = device.createSendTransport({
      id: d.id,
      iceParameters: d.iceParameters,
      iceCandidates: d.iceCandidates,
      dtlsParameters: d.dtlsParameters,
    });
    t.on('connect', async ({ dtlsParameters }, cb, eb) => {
      try { await emitAsync('connect-transport', { sessionId: sid, transportId: t.id, dtlsParameters }); cb(); }
      catch (e) { eb(e as Error); }
    });
    t.on('produce', async ({ kind, rtpParameters, appData }, cb, eb) => {
      try {
        const { id } = await emitAsync('produce', { sessionId: sid, transportId: t.id, kind, rtpParameters, appData });
        cb({ id });
      } catch (e) { eb(e as Error); }
    });
    sendTransportRef.current = t;
    return t;
  }, [emitAsync]);

  const createRecvTransport = useCallback(async (): Promise<Transport> => {
    const device = deviceRef.current;
    if (!device) throw new Error('Device not loaded');
    const sid = sessionIdRef.current;
    const d = await emitAsync('create-transport', { sessionId: sid, direction: 'recv' });
    const t = device.createRecvTransport({
      id: d.id,
      iceParameters: d.iceParameters,
      iceCandidates: d.iceCandidates,
      dtlsParameters: d.dtlsParameters,
    });
    t.on('connect', async ({ dtlsParameters }, cb, eb) => {
      try { await emitAsync('connect-transport', { sessionId: sid, transportId: t.id, dtlsParameters }); cb(); }
      catch (e) { eb(e as Error); }
    });
    recvTransportRef.current = t;
    return t;
  }, [emitAsync]);

  // -- consume remote producer ------------------------------------------------

  const consumeProducer = useCallback(async (producerId: string, peerSocketId: string, peerName?: string, peerRole?: string) => {
    const device = deviceRef.current;
    if (!device) { console.warn('[ConnectDesk] consumeProducer: no device'); return; }

    // Reuse existing recv transport or create a new one
    let transport = recvTransportRef.current;
    if (!transport || transport.closed) {
      console.log('[ConnectDesk] Creating new recv transport');
      transport = await createRecvTransport();
    }

    try {
      console.log('[ConnectDesk] Consuming producer:', producerId, 'from peer:', peerSocketId);
      const cd = await emitAsync('consume', {
        sessionId: sessionIdRef.current,
        transportId: transport.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities,
      });

      console.log('[ConnectDesk] Consumer data received:', cd.kind, cd.id);

      const consumer = await transport.consume({
        id: cd.id,
        producerId: cd.producerId,
        kind: cd.kind,
        rtpParameters: cd.rtpParameters,
      });

      consumersRef.current.set(consumer.id, consumer);

      // Resume consumer (server may have paused it)
      await emitAsync('resume-consumer', { sessionId: sessionIdRef.current, consumerId: consumer.id });
      console.log('[ConnectDesk] Consumer resumed, track:', consumer.track.kind, 'readyState:', consumer.track.readyState);

      // Add track to remote stream
      setRemoteStreams((prev) => {
        const m = new Map(prev);
        const ex = m.get(peerSocketId);
        if (ex) {
          // Add track to existing stream if not already there
          const existingIds = ex.stream.getTracks().map((t) => t.id);
          if (!existingIds.includes(consumer.track.id)) {
            ex.stream.addTrack(consumer.track);
          }
          m.set(peerSocketId, {
            ...ex,
            peerName: peerName || ex.peerName,
            peerRole: peerRole || ex.peerRole,
          });
        } else {
          const stream = new MediaStream([consumer.track]);
          m.set(peerSocketId, {
            peerId: peerSocketId,
            peerName: peerName || 'Participant',
            peerRole: peerRole || 'CUSTOMER',
            stream,
            audioEnabled: true,
            videoEnabled: true,
          });
        }
        return m;
      });
    } catch (err) {
      console.error('[ConnectDesk] consumeProducer failed:', err);
    }
  }, [emitAsync, createRecvTransport]);

  // -- socket events ---------------------------------------------------------

  const registerSocketEvents = useCallback((socket: Socket) => {

    socket.on('peer-joined', (peer: PeerInfo) => {
      console.log('[ConnectDesk] Peer joined:', peer.name, peer.role);
      updatePeers((p) => [...p.filter((x) => x.socketId !== peer.socketId), peer]);
    });

    socket.on('peer-left', ({ socketId }: { socketId: string }) => {
      console.log('[ConnectDesk] Peer left:', socketId);
      updatePeers((p) => p.filter((x) => x.socketId !== socketId));
      setRemoteStreams((p) => { const m = new Map(p); m.delete(socketId); return m; });
    });

    // *** CRITICAL FIX: Do NOT call consumeProducer inside setPeers ***
    // Use peersRef (synchronous) to look up peer info, then call consumeProducer directly
    socket.on('new-producer', ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
      console.log('[ConnectDesk] new-producer event:', kind, 'from', socketId);
      const peer = peersRef.current.find((p) => p.socketId === socketId);
      // Call consumeProducer directly — NOT inside a state updater
      consumeProducer(producerId, socketId, peer?.name, peer?.role);
    });

    socket.on('producer-closed', ({ producerId }: { producerId: string }) => {
      consumersRef.current.forEach((c, cid) => {
        if (c.producerId === producerId) { c.close(); consumersRef.current.delete(cid); }
      });
    });

    socket.on('consumer-closed', ({ consumerId }: { consumerId: string }) => {
      const c = consumersRef.current.get(consumerId);
      if (c) { c.close(); consumersRef.current.delete(consumerId); }
    });

    socket.on('media-state-change', ({ socketId, kind, enabled }: { socketId: string; kind: string; enabled: boolean }) => {
      setRemoteStreams((prev) => {
        const m = new Map(prev);
        const r = m.get(socketId);
        if (r) {
          m.set(socketId, {
            ...r,
            audioEnabled: kind === 'audio' ? enabled : r.audioEnabled,
            videoEnabled: kind === 'video' ? enabled : r.videoEnabled,
          });
        }
        return m;
      });
    });

    socket.on('chat-message', (msg: ChatMsg) => {
      setChatMessages((p) => p.some((m) => m.id === msg.id) ? p : [...p, msg]);
    });

    socket.on('session-ended', () => onSessionEndedRef.current?.());
    socket.on('video-request', () => setIncomingVideoRequest(true));
    socket.on('video-request-accepted', () => setVideoRequestPending(false));
    socket.on('video-request-declined', () => {
      setVideoRequestPending(false);
      setMediaWarning('Customer declined the video request.');
    });

    socket.on('disconnect', (reason) => {
      console.log('[ConnectDesk] Disconnected:', reason);
      setIsConnected(false);
    });

  }, [consumeProducer, updatePeers]);

  // -------------------------------------------------------------------------
  // TIER 1 — connect() — socket + room join, NO media
  // -------------------------------------------------------------------------

  const connect = useCallback(async () => {
    if (socketRef.current?.connected) return;
    setIsConnecting(true);
    setError(null);

    try {
      const socketHost = window.location.hostname;
      const url = process.env.NEXT_PUBLIC_SOCKET_URL || `${window.location.protocol}//${socketHost}:3001`;
      console.log('[ConnectDesk] Connecting to:', url);

      const socket = io(url, {
        path: '/socket.io',
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        forceNew: true,
      });
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          socket.disconnect();
          reject(new Error(`Connection timed out. Make sure the SFU server is running:\n  npm run dev:all\nTried: ${url}`));
        }, 10000);
        socket.on('connect', () => { clearTimeout(t); resolve(); });
        socket.on('connect_error', (err) => {
          clearTimeout(t);
          socket.disconnect();
          reject(new Error(`Cannot reach SFU at ${url}\nRun: npm run dev:all\nDetail: ${err.message}`));
        });
      });

      console.log('[ConnectDesk] Socket connected:', socket.id);

      const joinData = await emitAsync('join-room', {
        sessionId: sessionIdRef.current,
        userId: userIdRef.current,
        name: userNameRef.current,
        role: userRoleRef.current,
      });

      console.log('[ConnectDesk] Joined room. Existing peers:', joinData.existingPeers?.length ?? 0);

      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });
      deviceRef.current = device;

      // Create recv transport so we can consume others' streams
      await createRecvTransport();

      // Consume existing producers
      const existingPeers: PeerInfo[] = joinData.existingPeers || [];
      // Update ref first so registerSocketEvents can use it
      peersRef.current = existingPeers;
      setPeers(existingPeers);

      for (const peer of existingPeers) {
        if (peer.producers && peer.producers.length > 0) {
          for (const prod of peer.producers) {
            await consumeProducer(prod.id, peer.socketId, peer.name, peer.role);
          }
        }
      }

      // Register all socket events AFTER initial setup
      registerSocketEvents(socket);

      setIsConnected(true);
      setSupportMode('chat');
      console.log('[ConnectDesk] Ready in chat mode.');

    } catch (err: any) {
      console.error('[ConnectDesk] Connect failed:', err.message);
      setError(err.message || 'Failed to connect');
      socketRef.current?.disconnect();
      socketRef.current = null;
    } finally {
      setIsConnecting(false);
    }
  }, [emitAsync, createRecvTransport, consumeProducer, registerSocketEvents]);

  // -------------------------------------------------------------------------
  // TIER 2 — startVoice() — microphone
  // -------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    if (!deviceRef.current) { setMediaWarning('Not connected yet.'); return; }
    if (!socketRef.current?.connected) { setMediaWarning('Connection lost. Please refresh.'); return; }
    setMediaWarning(null);

    console.log('[ConnectDesk] Requesting microphone...');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: false,
      });
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'  ? 'Microphone permission denied. You can still use chat.' :
        err.name === 'NotFoundError'    ? 'No microphone found. You can still use chat.' :
        err.name === 'NotReadableError' ? 'Microphone is in use by another app.' :
                                          `Microphone error: ${err.message}`;
      console.error('[ConnectDesk] getUserMedia audio error:', err);
      setMediaWarning(msg);
      return;
    }

    console.log('[ConnectDesk] Got audio stream, tracks:', stream.getAudioTracks().length);

    if (localStreamRef.current) {
      stream.getAudioTracks().forEach((t) => localStreamRef.current!.addTrack(t));
    } else {
      localStreamRef.current = stream;
      setLocalStream(stream);
    }

    try {
      let st = sendTransportRef.current;
      if (!st || st.closed) {
        console.log('[ConnectDesk] Creating send transport for voice...');
        st = await createSendTransport();
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && !audioProducerRef.current) {
        console.log('[ConnectDesk] Producing audio track...');
        audioProducerRef.current = await st.produce({
          track: audioTrack,
          appData: { mediaType: 'audio' },
        });
        console.log('[ConnectDesk] Audio producer ID:', audioProducerRef.current.id);
      }

      setIsAudioEnabled(true);
      setSupportMode('voice');
      socketRef.current?.emit('media-state-change', {
        sessionId: sessionIdRef.current, kind: 'audio', enabled: true,
      });
    } catch (e: any) {
      console.error('[ConnectDesk] startVoice produce error:', e);
      setMediaWarning(`Voice failed: ${e.message}`);
    }
  }, [createSendTransport]);

  // -------------------------------------------------------------------------
  // TIER 3 — startVideo() — camera + mic
  // -------------------------------------------------------------------------

  const startVideo = useCallback(async () => {
    if (!deviceRef.current) { setMediaWarning('Not connected yet.'); return; }
    if (!socketRef.current?.connected) { setMediaWarning('Connection lost. Please refresh.'); return; }
    setMediaWarning(null);

    console.log('[ConnectDesk] Requesting camera + mic...');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'  ? 'Camera/mic permission denied.' :
        err.name === 'NotFoundError'    ? 'No camera found. Using chat.' :
        err.name === 'NotReadableError' ? 'Camera/mic in use by another app.' :
                                          `Camera error: ${err.message}`;
      console.error('[ConnectDesk] getUserMedia video error:', err);
      setMediaWarning(msg);
      return;
    }

    console.log('[ConnectDesk] Got stream, video tracks:', stream.getVideoTracks().length, 'audio tracks:', stream.getAudioTracks().length);

    // Stop old tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    localStreamRef.current = stream;
    setLocalStream(stream);

    try {
      let st = sendTransportRef.current;
      if (!st || st.closed) {
        console.log('[ConnectDesk] Creating send transport for video...');
        st = await createSendTransport();
      }

      // Close old producers
      if (audioProducerRef.current) { audioProducerRef.current.close(); audioProducerRef.current = null; }
      if (videoProducerRef.current) { videoProducerRef.current.close(); videoProducerRef.current = null; }

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log('[ConnectDesk] Producing audio...');
        audioProducerRef.current = await st.produce({
          track: audioTrack,
          appData: { mediaType: 'audio' },
        });
        console.log('[ConnectDesk] Audio producer:', audioProducerRef.current.id);
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        console.log('[ConnectDesk] Producing video...');
        videoProducerRef.current = await st.produce({
          track: videoTrack,
          appData: { mediaType: 'video' },
          codecOptions: { videoGoogleStartBitrate: 1000 },
        });
        console.log('[ConnectDesk] Video producer:', videoProducerRef.current.id);
      }

      setIsAudioEnabled(true);
      setIsVideoEnabled(true);
      setSupportMode('video');
      socketRef.current?.emit('media-state-change', {
        sessionId: sessionIdRef.current, kind: 'audio', enabled: true,
      });
      socketRef.current?.emit('media-state-change', {
        sessionId: sessionIdRef.current, kind: 'video', enabled: true,
      });
    } catch (e: any) {
      console.error('[ConnectDesk] startVideo produce error:', e);
      setMediaWarning(`Video failed: ${e.message}`);
    }
  }, [createSendTransport]);

  // -------------------------------------------------------------------------
  // Media controls
  // -------------------------------------------------------------------------

  const stopMedia = useCallback(() => {
    audioProducerRef.current?.close(); audioProducerRef.current = null;
    videoProducerRef.current?.close(); videoProducerRef.current = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setIsAudioEnabled(false);
    setIsVideoEnabled(false);
    setSupportMode('chat');
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: false });
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'video', enabled: false });
  }, []);

  const toggleAudio = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsAudioEnabled(track.enabled);
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: track.enabled });
  }, []);

  const toggleVideo = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsVideoEnabled(track.enabled);
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'video', enabled: track.enabled });
  }, []);

  // -------------------------------------------------------------------------
  // Video escalation
  // -------------------------------------------------------------------------

  const requestCustomerVideo = useCallback(() => {
    if (!socketRef.current?.connected) return;
    setVideoRequestPending(true);
    socketRef.current.emit('request-customer-video', { sessionId: sessionIdRef.current });
  }, []);

  const respondToVideoRequest = useCallback(async (accepted: boolean) => {
    setIncomingVideoRequest(false);
    socketRef.current?.emit('video-request-response', { sessionId: sessionIdRef.current, accepted });
    if (accepted) await startVideo();
  }, [startVideo]);

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(async (
    content: string,
    type: 'TEXT' | 'FILE' = 'TEXT',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number,
  ) => {
    const sid = sessionIdRef.current;
    const msg: ChatMsg = {
      id: crypto.randomUUID(),
      senderId: userIdRef.current,
      senderName: userNameRef.current,
      senderRole: userRoleRef.current,
      content, type, fileUrl, fileName, fileSize,
      createdAt: new Date().toISOString(),
    };
    setChatMessages((p) => [...p, msg]);
    socketRef.current?.emit('chat-message', { sessionId: sid, message: msg });
    try {
      await fetch(`/api/sessions/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type, fileUrl, fileName, fileSize }),
      });
    } catch (e) { console.error('Failed to persist message:', e); }
  }, []);

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  const endSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    socketRef.current?.emit('end-session', { sessionId: sid });
    try {
      await fetch(`/api/sessions/${sid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ENDED' }),
      });
    } catch (e) { console.error('Failed to end session:', e); }
  }, []);

  const disconnect = useCallback(() => {
    stopMedia();
    sendTransportRef.current?.close(); sendTransportRef.current = null;
    recvTransportRef.current?.close(); recvTransportRef.current = null;
    consumersRef.current.forEach((c) => c.close());
    consumersRef.current.clear();
    socketRef.current?.disconnect();
    socketRef.current = null;
    deviceRef.current = null;
    peersRef.current = [];
    setIsConnected(false);
    setRemoteStreams(new Map());
    setPeers([]);
    setSupportMode('chat');
  }, [stopMedia]);

  const clearError        = useCallback(() => setError(null), []);
  const clearMediaWarning = useCallback(() => setMediaWarning(null), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      consumersRef.current.forEach((c) => c.close());
      socketRef.current?.disconnect();
    };
  }, []);

  return {
    connect, disconnect, isConnected, isConnecting, error, clearError,
    localStream, remoteStreams,
    supportMode, startVoice, startVideo, stopMedia, mediaWarning, clearMediaWarning,
    isAudioEnabled, isVideoEnabled, toggleAudio, toggleVideo,
    requestCustomerVideo, respondToVideoRequest, incomingVideoRequest, videoRequestPending,
    chatMessages, setChatMessages, sendMessage,
    endSession, peers,
  };
}
