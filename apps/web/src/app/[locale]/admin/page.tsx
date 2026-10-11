import { setRequestLocale } from 'next-intl/server';
import { Dashboard } from '@/components/admin/dashboard';

export default async function Page({ params }: PageProps<'/[locale]/admin'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Dashboard />;
}
