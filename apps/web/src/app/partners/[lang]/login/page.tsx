import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { LoginScreen } from '@/components/partner/auth-forms';
import { env } from '@/lib/env';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/login'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'login.title') } : {};
}

export default async function Page({ params }: PageProps<'/partners/[lang]/login'>) {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <LoginScreen siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
    </Suspense>
  );
}
