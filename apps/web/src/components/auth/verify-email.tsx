'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loading } from '@/components/forms/fields';
import { Link } from '@/i18n/navigation';
import { api, attempt, hasSession } from '@/lib/client-api';
import { cta } from '@/lib/ui';

/** A token works once: the same link is never sent twice, even if the page renders twice. */
const verifications = new Map<string, Promise<boolean>>();

function verify(token: string): Promise<boolean> {
  let pending = verifications.get(token);
  if (!pending) {
    pending = attempt(api.POST('/api/v1/auth/verify-email', { body: { token } })).then(
      ({ response }) => Boolean(response?.ok),
    );
    verifications.set(token, pending);
  }
  return pending;
}

export function VerifyEmail() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'checking' | 'done' | 'failed'>(token ? 'checking' : 'failed');
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void verify(token).then((ok) => {
      if (!cancelled) {
        setSignedIn(hasSession());
        setState(ok ? 'done' : 'failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'checking') {
    return <Loading lines={2} />;
  }
  if (state === 'done') {
    return (
      <div className="space-y-4 text-center" data-testid="email-verified">
        <CircleCheck className="mx-auto size-12 text-emerald-600" aria-hidden />
        <p role="status" className="text-lg font-semibold">
          {t('verifiedTitle')}
        </p>
        <p className="text-muted-foreground">{t('verifiedText')}</p>
        <Link href={signedIn ? '/account' : '/login?next=/account'} className={cta.primary}>
          {signedIn ? t('goToAccount') : t('signIn')}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-center">
      <CircleX className="mx-auto size-12 text-destructive" aria-hidden />
      <p role="alert" className="text-lg font-semibold">
        {t('verifyFailedTitle')}
      </p>
      <p className="text-muted-foreground">{t('verifyFailedText')}</p>
      <Link href="/login?next=/account" className={cta.primary}>
        {t('signIn')}
      </Link>
    </div>
  );
}
