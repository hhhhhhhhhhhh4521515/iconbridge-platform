import { SetMetadata } from '@nestjs/common';

export interface AuditOptions {
  /** Dotted name of what was done, e.g. "admin_user.disable". */
  action: string;
  /** Kind of record changed; must have a loader in AuditSnapshotService to get before/after. */
  entityType: string;
  /** Route parameter holding the id. Omit for a creation: the id is read from the response. */
  idParam?: string;
}

export const AUDIT_KEY = 'audit:options';
/** Names the action and the record of an admin write, so the audit entry has before and after. */
export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);
