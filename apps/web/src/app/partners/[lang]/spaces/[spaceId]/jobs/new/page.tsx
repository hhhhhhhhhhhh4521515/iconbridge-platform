import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { NewJob } from '@/components/partner/jobs';
import { PartnerFrame } from '@/components/partner/partner-ui';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/jobs/new'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'job.newTitle') } : {};
}

export default async function Page({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/jobs/new'>) {
  const { lang, spaceId } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <PartnerFrame lang={lang} spaceId={spaceId}>
        <NewJob />
      </PartnerFrame>
    </Suspense>
  );
}
