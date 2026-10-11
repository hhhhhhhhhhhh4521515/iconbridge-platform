import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /**
   * Number of SQL statements sent since the start. Read by the tests that check a list
   * endpoint makes the same number of queries for 3 rows as for 30 (no "N+1").
   */
  queryCount = 0;

  constructor(config: ConfigService<Env, true>) {
    // The pool connects on first query, so the API can start (and report
    // "not ready") while the database is still coming up.
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
      // Counted, not written: a query can hold personal data.
      log: [{ emit: 'event', level: 'query' }],
    });
    (this as unknown as { $on(event: 'query', listener: () => void): void }).$on('query', () => {
      this.queryCount += 1;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
