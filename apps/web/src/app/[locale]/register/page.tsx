import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ComingSoon } from '@/components/layout/coming-soon';

export const metadata: Metadata = { robots: { index: false } };

export default async function RegisterPage({ params }: PageProps<'/[locale]/register'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return <ComingSoon title={t('registerTitle')} />;
}
