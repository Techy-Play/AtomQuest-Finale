'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeToggle } from '@/components/theme-toggle';

interface Session {
  id: string;
  title: string;
  status: 'WAITING' | 'ACTIVE' | 'ENDED';
  inviteToken: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  agent: { id: string; name: string; email: string };
  customer: { id: string; name: string; email: string } | null;
  _count: { messages: number; events: number };
}

export default function AgentDashboard() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
      return;
    }
    if (!loading && user && user.role !== 'AGENT' && user.role !== 'ADMIN') {
      router.push('/customer');
      return;
    }
    if (!loading && user) {
      fetchSessions();
      const interval = setInterval(fetchSessions, 10000);
      return () => clearInterval(interval);
    }
  }, [loading, user, router, fetchSessions]);

  const createSession = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const data = await res.json();
      if (data.session) {
        setSessions((prev) => [data.session, ...prev]);
        setNewTitle('');
        setDialogOpen(false);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setCreating(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'WAITING': return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
      case 'ACTIVE': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
      case 'ENDED': return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20';
      default: return '';
    }
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return '—';
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const diff = Math.floor((e - s) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const activeSessions = sessions.filter((s) => s.status === 'ACTIVE');
  const waitingSessions = sessions.filter((s) => s.status === 'WAITING');
  const endedSessions = sessions.filter((s) => s.status === 'ENDED');

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-strong">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-lg gradient-text">ConnectDesk</h1>
              <p className="text-xs text-muted-foreground">Agent Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Badge variant="secondary" className="bg-blue-500/15 text-blue-400 border-blue-500/20">
              {user?.role}
            </Badge>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="glass border-0">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold gradient-text">{sessions.length}</div>
              <p className="text-sm text-muted-foreground">Total Sessions</p>
            </CardContent>
          </Card>
          <Card className="glass border-0">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-emerald-400">{activeSessions.length}</div>
              <p className="text-sm text-muted-foreground">Active Now</p>
            </CardContent>
          </Card>
          <Card className="glass border-0">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-amber-400">{waitingSessions.length}</div>
              <p className="text-sm text-muted-foreground">Waiting</p>
            </CardContent>
          </Card>
          <Card className="glass border-0">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-zinc-400">{endedSessions.length}</div>
              <p className="text-sm text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
        </div>

        {/* Create Session */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Support Sessions</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button className="glow-primary" />}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Session
            </DialogTrigger>
            <DialogContent className="glass-strong border-0">
              <DialogHeader>
                <DialogTitle>Create Support Session</DialogTitle>
                <DialogDescription>
                  Create a new video support session. A unique invite link will be generated for the customer.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="session-title">Session Title</Label>
                  <Input
                    id="session-title"
                    placeholder="e.g., Router Setup Issue — Ticket #1234"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createSession()}
                  />
                </div>
                <Button onClick={createSession} disabled={creating || !newTitle.trim()} className="w-full">
                  {creating ? 'Creating...' : 'Create Session'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Sessions List */}
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">All ({sessions.length})</TabsTrigger>
            <TabsTrigger value="active">Active ({activeSessions.length})</TabsTrigger>
            <TabsTrigger value="waiting">Waiting ({waitingSessions.length})</TabsTrigger>
            <TabsTrigger value="ended">History ({endedSessions.length})</TabsTrigger>
          </TabsList>

          {['all', 'active', 'waiting', 'ended'].map((tab) => {
            const filtered = tab === 'all' ? sessions
              : tab === 'active' ? activeSessions
              : tab === 'waiting' ? waitingSessions
              : endedSessions;

            return (
              <TabsContent key={tab} value={tab} className="space-y-3">
                {filtered.length === 0 ? (
                  <Card className="glass border-0">
                    <CardContent className="pt-6 text-center text-muted-foreground">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-muted-foreground/40">
                        <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
                      </svg>
                      <p>No sessions found</p>
                      <p className="text-xs mt-1">Create a new session to get started</p>
                    </CardContent>
                  </Card>
                ) : (
                  filtered.map((session) => (
                    <Card key={session.id} className="glass border-0 hover:bg-white/[0.03] transition-colors">
                      <CardContent className="pt-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2.5">
                              <h3 className="font-medium text-base flex items-center">
                                <span className="text-muted-foreground/70 font-mono text-sm mr-2">
                                  #{session.id.slice(-6).toUpperCase()}
                                </span>
                                {session.title}
                                {session.customer && (
                                  <span className="ml-2 text-muted-foreground font-normal">
                                    — {session.customer.name}
                                  </span>
                                )}
                              </h3>
                              <Badge variant="secondary" className={getStatusColor(session.status)}>
                                {session.status}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>Created {new Date(session.createdAt).toLocaleString()}</span>
                              <Separator orientation="vertical" className="h-3" />
                              {session.customer ? (
                                <span className="text-emerald-400">Customer: {session.customer.name}</span>
                              ) : (
                                <span className="text-amber-400">Awaiting customer</span>
                              )}
                              <Separator orientation="vertical" className="h-3" />
                              <span>{session._count.messages} messages</span>
                              {session.startedAt && (
                                <>
                                  <Separator orientation="vertical" className="h-3" />
                                  <span>Duration: {formatDuration(session.startedAt, session.endedAt)}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyInviteLink(session.inviteToken)}
                              className="text-xs"
                            >
                              {copiedToken === session.inviteToken ? '✓ Copied!' : 'Copy Link'}
                            </Button>
                            {session.status !== 'ENDED' && (
                              <Button
                                size="sm"
                                onClick={() => router.push(`/session/${session.id}`)}
                                className="glow-primary text-xs"
                              >
                                {session.status === 'ACTIVE' ? 'Rejoin Call' : 'Join Call'}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(`/history/${session.id}`)}
                              className="text-xs"
                            >
                              Details
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </main>
    </div>
  );
}
