import { setRequestLocale } from 'next-intl/server';
import { AdminPassword } from '@/components/admin/password';

export default async function Page({ params }: PageProps<'/[locale]/admin/password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AdminPassword />;
}
