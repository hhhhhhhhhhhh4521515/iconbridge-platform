import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { JobsList } from '@/components/admin/jobs-list';

export default async function Page({ params }: PageProps<'/[locale]/admin/jobs'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <JobsList />
    </Suspense>
  );
}
