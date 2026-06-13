'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/theme-toggle';

export default function JoinPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const { user, loading, login } = useAuth();

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  // Guest form
  const [name, setName] = useState(searchParams.get('name') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');

  // Existing user login form
  const [loginMode, setLoginMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState(searchParams.get('email') || '');
  const [loginPassword, setLoginPassword] = useState('');

  const joinSession = async (opts?: { name?: string; email?: string }) => {
    setJoining(true);
    setError('');
    try {
      const body: Record<string, string> = { inviteToken: token };
      if (opts?.name) body.name = opts.name;
      if (opts?.email) body.email = opts.email;

      const res = await fetch('/api/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/session/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  };

  // Auto-join if already authenticated
  useEffect(() => {
    if (!loading && user) {
      joinSession();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  const handleGuestJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    await joinSession({ name: name.trim(), email: email.trim() });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(loginEmail, loginPassword);
      // useEffect will trigger joinSession after user state updates
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading || (user && joining)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Joining your support session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-500/5 blur-[120px]" />
      </div>

      {/* Theme toggle */}
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/20 flex items-center justify-center mx-auto">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-primary">
              <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold gradient-text">ConnectDesk</h1>
          <p className="text-muted-foreground text-sm">You've been invited to a video support session</p>
        </div>

        <Card className="glass-strong border-0 shadow-2xl shadow-black/30">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">
              {loginMode ? 'Sign In to Join' : 'Join as Guest'}
            </CardTitle>
            <CardDescription>
              {loginMode
                ? 'Sign in with your existing account to continue'
                : 'Enter your name and email — no account required'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}

            {!loginMode ? (
              /* Guest join form */
              <form onSubmit={handleGuestJoin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="guest-name">Your Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="guest-name"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guest-email">Email Address <span className="text-destructive">*</span></Label>
                  <Input
                    id="guest-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    We'll save your details so you can access session history
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full h-11 glow-primary text-base"
                  disabled={joining || !name.trim() || !email.trim()}
                >
                  {joining ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                      Joining...
                    </span>
                  ) : '🎥 Join Session'}
                </Button>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setLoginMode(true)}
                      className="text-primary hover:underline font-medium"
                    >
                      Sign in
                    </button>
                  </p>
                </div>
              </form>
            ) : (
              /* Login form */
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full h-11 glow-primary text-base" disabled={joining}>
                  {joining ? 'Signing in...' : 'Sign In & Join'}
                </Button>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    New here?{' '}
                    <button
                      type="button"
                      onClick={() => setLoginMode(false)}
                      className="text-primary hover:underline font-medium"
                    >
                      Join as guest
                    </button>
                  </p>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Secure, browser-based video call. No downloads required.
        </p>
      </div>
    </div>
  );
}
