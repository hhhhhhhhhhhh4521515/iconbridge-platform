'use client';

import { APPLICATION_PIPELINE } from '@iconbridge/shared/enums';
import { Check, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { FormError, LoadFailed, Loading, useApiErrorText } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { Link } from '@/i18n/navigation';
import { api, attempt, failure, type Application } from '@/lib/client-api';
import { card, cta } from '@/lib/ui';
import { useLoaded } from './account-context';
import { PageTitle } from './account-shell';
import { StatusBadge, useDate } from './status';

const fetchApplications = async () => (await api.GET('/api/v1/me/applications')).data;

export function ApplicationList() {
  const t = useTranslations('account');
  const date = useDate();
  const { data, loading, failed, reload } = useLoaded(fetchApplications);
  return (
    <>
      <PageTitle title={t('applications.title')} intro={t('applications.intro')} />
      {loading && !data ? <Loading lines={3} /> : null}
      {failed ? <LoadFailed onRetry={reload} /> : null}
      {data?.length === 0 ? (
        <div className={`${card} p-8 text-center`} data-testid="no-applications">
          <p className="font-medium">{t('applications.empty')}</p>
          <Link href="/jobs" className={`${cta.primary} mt-4`}>
            {t('dashboard.browseJobs')}
          </Link>
        </div>
      ) : null}
      <ul className="space-y-3" data-testid="applications">
        {(data ?? []).map((application) => (
          <li key={application.id} className={`${card} relative p-5 hover:shadow-md`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/account/applications/${application.id}`}
                    className="after:absolute after:inset-0 hover:underline"
                  >
                    {application.job.title}
                  </Link>
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('applications.appliedOn', { date: date(application.appliedAt) })}
                </p>
              </div>
              <StatusBadge status={application.status} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

type Step = Application['history'][number];

/**
 * The road of an application, from "Submitted" to "Deployed": steps passed are ticked
 * with their date, the current one is highlighted, and a rejection or a withdrawal
 * ends the list where it happened.
 */
function Timeline({ application }: { application: Application }) {
  const t = useTranslations('account');
  const date = useDate();
  const pipeline: readonly string[] = APPLICATION_PIPELINE;
  // The latest entry of each status: an application can come back to a step.
  const reached = new Map<string, Step>(application.history.map((step) => [step.toStatus, step]));
  const exited = !pipeline.includes(application.status);
  const furthest = Math.max(0, ...[...reached.keys()].map((status) => pipeline.indexOf(status)));
  const current = exited ? furthest : pipeline.indexOf(application.status);
  const steps = exited ? pipeline.slice(0, current + 1) : pipeline;
  const exit = exited ? reached.get(application.status) : undefined;
  return (
    <ol className="relative" data-testid="timeline">
      {steps.map((status, index) => {
        const entry = reached.get(status);
        const state =
          index < current || exited ? 'done' : index === current ? 'current' : 'upcoming';
        return (
          <li
            key={status}
            className="relative flex gap-4 pb-6 last:pb-0"
            data-state={state}
            data-status={status}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {index < steps.length - 1 || exited ? (
              <span
                aria-hidden
                className={`absolute start-[0.9375rem] top-8 h-full w-0.5 ${state === 'done' ? 'bg-emerald-600' : 'bg-border'}`}
              />
            ) : null}
            <span
              aria-hidden
              className={`relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                state === 'done'
                  ? 'bg-emerald-700 text-white'
                  : state === 'current'
                    ? 'bg-brand-gold text-brand-navy ring-4 ring-brand-gold/30'
                    : 'border border-border bg-background text-muted-foreground'
              }`}
            >
              {state === 'done' ? <Check className="size-4" /> : index + 1}
            </span>
            <div className={state === 'upcoming' ? 'text-muted-foreground' : ''}>
              <p className="font-semibold">
                {t(`status.${status as Application['status']}`)}
                <span className="sr-only"> ({t(`timeline.${state}`)})</span>
              </p>
              {entry && state !== 'upcoming' ? (
                <p className="text-sm text-muted-foreground">{date(entry.at)}</p>
              ) : null}
              {entry?.message && state !== 'upcoming' ? (
                <p className="mt-1 rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap" dir="auto">
                  {entry.message}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
      {exited ? (
        <li className="relative flex gap-4" data-state="exit" data-status={application.status}>
          <span
            aria-hidden
            className={`relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full ${
              application.status === 'REJECTED'
                ? 'bg-destructive text-white'
                : 'bg-muted-foreground text-background'
            }`}
          >
            <CircleX className="size-4" />
          </span>
          <div>
            <p className="font-semibold">{t(`status.${application.status}`)}</p>
            {exit ? <p className="text-sm text-muted-foreground">{date(exit.at)}</p> : null}
            {exit?.message ? (
              <p className="mt-1 rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap" dir="auto">
                {exit.message}
              </p>
            ) : null}
          </div>
        </li>
      ) : null}
    </ol>
  );
}

export function ApplicationDetail({ id }: { id: string }) {
  const t = useTranslations('account');
  const types = useTranslations('account.documentTypes');
  const common = useTranslations('common');
  const apiError = useApiErrorText();
  const date = useDate();
  const { data, loading, failed, reload } = useLoaded(fetchApplications);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const application = data?.find((entry) => entry.id === id);

  const withdraw = useCallback(async () => {
    setWorking(true);
    setProblem(null);
    const { error, response } = await attempt(
      api.POST('/api/v1/me/applications/{id}/withdraw', { params: { path: { id } } }),
    );
    setWorking(false);
    setConfirming(false);
    if (!response?.ok) {
      setProblem(apiError(failure(error).code));
    }
    reload();
  }, [apiError, id, reload]);

  if (loading && !data) {
    return <Loading lines={5} />;
  }
  if (failed) {
    return <LoadFailed onRetry={reload} />;
  }
  if (!application) {
    return (
      <div className={`${card} space-y-3 p-5`}>
        <p role="alert" className="font-medium">
          {t('applications.notFound')}
        </p>
        <Link href="/account/applications" className={cta.outline}>
          {t('applications.backToList')}
        </Link>
      </div>
    );
  }
  return (
    <>
      <PageTitle
        title={application.job.title}
        intro={t('applications.appliedOn', { date: date(application.appliedAt) })}
        action={<StatusBadge status={application.status} />}
      />
      <div className="space-y-6">
        <FormError>{problem}</FormError>
        <section className={`${card} p-5`} aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="mb-4 text-lg font-semibold">
            {t('timeline.title')}
          </h2>
          <Timeline application={application} />
        </section>
        <section className={`${card} p-5`} aria-labelledby="sent-title">
          <h2 id="sent-title" className="text-lg font-semibold">
            {t('applications.sentTitle')}
          </h2>
          <ul className="mt-2 list-disc ps-6 text-sm">
            {application.documents.map((document) => (
              <li key={document.id} dir="auto">
                {types(document.type)} · {document.originalName}
              </li>
            ))}
          </ul>
          {application.coverLetter ? (
            <>
              <h3 className="mt-4 text-sm font-semibold">{t('apply.coverLetter')}</h3>
              <p className="mt-1 text-sm whitespace-pre-wrap" dir="auto">
                {application.coverLetter}
              </p>
            </>
          ) : null}
        </section>
        <div className="flex flex-wrap gap-3">
          <Link href="/account/applications" className={cta.outline}>
            {t('applications.backToList')}
          </Link>
          <Link href={`/jobs/${application.job.slug}`} className={cta.ghost}>
            {t('applications.viewJob')}
          </Link>
          {application.canWithdraw ? (
            <button
              type="button"
              className={`${cta.outline} border-destructive text-destructive`}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('applications.withdraw')}
            </button>
          ) : null}
        </div>
      </div>
      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title={t('applications.withdrawTitle')}
        closeLabel={common('close')}
      >
        <p className="text-sm">
          {t('applications.withdrawText', { title: application.job.title })}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className={`${cta.primary} bg-destructive text-white hover:bg-destructive/90`}
            disabled={working}
            aria-busy={working}
            onClick={() => void withdraw()}
          >
            {t('applications.withdrawConfirm')}
          </button>
          <button
            type="button"
            className={cta.outline}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t('documents.cancel')}
          </button>
        </div>
      </Modal>
    </>
  );
}
