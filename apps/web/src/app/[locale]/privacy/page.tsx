import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalPage } from '@/components/layout/legal-page';
import { pageMetadata } from '@/lib/seo';

const SECTIONS = ['who', 'what', 'why', 'share', 'keep', 'rights', 'cookies'] as const;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/privacy'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '/privacy',
    title: t('privacyTitle'),
    description: t('privacyTitle'),
    siteName: t('siteName'),
  });
}

export default async function PrivacyPage({ params }: PageProps<'/[locale]/privacy'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage document="privacy" sections={SECTIONS} />;
}
