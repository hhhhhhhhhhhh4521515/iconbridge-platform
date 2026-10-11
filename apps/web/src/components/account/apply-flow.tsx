'use client';

import { applySchema } from '@iconbridge/shared/candidate';
import { ANSWER_NO, ANSWER_YES, answerText, checkAnswers } from '@iconbridge/shared/questions';
import { CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import {
  FormError,
  LoadFailed,
  Loading,
  Notice,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  useApiErrorText,
  useErrorText,
} from '@/components/forms/fields';
import { Turnstile } from '@/components/forms/turnstile';
import { Link } from '@/i18n/navigation';
import { api, attempt, failure, type Eligibility, type Job } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { card, cta } from '@/lib/ui';
import { useZodForm } from '@/lib/use-zod-form';
import { useAccount, useLoaded } from './account-context';
import { PageTitle } from './account-shell';
import { ITEM_LINKS } from './dashboard';
import { useDate } from './status';

/**
 * Questions asked when the job has none of its own. Their keys are what recruiters read in the
 * back office, so they are plain English; the candidate sees the translated question.
 */
const QUESTIONS = [
  { key: 'Earliest start date', label: 'startDate', long: false },
  { key: 'Relevant experience', label: 'experience', long: true },
] as const;

const letterSchema = applySchema.pick({ coverLetter: true, answers: true });
interface LetterValues {
  coverLetter: string | null;
  answers: Record<string, string>;
}

/** Why the candidate cannot apply now, each reason with the way to fix it. */
function Blocked({ eligibility }: { eligibility: Eligibility }) {
  const t = useTranslations('account');
  const date = useDate();
  const has = (reason: Eligibility['reasons'][number]) => eligibility.reasons.includes(reason);
  return (
    <div className={`${card} space-y-4 p-5`} data-testid="apply-blocked">
      <h2 className="text-lg font-semibold">{t('apply.blockedTitle')}</h2>
      {has('REAPPLY_COOLDOWN') && eligibility.nextAllowedAt ? (
        <div
          role="status"
          data-testid="apply-cooldown"
          className="rounded-xl border border-brand-gold bg-brand-gold-soft p-4 text-foreground"
        >
          <p className="font-medium">
            {eligibility.lastAppliedAt
              ? t('apply.alreadyApplied', { date: date(eligibility.lastAppliedAt) })
              : null}
          </p>
          <p className="mt-1 text-lg font-bold">
            {t('apply.cooldown', { date: date(eligibility.nextAllowedAt) })}
          </p>
          <Link href="/account/applications" className={`${cta.outline} mt-3`}>
            {t('apply.viewApplications')}
          </Link>
        </div>
      ) : null}
      {has('EMAIL_NOT_VERIFIED') ? <Notice tone="warning">{t('apply.verifyEmail')}</Notice> : null}
      {has('JOB_NOT_OPEN') ? <Notice>{t('apply.notOpen')}</Notice> : null}
      {has('MAX_ACTIVE_APPLICATIONS') ? <Notice>{t('apply.maxActive')}</Notice> : null}
      {has('PASSPORT_EXPIRED') ? (
        <div className="space-y-2">
          <Notice tone="warning">{t('apply.passportExpired')}</Notice>
          <Link href="/account/profile?step=passport" className={cta.outline}>
            {t('documents.updatePassport')}
          </Link>
        </div>
      ) : null}
      {has('PROFILE_INCOMPLETE') ? (
        <div>
          <p className="text-sm font-medium">{t('apply.profileIncomplete')}</p>
          <ul className="mt-1 list-disc ps-6" data-testid="apply-missing">
            {eligibility.missing.map((item) => (
              <li key={item}>
                <Link
                  href={ITEM_LINKS[item]}
                  className="inline-flex min-h-9 items-center text-sm underline"
                >
                  {t(`items.${item}`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Link href="/jobs" className={cta.ghost}>
        {t('dashboard.browseJobs')}
      </Link>
    </div>
  );
}

type Stage = 'documents' | 'letter' | 'review';
const STAGES: Stage[] = ['documents', 'letter', 'review'];

function Wizard({
  job,
  eligibility,
  siteKey,
  onBlocked,
}: {
  job: Job;
  eligibility: Eligibility;
  siteKey: string;
  onBlocked: () => void;
}) {
  const t = useTranslations('account');
  const forms = useTranslations('forms');
  const types = useTranslations('account.documentTypes');
  const apiError = useApiErrorText();
  const date = useDate();
  const locale = useLocale() as 'en' | 'fr' | 'ar';
  const errorText = useErrorText();
  const { documents } = useAccount();
  // The questions the recruiter wrote for this job; without any, two general ones are asked.
  const asked = job.questions;
  const [stage, setStage] = useState<Stage>('documents');
  // The newest CV and the newest passport scan are ticked from the start.
  const [selected, setSelected] = useState<string[]>(() =>
    (['CV', 'PASSPORT'] as const).flatMap(
      (type) => documents.find((document) => document.type === type)?.id ?? [],
    ),
  );
  const [letter, setLetter] = useState<{
    coverLetter: string | null;
    answers: Record<string, string>;
  }>({
    coverLetter: null,
    answers: {},
  });
  const [documentsProblem, setDocumentsProblem] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
  }, []);
  const form = useZodForm<typeof letterSchema, LetterValues>(
    letterSchema,
    {
      coverLetter: '',
      answers: Object.fromEntries(
        (asked.length > 0 ? asked.map(({ id }) => id) : QUESTIONS.map(({ key }) => key)).map(
          (key) => [key, ''],
        ),
      ),
    },
    {
      // Empty answers are left out; an empty letter is "no letter".
      prepare: (values) => ({
        coverLetter: values.coverLetter?.trim() ? values.coverLetter : null,
        answers: Object.fromEntries(
          Object.entries(values.answers).filter(([, answer]) => answer.trim() !== ''),
        ),
      }),
    },
  );

  /** The answers are checked with the rule the API applies; each problem is shown under its question. */
  const answersOk = (answers: Record<string, string>): boolean => {
    const problems = asked.length > 0 ? checkAnswers(asked, answers) : [];
    for (const { question, problem } of problems) {
      form.setError(`answers.${question}`, {
        message: problem === 'required' ? 'required' : 'invalid',
      });
    }
    return problems.length === 0;
  };

  const chosen = documents.filter((document) => selected.includes(document.id));
  const types_ = new Set(chosen.map((document) => document.type));
  const documentsOk = types_.has('CV') && types_.has('PASSPORT');

  const submit = async () => {
    setSending(true);
    setProblem(null);
    const { data, error } = await attempt(
      api.POST('/api/v1/jobs/{id}/apply', {
        params: { path: { id: job.id } },
        body: {
          documentIds: selected,
          coverLetter: letter.coverLetter,
          answers: letter.answers,
          turnstileToken: token ?? '',
        },
      }),
    );
    setSending(false);
    if (data) {
      setApplicationId(data.id);
      return;
    }
    const refused = failure(error);
    if (refused.code === 'REAPPLY_COOLDOWN' && refused.nextAllowedAt) {
      setCooldown(refused.nextAllowedAt);
      return;
    }
    if (['PROFILE_INCOMPLETE', 'PASSPORT_EXPIRED', 'EMAIL_NOT_VERIFIED'].includes(refused.code)) {
      onBlocked();
      return;
    }
    setProblem(apiError(refused.code));
  };

  if (applicationId) {
    return (
      <div className={`${card} space-y-4 p-8 text-center`} data-testid="apply-success">
        <CircleCheck className="mx-auto size-14 text-emerald-600" aria-hidden />
        <h2 className="text-xl font-bold" role="status">
          {t('apply.successTitle')}
        </h2>
        <p className="text-muted-foreground">{t('apply.successText', { title: job.title })}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/account/applications/${applicationId}`} className={cta.primary}>
            {t('apply.viewApplication')}
          </Link>
          <Link href="/jobs" className={cta.outline}>
            {t('apply.moreJobs')}
          </Link>
        </div>
      </div>
    );
  }
  if (cooldown) {
    return (
      <div
        role="alert"
        data-testid="apply-cooldown"
        className={`${card} space-y-3 border-brand-gold p-5`}
      >
        <p className="text-lg font-bold">{t('apply.cooldown', { date: date(cooldown) })}</p>
        <Link href="/account/applications" className={cta.outline}>
          {t('apply.viewApplications')}
        </Link>
      </div>
    );
  }

  const position = STAGES.indexOf(stage) + 1;
  return (
    <div className={`${card} p-5`}>
      <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
        {t('apply.step', { current: position, total: STAGES.length })}
      </p>
      {eligibility.passportExpiringSoon ? (
        <div className="mt-3">
          <Notice tone="warning">{t('apply.passportExpiringSoon')}</Notice>
        </div>
      ) : null}

      {stage === 'documents' ? (
        <div className="mt-3 space-y-4">
          <fieldset>
            <legend className="text-lg font-semibold">{t('apply.documentsTitle')}</legend>
            <p className="text-sm text-muted-foreground">{t('apply.documentsText')}</p>
            <div className="mt-2 divide-y divide-border" data-testid="apply-documents">
              {documents.map((document) => (
                <label key={document.id} className="flex min-h-11 items-center gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 rounded border-input accent-primary"
                    checked={selected.includes(document.id)}
                    onChange={(event) => {
                      setDocumentsProblem(false);
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, document.id]
                          : current.filter((id) => id !== document.id),
                      );
                    }}
                  />
                  <span>
                    <span className="font-medium">{types(document.type)}</span>
                    <span className="text-muted-foreground" dir="auto">
                      {' '}
                      · {document.originalName}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {documentsProblem ? <FormError>{t('apply.documentsRequired')}</FormError> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={cta.primary}
              onClick={() => {
                if (documentsOk && selected.length <= 10) {
                  setStage('letter');
                } else {
                  setDocumentsProblem(true);
                }
              }}
            >
              {t('apply.next')}
            </button>
            <Link href="/account/documents" className={cta.outline}>
              {t('apply.manageDocuments')}
            </Link>
          </div>
        </div>
      ) : null}

      {stage === 'letter' ? (
        <form
          noValidate
          className="mt-3 space-y-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              const answers = values.answers ?? {};
              if (!answersOk(answers)) {
                return;
              }
              setLetter({ coverLetter: values.coverLetter ?? null, answers });
              setStage('review');
            })(event)
          }
        >
          <h2 className="text-lg font-semibold">{t('apply.letterTitle')}</h2>
          <TextAreaField
            label={t('apply.coverLetter')}
            hint={t('apply.coverLetterHint')}
            rows={7}
            error={form.formState.errors.coverLetter}
            {...form.register('coverLetter')}
          />
          {asked.map((question) => {
            const name = `answers.${question.id}` as const;
            const label = question.label[locale];
            const error = form.formState.errors.answers?.[question.id];
            if (question.type === 'TEXT') {
              return (
                <TextAreaField
                  key={question.id}
                  label={label}
                  required={question.required}
                  hint={question.required ? undefined : t('apply.optional')}
                  error={error}
                  {...form.register(name)}
                />
              );
            }
            if (question.type === 'SINGLE_CHOICE') {
              return (
                <SelectField
                  key={question.id}
                  label={label}
                  required={question.required}
                  error={error}
                  {...form.register(name)}
                >
                  <option value="">{forms('choose')}</option>
                  {question.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label[locale]}
                    </option>
                  ))}
                </SelectField>
              );
            }
            return (
              <fieldset key={question.id} data-testid={`question-${question.id}`}>
                <legend className="mb-1 text-sm font-medium">
                  {label}
                  {question.required ? <span className="text-destructive"> *</span> : null}
                </legend>
                <div className="flex gap-6">
                  {(
                    [
                      [ANSWER_YES, t('apply.yes')],
                      [ANSWER_NO, t('apply.no')],
                    ] as const
                  ).map(([value, text]) => (
                    <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        value={value}
                        className="size-5 accent-primary"
                        {...form.register(name)}
                      />
                      {text}
                    </label>
                  ))}
                </div>
                {error ? (
                  <p role="alert" className="mt-1 text-sm font-medium text-destructive">
                    {errorText(error)}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
          {(asked.length > 0 ? [] : QUESTIONS).map((question) =>
            question.long ? (
              <TextAreaField
                key={question.key}
                label={t(`apply.questions.${question.label}`)}
                hint={t('apply.optional')}
                error={form.formState.errors.answers?.[question.key]}
                {...form.register(`answers.${question.key}`)}
              />
            ) : (
              <TextField
                key={question.key}
                label={t(`apply.questions.${question.label}`)}
                hint={t('apply.optional')}
                error={form.formState.errors.answers?.[question.key]}
                {...form.register(`answers.${question.key}`)}
              />
            ),
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={cta.outline}
              onClick={() => {
                setStage('documents');
              }}
            >
              {t('apply.back')}
            </button>
            <SubmitButton busy={false}>{t('apply.next')}</SubmitButton>
          </div>
        </form>
      ) : null}

      {stage === 'review' ? (
        <div className="mt-3 space-y-4" data-testid="apply-review">
          <h2 className="text-lg font-semibold">{t('apply.reviewTitle')}</h2>
          <dl className="divide-y divide-border text-sm">
            <div className="py-3">
              <dt className="font-medium text-muted-foreground">{t('apply.reviewJob')}</dt>
              <dd className="font-semibold">{job.title}</dd>
            </div>
            <div className="py-3">
              <dt className="font-medium text-muted-foreground">{t('apply.reviewDocuments')}</dt>
              <dd>
                <ul>
                  {chosen.map((document) => (
                    <li key={document.id} dir="auto">
                      {types(document.type)} · {document.originalName}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="py-3">
              <dt className="font-medium text-muted-foreground">{t('apply.coverLetter')}</dt>
              <dd className="whitespace-pre-wrap" dir="auto">
                {letter.coverLetter ?? t('apply.none')}
              </dd>
            </div>
            {asked
              .filter((question) => letter.answers[question.id])
              .map((question) => (
                <div key={question.id} className="py-3">
                  <dt className="font-medium text-muted-foreground">{question.label[locale]}</dt>
                  <dd className="whitespace-pre-wrap" dir="auto">
                    {answerText(question, letter.answers[question.id] ?? '', locale)}
                  </dd>
                </div>
              ))}
            {(asked.length > 0 ? [] : QUESTIONS)
              .filter((question) => letter.answers[question.key])
              .map((question) => (
                <div key={question.key} className="py-3">
                  <dt className="font-medium text-muted-foreground">
                    {t(`apply.questions.${question.label}`)}
                  </dt>
                  <dd className="whitespace-pre-wrap" dir="auto">
                    {letter.answers[question.key]}
                  </dd>
                </div>
              ))}
          </dl>
          <Turnstile siteKey={siteKey} onToken={onToken} label={t('apply.captcha')} />
          <FormError>{problem}</FormError>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={cta.outline}
              disabled={sending}
              onClick={() => {
                setStage('letter');
              }}
            >
              {t('apply.back')}
            </button>
            <button
              type="button"
              className={cta.gold}
              disabled={sending || !token}
              aria-busy={sending}
              onClick={() => void submit()}
            >
              {sending ? t('apply.sending') : t('apply.submit')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ApplyFlow({ slug, siteKey }: { slug: string; siteKey: string }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const fetcher = useCallback(async () => {
    const job = await api.GET('/api/v1/jobs/{slug}', { params: { path: { slug } } });
    if (!job.data) {
      return job.response.status === 404 ? { job: null, eligibility: null } : undefined;
    }
    const eligibility = await api.GET('/api/v1/jobs/{id}/eligibility', {
      params: { path: { id: job.data.id } },
    });
    return eligibility.data ? { job: job.data, eligibility: eligibility.data } : undefined;
  }, [slug]);
  const { data, loading, failed, reload } = useLoaded(fetcher);

  if (loading && !data) {
    return <Loading lines={4} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  if (!data.job) {
    return (
      <div className={`${card} space-y-3 p-5`}>
        <Notice>{t('apply.notOpen')}</Notice>
        <Link href="/jobs" className={cta.primary}>
          {t('dashboard.browseJobs')}
        </Link>
      </div>
    );
  }
  return (
    <>
      <PageTitle
        title={t('apply.title', { title: data.job.title })}
        intro={pick(data.job.destination.name, locale)}
        action={
          <Link href={`/jobs/${data.job.slug}`} className={cta.ghost}>
            {t('apply.backToJob')}
          </Link>
        }
      />
      {data.eligibility.canApply ? (
        <Wizard
          job={data.job}
          eligibility={data.eligibility}
          siteKey={siteKey}
          onBlocked={reload}
        />
      ) : (
        <Blocked eligibility={data.eligibility} />
      )}
    </>
  );
}
