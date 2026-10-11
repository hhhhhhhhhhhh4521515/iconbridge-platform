import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { CandidateDetail } from '@/components/admin/candidates';

export default async function Page({ params }: PageProps<'/[locale]/admin/candidates/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <CandidateDetail id={id} />
    </Suspense>
  );
}
