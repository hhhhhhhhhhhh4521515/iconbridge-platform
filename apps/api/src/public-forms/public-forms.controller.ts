import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  acknowledgementSchema,
  contactMessageSchema,
  subscribeJobAlertSchema,
  tokenSchema,
  type Acknowledgement,
  type ContactMessageInput,
  type SubscribeJobAlertInput,
  type TokenInput,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { RATE_LIMITS } from '../auth/auth.constants.js';
import { requestMeta } from '../auth/auth.types.js';
import { Public } from '../auth/decorators/index.js';
import { TurnstileService } from '../auth/turnstile.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ZodBody } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobAlertsService } from './job-alerts.service.js';

const CONTACT_ACK: Acknowledgement = {
  message: 'Your message has been sent. We will answer by email.',
};

/** Forms open to visitors. Each one needs a CAPTCHA token and is limited to 5 requests per minute and per IP. */
@ApiTags('public')
@Public()
@Throttle({ default: RATE_LIMITS.authSensitive })
@Controller()
export class PublicFormsController {
  constructor(
    private readonly alerts: JobAlertsService,
    private readonly prisma: PrismaService,
    private readonly turnstile: TurnstileService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  @Post('job-alerts')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Subscribe to job alerts',
    description:
      'Double opt-in: a confirmation link is emailed and nothing else is sent until it is used. ' +
      'Leave `destinations` and `categories` empty to follow everything.',
  })
  @ApiZodBody(subscribeJobAlertSchema)
  @ApiZodResponse(202, acknowledgementSchema)
  @ApiErrors(400, 429)
  subscribe(
    @ZodBody(subscribeJobAlertSchema) body: SubscribeJobAlertInput,
    @Req() request: Request,
  ): Promise<Acknowledgement> {
    return this.alerts.subscribe(body, requestMeta(request).ip);
  }

  @Post('job-alerts/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Confirm a job alert with the token of the email link (valid 72 hours)',
  })
  @ApiZodBody(tokenSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 429)
  async confirm(@ZodBody(tokenSchema) body: TokenInput): Promise<void> {
    await this.alerts.confirm(body.token);
  }

  @Post('job-alerts/unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop a job alert with the token of the unsubscribe link' })
  @ApiZodBody(tokenSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 429)
  async unsubscribe(@ZodBody(tokenSchema) body: TokenInput): Promise<void> {
    await this.alerts.unsubscribe(body.token);
  }

  @Post('contact')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Contact form',
    description:
      'The message is stored and emailed to the agency (setting CONTACT_EMAIL), with the sender as reply-to.',
  })
  @ApiZodBody(contactMessageSchema)
  @ApiZodResponse(202, acknowledgementSchema)
  @ApiErrors(400, 429)
  async contact(
    @ZodBody(contactMessageSchema) body: ContactMessageInput,
    @Req() request: Request,
  ): Promise<Acknowledgement> {
    const { ip } = requestMeta(request);
    if (!(await this.turnstile.verify(body.turnstileToken, ip))) {
      throw new AppException('CAPTCHA_FAILED', HttpStatus.BAD_REQUEST, 'The CAPTCHA check failed');
    }
    await this.prisma.contactMessage.create({
      data: {
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        subject: body.subject ?? null,
        message: body.message,
        ip,
      },
    });
    // Stored first: if the email cannot leave, the message is not lost.
    await this.mail.send(
      await this.settings.get('CONTACT_EMAIL'),
      'contact-message',
      'en',
      {
        actionUrl: this.mail.pageUrl('en', ''),
        message: body.message,
        sender: {
          name: body.name,
          email: body.email,
          phone: body.phone ?? null,
          subject: body.subject ?? null,
        },
      },
      { replyTo: body.email },
    );
    return CONTACT_ACK;
  }
}
