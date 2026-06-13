'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function HistoryPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;
  const { user, loading } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [recordings, setRecordings] = useState<any[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
      return;
    }

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const data = await res.json();
        if (data.session) setSession(data.session);
      } catch (err) {
        console.error('Failed to fetch session:', err);
      }
    };

    const fetchRecordings = async () => {
      try {
        const res = await fetch(`/api/recordings/${sessionId}`);
        const data = await res.json();
        if (data.recordings) setRecordings(data.recordings);
      } catch (err) {
        // Not an agent — silently ignore
      }
    };

    if (!loading && user) { fetchSession(); fetchRecordings(); }
  }, [loading, user, sessionId, router]);

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const duration = session.startedAt && session.endedAt
    ? Math.floor((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null;

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-strong">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              Back
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <h1 className="font-semibold">Session Details</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Session info */}
        <Card className="glass border-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle>{session.title}</CardTitle>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Badge variant="secondary" className={
                    session.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                    : session.status === 'ENDED' ? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                  }>
                    {session.status}
                  </Badge>
                  <span>Created {new Date(session.createdAt).toLocaleString()}</span>
                  {duration !== null && <span>Duration: {formatDuration(duration)}</span>}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Agent</p>
                <p className="font-medium">{session.agent.name}</p>
                <p className="text-xs text-muted-foreground">{session.agent.email}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Customer</p>
                {session.customer ? (
                  <>
                    <p className="font-medium">{session.customer.name}</p>
                    <p className="text-xs text-muted-foreground">{session.customer.email}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">Not joined</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Statistics</p>
                <p className="text-sm">{session.messages.length} messages</p>
                <p className="text-sm">{session.events.length} events</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chat & Events */}
        <Tabs defaultValue="chat" className="space-y-4">
          <TabsList>
            <TabsTrigger value="chat">Chat History ({session.messages.length})</TabsTrigger>
            <TabsTrigger value="events">Event Log ({session.events.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="chat">
            <Card className="glass border-0">
              <CardContent className="pt-6">
                <ScrollArea className="h-96">
                  {session.messages.length === 0 ? (
                    <p className="text-center text-muted-foreground text-sm py-8">No messages in this session</p>
                  ) : (
                    <div className="space-y-3 pr-4">
                      {session.messages.map((msg: any) => (
                        <div key={msg.id} className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">
                            {msg.sender.name.charAt(0)}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{msg.sender.name}</span>
                              <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${
                                msg.sender.role === 'AGENT' ? 'bg-blue-500/15 text-blue-400' : 'bg-emerald-500/15 text-emerald-400'
                              }`}>
                                {msg.sender.role}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(msg.createdAt).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {msg.type === 'FILE' ? (
                                <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                  📎 {msg.fileName || 'File'}
                                </a>
                              ) : msg.content}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card className="glass border-0">
              <CardContent className="pt-6">
                <ScrollArea className="h-96">
                  {session.events.length === 0 ? (
                    <p className="text-center text-muted-foreground text-sm py-8">No events recorded</p>
                  ) : (
                    <div className="space-y-2 pr-4">
                      {session.events.map((event: any) => (
                        <div key={event.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                          <div className="w-2 h-2 rounded-full bg-primary/60 shrink-0" />
                          <div className="flex-1 flex items-center justify-between">
                            <div>
                              <span className="text-sm font-medium">{event.event}</span>
                              {event.user && (
                                <span className="text-sm text-muted-foreground ml-2">by {event.user.name}</span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Recording Section — Agent Only */}
        {(user?.role === 'AGENT' || user?.role === 'ADMIN') && (
          <Card className="glass border-0">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/>
                  </svg>
                </span>
                Session Recording
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recordings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recording available for this session.</p>
              ) : (
                <div className="space-y-3">
                  {recordings.map((rec: any) => (
                    <div key={rec.id} className={`flex items-center justify-between p-3 rounded-xl border ${
                      rec.status === 'READY' ? 'bg-emerald-500/10 border-emerald-500/20'
                      : rec.status === 'RECORDING' ? 'bg-red-500/10 border-red-500/20'
                      : rec.status === 'PROCESSING' ? 'bg-amber-500/10 border-amber-500/20'
                      : 'bg-zinc-500/10 border-zinc-500/20'
                    }`}>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className={`text-xs ${
                          rec.status === 'READY' ? 'bg-emerald-500/20 text-emerald-400'
                          : rec.status === 'RECORDING' ? 'bg-red-500/20 text-red-400'
                          : rec.status === 'PROCESSING' ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-zinc-500/20 text-zinc-400'
                        }`}>{rec.status}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(rec.createdAt).toLocaleString()}
                        </span>
                        {rec.duration && <span className="text-xs text-muted-foreground">{Math.floor(rec.duration / 60)}m {rec.duration % 60}s</span>}
                      </div>
                      {rec.fileUrl && (
                        <a
                          href={rec.fileUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download Recording
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
