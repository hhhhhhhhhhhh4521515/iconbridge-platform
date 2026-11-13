'use client';

import { createPartnerJobSchema, updatePartnerJobSchema } from '@iconbridge/shared/partner';
import { Plus } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import {
  api,
  attempt,
  type PartnerApplication,
  type PartnerJob,
  type PartnerSpaceItem,
} from '@/lib/client-api';
import { countryName } from '@/lib/countries';
import { partnerHref } from '@/lib/partner-locale';
import { cta, field } from '@/lib/ui';
import { Comments } from './activity';
import {
  card,
  Failed,
  formatDate,
  formatDateTime,
  heading,
  LoadingText,
  useIssueTexts,
  usePartner,
  usePartnerCall,
  useSpace,
  WORK_PERMIT_STATUSES,
  WorkPermitBadge,
  type WorkPermitStatus,
} from './partner-ui';

const VISA_STATUSES = [
  'NOT_STARTED',
  'APPOINTMENT_BOOKED',
  'SUBMITTED',
  'APPROVED',
  'REFUSED',
] as const;

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
    return <LoadingText />;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {data.length === 0 ? (
        <p className={card} data-testid="no-space">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((space: PartnerSpaceItem) => (
            <li key={space.id}>
              <NextLink
                href={partnerHref(lang, `/spaces/${space.id}`)}
                className={`${card} flex min-h-11 items-center justify-between gap-3 hover:bg-muted`}
              >
                <span className="font-semibold">{space.name}</span>
                <span className="text-sm text-muted-foreground">
                  {countryName(space.country, lang)}
                </span>
              </NextLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Space home: job demands
// ---------------------------------------------------------------------------

function VisaCounts({ counts }: { counts: PartnerJob['applications'] }) {
  const visa = useTranslations('partner.visa');
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs">
      {VISA_STATUSES.filter((status) => counts[status] > 0).map((status) => (
        <li key={status} className="rounded-full bg-secondary px-2.5 py-0.5 font-medium">
          {visa(status)}: {counts[status]}
        </li>
      ))}
    </ul>
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
  const groups = (['OPEN', 'CLOSED'] as const).map((status) => ({
    status,
    jobs: (data ?? []).filter((job) => job.status === status),
  }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <NextLink href={partnerHref(lang, `/spaces/${space.id}/jobs/new`)} className={cta.primary}>
          <Plus className="size-4" aria-hidden />
          {t('newJob')}
        </NextLink>
      </div>
      {failed ? <Failed onRetry={() => reload()} /> : null}
      {loading ? <LoadingText /> : null}
      {data && data.length === 0 ? <p className={card}>{t('empty')}</p> : null}
      {groups
        .filter((group) => group.jobs.length > 0)
        .map((group) => (
          <section key={group.status} aria-labelledby={`jobs-${group.status}`}>
            <h2 id={`jobs-${group.status}`} className={`${heading} mb-2`}>
              {group.status === 'OPEN' ? t('open') : t('closed')}
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {group.jobs.map((job) => {
                const total = Object.values(job.applications).reduce((sum, n) => sum + n, 0);
                return (
                  <li key={job.id} className={card}>
                    <NextLink
                      href={partnerHref(lang, `/spaces/${space.id}/jobs/${job.id}`)}
                      className="text-lg font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {job.role}
                    </NextLink>
                    <p className="mt-1 text-sm">
                      {t('positions', { count: job.positions })} ·{' '}
                      {t('applications', { count: total })}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('places')}: {job.locations.join(', ')}
                    </p>
                    <div className="mt-2">
                      <VisaCounts counts={job.applications} />
                    </div>
                  </li>
                );
              })}
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
  salary: string;
  description: string;
}

const toValues = (job: PartnerJob | null): JobValues => ({
  role: job?.role ?? '',
  positions: job ? String(job.positions) : '1',
  places: job?.locations.join('\n') ?? '',
  salary: job?.salary ?? '',
  description: job?.description ?? '',
});

const toBody = (values: JobValues) => ({
  role: values.role.trim(),
  positions: Number(values.positions),
  locations: values.places
    .split('\n')
    .map((place) => place.trim())
    .filter(Boolean),
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
    const parsed = (job ? updatePartnerJobSchema : createPartnerJobSchema).safeParse(body);
    if (!parsed.success) {
      setErrors(
        issueTexts(parsed.error.issues, { 'Each place may appear once': errorsText('placeOnce') }),
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
      className="space-y-4"
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
      <FormField label={t('positions')} error={errors.positions}>
        {(props) => (
          <input
            {...props}
            type="number"
            min={1}
            max={1000}
            required
            className={`${input} max-w-40`}
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
    <div className="mx-auto max-w-2xl space-y-4">
      <NextLink
        href={partnerHref(lang, `/spaces/${space.id}`)}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t('back')}
      </NextLink>
      <div className={card}>
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('newTitle')}</h1>
        <JobForm />
      </div>
    </div>
  );
}

function ApplicationsTable({
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
  const visa = useTranslations('partner.visa');
  const space = useSpace();
  const { lang } = usePartner();
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {filtered ? jobText('noFilteredApplications') : jobText('noApplications')}
      </p>
    );
  }
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm" data-testid="applications-table">
        <caption className="sr-only">
          {jobText('applicationsTitle')}: {job.role}
        </caption>
        <thead className="bg-muted/50">
          <tr>
            {(
              [
                'name',
                'nationality',
                'workPermit',
                'visaStatus',
                'appointment',
                'decision',
                'dhlSent',
                'documentsReceived',
              ] as const
            ).map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 text-start font-semibold whitespace-nowrap"
              >
                {t(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((application) => (
            <tr key={application.id}>
              <td className="px-3 py-2">
                <NextLink
                  href={partnerHref(lang, `/spaces/${space.id}/applications/${application.id}`)}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {application.firstName} {application.lastName}
                </NextLink>
              </td>
              <td className="px-3 py-2">{countryName(application.nationality, lang)}</td>
              <td className="px-3 py-2">
                <WorkPermitBadge status={application.workPermitStatus} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{visa(application.visaStatus)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(application.visaAppointmentDate, lang)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(application.visaDecisionDate, lang)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(application.dhlSentDate, lang)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(application.documentsReceivedDate, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The work permit counts of a job demand, each a filter of the table below: one pressed
 * button at a time, "All" first. Counts come from the job demand, so they stay whole while a
 * filter is on.
 */
function WorkPermitFilter({
  counts,
  value,
  onChange,
}: {
  counts: PartnerJob['workPermits'];
  value: WorkPermitStatus | null;
  onChange: (value: WorkPermitStatus | null) => void;
}) {
  const t = useTranslations('partner.workPermit');
  const total = WORK_PERMIT_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const options: { key: WorkPermitStatus | null; label: string; count: number }[] = [
    { key: null, label: t('all'), count: total },
    ...WORK_PERMIT_STATUSES.map((status) => ({
      key: status,
      label: t(status),
      count: counts[status],
    })),
  ];
  return (
    <div
      role="group"
      aria-label={t('filter')}
      className="mb-3 flex flex-wrap gap-2"
      data-testid="work-permit-filter"
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
          {option.label}
          <span className="tabular-nums">{option.count}</span>
        </button>
      ))}
    </div>
  );
}

export function JobDetail({ jobId }: { jobId: string }) {
  const t = useTranslations('partner.job');
  const home = useTranslations('partner.home');
  const space = useSpace();
  const { lang } = usePartner();
  const call = usePartnerCall();
  const [editing, setEditing] = useState(false);
  const [permit, setPermit] = useState<WorkPermitStatus | null>(null);
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
          query: { jobId, ...(permit ? { workPermitStatus: permit } : {}) },
        },
      }),
    `applications:${jobId}:${permit ?? 'all'}`,
  );
  if (job.failed) {
    return <Failed onRetry={() => job.reload()} />;
  }
  if (!job.data) {
    return <LoadingText />;
  }
  const current = job.data;
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
    <div className="space-y-5">
      <NextLink
        href={partnerHref(lang, `/spaces/${space.id}`)}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t('back')}
      </NextLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{current.role}</h1>
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
        </div>
      </div>
      {editing ? (
        <section className={card} aria-labelledby="edit-job">
          <h2 id="edit-job" className={`${heading} mb-4`}>
            {t('editTitle')}
          </h2>
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
        </section>
      ) : (
        <section className={card} data-testid="job-summary">
          <p className="text-sm">
            {home('positions', { count: current.positions })} · {home('places')}:{' '}
            {current.locations.join(', ')}
          </p>
          {current.salary ? <p className="mt-1 text-sm">{current.salary}</p> : null}
          {current.description ? (
            // Plain text, never HTML (ADR-027, rule 9).
            <p className="mt-3 text-sm whitespace-pre-line">{current.description}</p>
          ) : null}
          <div className="mt-3">
            <VisaCounts counts={current.applications} />
          </div>
        </section>
      )}
      <section className={card} aria-labelledby="job-applications">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="job-applications" className={heading}>
            {t('applicationsTitle')}
          </h2>
          <NextLink
            href={`${partnerHref(lang, `/spaces/${space.id}/applications/new`)}?jobId=${jobId}`}
            className={cta.primary}
          >
            <Plus className="size-4" aria-hidden />
            {t('newApplication')}
          </NextLink>
        </div>
        <WorkPermitFilter counts={current.workPermits} value={permit} onChange={setPermit} />
        {applications.failed ? (
          <Failed onRetry={() => applications.reload()} />
        ) : applications.data ? (
          <ApplicationsTable job={current} items={applications.data} filtered={permit !== null} />
        ) : (
          <LoadingText />
        )}
      </section>
      <Comments target={{ jobId }} />
    </div>
  );
}
