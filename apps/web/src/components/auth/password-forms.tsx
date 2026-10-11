'use client';

import { emailOnlySchema, resetPasswordSchema } from '@iconbridge/shared/auth';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  Fields,
  FormError,
  Notice,
  SubmitButton,
  TextField,
  useApiErrorText,
} from '@/components/forms/fields';
import { Link, useRouter } from '@/i18n/navigation';
import { api, attempt, failure } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { useZodForm } from '@/lib/use-zod-form';
import { PasswordField } from './password-field';

/** Asks for the reset email. The answer is the same whether the address has an account or not. */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const apiError = useApiErrorText();
  const [state, setState] = useState<{ sent: boolean; problem: string | null }>({
    sent: false,
    problem: null,
  });
  const form = useZodForm(emailOnlySchema, { email: '' });

  const submit = form.handleSubmit(async (body) => {
    const { error, response } = await attempt(api.POST('/api/v1/auth/forgot-password', { body }));
    setState(
      response?.ok
        ? { sent: true, problem: null }
        : { sent: false, problem: apiError(failure(error).code) },
    );
  });

  if (state.sent) {
    return (
      <div className="space-y-4" data-testid="reset-sent">
        <Notice tone="success">{t('forgotSent')}</Notice>
        <Link href="/login" className={cta.outline}>
          {t('backToLogin')}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Fields className="space-y-4">
        <FormError>{state.problem}</FormError>
        <TextField
          label={t('email')}
          type="email"
          autoComplete="email"
          required
          error={form.formState.errors.email}
          {...form.register('email')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SubmitButton busy={form.formState.isSubmitting} busyLabel={t('sending')}>
            {t('sendResetLink')}
          </SubmitButton>
          <Link href="/login" className="text-sm font-medium underline">
            {t('backToLogin')}
          </Link>
        </div>
      </Fields>
    </form>
  );
}

/** Chooses a password with the token of an email: after "forgot password" or an invitation. */
export function NewPasswordForm() {
  const t = useTranslations('auth');
  const apiError = useApiErrorText();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [problem, setProblem] = useState<string | null>(null);
  const form = useZodForm(resetPasswordSchema, { token, password: '' });
  const password = form.watch('password');

  const submit = form.handleSubmit(async (body) => {
    setProblem(null);
    const { error, response } = await attempt(api.POST('/api/v1/auth/reset-password', { body }));
    if (response?.ok) {
      router.replace('/login?reset=done');
      return;
    }
    const { code } = failure(error);
    if (code === 'WEAK_PASSWORD') {
      form.setError('password', { message: 'weakPassword' }, { shouldFocus: true });
      return;
    }
    setProblem(code === 'INVALID_TOKEN' ? t('linkExpired') : apiError(code));
  });

  if (!token || form.formState.errors.token) {
    return (
      <div className="space-y-4">
        <FormError>{t('linkExpired')}</FormError>
        <Link href="/forgot-password" className={cta.outline}>
          {t('sendResetLink')}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Fields className="space-y-4">
        <FormError>{problem}</FormError>
        {problem ? (
          <Link href="/forgot-password" className="text-sm font-medium underline">
            {t('sendResetLink')}
          </Link>
        ) : null}
        <PasswordField
          label={t('newPassword')}
          autoComplete="new-password"
          error={form.formState.errors.password}
          meter={{ password, inputs: [] }}
          {...form.register('password')}
        />
        <SubmitButton busy={form.formState.isSubmitting}>{t('savePassword')}</SubmitButton>
      </Fields>
    </form>
  );
}
