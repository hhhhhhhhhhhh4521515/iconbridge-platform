import { CalendarClock, MapPin, Star, Users } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { PublicJob } from '@/lib/api';
import { money, pick } from '@/lib/format';
import { card } from '@/lib/ui';

/** The salary of a job as one sentence, or null when the offer gives none. */
export async function salaryText(job: PublicJob, locale: string): Promise<string | null> {
  const t = await getTranslations({ locale, namespace: 'jobs' });
  const period = job.salaryPeriod ? t(`period.${job.salaryPeriod}`) : '';
  const { salaryMin: min, salaryMax: max } = job;
  if (min !== null && max !== null && min !== max) {
    return t('salaryRange', {
      min: money(min, job.salaryCurrency, locale),
      max: money(max, job.salaryCurrency, locale),
      period,
    });
  }
  const single = max ?? min;
  return single === null
    ? null
    : t('salarySingle', { amount: money(single, job.salaryCurrency, locale), period });
}

export async function JobCard({ job }: { job: PublicJob }) {
  const [t, locale, format] = await Promise.all([
    getTranslations('jobs'),
    getLocale(),
    getFormatter(),
  ]);
  const salary = await salaryText(job, locale);
  return (
    <article
      className={`${card} relative flex h-full flex-col p-5 transition-shadow hover:shadow-md`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">
          <MapPin className="size-3.5" aria-hidden />
          {pick(job.destination.name, locale)}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
          {pick(job.category.name, locale)}
        </span>
        {job.featured ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-gold px-2.5 py-1 text-brand-navy">
            <Star className="size-3.5" aria-hidden />
            {t('card.featured')}
          </span>
        ) : null}
      </div>
      <h3 className="mt-3 text-lg leading-snug font-semibold">
        <Link
          href={`/jobs/${job.slug}`}
          className="rounded after:absolute after:inset-0 hover:underline"
          aria-label={t('card.view', { title: job.title })}
        >
          {job.title}
        </Link>
      </h3>
      <p className="mt-1 text-sm font-medium text-foreground">{salary ?? t('salaryUnknown')}</p>
      <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-sm text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-4" aria-hidden />
          {t('card.deadline', {
            date: format.dateTime(new Date(job.deadline), { dateStyle: 'medium' }),
          })}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Users className="size-4" aria-hidden />
          {t('card.positions', { count: job.positions })}
        </li>
      </ul>
    </article>
  );
}
