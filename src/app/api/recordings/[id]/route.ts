import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// GET /api/recordings/[id] — Get recording for a session (Agent only)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'AGENT' && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Agent access only' }, { status: 403 });
    }

    const recordings = await prisma.recording.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ recordings });
  } catch (error) {
    console.error('Recording fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/recordings/[id] — Create/update recording entry (Agent only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'AGENT' && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Agent access only' }, { status: 403 });
    }

    const { status, fileUrl, duration } = await req.json();

    // Find existing recording or create new
    const existing = await prisma.recording.findFirst({
      where: { sessionId, status: { in: ['RECORDING', 'PROCESSING'] } },
    });

    let recording;
    if (existing) {
      recording = await prisma.recording.update({
        where: { id: existing.id },
        data: {
          status,
          fileUrl: fileUrl || existing.fileUrl,
          duration: duration || existing.duration,
          ...(status === 'RECORDING' ? {} : { updatedAt: new Date() }),
        },
      });
    } else {
      recording = await prisma.recording.create({
        data: {
          sessionId,
          status: status || 'RECORDING',
          fileUrl,
          duration,
        },
      });
    }

    return NextResponse.json({ recording });
  } catch (error) {
    console.error('Recording update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
