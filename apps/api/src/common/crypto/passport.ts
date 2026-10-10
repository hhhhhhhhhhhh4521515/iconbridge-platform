import { FieldCipher } from './field-cipher.js';

/** Authenticated context of the passport column; changing it makes stored values unreadable. */
export const PASSPORT_NUMBER_CONTEXT = 'candidate_profiles.passport_number';

const VISIBLE_CHARACTERS = 3;
const MASK_CHARACTER = '*';

/** Trims, removes spaces and upper-cases, so the same passport is always stored the same way. */
export function normalizePassportNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Version shown in lists and stored in snapshots: only the last 3 characters stay
 * readable ("******567"). Numbers of 6 characters or fewer are fully masked, so at
 * least half of the number is always hidden.
 */
export function maskPassportNumber(value: string): string {
  const normalized = normalizePassportNumber(value);
  if (normalized.length <= VISIBLE_CHARACTERS * 2) {
    return MASK_CHARACTER.repeat(normalized.length);
  }
  return (
    MASK_CHARACTER.repeat(normalized.length - VISIBLE_CHARACTERS) +
    normalized.slice(-VISIBLE_CHARACTERS)
  );
}

/** The two columns of `candidate_profiles` that hold a passport number. */
export interface PassportNumberColumns {
  passportNumberEncrypted: string;
  passportNumberMasked: string;
}

export function protectPassportNumber(cipher: FieldCipher, value: string): PassportNumberColumns {
  const normalized = normalizePassportNumber(value);
  return {
    passportNumberEncrypted: cipher.encrypt(normalized, PASSPORT_NUMBER_CONTEXT),
    passportNumberMasked: maskPassportNumber(normalized),
  };
}

export function revealPassportNumber(cipher: FieldCipher, encrypted: string): string {
  return cipher.decrypt(encrypted, PASSPORT_NUMBER_CONTEXT);
}
