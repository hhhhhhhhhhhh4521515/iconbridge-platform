import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedSuperAdmin } from './seed/admin.js';
import { loadSeedEnv } from './seed/env.js';
import { seedReferenceData } from './seed/reference.js';
import { seedSampleData } from './seed/sample.js';

// Seed entry point (`pnpm db:seed`). Safe to run again: rows are created when
// missing and existing rows are left untouched.
//   every environment: destinations, job categories, settings, first super admin
//   development only:   sample jobs, home slides, success stories, fake candidates

const log = (message: string) => process.stdout.write(`${message}\n`);

const env = loadSeedEnv(process.env);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

try {
  await seedReferenceData(prisma);
  log('Reference data: destinations, job categories and settings are in place.');

  const admin = await seedSuperAdmin(prisma, env);
  log(`Super admin: ${admin.created ? 'created' : 'already exists, left unchanged'}.`);

  if (env.NODE_ENV === 'development') {
    const counts = await seedSampleData(prisma, env, admin.id);
    log(
      `Sample data (development only): ${counts.jobs} jobs, ${counts.homeSlides} home slides, ` +
        `${counts.successStories} success stories, ${counts.candidates} fake candidates.`,
    );
  } else {
    log(`Sample data: skipped (NODE_ENV=${env.NODE_ENV}).`);
  }
} finally {
  await prisma.$disconnect();
}
