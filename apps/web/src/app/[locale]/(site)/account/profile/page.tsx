import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { ProfileWizard } from '@/components/account/profile-wizard';

export default async function Page({ params }: PageProps<'/[locale]/account/profile'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ProfileWizard />
    </Suspense>
  );
}
