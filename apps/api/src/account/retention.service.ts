import { Injectable, Logger } from '@nestjs/common';
import { localeSchema, RETENTION_MONTHS, RETENTION_NOTICE_DAYS } from '@iconbridge/shared';
import { AuditService } from '../admin/audit/audit.service.js';
import { Clock } from '../common/clock/clock.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskLockService } from '../tasks/task-lock.service.js';
import { AccountService } from './account.service.js';

const DAY_MS = 24 * 3_600_000;
/** Accounts handled in one run; the next run continues. */
const BATCH = 200;

interface Inactive {
  id: string;
  email: string;
  locale: string;
  profile_id: string | null;
  warned_at: Date | null;
  last_activity: Date;
}

/**
 * Data retention: personal data is not kept for ever.
 *
 * A candidate account with no activity for RETENTION_MONTHS (no sign-in, no
 * application sent or moved) and no application in progress is erased, with the
 * same erasure as a GDPR request. RETENTION_NOTICE_DAYS before, the candidate
 * receives an email; signing in is enough to keep the account.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mail: MailService,
    private readonly account: AccountService,
    private readonly audit: AuditService,
    private readonly locks: TaskLockService,
  ) {}

  async run(): Promise<{ ran: boolean; warned?: number; erased?: number }> {
    const outcome = await this.locks.runExclusive('retention', () => this.apply());
    return outcome.ran ? { ran: true, ...outcome.result } : { ran: false };
  }

  private async apply(): Promise<{ warned: number; erased: number }> {
    const now = this.clock.now();
    const eraseBefore = new Date(now);
    eraseBefore.setUTCMonth(eraseBefore.getUTCMonth() - RETENTION_MONTHS);
    const warnBefore = new Date(eraseBefore.getTime() + RETENTION_NOTICE_DAYS * DAY_MS);
    const noticeGiven = new Date(now.getTime() - RETENTION_NOTICE_DAYS * DAY_MS);

    // Somebody who came back after the warning starts a new period.
    await this.prisma.$executeRaw`
      UPDATE users SET retention_warned_at = NULL
      WHERE retention_warned_at IS NOT NULL AND last_login_at > retention_warned_at`;

    const inactive = await this.prisma.$queryRaw<Inactive[]>`
      SELECT * FROM (
        SELECT u.id, u.email, u.locale, p.id AS profile_id, u.retention_warned_at AS warned_at,
               GREATEST(
                 u.created_at,
                 COALESCE(u.last_login_at, u.created_at),
                 COALESCE((SELECT max(a.updated_at) FROM applications a WHERE a.candidate_id = p.id), u.created_at)
               ) AS last_activity
        FROM users u
        LEFT JOIN candidate_profiles p ON p.user_id = u.id
        WHERE u.role = 'CANDIDATE' AND u.deleted_at IS NULL
          -- Never somebody whose recruitment is under way, however quiet the account.
          AND NOT EXISTS (
            SELECT 1 FROM applications a
            WHERE a.candidate_id = p.id
              AND a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'OFFER',
                               'CONTRACT_SIGNED', 'VISA_PROCESSING', 'VISA_APPROVED')
          )
      ) candidates
      WHERE last_activity < ${warnBefore}
      ORDER BY last_activity
      LIMIT ${BATCH}`;

    let warned = 0;
    let erased = 0;
    for (const user of inactive) {
      if (user.warned_at === null) {
        // The day written in the email: the end of the two years, and never less than the full notice.
        const eraseOn = new Date(
          Math.max(
            eraseAfter(user.last_activity).getTime(),
            now.getTime() + RETENTION_NOTICE_DAYS * DAY_MS,
          ),
        );
        const locale = localeSchema.catch('en').parse(user.locale);
        await this.mail.send(user.email, 'retention-warning', locale, {
          actionUrl: this.mail.linkFor('retention-warning', locale),
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
            eraseOn,
          ),
        });
        await this.prisma.user.update({ where: { id: user.id }, data: { retentionWarnedAt: now } });
        warned += 1;
        continue;
      }
      // Erased only after the full notice, and only if the two years have really passed.
      if (user.warned_at <= noticeGiven && user.last_activity < eraseBefore) {
        const result = await this.account.eraseCandidate(user.id);
        await this.audit.record({
          actorId: null,
          action: 'candidate.retention_delete',
          entityType: 'candidate',
          entityId: user.profile_id,
          before: { documents: result.documents, applications: result.applications },
          after: { reason: `No activity for ${RETENTION_MONTHS} months`, deletedBy: 'system' },
        });
        erased += 1;
      }
    }
    if (warned + erased > 0) {
      this.logger.log(`Retention: ${warned} warned, ${erased} erased`);
    }
    return { warned, erased };
  }
}

/** The day the retention period of an account ends. */
function eraseAfter(lastActivity: Date): Date {
  const date = new Date(lastActivity);
  date.setUTCMonth(date.getUTCMonth() + RETENTION_MONTHS);
  return date;
}
