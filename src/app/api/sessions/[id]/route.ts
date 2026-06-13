import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// GET /api/sessions/[id] — Get session details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, name: true, email: true, role: true } },
        customer: { select: { id: true, name: true, email: true, role: true } },
        messages: {
          include: {
            sender: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        events: {
          include: {
            user: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        recordings: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Session detail error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/sessions/[id] — Update session (end session, etc.)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { status } = body;

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (status === 'ENDED') {
      updateData.status = 'ENDED';
      updateData.endedAt = new Date();
    } else if (status === 'ACTIVE') {
      updateData.status = 'ACTIVE';
      updateData.startedAt = new Date();
    }

    const updated = await prisma.session.update({
      where: { id },
      data: updateData,
      include: {
        agent: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, email: true } },
      },
    });

    // Log status change event
    await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        userId: user.userId,
        event: `SESSION_${status}`,
        metadata: { previousStatus: session.status },
      },
    });

    return NextResponse.json({ session: updated });
  } catch (error) {
    console.error('Session update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
