import { API_ERROR_CODES } from '@iconbridge/shared/schemas';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';
import pl from './pl.json';

type Tree = { [key: string]: string | Tree };

const keys = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
const flat = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    keys(tree).map((key) => [
      key,
      key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], tree) as string,
    ]),
  );
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]).sort();

/** Every error code a screen of the partner area can receive from the API (ADR-027). */
const PARTNER_API_CODES = [
  'INVALID_CREDENTIALS',
  'CAPTCHA_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'UNSUPPORTED_FILE',
  'FILE_TOO_LARGE',
  'CONFIRMATION_MISMATCH',
  'STORAGE_UNAVAILABLE',
  'INVALID_TOKEN',
  'WEAK_PASSWORD',
  'PASSWORD_CHANGE_REQUIRED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;

describe('messages of the partner area (ADR-027)', () => {
  const languages = { en, fr, pl } as Record<string, Tree>;

  it('have exactly the same keys in English, French and Polish', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
    expect(keys(pl).sort()).toEqual(keys(en).sort());
  });

  it('have no empty text, and the same placeholders in every language', () => {
    const english = flat(en);
    for (const [code, tree] of Object.entries(languages)) {
      const texts = flat(tree);
      expect(
        Object.values(texts).filter((text) => text.trim() === ''),
        code,
      ).toEqual([]);
      for (const key of Object.keys(english)) {
        expect([code, key, placeholders(texts[key] ?? '')]).toEqual([
          code,
          key,
          placeholders(english[key] ?? ''),
        ]);
      }
    }
  });

  it('translate every error code a partner screen can receive', () => {
    for (const code of PARTNER_API_CODES) {
      expect(API_ERROR_CODES).toContain(code);
      for (const tree of Object.values(languages)) {
        expect(flat(tree)[`partner.api.${code}`], code).toBeTruthy();
      }
    }
  });

  it('are not the Polish of the site: Polish exists only here', async () => {
    const { LOCALES } = await import('@/i18n/routing');
    expect(LOCALES).not.toContain('pl');
  });
});
