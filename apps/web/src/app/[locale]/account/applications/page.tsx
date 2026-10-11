import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { ApplicationList } from '@/components/account/applications';

export default async function Page({ params }: PageProps<'/[locale]/account/applications'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ApplicationList />
    </Suspense>
  );
}
