'use client';

import { ACTIVE_APPLICATION_STATUSES, type ProfileItem } from '@iconbridge/shared/candidate';
import { CircleAlert, CircleCheck, MapPin } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { card, cta } from '@/lib/ui';
import { useAccount, useLoaded } from './account-context';
import { PageTitle } from './account-shell';
import { StatusBadge, useDate } from './status';

/** Where each missing item is filled in. */
export const ITEM_LINKS: Record<ProfileItem, string> = {
  gender: '/account/profile?step=identity',
  dateOfBirth: '/account/profile?step=identity',
  nationality: '/account/profile?step=identity',
  countryOfResidence: '/account/profile?step=identity',
  city: '/account/profile?step=identity',
  phone: '/account/profile?step=identity',
  passportNumber: '/account/profile?step=passport',
  passportIssuingCountry: '/account/profile?step=passport',
  passportIssueDate: '/account/profile?step=passport',
  passportExpiryDate: '/account/profile?step=passport',
  currentProfession: '/account/profile?step=experience',
  yearsOfExperience: '/account/profile?step=experience',
  educationLevel: '/account/profile?step=experience',
  languages: '/account/profile?step=languages',
  cvDocument: '/account/documents',
  passportDocument: '/account/documents',
};

/** Progress bar and the list of what is still missing, each with a link to the right step. */
export function Completeness() {
  const t = useTranslations('account');
  const { profile } = useAccount();
  const { percentage, missing, missingToApply } = profile.profileCompleteness;
  return (
    <section className={`${card} p-5`} aria-labelledby="completeness-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="completeness-title" className="text-lg font-semibold">
          {t('completeness.title')}
        </h2>
        <span className="text-2xl font-bold" data-testid="completeness">
          {percentage}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-labelledby="completeness-title"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        className="mt-3 h-3 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-brand-gold transition-[width] duration-500"
          style={{ width: `${String(percentage)}%` }}
        />
      </div>
      {missing.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium">
          <CircleCheck className="size-5 text-emerald-600" aria-hidden />
          {t('completeness.complete')}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {missingToApply.length > 0 ? t('completeness.blocked') : t('completeness.optional')}
          </p>
          <ul className="mt-3 grid gap-x-6 sm:grid-cols-2" data-testid="missing-items">
            {missing.map((item) => (
              <li key={item}>
                <Link
                  href={ITEM_LINKS[item]}
                  className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline"
                >
                  <CircleAlert
                    className={`size-4 shrink-0 ${missingToApply.includes(item) ? 'text-destructive' : 'text-muted-foreground'}`}
                    aria-hidden
                  />
                  {t(`items.${item}`)}
                  {missingToApply.includes(item) ? (
                    <span className="text-xs text-muted-foreground">
                      ({t('completeness.required')})
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={ITEM_LINKS[missing[0] ?? 'gender']} className={`${cta.primary} mt-4`}>
            {t('completeness.continue')}
          </Link>
        </>
      )}
    </section>
  );
}

function ActiveApplications() {
  const t = useTranslations('account');
  const date = useDate();
  const fetcher = useCallback(async () => (await api.GET('/api/v1/me/applications')).data, []);
  const { data, loading, failed, reload } = useLoaded(fetcher);
  const active = (data ?? []).filter((application) =>
    (ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(application.status),
  );
  return (
    <section className={`${card} p-5`} aria-labelledby="active-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="active-title" className="text-lg font-semibold">
          {t('dashboard.activeTitle')}
        </h2>
        <Link href="/account/applications" className="text-sm font-medium underline">
          {t('dashboard.allApplications')}
        </Link>
      </div>
      {loading ? <Loading lines={2} /> : null}
      {failed ? <LoadFailed onRetry={reload} /> : null}
      {!loading && !failed && active.length === 0 ? (
        <div className="rounded-lg bg-muted p-4 text-sm">
          <p>{t('dashboard.noApplications')}</p>
          <Link href="/jobs" className={`${cta.outline} mt-3`}>
            {t('dashboard.browseJobs')}
          </Link>
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {active.map((application) => (
          <li
            key={application.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div>
              <Link
                href={`/account/applications/${application.id}`}
                className="font-medium hover:underline"
              >
                {application.job.title}
              </Link>
              <p className="text-sm text-muted-foreground">
                {t('applications.appliedOn', { date: date(application.appliedAt) })}
              </p>
            </div>
            <StatusBadge status={application.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Open jobs in the destinations the candidate chose in the profile; the newest jobs otherwise. */
function RecommendedJobs() {
  const t = useTranslations('account');
  const locale = useLocale();
  const date = useDate();
  const { profile } = useAccount();
  const wanted = profile.preferredDestinations.slice(0, 3).join(',');
  const fetcher = useCallback(async () => {
    const codes = wanted ? wanted.split(',') : [undefined];
    const pages = await Promise.all(
      codes.map((destination) =>
        api.GET('/api/v1/jobs', {
          params: { query: { destination, pageSize: wanted ? 4 : 6, sort: 'newest' } },
        }),
      ),
    );
    if (pages.some((page) => !page.data)) {
      return undefined;
    }
    const jobs = pages.flatMap((page) => page.data?.items ?? []);
    return [...new Map(jobs.map((job) => [job.id, job])).values()].slice(0, 6);
  }, [wanted]);
  const { data, loading, failed, reload } = useLoaded(fetcher);
  return (
    <section className={`${card} p-5`} aria-labelledby="recommended-title">
      <h2 id="recommended-title" className="text-lg font-semibold">
        {t('dashboard.recommendedTitle')}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {wanted ? t('dashboard.recommendedText') : t('dashboard.recommendedNoPreference')}{' '}
        <Link href="/account/profile?step=identity" className="font-medium underline">
          {t('dashboard.changePreferences')}
        </Link>
      </p>
      {loading ? <Loading lines={3} /> : null}
      {failed ? <LoadFailed onRetry={reload} /> : null}
      {data?.length === 0 ? (
        <p className="rounded-lg bg-muted p-4 text-sm">{t('dashboard.noJobs')}</p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="recommended-jobs">
        {(data ?? []).map((job) => (
          <li key={job.id} className="relative rounded-xl border border-border p-4 hover:bg-muted">
            <Link
              href={`/jobs/${job.slug}`}
              className="font-semibold after:absolute after:inset-0 hover:underline"
            >
              {job.title}
            </Link>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-4" aria-hidden />
              {pick(job.destination.name, locale)}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('dashboard.deadline', { date: date(job.deadline) })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Dashboard() {
  const t = useTranslations('account');
  const { user, profile } = useAccount();
  return (
    <>
      <PageTitle title={t('dashboard.welcome', { name: profile.firstName })} intro={user.email} />
      <div className="space-y-6">
        <Completeness />
        <ActiveApplications />
        <RecommendedJobs />
      </div>
    </>
  );
}
