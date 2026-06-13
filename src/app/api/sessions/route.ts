import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// GET /api/sessions — List sessions for the current user
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let sessions;
    if (user.role === 'ADMIN') {
      sessions = await prisma.session.findMany({
        include: {
          agent: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true, events: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else if (user.role === 'AGENT') {
      sessions = await prisma.session.findMany({
        where: { agentId: user.userId },
        include: {
          agent: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true, events: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      sessions = await prisma.session.findMany({
        where: { customerId: user.userId },
        include: {
          agent: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true, events: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Sessions list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/sessions — Create a new session (Agent only)
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'AGENT' && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only agents can create sessions' }, { status: 403 });
    }

    const { title } = await req.json();
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const session = await prisma.session.create({
      data: {
        title,
        agentId: user.userId,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true, events: true } },
      },
    });

    // Log session creation event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: user.userId,
        event: 'SESSION_CREATED',
        metadata: { title },
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Session creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
