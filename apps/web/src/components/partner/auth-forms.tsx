'use client';

import { PASSWORD_MIN_LENGTH } from '@iconbridge/shared/auth';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';
import { PasswordField } from '@/components/auth/password-field';
import { Turnstile } from '@/components/forms/turnstile';
import { api, attempt, failure, sessionChanged } from '@/lib/client-api';
import { safeNext } from '@/lib/forms';
import {
  isPartnerLang,
  LANG_CHOSEN_COOKIE,
  partnerHref,
  type PartnerLang,
} from '@/lib/partner-locale';
import { cta, field } from '@/lib/ui';
import { PartnerHeader } from './partner-chrome';
import { usePartnerApiError } from './partner-ui';

const input = `${field} aria-[invalid=true]:border-destructive`;

function usePartnerLang(): PartnerLang {
  const locale = useLocale();
  return isPartnerLang(locale) ? locale : 'en';
}

/** The card of the screens without a session: title, intro, language switch, form. */
export function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <>
      <PartnerHeader />
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {intro ? <p className="mt-1 mb-5 text-sm text-muted-foreground">{intro}</p> : null}
          {children}
        </div>
      </main>
    </>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return children ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-destructive"
    >
      {children}
    </p>
  ) : null;
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

const chosenLanguage = () =>
  typeof document !== 'undefined' && document.cookie.includes(`${LANG_CHOSEN_COOKIE}=1`);

/**
 * Sign-in of a partner login (ADR-027), with Turnstile. It goes on to `next`, or to the
 * login's space; without a language chosen by the person, in the space's language.
 */
export function PartnerLoginForm({ siteKey }: { siteKey: string }) {
  const t = useTranslations('partner.login');
  const apiError = usePartnerApiError();
  const lang = usePartnerLang();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
  }, []);
  const submit = async () => {
    if (!token) {
      setProblem(apiError('CAPTCHA_FAILED'));
      return;
    }
    setBusy(true);
    setProblem(null);
    const { data, error } = await attempt(
      api.POST('/api/v1/auth/partner-login', { body: { email, password, turnstileToken: token } }),
    );
    if (!data) {
      setBusy(false);
      const { code } = failure(error);
      setProblem(code === 'INVALID_CREDENTIALS' ? t('wrong') : apiError(code));
      return;
    }
    sessionChanged();
    const next = safeNext(search.get('next'), '');
    if (next) {
      window.location.assign(partnerHref(lang, next));
      return;
    }
    const spaces = (await attempt(api.GET('/api/v1/partner-spaces'))).data ?? [];
    const [only] = spaces;
    if (spaces.length === 1 && only) {
      const target =
        !chosenLanguage() && isPartnerLang(only.defaultLocale) ? only.defaultLocale : lang;
      window.location.assign(partnerHref(target, `/spaces/${only.id}`));
      return;
    }
    window.location.assign(partnerHref(lang));
  };
  return (
    <form
      className="space-y-4"
      data-testid="partner-login-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {search.get('reset') === 'done' ? (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {t('resetDone')}
        </p>
      ) : null}
      <Problem>{problem}</Problem>
      <Labelled label={t('email')}>
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          className={input}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Labelled>
      <PasswordField
        label={t('password')}
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
      />
      <Turnstile siteKey={siteKey} onToken={onToken} label={t('captcha')} />
      <button
        type="submit"
        className={`${cta.primary} w-full`}
        disabled={busy || email === '' || password === ''}
        aria-busy={busy}
      >
        {busy ? t('submitting') : t('submit')}
      </button>
      <p className="text-sm">
        <NextLink
          href={partnerHref(lang, '/forgot-password')}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('forgot')}
        </NextLink>
      </p>
      <p className="border-t border-border pt-4 text-sm text-muted-foreground">
        {t('staff')}{' '}
        <a
          // Staff sign in on the site (their own sign-in), then come back here.
          href={`/${lang === 'pl' ? 'en' : lang}/login?next=${encodeURIComponent(partnerHref(lang))}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('staffLink')}
        </a>
      </p>
    </form>
  );
}

/** The reset email is asked for behind Turnstile; the answer is the same for every address. */
export function PartnerForgotForm({ siteKey }: { siteKey: string }) {
  const t = useTranslations('partner.forgot');
  const login = useTranslations('partner.login');
  const apiError = usePartnerApiError();
  const lang = usePartnerLang();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
  }, []);
  const submit = async () => {
    if (!token) {
      setProblem(apiError('CAPTCHA_FAILED'));
      return;
    }
    setBusy(true);
    setProblem(null);
    const { response, error } = await attempt(
      api.POST('/api/v1/auth/forgot-password', { body: { email, turnstileToken: token } }),
    );
    setBusy(false);
    if (response?.ok) {
      setSent(true);
      return;
    }
    setProblem(apiError(failure(error).code));
  };
  const back = (
    <NextLink
      href={partnerHref(lang, '/login')}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('back')}
    </NextLink>
  );
  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {t('sent')}
        </p>
        <p className="text-sm">{back}</p>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      data-testid="partner-forgot-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Problem>{problem}</Problem>
      <Labelled label={login('email')}>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className={input}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Labelled>
      <Turnstile siteKey={siteKey} onToken={onToken} label={login('captcha')} />
      <button type="submit" className={`${cta.primary} w-full`} disabled={busy || email === ''}>
        {t('submit')}
      </button>
      <p className="text-sm">{back}</p>
    </form>
  );
}

/** A new password from the link of the reset email. */
export function PartnerResetForm() {
  const t = useTranslations('partner.reset');
  const router = useRouter();
  const apiError = usePartnerApiError();
  const lang = usePartnerLang();
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const askAgain = (
    <NextLink
      href={partnerHref(lang, '/forgot-password')}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('askAgain')}
    </NextLink>
  );
  if (token === '') {
    return (
      <div className="space-y-4">
        <Problem>{t('missingToken')}</Problem>
        <p className="text-sm">{askAgain}</p>
      </div>
    );
  }
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const { response, error } = await attempt(
      api.POST('/api/v1/auth/reset-password', { body: { token, password } }),
    );
    setBusy(false);
    // Never kept once sent.
    setPassword('');
    if (response?.ok) {
      router.push(`${partnerHref(lang, '/login')}?reset=done`);
      return;
    }
    setProblem(apiError(failure(error).code));
  };
  return (
    <form
      className="space-y-4"
      data-testid="partner-reset-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Problem>{problem}</Problem>
      <PasswordField
        label={t('newPassword')}
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        meter={{ password, inputs: [] }}
      />
      <button
        type="submit"
        className={`${cta.primary} w-full`}
        disabled={busy || password.length < PASSWORD_MIN_LENGTH}
      >
        {t('submit')}
      </button>
      {problem ? <p className="text-sm">{askAgain}</p> : null}
    </form>
  );
}

/**
 * Change the password. `forced`: the first sign-in with a password set by a super admin;
 * nothing else can be done before (ADR-024).
 */
export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const t = useTranslations('partner.password');
  const apiError = usePartnerApiError();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    setDone(false);
    const { response, error } = await attempt(
      api.POST('/api/v1/me/password', {
        body: { currentPassword: current, newPassword: next },
      }),
    );
    setBusy(false);
    if (response?.ok) {
      if (forced) {
        window.location.reload();
        return;
      }
      setCurrent('');
      setNext('');
      setDone(true);
      return;
    }
    setProblem(apiError(failure(error).code));
  };
  return (
    <section
      className="rounded-xl border border-border bg-card p-6"
      aria-labelledby="password-title"
    >
      <h1 id="password-title" className="text-2xl font-bold tracking-tight">
        {t('title')}
      </h1>
      {forced ? (
        <p
          className="mt-2 mb-4 rounded-lg bg-brand-gold-soft p-3 text-sm"
          data-testid="forced-password"
        >
          {t('forced')}
        </p>
      ) : null}
      <form
        className="mt-4 space-y-4"
        data-testid="partner-password-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Problem>{problem}</Problem>
        {done ? (
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            {t('done')}
          </p>
        ) : null}
        <PasswordField
          label={t('current')}
          name="current-password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
          }}
        />
        <PasswordField
          label={t('new')}
          name="new-password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
          }}
          meter={{ password: next, inputs: [] }}
        />
        <button
          type="submit"
          className={cta.primary}
          disabled={busy || current === '' || next.length < PASSWORD_MIN_LENGTH}
        >
          {t('submit')}
        </button>
      </form>
    </section>
  );
}

/** The screens without a session, with their titles in the partner area's language. */
export function LoginScreen({ siteKey }: { siteKey: string }) {
  const t = useTranslations('partner.login');
  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      <PartnerLoginForm siteKey={siteKey} />
    </AuthCard>
  );
}

export function ForgotScreen({ siteKey }: { siteKey: string }) {
  const t = useTranslations('partner.forgot');
  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      <PartnerForgotForm siteKey={siteKey} />
    </AuthCard>
  );
}

export function ResetScreen() {
  const t = useTranslations('partner.reset');
  return (
    <AuthCard title={t('title')} intro={t('intro')}>
      <PartnerResetForm />
    </AuthCard>
  );
}
