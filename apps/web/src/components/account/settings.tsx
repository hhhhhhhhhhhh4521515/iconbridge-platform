'use client';

import { changePasswordSchema, deleteAccountSchema } from '@iconbridge/shared/candidate';
import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { PasswordField } from '@/components/auth/password-field';
import { CheckGroup } from '@/components/forms/check-group';
import {
  control,
  FormError,
  LoadFailed,
  Loading,
  Notice,
  SubmitButton,
  TextField,
  useApiErrorText,
} from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { useRouter } from '@/i18n/navigation';
import { LOCALE_NAMES, LOCALES, type AppLocale } from '@/i18n/routing';
import { api, attempt, failure, forgetSession, type JobAlert } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { card, cta } from '@/lib/ui';
import { useZodForm } from '@/lib/use-zod-form';
import { useAccount, useLoaded } from './account-context';
import { PageTitle } from './account-shell';

function Section({
  id,
  title,
  text,
  children,
}: {
  id: string;
  title: string;
  text?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`${card} p-5`}
      aria-labelledby={`${id}-title`}
      data-testid={`settings-${id}`}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      {text ? <p className="mt-1 text-sm text-muted-foreground">{text}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Language of the emails and of the site: saved on the account, then the page changes language. */
function LanguageSettings() {
  const t = useTranslations('account.settings');
  const apiError = useApiErrorText();
  const router = useRouter();
  const current = useLocale() as AppLocale;
  const { user } = useAccount();
  const [locale, setLocale] = useState<AppLocale>(user.locale);
  const [state, setState] = useState<{ busy: boolean; problem: string | null; saved: boolean }>({
    busy: false,
    problem: null,
    saved: false,
  });
  const save = async () => {
    setState({ busy: true, problem: null, saved: false });
    const { error, response } = await attempt(
      api.PATCH('/api/v1/me/settings', { body: { locale } }),
    );
    if (!response?.ok) {
      setState({ busy: false, problem: apiError(failure(error).code), saved: false });
      return;
    }
    setState({ busy: false, problem: null, saved: true });
    if (locale !== current) {
      router.replace('/account/settings', { locale });
    }
  };
  return (
    <Section id="language" title={t('languageTitle')} text={t('languageText')}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div>
          <label htmlFor="settings-locale" className="mb-1 block text-sm font-medium">
            {t('language')}
          </label>
          <select
            id="settings-locale"
            className={`${control} min-w-48`}
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value as AppLocale);
            }}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {LOCALE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton busy={state.busy}>{t('save')}</SubmitButton>
      </form>
      <div className="mt-3" aria-live="polite">
        {state.saved ? <Notice tone="success">{t('saved')}</Notice> : null}
        <FormError>{state.problem}</FormError>
      </div>
    </Section>
  );
}

function PasswordSettings() {
  const t = useTranslations('account.settings');
  const auth = useTranslations('auth');
  const apiError = useApiErrorText();
  const { user } = useAccount();
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
    <Section id="password" title={t('passwordTitle')} text={t('passwordText')}>
      <form onSubmit={(event) => void submit(event)} noValidate className="max-w-md space-y-4">
        <PasswordField
          label={t('currentPassword')}
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
        <SubmitButton busy={form.formState.isSubmitting}>{t('changePassword')}</SubmitButton>
        <div aria-live="polite">
          {state.saved ? <Notice tone="success">{t('passwordSaved')}</Notice> : null}
          <FormError>{state.problem}</FormError>
        </div>
      </form>
    </Section>
  );
}

/** Emails about new jobs, sent to the address of the account. */
function JobAlertSettings() {
  const t = useTranslations('account.settings');
  const apiError = useApiErrorText();
  const locale = useLocale();
  const { user } = useAccount();
  const fetcher = useCallback(async () => {
    const [alerts, destinations, categories] = await Promise.all([
      api.GET('/api/v1/me/job-alerts'),
      api.GET('/api/v1/destinations'),
      api.GET('/api/v1/categories'),
    ]);
    return alerts.data && destinations.data && categories.data
      ? { alerts: alerts.data, destinations: destinations.data, categories: categories.data }
      : undefined;
  }, []);
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <Section id="alerts" title={t('alertsTitle')}>
        <Loading lines={2} />
      </Section>
    );
  }
  if (failed || !data) {
    return (
      <Section id="alerts" title={t('alertsTitle')}>
        <LoadFailed onRetry={reload} />
      </Section>
    );
  }
  const update = (alerts: JobAlert[]) => {
    setData({ ...data, alerts });
  };
  const create = async () => {
    setBusy(true);
    setProblem(null);
    const { data: alerts, error } = await attempt(
      api.POST('/api/v1/me/job-alerts', { body: { destinations, categories } }),
    );
    setBusy(false);
    if (!alerts) {
      setProblem(apiError(failure(error).code));
      return;
    }
    setDestinations([]);
    setCategories([]);
    update(alerts);
  };
  const remove = async (id: string) => {
    setProblem(null);
    const { error, response } = await attempt(
      api.DELETE('/api/v1/me/job-alerts/{id}', { params: { path: { id } } }),
    );
    if (!response?.ok) {
      setProblem(apiError(failure(error).code));
      return;
    }
    update(data.alerts.filter((alert) => alert.id !== id));
  };
  const destinationName = (code: string) =>
    pick(data.destinations.find((entry) => entry.code === code)?.name, locale) || code;
  const categoryName = (slug: string) =>
    pick(data.categories.find((entry) => entry.slug === slug)?.name, locale) || slug;

  return (
    <Section id="alerts" title={t('alertsTitle')} text={t('alertsText', { email: user.email })}>
      {data.alerts.length === 0 ? (
        <p className="rounded-lg bg-muted p-4 text-sm" data-testid="no-alerts">
          {t('noAlerts')}
        </p>
      ) : (
        <ul className="divide-y divide-border" data-testid="alerts">
          {data.alerts.map((alert) => (
            <li key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="text-sm">
                <p className="font-medium">
                  {alert.destinations.length > 0
                    ? alert.destinations.map(destinationName).join(', ')
                    : t('allDestinations')}
                </p>
                <p className="text-muted-foreground">
                  {alert.categories.length > 0
                    ? alert.categories.map(categoryName).join(', ')
                    : t('allCategories')}
                </p>
              </div>
              <button
                type="button"
                className={`${cta.ghost} text-destructive`}
                onClick={() => void remove(alert.id)}
              >
                <Trash2 className="size-4" aria-hidden />
                {t('deleteAlert')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {user.emailVerified ? (
        <form
          className="mt-5 space-y-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <h3 className="font-semibold">{t('newAlert')}</h3>
          <CheckGroup
            legend={t('alertDestinations')}
            hint={t('alertHint')}
            columns="sm:grid-cols-3"
            value={destinations}
            onChange={setDestinations}
            options={data.destinations.map((entry) => ({
              value: entry.code,
              label: pick(entry.name, locale),
            }))}
          />
          <CheckGroup
            legend={t('alertCategories')}
            columns="sm:grid-cols-3"
            value={categories}
            onChange={setCategories}
            options={data.categories.map((entry) => ({
              value: entry.slug,
              label: pick(entry.name, locale),
            }))}
          />
          <SubmitButton busy={busy}>{t('createAlert')}</SubmitButton>
        </form>
      ) : (
        <div className="mt-4">
          <Notice tone="warning">{t('alertsNeedVerifiedEmail')}</Notice>
        </div>
      )}
      <div className="mt-3">
        <FormError>{problem}</FormError>
      </div>
    </Section>
  );
}

function DataSettings() {
  const t = useTranslations('account.settings');
  const [busy, setBusy] = useState(false);
  /** The archive is a plain download: the access token is renewed first if it has expired. */
  const download = async () => {
    setBusy(true);
    const { response } = await attempt(api.GET('/api/v1/me/profile'));
    setBusy(false);
    if (response?.ok) {
      // A file to save, not a page of the site.
      window.open('/api/v1/me/export', '_self');
    }
  };
  return (
    <Section id="data" title={t('dataTitle')} text={t('dataText')}>
      <button type="button" className={cta.outline} disabled={busy} onClick={() => void download()}>
        {t('download')}
      </button>
    </Section>
  );
}

/** The word to type before the account is deleted; the same in every language. */
const CONFIRM_WORD = 'DELETE';
const deleteSchema = deleteAccountSchema.extend({ confirm: z.literal(CONFIRM_WORD) });

function DeleteAccount() {
  const t = useTranslations('account.settings');
  const common = useTranslations('common');
  const apiError = useApiErrorText();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const form = useZodForm<typeof deleteSchema, { password: string; confirm: string }>(
    deleteSchema,
    {
      password: '',
      confirm: '',
    },
  );
  const confirm = form.watch('confirm');
  const submit = form.handleSubmit(async ({ password }) => {
    setProblem(null);
    const { error, response } = await attempt(
      api.DELETE('/api/v1/me/account', { body: { password } }),
    );
    if (response?.ok) {
      forgetSession();
      router.replace('/');
      router.refresh();
      return;
    }
    const { code } = failure(error);
    if (code === 'INVALID_CREDENTIALS') {
      form.setError('password', { message: 'wrongPassword' }, { shouldFocus: true });
    } else {
      setProblem(apiError(code));
    }
  });
  return (
    <Section id="delete" title={t('deleteTitle')} text={t('deleteText')}>
      <button
        type="button"
        className={`${cta.outline} border-destructive text-destructive`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('deleteAccount')}
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          form.reset();
          setProblem(null);
        }}
        title={t('deleteConfirmTitle')}
        closeLabel={common('close')}
      >
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
          <p className="text-sm">{t('deleteWarning')}</p>
          <TextField
            label={t('deleteType', { word: CONFIRM_WORD })}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            dir="ltr"
            required
            error={form.formState.errors.confirm ? { message: 'typeDelete' } : undefined}
            {...form.register('confirm')}
          />
          <PasswordField
            label={t('currentPassword')}
            autoComplete="current-password"
            error={form.formState.errors.password}
            {...form.register('password')}
          />
          <FormError>{problem}</FormError>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={`${cta.primary} bg-destructive text-white hover:bg-destructive/90`}
              disabled={confirm !== CONFIRM_WORD || form.formState.isSubmitting}
              aria-busy={form.formState.isSubmitting}
            >
              {t('deleteForever')}
            </button>
            <button
              type="button"
              className={cta.outline}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      </Modal>
    </Section>
  );
}

export function SettingsPage() {
  const t = useTranslations('account.settings');
  return (
    <>
      <PageTitle title={t('title')} />
      <div className="space-y-6">
        <LanguageSettings />
        <PasswordSettings />
        <JobAlertSettings />
        <DataSettings />
        <DeleteAccount />
      </div>
    </>
  );
}
