import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import sharp from 'sharp';
import { IS_PUBLIC_KEY, OPTIONAL_AUTH_KEY, ROLES_KEY } from '../../src/auth/decorators/index.js';
import {
  API,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  resetDatabase,
  seedCatalog,
  type TestApp,
} from './app.js';

interface Route {
  method: string;
  path: string;
  open: boolean;
  roles: readonly string[] | undefined;
}

/**
 * Routes anybody may call without a session. Adding a route here is a decision:
 * a new controller method that is not listed must require a session.
 */
const OPEN_ROUTES = [
  'GET /health/live',
  'GET /health/ready',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/resend-verification',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'GET /api/v1/auth/session',
  'GET /api/v1/jobs',
  'GET /api/v1/jobs/:slug',
  'GET /api/v1/destinations',
  'GET /api/v1/categories',
  'GET /api/v1/stats',
  'GET /api/v1/success-stories',
  'GET /api/v1/home-slides',
  'GET /api/v1/site-info',
  'POST /api/v1/job-alerts',
  'POST /api/v1/job-alerts/confirm',
  'POST /api/v1/job-alerts/unsubscribe',
  'POST /api/v1/contact',
].sort();

describe('security (e2e)', () => {
  let test: TestApp;
  let routes: Route[];

  beforeAll(async () => {
    test = await createTestApp();
    const reflector = test.app.get(Reflector);
    const scanner = new MetadataScanner();
    routes = test.app
      .get(DiscoveryService)
      .getControllers()
      // Controllers that exist only in the tests.
      .filter((wrapper) => !wrapper.metatype?.name.startsWith('Fixture'))
      .flatMap((wrapper) => {
        const controller = wrapper.metatype as new () => unknown;
        const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
        const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, () => unknown>;
        return scanner.getAllMethodNames(prototype).flatMap((name): Route[] => {
          const handler = prototype[name];
          const method = handler
            ? (Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined)
            : undefined;
          if (!handler || method === undefined) {
            return [];
          }
          const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
          const joined = [prefix, sub].filter((part) => part && part !== '/').join('/');
          const health = joined.startsWith('health');
          const targets = [handler, controller];
          return [
            {
              method: RequestMethod[method] ?? 'GET',
              path: `${health ? '' : API}/${joined}`.replace(/\/+/g, '/'),
              open:
                Boolean(reflector.getAllAndOverride(IS_PUBLIC_KEY, targets)) ||
                Boolean(reflector.getAllAndOverride(OPTIONAL_AUTH_KEY, targets)),
              roles: reflector.getAllAndOverride<readonly string[] | undefined>(ROLES_KEY, targets),
            },
          ];
        });
      });
  });
  afterAll(async () => {
    await test.close();
  });

  describe('access control on every route', () => {
    it('finds the routes of the application', () => {
      expect(routes.length).toBeGreaterThan(100);
    });

    it('opens to visitors exactly the routes that were decided to be public', () => {
      const open = routes
        .filter((route) => route.open)
        .map((route) => `${route.method} ${route.path}`)
        .sort();
      expect(open).toEqual(OPEN_ROUTES);
    });

    it('gives every back-office route an explicit list of roles, never including candidates', () => {
      const admin = routes.filter((route) => route.path.startsWith(`${API}/admin/`));
      expect(admin.length).toBeGreaterThan(60);
      for (const route of admin) {
        expect(route.open, `${route.method} ${route.path} is public`).toBe(false);
        expect(
          route.roles?.length ?? 0,
          `${route.method} ${route.path} has no @Roles`,
        ).toBeGreaterThan(0);
        expect(route.roles, `${route.method} ${route.path}`).not.toContain('CANDIDATE');
      }
    });

    it('answers 401 without a session on every route that is not public', async () => {
      const closed = routes.filter((route) => !route.open);
      const failures: string[] = [];
      for (const route of closed) {
        const path = route.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        const response = await test.http()[method](path).send({});
        if (response.status !== 401) {
          failures.push(`${route.method} ${route.path} -> ${String(response.status)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('answers 403 to a candidate on every back-office route', async () => {
      await resetDatabase(test.prisma);
      const candidate = await createUser(test, 'CANDIDATE');
      const failures: string[] = [];
      for (const route of routes.filter((entry) => entry.path.startsWith(`${API}/admin/`))) {
        const path = route.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
        const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        const response = await test
          .http()
          [method](path)
          .set('Cookie', cookieHeader(candidate.cookies))
          .send({});
        if (response.status !== 403) {
          failures.push(`${route.method} ${route.path} -> ${String(response.status)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  });

  describe('cross-site requests', () => {
    const login = (origin?: string) => {
      const request = test.http().post(`${API}/auth/login`);
      return (origin ? request.set('Origin', origin) : request).send({
        email: 'nobody@example.test',
        password: 'wrong-password-here',
      });
    };

    it('refuses a state-changing request sent by a page of another site', async () => {
      const response = await login('https://evil.example').expect(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('lets the web app and tools without an origin through to the normal checks', async () => {
      await login(process.env.WEB_ORIGIN).expect(401);
      await login().expect(401);
    });

    it('does not let another site read the API with the visitor session (CORS)', async () => {
      const response = await test
        .http()
        .get(`${API}/auth/session`)
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example');
      expect(response.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('sets the session cookies HttpOnly, Secure and SameSite=Lax', async () => {
      await resetDatabase(test.prisma);
      const user = await createUser(test, 'CANDIDATE', 'cookie@example.test');
      const response = await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'river-lantern-quartz-42' })
        .expect(200);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      for (const name of ['ib_access', 'ib_refresh']) {
        const cookie = cookies.find((value) => value.startsWith(`${name}=`)) ?? '';
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/Secure/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
      }
    });
  });

  describe('response headers and errors', () => {
    it('sends the security headers', async () => {
      const response = await test.http().get(`${API}/jobs`).expect(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('answers an unknown route and a malformed body without a stack trace or a query', async () => {
      const missing = await test.http().get(`${API}/does-not-exist`).expect(404);
      const broken = await test
        .http()
        .post(`${API}/auth/login`)
        .set('Content-Type', 'application/json')
        .send('{"email": ')
        .expect(400);
      for (const response of [missing, broken]) {
        const text = JSON.stringify(response.body);
        expect(Object.keys(response.body as object).sort()).toEqual(
          expect.arrayContaining(['code', 'message']),
        );
        expect(text).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules|prisma|SELECT|\.ts\b/i);
      }
    });
  });

  describe('uploaded images', () => {
    it('stores a photo without its EXIF and GPS metadata', async () => {
      await resetDatabase(test.prisma);
      test.privateFiles.clear();
      await seedCatalog(test);
      const candidate = await createReadyCandidate(test);
      test.privateFiles.clear();
      const photo = await sharp({
        create: { width: 320, height: 240, channels: 3, background: '#886644' },
      })
        .withExif({
          IFD0: { Make: 'PhoneMaker', Model: 'Phone 12', Artist: 'Amira Khelifi' },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '36/1 48/1 23/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '10/1 10/1 54/1',
          },
        })
        .jpeg()
        .toBuffer();
      expect((await sharp(photo).metadata()).exif).toBeDefined();
      expect(photo.includes('PhoneMaker')).toBe(true);

      const response = await test
        .http()
        .post(`${API}/me/documents`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .field('type', 'PHOTO')
        .attach('file', photo, 'me.jpg')
        .expect(201);
      const [stored] = [...test.privateFiles.values()];
      if (!stored) {
        throw new Error('Nothing was stored');
      }
      const metadata = await sharp(stored.content).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.format).toBe('jpeg');
      expect([metadata.width, metadata.height]).toEqual([320, 240]);
      for (const secret of ['PhoneMaker', 'Phone 12', 'Amira Khelifi']) {
        expect(stored.content.includes(secret)).toBe(false);
      }
      expect((response.body as { sizeBytes: number }).sizeBytes).toBe(stored.content.length);
    });

    it('refuses a file that claims to be an image and cannot be decoded', async () => {
      const candidate = await createReadyCandidate(test, 'broken@example.test');
      const broken = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
        Buffer.alloc(200, 7),
      ]);
      const response = await test
        .http()
        .post(`${API}/me/documents`)
        .set('Cookie', cookieHeader(candidate.cookies))
        .field('type', 'PHOTO')
        .attach('file', broken, 'broken.jpg')
        .expect(415);
      expect((response.body as { code: string }).code).toBe('UNSUPPORTED_FILE');
    });
  });
});
