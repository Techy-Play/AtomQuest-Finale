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
import { Paperclip, X } from 'lucide-react';

export default function SessionPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;
  const { user, loading } = useAuth();
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const [callEnded, setCallEnded] = useState(false);
  const [joinedCall, setJoinedCall] = useState(false);
  const [joiningCall, setJoiningCall] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const {
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
  } = useMediasoup({
    sessionId,
    userId: user?.userId || '',
    userName: user?.name || '',
    userRole: user?.role || '',
    onSessionEnded: () => setCallEnded(true),
  });

  // Connection error is now manually dismissed via the popup button

  // File upload handler
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = '';
    setUploadError(null);
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await sendMessage(file.name, 'FILE', data.url, file.name, file.size);
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setUploadingFile(false);
    }
  }, [sendMessage]);

  // Fetch session info
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
      return;
    }

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        if (data.session) {
          setSessionInfo(data.session);
          // Load existing chat messages
          if (data.session.messages) {
            setChatMessages(data.session.messages.map((m: any) => ({
              id: m.id,
              senderId: m.sender.id,
              senderName: m.sender.name,
              senderRole: m.sender.role,
              content: m.content,
              type: m.type,
              fileUrl: m.fileUrl,
              fileName: m.fileName,
              createdAt: m.createdAt,
            })));
          }
        }
      } catch (err) {
        console.error('Failed to fetch session:', err);
      }
    };

    if (!loading && user) {
      fetchSession();
    }
  }, [loading, user, sessionId, router, setChatMessages]);

  // Manual join — camera only activates when user clicks "Join Call"
  const handleJoinCall = async () => {
    setJoiningCall(true);
    try {
      await connect();
      setJoinedCall(true);
    } catch (err) {
      console.error('Failed to join call:', err);
    } finally {
      setJoiningCall(false);
    }
  };

  // Attach local stream to video element and force play
  useEffect(() => {
    const videoEl = localVideoRef.current;
    if (videoEl && localStream) {
      videoEl.srcObject = localStream;
      videoEl.play().catch(() => {
        // Autoplay policy: will play when user interacts
      });
    }
  }, [localStream]);

  // Call timer
  useEffect(() => {
    if (isConnected && !callEnded) {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected, callEnded]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;
    sendMessage(messageInput.trim());
    setMessageInput('');
  };

  const handleEndCall = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    await endSession();
    disconnect();
    setCallEnded(true);
  };

  const handleLeaveCall = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    disconnect();
    router.push(user?.role === 'AGENT' || user?.role === 'ADMIN' ? '/agent' : '/customer');
  };

  // Set remote video ref — attach stream immediately when element mounts
  const setRemoteVideoRef = useCallback((peerId: string) => (el: HTMLVideoElement | null) => {
    if (el) {
      remoteVideoRefs.current.set(peerId, el);
      const remote = remoteStreams.get(peerId);
      if (remote && el.srcObject !== remote.stream) {
        el.srcObject = remote.stream;
        el.play().catch(() => {});
      }
    } else {
      remoteVideoRefs.current.delete(peerId);
    }
  }, [remoteStreams]);

  // Sync remote streams → video elements whenever remoteStreams changes
  useEffect(() => {
    remoteStreams.forEach((remote, peerId) => {
      const videoEl = remoteVideoRefs.current.get(peerId);
      if (videoEl && videoEl.srcObject !== remote.stream) {
        videoEl.srcObject = remote.stream;
        videoEl.play().catch(() => {});
      }
    });
  }, [remoteStreams]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (callEnded) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-6 max-w-md">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <path d="M22 4L12 14.01l-3-3"/>
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Call Ended</h2>
            <p className="text-muted-foreground mt-2">
              Session: {sessionInfo?.title}<br/>
              Duration: {formatTime(callDuration)}
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => router.push(`/history/${sessionId}`)}>
              View History
            </Button>
            <Button onClick={() => router.push(user?.role === 'AGENT' ? '/agent' : '/customer')} className="glow-primary">
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Pre-join lobby — camera is OFF until user clicks Join
  if (!joinedCall) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-accent/5 blur-[120px]" />
        </div>
        <div className="relative z-10 text-center space-y-8 max-w-lg">
          <div className="w-24 h-24 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
              <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
            </svg>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{sessionInfo?.title || 'Loading session...'}</h1>
            <p className="text-muted-foreground">
              {sessionInfo?.agent?.name ? `Hosted by ${sessionInfo.agent.name}` : 'Preparing your session...'}
            </p>
          </div>

          {sessionInfo && (
            <div className="glass rounded-xl p-4 space-y-3 text-sm text-left max-w-sm mx-auto">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
                    <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1z"/>
                    <rect x="2" y="5" width="13" height="14" rx="2"/>
                  </svg>
                </div>
                <span className="text-muted-foreground">Camera and microphone will be requested</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <span className="text-muted-foreground">Server-routed media — secure connection</span>
              </div>
            </div>
          )}

          <div className="flex flex-col items-center gap-3">
            <Button
              size="lg"
              className="glow-primary px-8 text-base"
              onClick={handleJoinCall}
              disabled={!sessionInfo || joiningCall}
            >
              {joiningCall ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Connecting...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
                    <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
                  </svg>
                  Join Call
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(user?.role === 'AGENT' || user?.role === 'ADMIN' ? '/agent' : '/customer')}
              className="text-muted-foreground"
            >
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const remoteStreamEntries = Array.from(remoteStreams.entries());
  const hasRemote = remoteStreamEntries.length > 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="glass-strong px-4 py-2.5 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
              <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold">{sessionInfo?.title || 'Loading...'}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isConnected && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </span>
              )}
              <Separator orientation="vertical" className="h-3" />
              <span>{formatTime(callDuration)}</span>
              <Separator orientation="vertical" className="h-3" />
              <span>{peers.length + 1} participants</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setChatOpen(!chatOpen)}
            className={chatOpen ? 'text-primary' : ''}
            title="Toggle Chat"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video area */}
        <div className="flex-1 p-4 flex flex-col relative">
          {/* Video grid */}
          <div className="flex-1 flex items-center justify-center gap-4">
            {/* Remote video (main) */}
            {hasRemote ? (
              <div className="flex-1 h-full max-h-[calc(100vh-200px)]">
                {remoteStreamEntries.map(([peerId, remote]) => (
                  <div key={peerId} className="video-container w-full h-full relative">
                    <video
                      ref={setRemoteVideoRef(peerId)}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2">
                      <Badge variant="secondary" className="bg-black/60 backdrop-blur-sm text-white border-0 text-xs">
                        {remote.peerName}
                      </Badge>
                      {!remote.audioEnabled && (
                        <Badge variant="secondary" className="bg-red-500/60 backdrop-blur-sm text-white border-0 text-xs">
                          🔇 Muted
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 h-full max-h-[calc(100vh-200px)] video-container flex items-center justify-center">
                <div className="text-center space-y-3 text-muted-foreground">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto animate-pulse">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                      <path d="M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                  </div>
                  <p>Waiting for the other participant to join...</p>
                  <p className="text-xs">Share the invite link for them to connect</p>
                </div>
              </div>
            )}

            {/* Local video (PiP) */}
            <div className="absolute bottom-24 right-6 w-48 h-36 video-container shadow-2xl z-30">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover rounded-xl"
              />
              <div className="absolute bottom-2 left-2">
                <Badge variant="secondary" className="bg-black/60 backdrop-blur-sm text-white border-0 text-xs">
                  You
                </Badge>
              </div>
              {!isVideoEnabled && (
                <div className="absolute inset-0 bg-background/90 flex items-center justify-center rounded-xl">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
                    <path d="M1 1l22 22M21 21H3a2 2 0 01-2-2V5a2 2 0 012-2"/>
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Controls bar */}
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button
              variant={isAudioEnabled ? 'secondary' : 'destructive'}
              size="lg"
              className="rounded-full w-14 h-14"
              onClick={toggleAudio}
              title={isAudioEnabled ? 'Mute' : 'Unmute'}
            >
              {isAudioEnabled ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.13 1.5-.35 2.18"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </Button>

            <Button
              variant={isVideoEnabled ? 'secondary' : 'destructive'}
              size="lg"
              className="rounded-full w-14 h-14"
              onClick={toggleVideo}
              title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {isVideoEnabled ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1z"/>
                  <rect x="2" y="5" width="13" height="14" rx="2"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              )}
            </Button>

            {/* End call — only agent can end, customer can leave */}
            <Button
              variant="destructive"
              size="lg"
              className={`rounded-full w-14 h-14 ${(user?.role === 'AGENT' || user?.role === 'ADMIN') ? 'glow-destructive' : ''}`}
              onClick={(user?.role === 'AGENT' || user?.role === 'ADMIN') ? handleEndCall : handleLeaveCall}
              title={(user?.role === 'AGENT' || user?.role === 'ADMIN') ? 'End Call' : 'Leave Call'}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/>
                <line x1="23" y1="1" x2="1" y2="23"/>
              </svg>
            </Button>
          </div>
        </div>

        {/* Chat sidebar */}
        {chatOpen && (
          <div className="w-80 border-l border-border flex flex-col shrink-0">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="font-medium text-sm">Chat</h3>
              <Badge variant="secondary" className="text-xs">{chatMessages.length}</Badge>
            </div>

            <ScrollArea className="flex-1 p-3">
              <div className="space-y-3">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No messages yet. Start the conversation!
                  </p>
                ) : (
                  chatMessages.map((msg) => {
                    const isMe = msg.senderId === user?.userId;
                    const isImage = msg.fileUrl && /\.(jpe?g|png|gif|webp)$/i.test(msg.fileUrl);
                    const isPdf = msg.fileUrl && msg.fileUrl.includes('.pdf');
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {isMe ? 'You' : msg.senderName}
                          </span>
                          <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${
                            msg.senderRole === 'AGENT' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {msg.senderRole}
                          </Badge>
                        </div>
                        <div className={`rounded-xl text-sm max-w-[85%] overflow-hidden ${
                          isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'glass rounded-bl-sm'
                        }`}>
                          {msg.type === 'FILE' && msg.fileUrl ? (
                            isImage ? (
                              <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer">
                                <img
                                  src={msg.fileUrl}
                                  alt={msg.fileName || 'Image'}
                                  className="max-w-full rounded-xl object-cover max-h-48"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              </a>
                            ) : (
                              <a
                                href={isPdf ? `https://docs.google.com/viewer?url=${encodeURIComponent(msg.fileUrl)}` : msg.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`flex items-center gap-2 px-3 py-2 underline ${
                                  isMe ? 'text-primary-foreground' : 'text-foreground'
                                }`}
                              >
                                <span>{isPdf ? '📄' : '📎'}</span>
                                <span className="truncate max-w-[160px] text-xs">{msg.fileName || 'File'}</span>
                              </a>
                            )
                          ) : (
                            <div className="px-3 py-2">{msg.content}</div>
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
                <span>{uploadError}</span>
                <button onClick={() => setUploadError(null)}><X size={12} /></button>
              </div>
            )}

            <div className="p-3 border-t border-border space-y-2">
              {/* File upload input (hidden) */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div className="flex gap-2">
                {/* Attach file button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  title="Attach image or PDF"
                >
                  {uploadingFile ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                  ) : (
                    <Paperclip size={16} />
                  )}
                </Button>
                <Input
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="text-sm"
                />
                <Button size="sm" onClick={handleSendMessage} disabled={!messageInput.trim()} className="shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error overlay — centered popup */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200">
          <div className="bg-card border border-destructive/30 rounded-2xl shadow-2xl shadow-destructive/10 max-w-md w-full overflow-hidden">
            <div className="p-6 space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-2">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-destructive mb-2">Connection Error</h3>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
            <div className="p-4 bg-muted/50 border-t border-border flex justify-center">
              <Button variant="outline" onClick={clearError} className="w-full max-w-[200px]">
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
