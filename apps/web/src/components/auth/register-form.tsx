'use client';

import { registerSchema } from '@iconbridge/shared/auth';
import { MailCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { Controller } from 'react-hook-form';
import { CountrySelect } from '@/components/forms/country-select';
import {
  Fields,
  CheckField,
  FormError,
  Notice,
  SubmitButton,
  TextField,
  useApiErrorText,
} from '@/components/forms/fields';
import { PhoneInput } from '@/components/forms/phone-input';
import { Turnstile } from '@/components/forms/turnstile';
import { Link } from '@/i18n/navigation';
import { api, attempt, failure } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { useZodForm } from '@/lib/use-zod-form';
import { PasswordField } from './password-field';

const formSchema = registerSchema.omit({ turnstileToken: true, locale: true });

interface Values {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  country: string;
  gdprConsent: boolean;
}

/** "Check your inbox", with a button to send the email again. */
export function CheckInbox({ email }: { email: string }) {
  const t = useTranslations('auth');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const resend = async () => {
    setState('sending');
    const { response } = await attempt(
      api.POST('/api/v1/auth/resend-verification', { body: { email } }),
    );
    setState(response?.ok ? 'sent' : 'failed');
  };
  return (
    <div className="space-y-4 text-center" data-testid="check-inbox">
      <MailCheck className="mx-auto size-12 text-brand-gold" aria-hidden />
      <h2 className="text-xl font-semibold">{t('checkInboxTitle')}</h2>
      <p className="text-muted-foreground">{t('checkInboxText', { email })}</p>
      {state === 'sent' ? <Notice tone="success">{t('resent')}</Notice> : null}
      {state === 'failed' ? <FormError>{t('resendFailed')}</FormError> : null}
      <button
        type="button"
        className={cta.outline}
        disabled={state === 'sending'}
        onClick={() => void resend()}
      >
        {t('resend')}
      </button>
    </div>
  );
}

export function RegisterForm({ siteKey }: { siteKey: string }) {
  const t = useTranslations('auth');
  const apiError = useApiErrorText();
  const locale = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
  }, []);
  const form = useZodForm<typeof formSchema, Values>(formSchema, {
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: null,
    country: '',
    gdprConsent: false,
  });
  const { errors, isSubmitting } = form.formState;
  const [password, email, firstName, lastName, country] = form.watch([
    'password',
    'email',
    'firstName',
    'lastName',
    'country',
  ]);

  const submit = form.handleSubmit(async (values) => {
    setProblem(null);
    const { error, response } = await attempt(
      api.POST('/api/v1/auth/register', {
        body: { ...values, turnstileToken: token ?? '', locale: locale as 'fr' | 'en' | 'ar' },
      }),
    );
    if (response?.ok) {
      setSentTo(values.email);
      return;
    }
    const { code } = failure(error);
    if (code === 'WEAK_PASSWORD') {
      form.setError('password', { message: 'weakPassword' }, { shouldFocus: true });
      return;
    }
    setProblem(apiError(code));
  });

  if (sentTo) {
    return <CheckInbox email={sentTo} />;
  }
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Fields className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError>{problem}</FormError>
        </div>
        <TextField
          label={t('firstName')}
          autoComplete="given-name"
          required
          error={errors.firstName}
          {...form.register('firstName')}
        />
        <TextField
          label={t('lastName')}
          autoComplete="family-name"
          required
          error={errors.lastName}
          {...form.register('lastName')}
        />
        <TextField
          className="sm:col-span-2"
          label={t('email')}
          type="email"
          autoComplete="email"
          required
          error={errors.email}
          {...form.register('email')}
        />
        <CountrySelect
          label={t('country')}
          autoComplete="country"
          required
          error={errors.country}
          {...form.register('country')}
        />
        <Controller
          control={form.control}
          name="phone"
          render={({ field, fieldState }) => (
            <PhoneInput
              key={country || 'none'}
              name="phone"
              label={t('phone')}
              hint={t('phoneHint')}
              required
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error}
              defaultCountry={country || undefined}
            />
          )}
        />
        <div className="sm:col-span-2">
          <PasswordField
            label={t('password')}
            autoComplete="new-password"
            error={errors.password}
            meter={{ password, inputs: [email, firstName, lastName] }}
            {...form.register('password')}
          />
        </div>
        <div className="sm:col-span-2">
          <CheckField error={errors.gdprConsent} {...form.register('gdprConsent')}>
            {t.rich('consent', {
              privacy: (chunks) => (
                <Link href="/privacy" target="_blank" className="font-semibold underline">
                  {chunks}
                </Link>
              ),
            })}
          </CheckField>
        </div>
        <div className="space-y-3 sm:col-span-2">
          <Turnstile siteKey={siteKey} onToken={onToken} label={t('captcha')} />
          <SubmitButton
            busy={isSubmitting}
            busyLabel={t('creating')}
            disabled={!token}
            variant="gold"
          >
            {t('createAccount')}
          </SubmitButton>
          <p className="border-t border-border pt-4 text-sm">
            {t('haveAccount')}{' '}
            <Link href="/login" className="font-semibold underline">
              {t('signIn')}
            </Link>
          </p>
        </div>
      </Fields>
    </form>
  );
}
