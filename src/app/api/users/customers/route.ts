import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

// GET /api/users/customers — Agent fetches list of registered customers
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'AGENT' && user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Agent access only' }, { status: 403 });
    }

    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ customers });
  } catch (error) {
    console.error('Customers fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
