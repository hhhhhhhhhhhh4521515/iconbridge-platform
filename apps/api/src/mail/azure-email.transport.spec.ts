import type { EmailClient } from '@azure/communication-email';
import { AzureEmailTransport, retryAfterMs } from './azure-email.transport.js';
import { MailThrottledError } from './mail-transport.js';

type BeginSend = EmailClient['beginSend'];
type SendOptions = NonNullable<Parameters<BeginSend>[1]>;

const email = {
  from: 'DoNotReply@0000-1111.azurecomm.net',
  to: 'candidate@example.test',
  subject: 'Confirm your email',
  html: '<p>Hello</p>',
  text: 'Hello',
};

/** A response as the SDK passes it to `onResponse`. */
function response(method: string, status: number) {
  return { request: { method }, status } as Parameters<NonNullable<SendOptions['onResponse']>>[0];
}

function httpError(statusCode: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error('Service error'), {
    name: 'RestError',
    statusCode,
    response: { headers: { get: (name: string) => headers[name] } },
  });
}

function transportWith(beginSend: (options: SendOptions) => Promise<unknown>) {
  const spy = vi.fn((_message: Parameters<BeginSend>[0], options?: SendOptions) =>
    beginSend(options ?? {}),
  );
  const client = { beginSend: spy as unknown as BeginSend };
  return { transport: new AzureEmailTransport(() => Promise.resolve(client)), spy };
}

describe('AzureEmailTransport', () => {
  it('sends the rendered email from the bare sender address, without tracking', async () => {
    const { transport, spy } = transportWith((options) => {
      options.onResponse?.(response('POST', 202), undefined);
      return Promise.resolve({});
    });
    await transport.sendMail({ ...email, replyTo: 'visitor@example.test' });
    expect(spy).toHaveBeenCalledWith(
      {
        senderAddress: 'DoNotReply@0000-1111.azurecomm.net',
        recipients: { to: [{ address: 'candidate@example.test' }] },
        content: { subject: 'Confirm your email', html: '<p>Hello</p>', plainText: 'Hello' },
        replyTo: [{ address: 'visitor@example.test' }],
        disableUserEngagementTracking: true,
      },
      expect.any(Object),
    );
  });

  it('leaves out the reply-to address when there is none', async () => {
    const { transport, spy } = transportWith(() => Promise.resolve({}));
    await transport.sendMail(email);
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty('replyTo');
  });

  it('counts the email as sent once Azure accepted it, even if the status check then fails', async () => {
    // The status check has its own quota; sending again would deliver the email twice.
    const { transport } = transportWith((options) => {
      options.onResponse?.(response('POST', 202), undefined);
      options.onResponse?.(response('GET', 429), undefined);
      return Promise.reject(httpError(429, { 'retry-after': '60' }));
    });
    await expect(transport.sendMail(email)).resolves.toBeUndefined();
  });

  it('reports a refused send as throttled, with the wait Azure asks for', async () => {
    const { transport } = transportWith((options) => {
      options.onResponse?.(response('POST', 429), undefined);
      return Promise.reject(httpError(429, { 'retry-after': '120' }));
    });
    const error: unknown = await transport.sendMail(email).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailThrottledError);
    expect((error as MailThrottledError).retryAfterMs).toBe(120_000);
  });

  it('lets other failures reach the outbox, which counts an attempt', async () => {
    const { transport } = transportWith(() => Promise.reject(httpError(401)));
    await expect(transport.sendMail(email)).rejects.toMatchObject({
      name: 'RestError',
      statusCode: 401,
    });
  });

  it('lets a network failure before any answer reach the outbox', async () => {
    const { transport } = transportWith(() =>
      Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'RestError' })),
    );
    await expect(transport.sendMail(email)).rejects.toThrow('ENOTFOUND');
  });
});

describe('retryAfterMs', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');

  it('reads milliseconds first, then seconds, then an HTTP date', () => {
    expect(
      retryAfterMs(httpError(429, { 'retry-after-ms': '1500', 'retry-after': '9' }), now),
    ).toBe(1500);
    expect(retryAfterMs(httpError(429, { 'x-ms-retry-after-ms': '2500' }), now)).toBe(2500);
    expect(retryAfterMs(httpError(429, { 'retry-after': '30' }), now)).toBe(30_000);
    expect(
      retryAfterMs(httpError(429, { 'retry-after': 'Thu, 15 Oct 2026 12:05:00 GMT' }), now),
    ).toBe(300_000);
  });

  it('waits a minute when Azure gives no delay, and never more than an hour', () => {
    expect(retryAfterMs(httpError(429), now)).toBe(60_000);
    expect(retryAfterMs(new Error('no response'), now)).toBe(60_000);
    expect(retryAfterMs(httpError(429, { 'retry-after': '86400' }), now)).toBe(3_600_000);
    expect(retryAfterMs(httpError(429, { 'retry-after': '0' }), now)).toBe(1_000);
  });
});
