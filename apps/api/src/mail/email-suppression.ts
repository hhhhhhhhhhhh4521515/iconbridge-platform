import { createHash } from 'node:crypto';

/** Key of an address in `email_suppressions`: SHA-256 of the lower-case address, never the address. */
export function addressHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Statuses of an Azure delivery report after which nothing more is sent to the address. */
export const SUPPRESSING_STATUSES = { Bounced: 'BOUNCED', Suppressed: 'SUPPRESSED' } as const;
