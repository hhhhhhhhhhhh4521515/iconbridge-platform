import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { SlidesManager } from '@/components/admin/slides';

export default async function Page({ params }: PageProps<'/[locale]/admin/content/slides'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <SlidesManager />
    </Suspense>
  );
}
