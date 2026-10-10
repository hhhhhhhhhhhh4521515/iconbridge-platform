import { randomBytes } from 'node:crypto';
import { decodeEncryptionKey, FieldCipher } from './field-cipher.js';

const key = randomBytes(32).toString('base64');
const CONTEXT = 'candidate_profiles.passport_number';

describe('FieldCipher', () => {
  const cipher = new FieldCipher(key);

  it('round-trips a value, including non-ASCII characters', () => {
    expect(cipher.decrypt(cipher.encrypt('AB1234567', CONTEXT), CONTEXT)).toBe('AB1234567');
    expect(cipher.decrypt(cipher.encrypt('جواز-٧٨٩', CONTEXT), CONTEXT)).toBe('جواز-٧٨٩');
  });

  it('never stores the plaintext and gives a different payload each time', () => {
    const first = cipher.encrypt('AB1234567', CONTEXT);
    const second = cipher.encrypt('AB1234567', CONTEXT);
    expect(first).not.toContain('AB1234567');
    expect(first).not.toBe(second);
    expect(first.startsWith('v1.')).toBe(true);
  });

  it('fails when the ciphertext or the tag was modified', () => {
    const [version, iv, tag, data] = cipher.encrypt('AB1234567', CONTEXT).split('.') as [
      string,
      string,
      string,
      string,
    ];
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url');
      bytes[0] = (bytes[0] ?? 0) ^ 0x01;
      return bytes.toString('base64url');
    };
    expect(() => cipher.decrypt([version, iv, tag, flip(data)].join('.'), CONTEXT)).toThrow();
    expect(() => cipher.decrypt([version, iv, flip(tag), data].join('.'), CONTEXT)).toThrow();
  });

  it('fails with another key', () => {
    const other = new FieldCipher(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(cipher.encrypt('AB1234567', CONTEXT), CONTEXT)).toThrow();
  });

  it('fails when the payload is moved to another column', () => {
    const payload = cipher.encrypt('AB1234567', CONTEXT);
    expect(() => cipher.decrypt(payload, 'another_table.another_column')).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => cipher.decrypt('AB1234567', CONTEXT)).toThrow(/Unsupported/);
    expect(() => cipher.decrypt('v2.a.b.c', CONTEXT)).toThrow(/Unsupported/);
    expect(() => cipher.decrypt('v1.a.b.c.d', CONTEXT)).toThrow(/Unsupported/);
  });
});

describe('decodeEncryptionKey', () => {
  it('accepts exactly 32 bytes', () => {
    expect(decodeEncryptionKey(key)).toHaveLength(32);
    expect(() => decodeEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => decodeEncryptionKey('')).toThrow(/32 bytes/);
  });
});
