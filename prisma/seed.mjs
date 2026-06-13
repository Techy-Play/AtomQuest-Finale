// Seed script for populating demo data
// Run with: node prisma/seed.mjs

import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('🌱 Seeding database...');

  const agentHash = await bcrypt.hash('agent123', 12);
  const customerHash = await bcrypt.hash('customer123', 12);
  const adminHash = await bcrypt.hash('admin123', 12);

  // Upsert agent
  await client.query(`
    INSERT INTO users (id, name, email, "passwordHash", role, "createdAt", "updatedAt")
    VALUES ('agent-001', 'Sarah Mitchell', 'agent@atomquest.com', $1, 'AGENT', NOW(), NOW())
    ON CONFLICT (email) DO NOTHING
  `, [agentHash]);

  // Upsert customer
  await client.query(`
    INSERT INTO users (id, name, email, "passwordHash", role, "createdAt", "updatedAt")
    VALUES ('customer-001', 'John Doe', 'customer@example.com', $1, 'CUSTOMER', NOW(), NOW())
    ON CONFLICT (email) DO NOTHING
  `, [customerHash]);

  // Upsert admin
  await client.query(`
    INSERT INTO users (id, name, email, "passwordHash", role, "createdAt", "updatedAt")
    VALUES ('admin-001', 'Admin User', 'admin@atomquest.com', $1, 'ADMIN', NOW(), NOW())
    ON CONFLICT (email) DO NOTHING
  `, [adminHash]);

  console.log('✅ Created demo users:');
  console.log('   Agent:    agent@atomquest.com / agent123');
  console.log('   Customer: customer@example.com / customer123');
  console.log('   Admin:    admin@atomquest.com / admin123');

  await client.end();
  console.log('🎉 Seed complete!');
}

main().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
