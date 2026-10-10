import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  localeSchema,
  type Acknowledgement,
  type CurrentUser,
  type EmailOnlyInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@iconbridge/shared';
import { AppException, unauthenticated } from '../common/errors/app.exception.js';
import { hashPassword, verifyPassword } from '../common/crypto/password.js';
import { MailService } from '../mail/mail.service.js';
import type { EmailTemplate } from '../mail/mail.templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACCOUNT_LOCK_MS,
  MAX_FAILED_LOGINS,
  msToHours,
  RESET_PASSWORD_TTL_MS,
  VERIFY_EMAIL_TTL_MS,
} from './auth.constants.js';
import type { RequestMeta } from './auth.types.js';
import { EmailTokenService } from './email-token.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';
import { TurnstileService } from './turnstile.service.js';

export interface IssuedSession {
  user: CurrentUser;
  accessToken: string;
  refreshToken: string;
}

// Identical answers whether or not the address belongs to an account.
export const REGISTER_ACK: Acknowledgement = {
  message: 'Registration received. Check your inbox to confirm your email address.',
};
export const EMAIL_ACK: Acknowledgement = {
  message: 'If this address can receive it, an email has been sent.',
};

const invalidCredentials = () =>
  new AppException(
    'INVALID_CREDENTIALS',
    HttpStatus.UNAUTHORIZED,
    'Invalid email or password, or the account is temporarily locked',
  );

const invalidToken = () =>
  new AppException('INVALID_TOKEN', HttpStatus.BAD_REQUEST, 'This link is invalid or has expired');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Verified when the account does not exist, so the response time does not reveal it. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly emailTokens: EmailTokenService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly turnstile: TurnstileService,
    private readonly mail: MailService,
  ) {}

  /** Creates a CANDIDATE account. The role cannot be chosen by the caller. */
  async register(input: RegisterInput, meta: RequestMeta): Promise<Acknowledgement> {
    if (!(await this.turnstile.verify(input.turnstileToken, meta.ip))) {
      throw new AppException('CAPTCHA_FAILED', HttpStatus.BAD_REQUEST, 'The CAPTCHA check failed');
    }
    this.passwordPolicy.assertStrong(input.password, [
      input.email,
      input.firstName,
      input.lastName,
    ]);

    // Hashed before the lookup so both branches take the same time.
    const passwordHash = await hashPassword(input.password);
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    const created = existing
      ? null
      : await this.prisma.user
          .create({
            data: {
              email: input.email,
              passwordHash,
              role: 'CANDIDATE',
              locale: input.locale,
              candidateProfile: {
                create: {
                  firstName: input.firstName,
                  lastName: input.lastName,
                  phone: input.phone,
                  countryOfResidence: input.country,
                  gdprConsentAt: new Date(),
                },
              },
            },
            select: { id: true },
          })
          .catch((error: unknown) => {
            // Two registrations with the same email at the same time: the second one loses.
            if (error instanceof Error && 'code' in error && error.code === 'P2002') {
              return null;
            }
            throw error;
          });

    if (created) {
      await this.sendTokenEmail(created.id, input.email, input.locale, 'verify-email');
    } else {
      // The owner of the address is told; the caller learns nothing.
      await this.mail.send(input.email, 'account-exists', input.locale, {
        actionUrl: this.mail.linkFor('account-exists', input.locale),
        expiresInHours: msToHours(RESET_PASSWORD_TTL_MS),
      });
    }
    return REGISTER_ACK;
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.emailTokens.find(token, ['VERIFY_EMAIL']);
    if (!record) {
      throw invalidToken();
    }
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.emailTokens.consume(record.id, tx))) {
        throw invalidToken();
      }
      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
  }

  async resendVerification(input: EmailOnlyInput): Promise<Acknowledgement> {
    const user = await this.findUsableUser(input.email);
    if (user && !user.emailVerifiedAt) {
      await this.sendTokenEmail(user.id, user.email, user.locale, 'verify-email');
    }
    return EMAIL_ACK;
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const usable = user?.passwordHash && user.isActive && !user.deletedAt ? user : null;
    const passwordMatches = await verifyPassword(
      usable?.passwordHash ?? (await this.getDummyHash()),
      input.password,
    );

    if (!usable) {
      throw invalidCredentials();
    }
    if (usable.lockedUntil && usable.lockedUntil > new Date()) {
      // Refused even with the right password, and without telling which case it is.
      throw invalidCredentials();
    }
    if (!passwordMatches) {
      await this.recordFailedLogin(usable.id);
      throw invalidCredentials();
    }

    const updated = await this.prisma.user.update({
      where: { id: usable.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      select: { tokenVersion: true },
    });
    return {
      user: await this.currentUser(usable.id),
      accessToken: await this.tokens.signAccessToken(usable.id, updated.tokenVersion),
      refreshToken: await this.sessions.start(usable.id, meta),
    };
  }

  /** Exchanges a refresh token for a new pair. The old refresh token stops working. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!refreshToken) {
      throw unauthenticated();
    }
    const rotation = await this.sessions.rotate(refreshToken, meta);
    if (!rotation.ok) {
      throw unauthenticated('The session has expired. Sign in again.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: rotation.userId },
      select: { isActive: true, deletedAt: true, tokenVersion: true },
    });
    if (!user || !user.isActive || user.deletedAt) {
      await this.sessions.endAll(rotation.userId);
      throw unauthenticated();
    }
    return {
      user: await this.currentUser(rotation.userId),
      accessToken: await this.tokens.signAccessToken(rotation.userId, user.tokenVersion),
      refreshToken: rotation.refreshToken,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.sessions.end(refreshToken);
    }
  }

  async forgotPassword(input: EmailOnlyInput): Promise<Acknowledgement> {
    const user = await this.findUsableUser(input.email);
    if (user) {
      await this.sendTokenEmail(user.id, user.email, user.locale, 'reset-password');
    }
    return EMAIL_ACK;
  }

  /**
   * Sets a new password from a reset link or an invitation link. Using the link
   * proves control of the mailbox, so the address is also marked as verified.
   * Every existing session and access token of the user stops working.
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const record = await this.emailTokens.find(input.token, ['RESET_PASSWORD', 'INVITATION']);
    if (!record) {
      throw invalidToken();
    }
    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: { email: true, emailVerifiedAt: true, isActive: true, deletedAt: true },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw invalidToken();
    }
    // Checked before the token is consumed: a weak password must not burn the link.
    this.passwordPolicy.assertStrong(input.password, [user.email]);
    const passwordHash = await hashPassword(input.password);

    await this.prisma.$transaction(async (tx) => {
      if (!(await this.emailTokens.consume(record.id, tx))) {
        throw invalidToken();
      }
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      });
      await this.sessions.endAll(record.userId, tx);
    });
  }

  async currentUser(userId: string): Promise<CurrentUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        locale: true,
        emailVerifiedAt: true,
        candidateProfile: { select: { firstName: true, lastName: true } },
      },
    });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      locale: localeSchema.catch('en').parse(user.locale),
      firstName: user.candidateProfile?.firstName ?? null,
      lastName: user.candidateProfile?.lastName ?? null,
    };
  }

  /** Counts a wrong password and locks the account at the limit. */
  private async recordFailedLogin(userId: string): Promise<void> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + ACCOUNT_LOCK_MS) },
      });
      this.logger.warn(`Account locked after ${MAX_FAILED_LOGINS} failed logins (user ${userId})`);
    }
  }

  private async findUsableUser(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        locale: true,
        emailVerifiedAt: true,
        isActive: true,
        deletedAt: true,
      },
    });
    if (!user || !user.isActive || user.deletedAt) {
      return null;
    }
    return { ...user, locale: localeSchema.catch('en').parse(user.locale) };
  }

  private async sendTokenEmail(
    userId: string,
    email: string,
    locale: CurrentUser['locale'],
    template: Extract<EmailTemplate, 'verify-email' | 'reset-password'>,
  ): Promise<void> {
    const [type, ttl] =
      template === 'verify-email'
        ? (['VERIFY_EMAIL', VERIFY_EMAIL_TTL_MS] as const)
        : (['RESET_PASSWORD', RESET_PASSWORD_TTL_MS] as const);
    const token = await this.emailTokens.issue(userId, type, ttl);
    await this.mail.send(email, template, locale, {
      actionUrl: this.mail.linkFor(template, locale, token),
      expiresInHours: msToHours(ttl),
    });
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(this.tokens.generateOpaqueToken().token);
    return this.dummyHash;
  }
}
