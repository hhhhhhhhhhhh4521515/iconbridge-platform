'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import {
  useController,
  type Control,
  type FieldError,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { field } from '@/lib/ui';
import { useErrorText } from './fields';

type Part = 'day' | 'month' | 'year';
type Parts = Record<Part, string>;

const EMPTY: Parts = { day: '', month: '', year: '' };
const split = (value: string): Parts => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? { year: match[1] ?? '', month: String(Number(match[2])), day: String(Number(match[3])) }
    : EMPTY;
};
const join = ({ day, month, year }: Parts) =>
  day && month && year ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : '';

/** Day, month and year in the order of the language: 12/04/1995 in French, 4/12/1995 in English. */
function orderOf(locale: string): Part[] {
  const order = new Intl.DateTimeFormat(locale, { timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2001, 1, 3)))
    .map((part) => part.type)
    .filter((type): type is Part => type === 'day' || type === 'month' || type === 'year');
  return order.length === 3 ? order : ['day', 'month', 'year'];
}

/**
 * A date chosen with three lists. A native date input follows the language of the
 * browser, not of the page, and looks different in every browser; these lists are in
 * the language of the page and work the same everywhere. The value is YYYY-MM-DD, or
 * an empty text while a part is missing.
 */
export function DateSelects({
  value,
  onChange,
  onBlur,
  label,
  hint,
  error,
  required,
  fromYear,
  toYear,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** First and last year offered; the list starts with the most likely end. */
  fromYear: number;
  toYear: number;
  className?: string;
}) {
  const id = useId();
  const locale = useLocale();
  const t = useTranslations('forms.date');
  const common = useTranslations('common');
  // What the lists show. A date typed half-way has no value yet, so it lives here.
  const [parts, setParts] = useState<Parts>(() => split(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // The form changed the value itself (loaded data, reset).
    setSeen(value);
    if (value !== join(parts)) {
      setParts(split(value));
    }
  }
  const order = useMemo(() => orderOf(locale), [locale]);
  const months = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, index) => format.format(new Date(Date.UTC(2001, index))));
  }, [locale]);
  const years = useMemo(() => {
    const step = fromYear <= toYear ? 1 : -1;
    return Array.from({ length: Math.abs(toYear - fromYear) + 1 }, (_, i) => fromYear + i * step);
  }, [fromYear, toYear]);

  const options: Record<Part, { value: string; text: string }[]> = {
    day: Array.from({ length: 31 }, (_, index) => {
      const day = String(index + 1);
      return { value: day, text: day };
    }),
    month: months.map((name, index) => ({ value: String(index + 1), text: name })),
    year: years.map((year) => ({ value: String(year), text: String(year) })),
  };
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <fieldset className={className} aria-describedby={describedBy}>
      <legend className="mb-1 block text-sm font-medium">
        {label}
        {required ? (
          <>
            <span aria-hidden className="text-destructive">
              {' '}
              *
            </span>
            <span className="sr-only"> ({common('required')})</span>
          </>
        ) : null}
      </legend>
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: order
            .map(
              (part) => `minmax(0, ${part === 'month' ? '1.6' : part === 'year' ? '1.2' : '1'}fr)`,
            )
            .join(' '),
        }}
      >
        {order.map((part, index) => (
          <select
            key={part}
            aria-label={t(part)}
            aria-invalid={Boolean(error)}
            aria-required={required ? true : undefined}
            className={`${field} aria-[invalid=true]:border-destructive`}
            value={parts[part]}
            onChange={(event) => {
              const next = { ...parts, [part]: event.target.value };
              setParts(next);
              setSeen(join(next));
              onChange(join(next));
            }}
            onBlur={index === order.length - 1 ? onBlur : undefined}
          >
            <option value="">{t(part)}</option>
            {options[part].map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        ))}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** `DateSelects` for a react-hook-form field holding YYYY-MM-DD (or an empty text). */
export function DateField<Values extends FieldValues>({
  control,
  name,
  error,
  ...rest
}: {
  control: Control<Values>;
  name: FieldPath<Values>;
  error?: FieldError | { message?: string };
} & Omit<Parameters<typeof DateSelects>[0], 'value' | 'onChange' | 'onBlur' | 'error'>) {
  const { field: input } = useController({ control, name });
  const text = useErrorText()(error);
  return (
    <DateSelects
      {...rest}
      value={typeof input.value === 'string' ? input.value : ''}
      onChange={input.onChange}
      onBlur={input.onBlur}
      error={text}
    />
  );
}
