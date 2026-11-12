import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

/** Who acts, as written in the history: the id, and the name shown to the space's members. */
export interface PartnerActor {
  id: string;
  /** The display name, or the address of a staff account without one. */
  name: string;
}

export type PartnerHistoryEntityType =
  'space' | 'member' | 'login' | 'job' | 'application' | 'file' | 'comment';

export interface PartnerChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface PartnerHistoryEntry {
  spaceId: string;
  actor: PartnerActor;
  entityType: PartnerHistoryEntityType;
  entityId: string;
  /** The application the entry is about, so the entry goes with it (ADR-027, rule 11). */
  applicationId?: string | null;
  action: string;
  /** One row per changed field; none for an action without values (created, removed). */
  changes?: PartnerChange[];
}

/** The name shown in a space's history and comments: the display name, else the address. */
export function actorOf(user: {
  id: string;
  email: string;
  displayName?: string | null;
}): PartnerActor {
  return { id: user.id, name: user.displayName ?? user.email };
}

/** Values are cut to the column's 500 characters. */
const MAX_VALUE = 500;

export function historyValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (Array.isArray(value)) {
    text = value.map((item) => historyValue(item) ?? '').join(', ');
  } else if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    text = String(value);
  } else {
    text = JSON.stringify(value);
  }
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

/** The fields whose value differs, in the order given. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): PartnerChange[] {
  return (Object.keys(after) as (keyof T & string)[])
    .filter((field) => historyValue(before[field]) !== historyValue(after[field]))
    .map((field) => ({ field, oldValue: before[field], newValue: after[field] }));
}

/**
 * The history of a space (ADR-027): who, what, when, old and new value. Append-only; it is
 * written in the transaction of the change, so a change without its entry cannot happen.
 */
@Injectable()
export class PartnerHistoryService {
  async record(tx: Prisma.TransactionClient, entry: PartnerHistoryEntry): Promise<void> {
    const base = {
      partnerSpaceId: entry.spaceId,
      actorId: entry.actor.id,
      actorName: entry.actor.name,
      entityType: entry.entityType,
      entityId: entry.entityId,
      partnerApplicationId: entry.applicationId ?? null,
      action: entry.action,
    };
    const changes = entry.changes ?? [];
    if (changes.length === 0) {
      await tx.partnerHistory.create({ data: base });
      return;
    }
    await tx.partnerHistory.createMany({
      data: changes.map((change) => ({
        ...base,
        field: change.field,
        oldValue: historyValue(change.oldValue),
        newValue: historyValue(change.newValue),
      })),
    });
  }
}
