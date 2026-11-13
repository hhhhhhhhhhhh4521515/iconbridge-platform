import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { JobDetail } from '@/components/partner/jobs';
import { PartnerFrame } from '@/components/partner/partner-ui';
import { isPartnerLang, partnerText } from '@/lib/partner-locale';

export async function generateMetadata({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/jobs/[jobId]'>): Promise<Metadata> {
  const { lang } = await params;
  return isPartnerLang(lang) ? { title: await partnerText(lang, 'home.title') } : {};
}

export default async function Page({
  params,
}: PageProps<'/partners/[lang]/spaces/[spaceId]/jobs/[jobId]'>) {
  const { lang, spaceId, jobId } = await params;
  if (!isPartnerLang(lang)) {
    notFound();
  }
  return (
    <Suspense>
      <PartnerFrame lang={lang} spaceId={spaceId}>
        <JobDetail jobId={jobId} />
      </PartnerFrame>
    </Suspense>
  );
}
