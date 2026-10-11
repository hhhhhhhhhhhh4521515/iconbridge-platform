import { Construction } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { card, cta } from '@/lib/ui';

/** Stands in for the candidate area (sign-in, registration, applications) until it is built. */
export async function ComingSoon({ title }: { title: string }) {
  const [t, errors] = await Promise.all([getTranslations('account'), getTranslations('errors')]);
  return (
    <div className="container-page py-16">
      <div className={`${card} mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center`}>
        <Construction className="size-10 text-brand-gold" aria-hidden />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{t('comingText')}</p>
        <Link href="/jobs" className={cta.primary}>
          {errors('browseJobs')}
        </Link>
      </div>
    </div>
  );
}
