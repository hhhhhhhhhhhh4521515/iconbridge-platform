import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

/**
 * Cloudflare's documented test secrets ("1x…" always passes, "2x…" always fails,
 * "3x…" reports a spent token). They are public, so production refuses to start
 * with one (see config/env.ts).
 */

const ALWAYS_PASSES_SECRET = /^1x0{10,}/;

/** Server-side check of a Cloudflare Turnstile token. */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secret: string;
  /** Development with the always-pass test secret: Cloudflare would accept any token anyway. */
  private readonly offline: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('TURNSTILE_SECRET_KEY', { infer: true });
    this.offline =
      config.get('NODE_ENV', { infer: true }) !== 'production' &&
      ALWAYS_PASSES_SECRET.test(this.secret);
  }

  /** False when Cloudflare rejects the token and also when it cannot be reached (fail closed). */
  async verify(token: string, ip: string | null): Promise<boolean> {
    if (this.offline) {
      // Same result as calling Cloudflare, without needing internet access to develop.
      return true;
    }
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) {
      body.set('remoteip', ip);
    }
    try {
      const response = await fetch(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const result = (await response.json()) as { success?: unknown };
      return result.success === true;
    } catch (error) {
      this.logger.error(
        `Turnstile verification unavailable: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return false;
    }
  }
}
