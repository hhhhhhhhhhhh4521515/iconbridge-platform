import { JwtService } from '@nestjs/jwt';
import { contextFor } from '../../../test/unit/context.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ACCESS_COOKIE, JWT_ISSUER } from '../auth.constants.js';
import { IS_PUBLIC_KEY } from '../decorators/index.js';
import { TokenService } from '../token.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const SECRET = 'unit-test-secret-0123456789abcdef';
const jwt = new JwtService({
  secret: SECRET,
  signOptions: { issuer: JWT_ISSUER, expiresIn: 900 },
  verifyOptions: { issuer: JWT_ISSUER, algorithms: ['HS256'] },
});
const tokens = new TokenService(jwt);

const dbUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'user@example.test',
  role: 'RECRUITER' as const,
  locale: 'fr',
  isActive: true,
  deletedAt: null as Date | null,
  emailVerifiedAt: new Date() as Date | null,
  tokenVersion: 3,
};

function setup(row: typeof dbUser | null = dbUser) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return { findUnique, prisma };
}

async function run(
  request: Parameters<typeof contextFor>[0],
  row?: typeof dbUser | null,
  metadata = {},
) {
  const { prisma, findUnique } = setup(row);
  const { context, reflector, request: req } = contextFor(request, metadata);
  const guard = new JwtAuthGuard(reflector, tokens, prisma);
  try {
    await guard.canActivate(context);
    return { status: 'allowed' as const, user: req.user, findUnique };
  } catch (error) {
    if (error instanceof AppException) {
      return { status: error.getStatus(), code: error.code, findUnique };
    }
    throw error;
  }
}

describe('JwtAuthGuard', () => {
  it('skips public routes without reading any token', async () => {
    const result = await run({}, dbUser, { [IS_PUBLIC_KEY]: true });
    expect(result.status).toBe('allowed');
    expect(result.findUnique).not.toHaveBeenCalled();
  });

  it('answers 401 without a token', async () => {
    expect(await run({})).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('accepts the access cookie and attaches the user from the database', async () => {
    const token = await tokens.signAccessToken(dbUser.id, 3);
    const result = await run({ cookies: { [ACCESS_COOKIE]: token } });
    expect(result.status).toBe('allowed');
    expect(result.user).toEqual({
      id: dbUser.id,
      email: dbUser.email,
      role: 'RECRUITER',
      emailVerified: true,
      locale: 'fr',
    });
  });

  it('accepts a Bearer header', async () => {
    const token = await tokens.signAccessToken(dbUser.id, 3);
    expect((await run({ headers: { authorization: `Bearer ${token}` } })).status).toBe('allowed');
  });

  it('rejects a tampered token, a token signed with another key and an expired token', async () => {
    const token = await tokens.signAccessToken(dbUser.id, 3);
    expect((await run({ cookies: { [ACCESS_COOKIE]: `${token.slice(0, -2)}xx` } })).status).toBe(
      401,
    );

    const foreign = await new JwtService({ secret: 'another-secret-another-secret-123' }).signAsync(
      { sub: dbUser.id, tv: 3 },
      { issuer: JWT_ISSUER },
    );
    expect((await run({ cookies: { [ACCESS_COOKIE]: foreign } })).status).toBe(401);

    const expired = await jwt.signAsync({ sub: dbUser.id, tv: 3 }, { expiresIn: -10 });
    expect((await run({ cookies: { [ACCESS_COOKIE]: expired } })).status).toBe(401);
  });

  it('rejects an unsigned token (alg none)', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: dbUser.id, tv: 3, iss: JWT_ISSUER })}.`;
    expect((await run({ cookies: { [ACCESS_COOKIE]: unsigned } })).status).toBe(401);
  });

  it.each([
    ['the user no longer exists', null],
    ['the account is disabled', { ...dbUser, isActive: false }],
    ['the account is deleted', { ...dbUser, deletedAt: new Date() }],
    ['the token version changed (forced logout, password reset)', { ...dbUser, tokenVersion: 4 }],
  ])('rejects a valid token when %s', async (_case, row) => {
    const token = await tokens.signAccessToken(dbUser.id, 3);
    expect((await run({ cookies: { [ACCESS_COOKIE]: token } }, row)).status).toBe(401);
  });

  it('reports an unverified email on the attached user', async () => {
    const token = await tokens.signAccessToken(dbUser.id, 3);
    const result = await run(
      { cookies: { [ACCESS_COOKIE]: token } },
      { ...dbUser, emailVerifiedAt: null },
    );
    expect(result.user?.emailVerified).toBe(false);
  });
});
