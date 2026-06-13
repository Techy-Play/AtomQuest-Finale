'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import type { Device, Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

interface PeerInfo {
  socketId: string; userId: string; name: string; role: string;
  producers?: { id: string; kind: string }[];
}
interface RemoteStream {
  peerId: string; peerName: string; peerRole: string;
  stream: MediaStream; audioEnabled: boolean; videoEnabled: boolean;
}
export interface ChatMsg {
  id: string; senderId: string; senderName: string; senderRole: string;
  content: string; type: 'TEXT' | 'FILE';
  fileUrl?: string; fileName?: string; fileSize?: number; createdAt: string;
}
export type SupportMode = 'chat' | 'voice' | 'video';
interface UseMediasoupOptions {
  sessionId: string; userId: string; userName: string;
  userRole: string; onSessionEnded?: () => void;
}

export function useMediasoup({ sessionId, userId, userName, userRole, onSessionEnded }: UseMediasoupOptions) {
  const socketRef             = useRef<Socket | null>(null);
  const deviceRef             = useRef<Device | null>(null);
  const sendTransportRef      = useRef<Transport | null>(null);
  const recvTransportRef      = useRef<Transport | null>(null);
  const audioProducerRef      = useRef<Producer | null>(null);
  const videoProducerRef      = useRef<Producer | null>(null);
  const consumersRef          = useRef<Map<string, Consumer>>(new Map());
  // Tracks the active consumer ID per peer per kind: { [peerSocketId]: { audio?: consumerId, video?: consumerId } }
  // Used to close the old consumer before opening a new one for the same kind (prevents echo from duplicate audio streams).
  const peerConsumerKindRef   = useRef<Map<string, { audio?: string; video?: string }>>(new Map());
  const localStreamRef        = useRef<MediaStream | null>(null);
  const sendTransportSocketId = useRef<string | null>(null);
  // Lock to prevent concurrent startVoice/startVideo calls (React re-renders can cause duplicates)
  const isStartingMediaRef    = useRef(false);
  // Mirror of peers state for use in socket event handlers (avoids stale closure)
  const peersRef              = useRef<PeerInfo[]>([]);

  const onSessionEndedRef = useRef(onSessionEnded);
  const sessionIdRef = useRef(sessionId);
  const userIdRef    = useRef(userId);
  const userNameRef  = useRef(userName);
  const userRoleRef  = useRef(userRole);

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
  const [facingMode,           setFacingMode]           = useState<'user' | 'environment'>('user');

  // Keep peersRef in sync with peers state so socket event handlers always see current peers
  useEffect(() => { peersRef.current = peers; }, [peers]);

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

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

  // Close and null all mediasoup resources.
  // Must be called whenever the socket reconnects so we start fresh.
  const resetTransports = useCallback(() => {
    try { sendTransportRef.current?.close(); } catch {}
    try { recvTransportRef.current?.close();  } catch {}
    sendTransportRef.current    = null;
    recvTransportRef.current    = null;
    audioProducerRef.current    = null;
    videoProducerRef.current    = null;
    sendTransportSocketId.current = null;
    consumersRef.current.forEach((c) => { try { c.close(); } catch {} });
    consumersRef.current.clear();
    peerConsumerKindRef.current.clear();
  }, []);

  // Create a fresh send transport. Always associates it with the current socket ID.
  const createSendTransport = useCallback(async (): Promise<Transport> => {
    const device = deviceRef.current;
    if (!device) throw new Error('Device not loaded');
    if (!socketRef.current?.connected) throw new Error('Socket not connected');

    // Close any previous send transport first
    try { sendTransportRef.current?.close(); } catch {}
    sendTransportRef.current = null;

    const sid = sessionIdRef.current;
    const d = await emitAsync('create-transport', { sessionId: sid, direction: 'send' });
    const t = device.createSendTransport({
      id: d.id, iceParameters: d.iceParameters,
      iceCandidates: d.iceCandidates, dtlsParameters: d.dtlsParameters,
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
    sendTransportRef.current    = t;
    sendTransportSocketId.current = socketRef.current!.id ?? null;
    console.log('[ConnectDesk] Send transport created:', t.id, '| socket:', sendTransportSocketId.current);
    return t;
  }, [emitAsync]);

  const createRecvTransport = useCallback(async (): Promise<Transport> => {
    const device = deviceRef.current;
    if (!device) throw new Error('Device not loaded');
    const sid = sessionIdRef.current;
    const d = await emitAsync('create-transport', { sessionId: sid, direction: 'recv' });
    const t = device.createRecvTransport({
      id: d.id, iceParameters: d.iceParameters,
      iceCandidates: d.iceCandidates, dtlsParameters: d.dtlsParameters,
    });
    t.on('connect', async ({ dtlsParameters }, cb, eb) => {
      try { await emitAsync('connect-transport', { sessionId: sid, transportId: t.id, dtlsParameters }); cb(); }
      catch (e) { eb(e as Error); }
    });
    recvTransportRef.current = t;
    return t;
  }, [emitAsync]);

  // Returns a valid send transport for the CURRENT socket connection.
  // Creates a new one if none exists or if the socket has reconnected since creation.
  const getOrCreateSendTransport = useCallback(async (): Promise<Transport> => {
    const currentSocketId = socketRef.current?.id;
    const existing = sendTransportRef.current;
    // Reuse only if not closed AND created for this socket session
    if (existing && !existing.closed && sendTransportSocketId.current === currentSocketId) {
      return existing;
    }
    // Otherwise create a fresh one
    return await createSendTransport();
  }, [createSendTransport]);

  const consumeProducer = useCallback(async (producerId: string, peerSocketId: string, peerName?: string, peerRole?: string) => {
    const device = deviceRef.current;
    if (!device) { console.warn('[ConnectDesk] consumeProducer: device not ready'); return; }
    let transport = recvTransportRef.current;
    if (!transport || transport.closed) {
      console.log('[ConnectDesk] consumeProducer: creating recv transport');
      transport = await createRecvTransport();
    }
    try {
      console.log('[ConnectDesk] consumeProducer: consuming producerId=', producerId, 'from peer=', peerSocketId);
      const cd = await emitAsync('consume', {
        sessionId: sessionIdRef.current, transportId: transport.id,
        producerId, rtpCapabilities: device.rtpCapabilities,
      });
      const kind = cd.kind as 'audio' | 'video';
      console.log('[ConnectDesk] consumeProducer: got consumer kind=', kind, 'id=', cd.id);

      // ECHO FIX: close stale consumer of the same kind for this peer BEFORE creating the new one.
      // This prevents the old audio track from continuing to play alongside the new one.
      const peerKinds = peerConsumerKindRef.current.get(peerSocketId) || {};
      const staleId = kind === 'audio' ? peerKinds.audio : peerKinds.video;
      if (staleId && staleId !== cd.id) {
        const stale = consumersRef.current.get(staleId);
        if (stale) {
          console.log('[ConnectDesk] consumeProducer: closing stale', kind, 'consumer', staleId);
          try { stale.close(); } catch {}
          consumersRef.current.delete(staleId);
        }
      }
      // Record new consumer ID for this peer+kind BEFORE awaiting transport.consume
      peerConsumerKindRef.current.set(peerSocketId, { ...peerKinds, [kind]: cd.id });

      const consumer = await transport.consume({
        id: cd.id, producerId: cd.producerId, kind, rtpParameters: cd.rtpParameters,
      });
      consumersRef.current.set(consumer.id, consumer);
      await emitAsync('resume-consumer', { sessionId: sessionIdRef.current, consumerId: consumer.id });
      console.log('[ConnectDesk] consumeProducer: resumed consumer', consumer.id, 'track:', consumer.track.id);

      // Add track to remote stream (or create new stream for this peer)
      setRemoteStreams((curStreams) => {
        const m = new Map(curStreams);
        const existing = m.get(peerSocketId);
        if (existing) {
          // Remove any old tracks of the same kind to prevent echo/duplicate audio
          const oldTracks = kind === 'audio'
            ? existing.stream.getAudioTracks()
            : existing.stream.getVideoTracks();
          oldTracks.forEach((t) => {
            if (t.id !== consumer.track.id) existing.stream.removeTrack(t);
          });
          // Add new track if not already present
          if (!existing.stream.getTrackById(consumer.track.id)) {
            existing.stream.addTrack(consumer.track);
          }
          m.set(peerSocketId, {
            ...existing,
            peerName: peerName || existing.peerName,
            peerRole: peerRole || existing.peerRole,
          });
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
    } catch (err) { console.error('[ConnectDesk] consumeProducer error:', err); }
  }, [emitAsync, createRecvTransport]);


  // --------------------------------------------------------------------------
  // Socket events
  // --------------------------------------------------------------------------

  const registerSocketEvents = useCallback((socket: Socket) => {
    socket.on('peer-joined', (peer: PeerInfo) => {
      console.log('[ConnectDesk] Peer joined:', peer.name, peer.role);
      // Update ref synchronously so event handlers can access current peers immediately
      peersRef.current = [...peersRef.current.filter((x) => x.socketId !== peer.socketId), peer];
      setPeers(peersRef.current);
    });
    socket.on('peer-left', ({ socketId }: { socketId: string }) => {
      setPeers((p) => p.filter((x) => x.socketId !== socketId));
      setRemoteStreams((p) => { const m = new Map(p); m.delete(socketId); return m; });
    });
    socket.on('new-producer', ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
      console.log('[ConnectDesk] New producer from', socketId, 'kind:', kind);
      // IMPORTANT: do NOT call async functions inside setPeers - read from ref instead
      const peer = peersRef.current.find((p) => p.socketId === socketId);
      consumeProducer(producerId, socketId, peer?.name, peer?.role);
    });
    socket.on('producer-closed', ({ producerId }: { producerId: string }) => {
      consumersRef.current.forEach((c, cid) => {
        if (c.producerId === producerId) { try { c.close(); } catch {} consumersRef.current.delete(cid); }
      });
    });
    socket.on('consumer-closed', ({ consumerId }: { consumerId: string }) => {
      const c = consumersRef.current.get(consumerId);
      if (c) { try { c.close(); } catch {} consumersRef.current.delete(consumerId); }
    });
    socket.on('media-state-change', ({ socketId, kind, enabled }: { socketId: string; kind: string; enabled: boolean }) => {
      // Actually mute/unmute the consumer track so the audio fully stops (not just a UI badge)
      const peerKinds = peerConsumerKindRef.current.get(socketId);
      if (peerKinds && kind === 'audio') {
        const consumerId = peerKinds.audio;
        if (consumerId) {
          const c = consumersRef.current.get(consumerId);
          if (c?.track) c.track.enabled = enabled;
        }
      }
      setRemoteStreams((prev) => {
        const m = new Map(prev);
        const r = m.get(socketId);
        if (r) m.set(socketId, { ...r, audioEnabled: kind === 'audio' ? enabled : r.audioEnabled, videoEnabled: kind === 'video' ? enabled : r.videoEnabled });
        return m;
      });
    });
    socket.on('chat-message', (msg: ChatMsg) => {
      setChatMessages((p) => p.some((m) => m.id === msg.id) ? p : [...p, msg]);
    });
    socket.on('session-ended', () => onSessionEndedRef.current?.());
    socket.on('video-request', () => setIncomingVideoRequest(true));
    socket.on('video-request-accepted', () => setVideoRequestPending(false));
    socket.on('video-request-declined', () => { setVideoRequestPending(false); setMediaWarning('Customer declined the video request.'); });
    socket.on('disconnect', (reason) => {
      console.log('[ConnectDesk] Socket disconnected:', reason);
      setIsConnected(false);
      // Reset all transport refs. The server removes this peer on disconnect,
      // so all transport IDs are invalid after reconnect.
      resetTransports();
    });
  }, [consumeProducer, resetTransports]);

  // --------------------------------------------------------------------------
  // connect()
  // --------------------------------------------------------------------------

  const connect = useCallback(async () => {
    if (socketRef.current?.connected) return;

    const MAX_ATTEMPTS = 8;
    const RETRY_DELAY_MS = 3000;
    const ATTEMPT_TIMEOUT_MS = 5000; // fail fast per attempt; retry handles the rest

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (socketRef.current?.connected) return; // another attempt may have won
      setIsConnecting(true);
      setError(null);
      resetTransports();
      deviceRef.current = null;

      try {
        const socketHost = window.location.hostname;
        const url = process.env.NEXT_PUBLIC_SOCKET_URL || `${window.location.protocol}//${socketHost}:3001`;
        console.log(`[ConnectDesk] Connecting (attempt ${attempt}/${MAX_ATTEMPTS}):`, url);

        const socket = io(url, {
          path: '/socket.io',
          transports: ['polling', 'websocket'],
          reconnection: false,
          timeout: ATTEMPT_TIMEOUT_MS,
          forceNew: true,
        });
        socketRef.current = socket;

        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            socket.disconnect();
            reject(new Error('RETRY')); // signal to retry, not a fatal error
          }, ATTEMPT_TIMEOUT_MS + 1000);
          socket.on('connect', () => { clearTimeout(t); resolve(); });
          socket.on('connect_error', (err) => {
            clearTimeout(t);
            socket.disconnect();
            // ECONNREFUSED = server not up yet → retry silently
            const isTransient = err.message.includes('ECONNREFUSED')
              || err.message.includes('xhr poll error')
              || err.message.includes('transport error')
              || err.message.includes('timeout');
            reject(new Error(isTransient ? 'RETRY' : err.message));
          });
        });

        // ── Connected successfully — run setup ──
        console.log('[ConnectDesk] Socket connected:', socket.id);

        const joinData = await emitAsync('join-room', {
          sessionId: sessionIdRef.current, userId: userIdRef.current,
          name: userNameRef.current, role: userRoleRef.current,
        });
        console.log('[ConnectDesk] Joined | existing peers:', joinData.existingPeers?.length ?? 0);

        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });
        deviceRef.current = device;

        await createRecvTransport();

        const existingPeers: PeerInfo[] = joinData.existingPeers || [];
        peersRef.current = existingPeers;
        setPeers(existingPeers);
        for (const peer of existingPeers) {
          if (peer.producers && peer.producers.length > 0) {
            for (const prod of peer.producers) await consumeProducer(prod.id, peer.socketId, peer.name, peer.role);
          }
        }

        registerSocketEvents(socket);
        setIsConnected(true);
        setIsConnecting(false);
        setSupportMode('chat');
        return; // ✅ success — exit the retry loop

      } catch (err: any) {
        socketRef.current?.disconnect();
        socketRef.current = null;

        if (err.message === 'RETRY' && attempt < MAX_ATTEMPTS) {
          console.log(`[ConnectDesk] SFU not ready yet — retrying in ${RETRY_DELAY_MS / 1000}s (${attempt}/${MAX_ATTEMPTS})`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }

        // Out of retries or non-transient error
        const socketHost = window.location.hostname;
        const url = process.env.NEXT_PUBLIC_SOCKET_URL || `${window.location.protocol}//${socketHost}:3001`;
        const msg = err.message === 'RETRY'
          ? `Could not reach SFU after ${MAX_ATTEMPTS} attempts.\n- Is npm run dev:all running?\n- On mobile? Run open-firewall-ports.ps1 as Administrator.\n- SFU URL: ${url}`
          : err.message;
        console.error('[ConnectDesk] Connect failed:', msg);
        setError(msg);
        break;
      }
    }

    setIsConnecting(false);
  }, [emitAsync, createRecvTransport, consumeProducer, registerSocketEvents, resetTransports]);


  // --------------------------------------------------------------------------
  // startVoice()
  // --------------------------------------------------------------------------

  const startVoice = useCallback(async () => {
    if (!deviceRef.current || !socketRef.current?.connected) {
      setMediaWarning('Not connected. Please wait or refresh the page.');
      return;
    }
    if (isStartingMediaRef.current) {
      console.log('[ConnectDesk] startVoice: already starting media, ignoring duplicate call');
      return;
    }
    isStartingMediaRef.current = true;
    setMediaWarning(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Strong echo cancellation constraints for all browsers + mobile Chrome
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Mobile Chrome/Android extended constraints
          // @ts-ignore
          googEchoCancellation: true,
          // @ts-ignore
          googNoiseSuppression: true,
          // @ts-ignore
          googAutoGainControl: true,
          // @ts-ignore
          googHighpassFilter: true,
          // @ts-ignore
          googEchoCancellation2: true,
          // @ts-ignore
          googNoiseSuppression2: true,
        },
        video: false,
      });
    } catch (err: any) {
      setMediaWarning(
        err.name === 'NotAllowedError'  ? 'Microphone permission denied.' :
        err.name === 'NotFoundError'    ? 'No microphone found.' :
        err.name === 'NotReadableError' ? 'Microphone is in use by another app.' :
                                          'Could not access microphone.'
      );
      return;
    }
    if (localStreamRef.current) stream.getAudioTracks().forEach((tk) => localStreamRef.current!.addTrack(tk));
    else { localStreamRef.current = stream; setLocalStream(stream); }
    try {
      const st = await getOrCreateSendTransport();
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
      setMediaWarning('Failed to start voice: ' + e.message);
    } finally {
      isStartingMediaRef.current = false;
    }
  }, [getOrCreateSendTransport]);

  // --------------------------------------------------------------------------
  // startVideo()
  // --------------------------------------------------------------------------

  const startVideo = useCallback(async (facing: 'user' | 'environment' = 'user') => {
    if (!deviceRef.current || !socketRef.current?.connected) {
      setMediaWarning('Not connected. Please wait or refresh the page.');
      return;
    }
    if (isStartingMediaRef.current) {
      console.log('[ConnectDesk] startVideo: already starting media, ignoring duplicate call');
      return;
    }
    isStartingMediaRef.current = true;
    setMediaWarning(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Strong echo cancellation constraints for all browsers + mobile Chrome
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // @ts-ignore
          googEchoCancellation: true,
          // @ts-ignore
          googNoiseSuppression: true,
          // @ts-ignore
          googAutoGainControl: true,
          // @ts-ignore
          googHighpassFilter: true,
          // @ts-ignore
          googEchoCancellation2: true,
          // @ts-ignore
          googNoiseSuppression2: true,
        },
        video: {
          width: { ideal: 1280 }, height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: facing,
        },
      });
    } catch (err: any) {
      setMediaWarning(
        err.name === 'NotAllowedError'  ? 'Camera/mic permission denied.' :
        err.name === 'NotFoundError'    ? 'No camera found.' :
        err.name === 'NotReadableError' ? 'Camera is in use by another app.' :
                                          'Could not access camera.'
      );
      return;
    }

    // Stop old tracks
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach((tk) => tk.stop());
    localStreamRef.current = stream;
    setLocalStream(new MediaStream(stream.getTracks())); // new object to force useEffect re-run

    try {
      const st = await getOrCreateSendTransport();

      // Close old producers before creating new ones
      if (audioProducerRef.current) { try { audioProducerRef.current.close(); } catch {} audioProducerRef.current = null; }
      if (videoProducerRef.current) { try { videoProducerRef.current.close(); } catch {} videoProducerRef.current = null; }

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioProducerRef.current = await st.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
        console.log('[ConnectDesk] Audio producer:', audioProducerRef.current.id);
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoProducerRef.current = await st.produce({
          track: videoTrack, appData: { mediaType: 'video' },
          encodings: [{ maxBitrate: 100000 }, { maxBitrate: 300000 }, { maxBitrate: 900000 }],
          codecOptions: { videoGoogleStartBitrate: 1000 },
        });
        console.log('[ConnectDesk] Video producer:', videoProducerRef.current.id);
      }
      setFacingMode(facing);
      setIsAudioEnabled(true); setIsVideoEnabled(true); setSupportMode('video');
      socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: true });
      socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'video', enabled: true });
    } catch (e: any) {
      console.error('[ConnectDesk] startVideo error:', e);
      setMediaWarning('Failed to start video: ' + e.message);
    } finally {
      isStartingMediaRef.current = false;
    }
  }, [getOrCreateSendTransport]);

  // --------------------------------------------------------------------------
  // switchCamera() - swap front/back camera without re-negotiating
  // --------------------------------------------------------------------------

  const switchCamera = useCallback(async () => {
    if (supportMode !== 'video' || !videoProducerRef.current) return;
    const newFacing: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      // Replace track on existing producer (no new negotiation needed)
      await videoProducerRef.current.replaceTrack({ track: newVideoTrack });

      // Update local stream
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((tk) => { tk.stop(); localStreamRef.current!.removeTrack(tk); });
        localStreamRef.current.addTrack(newVideoTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }
      setFacingMode(newFacing);
      console.log('[ConnectDesk] Camera switched to:', newFacing);
    } catch (e: any) {
      console.error('[ConnectDesk] switchCamera error:', e);
      setMediaWarning('Could not switch camera: ' + e.message);
    }
  }, [facingMode, supportMode]);

  // --------------------------------------------------------------------------
  // Controls
  // --------------------------------------------------------------------------

  const stopMedia = useCallback(() => {
    try { audioProducerRef.current?.close(); } catch {} audioProducerRef.current = null;
    try { videoProducerRef.current?.close(); } catch {} videoProducerRef.current = null;
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((tk) => tk.stop()); localStreamRef.current = null; }
    setLocalStream(null); setIsAudioEnabled(false); setIsVideoEnabled(false); setSupportMode('chat');
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: false });
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'video', enabled: false });
  }, []);

  const toggleAudio = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0]; if (!track) return;
    track.enabled = !track.enabled; setIsAudioEnabled(track.enabled);
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'audio', enabled: track.enabled });
  }, []);

  const toggleVideo = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0]; if (!track) return;
    track.enabled = !track.enabled; setIsVideoEnabled(track.enabled);
    socketRef.current?.emit('media-state-change', { sessionId: sessionIdRef.current, kind: 'video', enabled: track.enabled });
  }, []);

  const requestCustomerVideo = useCallback(() => {
    if (!socketRef.current?.connected) return;
    setVideoRequestPending(true);
    socketRef.current.emit('request-customer-video', { sessionId: sessionIdRef.current });
  }, []);

  const respondToVideoRequest = useCallback(async (accepted: boolean) => {
    setIncomingVideoRequest(false);
    socketRef.current?.emit('video-request-response', { sessionId: sessionIdRef.current, accepted });
    if (accepted) await startVideo('user');
  }, [startVideo]);

  const sendMessage = useCallback(async (content: string, type: 'TEXT' | 'FILE' = 'TEXT', fileUrl?: string, fileName?: string, fileSize?: number) => {
    const sid = sessionIdRef.current;
    const msg: ChatMsg = {
      id: crypto.randomUUID(), senderId: userIdRef.current, senderName: userNameRef.current,
      senderRole: userRoleRef.current, content, type, fileUrl, fileName, fileSize,
      createdAt: new Date().toISOString(),
    };
    setChatMessages((p) => [...p, msg]);
    socketRef.current?.emit('chat-message', { sessionId: sid, message: msg });
    try { await fetch(`/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, type, fileUrl, fileName, fileSize }) }); }
    catch (e) { console.error('Failed to persist message:', e); }
  }, []);

  const endSession = useCallback(async () => {
    socketRef.current?.emit('end-session', { sessionId: sessionIdRef.current });
    try { await fetch(`/api/sessions/${sessionIdRef.current}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ENDED' }) }); }
    catch (e) { console.error('Failed to end session:', e); }
  }, []);

  const disconnect = useCallback(() => {
    stopMedia(); resetTransports();
    socketRef.current?.disconnect(); socketRef.current = null; deviceRef.current = null;
    setIsConnected(false); setRemoteStreams(new Map()); setPeers([]); setSupportMode('chat');
  }, [stopMedia, resetTransports]);

  const clearError        = useCallback(() => setError(null), []);
  const clearMediaWarning = useCallback(() => setMediaWarning(null), []);

  useEffect(() => {
    return () => {
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((tk) => tk.stop());
      try { sendTransportRef.current?.close(); } catch {}
      try { recvTransportRef.current?.close(); } catch {}
      consumersRef.current.forEach((c) => { try { c.close(); } catch {} });
      socketRef.current?.disconnect();
    };
  }, []);

  return {
    connect, disconnect, isConnected, isConnecting, error, clearError,
    localStream, remoteStreams,
    supportMode, startVoice, startVideo, stopMedia, mediaWarning, clearMediaWarning,
    isAudioEnabled, isVideoEnabled, toggleAudio, toggleVideo,
    facingMode, switchCamera,
    requestCustomerVideo, respondToVideoRequest, incomingVideoRequest, videoRequestPending,
    chatMessages, setChatMessages, sendMessage, endSession, peers,
  };
}