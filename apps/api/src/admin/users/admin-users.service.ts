import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ADMIN_ROLES,
  adminRoleSchema,
  localeSchema,
  type AdminRole,
  type AdminUser,
  type CreateAdminUserInput,
  type ListAdminUsersQuery,
  type Paginated,
} from '@iconbridge/shared';
import { INVITATION_TTL_MS, msToHours } from '../../auth/auth.constants.js';
import { EmailTokenService } from '../../auth/email-token.service.js';
import { SessionService } from '../../auth/session.service.js';
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

/** Back-office accounts (VIEWER, RECRUITER, SUPER_ADMIN). Candidate accounts are out of scope: they answer 404. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly emailTokens: EmailTokenService,
    private readonly mail: MailService,
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

  /** Creates the account without a password and emails a set-password link. */
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
    const { row, token } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, role: input.role, locale: input.locale },
        select: ADMIN_SELECT,
      });
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

  async changeRole(id: string, role: AdminRole): Promise<AdminUser> {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.lockAdmin(tx, id);
      if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN' && target.isActive) {
        await this.assertAnotherSuperAdmin(tx, id);
      }
      return toAdminUser(
        await tx.user.update({ where: { id }, data: { role }, select: ADMIN_SELECT }),
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
