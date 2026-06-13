'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMediasoup } from '@/hooks/useMediasoup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThemeToggle } from '@/components/theme-toggle';
import { Paperclip, X, Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, PhoneCall } from 'lucide-react';

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

  const [networkHost,    setNetworkHost]    = useState<string>('');
  const [socketStatus,   setSocketStatus]   = useState<'connecting' | 'connected' | 'disconnected' | 'failed'>('connecting');

  const fileInputRef     = useRef<HTMLInputElement>(null);
  const localVideoRef    = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs  = useRef<Map<string, HTMLVideoElement>>(new Map());
  const chatEndRef       = useRef<HTMLDivElement>(null);
  const timerRef         = useRef<NodeJS.Timeout | null>(null);

  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [recordingUrl,    setRecordingUrl]    = useState<string | null>(null);
  const mediaRecorderRef     = useRef<MediaRecorder | null>(null);
  const recordingChunksRef   = useRef<Blob[]>([]);
  const recordingStartedRef  = useRef(false);

  const {
    connect, disconnect,
    isConnected, isConnecting, error, clearError,
    localStream, remoteStreams,
    supportMode, startVoice, startVideo, stopMedia, mediaWarning, clearMediaWarning,
    isAudioEnabled, isVideoEnabled, toggleAudio, toggleVideo,
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

  // Capture hostname for display in dev mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNetworkHost(window.location.hostname);
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    connect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  // Keep socketStatus in sync with connection state
  useEffect(() => {
    if (isConnecting) setSocketStatus('connecting');
    else if (isConnected) setSocketStatus('connected');
    else if (error) setSocketStatus('failed');
    else setSocketStatus('disconnected');
  }, [isConnecting, isConnected, error]);

  useEffect(() => {
    if (loading || !user) return;
    const fetchSession = async () => {
      try {
        const res  = await fetch(`/api/sessions/${sessionId}`);
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
      } catch (err) { console.error('Failed to fetch session:', err); }
    };
    fetchSession();
  }, [loading, user, sessionId, setChatMessages]);

  const attachStream = useCallback((el: HTMLVideoElement, stream: MediaStream) => {
    if (el.srcObject !== stream) el.srcObject = stream;
    if (el.paused) el.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (!localStream) return;
    const el = localVideoRef.current;
    if (el) { attachStream(el, localStream); }
    else {
      const t = setTimeout(() => { if (localVideoRef.current) attachStream(localVideoRef.current, localStream); }, 100);
      return () => clearTimeout(t);
    }
  }, [localStream, attachStream]);

  useEffect(() => {
    remoteStreams.forEach((remote, peerId) => {
      const el = remoteVideoRefs.current.get(peerId);
      if (el) { attachStream(el, remote.stream); }
      else {
        const t = setTimeout(() => { const el2 = remoteVideoRefs.current.get(peerId); if (el2) attachStream(el2, remote.stream); }, 150);
        return () => clearTimeout(t);
      }
    });
  }, [remoteStreams, attachStream]);

  useEffect(() => {
    if (isConnected && !callEnded) {
      timerRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isConnected, callEnded]);

  const hasRemoteParticipant = remoteStreams.size > 0;
  useEffect(() => {
    if (!isAgent || !isConnected || !hasRemoteParticipant || recordingStartedRef.current) return;
    const [, remoteEntry] = Array.from(remoteStreams.entries())[0] || [];
    if (!remoteEntry?.stream?.getTracks().length) return;
    try {
      recordingStartedRef.current = true;
      setRecordingStatus('recording');
      recordingChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
      const recorder = new MediaRecorder(remoteEntry.stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        setRecordingStatus('processing');
        try {
          const chunks = recordingChunksRef.current;
          if (chunks.length === 0) {
            // No data was collected — session was too short or stream had no video
            console.warn('[Recording] No chunks collected — skipping upload');
            setRecordingStatus('idle');
            return;
          }
          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size < 1024) {
            // Blob is effectively empty (< 1KB)
            console.warn('[Recording] Blob too small (', blob.size, 'bytes) — skipping upload');
            setRecordingStatus('idle');
            return;
          }
          const fd   = new FormData(); fd.append('file', blob, `recording-${sessionId}.webm`);
          const res  = await fetch('/api/upload', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          await fetch(`/api/recordings/${sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'READY', fileUrl: data.url }) });
          setRecordingUrl(data.url); setRecordingStatus('ready');
        } catch (e) { console.error('Recording upload failed:', e); setRecordingStatus('failed'); }
      };
      recorder.start(5000); mediaRecorderRef.current = recorder;
      fetch(`/api/recordings/${sessionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RECORDING' }) }).catch(() => {});
    } catch (e) { console.error('Recording failed:', e); setRecordingStatus('failed'); recordingStartedRef.current = false; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, hasRemoteParticipant, isAgent]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { mediaRecorderRef.current.stop(); mediaRecorderRef.current = null; }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
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
    } catch (err: any) { setUploadError(err.message || 'Upload failed'); setTimeout(() => setUploadError(null), 5000); }
    finally { setUploadingFile(false); }
  }, [sendMessage]);

  const setRemoteVideoRef = useCallback((peerId: string) => (el: HTMLVideoElement | null) => {
    if (el) { remoteVideoRefs.current.set(peerId, el); const r = remoteStreams.get(peerId); if (r) attachStream(el, r.stream); }
    else { remoteVideoRefs.current.delete(peerId); }
  }, [remoteStreams, attachStream]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  if (callEnded) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
        </div>
        <div><h2 className="text-2xl font-bold">Session Ended</h2><p className="text-muted-foreground mt-2">{sessionInfo?.title}<br/>Duration: {formatTime(callDuration)}</p></div>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => router.push(`/history/${sessionId}`)}>View History</Button>
          <Button onClick={() => router.push(isAgent ? '/agent' : '/customer')} className="glow-primary">Back to Dashboard</Button>
        </div>
      </div>
    </div>
  );

  const remoteStreamEntries = Array.from(remoteStreams.entries());
  const hasRemote           = remoteStreamEntries.length > 0;
  const hasLocalVideo       = (localStream?.getVideoTracks() ?? []).some((t) => t.readyState === 'live');
  const modeLabel = supportMode === 'chat' ? 'Chat' : supportMode === 'voice' ? 'Voice' : 'Video';
  const modeLabelFull = supportMode === 'chat' ? 'Chat Support' : supportMode === 'voice' ? 'Voice Support' : 'Video Support';
  const modeColor = supportMode === 'chat' ? 'bg-blue-500/15 text-blue-400' : supportMode === 'voice' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400';

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="glass-strong px-3 py-2 flex items-center justify-between shrink-0 z-50 safe-top">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <MessageSquare size={14} className="text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate max-w-[140px] sm:max-w-xs">{sessionInfo?.title || 'Support Session'}</h1>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {socketStatus === 'connecting' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />Connecting</span>}
              {socketStatus === 'connected'  && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-emerald-500 font-medium">Live</span></span>}
              {socketStatus === 'disconnected' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />Offline</span>}
              {socketStatus === 'failed' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-red-500">Failed</span></span>}
              {isConnected && <><span className="opacity-40">·</span><span>{formatTime(callDuration)}</span></>}
              <span className="opacity-40">·</span>
              <span>{peers.length + 1}p</span>
              {process.env.NODE_ENV !== 'production' && networkHost && (
                <><span className="opacity-40">·</span><span className="font-mono opacity-50 hidden sm:inline">{networkHost}</span></>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${modeColor}`}>{modeLabel}</span>
          <ThemeToggle />
          <Button variant="ghost" size="sm" className={`px-2 ${chatOpen ? 'text-primary' : ''}`} onClick={() => setChatOpen(!chatOpen)} title="Toggle Chat">
            <MessageSquare size={16} />
          </Button>
        </div>
      </div>

      {/* ── Media warning banner ─────────────────────────────────────────── */}
      {mediaWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 flex items-center justify-between text-xs text-amber-400 shrink-0">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span className="leading-tight">{mediaWarning}</span>
          </div>
          <button className="ml-2 shrink-0 p-1" onClick={clearMediaWarning}><X size={12} /></button>
        </div>
      )}

      {/* ── Main content: Desktop = side-by-side, Mobile = stacked ──────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">

        {/* ══ Video + Controls column ═══════════════════════════════════════ */}
        <div className={`flex flex-col overflow-hidden transition-all duration-300 ${
          chatOpen ? 'md:flex-1' : 'flex-1'
        } ${chatOpen ? 'h-[45vh] md:h-auto' : 'flex-1'}`}>

          {/* Video area */}
          <div className="flex-1 p-2 md:p-3 flex flex-col relative overflow-hidden min-h-0">

            {/* Connecting overlay */}
            {isConnecting && !isConnected && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-background/70 backdrop-blur-sm rounded-xl">
                <div className="text-center space-y-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
                  <p className="text-sm text-muted-foreground font-medium">Joining session…</p>
                  <p className="text-[10px] text-muted-foreground/50">Connecting to {networkHost || 'server'}:3001</p>
                </div>
              </div>
            )}

            {/* Remote streams */}
            {hasRemote ? (
              <div className="flex-1 h-full">
                {remoteStreamEntries.map(([peerId, remote]) => (
                  <div key={peerId} className="video-container w-full h-full relative rounded-xl overflow-hidden">
                    <video ref={setRemoteVideoRef(peerId)} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                      <span className="text-[10px] bg-black/60 backdrop-blur-sm text-white px-2 py-0.5 rounded-full">{remote.peerName}</span>
                      {!remote.audioEnabled && <span className="text-[10px] bg-red-500/70 text-white px-1.5 py-0.5 rounded-full">🔇</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Empty state with escalation buttons */
              <div className="flex-1 h-full video-container rounded-xl flex items-center justify-center">
                <div className="text-center space-y-3 text-muted-foreground p-4">
                  <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <MessageSquare size={28} className="text-primary" />
                  </div>
                  {isConnected ? (
                    <>
                      <div>
                        <p className="font-medium text-sm">Chat is active</p>
                        <p className="text-xs mt-1 opacity-70">Escalate to voice or video when needed</p>
                      </div>
                      <div className="flex flex-col gap-2 items-center pt-1">
                        {supportMode === 'chat' && (
                          <Button variant="outline" size="sm" onClick={startVoice} className="gap-2 w-full max-w-[220px] border-amber-500/40 text-amber-400 hover:bg-amber-500/10 h-10 text-sm">
                            <PhoneCall size={15} /> Start Voice Support
                          </Button>
                        )}
                        {supportMode !== 'video' && (
                          isAgent ? (
                            <Button variant="outline" size="sm" onClick={requestCustomerVideo} disabled={videoRequestPending} className="gap-2 w-full max-w-[220px] border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 h-10 text-sm">
                              <Video size={15} />{videoRequestPending ? 'Waiting…' : 'Request Customer Camera'}
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={startVideo} className="gap-2 w-full max-w-[220px] border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 h-10 text-sm">
                              <Video size={15} /> Enable My Camera
                            </Button>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs">Connecting…</p>
                  )}
                </div>
              </div>
            )}

            {/* Self-view PiP — only when camera active */}
            {hasLocalVideo && (
              <div className="absolute bottom-16 right-2 md:bottom-20 md:right-4 w-24 h-18 md:w-36 md:h-28 video-container shadow-xl z-20 rounded-xl overflow-hidden">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!isVideoEnabled && <div className="absolute inset-0 bg-background/90 flex items-center justify-center"><VideoOff size={16} className="text-muted-foreground" /></div>}
              </div>
            )}

            {/* Escalation overlay when remote is active */}
            {hasRemote && supportMode !== 'video' && isConnected && (
              <div className="absolute bottom-14 left-2 flex flex-col gap-1.5 z-20">
                {supportMode === 'chat' && (
                  <Button size="sm" variant="secondary" onClick={startVoice} className="gap-1.5 text-xs h-8 shadow-lg">
                    <PhoneCall size={13} /> Voice
                  </Button>
                )}
                {isAgent && (
                  <Button size="sm" variant="secondary" onClick={requestCustomerVideo} disabled={videoRequestPending} className="gap-1.5 text-xs h-8 shadow-lg">
                    <Video size={13} />{videoRequestPending ? 'Waiting…' : 'Req. Video'}
                  </Button>
                )}
                {!isAgent && supportMode === 'voice' && (
                  <Button size="sm" variant="secondary" onClick={startVideo} className="gap-1.5 text-xs h-8 shadow-lg">
                    <Video size={13} /> Camera
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Recording status — agent only */}
          {isAgent && recordingStatus !== 'idle' && (
            <div className={`mx-2 mb-1 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs border ${
              recordingStatus === 'recording' ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : recordingStatus === 'processing' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : recordingStatus === 'ready' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400'
            }`}>
              {recordingStatus === 'recording' && <><span className="relative flex h-2.5 w-2.5 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span><span className="font-medium">Recording</span><span className="ml-auto opacity-60">Customer only</span></>}
              {recordingStatus === 'processing' && <><span className="animate-spin rounded-full h-2.5 w-2.5 border-b-2 border-amber-400 shrink-0" /><span>Processing…</span></>}
              {recordingStatus === 'ready' && <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400"><polyline points="20 6 9 17 4 12"/></svg><span>Ready</span>{recordingUrl && <a href={recordingUrl} download={`session-${sessionId}.webm`} target="_blank" rel="noopener noreferrer" className="ml-auto underline">Download</a>}</>}
              {recordingStatus === 'failed' && <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span>Recording Failed</span></>}
            </div>
          )}

          {/* ── Controls bar ──────────────────────────────────────────────── */}
          <div className="flex items-center justify-center gap-2 pb-3 px-3 shrink-0">
            {supportMode !== 'chat' && (
              <button onClick={toggleAudio} title={isAudioEnabled ? 'Mute' : 'Unmute'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 ${isAudioEnabled ? 'bg-secondary text-secondary-foreground' : 'bg-destructive text-white'}`}>
                {isAudioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
            )}
            {supportMode === 'video' && (
              <button onClick={toggleVideo} title={isVideoEnabled ? 'Camera off' : 'Camera on'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 ${isVideoEnabled ? 'bg-secondary text-secondary-foreground' : 'bg-destructive text-white'}`}>
                {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
            )}
            {isConnected && supportMode === 'chat' && (
              <button onClick={startVoice} title="Start Voice Support"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-amber-500/15 text-amber-400 border border-amber-500/30 transition-all active:scale-95 hover:bg-amber-500/25">
                <PhoneCall size={20} />
              </button>
            )}
            {supportMode !== 'chat' && (
              <button onClick={stopMedia} title="Stop audio/video"
                className="w-12 h-12 rounded-full flex items-center justify-center bg-muted text-muted-foreground transition-all active:scale-95 hover:bg-muted/80">
                <MicOff size={18} />
              </button>
            )}
            <button onClick={isAgent ? handleEndCall : handleLeaveCall}
              title={isAgent ? 'End Session' : 'Leave'}
              className="w-14 h-12 rounded-full flex items-center justify-center bg-destructive text-white shadow-lg transition-all active:scale-95 hover:bg-destructive/90">
              <PhoneOff size={20} />
            </button>
          </div>
        </div>

        {/* ══ Chat panel — sidebar on desktop, bottom sheet on mobile ══════ */}
        {chatOpen && (
          <div className="
            /* Mobile: fixed bottom sheet */
            flex flex-col
            border-t md:border-t-0 md:border-l border-border
            /* Mobile height */
            h-[55vh] md:h-auto
            /* Desktop width */
            md:w-80 shrink-0
            bg-background md:bg-transparent
          ">
            {/* Chat header */}
            <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">Chat</h3>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${modeColor}`}>{modeLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{chatMessages.length}</span>
                <button className="md:hidden p-1 text-muted-foreground" onClick={() => setChatOpen(false)}><X size={14} /></button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-3 py-2">
              <div className="space-y-2.5">
                {chatMessages.length === 0 ? (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
                    <p>No messages yet</p>
                    <p className="opacity-60 mt-0.5">Start the conversation</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe    = msg.senderId === user?.userId;
                    const isImage = msg.fileUrl && /\.(jpe?g|png|gif|webp)$/i.test(msg.fileUrl);
                    const isPdf   = msg.fileUrl && msg.fileUrl.includes('.pdf');
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-[10px] font-medium text-muted-foreground">{isMe ? 'You' : msg.senderName}</span>
                          <span className={`text-[9px] px-1 py-0 rounded font-medium ${msg.senderRole === 'AGENT' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'}`}>{msg.senderRole}</span>
                        </div>
                        <div className={`rounded-2xl text-sm max-w-[85%] overflow-hidden ${isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'glass rounded-bl-sm'}`}>
                          {msg.type === 'FILE' && msg.fileUrl ? (
                            isImage ? (
                              <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                                <img src={msg.fileUrl} alt={msg.fileName || 'Image'} className="max-w-full object-cover max-h-40 w-full" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                              </a>
                            ) : (
                              <a href={isPdf ? `https://docs.google.com/viewer?url=${encodeURIComponent(msg.fileUrl)}` : msg.fileUrl} target="_blank" rel="noopener noreferrer"
                                className={`flex items-center gap-2 px-3 py-2.5 ${isMe ? 'text-primary-foreground' : 'text-foreground'}`}>
                                <span className="text-base">{isPdf ? '📄' : '📎'}</span>
                                <span className="truncate text-xs underline">{msg.fileName || 'File'}</span>
                              </a>
                            )
                          ) : (
                            <div className="px-3 py-2 break-words">{msg.content}</div>
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
            </ScrollArea>

            {/* Upload error */}
            {uploadError && (
              <div className="mx-3 mb-1 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between">
                <span className="truncate">{uploadError}</span>
                <button className="ml-2 shrink-0" onClick={() => setUploadError(null)}><X size={11} /></button>
              </div>
            )}

            {/* Input area */}
            <div className="p-2 border-t border-border shrink-0 safe-bottom">
              <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
              <div className="flex gap-1.5 items-center">
                <button onClick={() => fileInputRef.current?.click()} disabled={uploadingFile || !isConnected}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 shrink-0">
                  {uploadingFile ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /> : <Paperclip size={16} />}
                </button>
                <Input
                  placeholder={isConnected ? 'Type a message…' : 'Connecting…'}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  disabled={!isConnected}
                  className="flex-1 h-9 text-sm rounded-xl"
                />
                <button onClick={handleSendMessage} disabled={!messageInput.trim() || !isConnected}
                  className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-40 transition-all active:scale-95 shrink-0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Connection Error modal ───────────────────────────────────────── */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-destructive/30 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              </div>
              <div>
                <h3 className="font-semibold">Connection Error</h3>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
                {process.env.NODE_ENV !== 'production' && networkHost && (
                  <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">Attempted: {networkHost}:3001</p>
                )}
              </div>
              <div className="flex gap-2 justify-center">
                <Button size="sm" variant="outline" onClick={() => { clearError(); connect(); }}>Retry</Button>
                <Button size="sm" variant="ghost" onClick={() => { clearError(); router.push(isAgent ? '/agent' : '/customer'); }}>Go Back</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Incoming video request dialog ────────────────────────────────── */}
      {incomingVideoRequest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Video size={20} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold">Camera Request</h3>
                  <p className="text-xs text-muted-foreground">from your Support Agent</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Your support agent is requesting access to your camera for visual troubleshooting. Your camera will only be active during this session.</p>
              <div className="flex gap-2">
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-11" onClick={() => respondToVideoRequest(true)}>
                  <Video size={16} className="mr-1.5" /> Allow Video
                </Button>
                <Button variant="outline" className="flex-1 h-11" onClick={() => respondToVideoRequest(false)}>Decline</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}