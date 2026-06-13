'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';

interface Session {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  agent: { id: string; name: string; email: string };
  _count: { messages: number };
}

export default function CustomerDashboard() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [inviteToken, setInviteToken] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

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
    if (!loading && user && (user.role === 'AGENT' || user.role === 'ADMIN')) {
      router.push('/agent');
      return;
    }
    if (!loading && user) {
      fetchSessions();
    }
  }, [loading, user, router, fetchSessions]);

  const joinSession = async () => {
    if (!inviteToken.trim()) return;
    setJoining(true);
    setError('');
    try {
      const res = await fetch('/api/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: inviteToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/session/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 glass-strong">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
              </svg>
            </div>
            <h1 className="font-bold text-lg gradient-text">ConnectDesk</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user?.name}</span>
            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Customer</Badge>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Join Session */}
        <Card className="glass-strong border-0">
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Join a Support Session</h2>
              <p className="text-sm text-muted-foreground">
                Enter the invite token provided by your support agent to start a video call.
              </p>
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="token-input" className="sr-only">Invite Token</Label>
                <Input
                  id="token-input"
                  placeholder="Paste invite token or link"
                  value={inviteToken}
                  onChange={(e) => {
                    // Extract token from URL if pasted
                    const val = e.target.value;
                    const match = val.match(/\/join\/(.+)$/);
                    setInviteToken(match ? match[1] : val);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && joinSession()}
                />
              </div>
              <Button onClick={joinSession} disabled={joining || !inviteToken.trim()} className="glow-primary">
                {joining ? 'Joining...' : 'Join Session'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Past Sessions */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Sessions</h2>
          {sessions.length === 0 ? (
            <Card className="glass border-0">
              <CardContent className="pt-6 text-center text-muted-foreground">
                <p>No sessions yet</p>
                <p className="text-xs mt-1">Join a session using an invite token to get started</p>
              </CardContent>
            </Card>
          ) : (
            sessions.map((session) => (
              <Card key={session.id} className="glass border-0 hover:bg-white/[0.03] transition-colors">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-medium">{session.title}</h3>
                        <Badge variant="secondary" className={
                          session.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                          : session.status === 'WAITING' ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                          : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20'
                        }>
                          {session.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>Agent: {session.agent.name}</span>
                        <Separator orientation="vertical" className="h-3" />
                        <span>{new Date(session.createdAt).toLocaleString()}</span>
                        <Separator orientation="vertical" className="h-3" />
                        <span>{session._count.messages} messages</span>
                      </div>
                    </div>
                    {session.status === 'ACTIVE' && (
                      <Button size="sm" onClick={() => router.push(`/session/${session.id}`)} className="glow-primary">
                        Rejoin
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
