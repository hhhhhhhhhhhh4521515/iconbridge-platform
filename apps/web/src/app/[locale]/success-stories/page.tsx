import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StoriesExplorer } from '@/components/home/stories-explorer';
import { api } from '@/lib/api';
import { pick } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/success-stories'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '/success-stories',
    title: t('storiesTitle'),
    description: t('storiesDescription'),
    siteName: t('siteName'),
  });
}

export default async function SuccessStoriesPage({
  params,
}: PageProps<'/[locale]/success-stories'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, stories, destinations] = await Promise.all([
    getTranslations('stories'),
    api.successStories(),
    api.destinations(),
  ]);
  return (
    <div className="container-page py-10">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
      </header>
      <StoriesExplorer
        stories={stories}
        locale={locale}
        destinations={destinations.map((destination) => ({
          code: destination.code,
          name: pick(destination.name, locale),
        }))}
        labels={{
          badge: t('badge'),
          visaDate: t.raw('visaDate') as string,
          photoAlt: t.raw('photoAlt') as string,
          filter: t('filterLabel'),
          all: t('all'),
          empty: t('empty'),
        }}
      />
    </div>
  );
}
