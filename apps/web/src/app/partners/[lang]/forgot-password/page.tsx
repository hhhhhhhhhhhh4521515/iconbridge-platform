import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ForgotScreen } from '@/components/partner/auth-forms';
import { env } from '@/lib/env';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/forgot-password'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'forgot.title') } : {};
}

export default async function Page({ params }: PageProps<'/partners/[lang]/forgot-password'>) {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <ForgotScreen siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
    </Suspense>
  );
}
