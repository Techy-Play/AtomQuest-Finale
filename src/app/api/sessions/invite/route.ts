import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { sendInviteEmail } from '@/lib/email';

// POST /api/sessions/invite — Agent creates session and optionally sends email invite
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'AGENT' && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only agents can create sessions' }, { status: 403 });
    }

    const { title, customerId, customerEmail, customerName } = await req.json();
    if (!title?.trim()) {
      return NextResponse.json({ error: 'Session title is required' }, { status: 400 });
    }

    // Create session
    const session = await prisma.session.create({
      data: {
        title: title.trim(),
        agentId: user.userId,
        customerId: customerId || null,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true, events: true } },
      },
    });

    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        userId: user.userId,
        event: 'SESSION_CREATED',
        metadata: { title: title.trim() },
      },
    });

    // Derive the base URL from the incoming request so invite links work from any host (localhost or LAN IP)
    const host = req.headers.get('host') || 'localhost:3000';
    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || \://\System.Management.Automation.Internal.Host.InternalHost;
    const inviteUrl = `${appUrl}/join/${session.inviteToken}`;

    // Send email invite if customerEmail provided
    if (customerEmail?.trim()) {
      const emailTo = customerEmail.trim();
      const nameParam = customerName ? `?name=${encodeURIComponent(customerName)}&email=${encodeURIComponent(emailTo)}` : `?email=${encodeURIComponent(emailTo)}`;
      const joinUrl = `${appUrl}/join/${session.inviteToken}${nameParam}`;

      try {
        await sendInviteEmail({
          to: emailTo,
          agentName: user.name,
          sessionTitle: title.trim(),
          joinUrl,
          customerName: customerName || undefined,
        });
      } catch (emailErr) {
        console.error('Failed to send invite email:', emailErr);
        // Don't fail the whole request if email fails
      }
    }

    return NextResponse.json({ session, inviteUrl }, { status: 201 });
  } catch (error) {
    console.error('Session invite error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
