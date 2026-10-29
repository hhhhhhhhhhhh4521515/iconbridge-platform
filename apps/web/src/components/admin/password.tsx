'use client';

import { changePasswordSchema } from '@iconbridge/shared/candidate';
import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PasswordField } from '@/components/auth/password-field';
import { FormError, Notice, SubmitButton, useApiErrorText } from '@/components/forms/fields';
import { api, attempt, failure } from '@/lib/client-api';
import { card } from '@/lib/ui';
import { useZodForm } from '@/lib/use-zod-form';
import { useAdmin } from './admin-context';
import { PageHeader } from './ui';

/**
 * "My password" for back-office users. `forced`: the first sign-in with a password chosen
 * by a super admin, where nothing else is reachable until a new one is chosen (ADR-024);
 * the page then reloads the back office with the new session.
 */
export function AdminPassword({ forced = false }: { forced?: boolean }) {
  const t = useTranslations('admin.password');
  const auth = useTranslations('auth');
  const apiError = useApiErrorText();
  const { user } = useAdmin();
  const [state, setState] = useState<{ problem: string | null; saved: boolean }>({
    problem: null,
    saved: false,
  });
  const form = useZodForm(changePasswordSchema, { currentPassword: '', newPassword: '' });
  const newPassword = form.watch('newPassword');
  const submit = form.handleSubmit(async (body) => {
    setState({ problem: null, saved: false });
    const { error, response } = await attempt(api.POST('/api/v1/me/password', { body }));
    if (response?.ok) {
      if (forced) {
        // The session now carries the new password: load the back office for real.
        window.location.reload();
        return;
      }
      form.reset();
      setState({ problem: null, saved: true });
      return;
    }
    const { code } = failure(error);
    if (code === 'INVALID_CREDENTIALS') {
      form.setError('currentPassword', { message: 'wrongPassword' }, { shouldFocus: true });
    } else if (code === 'WEAK_PASSWORD') {
      form.setError('newPassword', { message: 'weakPassword' }, { shouldFocus: true });
    } else {
      setState({ problem: apiError(code), saved: false });
    }
  });
  return (
    <div className="max-w-xl">
      <PageHeader title={forced ? t('forcedTitle') : t('title')} />
      <section className={`${card} space-y-4 p-5`} data-testid="admin-password">
        {forced ? (
          <Notice tone="warning">
            <KeyRound className="me-2 inline size-4 align-text-bottom" aria-hidden />
            {t('forcedText')}
          </Notice>
        ) : (
          <p className="text-sm text-muted-foreground">{t('text')}</p>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
          <PasswordField
            label={forced ? t('given') : t('current')}
            autoComplete="current-password"
            error={form.formState.errors.currentPassword}
            {...form.register('currentPassword')}
          />
          <PasswordField
            label={auth('newPassword')}
            autoComplete="new-password"
            error={form.formState.errors.newPassword}
            meter={{ password: newPassword, inputs: [user.email] }}
            {...form.register('newPassword')}
          />
          <SubmitButton busy={form.formState.isSubmitting}>{t('save')}</SubmitButton>
          <div aria-live="polite">
            {state.saved ? <Notice tone="success">{t('saved')}</Notice> : null}
            <FormError>{state.problem}</FormError>
          </div>
        </form>
      </section>
    </div>
  );
}
