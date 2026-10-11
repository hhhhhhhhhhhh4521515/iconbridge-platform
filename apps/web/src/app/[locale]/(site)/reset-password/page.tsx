import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { NewPasswordForm } from '@/components/auth/password-forms';
import { ClientMessages } from '@/components/layout/client-messages';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/reset-password'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('resetTitle'), robots: { index: false } };
}

export default async function ResetPasswordPage({ params }: PageProps<'/[locale]/reset-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <AuthCard title={t('resetTitle')} intro={t('resetIntro')}>
      <ClientMessages groups={['auth']}>
        {/* The form reads the address bar (token, next), which only exists in the browser. */}
        <Suspense>
          <NewPasswordForm />
        </Suspense>
      </ClientMessages>
    </AuthCard>
  );
}
