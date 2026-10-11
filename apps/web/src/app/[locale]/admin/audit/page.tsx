import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuditLog } from '@/components/admin/settings';

export default async function Page({ params }: PageProps<'/[locale]/admin/audit'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
