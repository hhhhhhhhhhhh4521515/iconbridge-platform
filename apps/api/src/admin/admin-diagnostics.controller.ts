import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@iconbridge/shared';
import type { Request } from 'express';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { ApiErrors } from '../common/swagger/zod-openapi.js';
import { SkipAudit } from './audit/audit.decorator.js';
import { AuditService } from './audit/audit.service.js';

/** The error thrown on purpose: recognisable in Application Insights (exception type). */
export class ForcedDiagnosticError extends Error {
  override readonly name = 'ForcedDiagnosticError';
  constructor() {
    super('Forced by a super admin to check the alerts');
  }
}

/**
 * Checks of the monitoring (docs/RUNBOOK.md): a super admin makes the API fail on purpose
 * to see the "API 5xx" alert fire. Audited before the error, since a failed request writes
 * no automatic audit entry.
 */
@ApiTags('admin: diagnostics')
@ApiCookieAuth()
@Controller('admin/diagnostics')
export class AdminDiagnosticsController {
  constructor(private readonly audit: AuditService) {}

  @Post('error')
  @HttpCode(HttpStatus.INTERNAL_SERVER_ERROR)
  @Roles(...PERMISSIONS.MANAGE_SETTINGS)
  @SkipAudit()
  @ApiOperation({
    summary: 'Fail on purpose (HTTP 500), to check the alerts',
    description:
      'Super admin only. Answers 500 INTERNAL_ERROR every time and is recorded in the audit log. More than 5 calls in 5 minutes fire the "API 5xx" alert.',
  })
  @ApiErrors(401, 403, 500)
  async forceError(@CurrentUser() user: AuthUser, @Req() request: Request): Promise<never> {
    await this.audit.record({
      actorId: user.id,
      action: 'diagnostics.forced_error',
      entityType: 'diagnostics',
      entityId: 'error',
      ip: requestMeta(request).ip,
    });
    throw new ForcedDiagnosticError();
  }
}
