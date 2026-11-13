'use client';

import {
  createPartnerJobSchema,
  PARTNER_SALARY_CURRENCIES,
  PARTNER_SALARY_PERIODS,
  updatePartnerJobSchema,
} from '@iconbridge/shared/partner';
import {
  BadgeCheck,
  Briefcase,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  MapPin,
  Plus,
  Search,
  Stamp,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';
import {
  api,
  attempt,
  type PartnerApplication,
  type PartnerJob,
  type PartnerSpaceItem,
} from '@/lib/client-api';
import { countryName, flag } from '@/lib/countries';
import { partnerHref } from '@/lib/partner-locale';
import { cta, field } from '@/lib/ui';
import { Comments } from './activity';
import {
  Avatar,
  Badge,
  card,
  cardHover,
  CardTitle,
  EmptyState,
  Failed,
  formatDate,
  formatDateTime,
  heading,
  JobStatusBadge,
  LoadingText,
  toneOf,
  useIssueTexts,
  usePartner,
  usePartnerCall,
  useSpace,
  VISA_STATUSES,
  VisaBadge,
  WORK_PERMIT_STATUSES,
  WorkPermitBadge,
  type VisaStatus,
  type WorkPermitStatus,
} from './partner-ui';

/** Loads one thing of the space; `reload` asks again. */
function useLoad<T>(fetch: () => Promise<{ data?: T; error?: unknown }>, key: string) {
  const [state, setState] = useState<{ key: string; data: T | null; failed: boolean } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void attempt(fetch()).then(({ data }) => {
      if (!cancelled) {
        setState({ key, data: data ?? null, failed: data === undefined });
      }
    });
    return () => {
      cancelled = true;
    };
    // `fetch` is new at every render; the key says what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);
  const current = state?.key === key ? state : null;
  return {
    data: current?.data ?? null,
    failed: current?.failed ?? false,
    loading: current === null,
    reload,
  };
}

/** One text field with its label, hint and error. */
export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const input = `${field} aria-[invalid=true]:border-destructive`;

const backLink =
  'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground';

/** The number of applications of a job demand. */
const totalOf = (job: PartnerJob) =>
  VISA_STATUSES.reduce((sum, status) => sum + job.applications[status], 0);

/** Positions filled: the people whose visa is approved (ADR-027, amendment 3). */
const filledOf = (job: PartnerJob) => job.applications.APPROVED;

/** "3,000 PLN / month", in the reader's language; null without an amount. */
export function useSalaryText(): (job: PartnerJob) => string | null {
  const t = useTranslations('partner.job');
  const { lang } = usePartner();
  return (job) =>
    job.salaryAmount !== null && job.salaryCurrency && job.salaryPeriod
      ? t('salaryValue', {
          amount: new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(
            job.salaryAmount,
          ),
          currency: job.salaryCurrency,
          period: t(`per.${job.salaryPeriod}`),
        })
      : null;
}

/** "2 / 5 filled" with a bar; the bar is drawn, the text says it. */
function FilledBar({ job }: { job: PartnerJob }) {
  const t = useTranslations('partner.home');
  const filled = filledOf(job);
  const share = Math.min(100, Math.round((filled / Math.max(job.positions, 1)) * 100));
  return (
    <div data-testid="positions-filled">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t('filledLabel')}</span>
        <span className="font-semibold tabular-nums">
          {t('filled', { filled, positions: job.positions })}
        </span>
      </div>
      <div aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width] motion-reduce:transition-none dark:bg-emerald-400"
          style={{ width: `${String(share)}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My spaces
// ---------------------------------------------------------------------------

/** Staff with several spaces choose one; a single space opens at once. */
export function SpacesIndex() {
  const t = useTranslations('partner.spaces');
  const { lang } = usePartner();
  const router = useRouter();
  const { data, failed, loading, reload } = useLoad(
    () => api.GET('/api/v1/partner-spaces'),
    'spaces',
  );
  const only = data?.length === 1 ? data[0] : undefined;
  useEffect(() => {
    if (only) {
      router.replace(partnerHref(lang, `/spaces/${only.id}`));
    }
  }, [lang, only, router]);
  if (failed) {
    return <Failed onRetry={() => reload()} />;
  }
  if (loading || !data || only) {
    return <LoadingText variant="cards" />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('intro')}</p>
      </div>
      {data.length === 0 ? (
        <EmptyState icon={Briefcase} text={t('empty')} testId="no-space" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.map((space: PartnerSpaceItem) => (
            <li key={space.id}>
              <NextLink
                href={partnerHref(lang, `/spaces/${space.id}`)}
                className={`${card} ${cardHover} flex min-h-11 items-center gap-4`}
              >
                <SpaceLogo name={space.name} logoUrl={space.logoUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{space.name}</span>
                  <span className="text-sm text-muted-foreground">
                    <span aria-hidden>{flag(space.country)}</span>{' '}
                    {countryName(space.country, lang)}
                  </span>
                </span>
                <ChevronRight className="size-5 text-muted-foreground rtl:rotate-180" aria-hidden />
              </NextLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The partner's logo, or its initials. */
function SpaceLogo({
  name,
  logoUrl,
  large,
}: {
  name: string;
  logoUrl: string | null;
  large?: boolean;
}) {
  const t = useTranslations('partner.header');
  if (!logoUrl) {
    return <Avatar name={name} size={large ? 'lg' : 'md'} onDark={large} />;
  }
  return (
    // A 5-minute link to a private blob: not something next/image can optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={t('logoAlt', { name })}
      width={large ? 56 : 40}
      height={large ? 56 : 40}
      className={`shrink-0 rounded-xl border border-border bg-white object-contain p-1 ${large ? 'size-14' : 'size-10'}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Space home: job demands
// ---------------------------------------------------------------------------

/** The band at the top of a space: the partner's logo, name and country. */
function SpaceBand({ action }: { action: ReactNode }) {
  const t = useTranslations('partner.home');
  const space = useSpace();
  const { lang } = usePartner();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand-navy p-5 text-white shadow-sm md:p-6"
      data-testid="space-band"
    >
      <div className="flex min-w-0 items-center gap-4">
        <SpaceLogo name={space.name} logoUrl={space.logoUrl} large />
        <div className="min-w-0">
          <p className="truncate text-sm text-white/80">{space.name}</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-white/80">
            <span aria-hidden>{flag(space.country)}</span> {countryName(space.country, lang)}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: 'navy' | 'blue' | 'green' | 'gold';
}) {
  const tones = {
    navy: 'bg-brand-navy/10 text-brand-navy dark:bg-white/10 dark:text-white',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    gold: 'bg-brand-gold-soft text-brand-navy dark:text-brand-gold',
  };
  return (
    <li className={`${card} flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4`}>
      <span
        aria-hidden
        className={`inline-flex size-12 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
      >
        <Icon className="size-6" />
      </span>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </div>
    </li>
  );
}

function Summary({ jobs }: { jobs: PartnerJob[] }) {
  const t = useTranslations('partner.home.summary');
  const sum = (pick: (job: PartnerJob) => number) => jobs.reduce((n, job) => n + pick(job), 0);
  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      aria-label={t('label')}
      data-testid="space-summary"
    >
      <SummaryCard
        icon={Briefcase}
        label={t('openJobs')}
        value={jobs.filter((job) => job.status === 'OPEN').length}
        tone="navy"
      />
      <SummaryCard icon={Users} label={t('candidates')} value={sum(totalOf)} tone="blue" />
      <SummaryCard
        icon={FileCheck2}
        label={t('permitsApproved')}
        value={sum((job) => job.workPermits.APPROVED)}
        tone="green"
      />
      <SummaryCard
        icon={Stamp}
        label={t('visasApproved')}
        value={sum((job) => job.applications.APPROVED)}
        tone="gold"
      />
    </ul>
  );
}

/** The non-zero counts of one stage, as badges. */
function StageChips({
  label,
  counts,
  statuses,
  text,
}: {
  label: string;
  counts: Record<string, number>;
  statuses: readonly string[];
  text: (status: string) => string;
}) {
  const shown = statuses.filter((status) => (counts[status] ?? 0) > 0);
  if (shown.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-xs font-medium text-muted-foreground">{label}</span>
      {shown.map((status) => (
        <Badge key={status} tone={toneOf(status)}>
          {text(status)} · {counts[status]}
        </Badge>
      ))}
    </div>
  );
}

function JobCard({ job }: { job: PartnerJob }) {
  const t = useTranslations('partner.home');
  const visa = useTranslations('partner.visa');
  const permit = useTranslations('partner.workPermit');
  const space = useSpace();
  const { lang } = usePartner();
  const salary = useSalaryText()(job);
  const total = totalOf(job);
  return (
    <li
      className={`${card} ${cardHover} relative flex flex-col gap-4`}
      data-testid="job-card"
      data-status={job.status}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg leading-snug font-semibold">
          {/* The whole card is the link (the ::after covers it). */}
          <NextLink
            href={partnerHref(lang, `/spaces/${space.id}/jobs/${job.id}`)}
            className="after:absolute after:inset-0 after:rounded-2xl after:content-['']"
          >
            {job.role}
          </NextLink>
        </h3>
        <JobStatusBadge status={job.status} />
      </div>
      <dl className="grid gap-2 text-sm">
        <div className="flex items-start gap-2">
          <dt>
            <MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('location')}</span>
          </dt>
          <dd>{job.locations.join(', ')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt>
            <Wallet className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t('salary')}</span>
          </dt>
          <dd className={salary ? 'font-medium' : 'text-muted-foreground'}>
            {salary ?? job.salary ?? t('noSalary')}
          </dd>
        </div>
      </dl>
      <FilledBar job={job} />
      <div className="space-y-1.5">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noApplicationsYet')}</p>
        ) : (
          <>
            <StageChips
              label={t('workPermitStage')}
              counts={job.workPermits}
              statuses={WORK_PERMIT_STATUSES}
              text={(status) => permit(status)}
            />
            <StageChips
              label={t('visaStage')}
              counts={job.applications}
              statuses={VISA_STATUSES}
              text={(status) => visa(status)}
            />
          </>
        )}
      </div>
      <p className="mt-auto flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" aria-hidden />
        {t('updated', { date: formatDate(job.updatedAt, lang) })}
        <span className="ms-auto">{t('applications', { count: total })}</span>
      </p>
    </li>
  );
}

export function SpaceHome() {
  const t = useTranslations('partner.home');
  const space = useSpace();
  const { lang } = usePartner();
  const { data, failed, loading, reload } = useLoad(
    () =>
      api.GET('/api/v1/partner-spaces/{spaceId}/jobs', { params: { path: { spaceId: space.id } } }),
    `jobs:${space.id}`,
  );
  const newJob = partnerHref(lang, `/spaces/${space.id}/jobs/new`);
  const groups = (['OPEN', 'CLOSED'] as const).map((status) => ({
    status,
    jobs: (data ?? []).filter((job) => job.status === status),
  }));
  return (
    <div className="space-y-8">
      <SpaceBand
        action={
          <NextLink href={newJob} className={cta.gold}>
            <Plus className="size-4" aria-hidden />
            {t('newJob')}
          </NextLink>
        }
      />
      {failed ? <Failed onRetry={() => reload()} /> : null}
      {loading ? <LoadingText variant="page" /> : null}
      {data ? <Summary jobs={data} /> : null}
      {data && data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          text={t('empty')}
          testId="no-job"
          action={
            <NextLink href={newJob} className={cta.primary}>
              <Plus className="size-4" aria-hidden />
              {t('createFirst')}
            </NextLink>
          }
        />
      ) : null}
      {groups
        .filter((group) => group.jobs.length > 0)
        .map((group) => (
          <section key={group.status} aria-labelledby={`jobs-${group.status}`}>
            <h2 id={`jobs-${group.status}`} className={`${heading} mb-4 flex items-center gap-2`}>
              {group.status === 'OPEN' ? t('openJobs') : t('closedJobs')}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {group.jobs.length}
              </span>
            </h2>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job demand: form and detail
// ---------------------------------------------------------------------------

interface JobValues {
  role: string;
  positions: string;
  places: string;
  salaryAmount: string;
  salaryCurrency: string;
  salaryPeriod: string;
  salary: string;
  description: string;
}

const toValues = (job: PartnerJob | null): JobValues => ({
  role: job?.role ?? '',
  positions: job ? String(job.positions) : '1',
  places: job?.locations.join('\n') ?? '',
  salaryAmount: job?.salaryAmount === null || !job ? '' : String(job.salaryAmount),
  salaryCurrency: job?.salaryCurrency ?? '',
  salaryPeriod: job?.salaryPeriod ?? '',
  salary: job?.salary ?? '',
  description: job?.description ?? '',
});

const orNull = <T extends string>(value: string) =>
  value.trim() === '' ? null : (value.trim() as T);

const toBody = (values: JobValues) => ({
  role: values.role.trim(),
  positions: Number(values.positions),
  locations: values.places
    .split('\n')
    .map((place) => place.trim())
    .filter(Boolean),
  salaryAmount:
    values.salaryAmount.trim() === ''
      ? null
      : Number(values.salaryAmount.replace(/[\s,\u00a0\u202f]/g, '')),
  salaryCurrency: orNull<(typeof PARTNER_SALARY_CURRENCIES)[number]>(values.salaryCurrency),
  salaryPeriod: orNull<(typeof PARTNER_SALARY_PERIODS)[number]>(values.salaryPeriod),
  salary: values.salary.trim() === '' ? null : values.salary.trim(),
  description: values.description.trim(),
});

/** Create a job demand, or edit one (`job`). */
export function JobForm({
  job,
  onSaved,
  onCancel,
}: {
  job?: PartnerJob;
  onSaved?: (job: PartnerJob) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('partner.job');
  const errorsText = useTranslations('partner.errors');
  const space = useSpace();
  const { lang } = usePartner();
  const router = useRouter();
  const call = usePartnerCall();
  const issueTexts = useIssueTexts();
  const [values, setValues] = useState<JobValues>(() => toValues(job ?? null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof JobValues) => (event: { target: { value: string } }) => {
    setValues({ ...values, [key]: event.target.value });
  };
  const submit = async () => {
    const body = toBody(values);
    // The salary rule is checked on the whole form, also when editing.
    const parsed = (job ? updatePartnerJobSchema : createPartnerJobSchema).safeParse(body);
    const rules = createPartnerJobSchema.safeParse(body);
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues),
      ...(rules.success ? [] : rules.error.issues.filter((issue) => issue.code === 'custom')),
    ];
    if (issues.length > 0) {
      setErrors(
        issueTexts(issues, {
          'Each place may appear once': errorsText('placeOnce'),
          'The salary needs an amount, a currency and a period': errorsText('salaryIncomplete'),
        }),
      );
      return;
    }
    setErrors({});
    setBusy(true);
    const result = job
      ? await call(
          api.PATCH('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}', {
            params: { path: { spaceId: space.id, jobId: job.id } },
            body,
          }),
          t('saved'),
        )
      : await call(
          api.POST('/api/v1/partner-spaces/{spaceId}/jobs', {
            params: { path: { spaceId: space.id } },
            body,
          }),
          t('created'),
        );
    setBusy(false);
    if (!result.ok) {
      return;
    }
    if (onSaved) {
      onSaved(result.data);
    } else {
      router.push(partnerHref(lang, `/spaces/${space.id}/jobs/${result.data.id}`));
    }
  };
  return (
    <form
      className="space-y-5"
      data-testid="job-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormField label={t('role')} hint={t('roleHint')} error={errors.role}>
        {(props) => (
          <input
            {...props}
            required
            maxLength={120}
            className={input}
            value={values.role}
            onChange={set('role')}
          />
        )}
      </FormField>
      <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <FormField label={t('positions')} error={errors.positions}>
          {(props) => (
            <input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              required
              className={input}
              value={values.positions}
              onChange={set('positions')}
            />
          )}
        </FormField>
        <FormField label={t('places')} hint={t('placesHint')} error={errors.locations}>
          {(props) => (
            <textarea
              {...props}
              rows={3}
              required
              className={input}
              value={values.places}
              onChange={set('places')}
            />
          )}
        </FormField>
      </div>
      <fieldset className="space-y-3 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-semibold">{t('salaryLegend')}</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('salaryAmount')} error={errors.salaryAmount}>
            {(props) => (
              <input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                className={input}
                value={values.salaryAmount}
                onChange={set('salaryAmount')}
              />
            )}
          </FormField>
          <FormField label={t('salaryCurrency')} error={errors.salaryCurrency}>
            {(props) => (
              <select
                {...props}
                className={input}
                value={values.salaryCurrency}
                onChange={set('salaryCurrency')}
              >
                <option value="">—</option>
                {PARTNER_SALARY_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t('salaryPeriod')} error={errors.salaryPeriod}>
            {(props) => (
              <select
                {...props}
                className={input}
                value={values.salaryPeriod}
                onChange={set('salaryPeriod')}
              >
                <option value="">—</option>
                {PARTNER_SALARY_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {t(`per.${period}`)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        <FormField label={t('salary')} hint={t('salaryHint')} error={errors.salary}>
          {(props) => (
            <input
              {...props}
              maxLength={200}
              className={input}
              value={values.salary}
              onChange={set('salary')}
            />
          )}
        </FormField>
      </fieldset>
      <FormField label={t('description')} error={errors.description}>
        {(props) => (
          <textarea
            {...props}
            rows={5}
            maxLength={5000}
            className={input}
            value={values.description}
            onChange={set('description')}
          />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-3">
        {onCancel ? (
          <button type="button" className={cta.outline} onClick={onCancel}>
            {t('cancel')}
          </button>
        ) : null}
        <button type="submit" className={cta.primary} disabled={busy}>
          {job ? t('save') : t('create')}
        </button>
      </div>
    </form>
  );
}

export function NewJob() {
  const t = useTranslations('partner.job');
  const space = useSpace();
  const { lang } = usePartner();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <NextLink href={partnerHref(lang, `/spaces/${space.id}`)} className={backLink}>
        <span aria-hidden>←</span> {t('back')}
      </NextLink>
      <div className={card}>
        <CardTitle icon={Briefcase} as="span">
          <h1 className="text-2xl font-bold tracking-tight">{t('newTitle')}</h1>
        </CardTitle>
        <div className="mt-6">
          <JobForm />
        </div>
      </div>
    </div>
  );
}

const fullName = (application: PartnerApplication) =>
  `${application.firstName} ${application.lastName}`;

/** The applications of a job demand: a table from tablet width, cards on phones. */
function ApplicationsList({
  job,
  items,
  filtered,
}: {
  job: PartnerJob;
  items: PartnerApplication[];
  filtered: boolean;
}) {
  const t = useTranslations('partner.table');
  const jobText = useTranslations('partner.job');
  const space = useSpace();
  const { lang } = usePartner();
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        text={filtered ? jobText('noFilteredApplications') : jobText('noApplications')}
        testId="no-application"
      />
    );
  }
  const href = (application: PartnerApplication) =>
    partnerHref(lang, `/spaces/${space.id}/applications/${application.id}`);
  return (
    <>
      <div className="relative hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-sm" data-testid="applications-table">
          <caption className="sr-only">
            {jobText('applicationsTitle')}: {job.role}
          </caption>
          <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              {(
                [
                  'candidate',
                  'workPermit',
                  'visaStatus',
                  'appointment',
                  'dhlSent',
                  'documentsReceived',
                ] as const
              ).map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-4 py-3 text-start font-semibold whitespace-nowrap"
                >
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((application) => (
              <tr key={application.id} className="transition-colors hover:bg-muted/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={fullName(application)} size="sm" />
                    <div className="min-w-0">
                      <NextLink
                        href={href(application)}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {fullName(application)}
                      </NextLink>
                      <p className="text-xs text-muted-foreground">
                        {countryName(application.nationality, lang)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <WorkPermitBadge status={application.workPermitStatus} />
                </td>
                <td className="px-4 py-3">
                  <VisaBadge status={application.visaStatus} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatDate(application.visaAppointmentDate, lang)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatDate(application.dhlSentDate, lang)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {formatDate(application.documentsReceivedDate, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden" data-testid="applications-cards">
        {items.map((application) => (
          <li
            key={application.id}
            className="relative rounded-xl border border-border bg-background p-4 transition-shadow hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <Avatar name={fullName(application)} size="sm" />
              <div className="min-w-0 flex-1">
                <NextLink
                  href={href(application)}
                  className="font-medium after:absolute after:inset-0 after:content-['']"
                >
                  {fullName(application)}
                </NextLink>
                <p className="text-xs text-muted-foreground">
                  {countryName(application.nationality, lang)}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t('workPermit')}</dt>
                <dd>
                  <WorkPermitBadge status={application.workPermitStatus} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t('visaStatus')}</dt>
                <dd>
                  <VisaBadge status={application.visaStatus} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Counts of one stage, each a filter of the list: one pressed chip at a time, "All" first.
 * Counts come from the job demand, so they stay whole while a filter is on.
 */
function FilterChips<S extends string>({
  label,
  groupLabel,
  statuses,
  counts,
  value,
  onChange,
  text,
  allText,
  testId,
}: {
  label: string;
  /** The name of the group for screen readers: what the chips filter. */
  groupLabel: string;
  statuses: readonly S[];
  counts: Record<S, number>;
  value: S | null;
  onChange: (value: S | null) => void;
  text: (status: S) => string;
  allText: string;
  testId: string;
}) {
  const total = statuses.reduce((sum, status) => sum + counts[status], 0);
  const options: { key: S | null; label: string; count: number }[] = [
    { key: null, label: allText, count: total },
    ...statuses.map((status) => ({ key: status, label: text(status), count: counts[status] })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:w-28">
        {label}
      </span>
      <div
        role="group"
        aria-label={groupLabel}
        className="flex flex-wrap gap-2"
        data-testid={testId}
      >
        {options.map((option) => (
          <button
            key={option.key ?? 'all'}
            type="button"
            aria-pressed={value === option.key}
            data-status={option.key ?? 'ALL'}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
              value === option.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted'
            }`}
            onClick={() => {
              onChange(option.key);
            }}
          >
            {option.key ? (
              <span
                aria-hidden
                className={`size-2 rounded-full ${
                  {
                    grey: 'bg-muted-foreground',
                    blue: 'bg-blue-600 dark:bg-blue-400',
                    green: 'bg-emerald-600 dark:bg-emerald-400',
                    red: 'bg-red-600 dark:bg-red-400',
                  }[toneOf(option.key)]
                }`}
              />
            ) : null}
            {option.label}
            <span className="tabular-nums opacity-80">{option.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A search typed by name, sent once the typing pauses. */
function useDebounced(value: string, delay = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delay]);
  return settled;
}

/** Deleting a job demand without applications: a super admin who is a member types its role. */
function DeleteJob({ job, onClose }: { job: PartnerJob; onClose: () => void }) {
  const t = useTranslations('partner.deleteJob');
  const ui = useTranslations('partner.ui');
  const space = useSpace();
  const { lang } = usePartner();
  const call = usePartnerCall();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const result = await call(
      api.DELETE('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}', {
        params: { path: { spaceId: space.id, jobId: job.id } },
        body: { confirmName: typed.trim() },
      }),
      t('done'),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      window.location.assign(partnerHref(lang, `/spaces/${space.id}`));
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="delete-job-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.trim() === job.role) {
          void remove();
        }
      }}
    >
      <p className="text-sm">{t('willRemove')}</p>
      <p className="text-sm text-muted-foreground">{t('keeps')}</p>
      <FormField label={t('typeName', { name: job.role })}>
        {(props) => (
          <input
            {...props}
            autoComplete="off"
            spellCheck={false}
            className={input}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {ui('cancel')}
        </button>
        <button
          type="submit"
          className={`${cta.primary} bg-destructive text-white hover:bg-destructive/90`}
          disabled={busy || typed.trim() !== job.role}
        >
          {t('confirm')}
        </button>
      </div>
    </form>
  );
}

/** One labelled fact of a job demand: the icon in the term, the value under it. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-9 ps-12">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span
          aria-hidden
          className="absolute start-0 top-0 inline-flex size-9 items-center justify-center rounded-lg bg-muted"
        >
          <Icon className="size-4" />
        </span>
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

export function JobDetail({ jobId }: { jobId: string }) {
  const t = useTranslations('partner.job');
  const permitText = useTranslations('partner.workPermit');
  const visaText = useTranslations('partner.visa');
  const deleteText = useTranslations('partner.deleteJob');
  const home = useTranslations('partner.home');
  const common = useTranslations('common');
  const space = useSpace();
  const { lang, user } = usePartner();
  const call = usePartnerCall();
  const salaryText = useSalaryText();
  const searchId = useId();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [permit, setPermit] = useState<WorkPermitStatus | null>(null);
  const [visa, setVisa] = useState<VisaStatus | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const path = { params: { path: { spaceId: space.id, jobId } } };
  const job = useLoad(
    () => api.GET('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}', path),
    `job:${jobId}`,
  );
  const applications = useLoad(
    () =>
      api.GET('/api/v1/partner-spaces/{spaceId}/applications', {
        params: {
          path: { spaceId: space.id },
          query: {
            jobId,
            ...(permit ? { workPermitStatus: permit } : {}),
            ...(visa ? { visaStatus: visa } : {}),
            ...(q ? { q } : {}),
          },
        },
      }),
    `applications:${jobId}:${permit ?? 'all'}:${visa ?? 'all'}:${q}`,
  );
  if (job.failed) {
    return <Failed onRetry={() => job.reload()} />;
  }
  if (!job.data) {
    return <LoadingText variant="page" />;
  }
  const current = job.data;
  const salary = salaryText(current);
  const total = totalOf(current);
  const setStatus = async (close: boolean) => {
    const result = await call(
      close
        ? api.POST('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}/close', path)
        : api.POST('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}/reopen', path),
      close ? t('closedToast') : t('reopenedToast'),
    );
    if (result.ok) {
      job.reload();
    }
  };
  return (
    <div className="space-y-6">
      <NextLink href={partnerHref(lang, `/spaces/${space.id}`)} className={backLink}>
        <span aria-hidden>←</span> {t('back')}
      </NextLink>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{current.role}</h1>
            <JobStatusBadge status={current.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {current.createdBy
              ? t('createdBy', {
                  name: current.createdBy,
                  date: formatDateTime(current.createdAt, lang),
                })
              : formatDateTime(current.createdAt, lang)}
            {current.status === 'CLOSED' && current.closedAt
              ? ` · ${t('closedOn', { date: formatDate(current.closedAt, lang) })}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <button
              type="button"
              className={cta.outline}
              onClick={() => {
                setEditing(true);
              }}
            >
              {t('edit')}
            </button>
          ) : null}
          <button
            type="button"
            className={cta.outline}
            onClick={() => void setStatus(current.status === 'OPEN')}
          >
            {current.status === 'OPEN' ? t('close') : t('reopen')}
          </button>
          {/* Only a super admin who is a member, and only without applications; the API decides. */}
          {user.role === 'SUPER_ADMIN' && total === 0 ? (
            <button
              type="button"
              className={`${cta.outline} text-destructive`}
              onClick={() => {
                setDeleting(true);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {deleteText('button')}
            </button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <section className={card} aria-labelledby="edit-job">
          <CardTitle icon={Briefcase} id="edit-job">
            {t('editTitle')}
          </CardTitle>
          <div className="mt-6">
            <JobForm
              job={current}
              onCancel={() => {
                setEditing(false);
              }}
              onSaved={() => {
                setEditing(false);
                job.reload();
              }}
            />
          </div>
        </section>
      ) : (
        <section className={card} data-testid="job-summary" aria-labelledby="job-details">
          <h2 id="job-details" className="sr-only">
            {t('details')}
          </h2>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <dl className="grid gap-5 sm:grid-cols-2">
              <Fact icon={Users} label={t('positionsLabel')}>
                {current.positions}
              </Fact>
              <Fact icon={MapPin} label={t('locationLabel')}>
                {current.locations.join(', ')}
              </Fact>
              <Fact icon={Wallet} label={t('salaryLabel')}>
                {salary ?? current.salary ?? (
                  <span className="font-normal text-muted-foreground">{t('notGiven')}</span>
                )}
                {salary && current.salary ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {current.salary}
                  </span>
                ) : null}
              </Fact>
              <Fact icon={BadgeCheck} label={t('applicationsTitle')}>
                {total}
              </Fact>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t('descriptionLabel')}
                </dt>
                <dd className="mt-1 text-sm whitespace-pre-line">
                  {/* Plain text, never HTML (ADR-027, rule 9). */}
                  {current.description || (
                    <span className="text-muted-foreground">{t('notGiven')}</span>
                  )}
                </dd>
              </div>
            </dl>
            <div className="rounded-xl bg-muted/50 p-4">
              <FilledBar job={current} />
            </div>
          </div>
        </section>
      )}
      <section className={card} aria-labelledby="job-applications">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <CardTitle icon={Users} id="job-applications">
            {t('applicationsTitle')}
          </CardTitle>
          <NextLink
            href={`${partnerHref(lang, `/spaces/${space.id}/applications/new`)}?jobId=${jobId}`}
            className={cta.primary}
          >
            <Plus className="size-4" aria-hidden />
            {t('newApplication')}
          </NextLink>
        </div>
        <div className="mb-5 space-y-3">
          <div className="relative max-w-sm">
            <label htmlFor={searchId} className="sr-only">
              {t('search')}
            </label>
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              id={searchId}
              type="search"
              autoComplete="off"
              placeholder={t('searchPlaceholder')}
              className={`${field} ps-9`}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </div>
          <FilterChips
            label={home('workPermitStage')}
            groupLabel={permitText('filter')}
            statuses={WORK_PERMIT_STATUSES}
            counts={current.workPermits}
            value={permit}
            onChange={setPermit}
            text={(status) => permitText(status)}
            allText={permitText('all')}
            testId="work-permit-filter"
          />
          <FilterChips
            label={home('visaStage')}
            groupLabel={visaText('filter')}
            statuses={VISA_STATUSES}
            counts={current.applications}
            value={visa}
            onChange={setVisa}
            text={(status) => visaText(status)}
            allText={visaText('all')}
            testId="visa-filter"
          />
        </div>
        {applications.failed ? (
          <Failed onRetry={() => applications.reload()} />
        ) : applications.data ? (
          <ApplicationsList
            job={current}
            items={applications.data}
            filtered={permit !== null || visa !== null || q !== ''}
          />
        ) : (
          <LoadingText />
        )}
      </section>
      <Comments target={{ jobId }} />
      <Modal
        open={deleting}
        onClose={() => {
          setDeleting(false);
        }}
        title={deleteText('title')}
        closeLabel={common('close')}
      >
        {deleting ? (
          <DeleteJob
            job={current}
            onClose={() => {
              setDeleting(false);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
