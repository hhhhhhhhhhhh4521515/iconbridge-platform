import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Read directly so `prisma generate` also works where no database is configured (CI, Docker build).
    url: process.env['DATABASE_URL'] ?? '',
  },
});
