import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { poolConfig } from './database-config.js';

/** How long a transaction waits for a connection of the pool. */
export const TRANSACTION_MAX_WAIT_MS = 10_000;

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
      // A transaction, and the batch Prisma makes of queries started together, waits this
      // long for a connection (2 s by default). Opening one on a new revision can take
      // longer: TLS, a Microsoft Entra token, a busy 0.5 vCPU (12 and 13 November 2026).
      transactionOptions: { maxWait: TRANSACTION_MAX_WAIT_MS },
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
   * (TRANSACTION_MAX_WAIT_MS; the probe's own 3-second timeout ends it sooner). A new revision takes traffic only once this works,
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
