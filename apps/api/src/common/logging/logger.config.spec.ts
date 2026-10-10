import { Writable } from 'node:stream';
import { pino } from 'pino';
import { REDACT_PATHS, REDACTED, requestIdFrom } from './logger.config.js';

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
        email: 'kept@example.test',
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
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain(REDACTED);
    expect(line).toContain('kept@example.test');
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
