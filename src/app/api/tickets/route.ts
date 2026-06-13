import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// POST /api/tickets — Customer raises a support ticket (creates a session assigned to them)
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'CUSTOMER') {
      return NextResponse.json({ error: 'Only customers can raise tickets' }, { status: 403 });
    }

    const { title, description } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Find any available agent to assign (first agent found, or leave unassigned)
    const agent = await prisma.user.findFirst({
      where: { role: 'AGENT' },
      select: { id: true },
    });

    if (!agent) {
      return NextResponse.json({ error: 'No agents available. Please try again later.' }, { status: 503 });
    }

    const fullTitle = description?.trim()
      ? `${title.trim()} — ${description.trim()}`
      : title.trim();

    const session = await prisma.session.create({
      data: {
        title: fullTitle,
        agentId: agent.id,
        customerId: user.userId,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true, events: true } },
      },
    });

    // Log ticket creation event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: user.userId,
        event: 'SESSION_CREATED',
        metadata: { title: fullTitle, raisedByCustomer: true },
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Ticket creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
