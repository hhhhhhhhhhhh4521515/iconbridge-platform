import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { ACCESS_TOKEN_TTL_MS, JWT_ISSUER } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailTokenService } from './email-token.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { OwnershipGuard } from './guards/ownership.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { VerifiedEmailGuard } from './guards/verified-email.guard.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';
import { TurnstileService } from './turnstile.service.js';

/** Global so that feature modules can use the guards and session services without importing it. */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          issuer: JWT_ISSUER,
          expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
        },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    SessionService,
    EmailTokenService,
    PasswordPolicyService,
    TurnstileService,
    JwtAuthGuard,
    RolesGuard,
    VerifiedEmailGuard,
    OwnershipGuard,
  ],
  exports: [
    TurnstileService,
    TokenService,
    SessionService,
    EmailTokenService,
    PasswordPolicyService,
    JwtAuthGuard,
    RolesGuard,
    VerifiedEmailGuard,
    OwnershipGuard,
  ],
})
export class AuthModule {}
