import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthUser } from '../../auth/auth.types.js';

type ScopedUser = Pick<AuthUser, 'role' | 'assignedCountries'>;

/**
 * Nationalities a back-office user is limited to: the countries of a COUNTRY_AGENT, null
 * for every other role (no limit). A candidate belongs to a country by nationality only,
 * never by country of residence (ADR-024).
 */
export function scopedNationalities(user: ScopedUser): string[] | null {
  return user.role === 'COUNTRY_AGENT' ? user.assignedCountries : null;
}

/**
 * The condition every query on candidates, their documents and their applications adds
 * for the current user. A record outside it answers 404, like a missing one.
 */
export function candidateScope(user: ScopedUser): Prisma.CandidateProfileWhereInput {
  const countries = scopedNationalities(user);
  return countries ? { nationality: { in: countries } } : {};
}
