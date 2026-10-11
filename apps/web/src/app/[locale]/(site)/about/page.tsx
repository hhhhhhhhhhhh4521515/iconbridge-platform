import { HandCoins, HeartHandshake, Scale } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { pageMetadata } from '@/lib/seo';
import { card, cta } from '@/lib/ui';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/about'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '/about',
    title: t('aboutTitle'),
    description: t('aboutDescription'),
    siteName: t('siteName'),
  });
}

export default async function AboutPage({ params }: PageProps<'/[locale]/about'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('about');
  const values = [
    ['honesty', Scale],
    ['free', HandCoins],
    ['support', HeartHandshake],
  ] as const;
  return (
    <div className="container-page py-10">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{t('intro')}</p>
          <h2 className="mt-8 text-xl font-semibold">{t('missionTitle')}</h2>
          <p className="mt-2 text-base">{t('mission')}</p>
          <Link href="/jobs" className={`${cta.primary} mt-6`}>
            {t('cta')}
          </Link>
        </div>
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-brand-navy">
          <Image
            src="/brand/hero-malta-1.webp"
            alt=""
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
      <section aria-labelledby="values-title" className="mt-14">
        <h2 id="values-title" className="mb-6 text-2xl font-bold tracking-tight">
          {t('valuesTitle')}
        </h2>
        <ul className="grid gap-5 md:grid-cols-3">
          {values.map(([key, Icon]) => (
            <li key={key} className={`${card} p-6`}>
              <Icon className="size-8 text-brand-gold" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold">{t(`values.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`values.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
