import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// POST /api/sessions/join — Join a session via invite token
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { inviteToken } = await req.json();
    if (!inviteToken) {
      return NextResponse.json({ error: 'Invite token is required' }, { status: 400 });
    }

    const session = await prisma.session.findUnique({
      where: { inviteToken },
      include: {
        agent: { select: { id: true, name: true, email: true } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 });
    }

    if (session.status === 'ENDED') {
      return NextResponse.json({ error: 'This session has already ended' }, { status: 400 });
    }

    // If user is the agent of this session, just return the session
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

    // Log join event
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
