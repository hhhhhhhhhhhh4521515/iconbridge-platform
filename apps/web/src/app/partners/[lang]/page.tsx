import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PartnerFrame } from '@/components/partner/partner-ui';
import { SpacesIndex } from '@/components/partner/jobs';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'spaces.title') } : {};
}

export default async function Page({ params }: PageProps<'/partners/[lang]'>) {
  const { lang } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <PartnerFrame lang={lang}>
        <SpacesIndex />
      </PartnerFrame>
    </Suspense>
  );
}
