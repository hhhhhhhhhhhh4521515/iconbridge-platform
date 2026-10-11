import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Locale } from '@iconbridge/shared';
import mjml2html from 'mjml';
import type { Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
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
  'job-alert-confirm': 'job-alerts/confirm',
  'job-alert': 'jobs',
  'contact-message': '',
} as const satisfies Record<EmailTemplate, string>;

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

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter,
    config: ConfigService<Env, true>,
  ) {
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
   * Sends one email. Returns false instead of throwing when delivery fails, so a
   * mail outage does not break the request; the user can ask for the email again.
   * The recipient address is never logged.
   */
  async send(
    to: string,
    template: EmailTemplate,
    locale: Locale,
    variables: EmailVariables,
    options: { replyTo?: string } = {},
  ): Promise<boolean> {
    try {
      const email = await this.render(template, locale, variables);
      await this.transport.sendMail({
        from: this.from,
        to,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...email,
      });
      this.logger.log(`Email sent: ${template} (${locale})`);
      return true;
    } catch (error) {
      this.logger.error(
        `Email not sent: ${template} (${locale}): ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return false;
    }
  }
}
