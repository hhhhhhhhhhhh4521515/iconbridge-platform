import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Locale } from '@iconbridge/shared';
import mjml2html from 'mjml';
import type { Transporter } from 'nodemailer';
import { Clock } from '../common/clock/clock.js';
import { FieldCipher } from '../common/crypto/field-cipher.js';
import type { Env } from '../config/env.js';
import type { EmailStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  emailContent,
  emailMjml,
  emailText,
  type EmailTemplate,
  type EmailVariables,
} from './mail.templates.js';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Pages of the web app that email links open. The token travels in the query string. */
export const EMAIL_LINK_PATHS = {
  'verify-email': 'verify-email',
  'reset-password': 'reset-password',
  invitation: 'set-password',
  'account-exists': 'forgot-password',
  'application-received': 'account/applications',
  'new-application': 'admin/applications',
  'application-status': 'account/applications',
  'application-status-correction': 'account/applications',
  'retention-warning': 'login',
  'job-alert-confirm': 'job-alerts/confirm',
  'job-alert': 'jobs',
  'contact-message': '',
} as const satisfies Record<EmailTemplate, string>;

const OUTBOX_CONTEXT = 'email-outbox';
export const OUTBOX_MAX_ATTEMPTS = 8;
const OUTBOX_BATCH = 200;
/** Emails sent at the same time; the transport keeps as many SMTP connections open. */
export const OUTBOX_CONCURRENCY = 3;
const OUTBOX_LEASE_MS = 2 * 60_000;
const OUTBOX_KEEP_MS = 30 * 24 * 3_600_000;

/** Wait before the next attempt: 1, 2, 4... minutes, at most 6 hours. */
export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 60_000, 6 * 3_600_000);
}

interface OutboxPayload {
  to: string;
  variables: EmailVariables;
  replyTo?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly webOrigin: string;

  /** True in the tests: `send` waits for the first attempt, so a test can read the email at once. */
  private readonly inline: boolean;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter,
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly clock: Clock,
  ) {
    this.inline = config.get('MAIL_DELIVERY', { infer: true }) === 'inline';
    this.from = config.get('MAIL_FROM', { infer: true });
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  /** Link to a localised page of the web app, e.g. https://site/fr/verify-email?token=... */
  linkFor(template: EmailTemplate, locale: Locale, token?: string, subPath?: string): string {
    const path = [locale, EMAIL_LINK_PATHS[template], subPath].filter(Boolean).join('/');
    const url = new URL(`/${path}`, this.webOrigin);
    if (token) {
      url.searchParams.set('token', token);
    }
    return url.toString();
  }

  /** Link to any localised page of the web app. */
  pageUrl(locale: Locale, path: string, query: Record<string, string> = {}): string {
    const url = new URL(`/${locale}/${path}`, this.webOrigin);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async render(
    template: EmailTemplate,
    locale: Locale,
    variables: EmailVariables,
  ): Promise<RenderedEmail> {
    const content = emailContent(template, locale, variables);
    const { html } = await mjml2html(emailMjml(content, locale, variables.actionUrl), {
      validationLevel: 'strict',
    });
    return { subject: content.subject, html, text: emailText(content, variables.actionUrl) };
  }

  /**
   * Queues an email and returns at once: the request writes one row in the outbox
   * and never waits for the mail server. The email is sent right after by this
   * process, and tried again by the task runner if that fails, so a mail outage
   * loses nothing. Always answers true: the email is accepted, not yet delivered.
   */
  async send(
    to: string,
    template: EmailTemplate,
    locale: Locale,
    variables: EmailVariables,
    options: { replyTo?: string } = {},
  ): Promise<boolean> {
    await this.enqueue(to, template, locale, variables, options);
    return true;
  }

  /** Like `send`, and returns the id of the outbox row, to follow or cancel the email later. */
  async enqueue(
    to: string,
    template: EmailTemplate,
    locale: Locale,
    variables: EmailVariables,
    options: { replyTo?: string } = {},
  ): Promise<string> {
    const payload: OutboxPayload = {
      to,
      variables,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    };
    const row = await this.prisma.emailOutbox.create({
      data: {
        template,
        locale,
        payload: this.cipher.encrypt(JSON.stringify(payload), OUTBOX_CONTEXT),
        nextAttemptAt: this.clock.now(),
      },
      select: { id: true },
    });
    if (this.inline) {
      await this.attempt(row.id);
    } else {
      this.kick();
    }
    return row.id;
  }

  /** Whether an email was sent, is still waiting, failed for good or was cancelled; null if unknown. */
  async statusOf(
    id: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<EmailStatus | null> {
    const row = await client.emailOutbox.findUnique({ where: { id }, select: { status: true } });
    return row?.status ?? null;
  }

  /**
   * Withdraws an email that has not left yet: one never tried, or one waiting for
   * another try. False when it was sent, or when an attempt is in progress right now.
   */
  async cancel(id: string, client: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const cancelled = await client.emailOutbox.updateMany({
      where: { id, status: 'PENDING', OR: [{ attempts: 0 }, { lastError: { not: null } }] },
      data: { status: 'CANCELLED', payload: '' },
    });
    return cancelled.count === 1;
  }

  /**
   * Sends what is due, oldest first. Called by the task runner (`send-emails`) and,
   * in the background, after each `send`. Several runners may call it at once: a row
   * is taken by one of them only.
   */
  async sendDue(limit = OUTBOX_BATCH): Promise<{ sent: number; retried: number; failed: number }> {
    const due = await this.prisma.emailOutbox.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: this.clock.now() } },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
    const report = { sent: 0, retried: 0, failed: 0 };
    for (let start = 0; start < due.length; start += OUTBOX_CONCURRENCY) {
      const outcomes = await Promise.all(
        due.slice(start, start + OUTBOX_CONCURRENCY).map(({ id }) => this.attempt(id)),
      );
      for (const outcome of outcomes) {
        if (outcome !== 'skipped') {
          report[outcome] += 1;
        }
      }
    }
    return report;
  }

  /** Removes what no longer needs to be kept: rows sent, cancelled or abandoned over 30 days ago. */
  async purge(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - OUTBOX_KEEP_MS);
    const removed = await this.prisma.emailOutbox.deleteMany({
      where: { status: { not: 'PENDING' }, updatedAt: { lt: before } },
    });
    return removed.count;
  }

  /** One attempt for one row. The row is taken first, so two runners never send the same email. */
  private async attempt(id: string): Promise<'sent' | 'retried' | 'failed' | 'skipped'> {
    const now = this.clock.now();
    const taken = await this.prisma.emailOutbox.updateMany({
      where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
      // Until this moment the row is ours; if the process dies, it becomes due again.
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(now.getTime() + OUTBOX_LEASE_MS),
        lastError: null,
      },
    });
    if (taken.count === 0) {
      return 'skipped';
    }
    const row = await this.prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    try {
      const payload = JSON.parse(this.cipher.decrypt(row.payload, OUTBOX_CONTEXT)) as OutboxPayload;
      await this.deliver(
        payload.to,
        row.template as EmailTemplate,
        row.locale as Locale,
        payload.variables,
        payload.replyTo ? { replyTo: payload.replyTo } : {},
      );
      await this.prisma.emailOutbox.update({
        where: { id },
        // The content is no longer needed once the email has left.
        data: { status: 'SENT', sentAt: this.clock.now(), payload: '' },
      });
      this.logger.log(`Email sent: ${row.template} (${row.locale})`);
      return 'sent';
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown error';
      const abandoned = row.attempts >= OUTBOX_MAX_ATTEMPTS;
      await this.prisma.emailOutbox.update({
        where: { id },
        data: abandoned
          ? { status: 'FAILED', lastError: name, payload: '' }
          : {
              lastError: name,
              nextAttemptAt: new Date(now.getTime() + retryDelayMs(row.attempts)),
            },
      });
      this.logger.error(
        `Email not sent: ${row.template} (${row.locale}), attempt ${row.attempts}: ${name}${abandoned ? '; given up' : ''}`,
      );
      return abandoned ? 'failed' : 'retried';
    }
  }

  private running = false;
  private again = false;

  private takeAgain(): boolean {
    const again = this.again;
    this.again = false;
    return again;
  }

  /** Starts sending in the background, one email after the other; a call during a run asks for one more pass. */
  private kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void (async () => {
      try {
        // `again` is set by a call that arrives while this loop is sending.
        for (let pass = true; pass; pass = this.takeAgain()) {
          await this.sendDue();
        }
      } catch (error) {
        this.logger.error(
          `Outbox run failed: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      } finally {
        this.running = false;
      }
    })();
  }

  /**
   * Hands one email to the mail server now. Throws when the server refuses or cannot
   * be reached. The recipient address is never logged.
   */
  async deliver(
    to: string,
    template: EmailTemplate,
    locale: Locale,
    variables: EmailVariables,
    options: { replyTo?: string } = {},
  ): Promise<void> {
    const email = await this.render(template, locale, variables);
    await this.transport.sendMail({
      from: this.from,
      to,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...email,
    });
  }
}
