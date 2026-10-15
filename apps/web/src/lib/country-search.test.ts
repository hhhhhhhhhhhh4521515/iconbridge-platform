import { describe, expect, it } from 'vitest';
import {
  exactCountry,
  filterCountries,
  normalizeSearch,
  orderCountries,
  PREFERRED_COUNTRIES,
  type CountryChoice,
} from './country-search';

const named = (locale: string, codes: string[]): CountryChoice[] => {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return codes.map((code) => ({ code, name: names.of(code) ?? code }));
};
const CODES = ['TN', 'MA', 'DZ', 'EG', 'MT', 'PL', 'FR', 'DE', 'AE', 'ES', 'EE', 'GB', 'US', 'TR'];
const codes = (choices: CountryChoice[]) => choices.map((choice) => choice.code);

describe('normalizeSearch', () => {
  it('ignores case, accents and Arabic letter variants', () => {
    expect(normalizeSearch('  Égypte ')).toBe('egypte');
    expect(normalizeSearch('ÉMIRATS arabes')).toBe('emirats arabes');
    expect(normalizeSearch('أَلجزائر')).toBe(normalizeSearch('الجزائر'));
  });
});

describe('orderCountries', () => {
  it('puts Tunisia, Morocco, Algeria, Egypt, Malta and Poland first, then the rest by name', () => {
    const ordered = orderCountries(named('en', CODES), 'en');
    expect(codes(ordered).slice(0, 6)).toEqual([...PREFERRED_COUNTRIES]);
    const rest = ordered.slice(6).map((choice) => choice.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('sorts the rest in the page language', () => {
    const rest = orderCountries(named('fr', CODES), 'fr').slice(6);
    // "Allemagne" (DE) comes first in French, "Estonia"/"Spain" do not.
    expect(rest[0]?.code).toBe('DE');
  });
});

describe('filterCountries', () => {
  const english = orderCountries(named('en', CODES), 'en');
  const french = orderCountries(named('fr', CODES), 'fr');
  const arabic = orderCountries(named('ar', CODES), 'ar');

  it('finds a country by the start of its name', () => {
    expect(codes(filterCountries(english, 'tun'))).toEqual(['TN']);
    expect(codes(filterCountries(english, 'Pol'))[0]).toBe('PL');
  });

  it('finds it in the page language, accents ignored', () => {
    expect(codes(filterCountries(french, 'egy'))).toEqual(['EG']);
    expect(codes(filterCountries(french, 'Égy'))).toEqual(['EG']);
    expect(codes(filterCountries(french, 'emirats'))).toEqual(['AE']);
    expect(codes(filterCountries(french, 'algerie'))).toEqual(['DZ']);
  });

  it('finds it in Arabic', () => {
    const tunisia = new Intl.DisplayNames(['ar'], { type: 'region' }).of('TN') ?? '';
    expect(codes(filterCountries(arabic, tunisia.slice(0, 3)))).toContain('TN');
  });

  it('finds a country by its ISO code, before names containing the letters', () => {
    expect(codes(filterCountries(english, 'tn'))[0]).toBe('TN');
    expect(codes(filterCountries(english, 'DE'))[0]).toBe('DE');
    expect(codes(filterCountries(english, 'gb'))[0]).toBe('GB');
  });

  it('ranks names that start with the text before names that only contain it', () => {
    // "Malta" starts with "ma"; "Germany" and "Emirates" only contain it.
    const found = codes(filterCountries(english, 'ma'));
    expect(found.indexOf('MT')).toBeLessThan(found.indexOf('DE'));
    expect(found[0]).toBe('MA');
  });

  it('finds a word inside a name', () => {
    expect(codes(filterCountries(english, 'kingdom'))).toEqual(['GB']);
    expect(codes(filterCountries(english, 'states'))).toEqual(['US']);
  });

  it('finds a phone country by its calling code, with or without +', () => {
    const phone = english.map((choice) => ({
      ...choice,
      keywords: [{ TN: '216', MT: '356', PL: '48' }[choice.code] ?? ''],
    }));
    expect(codes(filterCountries(phone, '216'))).toEqual(['TN']);
    expect(codes(filterCountries(phone, '+356'))).toEqual(['MT']);
  });

  it('keeps the whole list, in order, for an empty text', () => {
    expect(codes(filterCountries(english, '  '))).toEqual(codes(english));
  });

  it('never matches the flag', () => {
    expect(filterCountries(english, '🇹🇳')).toEqual([]);
  });
});

describe('exactCountry', () => {
  const french = named('fr', CODES);

  it('recognises a full name or a code typed or filled in by the browser', () => {
    expect(exactCountry(french, 'tunisie')?.code).toBe('TN');
    expect(exactCountry(french, 'Égypte')?.code).toBe('EG');
    expect(exactCountry(french, 'mt')?.code).toBe('MT');
    expect(exactCountry(french, 'Tuni')).toBeUndefined();
    expect(exactCountry(french, '')).toBeUndefined();
  });
});
