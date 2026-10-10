import { Injectable } from '@nestjs/common';
import type { EmailTokenType } from '@iconbridge/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokenService } from './token.service.js';

export interface EmailTokenRecord {
  id: string;
  userId: string;
  type: EmailTokenType;
}

/** One-time tokens sent in email links (verification, password reset, invitation). */
@Injectable()
export class EmailTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** Creates a token and discards earlier unused ones of the same type: only the last link works. */
  async issue(
    userId: string,
    type: EmailTokenType,
    ttlMs: number,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    const { token, hash } = this.tokens.generateOpaqueToken();
    await client.emailToken.deleteMany({ where: { userId, type, usedAt: null } });
    await client.emailToken.create({
      data: { userId, type, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** A usable token of one of the given types, or null. Does not consume it. */
  async find(token: string, types: readonly EmailTokenType[]): Promise<EmailTokenRecord | null> {
    return this.prisma.emailToken.findFirst({
      where: {
        tokenHash: this.tokens.hashToken(token),
        type: { in: [...types] },
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true, type: true },
    });
  }

  /**
   * Marks the token as used. False when it was used or expired in the meantime,
   * so two requests with the same link cannot both succeed.
   */
  async consume(id: string, client: Prisma.TransactionClient): Promise<boolean> {
    const result = await client.emailToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return result.count === 1;
  }
}
