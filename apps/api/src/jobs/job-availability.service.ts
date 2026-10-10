import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';

/** Arbitrary constant identifying this task among PostgreSQL advisory locks. */
const ADVISORY_LOCK_KEY = 482_210_001;

export interface ClosedJob {
  id: string;
  slug: string;
  reason: 'deadline_passed' | 'positions_filled';
}

export type AvailabilityRun = { ran: true; closed: ClosedJob[] } | { ran: false; closed: [] };

/**
 * Closes published jobs whose deadline has passed or whose positions are all
 * filled (SPEC, availability rules). Public queries already hide such jobs; this
 * task makes the status say so.
 */
@Injectable()
export class JobAvailabilityService {
  private readonly logger = new Logger(JobAvailabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 */15 * * * *', { name: 'close-unavailable-jobs' })
  async scheduled(): Promise<void> {
    try {
      await this.closeUnavailableJobs();
    } catch (error) {
      this.logger.error(
        `Closing unavailable jobs failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  /**
   * Safe on several replicas: the work happens in one transaction that first takes
   * a PostgreSQL advisory lock. A replica that does not get the lock skips its turn,
   * and the lock is released when the transaction ends, even after a crash.
   */
  async closeUnavailableJobs(): Promise<AvailabilityRun> {
    const result = await this.prisma.$transaction(async (tx): Promise<AvailabilityRun> => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS acquired`;
      if (!lock?.acquired) {
        return { ran: false, closed: [] };
      }
      const closed = await tx.$queryRaw<ClosedJob[]>`
        UPDATE jobs
        SET status = 'CLOSED', closed_at = now(), updated_at = now()
        WHERE status = 'PUBLISHED'
          AND deleted_at IS NULL
          AND (deadline <= now() OR hired_count >= positions)
        RETURNING id, slug,
          CASE WHEN deadline <= now() THEN 'deadline_passed' ELSE 'positions_filled' END AS reason`;
      if (closed.length > 0) {
        // No actor: the system did it.
        await tx.auditLog.createMany({
          data: closed.map((job) => ({
            action: 'job.auto_close',
            entityType: 'job',
            entityId: job.id,
            before: { status: 'PUBLISHED' },
            after: { status: 'CLOSED', reason: job.reason },
          })),
        });
      }
      return { ran: true, closed };
    });

    if (!result.ran) {
      this.logger.log('Close unavailable jobs: another instance is running it, skipped');
    } else if (result.closed.length === 0) {
      this.logger.log('Close unavailable jobs: nothing to close');
    } else {
      for (const job of result.closed) {
        this.logger.log(`Closed job ${job.slug} (${job.id}): ${job.reason}`);
      }
      this.logger.log(`Close unavailable jobs: ${result.closed.length} closed`);
    }
    return result;
  }
}
