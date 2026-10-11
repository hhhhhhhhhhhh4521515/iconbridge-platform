import {
  ArrowLeft,
  Bed,
  Bus,
  CalendarClock,
  Clock,
  FileSignature,
  Languages,
  MapPin,
  Soup,
  Users,
  Wallet,
} from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ApplyButton, DeadlineCountdown, ShareButtons } from '@/components/jobs/job-actions';
import { salaryText } from '@/components/jobs/job-card';
import { MediaImage } from '@/components/ui/media-image';
import { plainText, RichText } from '@/components/ui/rich-text';
import { Link } from '@/i18n/navigation';
import { api, type PublicJob } from '@/lib/api';
import { DESTINATION_IMAGES, languageName, pick } from '@/lib/format';
import { localizedUrl, pageMetadata } from '@/lib/seo';
import { card } from '@/lib/ui';

export const revalidate = 60;

const summarize = (text: string, max = 160) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/jobs/[slug]'>): Promise<Metadata> {
  const { locale, slug } = await params;
  const [job, t] = await Promise.all([
    api.job(slug),
    getTranslations({ locale, namespace: 'meta' }),
  ]);
  if (!job) {
    return { title: t('jobsTitle'), robots: { index: false } };
  }
  return pageMetadata({
    locale,
    path: `/jobs/${job.slug}`,
    title: `${job.title} - ${pick(job.destination.name, locale)}`,
    description: summarize(plainText(job.description)),
    siteName: t('siteName'),
  });
}

const UNIT_TEXT = { HOUR: 'HOUR', DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH', YEAR: 'YEAR' } as const;
const COUNTRY: Record<string, string> = { MALTA: 'MT', POLAND: 'PL' };

/** schema.org JobPosting, read by search engines to show the offer in job results. */
function jobPostingJsonLd(job: PublicJob, locale: string) {
  const country = COUNTRY[job.destination.code];
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: plainText(job.description),
    identifier: { '@type': 'PropertyValue', name: 'IconBridge Jobs', value: job.id },
    datePosted: job.publishedAt ?? undefined,
    validThrough: job.deadline,
    employmentType: 'FULL_TIME',
    directApply: true,
    url: localizedUrl(locale, `/jobs/${job.slug}`),
    totalJobOpenings: job.positions,
    hiringOrganization: {
      '@type': 'Organization',
      name: job.employerName ?? 'IconBridge Recruitment Ltd',
    },
    jobLocation: {
      '@type': 'Place',
      name: pick(job.destination.name, 'en'),
      ...(country ? { address: { '@type': 'PostalAddress', addressCountry: country } } : {}),
    },
    ...(job.salaryCurrency && (job.salaryMin !== null || job.salaryMax !== null) && job.salaryPeriod
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: job.salaryCurrency,
            value: {
              '@type': 'QuantitativeValue',
              minValue: job.salaryMin ?? job.salaryMax,
              maxValue: job.salaryMax ?? job.salaryMin,
              unitText: UNIT_TEXT[job.salaryPeriod],
            },
          },
        }
      : {}),
  };
}

export default async function JobPage({ params }: PageProps<'/[locale]/jobs/[slug]'>) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const job = await api.job(slug);
  if (!job) {
    notFound();
  }
  const [t, format, salary] = await Promise.all([
    getTranslations('jobs'),
    getFormatter(),
    salaryText(job, locale),
  ]);
  const destination = pick(job.destination.name, locale);
  const image = job.coverImageUrl ?? DESTINATION_IMAGES[job.destination.code];
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'long' });

  const benefits = [
    job.accommodationProvided && { icon: Bed, label: t('detail.accommodation') },
    job.transportProvided && { icon: Bus, label: t('detail.transport') },
    job.mealsProvided && { icon: Soup, label: t('detail.meals') },
  ].filter((benefit) => benefit !== false);

  const facts = [
    { icon: Wallet, label: t('detail.salary'), value: salary ?? t('salaryUnknown') },
    job.contractDurationMonths !== null && {
      icon: FileSignature,
      label: t('detail.contract'),
      value: t('detail.contractMonths', { count: job.contractDurationMonths }),
    },
    job.workingHours && { icon: Clock, label: t('detail.hours'), value: job.workingHours },
    { icon: Users, label: t('detail.positions'), value: String(job.positions) },
    job.requiredLanguages.length > 0 && {
      icon: Languages,
      label: t('detail.languages'),
      value: job.requiredLanguages.map((code) => languageName(code, locale)).join(', '),
    },
    job.employerName && { icon: MapPin, label: t('detail.employer'), value: job.employerName },
  ].filter((fact) => fact !== false && fact !== null && fact !== '');

  return (
    <article className="container-page py-8">
      <script
        type="application/ld+json"
        nonce={nonce}
        // JSON-LD must be inline; "<" is escaped so the text cannot close the script element.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jobPostingJsonLd(job, locale)).replace(/</g, '\\u003c'),
        }}
      />
      <Link
        href="/jobs"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t('detail.back')}
      </Link>

      <header className="relative mt-2 overflow-hidden rounded-2xl bg-brand-navy text-white">
        {image ? (
          <MediaImage
            src={image}
            alt=""
            fill
            priority
            sizes="(min-width: 1216px) 1216px, 100vw"
            className="object-cover opacity-40"
          />
        ) : null}
        <div className="relative p-6 sm:p-10">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1">
              <MapPin className="size-4" aria-hidden />
              {destination}
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1">
              {pick(job.category.name, locale)}
            </span>
            {job.featured ? (
              <span className="rounded-full bg-brand-gold px-3 py-1 text-brand-navy">
                {t('card.featured')}
              </span>
            ) : null}
          </p>
          <h1 className="mt-4 text-3xl leading-tight font-bold text-balance sm:text-4xl">
            {job.title}
          </h1>
          <p className="mt-2 text-lg text-white/90">{salary ?? t('salaryUnknown')}</p>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <section aria-labelledby="description-title">
            <h2 id="description-title" className="mb-3 text-xl font-semibold">
              {t('detail.description')}
            </h2>
            <RichText text={job.description} />
          </section>
          {job.requirements ? (
            <section aria-labelledby="requirements-title">
              <h2 id="requirements-title" className="mb-3 text-xl font-semibold">
                {t('detail.requirements')}
              </h2>
              <RichText text={job.requirements} />
            </section>
          ) : null}
          {benefits.length > 0 || job.benefits ? (
            <section aria-labelledby="benefits-title">
              <h2 id="benefits-title" className="mb-3 text-xl font-semibold">
                {t('detail.benefits')}
              </h2>
              {benefits.length > 0 ? (
                <ul className="mb-3 flex flex-wrap gap-3">
                  {benefits.map((benefit) => (
                    <li
                      key={benefit.label}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-gold-soft px-4 py-2.5 text-sm font-medium text-brand-navy dark:text-foreground"
                    >
                      <benefit.icon className="size-5" aria-hidden />
                      {benefit.label}
                    </li>
                  ))}
                </ul>
              ) : null}
              {job.benefits ? <RichText text={job.benefits} /> : null}
            </section>
          ) : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className={`${card} p-5`}>
            <div className="mb-4 flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm text-muted-foreground">{t('detail.deadline')}</p>
                <p className="font-semibold">{date(job.deadline)}</p>
                <DeadlineCountdown
                  deadline={job.deadline}
                  locale={locale}
                  closedLabel={t('detail.closed')}
                />
              </div>
            </div>
            <ApplyButton
              jobId={job.id}
              slug={job.slug}
              locale={locale}
              labels={{
                apply: t('apply.apply'),
                checking: t('apply.checking'),
                login: t('apply.login'),
                register: t('apply.register'),
                verifyEmail: t('apply.verifyEmail'),
                completeProfile: t('apply.completeProfile'),
                passportExpired: t('apply.passportExpired'),
                cooldown: t.raw('apply.cooldown') as string,
                viewApplication: t('apply.viewApplication'),
                notOpen: t('apply.notOpen'),
                maxActive: t('apply.maxActive'),
                staff: t('apply.staff'),
              }}
            />
          </div>

          <div className={`${card} p-5`}>
            <h2 className="mb-3 text-lg font-semibold">{t('detail.summary')}</h2>
            <dl className="space-y-3">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <fact.icon className="size-5 shrink-0" aria-hidden />
                    {fact.label}
                  </dt>
                  <dd className="ps-7 text-sm font-medium">{fact.value}</dd>
                </div>
              ))}
              {job.publishedAt ? (
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarClock className="size-5 shrink-0" aria-hidden />
                    {t('detail.published')}
                  </dt>
                  <dd className="ps-7 text-sm font-medium">{date(job.publishedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className={`${card} p-5`}>
            <ShareButtons
              url={localizedUrl(locale, `/jobs/${job.slug}`)}
              title={`${job.title} - ${destination}`}
              labels={{
                title: t('detail.share'),
                copy: t('detail.copyLink'),
                copied: t('detail.copied'),
                shareOn: t.raw('detail.shareOn') as string,
                email: t('detail.shareByEmail'),
              }}
            />
          </div>
        </aside>
      </div>
    </article>
  );
}
