import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** users.token_version when the token was signed. */
  tv: number;
}

export interface OpaqueToken {
  /** Sent to the client (cookie or email link). Never stored. */
  token: string;
  /** Stored in the database. */
  hash: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * A random `jti` makes every token unique: two tokens for the same user signed in the
   * same second (sign-in, then a quick refresh) would otherwise be identical, because
   * `iat` and `exp` count whole seconds.
   */
  signAccessToken(userId: string, tokenVersion: number): Promise<string> {
    return this.jwt.signAsync({ sub: userId, tv: tokenVersion } satisfies AccessTokenPayload, {
      jwtid: randomUUID(),
    });
  }

  /** Null when the token is missing, malformed, expired or signed with another key. */
  async verifyAccessToken(token: string | undefined): Promise<AccessTokenPayload | null> {
    if (!token) {
      return null;
    }
    try {
      const payload: unknown = await this.jwt.verifyAsync(token);
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'sub' in payload &&
        typeof payload.sub === 'string' &&
        'tv' in payload &&
        typeof payload.tv === 'number'
      ) {
        return { sub: payload.sub, tv: payload.tv };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 256 random bits, for refresh tokens and email links. */
  generateOpaqueToken(): OpaqueToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashToken(token) };
  }

  /** SHA-256 is enough here: the input is a random 256-bit value, not a password. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
