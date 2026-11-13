import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ChangePassword } from '@/components/partner/auth-forms';
import { PartnerFrame } from '@/components/partner/partner-ui';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/password'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'password.title') } : {};
}

export default async function Page({ params }: PageProps<'/partners/[lang]/password'>) {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <PartnerFrame lang={lang}>
        <div className="mx-auto max-w-md">
          <ChangePassword />
        </div>
      </PartnerFrame>
    </Suspense>
  );
}
