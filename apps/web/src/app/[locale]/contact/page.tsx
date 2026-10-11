import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ContactForm } from '@/components/forms/contact-form';
import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { pageMetadata } from '@/lib/seo';
import { card } from '@/lib/ui';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/contact'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '/contact',
    title: t('contactTitle'),
    description: t('contactDescription'),
    siteName: t('siteName'),
  });
}

export default async function ContactPage({ params }: PageProps<'/[locale]/contact'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, top, common, info] = await Promise.all([
    getTranslations('contact'),
    getTranslations('topbar'),
    getTranslations('common'),
    api.siteInfo(),
  ]);
  const details = [
    info?.CONTACT_EMAIL && {
      icon: Mail,
      label: top('email'),
      value: info.CONTACT_EMAIL,
      href: `mailto:${info.CONTACT_EMAIL}`,
    },
    info?.CONTACT_PHONE && {
      icon: Phone,
      label: top('phone'),
      value: info.CONTACT_PHONE,
      href: `tel:${info.CONTACT_PHONE.replace(/[^\d+]/g, '')}`,
    },
    info?.CONTACT_WHATSAPP && {
      icon: MessageCircle,
      label: top('whatsapp'),
      value: info.CONTACT_WHATSAPP,
      href: `https://wa.me/${info.CONTACT_WHATSAPP.replace(/\D/g, '')}`,
    },
    info?.CONTACT_ADDRESS && {
      icon: MapPin,
      label: t('address'),
      value: info.CONTACT_ADDRESS,
      href: null,
    },
  ].filter((item) => item !== '' && item !== undefined && item !== null);

  return (
    <div className="container-page py-10">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('intro')}</p>
      </header>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className={`${card} p-6`}>
          <ContactForm
            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
            labels={{
              name: t('form.name'),
              email: t('form.email'),
              phone: t('form.phone'),
              subject: t('form.subject'),
              message: t('form.message'),
              messageHint: t('form.messageHint'),
              submit: t('form.submit'),
              sending: t('form.sending'),
              success: t('form.success'),
              error: t('form.error'),
              captcha: t('form.captcha'),
            }}
          />
        </div>
        <aside className="space-y-5">
          <div className={`${card} p-6`}>
            <h2 className="mb-4 text-lg font-semibold">{t('detailsTitle')}</h2>
            <dl className="space-y-4">
              {details.map((item) => (
                <div key={item.label}>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <item.icon className="size-5 shrink-0" aria-hidden />
                    {item.label}
                  </dt>
                  <dd className="ps-7 text-sm font-medium">
                    {item.href ? (
                      <a href={item.href} className="underline-offset-4 hover:underline" dir="ltr">
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="rounded-2xl border-2 border-brand-gold bg-brand-gold-soft p-4 text-sm font-medium text-brand-navy dark:text-foreground">
            {common('neverPay')}
          </p>
        </aside>
      </div>
    </div>
  );
}
