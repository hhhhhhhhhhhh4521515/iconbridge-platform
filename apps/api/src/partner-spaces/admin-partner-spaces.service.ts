import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_ROLES,
  adminRoleSchema,
  partnerLocaleSchema,
  type AddPartnerStaffMemberInput,
  type CreatePartnerLoginInput,
  type CreatePartnerSpaceInput,
  type PartnerLogin,
  type PartnerSpace,
  type PartnerStaffMember,
  type UpdatePartnerLoginInput,
  type UpdatePartnerSpaceInput,
} from '@iconbridge/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { PasswordPolicyService } from '../auth/password-policy.service.js';
import { SessionService } from '../auth/session.service.js';
import { hashPassword } from '../common/crypto/password.js';
import { AppException, notFound } from '../common/errors/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../admin/audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  actorOf,
  changedFields,
  PartnerHistoryService,
  type PartnerActor,
} from './partner-history.service.js';
import { PartnerFilesService } from './partner-files.service.js';

const SPACE_SELECT = {
  id: true,
  name: true,
  country: true,
  defaultLocale: true,
  isActive: true,
  logoPath: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      members: { where: { kind: 'STAFF' } },
      jobs: true,
      applications: true,
      files: true,
    },
  },
} satisfies Prisma.PartnerSpaceSelect;

type SpaceRow = Prisma.PartnerSpaceGetPayload<{ select: typeof SPACE_SELECT }>;

const LOGIN_SELECT = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
  passwordChangeRequired: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type LoginRow = Prisma.UserGetPayload<{ select: typeof LOGIN_SELECT }>;

function toLogin(row: LoginRow): PartnerLogin {
  return {
    ...row,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const spaceNotFound = () => notFound('Partner space not found');
const loginNotFound = () => notFound('Partner login not found');

const nameTaken = () =>
  new AppException(
    'PARTNER_SPACE_NAME_TAKEN',
    HttpStatus.CONFLICT,
    'Another partner space already has this name',
  );

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'P2002';

/**
 * The super admin's management of partner spaces (ADR-027): the spaces, their staff
 * members and their partner logins. Nothing here reads or returns a space's content; the
 * counts are all the super admin sees until they add themselves as a member.
 */
@Injectable()
export class AdminPartnerSpacesService {
  private readonly logger = new Logger(AdminPartnerSpacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly history: PartnerHistoryService,
    private readonly sessions: SessionService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly audit: AuditService,
    private readonly files: PartnerFilesService,
  ) {}

  async list(actor: AuthUser): Promise<PartnerSpace[]> {
    const rows = await this.prisma.partnerSpace.findMany({
      select: SPACE_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return this.withMembership(rows, actor.id);
  }

  async get(spaceId: string, actor: AuthUser): Promise<PartnerSpace> {
    const row = await this.prisma.partnerSpace.findUnique({
      where: { id: spaceId },
      select: SPACE_SELECT,
    });
    if (!row) {
      throw spaceNotFound();
    }
    const [space] = await this.withMembership([row], actor.id);
    return space as PartnerSpace;
  }

  async create(input: CreatePartnerSpaceInput, actor: AuthUser): Promise<PartnerSpace> {
    await this.assertNameFree(input.name);
    const who = await this.actor(actor.id);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const space = await tx.partnerSpace.create({
          data: { ...input, createdById: actor.id },
          select: { id: true },
        });
        await this.history.record(tx, {
          spaceId: space.id,
          actor: who,
          entityType: 'space',
          entityId: space.id,
          action: 'SPACE_CREATED',
          changes: [
            { field: 'name', oldValue: null, newValue: input.name },
            { field: 'country', oldValue: null, newValue: input.country },
            { field: 'defaultLocale', oldValue: null, newValue: input.defaultLocale },
          ],
        });
        return space.id;
      });
      return await this.get(id, actor);
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken() : error;
    }
  }

  async update(
    spaceId: string,
    input: UpdatePartnerSpaceInput,
    actor: AuthUser,
  ): Promise<PartnerSpace> {
    if (input.name !== undefined) {
      await this.assertNameFree(input.name, spaceId);
    }
    const who = await this.actor(actor.id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.partnerSpace.findUnique({
          where: { id: spaceId },
          select: { name: true, country: true, defaultLocale: true, isActive: true },
        });
        if (!before) {
          throw spaceNotFound();
        }
        const changes = changedFields(before, input);
        if (changes.length === 0) {
          return;
        }
        await tx.partnerSpace.update({ where: { id: spaceId }, data: input });
        if (input.defaultLocale !== undefined && input.defaultLocale !== before.defaultLocale) {
          // The partner logins' emails follow the space's language (ADR-027, answer 6).
          await tx.user.updateMany({
            where: { role: 'PARTNER', partnerMemberships: { some: { partnerSpaceId: spaceId } } },
            data: { locale: input.defaultLocale },
          });
        }
        await this.history.record(tx, {
          spaceId,
          actor: who,
          entityType: 'space',
          entityId: spaceId,
          action: 'SPACE_UPDATED',
          changes,
        });
      });
    } catch (error) {
      throw isUniqueViolation(error) ? nameTaken() : error;
    }
    return this.get(spaceId, actor);
  }

  /**
   * Deletes the space and everything in it (GDPR): its files first, then its rows (one
   * transaction, cascade), then its partner logins and their sessions. The super admin types
   * the space's name to confirm. The audit entry holds counts, never names.
   */
  async remove(
    spaceId: string,
    confirmName: string,
    actor: AuthUser,
    ip: string | null,
  ): Promise<void> {
    const space = await this.prisma.partnerSpace.findUnique({
      where: { id: spaceId },
      select: SPACE_SELECT,
    });
    if (!space) {
      throw spaceNotFound();
    }
    if (confirmName.trim() !== space.name) {
      throw new AppException(
        'CONFIRMATION_MISMATCH',
        HttpStatus.BAD_REQUEST,
        'Type the name of the space exactly to delete it',
      );
    }
    // The blobs first (files and logo, everything under spaces/<id>/), then a check that
    // none remains. If that fails, no row is deleted and a retry finishes the job.
    const blobs = await this.files.deleteSpaceBlobs(spaceId);
    await this.prisma.$transaction(async (tx) => {
      const logins = await tx.partnerSpaceMember.findMany({
        where: { partnerSpaceId: spaceId, kind: 'PARTNER' },
        select: { userId: true },
      });
      const loginIds = logins.map((login) => login.userId);
      await tx.partnerSpace.delete({ where: { id: spaceId } });
      // The logins exist only for this space: deleted with it, their tokens with them.
      const deletedLogins = await tx.user.deleteMany({
        where: { id: { in: loginIds }, role: 'PARTNER' },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'partner_space.delete',
          entityType: 'partner_space',
          entityId: spaceId,
          before: {
            staffMembers: space._count.members,
            partnerLogins: deletedLogins.count,
            jobs: space._count.jobs,
            applications: space._count.applications,
            files: space._count.files,
            blobs,
          },
          after: null,
          ip,
        },
        tx,
      );
    });
    // An upload that raced the deletion left a blob that no row points to any more.
    const left = await this.files.deleteSpaceBlobs(spaceId).catch(() => null);
    if (left === null) {
      this.logger.warn(`Blobs of deleted partner space ${spaceId} left in storage`);
    }
  }

  /** The space's logo (super admin): checked from its bytes, re-encoded, private. */
  async setLogo(spaceId: string, content: Buffer, actor: AuthUser): Promise<PartnerSpace> {
    await this.files.setLogo(spaceId, content, await this.actor(actor.id));
    return this.get(spaceId, actor);
  }

  async removeLogo(spaceId: string, actor: AuthUser): Promise<PartnerSpace> {
    await this.files.removeLogo(spaceId, await this.actor(actor.id));
    return this.get(spaceId, actor);
  }

  async listStaff(spaceId: string): Promise<PartnerStaffMember[]> {
    await this.assertSpace(spaceId);
    const rows = await this.prisma.partnerSpaceMember.findMany({
      where: { partnerSpaceId: spaceId, kind: 'STAFF' },
      select: {
        createdAt: true,
        user: {
          select: { id: true, email: true, displayName: true, role: true, isActive: true },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    });
    return rows.map((row) => ({
      userId: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      role: adminRoleSchema.parse(row.user.role),
      isActive: row.user.isActive,
      addedAt: row.createdAt.toISOString(),
    }));
  }

  /** Any active back-office account may be a member, with full rights inside (answer 2). */
  async addStaff(
    spaceId: string,
    input: AddPartnerStaffMemberInput,
    actor: AuthUser,
  ): Promise<PartnerStaffMember[]> {
    await this.assertSpace(spaceId);
    const staff = await this.prisma.user.findFirst({
      where: {
        id: input.userId,
        role: { in: [...ADMIN_ROLES] },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, email: true, displayName: true },
    });
    if (!staff) {
      throw new AppException(
        'NOT_A_STAFF_ACCOUNT',
        HttpStatus.BAD_REQUEST,
        'Only an active back-office account can be added as a member',
      );
    }
    const who = await this.actor(actor.id);
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.partnerSpaceMember.createMany({
        data: [{ partnerSpaceId: spaceId, userId: staff.id, kind: 'STAFF', addedById: actor.id }],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await this.history.record(tx, {
          spaceId,
          actor: who,
          entityType: 'member',
          entityId: staff.id,
          action: 'MEMBER_ADDED',
          changes: [{ field: 'member', oldValue: null, newValue: actorOf(staff).name }],
        });
      }
    });
    return this.listStaff(spaceId);
  }

  /** Takes effect at the member's next request: the space answers 404 from then on. */
  async removeStaff(spaceId: string, userId: string, actor: AuthUser): Promise<void> {
    await this.assertSpace(spaceId);
    const who = await this.actor(actor.id);
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.partnerSpaceMember.findFirst({
        where: { partnerSpaceId: spaceId, userId, kind: 'STAFF' },
        select: { user: { select: { id: true, email: true, displayName: true } } },
      });
      if (!member) {
        throw notFound('Member not found');
      }
      await tx.partnerSpaceMember.delete({
        where: { partnerSpaceId_userId: { partnerSpaceId: spaceId, userId } },
      });
      await this.history.record(tx, {
        spaceId,
        actor: who,
        entityType: 'member',
        entityId: userId,
        action: 'MEMBER_REMOVED',
        changes: [{ field: 'member', oldValue: actorOf(member.user).name, newValue: null }],
      });
    });
  }

  async listLogins(spaceId: string): Promise<PartnerLogin[]> {
    await this.assertSpace(spaceId);
    const rows = await this.prisma.user.findMany({
      where: {
        role: 'PARTNER',
        partnerMemberships: { some: { partnerSpaceId: spaceId, kind: 'PARTNER' } },
      },
      select: LOGIN_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toLogin);
  }

  /**
   * A login of the partner company, in this space only. The password is set now and must be
   * changed at the first sign-in; it is never returned, logged or audited (ADR-024).
   */
  async createLogin(
    spaceId: string,
    input: CreatePartnerLoginInput,
    actor: AuthUser,
  ): Promise<PartnerLogin> {
    const space = await this.prisma.partnerSpace.findUnique({
      where: { id: spaceId },
      select: { defaultLocale: true },
    });
    if (!space) {
      throw spaceNotFound();
    }
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
    this.passwordPolicy.assertStrong(input.password, [input.email, input.displayName]);
    const passwordHash = await hashPassword(input.password);
    const who = await this.actor(actor.id);
    try {
      const login = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            displayName: input.displayName,
            role: 'PARTNER',
            locale: partnerLocaleSchema.parse(space.defaultLocale),
            passwordHash,
            passwordChangeRequired: true,
            partnerMemberships: {
              create: { partnerSpaceId: spaceId, kind: 'PARTNER', addedById: actor.id },
            },
          },
          select: LOGIN_SELECT,
        });
        await this.history.record(tx, {
          spaceId,
          actor: who,
          entityType: 'login',
          entityId: user.id,
          action: 'LOGIN_CREATED',
          changes: [{ field: 'login', oldValue: null, newValue: input.displayName }],
        });
        return user;
      });
      return toLogin(login);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          'EMAIL_TAKEN',
          HttpStatus.CONFLICT,
          'An account already uses this email address',
        );
      }
      throw error;
    }
  }

  /** Disabling ends every session at once; the next request with an old token answers 401. */
  async updateLogin(
    spaceId: string,
    userId: string,
    input: UpdatePartnerLoginInput,
    actor: AuthUser,
  ): Promise<PartnerLogin> {
    const who = await this.actor(actor.id);
    return toLogin(
      await this.prisma.$transaction(async (tx) => {
        const before = await this.loginOf(tx, spaceId, userId);
        const changes = changedFields(
          { displayName: before.displayName, isActive: before.isActive },
          input,
        );
        if (changes.length === 0) {
          return before;
        }
        const disabling = input.isActive === false && before.isActive;
        if (disabling) {
          await this.sessions.endAll(userId, tx);
        }
        const updated = await tx.user.update({
          where: { id: userId },
          data: { ...input, ...(disabling ? { tokenVersion: { increment: 1 } } : {}) },
          select: LOGIN_SELECT,
        });
        await this.history.record(tx, {
          spaceId,
          actor: who,
          entityType: 'login',
          entityId: userId,
          action: 'LOGIN_UPDATED',
          changes,
        });
        return updated;
      }),
    );
  }

  /** Every session ends; the person must choose a new password at the next sign-in. */
  async setLoginPassword(
    spaceId: string,
    userId: string,
    password: string,
    actor: AuthUser,
  ): Promise<PartnerLogin> {
    const target = await this.loginOf(this.prisma, spaceId, userId);
    this.passwordPolicy.assertStrong(password, [target.email, target.displayName ?? '']);
    const passwordHash = await hashPassword(password);
    const who = await this.actor(actor.id);
    return toLogin(
      await this.prisma.$transaction(async (tx) => {
        await this.loginOf(tx, spaceId, userId);
        await this.sessions.endAll(userId, tx);
        await tx.emailToken.deleteMany({ where: { userId } });
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            passwordHash,
            passwordChangeRequired: true,
            tokenVersion: { increment: 1 },
            failedLoginCount: 0,
            lockedUntil: null,
          },
          select: LOGIN_SELECT,
        });
        // The fact only, never the password.
        await this.history.record(tx, {
          spaceId,
          actor: who,
          entityType: 'login',
          entityId: userId,
          action: 'LOGIN_PASSWORD_SET',
        });
        return updated;
      }),
    );
  }

  /** A partner login of this space, or 404 (a login of another space included). */
  private async loginOf(
    client: Prisma.TransactionClient,
    spaceId: string,
    userId: string,
  ): Promise<LoginRow> {
    const row = await client.user.findFirst({
      where: {
        id: userId,
        role: 'PARTNER',
        partnerMemberships: { some: { partnerSpaceId: spaceId, kind: 'PARTNER' } },
      },
      select: LOGIN_SELECT,
    });
    if (!row) {
      throw loginNotFound();
    }
    return row;
  }

  private async assertSpace(spaceId: string): Promise<void> {
    const found = await this.prisma.partnerSpace.count({ where: { id: spaceId } });
    if (found === 0) {
      throw spaceNotFound();
    }
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const other = await this.prisma.partnerSpace.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (other) {
      throw nameTaken();
    }
  }

  private async actor(userId: string): Promise<PartnerActor> {
    return actorOf(
      await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, displayName: true },
      }),
    );
  }

  private async withMembership(rows: SpaceRow[], userId: string): Promise<PartnerSpace[]> {
    const ids = rows.map((row) => row.id);
    const [memberships, logins] = await Promise.all([
      this.prisma.partnerSpaceMember.findMany({
        where: { userId, partnerSpaceId: { in: ids } },
        select: { partnerSpaceId: true },
      }),
      this.prisma.partnerSpaceMember.groupBy({
        by: ['partnerSpaceId'],
        where: { partnerSpaceId: { in: ids }, kind: 'PARTNER' },
        _count: { _all: true },
      }),
    ]);
    const mine = new Set(memberships.map((row) => row.partnerSpaceId));
    const loginCounts = new Map(logins.map((row) => [row.partnerSpaceId, row._count._all]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      country: row.country,
      defaultLocale: partnerLocaleSchema.parse(row.defaultLocale),
      isActive: row.isActive,
      hasLogo: row.logoPath !== null,
      counts: {
        staffMembers: row._count.members,
        partnerLogins: loginCounts.get(row.id) ?? 0,
        jobs: row._count.jobs,
        applications: row._count.applications,
        files: row._count.files,
      },
      isMember: mine.has(row.id),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}
