import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { CatalogManager } from '@/components/admin/catalog';

export default async function Page({ params }: PageProps<'/[locale]/admin/content/catalog'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <CatalogManager />
    </Suspense>
  );
}
