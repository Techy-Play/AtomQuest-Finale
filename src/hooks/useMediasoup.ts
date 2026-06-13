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

  const createSendTransport = useCallback(async () => {
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

  const createRecvTransport = useCallback(async () => {
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
    if (!device) return;
    let transport = recvTransportRef.current;
    if (!transport || transport.closed) {
      transport = await createRecvTransport();
    }
    try {
      const cd = await emitAsync('consume', {
        sessionId: sessionIdRef.current,
        transportId: transport.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities,
      });
      const consumer = await transport.consume({
        id: cd.id,
        producerId: cd.producerId,
        kind: cd.kind,
        rtpParameters: cd.rtpParameters,
      });
      consumersRef.current.set(consumer.id, consumer);
      // Resume immediately — server pauses by default
      await emitAsync('resume-consumer', { sessionId: sessionIdRef.current, consumerId: consumer.id });

      setRemoteStreams((prev) => {
        const m = new Map(prev);
        const ex = m.get(peerSocketId);
        if (ex) {
          const ids = ex.stream.getTracks().map((t) => t.id);
          if (!ids.includes(consumer.track.id)) ex.stream.addTrack(consumer.track);
          m.set(peerSocketId, { ...ex, peerName: peerName || ex.peerName, peerRole: peerRole || ex.peerRole });
        } else {
          m.set(peerSocketId, {
            peerId: peerSocketId,
            peerName: peerName || 'Participant',
            peerRole: peerRole || 'CUSTOMER',
            stream: new MediaStream([consumer.track]),
            audioEnabled: true,
            videoEnabled: true,
          });
        }
        return m;
      });
    } catch (err) {
      console.error('[ConnectDesk] consumeProducer error:', err);
    }
  }, [emitAsync, createRecvTransport]);

  // -- socket events ---------------------------------------------------------

  const registerSocketEvents = useCallback((socket: Socket) => {
    socket.on('peer-joined', (peer: PeerInfo) => {
      console.log('[ConnectDesk] Peer joined:', peer.name, peer.role);
      setPeers((p) => [...p.filter((x) => x.socketId !== peer.socketId), peer]);
    });

    socket.on('peer-left', ({ socketId }: { socketId: string }) => {
      console.log('[ConnectDesk] Peer left:', socketId);
      setPeers((p) => p.filter((x) => x.socketId !== socketId));
      setRemoteStreams((p) => { const m = new Map(p); m.delete(socketId); return m; });
    });

    socket.on('new-producer', async ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
      console.log('[ConnectDesk] New producer from', socketId, 'kind:', kind);
      // Find peer name/role from peers list
      setPeers((cp) => {
        const peer = cp.find((p) => p.socketId === socketId);
        consumeProducer(producerId, socketId, peer?.name, peer?.role);
        return cp;
      });
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

    // Handle socket disconnect gracefully
    socket.on('disconnect', (reason) => {
      console.log('[ConnectDesk] Socket disconnected:', reason);
      setIsConnected(false);
    });
  }, [consumeProducer]);

  // -------------------------------------------------------------------------
  // TIER 1 — connect() — socket + room join, NO media permissions
  // -------------------------------------------------------------------------

  const connect = useCallback(async () => {
    if (socketRef.current?.connected) return;
    setIsConnecting(true);
    setError(null);
    try {
      const socketHost = window.location.hostname;
      const url = process.env.NEXT_PUBLIC_SOCKET_URL || `${window.location.protocol}//${socketHost}:3001`;

      console.log('[ConnectDesk] Connecting to:', url, '| Session:', sessionIdRef.current, '| Role:', userRoleRef.current);

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

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          socket.disconnect();
          reject(new Error(
            `Connection timed out.\nMake sure both servers are running:\n  npm run dev:all\nTried: ${url}`
          ));
        }, 10000);
        socket.on('connect', () => { clearTimeout(t); resolve(); });
        socket.on('connect_error', (err) => {
          clearTimeout(t);
          socket.disconnect();
          reject(new Error(`Cannot reach SFU at ${url}.\nRun: npm run dev:server\nDetail: ${err.message}`));
        });
      });

      console.log('[ConnectDesk] Socket connected:', socket.id);

      // Join the mediasoup room
      const joinData = await emitAsync('join-room', {
        sessionId: sessionIdRef.current,
        userId: userIdRef.current,
        name: userNameRef.current,
        role: userRoleRef.current,
      });

      console.log('[ConnectDesk] Joined room, existing peers:', joinData.existingPeers?.length ?? 0);

      // Load mediasoup device with server RTP capabilities
      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });
      deviceRef.current = device;

      // Create recv transport for consuming remote streams
      await createRecvTransport();

      // Consume any producers that already exist in the room
      const existingPeers: PeerInfo[] = joinData.existingPeers || [];
      setPeers(existingPeers);
      for (const peer of existingPeers) {
        if (peer.producers && peer.producers.length > 0) {
          for (const prod of peer.producers) {
            await consumeProducer(prod.id, peer.socketId, peer.name, peer.role);
          }
        }
      }

      registerSocketEvents(socket);
      setIsConnected(true);
      setSupportMode('chat');

      console.log('[ConnectDesk] Ready. Mode: chat');
    } catch (err: any) {
      console.error('[ConnectDesk] Connect error:', err.message);
      setError(err.message || 'Failed to connect to session');
      socketRef.current?.disconnect();
      socketRef.current = null;
    } finally {
      setIsConnecting(false);
    }
  }, [emitAsync, createRecvTransport, consumeProducer, registerSocketEvents]);

  // -------------------------------------------------------------------------
  // TIER 2 — startVoice() — microphone only
  // -------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    if (!deviceRef.current) { setMediaWarning('Not connected to session yet.'); return; }
    if (!socketRef.current?.connected) { setMediaWarning('Connection lost. Please refresh.'); return; }
    setMediaWarning(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'  ? 'Microphone permission denied. You can still use chat.' :
        err.name === 'NotFoundError'    ? 'No microphone found. You can still use chat.' :
        err.name === 'NotReadableError' ? 'Microphone is in use by another app.' :
                                          'Could not access microphone. You can still use chat.';
      setMediaWarning(msg);
      return;
    }

    // Merge with existing local stream, or create new
    if (localStreamRef.current) {
      stream.getAudioTracks().forEach((t) => localStreamRef.current!.addTrack(t));
    } else {
      localStreamRef.current = stream;
      setLocalStream(stream);
    }

    try {
      // Create send transport if not exists
      let st = sendTransportRef.current;
      if (!st || st.closed) st = await createSendTransport();

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && !audioProducerRef.current) {
        audioProducerRef.current = await st.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
        console.log('[ConnectDesk] Audio producer created:', audioProducerRef.current.id);
      }
      setIsAudioEnabled(true);
      setSupportMode('voice');
      socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: true });
    } catch (e: any) {
      console.error('[ConnectDesk] startVoice error:', e);
      setMediaWarning('Failed to start voice. You can still use chat.');
    }
  }, [createSendTransport]);

  // -------------------------------------------------------------------------
  // TIER 3 — startVideo() — camera + mic
  // -------------------------------------------------------------------------

  const startVideo = useCallback(async () => {
    if (!deviceRef.current) { setMediaWarning('Not connected to session yet.'); return; }
    if (!socketRef.current?.connected) { setMediaWarning('Connection lost. Please refresh.'); return; }
    setMediaWarning(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'  ? 'Camera/mic permission denied. You can still use voice/chat.' :
        err.name === 'NotFoundError'    ? 'No camera found. You can still use voice/chat.' :
        err.name === 'NotReadableError' ? 'Camera is in use by another app.' :
                                          'Could not access camera. You can still use voice/chat.';
      setMediaWarning(msg);
      return;
    }

    // Stop previous tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    localStreamRef.current = stream;
    setLocalStream(stream);

    try {
      let st = sendTransportRef.current;
      if (!st || st.closed) st = await createSendTransport();

      // Close existing producers before creating new ones
      if (audioProducerRef.current) { audioProducerRef.current.close(); audioProducerRef.current = null; }
      if (videoProducerRef.current) { videoProducerRef.current.close(); videoProducerRef.current = null; }

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioProducerRef.current = await st.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
        console.log('[ConnectDesk] Audio producer created:', audioProducerRef.current.id);
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoProducerRef.current = await st.produce({
          track: videoTrack,
          appData: { mediaType: 'video' },
          encodings: [
            { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
            { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
            { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
          ],
          codecOptions: { videoGoogleStartBitrate: 1000 },
        });
        console.log('[ConnectDesk] Video producer created:', videoProducerRef.current.id);
      }

      setIsAudioEnabled(true);
      setIsVideoEnabled(true);
      setSupportMode('video');
      socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: true });
      socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'video', enabled: true });
    } catch (e: any) {
      console.error('[ConnectDesk] startVideo error:', e);
      setMediaWarning('Failed to start video. You can still use voice/chat.');
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
  // Video escalation requests
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

  const sendMessage = useCallback(async (content: string, type: 'TEXT' | 'FILE' = 'TEXT', fileUrl?: string, fileName?: string, fileSize?: number) => {
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
  // Session management
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
        localStreamRef.current = null;
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
