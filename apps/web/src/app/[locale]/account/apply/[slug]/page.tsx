import { setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { ApplyFlow } from '@/components/account/apply-flow';
import { env } from '@/lib/env';

export default async function Page({ params }: PageProps<'/[locale]/account/apply/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <ApplyFlow slug={slug} siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
    </Suspense>
  );
}
