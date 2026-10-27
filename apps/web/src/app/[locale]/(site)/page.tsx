import {
  Building2,
  Anchor,
  BadgeCheck,
  Briefcase,
  ClipboardList,
  Handshake,
  HeartHandshake,
  MessagesSquare,
  Plane,
  Search,
  ShieldAlert,
  Stamp,
  UserRoundPlus,
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobAlertForm } from '@/components/forms/job-alert-form';
import { Faq } from '@/components/home/faq';
import { HeroSlider, type HeroSlide } from '@/components/home/hero-slider';
import { StoryCard } from '@/components/home/story-card';
import { JobCard } from '@/components/jobs/job-card';
import { Counter } from '@/components/ui/counter';
import { DestinationMark } from '@/components/ui/destination-mark';
import { Reveal } from '@/components/ui/reveal';
import { SnapCarousel } from '@/components/ui/snap-carousel';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { CATEGORY_ICONS } from '@/lib/category-icons';
import { env } from '@/lib/env';
import { DESTINATION_IMAGES, pick } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { card, cta, field } from '@/lib/ui';

/** Public data: rebuilt in the background at most once a minute. */
export const revalidate = 60;

const STEPS = [
  { key: 'profile', icon: UserRoundPlus },
  { key: 'apply', icon: ClipboardList },
  { key: 'interview', icon: MessagesSquare },
  { key: 'visa', icon: Stamp },
  { key: 'travel', icon: Plane },
] as const;

const FAQ_KEYS = ['cost', 'documents', 'time', 'status', 'reapply', 'data'] as const;

export async function generateMetadata({ params }: PageProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    ...pageMetadata({
      locale,
      title: t('homeTitle'),
      description: t('homeDescription'),
      siteName: t('siteName'),
    }),
    title: { absolute: `${t('homeTitle')} | ${t('siteName')}` },
  };
}

function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-8 max-w-2xl">
      <h2 id={id} className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
        {title}
      </h2>
      {subtitle ? <p className="mt-2 text-base text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, slides, stats, destinations, categories, featured, latest, stories] = await Promise.all(
    [
      getTranslations(),
      api.homeSlides(),
      api.stats(),
      api.destinations(),
      api.categories(),
      api.jobs({ featured: 'true', pageSize: 6, sort: 'newest' }),
      api.jobs({ pageSize: 8, sort: 'newest' }),
      api.successStories(),
    ],
  );

  // Slides of the back office, or the three static ones when it has none (or the API is down).
  const fallbackSlides: HeroSlide[] = (
    [
      ['malta', 'MALTA'],
      ['poland', 'POLAND'],
      ['cruise', 'CRUISE_SHIP'],
    ] as const
  ).map(([key, code]) => ({
    id: key,
    title: t(`hero.fallback.${key}.title`),
    subtitle: t(`hero.fallback.${key}.subtitle`),
    image: DESTINATION_IMAGES[code] ?? '',
    ctaLabel: t('hero.cta'),
    ctaHref: `/jobs?destination=${code}`,
  }));
  const apiSlides: HeroSlide[] = slides
    .filter((slide) => slide.imageUrl)
    .map((slide) => ({
      id: slide.id,
      title: pick(slide.title, locale),
      subtitle: pick(slide.subtitle, locale),
      image: slide.imageUrl ?? '',
      ctaLabel: pick(slide.ctaLabel, locale) || t('hero.cta'),
      ctaHref: slide.ctaUrl?.startsWith('/') ? slide.ctaUrl : '/jobs',
    }));
  const heroSlides = apiSlides.length > 0 ? apiSlides : fallbackSlides;

  // Featured jobs first, then the newest ones, without repeating a job.
  const jobs = [
    ...featured.items,
    ...latest.items.filter((job) => !featured.items.some((f) => f.id === job.id)),
  ].slice(0, 8);

  const counters = [
    { id: 'open-jobs', label: t('stats.openJobs'), value: stats?.openJobs ?? 0, icon: Briefcase },
    {
      id: 'candidates',
      label: t('stats.candidates'),
      value: stats?.registeredCandidates ?? 0,
      icon: UserRoundPlus,
    },
    { id: 'visas', label: t('stats.visas'), value: stats?.visasApproved ?? 0, icon: BadgeCheck },
    // Shown once the agency has partner companies to count, on the platform or before it.
    ...(stats && stats.partnerCompanies > 0
      ? [
          {
            id: 'companies',
            label: t('stats.companies'),
            value: stats.partnerCompanies,
            icon: Building2,
          },
        ]
      : []),
    {
      id: 'countries',
      label: t('stats.countries'),
      value: stats?.countries ?? destinations.length,
      icon: Anchor,
    },
  ];

  const storyLabels = {
    badge: t('stories.badge'),
    visaDate: t.raw('stories.visaDate') as string,
    photoAlt: t.raw('stories.photoAlt') as string,
  };

  return (
    <>
      <h1 className="sr-only">{t('meta.homeTitle')}</h1>

      <HeroSlider
        slides={heroSlides}
        labels={{
          region: t('hero.label'),
          slideOf: t.raw('hero.slideOf') as string,
          pause: t('hero.pause'),
          play: t('hero.play'),
          secondaryCta: t('hero.secondaryCta'),
        }}
      >
        <form
          action={`/${locale}/jobs`}
          method="get"
          role="search"
          aria-label={t('hero.searchLabel')}
          className="grid gap-3 rounded-2xl bg-background p-3 text-foreground shadow-xl sm:grid-cols-[1fr_14rem_auto] sm:p-4"
        >
          <div>
            <label htmlFor="hero-q" className="sr-only">
              {t('hero.keyword')}
            </label>
            <input
              id="hero-q"
              name="q"
              type="search"
              placeholder={t('hero.keywordPlaceholder')}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="hero-destination" className="sr-only">
              {t('hero.destination')}
            </label>
            <select id="hero-destination" name="destination" className={field} defaultValue="">
              <option value="">{t('hero.allDestinations')}</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.code}>
                  {pick(destination.name, locale)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={cta.primary}>
            <Search className="size-4" aria-hidden />
            {t('hero.search')}
          </button>
        </form>
      </HeroSlider>

      <section aria-labelledby="stats-title" className="border-b border-border bg-muted/50">
        <h2 id="stats-title" className="sr-only">
          {t('stats.title')}
        </h2>
        <dl
          className={`container-page grid grid-cols-2 gap-6 py-10 ${counters.length > 4 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'lg:grid-cols-4'}`}
          data-testid="home-counters"
        >
          {counters.map((counter) => (
            <div
              key={counter.label}
              className="flex flex-col-reverse items-center gap-1 text-center"
            >
              <dt className="text-sm font-medium text-muted-foreground">{counter.label}</dt>
              <dd
                className="flex items-center gap-2 text-3xl font-bold sm:text-4xl"
                data-testid={`counter-${counter.id}`}
                data-value={counter.value}
              >
                <counter.icon className="size-7 text-brand-gold" aria-hidden />
                <Counter value={counter.value} locale={locale} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        id="destinations"
        aria-labelledby="destinations-title"
        className="container-page py-14"
      >
        <SectionHeading
          id="destinations-title"
          title={t('destinations.title')}
          subtitle={t('destinations.subtitle')}
        />
        <ul className="grid gap-6 md:grid-cols-3">
          {destinations.map((destination, index) => {
            const name = pick(destination.name, locale);
            const image = DESTINATION_IMAGES[destination.code];
            return (
              <li key={destination.id}>
                <Reveal delay={index * 0.1}>
                  <Link
                    href={`/jobs?destination=${destination.code}`}
                    className="group relative block h-64 overflow-hidden rounded-2xl bg-brand-navy text-white shadow-sm"
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        fill
                        sizes="(min-width: 768px) 33vw, 100vw"
                        className="object-cover transition-transform duration-700 group-hover:scale-110 motion-reduce:transition-none"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-brand-blue to-brand-navy" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-navy via-brand-navy/40 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-5">
                      <p className="flex items-center gap-2 text-2xl font-bold">
                        <DestinationMark code={destination.code} className="h-5 w-7" />
                        {name}
                      </p>
                      <p className="mt-1 text-sm text-white/90">
                        {t('destinations.openJobs', { count: destination.openJobs })}
                      </p>
                    </div>
                  </Link>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="categories-title" className="bg-muted/50">
        <div className="container-page py-14">
          <SectionHeading
            id="categories-title"
            title={t('categories.title')}
            subtitle={t('categories.subtitle')}
          />
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.icon ?? ''] ?? Briefcase;
              return (
                <li key={category.id}>
                  <Link
                    href={`/jobs?category=${category.slug}`}
                    className={`${card} flex h-full flex-col items-start gap-3 p-5 transition-colors hover:border-brand-gold`}
                  >
                    <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand-gold-soft text-brand-navy dark:text-brand-gold">
                      <Icon className="size-6" aria-hidden />
                    </span>
                    <span className="text-base font-semibold">{pick(category.name, locale)}</span>
                    <span className="text-sm text-muted-foreground">
                      {t('categories.openJobs', { count: category.openJobs })}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="latest-title" className="container-page py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            id="latest-title"
            title={t('latestJobs.title')}
            subtitle={t('latestJobs.subtitle')}
          />
          <Link href="/jobs" className={`${cta.outline} mb-8`}>
            {t('common.viewAll')}
          </Link>
        </div>
        {jobs.length > 0 ? (
          <SnapCarousel
            label={t('latestJobs.title')}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          >
            {jobs.map((job) => (
              <li key={job.id} className="w-[19rem] sm:w-[21rem]">
                <JobCard job={job} />
              </li>
            ))}
          </SnapCarousel>
        ) : (
          <p className="text-muted-foreground">{t('latestJobs.empty')}</p>
        )}
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="bg-brand-navy text-white">
        <div className="container-page py-14">
          <div className="mb-10 max-w-2xl">
            <h2 id="how-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t('how.title')}
            </h2>
            <p className="mt-2 text-white/80">{t('how.subtitle')}</p>
          </div>
          <ol className="relative grid gap-8 md:grid-cols-5 md:gap-4">
            <li
              aria-hidden
              className="absolute inset-x-0 top-6 hidden h-0.5 bg-white/20 md:block"
            />
            {STEPS.map((step, index) => (
              <li key={step.key} className="relative">
                <Reveal delay={index * 0.12}>
                  <span className="relative inline-flex size-12 items-center justify-center rounded-full bg-brand-gold text-brand-navy shadow-lg">
                    <step.icon className="size-6" aria-hidden />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-brand-gold" aria-hidden>
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h3 className="text-lg font-semibold">{t(`how.steps.${step.key}.title`)}</h3>
                  <p className="mt-1 text-sm text-white/80">{t(`how.steps.${step.key}.text`)}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="success-stories"
        aria-labelledby="stories-title"
        className="container-page py-14"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading
            id="stories-title"
            title={t('stories.title')}
            subtitle={t('stories.subtitle')}
          />
          <Link href="/success-stories" className={`${cta.outline} mb-8`}>
            {t('stories.viewAll')}
          </Link>
        </div>
        {stories.length > 0 ? (
          <SnapCarousel
            label={t('stories.title')}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          >
            {stories.slice(0, 12).map((story) => (
              <li key={story.id} className="w-[16rem] sm:w-[18rem]" data-testid="story-card">
                <StoryCard story={story} locale={locale} labels={storyLabels} />
              </li>
            ))}
          </SnapCarousel>
        ) : (
          <p className="text-muted-foreground">{t('stories.empty')}</p>
        )}
      </section>

      <section aria-labelledby="trust-title" className="bg-muted/50">
        <div className="container-page py-14">
          <SectionHeading id="trust-title" title={t('trust.title')} />
          <ul className="grid gap-5 md:grid-cols-3">
            {(
              [
                ['licensed', BadgeCheck],
                ['partners', Handshake],
                ['support', HeartHandshake],
              ] as const
            ).map(([key, Icon], index) => (
              <li key={key}>
                <Reveal delay={index * 0.1} className={`${card} h-full p-6`}>
                  <Icon className="size-8 text-brand-gold" aria-hidden />
                  <h3 className="mt-3 text-lg font-semibold">{t(`trust.${key}.title`)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`trust.${key}.text`)}</p>
                </Reveal>
              </li>
            ))}
          </ul>
          <div
            role="note"
            className="mt-6 flex gap-4 rounded-2xl border-2 border-brand-gold bg-brand-gold-soft p-5 text-brand-navy dark:text-foreground"
          >
            <ShieldAlert
              className="size-8 shrink-0 text-brand-navy dark:text-brand-gold"
              aria-hidden
            />
            <div>
              <h3 className="text-lg font-bold">{t('trust.antiScam.title')}</h3>
              <p className="mt-1 text-sm">{t('trust.antiScam.text')}</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="container-page py-14">
        <SectionHeading id="faq-title" title={t('faq.title')} />
        <Faq
          items={FAQ_KEYS.map((key) => ({
            id: key,
            question: t(`faq.items.${key}.q`),
            answer: t(`faq.items.${key}.a`),
          }))}
        />
      </section>

      <section aria-labelledby="alert-title" className="bg-brand-navy text-white">
        <div className="container-page grid gap-8 py-14 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="alert-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t('alert.title')}
            </h2>
            <p className="mt-2 text-white/80">{t('alert.text')}</p>
          </div>
          <JobAlertForm
            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
            destinations={destinations.map((destination) => ({
              code: destination.code,
              name: pick(destination.name, locale),
            }))}
            labels={{
              email: t('alert.email'),
              destination: t('alert.destination'),
              allDestinations: t('alert.allDestinations'),
              submit: t('alert.submit'),
              sending: t('alert.sending'),
              success: t('alert.success'),
              error: t('alert.error'),
              captcha: t('contact.form.captcha'),
            }}
          />
        </div>
      </section>

      <section aria-labelledby="contact-cta-title" className="container-page py-14">
        <div className={`${card} flex flex-wrap items-center justify-between gap-6 p-8`}>
          <div>
            <h2 id="contact-cta-title" className="text-2xl font-bold tracking-tight">
              {t('contactCta.title')}
            </h2>
            <p className="mt-1 text-muted-foreground">{t('contactCta.text')}</p>
          </div>
          <Link href="/contact" className={cta.primary}>
            {t('contactCta.button')}
          </Link>
        </div>
      </section>
    </>
  );
}
