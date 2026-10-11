import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageTitle } from '@/components/account/account-shell';
import { DocumentsManager, PassportWarning } from '@/components/account/documents-manager';

export default async function Page({ params }: PageProps<'/[locale]/account/documents'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account.documents');
  return (
    <>
      <PageTitle title={t('title')} intro={t('intro')} />
      <PassportWarning />
      <DocumentsManager />
    </>
  );
}
