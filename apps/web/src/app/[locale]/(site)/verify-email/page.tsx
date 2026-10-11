import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { VerifyEmail } from '@/components/auth/verify-email';
import { ClientMessages } from '@/components/layout/client-messages';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/verify-email'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('verifyTitle'), robots: { index: false } };
}

export default async function VerifyEmailPage({ params }: PageProps<'/[locale]/verify-email'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <AuthCard title={t('verifyTitle')}>
      <ClientMessages groups={['auth']}>
        {/* The form reads the address bar (token, next), which only exists in the browser. */}
        <Suspense>
          <VerifyEmail />
        </Suspense>
      </ClientMessages>
    </AuthCard>
  );
}
