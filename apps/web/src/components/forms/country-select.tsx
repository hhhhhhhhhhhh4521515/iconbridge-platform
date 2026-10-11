'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type SelectHTMLAttributes } from 'react';
import type { FieldError } from 'react-hook-form';
import { countryOptions, flag } from '@/lib/countries';
import { SelectField, useHydrated } from './fields';

/**
 * Every country with its flag, named in the page language. A native list: it works
 * with the keyboard, a screen reader and a phone, in both writing directions.
 */
export function CountrySelect({
  label,
  hint,
  error,
  required,
  ...select
}: {
  label: string;
  hint?: string;
  error?: FieldError;
  required?: boolean;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'>) {
  const locale = useLocale();
  const t = useTranslations('forms');
  // Country names come from the browser, and a server may name some differently:
  // the list is filled in once the page runs in the browser.
  const ready = useHydrated();
  const options = useMemo(() => (ready ? countryOptions(locale) : []), [locale, ready]);
  return (
    <SelectField label={label} hint={hint} error={error} required={required} {...select}>
      <option value="">{t('choose')}</option>
      {options.map((country) => (
        <option key={country.code} value={country.code}>
          {flag(country.code)} {country.name}
        </option>
      ))}
    </SelectField>
  );
}
