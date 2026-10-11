'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type InputHTMLAttributes } from 'react';
import type { FieldError } from 'react-hook-form';
import { control, Field } from '@/components/forms/fields';
import { PasswordMeter } from '@/components/forms/password-meter';

/** Password input with a show/hide button and, for a new password, the strength meter. */
export function PasswordField({
  label,
  error,
  meter,
  ...input
}: {
  label: string;
  error?: FieldError;
  /** Present for a new password: its current value and the words it should not contain. */
  meter?: { password: string; inputs: string[] };
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} required>
      {(props) => (
        <>
          <div className="relative">
            <input
              {...input}
              {...props}
              aria-describedby={
                [props['aria-describedby'], meter ? `${props.id}-strength` : null]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              type={visible ? 'text' : 'password'}
              className={`${control} pe-12`}
            />
            <button
              type="button"
              className="absolute inset-y-0 end-0 inline-flex w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={visible ? t('hidePassword') : t('showPassword')}
              aria-pressed={visible}
              onClick={() => {
                setVisible((value) => !value);
              }}
            >
              {visible ? (
                <EyeOff className="size-5" aria-hidden />
              ) : (
                <Eye className="size-5" aria-hidden />
              )}
            </button>
          </div>
          {meter ? (
            <PasswordMeter
              id={`${props.id}-strength`}
              password={meter.password}
              inputs={meter.inputs}
            />
          ) : null}
        </>
      )}
    </Field>
  );
}
