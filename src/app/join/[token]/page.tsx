'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function JoinPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const { user, loading, login, register } = useAuth();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);

  // Quick auth form for customers
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      joinSession();
    } else if (!loading && !user) {
      setNeedsAuth(true);
    }
  }, [loading, user]);

  const joinSession = async () => {
    setJoining(true);
    setError('');
    try {
      const res = await fetch('/api/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteToken: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/session/${data.session.id}`);
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  };

  const handleQuickAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(name, email, password, 'CUSTOMER');
      }
      // After auth, the useEffect will trigger joinSession
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading || (user && joining)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Joining support session...</p>
        </div>
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-[120px]" />
        </div>
        <Card className="glass-strong border-0 w-full max-w-md relative z-10">
          <CardHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
                </svg>
              </div>
              <span className="font-bold gradient-text">ConnectDesk</span>
            </div>
            <CardTitle>{isLogin ? 'Sign In' : 'Quick Join'}</CardTitle>
            <CardDescription>
              {isLogin
                ? 'Sign in to join the support session'
                : 'Create a quick account to join the video support session'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}
            <form onSubmit={handleQuickAuth} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="join-name">Your Name</Label>
                  <Input
                    id="join-name"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="join-email">Email</Label>
                <Input
                  id="join-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-password">Password</Label>
                <Input
                  id="join-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full glow-primary">
                {isLogin ? 'Sign In & Join' : 'Join Session'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-primary hover:underline"
                >
                  {isLogin ? 'Create one' : 'Sign in'}
                </button>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
