import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  localeSchema,
  type Acknowledgement,
  type SubscribeJobAlertInput,
} from '@iconbridge/shared';
import { TokenService } from '../auth/token.service.js';
import { TurnstileService } from '../auth/turnstile.service.js';
import { Clock } from '../common/clock/clock.js';
import { AppException } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { OPEN_JOB_SQL } from '../jobs/public-jobs.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskLockService } from '../tasks/task-lock.service.js';

const HOUR = 60 * 60 * 1000;
export const ALERT_CONFIRM_TTL_MS = 72 * HOUR;
/** Jobs published longer ago are not announced any more. */
const ANNOUNCE_WINDOW_MS = 14 * 24 * HOUR;
const MAX_JOBS_PER_EMAIL = 20;

export const ALERT_ACK: Acknowledgement = {
  message: 'Check your inbox and confirm your email address to activate the alert.',
};

const invalidToken = () =>
  new AppException('INVALID_TOKEN', HttpStatus.BAD_REQUEST, 'This link is invalid or has expired');

export interface AlertBatchResult {
  subscribers: number;
  emails: number;
  jobsAnnounced: number;
  expiredRequestsRemoved: number;
}

/** Job alerts by email: double opt-in, one-click unsubscribe, sent in batches. */
@Injectable()
export class JobAlertsService {
  private readonly logger = new Logger(JobAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly turnstile: TurnstileService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    private readonly locks: TaskLockService,
  ) {}

  /**
   * Records a request and emails a confirmation link. Nothing is ever sent to an
   * address that did not confirm, so nobody can subscribe somebody else. The
   * answer is the same for every address. Unknown destinations or categories are ignored.
   */
  async subscribe(input: SubscribeJobAlertInput, ip: string | null): Promise<Acknowledgement> {
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) {
      throw new AppException('CAPTCHA_FAILED', HttpStatus.BAD_REQUEST, 'The CAPTCHA check failed');
    }
    const [destinations, categories] = await Promise.all([
      this.prisma.destination.findMany({
        where: { code: { in: input.destinations }, isActive: true },
        select: { id: true },
      }),
      this.prisma.jobCategory.findMany({
        where: { slug: { in: input.categories }, isActive: true },
        select: { id: true },
      }),
    ]);
    const confirm = this.tokens.generateOpaqueToken();
    await this.prisma.jobAlertSubscription.create({
      data: {
        email: input.email,
        locale: input.locale,
        destinationIds: destinations.map((row) => row.id),
        categoryIds: categories.map((row) => row.id),
        confirmTokenHash: confirm.hash,
        unsubscribeToken: randomBytes(32).toString('base64url'),
      },
    });
    await this.mail.send(input.email, 'job-alert-confirm', input.locale, {
      actionUrl: this.mail.linkFor('job-alert-confirm', input.locale, confirm.token),
      expiresInHours: ALERT_CONFIRM_TTL_MS / HOUR,
    });
    return ALERT_ACK;
  }

  async confirm(token: string): Promise<void> {
    const now = this.clock.now();
    const updated = await this.prisma.jobAlertSubscription.updateMany({
      where: {
        confirmTokenHash: this.tokens.hashToken(token),
        confirmedAt: null,
        createdAt: { gt: new Date(now.getTime() - ALERT_CONFIRM_TTL_MS) },
      },
      data: { confirmedAt: now, confirmTokenHash: null },
    });
    if (updated.count === 0) {
      throw invalidToken();
    }
  }

  /** The link of every alert email. Deletes the subscription; an unknown token is an error. */
  async unsubscribe(token: string): Promise<void> {
    const removed = await this.prisma.jobAlertSubscription.deleteMany({
      where: { unsubscribeToken: token },
    });
    if (removed.count === 0) {
      throw invalidToken();
    }
  }

  /**
   * The batch: for each confirmed subscriber, the open jobs published since they
   * confirmed (14 days at most) that match their choices and were not announced
   * to them yet, in one email. A row per (subscriber, job) is written only after
   * the email left, so a failure is retried by the next run and nothing is sent twice.
   */
  async sendDue(): Promise<{ ran: boolean } & Partial<AlertBatchResult>> {
    const outcome = await this.locks.runExclusive('job-alerts', () => this.sendBatch());
    if (!outcome.ran) {
      this.logger.log('Job alerts: another instance is running it, skipped');
      return { ran: false };
    }
    const result = outcome.result;
    this.logger.log(
      `Job alerts: ${result.emails} emails to ${result.subscribers} subscribers, ` +
        `${result.jobsAnnounced} job announcements, ${result.expiredRequestsRemoved} expired requests removed`,
    );
    return { ran: true, ...result };
  }

  private async sendBatch(): Promise<AlertBatchResult> {
    const now = this.clock.now();
    const expired = await this.prisma.jobAlertSubscription.deleteMany({
      where: {
        confirmedAt: null,
        createdAt: { lt: new Date(now.getTime() - ALERT_CONFIRM_TTL_MS) },
      },
    });
    const subscribers = await this.prisma.jobAlertSubscription.findMany({
      where: { confirmedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    const since = new Date(now.getTime() - ANNOUNCE_WINDOW_MS);
    let emails = 0;
    let jobsAnnounced = 0;

    for (const subscriber of subscribers) {
      const jobs = await this.prisma.$queryRaw<{ id: string; title: string; slug: string }[]>`
        SELECT j.id, j.title, j.slug FROM jobs j
        WHERE ${OPEN_JOB_SQL}
          AND j.published_at >= ${subscriber.confirmedAt}
          AND j.published_at >= ${since}
          AND (cardinality(${subscriber.destinationIds}::uuid[]) = 0 OR j.destination_id = ANY(${subscriber.destinationIds}::uuid[]))
          AND (cardinality(${subscriber.categoryIds}::uuid[]) = 0 OR j.category_id = ANY(${subscriber.categoryIds}::uuid[]))
          AND NOT EXISTS (
            SELECT 1 FROM job_alert_notifications n
            WHERE n.subscription_id = ${subscriber.id}::uuid AND n.job_id = j.id
          )
        ORDER BY j.published_at DESC
        LIMIT ${Prisma.raw(String(MAX_JOBS_PER_EMAIL))}`;
      if (jobs.length === 0) {
        continue;
      }
      const locale = localeSchema.catch('en').parse(subscriber.locale);
      const sent = await this.mail.send(subscriber.email, 'job-alert', locale, {
        actionUrl: this.mail.linkFor('job-alert', locale),
        links: jobs.map((job) => ({
          label: job.title,
          url: this.mail.pageUrl(locale, `jobs/${job.slug}`),
        })),
        unsubscribeUrl: this.mail.pageUrl(locale, 'job-alerts/unsubscribe', {
          token: subscriber.unsubscribeToken,
        }),
      });
      if (!sent) {
        continue;
      }
      await this.prisma.jobAlertNotification.createMany({
        data: jobs.map((job) => ({ subscriptionId: subscriber.id, jobId: job.id })),
        skipDuplicates: true,
      });
      emails += 1;
      jobsAnnounced += jobs.length;
    }
    return {
      subscribers: subscribers.length,
      emails,
      jobsAnnounced,
      expiredRequestsRemoved: expired.count,
    };
  }
}
