import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { PartnerSpacesList } from '@/components/admin/partner-spaces';

export default async function Page({ params }: PageProps<'/[locale]/admin/partner-spaces'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <PartnerSpacesList />
    </Suspense>
  );
}
