import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { CandidatesList } from '@/components/admin/candidates';

export default async function Page({ params }: PageProps<'/[locale]/admin/candidates'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <CandidatesList />
    </Suspense>
  );
}
