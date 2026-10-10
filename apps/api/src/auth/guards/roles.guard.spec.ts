import { PERMISSIONS, USER_ROLES, type UserRole } from '@iconbridge/shared';
import { contextFor, user } from '../../../test/unit/context.js';
import { AppException } from '../../common/errors/app.exception.js';
import { IS_PUBLIC_KEY, ROLES_KEY, SELF_SERVICE_KEY } from '../decorators/index.js';
import { isAdminPath, RolesGuard } from './roles.guard.js';

function check(
  request: Parameters<typeof contextFor>[0],
  metadata: Record<string, unknown> = {},
): 'allowed' | number {
  const { context, reflector } = contextFor(request, metadata);
  try {
    new RolesGuard(reflector).canActivate(context);
    return 'allowed';
  } catch (error) {
    if (error instanceof AppException) {
      return error.getStatus();
    }
    throw error;
  }
}

describe('RolesGuard', () => {
  it('lets anyone through a public route', () => {
    expect(check({ path: '/api/v1/auth/login', method: 'POST' }, { [IS_PUBLIC_KEY]: true })).toBe(
      'allowed',
    );
  });

  it('answers 401 when no user is attached to a protected route', () => {
    expect(check({})).toBe(401);
  });

  it('lets any signed-in user reach a route without @Roles outside /admin', () => {
    for (const role of USER_ROLES) {
      expect(check({ user: user(role) })).toBe('allowed');
    }
  });

  it.each(USER_ROLES)('applies the @Roles list to %s', (role) => {
    const allowed = PERMISSIONS.MANAGE_JOBS as readonly UserRole[];
    const result = check(
      { user: user(role), path: '/api/v1/admin/jobs' },
      { [ROLES_KEY]: PERMISSIONS.MANAGE_JOBS },
    );
    expect(result).toBe(allowed.includes(role) ? 'allowed' : 403);
  });

  it('refuses a candidate under /admin even if a route lists the role by mistake', () => {
    expect(
      check(
        { user: user('CANDIDATE'), path: '/api/v1/admin/users' },
        { [ROLES_KEY]: ['CANDIDATE'] },
      ),
    ).toBe(403);
  });

  it('refuses everybody on an /admin route that has no @Roles', () => {
    for (const role of USER_ROLES) {
      expect(check({ user: user(role), path: '/api/v1/admin/forgotten' })).toBe(403);
    }
  });

  describe('viewer is read only', () => {
    const viewerRoles = { [ROLES_KEY]: PERMISSIONS.VIEW_CANDIDATES };

    it('may read', () => {
      expect(check({ user: user('VIEWER'), path: '/api/v1/admin/candidates' }, viewerRoles)).toBe(
        'allowed',
      );
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'may not %s, even where the role is listed',
      (method) => {
        expect(
          check({ user: user('VIEWER'), path: '/api/v1/admin/candidates', method }, viewerRoles),
        ).toBe(403);
      },
    );

    it('may write on a self-service route', () => {
      expect(
        check(
          { user: user('VIEWER'), path: '/api/v1/account/password', method: 'POST' },
          { [SELF_SERVICE_KEY]: true },
        ),
      ).toBe('allowed');
    });

    it('does not restrict writes of the other roles', () => {
      expect(
        check(
          { user: user('RECRUITER'), path: '/api/v1/admin/candidates', method: 'POST' },
          viewerRoles,
        ),
      ).toBe('allowed');
    });
  });
});

describe('isAdminPath', () => {
  it('matches /admin and what is below it, not look-alikes', () => {
    expect(isAdminPath('/api/v1/admin')).toBe(true);
    expect(isAdminPath('/api/v1/admin/users/1')).toBe(true);
    expect(isAdminPath('/api/v1/administrators')).toBe(false);
    expect(isAdminPath('/api/v1/jobs/admin')).toBe(false);
  });
});
