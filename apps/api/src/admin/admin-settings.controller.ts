import { Controller, Get, HttpStatus, Param, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  adminStatsSchema,
  DEFAULT_SETTINGS,
  PERMISSIONS,
  SETTING_KEYS,
  settingSchemas,
  updateSettingSchema,
  type AdminStats,
  type SettingKey,
  type SettingValues,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { ZodBody } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AdminStatsService } from './admin-stats.service.js';
import { SkipAudit } from './audit/audit.decorator.js';
import { AuditService } from './audit/audit.service.js';

const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as string[]).includes(key);

@ApiTags('admin: settings and dashboard')
@ApiCookieAuth()
@Controller('admin')
export class AdminSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly stats: AdminStatsService,
  ) {}

  @Get('stats')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({
    summary: 'Dashboard figures',
    description:
      'Open jobs, applications per status, per destination and per month (last 12), visas approved this year, ' +
      'average days from Submitted to Visa approved.',
  })
  @ApiZodResponse(200, adminStatsSchema)
  @ApiErrors(401, 403)
  getStats(): Promise<AdminStats> {
    return this.stats.get();
  }

  @Get('settings')
  @Roles(...PERMISSIONS.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Every global setting with its current value (super admin)' })
  @ApiErrors(401, 403)
  async list(): Promise<SettingValues> {
    const entries = await Promise.all(
      SETTING_KEYS.map(async (key) => [key, await this.settings.get(key)] as const),
    );
    return Object.fromEntries(entries) as SettingValues;
  }

  @Put('settings/:key')
  @Roles(...PERMISSIONS.MANAGE_SETTINGS)
  @SkipAudit()
  @ApiOperation({
    summary: 'Change a setting (super admin)',
    description:
      'Keys: REAPPLY_COOLDOWN_MONTHS, MAX_ACTIVE_APPLICATIONS, MAX_UPLOAD_SIZE_MB, CONTACT_EMAIL, CONTACT_PHONE, ' +
      'CONTACT_WHATSAPP, CONTACT_ADDRESS. The value is checked against the rules of its key and applies at once.',
  })
  @ApiParam({ name: 'key', enum: Object.keys(DEFAULT_SETTINGS) })
  @ApiZodBody(updateSettingSchema)
  @ApiErrors(400, 401, 403, 404)
  async update(
    @Param('key') key: string,
    @ZodBody(updateSettingSchema) body: { value?: unknown },
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<{ key: SettingKey; value: SettingValues[SettingKey] }> {
    if (!isSettingKey(key)) {
      throw notFound('Unknown setting');
    }
    const parsed = settingSchemas[key].safeParse(body.value);
    if (!parsed.success) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
        { path: 'value', message: parsed.error.issues[0]?.message ?? 'Invalid value' },
      ]);
    }
    const before = await this.settings.get(key);
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key },
        update: { value: parsed.data },
        create: { key, value: parsed.data },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'setting.update',
          entityType: 'setting',
          entityId: key,
          before: { value: before },
          after: { value: parsed.data },
          ip: requestMeta(request).ip,
        },
        tx,
      );
    });
    return { key, value: parsed.data };
  }
}
