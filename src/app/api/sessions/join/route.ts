import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser, hashPassword, signToken } from '@/lib/auth';
import { cookies } from 'next/headers';

// POST /api/sessions/join — Join via invite token (supports authenticated + guest)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { inviteToken, name, email } = body;

    if (!inviteToken) {
      return NextResponse.json({ error: 'Invite token is required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { inviteToken },
      include: { agent: { select: { id: true, name: true, email: true } } },
    });

    if (!session) return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
    if (session.status === 'ENDED') {
      return NextResponse.json({ error: 'This session has already ended' }, { status: 400 });
    }

    // Attempt to get existing auth
    let user = await getAuthUser();

    // If not authenticated but name+email provided → auto-register as guest CUSTOMER
    if (!user && name?.trim() && email?.trim()) {
      const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

      let dbUser;
      if (existing) {
        dbUser = existing;
      } else {
        // Auto-register guest customer with random password
        const tempPass = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        dbUser = await prisma.user.create({
          data: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            passwordHash: await hashPassword(tempPass),
            role: 'CUSTOMER',
          },
        });
      }

      // Sign a JWT and set cookie
      const token = signToken({
        userId: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role as 'CUSTOMER',
      });

      const cookieStore = await cookies();
      cookieStore.set('auth-token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24,
        path: '/',
      });

      user = { userId: dbUser.id, email: dbUser.email, name: dbUser.name, role: dbUser.role as 'CUSTOMER' };
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized — please provide your name and email to join' }, { status: 401 });
    }

    // If user is the agent, just return the session
    if (session.agentId === user.userId) {
      return NextResponse.json({ session });
    }

    // Assign customer to session
    const updated = await prisma.session.update({
      where: { id: session.id },
      data: {
        customerId: user.userId,
        status: session.status === 'WAITING' ? 'ACTIVE' : session.status,
        startedAt: session.startedAt || new Date(),
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, email: true } },
      },
    });

    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: user.userId,
        event: 'JOINED',
        metadata: { role: user.role },
      },
    });

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error('Session join error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
