/** One rendered email, as the outbox hands it to the transport. */
export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * What the outbox needs from a mail service: Nodemailer (SMTP, Mailpit locally) or
 * Azure Communication Services (`AzureEmailTransport`). Throws when the email was not
 * accepted; `MailThrottledError` when the service asks to wait.
 */
export interface MailTransport {
  sendMail(email: OutgoingEmail): Promise<unknown>;
  close?(): void;
}

/**
 * The mail service refused the email because too many were sent (HTTP 429). Not a
 * failure of the email: the outbox tries it again after `retryAfterMs`, without counting
 * an attempt, and sends nothing else until then.
 */
export class MailThrottledError extends Error {
  override readonly name = 'MailThrottled';

  constructor(readonly retryAfterMs: number) {
    super(`The mail service asks to wait ${Math.ceil(retryAfterMs / 1000)} s`);
  }
}
