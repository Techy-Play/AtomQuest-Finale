import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo users
  const agentHash = await bcrypt.hash('agent123', 12);
  const customerHash = await bcrypt.hash('customer123', 12);
  const adminHash = await bcrypt.hash('admin123', 12);

  const agent = await prisma.user.upsert({
    where: { email: 'agent@atomquest.com' },
    update: {},
    create: {
      name: 'Sarah Mitchell',
      email: 'agent@atomquest.com',
      passwordHash: agentHash,
      role: 'AGENT',
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      name: 'John Doe',
      email: 'customer@example.com',
      passwordHash: customerHash,
      role: 'CUSTOMER',
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@atomquest.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@atomquest.com',
      passwordHash: adminHash,
      role: 'ADMIN',
    },
  });

  console.log('✅ Created users:');
  console.log(`   Agent:    ${agent.email} / agent123`);
  console.log(`   Customer: ${customer.email} / customer123`);
  console.log(`   Admin:    ${admin.email} / admin123`);
}

main()
  .then(() => {
    console.log('🎉 Seed complete!');
    process.exit(0);
  })
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  });
