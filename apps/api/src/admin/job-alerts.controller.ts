import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  eraseJobAlertsResultSchema,
  eraseJobAlertsSchema,
  PERMISSIONS,
  type EraseJobAlertsInput,
  type EraseJobAlertsResult,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { ZodBody } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SkipAudit } from './audit/audit.decorator.js';
import { AuditService } from './audit/audit.service.js';

/**
 * Job alerts of visitors hold an email address and nothing else. A person who cannot
 * use the unsubscribe link (email lost, address given by somebody else) asks the
 * team, and a super admin removes every alert of the address here.
 */
@ApiTags('admin: job alerts')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_SETTINGS)
@Controller('admin/job-alerts')
export class AdminJobAlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('erase')
  @HttpCode(HttpStatus.OK)
  @SkipAudit()
  @ApiOperation({
    summary: 'Remove every job alert of an email address (super admin)',
    description:
      'Confirmed or not. Answers how many alerts were removed; the audit log keeps that number, not the address.',
  })
  @ApiZodBody(eraseJobAlertsSchema)
  @ApiZodResponse(200, eraseJobAlertsResultSchema)
  @ApiErrors(400, 401, 403)
  async erase(
    @ZodBody(eraseJobAlertsSchema) body: EraseJobAlertsInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<EraseJobAlertsResult> {
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.jobAlertSubscription.deleteMany({ where: { email: body.email } });
      if (removed.count > 0) {
        await this.audit.record(
          {
            actorId: user.id,
            action: 'job_alert.erase',
            entityType: 'jobAlert',
            entityId: null,
            before: { alerts: removed.count },
            ip: requestMeta(request).ip,
          },
          tx,
        );
      }
      return { removed: removed.count };
    });
  }
}
