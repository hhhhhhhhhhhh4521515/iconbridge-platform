import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { ClientMessages } from '@/components/layout/client-messages';

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/login'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('loginTitle'), robots: { index: false } };
}

export default async function LoginPage({ params }: PageProps<'/[locale]/login'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <AuthCard title={t('loginTitle')} intro={t('loginIntro')}>
      <ClientMessages groups={['auth']}>
        {/* The form reads the address bar (token, next), which only exists in the browser. */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </ClientMessages>
    </AuthCard>
  );
}
