import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { Dashboard } from '@/components/account/dashboard';

export default async function Page({ params }: PageProps<'/[locale]/account'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
