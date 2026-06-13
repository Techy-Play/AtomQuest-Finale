import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  // Use explicit params if connectionString parsing fails
  const pool = connectionString
    ? new Pool({ connectionString })
    : new Pool({
        host: 'ep-sweet-tooth-ahoa8t1r.c-3.us-east-1.aws.neon.tech',
        database: 'neondb',
        user: 'neondb_owner',
        password: 'npg_p93hFdoGElyR',
        ssl: true,
        max: 5,
      });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any);
  return new PrismaClient({ adapter } as any);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
