import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { env } from '@/lib/env';
import { ClientMessages } from '@/components/layout/client-messages';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/register'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('registerTitle'), robots: { index: false } };
}

export default async function RegisterPage({ params }: PageProps<'/[locale]/register'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <AuthCard title={t('registerTitle')} intro={t('registerIntro')} wide>
      <ClientMessages groups={['auth']}>
        {/* The form reads the address bar (token, next), which only exists in the browser. */}
        <Suspense>
          <RegisterForm siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
        </Suspense>
      </ClientMessages>
    </AuthCard>
  );
}
