import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { MessagesInbox } from '@/components/admin/messages';

export default async function Page({ params }: PageProps<'/[locale]/admin/messages'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <MessagesInbox />
    </Suspense>
  );
}
