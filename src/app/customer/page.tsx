'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';

interface Session {
  id: string;
  title: string;
  status: string;
  inviteToken: string;
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
    if (!loading && !user) { router.push('/'); return; }
    if (!loading && user && (user.role === 'AGENT' || user.role === 'ADMIN')) { router.push('/agent'); return; }
    if (!loading && user) { fetchSessions(); }
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-lg gradient-text">ConnectDesk</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Customer Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user?.name}</span>
            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Customer</Badge>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Welcome card */}
        <div className="glass rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/>
              <path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold">Welcome back, {user?.name}!</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Your support agent will send you an invite link to join a video session. 
              You can also paste your token below to join directly.
            </p>
          </div>
        </div>

        {/* Join with Token */}
        <Card className="glass-strong border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
                </svg>
              </span>
              Join a Support Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Have an invite token or link from your support agent? Enter it below to join the video call.
            </p>
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="token-input" className="sr-only">Invite Token</Label>
                <Input
                  id="token-input"
                  placeholder="Paste invite token or full link..."
                  value={inviteToken}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = val.match(/\/join\/([^?]+)/);
                    setInviteToken(match ? match[1] : val);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && joinSession()}
                />
              </div>
              <Button onClick={joinSession} disabled={joining || !inviteToken.trim()} className="glow-primary shrink-0">
                {joining ? 'Joining...' : 'Join Call'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Your Sessions */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Sessions</h2>
          {sessions.length === 0 ? (
            <Card className="glass border-0">
              <CardContent className="pt-6 text-center text-muted-foreground py-12">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-muted-foreground/40">
                  <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
                </svg>
                <p>No sessions yet</p>
                <p className="text-xs mt-1">Your agent will send you an email invite to join a call</p>
              </CardContent>
            </Card>
          ) : (
            sessions.map((session) => (
              <Card key={session.id} className="glass border-0 hover:bg-white/[0.03] transition-colors">
                <CardContent className="pt-5 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground/70 font-mono text-xs shrink-0">#{session.id.slice(-6).toUpperCase()}</span>
                        <h3 className="font-medium">{session.title}</h3>
                        <Badge variant="secondary" className={
                          session.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                          : session.status === 'WAITING' ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                          : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20'
                        }>
                          {session.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>Agent: {session.agent?.name ?? 'Unassigned'}</span>
                        <Separator orientation="vertical" className="h-3" />
                        <span>{new Date(session.createdAt).toLocaleString()}</span>
                        <Separator orientation="vertical" className="h-3" />
                        <span>{session._count?.messages ?? 0} messages</span>
                      </div>
                    </div>
                    {session.status !== 'ENDED' && (
                      <Button size="sm" onClick={() => router.push(`/session/${session.id}`)} className="glow-primary shrink-0">
                        {session.status === 'ACTIVE' ? 'Rejoin' : 'Join Call'}
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
