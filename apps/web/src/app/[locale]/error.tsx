'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Link } from '@/i18n/navigation';
import { cta } from '@/lib/ui';

/** Shown when a page fails to render. The error itself is logged, never displayed. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  const common = useTranslations('common');
  useEffect(() => {
    console.error(`Page error${error.digest ? ` (${error.digest})` : ''}`);
  }, [error]);
  return (
    <div className="container-page flex flex-col items-center gap-4 py-24 text-center">
      <TriangleAlert className="size-12 text-brand-gold" aria-hidden />
      <h1 className="text-3xl font-bold tracking-tight">{t('genericTitle')}</h1>
      <p className="max-w-md text-muted-foreground">{t('genericText')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={cta.primary}>
          {common('retry')}
        </button>
        <Link href="/" className={cta.outline}>
          {common('backHome')}
        </Link>
      </div>
    </div>
  );
}
