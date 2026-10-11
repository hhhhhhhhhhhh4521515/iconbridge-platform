import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalPage } from '@/components/layout/legal-page';
import { pageMetadata } from '@/lib/seo';

const SECTIONS = [
  'service',
  'free',
  'account',
  'applications',
  'content',
  'liability',
  'law',
] as const;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/terms'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '/terms',
    title: t('termsTitle'),
    description: t('termsTitle'),
    siteName: t('siteName'),
  });
}

export default async function TermsPage({ params }: PageProps<'/[locale]/terms'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage document="terms" sections={SECTIONS} />;
}
