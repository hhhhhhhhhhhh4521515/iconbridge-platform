import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PartnerFrame } from '@/components/partner/partner-ui';
import { SpaceHistory } from '@/components/partner/activity';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/history'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'history.spaceTitle') } : {};
}

export default async function Page({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/history'>) {
  const { lang, spaceId } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <PartnerFrame lang={lang} spaceId={spaceId}>
        <SpaceHistory />
      </PartnerFrame>
    </Suspense>
  );
}
