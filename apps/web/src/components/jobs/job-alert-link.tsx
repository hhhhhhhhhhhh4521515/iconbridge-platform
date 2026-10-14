'use client';

import { CircleCheck, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loading } from '@/components/forms/fields';
import { Link } from '@/i18n/navigation';
import { api, attempt } from '@/lib/client-api';
import { cta } from '@/lib/ui';

type Action = 'confirm' | 'unsubscribe';

/** A link is used once, even if the page renders twice. */
const calls = new Map<string, Promise<boolean>>();

function run(action: Action, token: string): Promise<boolean> {
  const key = `${action}:${token}`;
  let pending = calls.get(key);
  if (!pending) {
    pending = attempt(api.POST(`/api/v1/job-alerts/${action}`, { body: { token } })).then(
      ({ response }) => Boolean(response?.ok),
    );
    calls.set(key, pending);
  }
  return pending;
}

/** The page behind the links of the job alert emails: "confirm my alert" and "unsubscribe". */
export function JobAlertLink({ action }: { action: Action }) {
  const t = useTranslations(`alert.${action}`);
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'checking' | 'done' | 'failed'>(token ? 'checking' : 'failed');

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    void run(action, token).then((ok) => {
      if (!cancelled) {
        setState(ok ? 'done' : 'failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [action, token]);

  if (state === 'checking') {
    return <Loading lines={2} />;
  }
  const done = state === 'done';
  return (
    <div className="space-y-4 text-center" data-testid={`job-alert-${action}`} data-state={state}>
      {done ? (
        <CircleCheck className="mx-auto size-12 text-emerald-600" aria-hidden />
      ) : (
        <CircleX className="mx-auto size-12 text-destructive" aria-hidden />
      )}
      <p role={done ? 'status' : 'alert'} className="text-lg font-semibold">
        {done ? t('doneTitle') : t('failedTitle')}
      </p>
      <p className="text-muted-foreground">{done ? t('doneText') : t('failedText')}</p>
      <Link href="/jobs" className={cta.primary}>
        {t('jobs')}
      </Link>
    </div>
  );
}
