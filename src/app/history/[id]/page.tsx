'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';

export default function HistoryPage() {
  const router    = useRouter();
  const params    = useParams();
  const sessionId = params.id as string;
  const { user, loading } = useAuth();

  const [session,    setSession]    = useState<any>(null);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [activeTab,  setActiveTab]  = useState<'chat' | 'files' | 'recordings' | 'info'>('chat');
  const [fetchError, setFetchError] = useState('');

  const isAgent = user?.role === 'AGENT' || user?.role === 'ADMIN';

  useEffect(() => {
    if (!loading && !user) { router.push('/'); return; }
    if (!loading && user) {
      fetch('/api/sessions/' + sessionId)
        .then((r) => r.json())
        .then((d) => { if (d.session) setSession(d.session); else setFetchError('Session not found.'); })
        .catch(() => setFetchError('Failed to load session.'));

      if (isAgent) {
        fetch('/api/recordings/' + sessionId)
          .then((r) => r.json())
          .then((d) => { if (d.recordings) setRecordings(d.recordings); })
          .catch(() => {});
      }
    }
  }, [loading, user, sessionId]);

  const formatDuration = (start?: string | null, end?: string | null) => {
    if (!start) return null;
    const s = Math.floor(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  };

  const chatMessages = session?.messages || [];
  const fileMessages = chatMessages.filter((m: any) => m.type === 'FILE');

  const statusColor =
    session?.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
    session?.status === 'ENDED'  ? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20' :
                                   'bg-amber-500/15 text-amber-400 border-amber-500/20';

  if (loading || (!session && !fetchError)) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  if (fetchError) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <p className="text-muted-foreground">{fetchError}</p>
      <Button onClick={() => router.back()}>Go Back</Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-sm truncate">{session.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium border ' + statusColor}>{session.status}</span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(session.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              {formatDuration(session.startedAt, session.endedAt) && (
                <span className="text-[10px] text-muted-foreground">• {formatDuration(session.startedAt, session.endedAt)}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            {session.status !== 'ENDED' && isAgent && (
              <Button size="sm" className="h-8 text-xs" onClick={() => router.push('/session/' + sessionId)}>
                {session.status === 'ACTIVE' ? 'Rejoin' : 'Join'}
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-4xl mx-auto px-4 flex gap-1 pb-0">
          {(['chat', 'files', ...(isAgent ? ['recordings'] : []), 'info'] as const).map((tab) => {
            const counts: Record<string, number> = {
              chat: chatMessages.filter((m: any) => m.type !== 'FILE').length,
              files: fileMessages.length,
              recordings: recordings.length,
              info: 0,
            };
            return (
              <button key={tab} onClick={() => setActiveTab(tab as any)}
                className={'px-3 py-2 text-xs font-medium border-b-2 transition-colors capitalize ' + (
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}>
                {tab}{counts[tab] > 0 ? ' (' + counts[tab] + ')' : ''}
              </button>
            );
          })}
        </div>
      </header>

      {/* BODY */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4">

        {/* ── CHAT TAB ── */}
        {activeTab === 'chat' && (
          <div className="space-y-3">
            {chatMessages.filter((m: any) => m.type !== 'FILE').length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-30">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                No chat messages in this session.
              </div>
            ) : (
              chatMessages.filter((m: any) => m.type !== 'FILE').map((msg: any) => {
                const isMe = msg.sender?.id === user?.userId;
                return (
                  <div key={msg.id} className={'flex flex-col ' + (isMe ? 'items-end' : 'items-start')}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={'text-[10px] px-1.5 py-0.5 rounded font-medium ' + (
                        msg.sender?.role === 'AGENT' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'
                      )}>{msg.sender?.role}</span>
                      <span className="text-[10px] font-medium text-muted-foreground">{isMe ? 'You' : msg.sender?.name}</span>
                      <span className="text-[9px] text-muted-foreground opacity-60">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className={'px-3 py-2 rounded-2xl text-sm max-w-[85%] break-words ' + (
                      isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'
                    )}>
                      {msg.content}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── FILES TAB ── */}
        {activeTab === 'files' && (
          <div className="space-y-2">
            {fileMessages.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-30">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
                No files shared in this session.
              </div>
            ) : (
              fileMessages.map((msg: any) => {
                const isImg = msg.fileUrl && /\.(jpe?g|png|gif|webp)$/i.test(msg.fileUrl);
                const isPdf = msg.fileName?.endsWith('.pdf') || msg.fileUrl?.includes('.pdf');
                return (
                  <a key={msg.id}
                    href={isPdf ? 'https://docs.google.com/viewer?url=' + encodeURIComponent(msg.fileUrl) : msg.fileUrl}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors">
                    {isImg ? (
                      <img src={msg.fileUrl} alt={msg.fileName || 'Image'}
                        className="w-14 h-14 rounded-lg object-cover shrink-0 border border-border" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-border text-2xl">
                        {isPdf ? '📄' : '📎'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{msg.fileName || 'Shared file'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Shared by {msg.sender?.name} ({msg.sender?.role}) •{' '}
                        {new Date(msg.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted-foreground">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </a>
                );
              })
            )}
          </div>
        )}

        {/* ── RECORDINGS TAB (agent only) ── */}
        {activeTab === 'recordings' && isAgent && (
          <div className="space-y-3">
            {recordings.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-30">
                  <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
                </svg>
                No recordings yet.
                {session.status !== 'ENDED' && (
                  <p className="text-xs mt-1 opacity-60">Recordings are saved when you click "Stop" during a session.</p>
                )}
              </div>
            ) : (
              recordings.map((rec: any) => (
                <div key={rec.id} className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card">
                  <div className={'w-10 h-10 rounded-full flex items-center justify-center shrink-0 ' + (
                    rec.status === 'READY'      ? 'bg-emerald-500/15 text-emerald-400' :
                    rec.status === 'RECORDING'  ? 'bg-red-500/15 text-red-400' :
                    rec.status === 'PROCESSING' ? 'bg-amber-500/15 text-amber-400' :
                                                  'bg-zinc-500/15 text-zinc-400'
                  )}>
                    {rec.status === 'READY' ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                    ) : rec.status === 'RECORDING' ? (
                      <span className="w-3 h-3 rounded-full bg-red-400 animate-pulse" />
                    ) : (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {rec.status === 'READY' ? 'Session Recording' : rec.status === 'RECORDING' ? 'In Progress' : rec.status}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(rec.createdAt).toLocaleString()}
                      {rec.duration && ' • ' + formatDuration(null, null)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' + (
                      rec.status === 'READY' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                      'bg-zinc-500/15 text-zinc-400 border-zinc-500/20'
                    )}>{rec.status}</span>
                    {rec.fileUrl && (
                      <a href={rec.fileUrl} target="_blank" rel="noopener noreferrer" download
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download
                      </a>
                    )}
                    {rec.fileUrl && (
                      <a href={rec.fileUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                        Play
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── INFO TAB ── */}
        {activeTab === 'info' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h2 className="font-semibold text-sm">Session Details</h2>
              {[
                { label: 'Session ID', value: session.id },
                { label: 'Title',     value: session.title },
                { label: 'Status',    value: session.status },
                { label: 'Agent',     value: session.agent?.name + ' (' + session.agent?.email + ')' },
                { label: 'Customer',  value: session.customer ? session.customer.name + ' (' + session.customer.email + ')' : 'No customer joined' },
                { label: 'Created',   value: new Date(session.createdAt).toLocaleString() },
                { label: 'Started',   value: session.startedAt ? new Date(session.startedAt).toLocaleString() : '—' },
                { label: 'Ended',     value: session.endedAt   ? new Date(session.endedAt).toLocaleString()   : '—' },
                { label: 'Duration',  value: formatDuration(session.startedAt, session.endedAt) || '—' },
                { label: 'Messages',  value: String(chatMessages.length) },
                { label: 'Files',     value: String(fileMessages.length) },
                { label: 'Recordings',value: String(recordings.length) },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
                  <span className="text-xs text-muted-foreground shrink-0 w-28">{label}</span>
                  <span className="text-xs text-right break-all font-medium">{value}</span>
                </div>
              ))}
            </div>

            {session.events && session.events.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <h2 className="font-semibold text-sm">Session Events</h2>
                {session.events.map((ev: any) => (
                  <div key={ev.id} className="flex items-center gap-3 py-1.5 border-b border-border/30 last:border-0">
                    <span className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                    <div className="flex-1">
                      <span className="text-xs font-medium">{ev.event.replace(/_/g, ' ')}</span>
                      {ev.user && <span className="text-xs text-muted-foreground ml-1.5">by {ev.user.name}</span>}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
