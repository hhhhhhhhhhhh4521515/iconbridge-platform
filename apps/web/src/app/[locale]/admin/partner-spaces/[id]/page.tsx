import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { PartnerSpaceEditor } from '@/components/admin/partner-space';

export default async function Page({ params }: PageProps<'/[locale]/admin/partner-spaces/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <PartnerSpaceEditor id={id} />
    </Suspense>
  );
}
