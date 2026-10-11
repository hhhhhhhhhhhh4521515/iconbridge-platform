'use client';

import { createApiClient } from '@iconbridge/shared/api-client';
import { useLocale } from 'next-intl';
import { useCallback, useState, type FormEvent } from 'react';
import { cta, field } from '@/lib/ui';
import { Turnstile } from './turnstile';

export interface AlertLabels {
  email: string;
  destination: string;
  allDestinations: string;
  submit: string;
  sending: string;
  success: string;
  error: string;
  captcha: string;
}

const api = createApiClient();

export function JobAlertForm({
  destinations,
  labels,
  siteKey,
}: {
  destinations: { code: string; name: string }[];
  labels: AlertLabels;
  siteKey: string;
}) {
  const locale = useLocale() as 'fr' | 'en' | 'ar';
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const onToken = useCallback((value: string | null) => {
    setToken(value);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const destination = String(data.get('destination') ?? '');
    setState('sending');
    const { response } = await api
      .POST('/api/v1/job-alerts', {
        body: {
          email: String(data.get('email') ?? ''),
          destinations: destination ? [destination] : [],
          categories: [],
          locale,
          turnstileToken: token ?? '',
        },
      })
      .catch(() => ({ response: undefined }));
    setState(response?.ok ? 'success' : 'error');
  };

  if (state === 'success') {
    return (
      <p role="status" className="rounded-lg bg-white/10 p-4 text-base font-medium text-white">
        {labels.success}
      </p>
    );
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
    >
      <div>
        <label htmlFor="alert-email" className="mb-1 block text-sm font-medium text-white">
          {labels.email}
        </label>
        <input
          id="alert-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={field}
        />
      </div>
      <div>
        <label htmlFor="alert-destination" className="mb-1 block text-sm font-medium text-white">
          {labels.destination}
        </label>
        <select id="alert-destination" name="destination" className={field} defaultValue="">
          <option value="">{labels.allDestinations}</option>
          {destinations.map((destination) => (
            <option key={destination.code} value={destination.code}>
              {destination.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          className={`${cta.gold} w-full`}
          disabled={state === 'sending' || !token}
        >
          {state === 'sending' ? labels.sending : labels.submit}
        </button>
      </div>
      <div className="sm:col-span-3">
        <Turnstile siteKey={siteKey} onToken={onToken} label={labels.captcha} />
        {state === 'error' ? (
          <p role="alert" className="mt-2 text-sm font-medium text-white">
            {labels.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
