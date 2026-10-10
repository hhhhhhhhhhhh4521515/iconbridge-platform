import { contextFor, user } from '../../../test/unit/context.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  OWNERSHIP_KEY,
  REQUIRE_VERIFIED_EMAIL_KEY,
  type OwnershipRule,
} from '../decorators/index.js';
import { OwnershipGuard } from './ownership.guard.js';
import { VerifiedEmailGuard } from './verified-email.guard.js';

const OWNER = user('CANDIDATE', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
const OTHER = user('CANDIDATE', { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
const RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function outcome(run: () => boolean | Promise<boolean>) {
  try {
    await run();
    return 'allowed' as const;
  } catch (error) {
    if (error instanceof AppException) {
      return { status: error.getStatus(), code: error.code };
    }
    throw error;
  }
}

describe('VerifiedEmailGuard', () => {
  const check = (emailVerified: boolean, required: boolean) => {
    const { context, reflector } = contextFor(
      { user: user('CANDIDATE', { emailVerified }) },
      { [REQUIRE_VERIFIED_EMAIL_KEY]: required },
    );
    return outcome(() => new VerifiedEmailGuard(reflector).canActivate(context));
  };

  it('ignores routes that do not require a verified email', async () => {
    expect(await check(false, false)).toBe('allowed');
  });

  it('lets a verified user through', async () => {
    expect(await check(true, true)).toBe('allowed');
  });

  it('refuses an unverified user with EMAIL_NOT_VERIFIED', async () => {
    expect(await check(false, true)).toEqual({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
  });
});

describe('OwnershipGuard', () => {
  function setup(ownerUserId: string | null) {
    const profile = vi.fn().mockResolvedValue(ownerUserId ? { userId: ownerUserId } : null);
    const nested = vi
      .fn()
      .mockResolvedValue(ownerUserId ? { candidate: { userId: ownerUserId } } : null);
    const prisma = {
      candidateProfile: { findUnique: profile },
      document: { findUnique: nested },
      application: { findUnique: nested },
    } as unknown as PrismaService;
    return { prisma, profile, nested };
  }

  const check = (
    current: ReturnType<typeof user>,
    ownerUserId: string | null,
    rule: OwnershipRule = { resource: 'candidateProfile', param: 'id' },
    id = RESOURCE_ID,
  ) => {
    const mocks = setup(ownerUserId);
    const { context, reflector } = contextFor(
      { user: current, params: { [rule.param]: id } },
      { [OWNERSHIP_KEY]: rule },
    );
    return {
      mocks,
      result: outcome(() => new OwnershipGuard(reflector, mocks.prisma).canActivate(context)),
    };
  };

  it.each(['candidateProfile', 'document', 'application'] as const)(
    'lets a candidate reach their own %s',
    async (resource) => {
      expect(await check(OWNER, OWNER.id, { resource, param: 'id' }).result).toBe('allowed');
    },
  );

  it.each(['candidateProfile', 'document', 'application'] as const)(
    "hides another candidate's %s behind a 404",
    async (resource) => {
      expect(await check(OTHER, OWNER.id, { resource, param: 'id' }).result).toEqual({
        status: 404,
        code: 'NOT_FOUND',
      });
    },
  );

  it('answers the same 404 for a resource that does not exist', async () => {
    expect(await check(OWNER, null).result).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('answers 404 for an id that is not a UUID, without querying', async () => {
    const { mocks, result } = check(
      OWNER,
      OWNER.id,
      { resource: 'candidateProfile', param: 'id' },
      "1' OR '1'='1",
    );
    expect(await result).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it('reads the id from the configured route parameter', async () => {
    expect(await check(OWNER, OWNER.id, { resource: 'document', param: 'documentId' }).result).toBe(
      'allowed',
    );
  });

  it.each(['VIEWER', 'RECRUITER', 'SUPER_ADMIN'] as const)('does not apply to %s', async (role) => {
    const { mocks, result } = check(user(role), OWNER.id);
    expect(await result).toBe('allowed');
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it('answers 401 without a user', async () => {
    const { prisma } = setup(OWNER.id);
    const { context, reflector } = contextFor(
      { params: { id: RESOURCE_ID } },
      { [OWNERSHIP_KEY]: { resource: 'candidateProfile', param: 'id' } },
    );
    expect(
      await outcome(() => new OwnershipGuard(reflector, prisma).canActivate(context)),
    ).toMatchObject({
      status: 401,
    });
  });
});
