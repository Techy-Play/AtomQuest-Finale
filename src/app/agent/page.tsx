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

interface Customer {
  id: string;
  name: string;
  email: string;
}

export default function AgentDashboard() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // New Session form state
  const [newTitle, setNewTitle] = useState('');
  const [inviteMode, setInviteMode] = useState<'existing' | 'email'>('email');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [lastCreated, setLastCreated] = useState<{ inviteUrl: string; title: string } | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/users/customers');
      const data = await res.json();
      if (data.customers) setCustomers(data.customers);
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) { router.push('/'); return; }
    if (!loading && user && user.role !== 'AGENT' && user.role !== 'ADMIN') { router.push('/customer'); return; }
    if (!loading && user) {
      fetchSessions();
      fetchCustomers();
      const interval = setInterval(fetchSessions, 10000);
      return () => clearInterval(interval);
    }
  }, [loading, user, router, fetchSessions, fetchCustomers]);

  const createSession = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    setCreateError('');

    try {
      const body: Record<string, string> = { title: newTitle.trim() };
      if (inviteMode === 'existing' && selectedCustomer) {
        body.customerId = selectedCustomer.id;
        body.customerEmail = selectedCustomer.email;
        body.customerName = selectedCustomer.name;
      } else if (inviteMode === 'email' && inviteEmail.trim()) {
        body.customerEmail = inviteEmail.trim();
        body.customerName = inviteName.trim();
      }

      const res = await fetch('/api/sessions/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSessions((prev) => [data.session, ...prev]);
      setLastCreated({ inviteUrl: data.inviteUrl, title: newTitle.trim() });
      // Reset form
      setNewTitle('');
      setInviteEmail('');
      setInviteName('');
      setSelectedCustomer(null);
      setCustomerSearch('');
    } catch (err) {
      setCreateError((err as Error).message);
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

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.email.toLowerCase().includes(customerSearch.toLowerCase())
  );

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
            <Badge variant="secondary" className="bg-blue-500/15 text-blue-400 border-blue-500/20">{user?.role}</Badge>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Sessions', value: sessions.length, color: 'gradient-text' },
            { label: 'Active Now', value: activeSessions.length, color: 'text-emerald-400' },
            { label: 'Waiting', value: waitingSessions.length, color: 'text-amber-400' },
            { label: 'Completed', value: endedSessions.length, color: 'text-zinc-400' },
          ].map((stat) => (
            <Card key={stat.label} className="glass border-0">
              <CardContent className="pt-6">
                <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Create Session */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Support Sessions</h2>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setLastCreated(null); setCreateError(''); } }}>
            <DialogTrigger render={<Button className="glow-primary" />}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Session
            </DialogTrigger>
            <DialogContent className="glass-strong border-0 max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Support Session</DialogTitle>
                <DialogDescription>
                  Create a session and invite a customer by selecting from existing customers or by email.
                </DialogDescription>
              </DialogHeader>

              {lastCreated ? (
                /* Success state */
                <div className="space-y-4 pt-2">
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center space-y-2">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <p className="font-semibold text-emerald-400">Session Created!</p>
                    <p className="text-sm text-muted-foreground">{lastCreated.title}</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">Invite Link</Label>
                    <div className="flex gap-2">
                      <code className="flex-1 text-xs bg-muted/40 rounded-lg px-3 py-2 font-mono text-primary truncate">
                        {lastCreated.inviteUrl}
                      </code>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(lastCreated.inviteUrl); }}>
                        Copy
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setLastCreated(null); }}>
                      Create Another
                    </Button>
                    <Button className="flex-1" onClick={() => setDialogOpen(false)}>Done</Button>
                  </div>
                </div>
              ) : (
                /* Creation form */
                <div className="space-y-5 pt-2">
                  {createError && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{createError}</div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="session-title">Session Title <span className="text-destructive">*</span></Label>
                    <Input
                      id="session-title"
                      placeholder="e.g., Router Setup Issue — Customer Support"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Invite Customer</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setInviteMode('email')}
                        className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                          inviteMode === 'email'
                            ? 'bg-primary/15 border-primary/40 text-primary'
                            : 'glass border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto mb-1">
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                        </svg>
                        Invite by Email
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviteMode('existing')}
                        className={`p-3 rounded-xl border text-sm font-medium transition-all ${
                          inviteMode === 'existing'
                            ? 'bg-primary/15 border-primary/40 text-primary'
                            : 'glass border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto mb-1">
                          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        </svg>
                        Existing Customer
                      </button>
                    </div>

                    {inviteMode === 'email' ? (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="invite-name">Customer Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                          <Input
                            id="invite-name"
                            placeholder="John Doe"
                            value={inviteName}
                            onChange={(e) => setInviteName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite-email">Email Address</Label>
                          <Input
                            id="invite-email"
                            type="email"
                            placeholder="customer@example.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            An invite email with the join link will be sent automatically.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          placeholder="Search customers..."
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                        />
                        <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl border border-border p-1">
                          {filteredCustomers.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No customers found</p>
                          ) : (
                            filteredCustomers.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => setSelectedCustomer(selectedCustomer?.id === c.id ? null : c)}
                                className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors flex items-center justify-between gap-2 ${
                                  selectedCustomer?.id === c.id
                                    ? 'bg-primary/15 text-primary'
                                    : 'hover:bg-muted/50 text-foreground'
                                }`}
                              >
                                <div>
                                  <p className="font-medium">{c.name}</p>
                                  <p className="text-xs text-muted-foreground">{c.email}</p>
                                </div>
                                {selectedCustomer?.id === c.id && (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary shrink-0">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                        {selectedCustomer && (
                          <p className="text-xs text-emerald-400">✓ Selected: {selectedCustomer.name} — an invite email will also be sent</p>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={createSession}
                    disabled={creating || !newTitle.trim()}
                    className="w-full glow-primary"
                  >
                    {creating ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                        Creating...
                      </span>
                    ) : (inviteMode === 'email' && inviteEmail.trim()) || (inviteMode === 'existing' && selectedCustomer)
                      ? '📧 Create & Send Invite'
                      : 'Create Session'}
                  </Button>
                </div>
              )}
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
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="text-muted-foreground/70 font-mono text-sm shrink-0">
                                #{session.id.slice(-6).toUpperCase()}
                              </span>
                              <h3 className="font-medium text-base truncate">{session.title}</h3>
                              <Badge variant="secondary" className={getStatusColor(session.status)}>
                                {session.status}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>Created {new Date(session.createdAt).toLocaleString()}</span>
                              <Separator orientation="vertical" className="h-3" />
                              {session.customer ? (
                                <span className="text-emerald-400">👤 {session.customer.name}</span>
                              ) : (
                                <span className="text-amber-400">⏳ Awaiting customer</span>
                              )}
                              <Separator orientation="vertical" className="h-3" />
                              <span>{session._count?.messages ?? 0} messages</span>
                              {session.startedAt && (
                                <>
                                  <Separator orientation="vertical" className="h-3" />
                                  <span>⏱ {formatDuration(session.startedAt, session.endedAt)}</span>
                                </>
                              )}
                            </div>
                            {session.status !== 'ENDED' && (
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="text-xs text-muted-foreground">Token:</span>
                                <code className="text-xs font-mono bg-muted/40 px-2 py-0.5 rounded text-primary select-all">
                                  {session.inviteToken}
                                </code>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
