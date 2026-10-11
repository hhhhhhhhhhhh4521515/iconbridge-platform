import { describe, expect, it } from 'vitest';
import adminEn from './admin/en.json';
import adminFr from './admin/fr.json';
import ar from './ar.json';
import en from './en.json';
import fr from './fr.json';

type Tree = { [key: string]: string | Tree };

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

function values(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : values(value),
  );
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]).sort();

describe('message files', () => {
  it('have exactly the same keys in French, English and Arabic', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it('have no empty text', () => {
    for (const messages of [fr, en, ar]) {
      expect(values(messages).filter((text) => text.trim() === '')).toEqual([]);
    }
  });

  it('use the same placeholders in every language', () => {
    const flat = (tree: Tree) =>
      Object.fromEntries(
        keys(tree).map((key) => [
          key,
          key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], tree) as string,
        ]),
      );
    const [f, e, a] = [flat(fr), flat(en), flat(ar)];
    for (const key of Object.keys(e)) {
      expect([key, placeholders(f[key] ?? '')]).toEqual([key, placeholders(e[key] ?? '')]);
      expect([key, placeholders(a[key] ?? '')]).toEqual([key, placeholders(e[key] ?? '')]);
    }
  });

  it('tell candidates they never pay, in the three languages', () => {
    expect(en.common.neverPay).toMatch(/never asks candidates for money/);
    expect(fr.common.neverPay).toMatch(/jamais d'argent/);
    expect(ar.common.neverPay).toContain('لا تطلب');
  });

  it('has the same keys and placeholders in the English and French texts of the back office', () => {
    expect(keys(adminFr).sort()).toEqual(keys(adminEn).sort());
    expect(
      values(adminEn)
        .concat(values(adminFr))
        .filter((text) => text.trim() === ''),
    ).toEqual([]);
    const read = (tree: Tree, key: string) =>
      key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], tree) as string;
    for (const key of keys(adminEn)) {
      expect([key, placeholders(read(adminFr, key))]).toEqual([
        key,
        placeholders(read(adminEn, key)),
      ]);
    }
  });
});
