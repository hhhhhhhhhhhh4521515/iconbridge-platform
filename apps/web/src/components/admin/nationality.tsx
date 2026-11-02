'use client';

import { MAIN_NATIONALITIES, OTHER_NATIONALITY } from '@iconbridge/shared/admin';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { countryName, countryOptions, flag } from '@/lib/countries';
import { useAdmin } from './admin-context';
import { filterControl } from './ui';

/**
 * The nationalities a user may filter on: his own countries for a country agent (the API
 * returns nothing else anyway, ADR-024), every country for the other back-office roles.
 * Returns the value kept from a URL: anything not allowed becomes "all".
 */
export function useNationalityValue(): (value: string | null) => string {
  const { user } = useAdmin();
  return useCallback(
    (value) => {
      const code = (value ?? '').toUpperCase();
      if (!code) {
        return '';
      }
      if (user.role === 'COUNTRY_AGENT') {
        return user.assignedCountries.includes(code) ? code : '';
      }
      return code === OTHER_NATIONALITY || /^[A-Z]{2}$/.test(code) ? code : '';
    },
    [user],
  );
}

/**
 * Nationality filter of the candidate and application lists (never the country of
 * residence): all, Morocco, Tunisia, "other" (neither of them), then every country A-Z in
 * the language of the page. A country agent only gets his own countries.
 */
export function NationalityFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('admin.nationality');
  const locale = useLocale();
  const { user } = useAdmin();
  const agent = user.role === 'COUNTRY_AGENT';
  const others = useMemo(
    () =>
      // Already sorted by name in the page language.
      countryOptions(locale).filter(
        (country) => !(MAIN_NATIONALITIES as readonly string[]).includes(country.code),
      ),
    [locale],
  );
  return (
    <select
      className={filterControl}
      aria-label={t('label')}
      value={value}
      data-testid="nationality-filter"
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="">{t('all')}</option>
      {agent ? (
        user.assignedCountries.map((code) => (
          <option key={code} value={code}>
            {countryName(code, locale)}
          </option>
        ))
      ) : (
        <>
          {MAIN_NATIONALITIES.map((code) => (
            <option key={code} value={code}>
              {countryName(code, locale)}
            </option>
          ))}
          <option value={OTHER_NATIONALITY}>{t('other')}</option>
          <optgroup label={t('allCountries')}>
            {others.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </optgroup>
        </>
      )}
    </select>
  );
}

/** Flag and name of a nationality in a table cell; a dash when none is given. */
export function NationalityCell({ code }: { code: string | null }) {
  const locale = useLocale();
  if (!code) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden>{flag(code)}</span> {countryName(code, locale)}
    </span>
  );
}
