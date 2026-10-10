import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { databaseName, testDatabaseUrl } from './test-database.js';

/** Runs once before the e2e suites: creates the test database if needed and applies the migrations. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const name = databaseName(url);

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      // The name comes from configuration and was checked to end in "_test"; quoted as an identifier.
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await client.end();
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
