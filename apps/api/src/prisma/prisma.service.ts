import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { poolConfig } from './database-config.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /**
   * Number of SQL statements sent since the start. Read by the tests that check a list
   * endpoint makes the same number of queries for 3 rows as for 30 (no "N+1").
   */
  queryCount = 0;

  /** DATABASE_AUTH=entra: what the pool calls for the token of each new connection. */
  private readonly databaseToken: (() => string | Promise<string>) | null;

  constructor(config: ConfigService<Env, true>) {
    const pool = poolConfig(
      config.get('DATABASE_URL', { infer: true }),
      config.get('DATABASE_AUTH', { infer: true }),
    );
    // The pool connects on first query, so the API can start (and report
    // "not ready") while the database is still coming up.
    super({
      adapter: new PrismaPg(pool),
      // Counted, not written: a query can hold personal data.
      log: [{ emit: 'event', level: 'query' }],
    });
    (this as unknown as { $on(event: 'query', listener: () => void): void }).$on('query', () => {
      this.queryCount += 1;
    });
    this.databaseToken = typeof pool.password === 'function' ? pool.password : null;
  }

  /**
   * Readiness: what a request needs before it can use the database. With Entra, a token
   * from the managed identity (cached by the credential, so asking again is cheap); then a
   * real interactive transaction, with the same wait for a connection as the requests
   * (Prisma's default maxWait of 2 s). A new revision takes traffic only once this works,
   * not on the first connection alone: two requests of a revision that had just started
   * failed with "Unable to start a transaction in the given time" (12 November 2026).
   */
  async checkDatabase(): Promise<void> {
    if (this.databaseToken) {
      await this.databaseToken();
    }
    await this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1`;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
