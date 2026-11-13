import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ResetScreen } from '@/components/partner/auth-forms';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/reset-password'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'reset.title') } : {};
}

export default async function Page({ params }: PageProps<'/partners/[lang]/reset-password'>) {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <ResetScreen />
    </Suspense>
  );
}
