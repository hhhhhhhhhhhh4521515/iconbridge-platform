import { describe, expect, it } from 'vitest';
import { countryName, countryOptions, flag } from './countries';
import { languageName, longDate, money, pick } from './format';
import { alternates, localizedUrl, pageMetadata } from './seo';

describe('texts and amounts', () => {
  const text = { en: 'Hotel', fr: 'Hôtel', ar: 'فندق' };

  it('picks the text of the page language, then English, then French', () => {
    expect(pick(text, 'ar')).toBe('فندق');
    expect(pick(text, 'de')).toBe('Hotel');
    expect(pick({ en: '', fr: 'Hôtel', ar: '' }, 'ar')).toBe('Hôtel');
    expect(pick(null, 'fr')).toBe('');
    expect(pick(undefined, 'fr')).toBe('');
  });

  it('writes an amount in its currency, without decimals for whole amounts', () => {
    expect(money(1200, 'EUR', 'en')).toBe('€1,200');
    expect(money(12.5, 'EUR', 'en')).toBe('€12.50');
    expect(money(1200, null, 'en')).toBe('1,200');
    // An unknown currency code does not break the page.
    expect(money(1200, 'not-a-code', 'en')).toBe('1,200 not-a-code');
  });

  it('names languages and writes dates in the page language', () => {
    expect(languageName('en', 'fr')).toBe('anglais');
    expect(languageName('??', 'fr')).toBe('??');
    expect(longDate('2026-03-05T10:00:00.000Z', 'en')).toBe('March 5, 2026');
    expect(longDate('2026-03-05T23:30:00.000Z', 'fr')).toBe('5 mars 2026');
  });
});

describe('countries', () => {
  it('builds the flag of a country from its code', () => {
    expect(flag('TN')).toBe('🇹🇳');
    expect(flag('mt')).toBe('🇲🇹');
  });

  it('lists every country once, named and sorted in the page language', () => {
    const french = countryOptions('fr');
    expect(french.length).toBeGreaterThan(240);
    expect(new Set(french.map((country) => country.code)).size).toBe(french.length);
    expect(french.find((country) => country.code === 'DE')?.name).toBe('Allemagne');
    const names = french.map((country) => country.name);
    expect(names).toEqual([...names].sort(new Intl.Collator('fr').compare));
    expect(countryName('PL', 'en')).toBe('Poland');
    expect(countryName('not a code', 'en')).toBe('not a code');
  });
});

describe('search engine metadata', () => {
  it('gives each page its address in every language, French by default', () => {
    expect(localizedUrl('ar', '/jobs')).toMatch(/\/ar\/jobs$/);
    const links = alternates('en', '/jobs/welder');
    expect(links.canonical).toMatch(/\/en\/jobs\/welder$/);
    expect(Object.keys(links.languages ?? {}).sort()).toEqual(['ar', 'en', 'fr', 'x-default']);
    expect((links.languages as Record<string, string>)['x-default']).toMatch(/\/fr\/jobs\/welder$/);
  });

  it('describes a page for search engines and social networks', () => {
    const metadata = pageMetadata({
      locale: 'fr',
      path: '/about',
      title: 'À propos',
      description: 'Qui nous sommes',
      siteName: 'IconBridge Jobs',
    });
    expect(metadata).toMatchObject({
      title: 'À propos',
      description: 'Qui nous sommes',
      openGraph: { siteName: 'IconBridge Jobs', locale: 'fr', type: 'website' },
      twitter: { card: 'summary_large_image' },
    });
    expect(
      pageMetadata({ locale: 'en', title: 't', description: 'd', siteName: 's' }).alternates
        ?.canonical,
    ).toMatch(/\/en$/);
  });
});
