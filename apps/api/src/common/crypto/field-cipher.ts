import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Decodes a base64 key and checks that it is exactly 256 bits. */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes, base64 encoded`);
  }
  return key;
}

/**
 * Application-level encryption for a sensitive column (AES-256-GCM).
 *
 * Stored format: `v1.<iv>.<auth tag>.<ciphertext>`, each part base64url. A fresh
 * random IV is used for every value, so equal plaintexts give different payloads.
 * `context` names the column (for example "candidate_profiles.passport_number") and
 * is authenticated: a payload copied to another column fails to decrypt.
 */
export class FieldCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = decodeEncryptionKey(base64Key);
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** Throws when the payload is malformed, was tampered with, or the key or context differ. */
  decrypt(payload: string, context: string): string {
    const [version, iv, tag, ciphertext, ...rest] = payload.split('.');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
      throw new Error('Unsupported encrypted payload');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
