import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module.js';
import { AuditInterceptor } from './admin/audit/audit.interceptor.js';
import { RATE_LIMITS } from './auth/auth.constants.js';
import { AuthModule } from './auth/auth.module.js';
import { CandidatesModule } from './candidates/candidates.module.js';
import { ClockModule } from './common/clock/clock.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { VerifiedEmailGuard } from './auth/guards/verified-email.guard.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { loggerParams } from './common/logging/logger.config.js';
import { validateEnv, type Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SettingsModule } from './settings/settings.service.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerParams(config.get('NODE_ENV', { infer: true })),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ...RATE_LIMITS.default }] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ClockModule,
    CryptoModule,
    SettingsModule,
    MailModule,
    StorageModule,
    AuthModule,
    AdminModule,
    JobsModule,
    CandidatesModule,
    HealthModule,
  ],
  providers: [
    ThrottlerGuard,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guards run in this order. `useExisting` keeps each one replaceable in tests.
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_GUARD, useExisting: VerifiedEmailGuard },
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
  ],
})
export class AppModule {}
