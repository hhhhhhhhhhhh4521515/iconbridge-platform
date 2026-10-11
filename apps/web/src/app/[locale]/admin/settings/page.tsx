import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { SettingsManager } from '@/components/admin/settings';

export default async function Page({ params }: PageProps<'/[locale]/admin/settings'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <SettingsManager />
    </Suspense>
  );
}
