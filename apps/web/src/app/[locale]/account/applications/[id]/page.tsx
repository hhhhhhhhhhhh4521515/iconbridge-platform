import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { ApplicationDetail } from '@/components/account/applications';

export default async function Page({ params }: PageProps<'/[locale]/account/applications/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ApplicationDetail id={id} />
    </Suspense>
  );
}
