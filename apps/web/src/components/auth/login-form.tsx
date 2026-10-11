'use client';

import { loginSchema } from '@iconbridge/shared/auth';
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
import { api, attempt, failure, sessionChanged } from '@/lib/client-api';
import { safeNext } from '@/lib/forms';
import { useZodForm } from '@/lib/use-zod-form';
import { PasswordField } from './password-field';

export function LoginForm() {
  const t = useTranslations('auth');
  const apiError = useApiErrorText();
  const router = useRouter();
  const search = useSearchParams();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useZodForm(loginSchema, { email: '', password: '' });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (body) => {
    setProblem(null);
    const { data, error } = await attempt(api.POST('/api/v1/auth/login', { body }));
    if (!data) {
      const { code } = failure(error);
      setProblem(code === 'INVALID_CREDENTIALS' ? t('wrongCredentials') : apiError(code));
      return;
    }
    sessionChanged();
    router.replace(safeNext(search.get('next'), data.role === 'CANDIDATE' ? '/account' : '/admin'));
    router.refresh();
  });

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Fields className="space-y-4">
        {search.get('reset') === 'done' ? (
          <Notice tone="success">{t('passwordChanged')}</Notice>
        ) : null}
        <FormError>{problem}</FormError>
        <TextField
          label={t('email')}
          type="email"
          autoComplete="email"
          required
          error={errors.email}
          {...form.register('email')}
        />
        <PasswordField
          label={t('password')}
          autoComplete="current-password"
          error={errors.password}
          {...form.register('password')}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SubmitButton busy={isSubmitting} busyLabel={t('signingIn')}>
            {t('signIn')}
          </SubmitButton>
          <Link href="/forgot-password" className="text-sm font-medium underline">
            {t('forgotLink')}
          </Link>
        </div>
        <p className="border-t border-border pt-4 text-sm">
          {t('noAccount')}{' '}
          <Link href="/register" className="font-semibold underline">
            {t('createAccount')}
          </Link>
        </p>
      </Fields>
    </form>
  );
}
