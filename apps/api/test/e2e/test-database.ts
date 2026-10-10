import { config as loadDotenv } from 'dotenv';

/**
 * URL of the database used by the e2e tests: TEST_DATABASE_URL when set (CI),
 * otherwise the DATABASE_URL of apps/api/.env with the database renamed to
 * "<name>_test". The tests truncate every table, so the name must end in "_test".
 */
export function testDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit) {
    return assertTestDatabase(explicit);
  }
  const parsed: Record<string, string> = {};
  loadDotenv({ processEnv: parsed, quiet: true });
  const base = parsed['DATABASE_URL'];
  if (!base) {
    throw new Error('e2e tests need TEST_DATABASE_URL, or DATABASE_URL in apps/api/.env');
  }
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_test$/, '')}_test`;
  return assertTestDatabase(url.toString());
}

export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

function assertTestDatabase(url: string): string {
  if (!databaseName(url).endsWith('_test')) {
    throw new Error('Refusing to run e2e tests: the database name must end with "_test"');
  }
  return url;
}
