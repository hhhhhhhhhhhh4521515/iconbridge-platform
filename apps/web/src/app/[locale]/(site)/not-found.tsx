import { Compass } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cta } from '@/lib/ui';

export default async function NotFound() {
  const [t, common] = await Promise.all([getTranslations('errors'), getTranslations('common')]);
  return (
    <div className="container-page flex flex-col items-center gap-4 py-24 text-center">
      <Compass className="size-12 text-brand-gold" aria-hidden />
      <p className="text-sm font-semibold tracking-widest text-muted-foreground">404</p>
      <h1 className="text-3xl font-bold tracking-tight">{t('notFoundTitle')}</h1>
      <p className="max-w-md text-muted-foreground">{t('notFoundText')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={cta.primary}>
          {common('backHome')}
        </Link>
        <Link href="/jobs" className={cta.outline}>
          {t('browseJobs')}
        </Link>
      </div>
    </div>
  );
}
