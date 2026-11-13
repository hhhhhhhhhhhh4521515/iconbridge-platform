import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { NewApplication } from '@/components/partner/applications';
import { PartnerFrame } from '@/components/partner/partner-ui';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/applications/new'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'application.newTitle') } : {};
}

export default async function Page({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/applications/new'>) {
  const { lang, spaceId } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <PartnerFrame lang={lang} spaceId={spaceId}>
        <NewApplication />
      </PartnerFrame>
    </Suspense>
  );
}
