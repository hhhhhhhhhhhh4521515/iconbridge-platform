import type { EmailClient, EmailMessage } from '@azure/communication-email';
import { lazy } from '../common/lazy.js';
import { MailThrottledError, type MailTransport, type OutgoingEmail } from './mail-transport.js';

type SendOptions = NonNullable<Parameters<EmailClient['beginSend']>[1]>;

/** Wait asked when a 429 carries no Retry-After header. */
const DEFAULT_RETRY_AFTER_MS = 60_000;
/** The managed domain's quota is counted per hour: a longer wait is never needed. */
const MAX_RETRY_AFTER_MS = 3_600_000;

/**
 * Sends through Azure Communication Services Email with the managed identity
 * (DefaultAzureCredential reads AZURE_CLIENT_ID). The sender (`from`) is a plain address of
 * the domain linked to the Communication Service; its display name is set on that
 * domain's sender username in Azure, not here.
 *
 * The email is handed over and not followed to delivery: once Azure answers 202 Accepted
 * the email has left, like an SMTP relay accepting it. The status check the SDK makes
 * right after has its own small quota; its failure must not make the outbox send the
 * email a second time.
 */
export class AzureEmailTransport implements MailTransport {
  constructor(private readonly client: () => Promise<Pick<EmailClient, 'beginSend'>>) {}

  /** The SDK is loaded with the first email, not when the API starts. */
  static create(endpoint: string): AzureEmailTransport {
    return new AzureEmailTransport(
      lazy(async () => {
        const [{ EmailClient: Client }, { DefaultAzureCredential }] = await Promise.all([
          import('@azure/communication-email'),
          import('@azure/identity'),
        ]);
        return new Client(endpoint, new DefaultAzureCredential(), {
          // The outbox retries, and waits as long as Azure asks; the SDK must not wait
          // inside a send (its throttling policy would sleep for the Retry-After).
          retryOptions: { maxRetries: 0 },
        });
      }),
    );
  }

  async sendMail(email: OutgoingEmail): Promise<void> {
    const message: EmailMessage = {
      senderAddress: email.from,
      recipients: { to: [{ address: email.to }] },
      content: { subject: email.subject, html: email.html, plainText: email.text },
      ...(email.replyTo ? { replyTo: [{ address: email.replyTo }] } : {}),
      // No tracking pixel or rewritten links in emails about candidates.
      disableUserEngagementTracking: true,
    };
    // Set by the SDK's callback, so kept on an object the type checker does not narrow.
    const post = { accepted: false };
    const onResponse: SendOptions['onResponse'] = (response) => {
      if (response.request.method === 'POST' && response.status === 202) {
        post.accepted = true;
      }
    };
    const client = await this.client();
    try {
      await client.beginSend(message, { onResponse });
    } catch (error) {
      if (post.accepted) {
        return;
      }
      if (statusOf(error) === 429) {
        throw new MailThrottledError(retryAfterMs(error));
      }
      throw error;
    }
  }
}

interface HttpErrorShape {
  statusCode?: unknown;
  response?: { headers?: { get?: (name: string) => string | undefined } };
}

function statusOf(error: unknown): number | undefined {
  const status = (error as HttpErrorShape | null)?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

/** From `retry-after-ms`, `x-ms-retry-after-ms` or `retry-after` (seconds or an HTTP date). */
export function retryAfterMs(error: unknown, now = Date.now()): number {
  const headers = (error as HttpErrorShape | null)?.response?.headers;
  const header = (name: string) => headers?.get?.(name);
  const clamp = (ms: number) => Math.min(Math.max(ms, 1_000), MAX_RETRY_AFTER_MS);

  for (const name of ['retry-after-ms', 'x-ms-retry-after-ms']) {
    const ms = Number(header(name));
    if (Number.isFinite(ms) && ms > 0) {
      return clamp(ms);
    }
  }
  const value = header('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return clamp(seconds * 1000);
    }
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      return clamp(date - now);
    }
  }
  return DEFAULT_RETRY_AFTER_MS;
}
