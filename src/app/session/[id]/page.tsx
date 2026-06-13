'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMediasoup } from '@/hooks/useMediasoup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Paperclip, X, Mic, MicOff, Video, VideoOff,
  PhoneOff, MessageSquare, PhoneCall,
} from 'lucide-react';

type RecordingStatus = 'idle' | 'recording' | 'processing' | 'ready' | 'failed';

export default function SessionPage() {
  const router    = useRouter();
  const params    = useParams();
  const sessionId = params.id as string;
  const { user, loading } = useAuth();

  const [sessionInfo,   setSessionInfo]   = useState<any>(null);
  const [chatOpen,      setChatOpen]      = useState(true);
  const [messageInput,  setMessageInput]  = useState('');
  const [callEnded,     setCallEnded]     = useState(false);
  const [callDuration,  setCallDuration]  = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const [networkHost,   setNetworkHost]   = useState('');
  const [socketStatus,  setSocketStatus]  = useState<'connecting'|'connected'|'disconnected'|'failed'>('connecting');

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const chatEndRef      = useRef<HTMLDivElement>(null);
  const timerRef        = useRef<NodeJS.Timeout | null>(null);

  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [recordingUrl,    setRecordingUrl]    = useState<string | null>(null);
  const mediaRecorderRef    = useRef<MediaRecorder | null>(null);
  const recordingChunksRef  = useRef<Blob[]>([]);
  const recordingStartedRef = useRef(false);

  const {
    connect, disconnect,
    isConnected, isConnecting, error, clearError,
    localStream, remoteStreams,
    supportMode, startVoice, startVideo, stopMedia, mediaWarning, clearMediaWarning,
    isAudioEnabled, isVideoEnabled, toggleAudio, toggleVideo,
    facingMode, switchCamera,
    requestCustomerVideo, respondToVideoRequest, incomingVideoRequest, videoRequestPending,
    chatMessages, setChatMessages, sendMessage,
    endSession, peers,
  } = useMediasoup({
    sessionId,
    userId:   user?.userId || '',
    userName: user?.name   || '',
    userRole: user?.role   || '',
    onSessionEnded: () => setCallEnded(true),
  });

  const isAgent = user?.role === 'AGENT' || user?.role === 'ADMIN';

  useEffect(() => {
    if (typeof window !== 'undefined') setNetworkHost(window.location.hostname);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (!loading && user) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  // Sync socket status indicator
  useEffect(() => {
    if (isConnecting)     setSocketStatus('connecting');
    else if (isConnected) setSocketStatus('connected');
    else if (error)       setSocketStatus('failed');
    else                  setSocketStatus('disconnected');
  }, [isConnecting, isConnected, error]);

  // Fetch session info + history
  useEffect(() => {
    if (loading || !user) return;
    (async () => {
      try {
        const res  = await fetch('/api/sessions/' + sessionId);
        const data = await res.json();
        if (data.session) {
          setSessionInfo(data.session);
          if (data.session.messages) {
            setChatMessages(data.session.messages.map((m: any) => ({
              id: m.id, senderId: m.sender.id, senderName: m.sender.name,
              senderRole: m.sender.role, content: m.content, type: m.type,
              fileUrl: m.fileUrl, fileName: m.fileName, createdAt: m.createdAt,
            })));
          }
        }
      } catch (e) { console.error('Failed to fetch session:', e); }
    })();
  }, [loading, user, sessionId]);

  const attachStream = useCallback((el: HTMLVideoElement, stream: MediaStream) => {
    if (el.srcObject !== stream) el.srcObject = stream;
    if (el.paused) el.play().catch(() => {});
  }, []);

  // Attach local stream - retry with timeouts since React may not have mounted video yet
  useEffect(() => {
    if (!localStream) return;
    const tryAttach = () => { if (localVideoRef.current) attachStream(localVideoRef.current, localStream); };
    tryAttach();
    const t1 = setTimeout(tryAttach, 150);
    const t2 = setTimeout(tryAttach, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [localStream, attachStream]);

  // Attach remote streams
  useEffect(() => {
    remoteStreams.forEach((remote, peerId) => {
      const el = remoteVideoRefs.current.get(peerId);
      if (el) attachStream(el, remote.stream);
    });
  }, [remoteStreams, attachStream]);

  // Session timer
  useEffect(() => {
    if (isConnected && !callEnded) {
      timerRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isConnected, callEnded]);

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Auto-start recording when remote video appears (agent only)
  const hasRemoteParticipant = remoteStreams.size > 0;
  useEffect(() => {
    if (!isAgent || !isConnected || !hasRemoteParticipant || recordingStartedRef.current) return;
    const [, remoteEntry] = Array.from(remoteStreams.entries())[0] || [];
    if (!remoteEntry?.stream?.getVideoTracks().length) return;
    try {
      recordingStartedRef.current = true;
      setRecordingStatus('recording');
      recordingChunksRef.current = [];
      const mimeType =
        MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' :
        MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
      const recorder = new MediaRecorder(remoteEntry.stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        setRecordingStatus('processing');
        try {
          const chunks = recordingChunksRef.current;
          if (!chunks.length || chunks.reduce((s, c) => s + c.size, 0) < 1024) { setRecordingStatus('idle'); return; }
          const blob = new Blob(chunks, { type: mimeType });
          const fd = new FormData();
          fd.append('file', blob, 'recording-' + sessionId + '.webm');
          const res  = await fetch('/api/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          await fetch('/api/recordings/' + sessionId, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'READY', fileUrl: data.url }),
          });
          setRecordingUrl(data.url); setRecordingStatus('ready');
        } catch (e) { console.error('Recording upload failed:', e); setRecordingStatus('failed'); }
      };
      recorder.start(5000);
      mediaRecorderRef.current = recorder;
      fetch('/api/recordings/' + sessionId, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RECORDING' }),
      }).catch(() => {});
    } catch (e) { console.error('Recording start failed:', e); setRecordingStatus('failed'); }
  }, [isAgent, isConnected, hasRemoteParticipant]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
  }, []);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
    return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  };

  const handleSendMessage = () => { if (!messageInput.trim()) return; sendMessage(messageInput.trim()); setMessageInput(''); };

  const handleEndCall = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopRecording(); await endSession(); disconnect(); setCallEnded(true);
  };

  const handleLeaveCall = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopRecording(); disconnect();
    router.push(isAgent ? '/agent' : '/customer');
  };

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = ''; setUploadError(null); setUploadingFile(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res  = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await sendMessage(file.name, 'FILE', data.url, file.name, file.size);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
      setTimeout(() => setUploadError(null), 5000);
    } finally { setUploadingFile(false); }
  }, [sendMessage]);

  const setRemoteVideoRef = useCallback((peerId: string) => (el: HTMLVideoElement | null) => {
    if (el) {
      remoteVideoRefs.current.set(peerId, el);
      const r = remoteStreams.get(peerId);
      if (r) attachStream(el, r.stream);
    } else { remoteVideoRefs.current.delete(peerId); }
  }, [remoteStreams, attachStream]);

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  // ─── Session ended ────────────────────────────────────────────────────────
  if (callEnded) return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="text-center space-y-6 max-w-md w-full">
        <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-emerald-400">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Session Ended</h2>
          <p className="text-muted-foreground mt-2">{sessionInfo?.title}<br/>Duration: {formatTime(callDuration)}</p>
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="outline" onClick={() => router.push('/history/' + sessionId)}>View History</Button>
          <Button onClick={() => router.push(isAgent ? '/agent' : '/customer')}>Back to Dashboard</Button>
        </div>
      </div>
    </div>
  );

  // ─── Derived ──────────────────────────────────────────────────────────────
  const remoteStreamEntries = Array.from(remoteStreams.entries());
  const hasRemote = remoteStreamEntries.length > 0;
  const modeLabel = supportMode === 'chat' ? 'Chat' : supportMode === 'voice' ? 'Voice' : 'Video';
  const modeBg =
    supportMode === 'chat'  ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
    supportMode === 'voice' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                              'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  return (
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden">

      {/* TOP BAR */}
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0 z-40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <MessageSquare size={14} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate max-w-[130px] sm:max-w-[200px] md:max-w-xs">
              {sessionInfo?.title || 'Support Session'}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {socketStatus === 'connecting'   && <><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" /><span>Connecting</span></>}
              {socketStatus === 'connected'    && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" /><span className="text-emerald-500 font-semibold">Live</span></>}
              {socketStatus === 'disconnected' && <><span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" /><span className="text-zinc-400">Offline</span></>}
              {socketStatus === 'failed'       && <><span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" /><span className="text-red-400">Failed</span></>}
              {isConnected && <><span className="opacity-30">|</span><span>{formatTime(callDuration)}</span></>}
              <span className="opacity-30">|</span><span>{peers.length + 1}p</span>
              {networkHost && process.env.NODE_ENV !== 'production' && (
                <><span className="opacity-30">|</span><span className="font-mono opacity-50 hidden sm:inline">{networkHost}</span></>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium border ' + modeBg}>{modeLabel}</span>
          <ThemeToggle />
          <button onClick={() => setChatOpen((o) => !o)}
            className={'p-1.5 rounded-lg transition-colors ' + (chatOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}
            title="Toggle chat">
            <MessageSquare size={16} />
          </button>
        </div>
      </header>

      {/* MEDIA WARNING */}
      {mediaWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 flex items-center justify-between text-xs text-amber-400 shrink-0">
          <span className="truncate">{mediaWarning}</span>
          <button className="ml-2 shrink-0 p-1 rounded" onClick={clearMediaWarning}><X size={12} /></button>
        </div>
      )}

      {/* BODY */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* VIDEO COLUMN */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Video area */}
          <div className="flex-1 relative overflow-hidden min-h-0 bg-zinc-950">

            {isConnecting && !isConnected && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950">
                <div className="animate-spin rounded-full h-9 w-9 border-b-2 border-primary mb-3" />
                <p className="text-sm text-muted-foreground font-medium">Joining session...</p>
                <p className="text-[11px] text-muted-foreground/50 mt-1">{networkHost || 'server'}:3001</p>
              </div>
            )}

            {hasRemote ? (
              <div className="absolute inset-0 flex">
                {remoteStreamEntries.map(([peerId, remote]) => (
                  <div key={peerId} className="relative flex-1 bg-zinc-900">
                    <video ref={setRemoteVideoRef(peerId)} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                      <span className="text-xs bg-black/70 backdrop-blur-sm text-white px-2 py-0.5 rounded-full font-medium">{remote.peerName}</span>
                      {!remote.audioEnabled && <span className="text-xs bg-red-600/80 text-white px-1.5 py-0.5 rounded-full">muted</span>}
                    </div>
                    {supportMode !== 'video' && isConnected && (
                      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
                        {supportMode === 'chat' && isAgent && (
                          <button onClick={startVoice}
                            className="text-xs bg-black/60 hover:bg-amber-500/80 text-white px-2.5 py-1 rounded-full backdrop-blur-sm transition-colors flex items-center gap-1">
                            <PhoneCall size={11} /> Voice
                          </button>
                        )}
                        {isAgent && (
                          <button onClick={requestCustomerVideo} disabled={videoRequestPending}
                            className="text-xs bg-black/60 hover:bg-emerald-500/80 text-white px-2.5 py-1 rounded-full backdrop-blur-sm transition-colors flex items-center gap-1 disabled:opacity-50">
                            <Video size={11} />{videoRequestPending ? 'Waiting...' : 'Req. Cam'}
                          </button>
                        )}
                        {!isAgent && supportMode === 'voice' && (
                          <button onClick={() => startVideo('user')}
                            className="text-xs bg-black/60 hover:bg-emerald-500/80 text-white px-2.5 py-1 rounded-full backdrop-blur-sm transition-colors flex items-center gap-1">
                            <Video size={11} /> Camera
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {isConnected ? (
                  <div className="text-center px-6 max-w-xs w-full">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <MessageSquare size={28} className="text-primary" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Session Active</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                      {peers.length === 0 ? 'Waiting for the other participant...' : 'Chat ready. Escalate to voice or video below.'}
                    </p>
                    <div className="flex flex-col gap-2">
                      {isAgent && supportMode === 'chat' && (
                        <button onClick={startVoice}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-amber-500/40 text-amber-400 bg-amber-500/5 hover:bg-amber-500/15 transition-colors text-sm font-medium">
                          <PhoneCall size={16} /> Start Voice Support
                        </button>
                      )}
                      {isAgent && supportMode !== 'video' && (
                        <button onClick={requestCustomerVideo} disabled={videoRequestPending}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/40 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors text-sm font-medium disabled:opacity-50">
                          <Video size={16} />{videoRequestPending ? 'Waiting for customer...' : 'Request Customer Camera'}
                        </button>
                      )}
                      {!isAgent && supportMode !== 'video' && (
                        <button onClick={() => startVideo('user')}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/40 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors text-sm font-medium">
                          <Video size={16} /> Enable My Camera
                        </button>
                      )}
                    </div>
                  </div>
                ) : !isConnecting && (
                  <p className="text-sm text-muted-foreground">Not connected</p>
                )}
              </div>
            )}

            {/* Self-view PiP - always show when in voice/video mode */}
            {supportMode !== 'chat' && (
              <div className="absolute bottom-16 right-2 md:bottom-20 md:right-3 w-24 h-[4.5rem] md:w-32 md:h-24 rounded-xl overflow-hidden shadow-xl border border-border z-10 bg-zinc-900">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {supportMode === 'voice' && (
                  <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
                    <Mic size={18} className="text-amber-400" />
                  </div>
                )}
                {supportMode === 'video' && !isVideoEnabled && (
                  <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
                    <VideoOff size={18} className="text-muted-foreground" />
                  </div>
                )}
                <span className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white px-1.5 rounded-full">You</span>
                {/* Camera flip button - customer, video mode, camera on */}
                {!isAgent && supportMode === 'video' && isVideoEnabled && (
                  <button onClick={switchCamera}
                    title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center text-white transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Recording bar (agent only) */}
          {isAgent && recordingStatus !== 'idle' && (
            <div className={'flex items-center gap-2 px-3 py-1.5 text-xs border-t shrink-0 ' + (
              recordingStatus === 'recording'  ? 'bg-red-500/8 border-red-500/20 text-red-400' :
              recordingStatus === 'processing' ? 'bg-amber-500/8 border-amber-500/20 text-amber-400' :
              recordingStatus === 'ready'      ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400' :
                                                 'bg-zinc-500/8 border-zinc-500/20 text-zinc-400'
            )}>
              {recordingStatus === 'recording' && (
                <><span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span><span className="font-medium">Recording</span><span className="ml-auto opacity-60 text-[10px]">Customer only</span></>
              )}
              {recordingStatus === 'processing' && <><div className="animate-spin rounded-full h-3 w-3 border-b border-current shrink-0" /><span>Processing...</span></>}
              {recordingStatus === 'ready' && (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                <span>Recording ready</span>
                {recordingUrl && <a href={recordingUrl} download target="_blank" rel="noopener noreferrer" className="ml-auto underline text-[10px]">Download</a>}</>
              )}
              {recordingStatus === 'failed' && <><X size={12} className="shrink-0" /><span>Recording failed</span></>}
            </div>
          )}

          {/* CONTROLS BAR */}
          <div className="flex items-center justify-center gap-2 py-3 px-4 bg-card border-t border-border shrink-0">
            {/* Mute - both in voice/video */}
            {supportMode !== 'chat' && (
              <button onClick={toggleAudio} title={isAudioEnabled ? 'Mute' : 'Unmute'}
                className={'w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-md ' + (isAudioEnabled ? 'bg-secondary text-secondary-foreground' : 'bg-red-600 text-white')}>
                {isAudioEnabled ? <Mic size={18} /> : <MicOff size={18} />}
              </button>
            )}
            {/* Camera toggle - both in video */}
            {supportMode === 'video' && (
              <button onClick={toggleVideo} title={isVideoEnabled ? 'Camera off' : 'Camera on'}
                className={'w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-md ' + (isVideoEnabled ? 'bg-secondary text-secondary-foreground' : 'bg-red-600 text-white')}>
                {isVideoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
            )}
            {/* Camera flip - customer, video, camera on */}
            {!isAgent && supportMode === 'video' && isVideoEnabled && (
              <button onClick={switchCamera} title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80 transition-all active:scale-95 shadow-md">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                  <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                </svg>
              </button>
            )}
            {/* Stop media */}
            {supportMode !== 'chat' && (
              <button onClick={stopMedia} title="Stop audio/video"
                className="w-11 h-11 rounded-full flex items-center justify-center bg-muted text-muted-foreground transition-all active:scale-95 hover:bg-muted/80 shadow-md">
                <MicOff size={16} />
              </button>
            )}
            {/* Start voice - agent, chat mode */}
            {isAgent && isConnected && supportMode === 'chat' && (
              <button onClick={startVoice} title="Start Voice Support"
                className="w-11 h-11 rounded-full flex items-center justify-center bg-amber-500/15 border border-amber-500/40 text-amber-400 transition-all active:scale-95 hover:bg-amber-500/25 shadow-md">
                <PhoneCall size={18} />
              </button>
            )}
            {/* End - agent only */}
            {isAgent && (
              <button onClick={handleEndCall} title="End Session"
                className="w-14 h-11 rounded-full flex items-center justify-center bg-red-600 hover:bg-red-700 text-white shadow-lg transition-all active:scale-95">
                <PhoneOff size={18} />
              </button>
            )}
            {/* Leave - customer only (subtle) */}
            {!isAgent && (
              <button onClick={handleLeaveCall} title="Leave session"
                className="px-4 h-9 rounded-full flex items-center justify-center gap-1.5 bg-muted text-muted-foreground hover:bg-muted/80 transition-all active:scale-95 text-xs font-medium shadow-md">
                <PhoneOff size={14} /> Leave
              </button>
            )}
          </div>
        </div>

        {/* CHAT PANEL */}
        {chatOpen && (
          <aside className="w-72 sm:w-80 flex flex-col border-l border-border bg-card shrink-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Chat</span>
                <span className={'text-[10px] px-1.5 py-0.5 rounded-full border font-medium ' + modeBg}>{modeLabel}</span>
                {chatMessages.length > 0 && (
                  <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{chatMessages.length}</span>
                )}
              </div>
              <button className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" onClick={() => setChatOpen(false)}>
                <X size={14} />
              </button>
            </div>

            {/* Messages - native scrollable div */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="p-3 space-y-3">
                {chatMessages.length === 0 ? (
                  <div className="text-center py-10 text-xs text-muted-foreground">
                    <MessageSquare size={28} className="mx-auto mb-2 opacity-20" />
                    <p>No messages yet</p>
                    <p className="opacity-60 mt-0.5">Start the conversation</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe  = msg.senderId === user?.userId;
                    const isImg = msg.fileUrl && /\.(jpe?g|png|gif|webp)$/i.test(msg.fileUrl);
                    const isPdf = msg.fileUrl && (msg.fileUrl.includes('.pdf') || (msg.type === 'FILE' && msg.fileName?.endsWith('.pdf')));
                    return (
                      <div key={msg.id} className={'flex flex-col ' + (isMe ? 'items-end' : 'items-start')}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[10px] font-medium text-muted-foreground">{isMe ? 'You' : msg.senderName}</span>
                          <span className={'text-[9px] px-1 rounded font-medium ' + (msg.senderRole === 'AGENT' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400')}>
                            {msg.senderRole}
                          </span>
                        </div>
                        <div className={'rounded-2xl overflow-hidden text-sm max-w-[90%] ' + (isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm')}>
                          {msg.type === 'FILE' && msg.fileUrl ? (
                            isImg ? (
                              <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                                <img src={msg.fileUrl} alt={msg.fileName || 'Image'}
                                  className="max-w-full object-cover max-h-44 w-full block"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              </a>
                            ) : (
                              <a href={isPdf ? 'https://docs.google.com/viewer?url=' + encodeURIComponent(msg.fileUrl) : msg.fileUrl}
                                target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-2 px-3 py-2.5">
                                <span className="text-base">{isPdf ? '\uD83D\uDCC4' : '\uD83D\uDCCE'}</span>
                                <span className="text-xs underline truncate max-w-[140px]">{msg.fileName || 'File'}</span>
                              </a>
                            )
                          ) : (
                            <div className="px-3 py-2 break-words leading-relaxed">{msg.content}</div>
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground mt-0.5">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            {uploadError && (
              <div className="mx-2 mb-1 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between shrink-0">
                <span className="truncate">{uploadError}</span>
                <button className="ml-2 shrink-0" onClick={() => setUploadError(null)}><X size={10} /></button>
              </div>
            )}

            <div className="p-2 border-t border-border shrink-0 bg-card">
              <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
              <div className="flex items-center gap-1.5">
                <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile || !isConnected}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 shrink-0" title="Attach file">
                  {uploadingFile ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /> : <Paperclip size={15} />}
                </button>
                <Input
                  placeholder={isConnected ? 'Message...' : 'Connecting...'}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  disabled={!isConnected}
                  className="flex-1 h-8 text-sm rounded-lg px-3"
                />
                <button onClick={handleSendMessage} disabled={!messageInput.trim() || !isConnected}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40 transition-all active:scale-95 shrink-0" title="Send">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* CONNECTION ERROR MODAL */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <X size={20} className="text-red-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Connection Error</h3>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{error}</p>
                  {networkHost && process.env.NODE_ENV !== 'production' && (
                    <p className="text-[10px] text-muted-foreground/50 mt-1.5 font-mono">Tried: {networkHost}:3001</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => { clearError(); connect(); }}>Retry</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { clearError(); router.push(isAgent ? '/agent' : '/customer'); }}>Go Back</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INCOMING VIDEO REQUEST */}
      {incomingVideoRequest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Video size={20} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Camera Requested</h3>
                  <p className="text-xs text-muted-foreground">from your Support Agent</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Your support agent needs your camera for visual troubleshooting.
              </p>
              <div className="flex gap-2">
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-10" onClick={() => respondToVideoRequest(true)}>
                  <Video size={15} className="mr-1.5" /> Allow
                </Button>
                <Button variant="outline" className="flex-1 h-10" onClick={() => respondToVideoRequest(false)}>Decline</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}