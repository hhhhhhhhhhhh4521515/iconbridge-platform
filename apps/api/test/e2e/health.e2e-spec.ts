import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { livenessSchema, readinessSchema } from '@iconbridge/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { setupApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

// The commit an image would carry (APP_VERSION from VCS_REF), set before AppModule loads.
const VERSION = vi.hoisted(() => {
  process.env['APP_VERSION'] = '0123456789abcdef0123456789abcdef01234567';
  return process.env['APP_VERSION'];
});

describe('health endpoints (e2e)', () => {
  let app: NestExpressApplication;
  const queryRaw = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env['APP_VERSION'];
  });

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it('GET /health/live returns 200 without touching the database', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(livenessSchema.parse(response.body)).toEqual({ status: 'ok', version: VERSION });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('GET /health/ready returns 200 when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    // The deployment waits for this version to know the new revision answers.
    expect(readinessSchema.parse(response.body)).toEqual({
      status: 'ok',
      version: VERSION,
      checks: { database: 'ok' },
    });
  });

  it('GET /health/ready returns 503 when the database is unreachable', async () => {
    queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(readinessSchema.parse(response.body)).toEqual({
      status: 'error',
      version: VERSION,
      checks: { database: 'error' },
    });
  });

  it('keeps health outside the /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(404);
  });

  it('serves the OpenAPI document next to /api/docs', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(Object.keys(paths)).toEqual(expect.arrayContaining(['/health/live', '/health/ready']));
  });
});
