import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// Seed entry point (`pnpm db:seed`). Seed data arrives with the data model:
// destinations, categories and the first super admin (from environment variables).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }),
});

try {
  await prisma.$queryRaw`SELECT 1`;
  process.stdout.write('Database reachable. Nothing to seed yet.\n');
} finally {
  await prisma.$disconnect();
}
