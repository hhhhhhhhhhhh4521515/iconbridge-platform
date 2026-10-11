import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { JobForm } from '@/components/admin/job-form';

export default async function Page({ params }: PageProps<'/[locale]/admin/jobs/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <JobForm id={id} />
    </Suspense>
  );
}
