import { HttpStatus, Injectable } from '@nestjs/common';
import { POSITION_HOLDING_STATUSES } from '@iconbridge/shared';
import { Clock } from '../common/clock/clock.js';
import { AppException } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';

export interface PositionsSync {
  hiredCount: number;
  /** The job closed because its positions are now all filled. */
  closed: boolean;
  /** The job reopened because a position became free again. */
  reopened: boolean;
}

/**
 * The positions of a job (ADR-025). An application holds one from Contract signed on;
 * `hiredCount` is the number of such applications, recounted inside the transaction that
 * changed one (status change, undo, deletion, positions edited), never incremented.
 *
 * The job row is locked first, so two contracts signed at the same moment are counted one
 * after the other: the second one that finds no position left is refused.
 */
@Injectable()
export class JobPositionsService {
  constructor(private readonly clock: Clock) {}

  async sync(
    tx: Prisma.TransactionClient,
    jobId: string,
    actorId: string | null,
  ): Promise<PositionsSync> {
    const now = this.clock.now();
    const [job] = await tx.$queryRaw<
      {
        positions: number;
        hired_count: number;
        status: string;
        close_reason: string | null;
        before_deadline: boolean;
        deleted: boolean;
      }[]
    >`
      SELECT positions, hired_count, status::text AS status, close_reason::text AS close_reason,
             deadline > ${now} AS before_deadline, deleted_at IS NOT NULL AS deleted
      FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
    if (!job) {
      return { hiredCount: 0, closed: false, reopened: false };
    }
    const holding = Prisma.join([...POSITION_HOLDING_STATUSES]);
    const [counted] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM applications
      WHERE job_id = ${jobId}::uuid AND status::text IN (${holding})`;
    const hiredCount = counted?.count ?? 0;
    if (hiredCount > job.positions) {
      throw new AppException(
        'NO_POSITION_LEFT',
        HttpStatus.CONFLICT,
        'Every position of this job is already filled',
      );
    }

    const close = job.status === 'PUBLISHED' && !job.deleted && hiredCount >= job.positions;
    const reopen =
      job.status === 'CLOSED' &&
      job.close_reason === 'POSITIONS_FILLED' &&
      !job.deleted &&
      job.before_deadline &&
      hiredCount < job.positions;
    await tx.job.update({
      where: { id: jobId },
      data: {
        hiredCount,
        ...(close ? { status: 'CLOSED', closedAt: now, closeReason: 'POSITIONS_FILLED' } : {}),
        ...(reopen ? { status: 'PUBLISHED', closedAt: null, closeReason: null } : {}),
      },
    });
    if (close || reopen) {
      // The platform did it, after the change made by `actorId`.
      await tx.auditLog.create({
        data: {
          actorId,
          action: close ? 'job.auto_close' : 'job.auto_reopen',
          entityType: 'job',
          entityId: jobId,
          before: { status: job.status, hiredCount: job.hired_count },
          after: close
            ? { status: 'CLOSED', reason: 'positions_filled', hiredCount, positions: job.positions }
            : {
                status: 'PUBLISHED',
                reason: 'position_free',
                hiredCount,
                positions: job.positions,
              },
          createdAt: now,
        },
      });
    }
    return { hiredCount, closed: close, reopened: reopen };
  }
}
