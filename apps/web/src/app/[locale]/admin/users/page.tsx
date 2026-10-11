import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { UsersManager } from '@/components/admin/users';

export default async function Page({ params }: PageProps<'/[locale]/admin/users'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <UsersManager />
    </Suspense>
  );
}
