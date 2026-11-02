import { MAIN_NATIONALITIES, OTHER_NATIONALITY, type NationalityFilter } from '@iconbridge/shared';
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

/**
 * The nationality filter of the back-office lists and of the export: one country, or OTHER
 * (neither Morocco nor Tunisia, or not given). Always combined with `candidateScope`, so a
 * country agent who asks for another country gets nothing.
 */
export function nationalityWhere(filter: NationalityFilter): Prisma.CandidateProfileWhereInput {
  return filter === OTHER_NATIONALITY
    ? { OR: [{ nationality: null }, { nationality: { notIn: [...MAIN_NATIONALITIES] } }] }
    : { nationality: filter };
}
