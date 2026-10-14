import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { ClientMessages } from '@/components/layout/client-messages';
import { JobAlertLink } from '@/components/jobs/job-alert-link';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/job-alerts/confirm'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'alert.confirm' });
  return { title: t('title'), robots: { index: false } };
}

/** Opened from the link of a job alert email. */
export default async function JobAlertConfirmPage({
  params,
}: PageProps<'/[locale]/job-alerts/confirm'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('alert.confirm');
  return (
    <AuthCard title={t('title')}>
      <ClientMessages groups={['alert']}>
        {/* The token is in the address bar, which only exists in the browser. */}
        <Suspense>
          <JobAlertLink action="confirm" />
        </Suspense>
      </ClientMessages>
    </AuthCard>
  );
}
