import { Global, Injectable, Logger, Module } from '@nestjs/common';
import {
  DEFAULT_SETTINGS,
  settingSchemas,
  type SettingKey,
  type SettingValues,
} from '@iconbridge/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Global settings from the `settings` table (edited by the super admin).
 * A missing or invalid row falls back to the default of packages/shared, so a
 * bad value can never disable a business rule silently: it is logged.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Read on every call (no cache): a change applies at once, also inside a transaction. */
  async get<K extends SettingKey>(
    key: K,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<SettingValues[K]> {
    const row = await client.setting.findUnique({ where: { key }, select: { value: true } });
    if (!row) {
      return DEFAULT_SETTINGS[key];
    }
    const parsed = settingSchemas[key].safeParse(row.value);
    if (!parsed.success) {
      this.logger.error(`Setting ${key} has an invalid value; using the default`);
      return DEFAULT_SETTINGS[key];
    }
    return parsed.data as SettingValues[K];
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
