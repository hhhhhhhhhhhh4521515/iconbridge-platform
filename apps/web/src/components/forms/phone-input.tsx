'use client';

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { FieldError } from 'react-hook-form';
import { countryName, flag } from '@/lib/countries';
import { control, Field, useHydrated } from './fields';

const DIALLING_COUNTRIES = getCountries();

function split(
  value: string | null,
  fallback: CountryCode,
): { country: CountryCode; national: string } {
  const parsed = value ? parsePhoneNumberFromString(value) : undefined;
  if (parsed?.country) {
    return { country: parsed.country, national: parsed.nationalNumber };
  }
  return { country: fallback, national: value?.replace(/^\+/, '') ?? '' };
}

/**
 * Phone number in two parts: the country (flag and calling code) and the number.
 * The form receives one international number ("+21612345678"), or null when empty.
 * Always written left to right, also on Arabic pages.
 */
export function PhoneInput({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  onBlur,
  defaultCountry = 'TN',
  name,
}: {
  label: string;
  hint?: string;
  error?: FieldError;
  required?: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
  defaultCountry?: string;
  name: string;
}) {
  const locale = useLocale();
  const t = useTranslations('forms');
  const fallback = (DIALLING_COUNTRIES as string[]).includes(defaultCountry)
    ? (defaultCountry as CountryCode)
    : 'TN';
  const [parts, setParts] = useState(() => split(value, fallback));
  // As in CountrySelect: names are written by the browser, so the full list waits for it.
  const ready = useHydrated();
  const options = useMemo(() => {
    if (!ready) {
      return [{ code: parts.country, name: '', dial: getCountryCallingCode(parts.country) }];
    }
    const collator = new Intl.Collator(locale);
    return DIALLING_COUNTRIES.map((code) => ({
      code,
      name: countryName(code, locale),
      dial: getCountryCallingCode(code),
    })).sort((a, b) => collator.compare(a.name, b.name));
  }, [locale, ready, parts.country]);

  const update = (next: { country: CountryCode; national: string }) => {
    setParts(next);
    // Spaces and the leading zero of a national number are not part of the international form.
    const digits = next.national.replace(/\D/g, '').replace(/^0+/, '');
    onChange(digits ? `+${getCountryCallingCode(next.country)}${digits}` : null);
  };

  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(props) => (
        <div dir="ltr" className="flex gap-2">
          <select
            aria-label={t('phoneCountry')}
            className={`${control} max-w-36 shrink-0`}
            value={parts.country}
            data-testid={`${name}-country`}
            onChange={(event) => {
              update({ ...parts, country: event.target.value as CountryCode });
            }}
          >
            {options.map((option) => (
              <option key={option.code} value={option.code}>
                {flag(option.code)} +{option.dial} {option.name}
              </option>
            ))}
          </select>
          <input
            {...props}
            name={name}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            className={`${control} min-w-0 flex-1`}
            value={parts.national}
            onBlur={onBlur}
            onChange={(event) => {
              update({ ...parts, national: event.target.value });
            }}
          />
        </div>
      )}
    </Field>
  );
}
