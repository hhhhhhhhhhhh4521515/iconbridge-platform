import { randomBytes } from 'node:crypto';
import { FieldCipher } from './field-cipher.js';
import {
  maskPassportNumber,
  normalizePassportNumber,
  protectPassportNumber,
  revealPassportNumber,
} from './passport.js';

describe('maskPassportNumber', () => {
  it('keeps only the last 3 characters', () => {
    expect(maskPassportNumber('AB1234567')).toBe('******567');
    expect(maskPassportNumber('X1234567')).toBe('*****567');
  });

  it('normalises before masking', () => {
    expect(maskPassportNumber(' ab 123 4567 ')).toBe('******567');
  });

  it('fully masks short values', () => {
    expect(maskPassportNumber('A12345')).toBe('******');
    expect(maskPassportNumber('AB1')).toBe('***');
    expect(maskPassportNumber('')).toBe('');
  });
});

describe('normalizePassportNumber', () => {
  it('removes whitespace and upper-cases', () => {
    expect(normalizePassportNumber(' ab 12\t34 ')).toBe('AB1234');
  });
});

describe('protectPassportNumber', () => {
  const cipher = new FieldCipher(randomBytes(32).toString('base64'));

  it('returns an encrypted value that decrypts to the normalised number, and its mask', () => {
    const columns = protectPassportNumber(cipher, 'ab 1234567');
    expect(columns.passportNumberMasked).toBe('******567');
    expect(columns.passportNumberEncrypted).not.toContain('1234567');
    expect(revealPassportNumber(cipher, columns.passportNumberEncrypted)).toBe('AB1234567');
  });
});
