import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { StoriesManager } from '@/components/admin/stories';

export default async function Page({ params }: PageProps<'/[locale]/admin/content/stories'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <StoriesManager />
    </Suspense>
  );
}
