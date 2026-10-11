'use client';

import { useTranslations } from 'next-intl';
import {
  useId,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { FieldError as RhfError } from 'react-hook-form';
import { cta, field } from '@/lib/ui';

type Problem = RhfError | { message?: string } | undefined;

/** Translates the key a resolver left in an error ("tooShort:10") into a sentence. */
export function useErrorText(): (error: Problem) => string | null {
  const t = useTranslations('forms.errors');
  return (error) => {
    if (!error?.message) {
      return error ? t('invalid') : null;
    }
    const [key = 'invalid', count] = error.message.split(':');
    return t.has(key) ? t(key, { count: Number(count ?? 0) }) : t('invalid');
  };
}

/** Sentence for an error code of the API, or a generic one for codes without a translation. */
export function useApiErrorText(): (code: string | null | undefined) => string {
  const t = useTranslations('forms.api');
  return (code) => (code && t.has(code) ? t(code) : t('INTERNAL_ERROR'));
}

interface Described {
  label: string;
  hint?: string;
  error?: Problem;
  required?: boolean;
  className?: string;
}

/**
 * Label, control, hint and error of one field. The control receives the ids so the
 * error is announced with the field (aria-describedby) and marks it aria-invalid.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: Described & {
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    'aria-required': boolean | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const text = useErrorText()(error);
  const common = useTranslations('common');
  const describedBy =
    [hint ? `${id}-hint` : null, text ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
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
      </label>
      {children({
        id,
        'aria-invalid': Boolean(text),
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
      })}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {text ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-medium text-destructive">
          {text}
        </p>
      ) : null}
    </div>
  );
}

const invalid = 'aria-[invalid=true]:border-destructive';
export const control = `${field} ${invalid}`;

export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...input
}: Described & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => <input {...input} {...props} className={control} />}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  className,
  ...input
}: Described & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => <textarea rows={4} {...input} {...props} className={control} />}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...select
}: Described & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => (
        <select {...select} {...props} className={control}>
          {children}
        </select>
      )}
    </Field>
  );
}

/** A checkbox with its text; the whole row is at least 44 px high. */
export function CheckField({
  children,
  error,
  ...input
}: { children: ReactNode; error?: Problem } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
>) {
  const id = useId();
  const text = useErrorText()(error);
  return (
    <div>
      <div className="flex min-h-11 items-start gap-3 py-2">
        <input
          {...input}
          id={id}
          type="checkbox"
          aria-invalid={Boolean(text)}
          aria-describedby={text ? `${id}-error` : undefined}
          className="mt-0.5 size-5 shrink-0 rounded border-input accent-primary"
        />
        <label htmlFor={id} className="text-sm">
          {children}
        </label>
      </div>
      {text ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {text}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return children ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive"
    >
      {children}
    </p>
  ) : null;
}

export function Notice({
  children,
  tone = 'info',
  testId,
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning';
  testId?: string;
}) {
  const tones = {
    info: 'bg-muted text-foreground',
    success: 'bg-secondary text-secondary-foreground',
    warning: 'border border-brand-gold bg-brand-gold-soft text-foreground',
  } as const;
  return (
    <p
      role="status"
      data-testid={testId}
      className={`rounded-lg p-3 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </p>
  );
}

export function SubmitButton({
  busy,
  children,
  busyLabel,
  disabled,
  variant = 'primary',
}: {
  busy: boolean;
  children: ReactNode;
  busyLabel?: string;
  disabled?: boolean;
  variant?: keyof typeof cta;
}) {
  const t = useTranslations('forms');
  return (
    <button type="submit" className={cta[variant]} disabled={busy || disabled} aria-busy={busy}>
      {busy ? (busyLabel ?? t('saving')) : children}
    </button>
  );
}

/** Grey blocks shown while data loads; announced once as "Loading". */
export function Loading({ lines = 3 }: { lines?: number }) {
  const t = useTranslations('forms');
  return (
    <div role="status" aria-live="polite" className="space-y-3" data-testid="loading">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('forms');
  const common = useTranslations('common');
  return (
    <div role="alert" className="rounded-lg border border-border p-5">
      <p className="mb-3 text-sm font-medium">{t('loadFailed')}</p>
      <button type="button" className={cta.outline} onClick={onRetry}>
        {common('retry')}
      </button>
    </div>
  );
}

/**
 * The fields of a form that the server renders. They stay inactive until the page's
 * scripts have started: what someone types earlier would be lost when the form takes over.
 */
/** False on the server and while the page takes over its HTML, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function Fields({ className, children }: { className?: string; children: ReactNode }) {
  const ready = useHydrated();
  return (
    <fieldset disabled={!ready} className={`m-0 min-w-0 border-0 p-0 ${className ?? ''}`}>
      {children}
    </fieldset>
  );
}
