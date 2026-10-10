import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REFRESH_TOKEN_TTL_MS } from './auth.constants.js';
import type { RequestMeta } from './auth.types.js';
import { TokenService } from './token.service.js';

export type RotationResult =
  | { ok: true; userId: string; refreshToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

/**
 * Refresh-token sessions. Each login starts a family; every refresh replaces the
 * token by a new one of the same family. Presenting a token that was already
 * replaced means it was copied: the whole family is revoked.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async start(userId: string, meta: RequestMeta): Promise<string> {
    return this.issue(this.prisma, userId, randomUUID(), meta);
  }

  async rotate(refreshToken: string, meta: RequestMeta): Promise<RotationResult> {
    const tokenHash = this.tokens.hashToken(refreshToken);
    const current = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!current) {
      return { ok: false, reason: 'unknown' };
    }
    if (current.revokedAt) {
      await this.revokeFamily(current.familyId);
      this.logger.warn(
        `Refresh token reuse detected; session family revoked (user ${current.userId})`,
      );
      return { ok: false, reason: 'reused' };
    }
    if (current.expiresAt <= new Date()) {
      return { ok: false, reason: 'expired' };
    }

    const next = await this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent refreshes with the same token, one gets count 0.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) {
        return null;
      }
      return this.issue(tx, current.userId, current.familyId, meta);
    });

    if (!next) {
      await this.revokeFamily(current.familyId);
      this.logger.warn(
        `Concurrent refresh token use; session family revoked (user ${current.userId})`,
      );
      return { ok: false, reason: 'reused' };
    }
    return { ok: true, userId: current.userId, refreshToken: next };
  }

  /** Logout: ends the session the token belongs to. Unknown tokens are ignored. */
  async end(refreshToken: string): Promise<void> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashToken(refreshToken) },
      select: { familyId: true },
    });
    if (current) {
      await this.revokeFamily(current.familyId);
    }
  }

  /** Ends every session of a user (password reset, disabled account, forced logout). */
  async endAll(userId: string, client: Prisma.TransactionClient = this.prisma): Promise<number> {
    const result = await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(
    client: Prisma.TransactionClient,
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<string> {
    const { token, hash } = this.tokens.generateOpaqueToken();
    await client.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    return token;
  }
}
