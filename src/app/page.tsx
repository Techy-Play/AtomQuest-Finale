'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';

export default function LoginPage() {
  const router = useRouter();
  const { login, register, user, loading } = useAuth();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState('CUSTOMER');

  // Join form
  const [inviteToken, setInviteToken] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'AGENT' || user.role === 'ADMIN') {
        router.push('/agent');
      } else {
        router.push('/customer');
      }
    }
  }, [loading, user, router]);

  if (!loading && user) {
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(loginEmail, loginPassword);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await register(regName, regEmail, regPassword, regRole);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickLogin = async (email: string, password: string) => {
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinSession = () => {
    if (inviteToken.trim()) {
      router.push(`/join/${inviteToken.trim()}`);
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4 sm:p-8 bg-background">
      {/* Theme Toggle */}
      <div className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50">
        <ThemeToggle />
      </div>

      {/* Premium Background effects */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[150px] mix-blend-screen animate-in fade-in duration-1000" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-accent/10 blur-[150px] mix-blend-screen animate-in fade-in duration-1000 delay-300" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-blue-500/5 blur-[200px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-6xl grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        {/* Left side — Branding */}
        <div className="space-y-8 text-center lg:text-left">
          <div className="space-y-4">
            <div className="flex items-center gap-4 justify-center lg:justify-start">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center glow-primary shadow-2xl shadow-primary/20 ring-1 ring-primary/30">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/>
                </svg>
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight gradient-text drop-shadow-sm">
                ConnectDesk
              </h1>
            </div>
            <p className="text-lg sm:text-xl text-muted-foreground/90 max-w-lg leading-relaxed mx-auto lg:mx-0">
              Enterprise-grade video support platform with server-routed WebRTC, 
              real-time collaboration, and complete session management.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: 'SERVER', text: 'Server-routed media via mediasoup SFU — no P2P' },
              { icon: 'CHAT', text: 'Real-time chat with persistent message history' },
              { icon: 'SHIELD', text: 'Role-based access with agent & customer separation' }
            ].map((feature, idx) => (
              <div key={idx} className="flex items-center gap-4 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors group">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors border border-primary/10">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                    {feature.icon === 'SERVER' && <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>}
                    {feature.icon === 'CHAT' && <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>}
                    {feature.icon === 'SHIELD' && <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>}
                  </svg>
                </div>
                {feature.text}
              </div>
            ))}
          </div>

          {/* Quick login cards */}
          <div className="space-y-3 pt-4">
            <div className="flex items-center gap-4">
              <div className="h-px bg-border flex-1" />
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Demo Accounts</p>
              <div className="h-px bg-border flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleQuickLogin('agent@atomquest.com', 'agent123')}
                disabled={isSubmitting}
                className="glass rounded-xl p-4 text-left hover:bg-white/[0.04] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group border border-white/[0.05]"
              >
                <Badge variant="secondary" className="mb-2 bg-blue-500/15 text-blue-400 border-blue-500/20 group-hover:bg-blue-500/25">Agent</Badge>
                <p className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">agent@atomquest.com</p>
              </button>
              <button
                onClick={() => handleQuickLogin('customer@example.com', 'customer123')}
                disabled={isSubmitting}
                className="glass rounded-xl p-4 text-left hover:bg-white/[0.04] hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group border border-white/[0.05]"
              >
                <Badge variant="secondary" className="mb-2 bg-emerald-500/15 text-emerald-400 border-emerald-500/20 group-hover:bg-emerald-500/25">Customer</Badge>
                <p className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">customer@example.com</p>
              </button>
            </div>
          </div>
        </div>

        {/* Right side — Forms */}
        <Card className="glass-strong border border-white/[0.08] shadow-2xl shadow-black/50 lg:ml-8 relative overflow-hidden backdrop-blur-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
          <CardHeader className="pb-6 relative z-10">
            <CardTitle className="text-2xl font-bold">Get Started</CardTitle>
            <CardDescription className="text-base">Sign in, create an account, or join a support session</CardDescription>
          </CardHeader>
          <CardContent className="relative z-10">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}

            <Tabs defaultValue="login" className="space-y-4">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
                <TabsTrigger value="join">Join Call</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
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
                  <Button type="submit" className="w-full h-11 text-base glow-primary mt-2" disabled={isSubmitting}>
                    {isSubmitting ? 'Signing in...' : 'Sign In'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Full Name</Label>
                    <Input
                      id="reg-name"
                      placeholder="John Doe"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">Email</Label>
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="you@example.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">Password</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="••••••••"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-role">Role</Label>
                    <Select value={regRole} onValueChange={setRegRole}>
                      <SelectTrigger id="reg-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CUSTOMER">Customer</SelectItem>
                        <SelectItem value="AGENT">Support Agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating account...' : 'Create Account'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="join">
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Received a support session link? Enter the invite token below to join the call.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="invite-token">Invite Token</Label>
                    <Input
                      id="invite-token"
                      placeholder="Paste your invite token here"
                      value={inviteToken}
                      onChange={(e) => setInviteToken(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleJoinSession} className="w-full" disabled={!inviteToken.trim()}>
                    Join Support Session
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
