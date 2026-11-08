import { Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  emailEventsResultSchema,
  emailEventsSchema,
  type EmailEventsInput,
  type EmailEventsResult,
} from '@iconbridge/shared';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/index.js';
import { AppException } from '../common/errors/app.exception.js';
import { ZodBody } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import type { Env } from '../config/env.js';
import { EmailEventsService } from './email-events.service.js';

function sameKey(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook of Azure Event Grid for the delivery reports of the emails (audit M2). */
@ApiTags('public')
@Public()
@Controller('email-events')
export class EmailEventsController {
  private readonly key: string;

  constructor(
    private readonly events: EmailEventsService,
    config: ConfigService<Env, true>,
  ) {
    this.key = config.get('EMAIL_EVENTS_KEY', { infer: true });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email delivery reports (Azure Event Grid)',
    description:
      'Called by Event Grid only. Answers the subscription validation; a hard bounce or an ' +
      'address suppressed by Azure stops all email to that address. The reports need the key ' +
      'in `x-email-events-key`; without EMAIL_EVENTS_KEY the route answers 404.',
  })
  @ApiZodBody(emailEventsSchema)
  @ApiZodResponse(200, emailEventsResultSchema)
  @ApiErrors(400, 401, 404)
  async receive(
    @ZodBody(emailEventsSchema) body: EmailEventsInput,
    @Headers('x-email-events-key') key: string | undefined,
  ): Promise<EmailEventsResult> {
    if (this.key === '') {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Not found');
    }
    // The validation only echoes a code Event Grid sent: answered with or without the key.
    const validationResponse = this.events.validationResponse(body);
    if (validationResponse !== undefined) {
      return { validationResponse, suppressed: 0 };
    }
    if (!sameKey(key, this.key)) {
      throw new AppException('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, 'Invalid key');
    }
    return this.events.record(body);
  }
}
