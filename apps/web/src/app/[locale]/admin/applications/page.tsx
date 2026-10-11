import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { Applications } from '@/components/admin/applications';

export default async function Page({ params }: PageProps<'/[locale]/admin/applications'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <Applications />
    </Suspense>
  );
}
