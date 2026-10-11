import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { SettingsPage } from '@/components/account/settings';

export default async function Page({ params }: PageProps<'/[locale]/account/settings'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
