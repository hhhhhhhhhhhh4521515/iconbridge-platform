import argon2 from 'argon2';

/** argon2id with the library defaults (64 MiB, 3 passes, 4 lanes); parameters are stored in the hash. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** False for a wrong password and for a value that is not an argon2 hash. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
