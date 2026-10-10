import { JwtService } from '@nestjs/jwt';
import type { RegisterInput } from '@iconbridge/shared';
import { hashPassword } from '../common/crypto/password.js';
import { AppException } from '../common/errors/app.exception.js';
import type { MailService } from '../mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { EMAIL_ACK, REGISTER_ACK, AuthService } from './auth.service.js';
import type { EmailTokenService } from './email-token.service.js';
import { PasswordPolicyService } from './password-policy.service.js';
import type { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';
import type { TurnstileService } from './turnstile.service.js';

const META = { ip: '203.0.113.7', userAgent: 'vitest' };
const PASSWORD = 'river-lantern-quartz-42';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const registerInput: RegisterInput = {
  email: 'new@example.test',
  password: PASSWORD,
  firstName: 'New',
  lastName: 'Candidate',
  phone: '+21612345678',
  country: 'TN',
  gdprConsent: true,
  turnstileToken: 'turnstile-token',
  locale: 'fr',
};

let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'known@example.test',
    passwordHash,
    role: 'CANDIDATE',
    locale: 'en',
    isActive: true,
    deletedAt: null,
    emailVerifiedAt: new Date(),
    lockedUntil: null,
    failedLoginCount: 0,
    tokenVersion: 0,
    candidateProfile: { firstName: 'Known', lastName: 'User' },
    ...overrides,
  };
}

function setup(existing: ReturnType<typeof userRow> | null = null) {
  const user = {
    findUnique: vi.fn().mockResolvedValue(existing),
    findUniqueOrThrow: vi.fn().mockResolvedValue(existing ?? userRow()),
    create: vi.fn().mockResolvedValue({ id: USER_ID }),
    update: vi.fn().mockResolvedValue({ failedLoginCount: 1, tokenVersion: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = { user };
  const prisma = {
    user,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  } as unknown as PrismaService;
  const sessions = {
    start: vi.fn().mockResolvedValue('refresh-token'),
    rotate: vi.fn(),
    end: vi.fn(),
    endAll: vi.fn().mockResolvedValue(1),
  };
  const emailTokens = {
    issue: vi.fn().mockResolvedValue('email-token'),
    find: vi.fn().mockResolvedValue(null),
    consume: vi.fn().mockResolvedValue(true),
  };
  const turnstile = { verify: vi.fn().mockResolvedValue(true) };
  const mail = {
    send: vi.fn().mockResolvedValue(true),
    linkFor: vi.fn(
      (template: string, locale: string, token?: string) =>
        `link:${template}:${locale}:${token ?? ''}`,
    ),
  };
  const service = new AuthService(
    prisma,
    new TokenService(new JwtService({ secret: 'unit-test-secret-0123456789abcdef' })),
    sessions as unknown as SessionService,
    emailTokens as unknown as EmailTokenService,
    new PasswordPolicyService(),
    turnstile as unknown as TurnstileService,
    mail as unknown as MailService,
  );
  return { service, user, sessions, emailTokens, turnstile, mail };
}

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the call to fail');
}

describe('AuthService.register', () => {
  it('creates a CANDIDATE with a hashed password and the consent date, then emails a verification link', async () => {
    const { service, user, emailTokens, mail } = setup();
    expect(await service.register(registerInput, META)).toEqual(REGISTER_ACK);

    const data = (user.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ email: 'new@example.test', role: 'CANDIDATE', locale: 'fr' });
    expect(data['passwordHash']).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(data)).not.toContain(PASSWORD);
    expect(data['candidateProfile']).toMatchObject({
      create: {
        firstName: 'New',
        lastName: 'Candidate',
        phone: '+21612345678',
        countryOfResidence: 'TN',
      },
    });
    expect(
      (data['candidateProfile'] as { create: { gdprConsentAt: unknown } }).create.gdprConsentAt,
    ).toBeInstanceOf(Date);

    expect(emailTokens.issue).toHaveBeenCalledWith(USER_ID, 'VERIFY_EMAIL', 24 * 60 * 60 * 1000);
    expect(mail.send).toHaveBeenCalledWith('new@example.test', 'verify-email', 'fr', {
      actionUrl: 'link:verify-email:fr:email-token',
      expiresInHours: 24,
    });
  });

  it('gives the same answer for an address that already has an account, and creates nothing', async () => {
    const { service, user, emailTokens, mail } = setup(userRow({ email: 'new@example.test' }));
    expect(await service.register(registerInput, META)).toEqual(REGISTER_ACK);
    expect(user.create).not.toHaveBeenCalled();
    expect(emailTokens.issue).not.toHaveBeenCalled();
    expect(mail.send).toHaveBeenCalledWith(
      'new@example.test',
      'account-exists',
      'fr',
      expect.anything(),
    );
  });

  it('treats a lost race on the unique email like an existing account', async () => {
    const { service, user, mail } = setup();
    user.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    expect(await service.register(registerInput, META)).toEqual(REGISTER_ACK);
    expect(mail.send).toHaveBeenCalledWith(
      'new@example.test',
      'account-exists',
      'fr',
      expect.anything(),
    );
  });

  it('stops at a failed CAPTCHA before touching the database', async () => {
    const { service, user, turnstile } = setup();
    turnstile.verify.mockResolvedValue(false);
    const error = await errorOf(service.register(registerInput, META));
    expect(error.code).toBe('CAPTCHA_FAILED');
    expect(turnstile.verify).toHaveBeenCalledWith('turnstile-token', META.ip);
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(user.create).not.toHaveBeenCalled();
  });

  it('refuses a weak password', async () => {
    const { service, user } = setup();
    const error = await errorOf(
      service.register({ ...registerInput, password: 'password12345' }, META),
    );
    expect(error.code).toBe('WEAK_PASSWORD');
    expect(user.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.login', () => {
  const credentials = { email: 'known@example.test', password: PASSWORD };

  it('returns the user and both tokens, and resets the failure counter', async () => {
    const { service, user, sessions } = setup(userRow({ failedLoginCount: 3 }));
    const session = await service.login(credentials, META);
    expect(session.user).toMatchObject({ id: USER_ID, role: 'CANDIDATE', firstName: 'Known' });
    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.refreshToken).toBe('refresh-token');
    expect(sessions.start).toHaveBeenCalledWith(USER_ID, META);
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }) as object,
      }),
    );
  });

  const sameError = { code: 'INVALID_CREDENTIALS', status: 401 };
  const describeError = (error: AppException) => ({
    code: error.code,
    status: error.getStatus(),
    message: error.message,
  });

  it('answers exactly the same error for an unknown email, a wrong password, a disabled, a deleted, an invited and a locked account', async () => {
    const cases: [ReturnType<typeof userRow> | null, string][] = [
      [null, PASSWORD],
      [userRow(), 'wrong-password-123'],
      [userRow({ isActive: false }), PASSWORD],
      [userRow({ deletedAt: new Date() }), PASSWORD],
      [userRow({ passwordHash: null }), PASSWORD],
      [userRow({ lockedUntil: new Date(Date.now() + 60_000) }), PASSWORD],
    ];
    const errors = [];
    for (const [row, password] of cases) {
      const { service, sessions } = setup(row);
      errors.push(describeError(await errorOf(service.login({ ...credentials, password }, META))));
      expect(sessions.start).not.toHaveBeenCalled();
    }
    expect(errors[0]).toMatchObject(sameError);
    expect(new Set(errors.map((error) => JSON.stringify(error))).size).toBe(1);
  });

  it('counts a wrong password', async () => {
    const { service, user } = setup(userRow());
    await errorOf(service.login({ ...credentials, password: 'wrong-password-123' }, META));
    expect(user.update).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: { increment: 1 } } }),
    );
  });

  it('locks the account for 15 minutes at the 5th wrong password', async () => {
    const { service, user } = setup(userRow({ failedLoginCount: 4 }));
    user.update.mockResolvedValueOnce({ failedLoginCount: 5 });
    const before = Date.now();
    await errorOf(service.login({ ...credentials, password: 'wrong-password-123' }, META));
    const lock = (
      user.update.mock.calls[1] as [{ data: { lockedUntil: Date; failedLoginCount: number } }]
    )[0].data;
    expect(lock.failedLoginCount).toBe(0);
    expect(lock.lockedUntil.getTime() - before).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
    expect(lock.lockedUntil.getTime() - before).toBeLessThan(15 * 60 * 1000 + 5000);
  });

  it('does not count attempts while the account is locked', async () => {
    const { service, user } = setup(userRow({ lockedUntil: new Date(Date.now() + 60_000) }));
    await errorOf(service.login({ ...credentials, password: 'wrong-password-123' }, META));
    expect(user.update).not.toHaveBeenCalled();
  });

  it('lets the user in again once the lock has expired', async () => {
    const { service } = setup(userRow({ lockedUntil: new Date(Date.now() - 1000) }));
    expect((await service.login(credentials, META)).user.id).toBe(USER_ID);
  });

  it('allows a candidate whose email is not verified yet, and says so', async () => {
    const { service } = setup(userRow({ emailVerifiedAt: null }));
    expect((await service.login(credentials, META)).user.emailVerified).toBe(false);
  });
});

describe('AuthService email flows', () => {
  it('forgot-password answers the same with or without an account, and only emails a real one', async () => {
    const unknown = setup(null);
    expect(await unknown.service.forgotPassword({ email: 'nobody@example.test' })).toEqual(
      EMAIL_ACK,
    );
    expect(unknown.mail.send).not.toHaveBeenCalled();

    const known = setup(userRow());
    expect(await known.service.forgotPassword({ email: 'known@example.test' })).toEqual(EMAIL_ACK);
    expect(known.emailTokens.issue).toHaveBeenCalledWith(USER_ID, 'RESET_PASSWORD', 60 * 60 * 1000);
    expect(known.mail.send).toHaveBeenCalledWith('known@example.test', 'reset-password', 'en', {
      actionUrl: 'link:reset-password:en:email-token',
      expiresInHours: 1,
    });
  });

  it('does not send a reset link to a disabled account', async () => {
    const { service, mail } = setup(userRow({ isActive: false }));
    expect(await service.forgotPassword({ email: 'known@example.test' })).toEqual(EMAIL_ACK);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('resend-verification only emails an unverified account', async () => {
    const verified = setup(userRow());
    await verified.service.resendVerification({ email: 'known@example.test' });
    expect(verified.mail.send).not.toHaveBeenCalled();

    const unverified = setup(userRow({ emailVerifiedAt: null }));
    await unverified.service.resendVerification({ email: 'known@example.test' });
    expect(unverified.mail.send).toHaveBeenCalledWith(
      'known@example.test',
      'verify-email',
      'en',
      expect.anything(),
    );
  });

  it('verify-email refuses an unknown token and a token used in the meantime', async () => {
    const { service, emailTokens, user } = setup(userRow());
    expect((await errorOf(service.verifyEmail('x'.repeat(43)))).code).toBe('INVALID_TOKEN');

    emailTokens.find.mockResolvedValue({ id: 'token-id', userId: USER_ID, type: 'VERIFY_EMAIL' });
    emailTokens.consume.mockResolvedValue(false);
    expect((await errorOf(service.verifyEmail('x'.repeat(43)))).code).toBe('INVALID_TOKEN');
    expect(user.updateMany).not.toHaveBeenCalled();
  });

  it('verify-email only accepts verification tokens', async () => {
    const { service, emailTokens } = setup(userRow());
    await errorOf(service.verifyEmail('x'.repeat(43)));
    expect(emailTokens.find).toHaveBeenCalledWith('x'.repeat(43), ['VERIFY_EMAIL']);
  });
});

describe('AuthService.resetPassword', () => {
  const token = 'y'.repeat(43);

  it('refuses an invalid token', async () => {
    const { service } = setup(userRow());
    expect((await errorOf(service.resetPassword({ token, password: PASSWORD }))).code).toBe(
      'INVALID_TOKEN',
    );
  });

  it('accepts reset and invitation tokens', async () => {
    const { service, emailTokens } = setup(userRow());
    await errorOf(service.resetPassword({ token, password: PASSWORD }));
    expect(emailTokens.find).toHaveBeenCalledWith(token, ['RESET_PASSWORD', 'INVITATION']);
  });

  it('does not consume the token when the new password is weak', async () => {
    const { service, emailTokens, user } = setup(userRow());
    emailTokens.find.mockResolvedValue({ id: 'token-id', userId: USER_ID, type: 'RESET_PASSWORD' });
    expect((await errorOf(service.resetPassword({ token, password: 'password12345' }))).code).toBe(
      'WEAK_PASSWORD',
    );
    expect(emailTokens.consume).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
  });

  it('stores a new hash, unlocks, invalidates tokens and ends every session', async () => {
    const { service, emailTokens, user, sessions } = setup(userRow({ emailVerifiedAt: null }));
    emailTokens.find.mockResolvedValue({ id: 'token-id', userId: USER_ID, type: 'INVITATION' });
    await service.resetPassword({ token, password: 'another-strong-passphrase-77' });

    const data = (user.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(data['passwordHash']).toMatch(/^\$argon2id\$/);
    expect(data['passwordHash']).not.toBe(passwordHash);
    expect(data).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: { increment: 1 },
    });
    expect(data['emailVerifiedAt']).toBeInstanceOf(Date);
    expect(sessions.endAll).toHaveBeenCalledWith(USER_ID, expect.anything());
  });

  it('refuses a link whose token was consumed by a concurrent request', async () => {
    const { service, emailTokens, user } = setup(userRow());
    emailTokens.find.mockResolvedValue({ id: 'token-id', userId: USER_ID, type: 'RESET_PASSWORD' });
    emailTokens.consume.mockResolvedValue(false);
    expect((await errorOf(service.resetPassword({ token, password: PASSWORD }))).code).toBe(
      'INVALID_TOKEN',
    );
    expect(user.update).not.toHaveBeenCalled();
  });

  it('refuses a link that belongs to a disabled account', async () => {
    const { service, emailTokens } = setup(userRow({ isActive: false }));
    emailTokens.find.mockResolvedValue({ id: 'token-id', userId: USER_ID, type: 'RESET_PASSWORD' });
    expect((await errorOf(service.resetPassword({ token, password: PASSWORD }))).code).toBe(
      'INVALID_TOKEN',
    );
  });
});

describe('AuthService.refresh and logout', () => {
  it('answers 401 without a refresh token', async () => {
    const { service, sessions } = setup(userRow());
    expect((await errorOf(service.refresh(undefined, META))).getStatus()).toBe(401);
    expect(sessions.rotate).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'expired', 'reused'] as const)(
    'answers 401 when the token is %s',
    async (reason) => {
      const { service, sessions } = setup(userRow());
      sessions.rotate.mockResolvedValue({ ok: false, reason });
      expect((await errorOf(service.refresh('token', META))).code).toBe('UNAUTHENTICATED');
    },
  );

  it('returns a new pair after a rotation', async () => {
    const { service, sessions } = setup(userRow({ tokenVersion: 2 }));
    sessions.rotate.mockResolvedValue({ ok: true, userId: USER_ID, refreshToken: 'next-refresh' });
    const session = await service.refresh('token', META);
    expect(session.refreshToken).toBe('next-refresh');
    expect(session.accessToken.split('.')).toHaveLength(3);
  });

  it('ends every session when the account was disabled since the last refresh', async () => {
    const { service, sessions } = setup(userRow({ isActive: false }));
    sessions.rotate.mockResolvedValue({ ok: true, userId: USER_ID, refreshToken: 'next-refresh' });
    expect((await errorOf(service.refresh('token', META))).getStatus()).toBe(401);
    expect(sessions.endAll).toHaveBeenCalledWith(USER_ID);
  });

  it('logout ends the session, and does nothing without a token', async () => {
    const { service, sessions } = setup(userRow());
    await service.logout(undefined);
    expect(sessions.end).not.toHaveBeenCalled();
    await service.logout('token');
    expect(sessions.end).toHaveBeenCalledWith('token');
  });
});
