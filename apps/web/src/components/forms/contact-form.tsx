'use client';

import { createApiClient } from '@iconbridge/shared/api-client';
import { useCallback, useState, type FormEvent } from 'react';
import { cta, field } from '@/lib/ui';
import { Turnstile } from './turnstile';

export interface ContactLabels {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  messageHint: string;
  submit: string;
  sending: string;
  success: string;
  error: string;
  captcha: string;
}

const api = createApiClient();

export function ContactForm({ labels, siteKey }: { labels: ContactLabels; siteKey: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const onToken = useCallback((value: string | null) => {
    setToken(value);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    setState('sending');
    const { response } = await api
      .POST('/api/v1/contact', {
        body: {
          name: text('name'),
          email: text('email'),
          phone: text('phone') || null,
          subject: text('subject') || null,
          message: text('message'),
          turnstileToken: token ?? '',
        },
      })
      .catch(() => ({ response: undefined }));
    setState(response?.ok ? 'success' : 'error');
  };

  if (state === 'success') {
    return (
      <p
        role="status"
        className="rounded-xl bg-secondary p-5 text-base font-medium text-secondary-foreground"
      >
        {labels.success}
      </p>
    );
  }
  const label = 'mb-1 block text-sm font-medium';
  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="c-name" className={label}>
          {labels.name}
        </label>
        <input
          id="c-name"
          name="name"
          required
          maxLength={150}
          autoComplete="name"
          className={field}
        />
      </div>
      <div>
        <label htmlFor="c-email" className={label}>
          {labels.email}
        </label>
        <input
          id="c-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={field}
        />
      </div>
      <div>
        <label htmlFor="c-phone" className={label}>
          {labels.phone}
        </label>
        <input
          id="c-phone"
          name="phone"
          type="tel"
          maxLength={30}
          autoComplete="tel"
          className={field}
          dir="ltr"
        />
      </div>
      <div>
        <label htmlFor="c-subject" className={label}>
          {labels.subject}
        </label>
        <input id="c-subject" name="subject" maxLength={200} className={field} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="c-message" className={label}>
          {labels.message}
        </label>
        <textarea
          id="c-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          aria-describedby="c-message-hint"
          className={field}
        />
        <p id="c-message-hint" className="mt-1 text-sm text-muted-foreground">
          {labels.messageHint}
        </p>
      </div>
      <div className="sm:col-span-2">
        <Turnstile siteKey={siteKey} onToken={onToken} label={labels.captcha} />
        {state === 'error' ? (
          <p role="alert" className="mb-3 text-sm font-medium text-destructive">
            {labels.error}
          </p>
        ) : null}
        <button type="submit" className={cta.primary} disabled={state === 'sending' || !token}>
          {state === 'sending' ? labels.sending : labels.submit}
        </button>
      </div>
    </form>
  );
}
