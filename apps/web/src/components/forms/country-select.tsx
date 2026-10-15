'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import {
  useController,
  type Control,
  type FieldError,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { countryOptions } from '@/lib/countries';
import { orderCountries, type CountryChoice } from '@/lib/country-search';
import { CountryCombobox } from './country-combobox';
import { Field, useHydrated } from './fields';

/**
 * Every country with its flag, named in the page language: Tunisia, Morocco, Algeria,
 * Egypt, Malta and Poland first, then the others by name. Found by typing its name or
 * ISO code (see `CountryCombobox`).
 */
export function useCountryChoices(): CountryChoice[] {
  const locale = useLocale();
  // Country names come from the browser, and a server may name some differently:
  // the list is filled in once the page runs in the browser.
  const ready = useHydrated();
  return useMemo(
    () => (ready ? orderCountries(countryOptions(locale), locale) : []),
    [locale, ready],
  );
}

export function CountrySelect({
  label,
  hint,
  error,
  required,
  name,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  hint?: string;
  error?: FieldError;
  required?: boolean;
  name: string;
  value: string | null;
  onChange: (code: string | null) => void;
  onBlur?: () => void;
}) {
  const choices = useCountryChoices();
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(props) => (
        <CountryCombobox
          {...props}
          name={name}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          choices={choices}
        />
      )}
    </Field>
  );
}

/** `CountrySelect` for a react-hook-form field holding an ISO code (or null). */
export function CountryField<Values extends FieldValues>({
  control,
  name,
  ...rest
}: {
  control: Control<Values>;
  name: FieldPath<Values>;
} & Omit<Parameters<typeof CountrySelect>[0], 'name' | 'value' | 'onChange' | 'onBlur'>) {
  const { field } = useController({ control, name });
  return (
    <CountrySelect
      {...rest}
      name={name}
      value={typeof field.value === 'string' && field.value ? field.value : null}
      onChange={field.onChange}
      onBlur={field.onBlur}
    />
  );
}
