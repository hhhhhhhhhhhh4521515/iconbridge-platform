import { Writable } from 'node:stream';
import { pino } from 'pino';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pinoHttp } from 'pino-http';
import {
  isFrameworkNoise,
  loggerParams,
  REDACT_PATHS,
  REDACTED,
  requestIdFrom,
  requestLogLevel,
} from './logger.config.js';

function capture(): { lines: string[]; logger: pino.Logger } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: pino({ redact: { paths: REDACT_PATHS, censor: REDACTED } }, stream) };
}

describe('log redaction', () => {
  it('removes passwords, tokens, passport numbers and cookies at any of three levels', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        password: 'pw-root',
        body: { password: 'pw-nested', token: 'tok-nested', passportNumber: 'AB1234567' },
        ctx: { input: { refreshToken: 'rt-deep', cookie: 'c-deep' } },
        req: { headers: { cookie: 'ib_access=abc', authorization: 'Bearer xyz' } },
        res: { headers: { 'set-cookie': ['ib_refresh=def'] } },
        email: 'person@example.test',
        partner: { firstName: 'Zofia', lastName: 'Secret', phone: '+48123456789' },
        dhlTrackingNumber: 'JD0123456789',
        applicationId: 'kept-id',
      },
      'test',
    );
    const line = lines.join('');
    for (const secret of [
      'pw-root',
      'pw-nested',
      'tok-nested',
      'AB1234567',
      'rt-deep',
      'c-deep',
      'ib_access=abc',
      'Bearer xyz',
      'ib_refresh=def',
      'person@example.test',
      'Zofia',
      'Secret',
      '+48123456789',
      'JD0123456789',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain(REDACTED);
    expect(line).toContain('kept-id');
  });
});

describe('requestIdFrom', () => {
  it('keeps a well-formed incoming id', () => {
    expect(requestIdFrom('abc-123_DEF')).toBe('abc-123_DEF');
  });

  it('replaces a missing, too short or unsafe id with a UUID', () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(requestIdFrom(undefined)).toMatch(uuid);
    expect(requestIdFrom('short')).toMatch(uuid);
    expect(requestIdFrom('bad id\n{"injected":true}')).toMatch(uuid);
    expect(requestIdFrom(['first-id-1234', 'second'])).toBe('first-id-1234');
  });
});

describe('log volume (ADR-028)', () => {
  const res = (statusCode: number) => ({ statusCode }) as never;

  it('logs no line for successful requests and redirects, warn for 4xx, error for 5xx', () => {
    const req = {} as never;
    expect(requestLogLevel(req, res(200))).toBe('silent');
    expect(requestLogLevel(req, res(304))).toBe('silent');
    expect(requestLogLevel(req, res(399))).toBe('silent');
    expect(requestLogLevel(req, res(400))).toBe('warn');
    expect(requestLogLevel(req, res(404))).toBe('warn');
    expect(requestLogLevel(req, res(499))).toBe('warn');
    expect(requestLogLevel(req, res(500))).toBe('error');
    expect(requestLogLevel(req, res(200), new Error('failed'))).toBe('error');
  });

  it('drops the info lines of Nest start-up, never their warnings or other contexts', () => {
    expect(isFrameworkNoise([{ context: 'InstanceLoader' }, 'AppModule initialized'], 30)).toBe(
      true,
    );
    expect(isFrameworkNoise([{ context: 'RouterExplorer' }, 'Mapped {/jobs, GET}'], 30)).toBe(true);
    expect(isFrameworkNoise([{ context: 'InstanceLoader' }, 'failed'], 40)).toBe(false);
    expect(isFrameworkNoise([{ context: 'NestFactory' }, 'failed'], 50)).toBe(false);
    expect(isFrameworkNoise([{ context: 'JobAlertsService' }, 'Job alerts: 2 emails'], 30)).toBe(
      false,
    );
    expect(isFrameworkNoise(['plain message'], 30)).toBe(false);
  });

  it('writes one line per failed request and none for a successful one', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const { level: _level, ...options } = loggerParams('production').pinoHttp as Record<
      string,
      unknown
    >;
    const middleware = pinoHttp({ ...options, level: 'info' }, stream);
    const server: Server = createServer((req, response) => {
      middleware(req, response);
      response.statusCode = Number(req.url?.slice(1));
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const call = (status: number) =>
      new Promise<void>((resolve, reject) => {
        request({ port, path: `/${status}` }, (response) => {
          response.resume().on('end', resolve);
        })
          .on('error', reject)
          .end();
      });
    try {
      for (const status of [200, 302, 404, 500]) {
        await call(status);
      }
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
    const logged = lines.map(
      (line) => JSON.parse(line) as { level: number; res: { statusCode: number } },
    );
    expect(logged.map((line) => [line.res.statusCode, line.level])).toEqual([
      [404, 40],
      [500, 50],
    ]);
  });
});
