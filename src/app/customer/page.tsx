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
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Raise ticket state
  const [ticketTitle, setTicketTitle] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');
  const [raisingTicket, setRaisingTicket] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const [ticketSuccess, setTicketSuccess] = useState('');

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

  const raiseTicket = async () => {
    if (!ticketTitle.trim()) return;
    setRaisingTicket(true);
    setTicketError('');
    setTicketSuccess('');
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: ticketTitle, description: ticketDesc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTicketSuccess(`Ticket raised! Your invite token: ${data.session.inviteToken}`);
      setTicketTitle('');
      setTicketDesc('');
      fetchSessions();
    } catch (err) {
      setTicketError((err as Error).message);
    } finally {
      setRaisingTicket(false);
    }
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
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

        {/* Raise a Ticket */}
        <Card className="glass-strong border-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14,2 14,8 20,8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </span>
              Raise a Support Ticket
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Submit a new support request. A session will be created and you&apos;ll receive an invite token to join the video call.
            </p>
            {ticketError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{ticketError}</div>
            )}
            {ticketSuccess && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-mono break-all">{ticketSuccess}</div>
            )}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-title">Issue Title <span className="text-destructive">*</span></Label>
                <Input
                  id="ticket-title"
                  placeholder="e.g. Cannot connect to VPN, Router setup issue..."
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && raiseTicket()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-desc">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  id="ticket-desc"
                  placeholder="Briefly describe your issue..."
                  value={ticketDesc}
                  onChange={(e) => setTicketDesc(e.target.value)}
                />
              </div>
              <Button onClick={raiseTicket} disabled={raisingTicket || !ticketTitle.trim()} className="w-full glow-primary">
                {raisingTicket ? 'Raising Ticket...' : 'Raise Ticket'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Join with Token */}
        <Card className="glass border-0">
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Join with Invite Token</h2>
              <p className="text-sm text-muted-foreground">
                Already have a token from your agent? Enter it below to join directly.
              </p>
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="token-input" className="sr-only">Invite Token</Label>
                <Input
                  id="token-input"
                  placeholder="Paste invite token or link"
                  value={inviteToken}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = val.match(/\/join\/(.+)$/);
                    setInviteToken(match ? match[1] : val);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && joinSession()}
                />
              </div>
              <Button onClick={joinSession} disabled={joining || !inviteToken.trim()} className="glow-primary">
                {joining ? 'Joining...' : 'Join'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Your Sessions */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Sessions</h2>
          {sessions.length === 0 ? (
            <Card className="glass border-0">
              <CardContent className="pt-6 text-center text-muted-foreground">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-muted-foreground/40">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14,2 14,8 20,8"/>
                </svg>
                <p>No sessions yet</p>
                <p className="text-xs mt-1">Raise a ticket or join with an invite token</p>
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
                      {/* Invite token — visible so customer can share or re-enter */}
                      {session.status !== 'ENDED' && session.inviteToken && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-foreground">Invite token:</span>
                          <code className="text-xs font-mono bg-muted/40 px-2 py-0.5 rounded text-primary select-all">
                            {session.inviteToken}
                          </code>
                          <button
                            onClick={() => copyToken(session.inviteToken)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                          >
                            {copiedToken === session.inviteToken ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                      )}
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
