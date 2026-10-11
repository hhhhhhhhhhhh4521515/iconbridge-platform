'use client';

import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Cloudflare's public test keys. */
const TEST_KEY = /^[123]x0{10,}/;
/** Sent with a test key: the API, configured with the matching test secret, accepts it. */
const TEST_TOKEN = 'turnstile-test-key';

let loading: Promise<void> | undefined;
function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Turnstile could not be loaded'));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile. Calls `onToken` with a token when the check passes and
 * with null when it expires. With a test site key (local development, automated
 * tests) no widget is loaded and a fixed token is used.
 */
export function Turnstile({
  siteKey,
  onToken,
  label,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const isTest = TEST_KEY.test(siteKey);

  useEffect(() => {
    if (isTest) {
      onToken(TEST_TOKEN);
      return;
    }
    let widget: string | undefined;
    let cancelled = false;
    void loadScript()
      .then(() => {
        const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
        if (cancelled || !api || !container.current) {
          return;
        }
        widget = api.render(container.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            onToken(token);
          },
          'expired-callback': () => {
            onToken(null);
          },
          'error-callback': () => {
            onToken(null);
          },
        });
      })
      .catch(() => {
        onToken(null);
      });
    return () => {
      cancelled = true;
      if (widget) {
        (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(widget);
      }
    };
  }, [isTest, onToken, siteKey]);

  return isTest ? null : <div ref={container} aria-label={label} className="min-h-16" />;
}
