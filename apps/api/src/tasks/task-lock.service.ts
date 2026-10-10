import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_TASK_MS = 10 * 60 * 1000;

export type ExclusiveResult<T> = { ran: true; result: T } | { ran: false };

/**
 * Runs a task on one instance at a time, whoever starts it: the in-process
 * scheduler of an API replica, or the CLI run by a scheduled job. A transaction
 * takes a PostgreSQL advisory lock named by `key` and holds it while the work
 * runs; a second caller does not wait, it skips. The lock disappears with the
 * transaction, also if the process dies.
 */
@Injectable()
export class TaskLockService {
  constructor(private readonly prisma: PrismaService) {}

  runExclusive<T>(key: string, work: () => Promise<T>): Promise<ExclusiveResult<T>> {
    return this.prisma.$transaction(
      async (tx): Promise<ExclusiveResult<T>> => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${`task:${key}`}, 0)) AS acquired`;
        if (!lock?.acquired) {
          return { ran: false };
        }
        // The work uses other connections; this one only keeps the lock.
        return { ran: true, result: await work() };
      },
      { timeout: MAX_TASK_MS, maxWait: 10_000 },
    );
  }
}
