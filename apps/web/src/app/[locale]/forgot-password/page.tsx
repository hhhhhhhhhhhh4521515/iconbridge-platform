import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/password-forms';
import { ClientMessages } from '@/components/layout/client-messages';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/forgot-password'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('forgotTitle'), robots: { index: false } };
}

export default async function ForgotPasswordPage({
  params,
}: PageProps<'/[locale]/forgot-password'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <AuthCard title={t('forgotTitle')} intro={t('forgotIntro')}>
      <ClientMessages groups={['auth']}>
        {/* The form reads the address bar (token, next), which only exists in the browser. */}
        <Suspense>
          <ForgotPasswordForm />
        </Suspense>
      </ClientMessages>
    </AuthCard>
  );
}
