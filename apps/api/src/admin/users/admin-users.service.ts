import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ADMIN_ROLES,
  adminRoleSchema,
  localeSchema,
  type AdminRole,
  type AdminUser,
  type ChangeAdminRoleInput,
  type CreateAdminUserInput,
  type ListAdminUsersQuery,
  type Paginated,
} from '@iconbridge/shared';
import { INVITATION_TTL_MS, msToHours } from '../../auth/auth.constants.js';
import { EmailTokenService } from '../../auth/email-token.service.js';
import { PasswordPolicyService } from '../../auth/password-policy.service.js';
import { SessionService } from '../../auth/session.service.js';
import { hashPassword } from '../../common/crypto/password.js';
import { AppException, notFound } from '../../common/errors/app.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MailService } from '../../mail/mail.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const ADMIN_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  passwordHash: true,
  passwordChangeRequired: true,
  assignedCountries: true,
  locale: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type AdminRow = Prisma.UserGetPayload<{ select: typeof ADMIN_SELECT }>;

function toAdminUser(row: AdminRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    role: adminRoleSchema.parse(row.role),
    isActive: row.isActive,
    hasPassword: row.passwordHash !== null,
    passwordChangeRequired: row.passwordChangeRequired,
    assignedCountries: row.assignedCountries,
    locale: localeSchema.catch('en').parse(row.locale),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const lastSuperAdmin = () =>
  new AppException(
    'LAST_SUPER_ADMIN',
    HttpStatus.CONFLICT,
    'The platform must keep at least one active super admin',
  );

/**
 * Back-office accounts (VIEWER, COUNTRY_AGENT, RECRUITER, SUPER_ADMIN). Candidate accounts
 * are out of scope: they answer 404. Passwords a super admin sets are hashed at once and
 * never returned, logged or audited; the person must change them at the next sign-in.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly emailTokens: EmailTokenService,
    private readonly mail: MailService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async list(query: ListAdminUsersQuery): Promise<Paginated<AdminUser>> {
    const where: Prisma.UserWhereInput = {
      role: query.role ?? { in: [...ADMIN_ROLES] },
      deletedAt: null,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: ADMIN_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map(toAdminUser), page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Creates the account. Without `password`, it has none and an invitation email with a
   * set-password link is sent. With one (checked like every password), no email is sent
   * and the person must choose a new password at the first sign-in (ADR-024).
   */
  async create(input: CreateAdminUserInput): Promise<AdminUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new AppException(
        'EMAIL_TAKEN',
        HttpStatus.CONFLICT,
        'An account already uses this email address',
      );
    }
    const data = {
      email: input.email,
      role: input.role,
      locale: input.locale,
      assignedCountries: input.role === 'COUNTRY_AGENT' ? (input.countries ?? []) : [],
    };
    if (input.password) {
      this.passwordPolicy.assertStrong(input.password, [input.email]);
      const passwordHash = await hashPassword(input.password);
      return toAdminUser(
        await this.prisma.user.create({
          // The person chose nothing yet: an email address of their own is not proven either.
          data: { ...data, passwordHash, passwordChangeRequired: true },
          select: ADMIN_SELECT,
        }),
      );
    }
    const { row, token } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data, select: ADMIN_SELECT });
      return {
        row: created,
        token: await this.emailTokens.issue(created.id, 'INVITATION', INVITATION_TTL_MS, tx),
      };
    });
    await this.mail.send(input.email, 'invitation', input.locale, {
      actionUrl: this.mail.linkFor('invitation', input.locale, token),
      expiresInHours: msToHours(INVITATION_TTL_MS),
    });
    return toAdminUser(row);
  }

  /** The role, and for a country agent his countries; other roles keep none. */
  async changeRole(id: string, input: ChangeAdminRoleInput): Promise<AdminUser> {
    const role: AdminRole = input.role;
    return this.prisma.$transaction(async (tx) => {
      const target = await this.lockAdmin(tx, id);
      if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN' && target.isActive) {
        await this.assertAnotherSuperAdmin(tx, id);
      }
      return toAdminUser(
        await tx.user.update({
          where: { id },
          data: {
            role,
            assignedCountries: role === 'COUNTRY_AGENT' ? (input.countries ?? []) : [],
          },
          select: ADMIN_SELECT,
        }),
      );
    });
  }

  /**
   * Sets the password of a back-office account (e.g. a new agent, or one who lost access).
   * Every session ends; the person must choose a new password at the next sign-in. Only
   * the fact is audited, never the password.
   */
  async setPassword(id: string, password: string): Promise<AdminUser> {
    const target = await this.prisma.user.findFirst({
      where: { id, role: { in: [...ADMIN_ROLES] }, deletedAt: null },
      select: { email: true },
    });
    if (!target) {
      throw notFound('Admin account not found');
    }
    this.passwordPolicy.assertStrong(password, [target.email]);
    const passwordHash = await hashPassword(password);
    return this.prisma.$transaction(async (tx) => {
      await this.lockAdmin(tx, id);
      await this.sessions.endAll(id, tx);
      // A pending invitation link would let somebody else choose another password.
      await tx.emailToken.deleteMany({ where: { userId: id, type: 'INVITATION' } });
      return toAdminUser(
        await tx.user.update({
          where: { id },
          data: {
            passwordHash,
            passwordChangeRequired: true,
            tokenVersion: { increment: 1 },
            failedLoginCount: 0,
            lockedUntil: null,
          },
          select: ADMIN_SELECT,
        }),
      );
    });
  }

  /** Disables the account and signs it out everywhere. */
  async disable(id: string, actorId: string): Promise<AdminUser> {
    if (id === actorId) {
      throw new AppException(
        'CANNOT_DISABLE_SELF',
        HttpStatus.CONFLICT,
        'You cannot disable your own account',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await this.lockAdmin(tx, id);
      if (target.role === 'SUPER_ADMIN' && target.isActive) {
        await this.assertAnotherSuperAdmin(tx, id);
      }
      await this.sessions.endAll(id, tx);
      return toAdminUser(
        await tx.user.update({
          where: { id },
          data: { isActive: false, tokenVersion: { increment: 1 } },
          select: ADMIN_SELECT,
        }),
      );
    });
  }

  async enable(id: string): Promise<AdminUser> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAdmin(tx, id);
      return toAdminUser(
        await tx.user.update({ where: { id }, data: { isActive: true }, select: ADMIN_SELECT }),
      );
    });
  }

  /**
   * Removes a back-office account for good: it is signed out, loses its password and
   * its address (which becomes free again), and no longer appears in the list. The
   * row stays, without the address, so the audit log still has an author to point to.
   */
  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId) {
      throw new AppException(
        'CANNOT_DISABLE_SELF',
        HttpStatus.CONFLICT,
        'You cannot delete your own account',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const target = await this.lockAdmin(tx, id);
      if (target.role === 'SUPER_ADMIN' && target.isActive) {
        await this.assertAnotherSuperAdmin(tx, id);
      }
      await this.sessions.endAll(id, tx);
      await tx.emailToken.deleteMany({ where: { userId: id } });
      await tx.user.update({
        where: { id },
        data: {
          email: `deleted-${randomUUID()}@deleted.invalid`,
          passwordHash: null,
          isActive: false,
          tokenVersion: { increment: 1 },
          deletedAt: new Date(),
        },
      });
    });
  }

  /** Revokes every refresh token and invalidates the access tokens already issued. */
  async forceLogout(id: string): Promise<AdminUser> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAdmin(tx, id);
      await this.sessions.endAll(id, tx);
      return toAdminUser(
        await tx.user.update({
          where: { id },
          data: { tokenVersion: { increment: 1 } },
          select: ADMIN_SELECT,
        }),
      );
    });
  }

  /**
   * Locks every active super-admin row, then reads the target. Two concurrent
   * requests that would each remove one of the last two super admins therefore
   * run one after the other, and the second one is refused.
   */
  private async lockAdmin(tx: Prisma.TransactionClient, id: string): Promise<AdminRow> {
    await tx.$queryRaw`
      SELECT id FROM users
      WHERE role = 'SUPER_ADMIN' AND is_active AND deleted_at IS NULL
      ORDER BY id
      FOR UPDATE`;
    const target = await tx.user.findFirst({
      where: { id, role: { in: [...ADMIN_ROLES] }, deletedAt: null },
      select: ADMIN_SELECT,
    });
    if (!target) {
      throw notFound('Admin account not found');
    }
    return target;
  }

  private async assertAnotherSuperAdmin(
    tx: Prisma.TransactionClient,
    exceptId: string,
  ): Promise<void> {
    const others = await tx.user.count({
      where: { role: 'SUPER_ADMIN', isActive: true, deletedAt: null, id: { not: exceptId } },
    });
    if (others === 0) {
      throw lastSuperAdmin();
    }
  }
}
