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
          const blob = new Blob(recordingChunksRef.current, { type: mimeType });
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
  const modeLabel = supportMode === 'chat' ? 'Chat Support' : supportMode === 'voice' ? 'Voice Support' : 'Video Support';
  const modeColor = supportMode === 'chat' ? 'bg-blue-500/15 text-blue-400' : supportMode === 'voice' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400';

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      <div className="glass-strong px-4 py-2.5 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <MessageSquare size={16} className="text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">{sessionInfo?.title || 'Support Session'}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {/* Socket connection status */}
              {socketStatus === 'connecting' && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" /><span>Connecting...</span></span>
              )}
              {socketStatus === 'connected' && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /><span className="text-emerald-500 font-medium">Connected</span></span>
              )}
              {socketStatus === 'disconnected' && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-500" /><span className="text-zinc-500">Disconnected</span></span>
              )}
              {socketStatus === 'failed' && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-red-500">Connection Failed</span></span>
              )}
              {isConnected && (
                <><Separator orientation="vertical" className="h-3" /><span>{formatTime(callDuration)}</span></>
              )}
              <Separator orientation="vertical" className="h-3" />
              <span>{peers.length + 1} participant{peers.length !== 0 ? 's' : ''}</span>
              {/* Dev-only: show which hostname/IP is in use */}
              {process.env.NODE_ENV !== 'production' && networkHost && (
                <><Separator orientation="vertical" className="h-3" /><span className="font-mono text-[10px] opacity-60 hidden md:inline">{networkHost}</span></>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`hidden sm:flex text-xs px-2 py-0.5 rounded-full font-medium ${modeColor}`}>{modeLabel}</span>
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => setChatOpen(!chatOpen)} className={chatOpen ? 'text-primary' : ''} title="Toggle Chat"><MessageSquare size={18} /></Button>
        </div>
      </div>

      {mediaWarning && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-sm text-amber-400">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>{mediaWarning}</span>
          </div>
          <button onClick={clearMediaWarning}><X size={14} /></button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-4 flex flex-col relative overflow-hidden">

            {isConnecting && !isConnected && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-background/60 backdrop-blur-sm rounded-2xl">
                <div className="text-center space-y-3">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
                  <p className="text-sm text-muted-foreground font-medium">Joining session...</p>
                  <p className="text-xs text-muted-foreground/60">
                    Connecting to {networkHost || 'server'}:3001
                  </p>
                </div>
              </div>
            )}

            {hasRemote ? (
              <div className="flex-1 h-full max-h-[calc(100vh-200px)]">
                {remoteStreamEntries.map(([peerId, remote]) => (
                  <div key={peerId} className="video-container w-full h-full relative">
                    <video ref={setRemoteVideoRef(peerId)} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2">
                      <Badge variant="secondary" className="bg-black/60 backdrop-blur-sm text-white border-0 text-xs">{remote.peerName}</Badge>
                      {!remote.audioEnabled && <Badge variant="secondary" className="bg-red-500/60 backdrop-blur-sm text-white border-0 text-xs">Muted</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 h-full max-h-[calc(100vh-200px)] video-container flex items-center justify-center">
                <div className="text-center space-y-4 text-muted-foreground p-8">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <MessageSquare size={36} className="text-primary" />
                  </div>
                  {isConnected ? (
                    <>
                      <p className="font-medium">Session is ready â€” Chat is active</p>
                      <p className="text-xs max-w-xs mx-auto">You are connected. Use chat for support, or escalate to voice/video when needed.</p>
                      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                        {supportMode === 'chat' && (
                          <Button variant="outline" size="sm" onClick={startVoice} className="gap-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10">
                            <PhoneCall size={16} /> Start Voice Support
                          </Button>
                        )}
                        {supportMode !== 'video' && (
                          isAgent ? (
                            <Button variant="outline" size="sm" onClick={requestCustomerVideo} disabled={videoRequestPending} className="gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">
                              <Video size={16} />{videoRequestPending ? 'Waiting...' : 'Request Customer Camera'}
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={startVideo} className="gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10">
                              <Video size={16} /> Enable My Camera
                            </Button>
                          )
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs">Connecting to session...</p>
                  )}
                </div>
              </div>
            )}

            {hasLocalVideo && (
              <div className="absolute bottom-24 right-6 w-48 h-36 video-container shadow-2xl z-30">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover rounded-xl" />
                <div className="absolute bottom-2 left-2"><Badge variant="secondary" className="bg-black/60 backdrop-blur-sm text-white border-0 text-xs">You</Badge></div>
                {!isVideoEnabled && <div className="absolute inset-0 bg-background/90 flex items-center justify-center rounded-xl"><VideoOff size={24} className="text-muted-foreground" /></div>}
              </div>
            )}

            {hasRemote && supportMode !== 'video' && isConnected && (
              <div className="absolute bottom-20 left-4 flex flex-col gap-2 z-20">
                {supportMode === 'chat' && <Button size="sm" variant="secondary" onClick={startVoice} className="gap-2 text-xs shadow-lg"><PhoneCall size={14} /> Start Voice</Button>}
                {isAgent && <Button size="sm" variant="secondary" onClick={requestCustomerVideo} disabled={videoRequestPending} className="gap-2 text-xs shadow-lg"><Video size={14} />{videoRequestPending ? 'Waiting...' : 'Request Video'}</Button>}
                {!isAgent && supportMode === 'voice' && <Button size="sm" variant="secondary" onClick={startVideo} className="gap-2 text-xs shadow-lg"><Video size={14} /> Enable Camera</Button>}
              </div>
            )}
          </div>

          {isAgent && recordingStatus !== 'idle' && (
            <div className={`mx-4 mb-2 rounded-xl px-4 py-2 flex items-center gap-3 text-sm border ${
              recordingStatus === 'recording' ? 'bg-red-500/10 border-red-500/30 text-red-400' : recordingStatus === 'processing' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : recordingStatus === 'ready' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400'
            }`}>
              {recordingStatus === 'recording' && <><span className="relative flex h-3 w-3 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" /><span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" /></span><span className="font-medium">Recording</span><span className="text-xs ml-auto text-red-400/70">Customer stream only</span></>}
              {recordingStatus === 'processing' && <><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-amber-400 shrink-0" /><span className="font-medium">Processing...</span></>}
              {recordingStatus === 'ready' && <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-400"><polyline points="20 6 9 17 4 12"/></svg><span className="font-medium">Recording Ready</span>{recordingUrl && <a href={recordingUrl} download={`session-${sessionId}.webm`} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg px-3 py-1 font-medium transition-colors">Download</a>}</> }
              {recordingStatus === 'failed' && <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span className="font-medium">Recording Failed</span></>}
            </div>
          )}

          <div className="flex items-center justify-center gap-3 pb-4 px-4">
            {supportMode !== 'chat' && <Button variant={isAudioEnabled ? 'secondary' : 'destructive'} size="lg" className="rounded-full w-12 h-12" onClick={toggleAudio} title={isAudioEnabled ? 'Mute' : 'Unmute'}>{isAudioEnabled ? <Mic size={20} /> : <MicOff size={20} />}</Button>}
            {supportMode === 'video' && <Button variant={isVideoEnabled ? 'secondary' : 'destructive'} size="lg" className="rounded-full w-12 h-12" onClick={toggleVideo} title={isVideoEnabled ? 'Camera off' : 'Camera on'}>{isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}</Button>}
            {isConnected && supportMode === 'chat' && <Button variant="outline" size="lg" className="rounded-full w-12 h-12 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={startVoice} title="Start Voice Support"><PhoneCall size={20} /></Button>}
            {supportMode !== 'chat' && <Button variant="outline" size="lg" className="rounded-full w-12 h-12" onClick={stopMedia} title="Stop audio/video"><MicOff size={20} /></Button>}
            <Button variant="destructive" size="lg" className={`rounded-full w-12 h-12 ${isAgent ? 'glow-destructive' : ''}`} onClick={isAgent ? handleEndCall : handleLeaveCall} title={isAgent ? 'End Session' : 'Leave Session'}><PhoneOff size={20} /></Button>
          </div>
        </div>

        {chatOpen && (
          <div className="w-80 border-l border-border flex flex-col shrink-0">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">Chat</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${modeColor}`}>{modeLabel}</span>
              </div>
              <Badge variant="secondary" className="text-xs">{chatMessages.length}</Badge>
            </div>
            <ScrollArea className="flex-1 p-3">
              <div className="space-y-3">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No messages yet. Start the conversation!</p>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe    = msg.senderId === user?.userId;
                    const isImage = msg.fileUrl && /\.(jpe?g|png|gif|webp)$/i.test(msg.fileUrl);
                    const isPdf   = msg.fileUrl && msg.fileUrl.includes('.pdf');
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] font-medium text-muted-foreground">{isMe ? 'You' : msg.senderName}</span>
                          <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${msg.senderRole === 'AGENT' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'}`}>{msg.senderRole}</Badge>
                        </div>
                        <div className={`rounded-xl text-sm max-w-[85%] overflow-hidden ${isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'glass rounded-bl-sm'}`}>
                          {msg.type === 'FILE' && msg.fileUrl ? (
                            isImage ? (
                              <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer"><img src={msg.fileUrl} alt={msg.fileName || 'Image'} className="max-w-full rounded-xl object-cover max-h-48" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /></a>
                            ) : (
                              <a href={isPdf ? `https://docs.google.com/viewer?url=${encodeURIComponent(msg.fileUrl)}` : msg.fileUrl} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 px-3 py-2 underline ${isMe ? 'text-primary-foreground' : 'text-foreground'}`}><span>{isPdf ? 'ðŸ“„' : 'ðŸ“Ž'}</span><span className="truncate max-w-[160px] text-xs">{msg.fileName || 'File'}</span></a>
                            )
                          ) : (
                            <div className="px-3 py-2">{msg.content}</div>
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground mt-0.5">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>
            {uploadError && (
              <div className="mx-3 mb-1 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between">
                <span>{uploadError}</span><button onClick={() => setUploadError(null)}><X size={12} /></button>
              </div>
            )}
            <div className="p-3 border-t border-border space-y-2">
              <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="px-2 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile || !isConnected} title="Attach image or PDF">{uploadingFile ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /> : <Paperclip size={16} />}</Button>
                <Input placeholder="Type a message..." value={messageInput} onChange={(e) => setMessageInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} disabled={!isConnected} className="text-sm" />
                <Button size="sm" onClick={handleSendMessage} disabled={!messageInput.trim() || !isConnected} className="shrink-0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-destructive/30 rounded-2xl shadow-2xl max-w-md w-full">
            <div className="p-6 space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
              <div>
                <h3 className="text-lg font-semibold">Connection Error</h3>
                <p className="text-sm text-muted-foreground mt-2">{error}</p>
                {process.env.NODE_ENV !== 'production' && networkHost && (
                  <p className="text-xs text-muted-foreground/60 mt-2 font-mono">Attempted: {networkHost}:3001</p>
                )}
              </div>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={() => { clearError(); connect(); }}>Retry</Button>
                <Button variant="ghost" onClick={() => { clearError(); router.push(isAgent ? '/agent' : '/customer'); }}>Go Back</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {incomingVideoRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0"><Video size={24} className="text-emerald-400" /></div>
                <div><h3 className="font-semibold">Camera Request</h3><p className="text-xs text-muted-foreground">from your Support Agent</p></div>
              </div>
              <p className="text-sm text-muted-foreground">Your support agent is requesting access to your camera for visual troubleshooting. Your camera will only be active during this session.</p>
              <div className="flex gap-3">
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => respondToVideoRequest(true)}><Video size={16} className="mr-2" /> Allow Video</Button>
                <Button variant="outline" className="flex-1" onClick={() => respondToVideoRequest(false)}>Decline</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}