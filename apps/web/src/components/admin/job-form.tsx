'use client';

import { createJobSchema } from '@iconbridge/shared/jobs';
import { Eye, Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading, useErrorText } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { RichText } from '@/components/ui/rich-text';
import { Link, useRouter } from '@/i18n/navigation';
import { api, type AdminJob, type JobQuestion } from '@/lib/client-api';
import { SPOKEN_LANGUAGES } from '@/lib/countries';
import { languageName, money, pick } from '@/lib/format';
import { issueKey } from '@/lib/forms';
import { card, cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import { fileForm, ImageCropper } from './image-cropper';
import { QuestionsEditor } from './questions-editor';
import { RichTextEditor } from './rich-text-editor';
import { JobBadge } from './status';
import { input, Labelled, PageHeader, shortDate, useCall } from './ui';

const PERIODS = ['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
const CURRENCIES = ['EUR', 'PLN', 'USD', 'GBP'] as const;
const LANGUAGES = SPOKEN_LANGUAGES.slice(0, 12);
const COVER_ASPECT = 16 / 9;

interface Values {
  title: string;
  destinationId: string;
  categoryId: string;
  employerName: string;
  showEmployerName: boolean;
  description: string;
  requirements: string;
  benefits: string;
  accommodationProvided: boolean;
  transportProvided: boolean;
  mealsProvided: boolean;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryPeriod: string;
  contractDurationMonths: string;
  workingHours: string;
  positions: string;
  requiredLanguages: string[];
  /** Local date and time, as <input type="datetime-local"> writes it. */
  deadline: string;
  questions: JobQuestion[];
}

const pad = (value: number) => String(value).padStart(2, '0');
/** ISO date to the local "YYYY-MM-DDTHH:mm" a datetime-local input needs. */
function toLocalInput(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initial(job: AdminJob | null): Values {
  const inAMonth = new Date(Date.now() + 30 * 86_400_000);
  inAMonth.setHours(23, 59, 0, 0);
  return {
    title: job?.title ?? '',
    destinationId: job?.destination.id ?? '',
    categoryId: job?.category.id ?? '',
    employerName: job?.employerName ?? '',
    showEmployerName: job?.showEmployerName ?? false,
    description: job?.description ?? '',
    requirements: job?.requirements ?? '',
    benefits: job?.benefits ?? '',
    accommodationProvided: job?.accommodationProvided ?? false,
    transportProvided: job?.transportProvided ?? false,
    mealsProvided: job?.mealsProvided ?? false,
    salaryMin: job?.salaryMin?.toString() ?? '',
    salaryMax: job?.salaryMax?.toString() ?? '',
    salaryCurrency: job?.salaryCurrency ?? '',
    salaryPeriod: job?.salaryPeriod ?? '',
    contractDurationMonths: job?.contractDurationMonths?.toString() ?? '',
    workingHours: job?.workingHours ?? '',
    positions: String(job?.positions ?? 1),
    requiredLanguages: job?.requiredLanguages ?? [],
    deadline: toLocalInput(job ? new Date(job.deadline) : inAMonth),
    questions: job?.questions ?? [],
  };
}

const text = (value: string) => (value.trim() === '' ? null : value.trim());
const number = (value: string) => (value.trim() === '' ? null : Number(value));

/** The form as the API expects it: empty fields become null, numbers become numbers. */
function toBody(values: Values) {
  const deadline = new Date(values.deadline);
  return {
    title: values.title,
    destinationId: values.destinationId,
    categoryId: values.categoryId,
    employerName: text(values.employerName),
    showEmployerName: values.showEmployerName,
    description: values.description,
    requirements: text(values.requirements),
    benefits: text(values.benefits),
    accommodationProvided: values.accommodationProvided,
    transportProvided: values.transportProvided,
    mealsProvided: values.mealsProvided,
    salaryMin: number(values.salaryMin),
    salaryMax: number(values.salaryMax),
    salaryCurrency: text(values.salaryCurrency),
    salaryPeriod: text(values.salaryPeriod),
    contractDurationMonths: number(values.contractDurationMonths),
    workingHours: text(values.workingHours),
    positions: Number(values.positions),
    requiredLanguages: values.requiredLanguages,
    deadline: Number.isNaN(deadline.getTime()) ? '' : deadline.toISOString(),
    questions: values.questions,
  };
}

/** The job as the public page will show it, built from what is in the form now. */
function Preview({
  values,
  cover,
  destination,
  category,
}: {
  values: Values;
  cover: string | null;
  destination: string;
  category: string;
}) {
  const t = useTranslations('admin.jobs');
  const locale = useLocale();
  const min = number(values.salaryMin);
  const max = number(values.salaryMax);
  const amount = (value: number) => money(value, values.salaryCurrency || null, locale);
  return (
    <article data-testid="job-preview">
      {cover ? (
        // A local preview of a picture that may not be uploaded yet.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />
      ) : null}
      <p className="text-sm text-muted-foreground">
        {destination} · {category}
      </p>
      <h3 className="mt-1 text-2xl font-bold">{values.title || t('untitled')}</h3>
      <p className="mt-1 text-sm">
        {min !== null || max !== null
          ? `${[min, max]
              .filter((value): value is number => value !== null)
              .map(amount)
              .join(
                ' – ',
              )}${values.salaryPeriod ? ` / ${t(`periods.${values.salaryPeriod as (typeof PERIODS)[number]}`)}` : ''}`
          : null}
      </p>
      <div className="mt-4 space-y-5">
        <section>
          <h4 className="mb-2 text-lg font-semibold">{t('fields.description')}</h4>
          <RichText text={values.description} />
        </section>
        {values.requirements ? (
          <section>
            <h4 className="mb-2 text-lg font-semibold">{t('fields.requirements')}</h4>
            <RichText text={values.requirements} />
          </section>
        ) : null}
        {values.benefits ? (
          <section>
            <h4 className="mb-2 text-lg font-semibold">{t('fields.benefits')}</h4>
            <RichText text={values.benefits} />
          </section>
        ) : null}
      </div>
    </article>
  );
}

function Form({
  job,
  catalog,
}: {
  job: AdminJob | null;
  catalog: {
    destinations: { id: string; name: { en: string; fr: string; ar: string }; isActive: boolean }[];
    categories: { id: string; name: { en: string; fr: string; ar: string }; isActive: boolean }[];
  };
}) {
  const t = useTranslations('admin.jobs');
  const locale = useLocale();
  const router = useRouter();
  const call = useCall();
  const errorText = useErrorText();
  const { can } = useAdmin();
  const editable = can('MANAGE_JOBS');
  const [values, setValues] = useState<Values>(() => initial(job));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [current, setCurrent] = useState(job);
  const [pendingCover, setPendingCover] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingCover) {
      return;
    }
    const url = URL.createObjectURL(pendingCover);
    const timer = window.setTimeout(() => {
      setCoverPreview(url);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [pendingCover]);

  const set = <Key extends keyof Values>(key: Key, value: Values[Key]) => {
    setValues((before) => ({ ...before, [key]: value }));
    setErrors((before) =>
      Object.fromEntries(Object.entries(before).filter(([name]) => name !== key)),
    );
  };
  const problem = (key: string) => (errors[key] ? errorText({ message: errors[key] }) : null);
  const fieldProps = (key: keyof Values) => ({
    'aria-invalid': Boolean(errors[key]),
    disabled: !editable,
  });
  const fieldError = (name: string) =>
    problem(name) ? (
      <span role="alert" className="mt-1 block text-sm font-medium text-destructive">
        {problem(name)}
      </span>
    ) : null;

  const uploadCover = async (id: string, file: Blob) =>
    call(
      api.POST('/api/v1/admin/jobs/{id}/cover', {
        params: { path: { id } },
        body: { file: '' } as never,
        bodySerializer: () => fileForm(file, 'cover.jpg'),
      }),
    );

  const save = async () => {
    const body = toBody(values);
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        found[String(issue.path[0] ?? 'title')] ??= issueKey(issue);
      }
      setErrors(found);
      toast.error(t('fixErrors'));
      return;
    }
    setSaving(true);
    const result = current
      ? await call(
          api.PATCH('/api/v1/admin/jobs/{id}', {
            params: { path: { id: current.id } },
            body: parsed.data as never,
          }),
          t('saved'),
        )
      : await call(api.POST('/api/v1/admin/jobs', { body: parsed.data as never }), t('created'));
    if (!result.ok) {
      setSaving(false);
      return;
    }
    let saved = result.data;
    if (pendingCover) {
      const uploaded = await uploadCover(saved.id, pendingCover);
      if (uploaded.ok) {
        saved = uploaded.data;
        setPendingCover(null);
        setCoverPreview(null);
      }
    }
    setSaving(false);
    setCurrent(saved);
    if (!current) {
      router.replace(`/admin/jobs/${saved.id}`);
    }
  };

  const transition = async (action: 'publish' | 'close' | 'reopen', message: string) => {
    if (!current) {
      return;
    }
    const result = await call(
      api.POST(`/api/v1/admin/jobs/{id}/${action}`, { params: { path: { id: current.id } } }),
      message,
    );
    if (result.ok) {
      setCurrent(result.data);
    }
  };
  const removeCover = async () => {
    setPendingCover(null);
    setCoverPreview(null);
    if (current?.coverImageUrl) {
      const result = await call(
        api.DELETE('/api/v1/admin/jobs/{id}/cover', { params: { path: { id: current.id } } }),
      );
      if (result.ok) {
        setCurrent(result.data);
      }
    }
  };

  const nameOf = (
    list: { id: string; name: { en: string; fr: string; ar: string } }[],
    id: string,
  ) => pick(list.find((entry) => entry.id === id)?.name, locale);
  const cover = coverPreview ?? current?.coverImageUrl ?? null;
  const section = `${card} p-5`;
  const heading = 'mb-4 text-lg font-semibold';

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <PageHeader title={current ? current.title : t('new')}>
        {current ? <JobBadge status={current.status} /> : null}
        <button
          type="button"
          className={cta.outline}
          onClick={() => {
            setPreviewing(true);
          }}
        >
          <Eye className="size-4" aria-hidden />
          {t('preview')}
        </button>
        {editable && current?.status === 'DRAFT' ? (
          <button
            type="button"
            className={cta.gold}
            onClick={() => void transition('publish', t('published'))}
          >
            {t('publish')}
          </button>
        ) : null}
        {editable && current?.status === 'PUBLISHED' ? (
          <button
            type="button"
            className={cta.outline}
            onClick={() => void transition('close', t('closed'))}
          >
            {t('close')}
          </button>
        ) : null}
        {editable && current?.status === 'CLOSED' ? (
          <button
            type="button"
            className={cta.outline}
            onClick={() => void transition('reopen', t('reopened'))}
          >
            {t('reopen')}
          </button>
        ) : null}
        {editable ? (
          <button type="submit" className={cta.primary} disabled={saving} aria-busy={saving}>
            {saving ? t('saving') : t('save')}
          </button>
        ) : null}
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className={section}>
            <h2 className={heading}>{t('sections.offer')}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Labelled label={`${t('fields.title')} *`} className="md:col-span-2">
                <input
                  className={input}
                  value={values.title}
                  {...fieldProps('title')}
                  onChange={(event) => {
                    set('title', event.target.value);
                  }}
                />
                {fieldError('title')}
              </Labelled>
              <Labelled label={`${t('destination')} *`}>
                <select
                  className={input}
                  value={values.destinationId}
                  {...fieldProps('destinationId')}
                  onChange={(event) => {
                    set('destinationId', event.target.value);
                  }}
                >
                  <option value="">{t('choose')}</option>
                  {catalog.destinations
                    .filter((entry) => entry.isActive || entry.id === values.destinationId)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {pick(entry.name, locale)}
                      </option>
                    ))}
                </select>
                {fieldError('destinationId')}
              </Labelled>
              <Labelled label={`${t('category')} *`}>
                <select
                  className={input}
                  value={values.categoryId}
                  {...fieldProps('categoryId')}
                  onChange={(event) => {
                    set('categoryId', event.target.value);
                  }}
                >
                  <option value="">{t('choose')}</option>
                  {catalog.categories
                    .filter((entry) => entry.isActive || entry.id === values.categoryId)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {pick(entry.name, locale)}
                      </option>
                    ))}
                </select>
                {fieldError('categoryId')}
              </Labelled>
              <Labelled label={t('fields.employerName')}>
                <input
                  className={input}
                  value={values.employerName}
                  {...fieldProps('employerName')}
                  onChange={(event) => {
                    set('employerName', event.target.value);
                  }}
                />
              </Labelled>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={values.showEmployerName}
                  disabled={!editable}
                  onChange={(event) => {
                    set('showEmployerName', event.target.checked);
                  }}
                />
                {t('fields.showEmployerName')}
              </label>
            </div>
          </section>

          <section className={`${section} space-y-4`}>
            <h2 className={heading}>{t('sections.texts')}</h2>
            <RichTextEditor
              testId="editor-description"
              label={t('fields.description')}
              required
              value={values.description}
              error={problem('description')}
              onChange={(html) => {
                set('description', html);
              }}
            />
            <RichTextEditor
              testId="editor-requirements"
              label={t('fields.requirements')}
              value={values.requirements}
              error={problem('requirements')}
              onChange={(html) => {
                set('requirements', html);
              }}
            />
            <RichTextEditor
              testId="editor-benefits"
              label={t('fields.benefits')}
              value={values.benefits}
              error={problem('benefits')}
              onChange={(html) => {
                set('benefits', html);
              }}
            />
            <div className="flex flex-wrap gap-x-6">
              {(['accommodationProvided', 'transportProvided', 'mealsProvided'] as const).map(
                (key) => (
                  <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={values[key]}
                      disabled={!editable}
                      onChange={(event) => {
                        set(key, event.target.checked);
                      }}
                    />
                    {t(`fields.${key}`)}
                  </label>
                ),
              )}
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>{t('sections.questions')}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t('questionsIntro')}</p>
            <fieldset disabled={!editable} className="m-0 min-w-0 border-0 p-0">
              <QuestionsEditor
                value={values.questions}
                onChange={(questions) => {
                  set('questions', questions);
                }}
              />
            </fieldset>
            {fieldError('questions')}
          </section>
        </div>

        <div className="space-y-5">
          <section className={section}>
            <h2 className={heading}>{t('sections.availability')}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Labelled label={`${t('fields.positions')} *`}>
                <input
                  type="number"
                  min={1}
                  className={input}
                  value={values.positions}
                  {...fieldProps('positions')}
                  onChange={(event) => {
                    set('positions', event.target.value);
                  }}
                />
                {fieldError('positions')}
              </Labelled>
              <Labelled label={`${t('fields.deadline')} *`}>
                <input
                  type="datetime-local"
                  className={input}
                  value={values.deadline}
                  {...fieldProps('deadline')}
                  onChange={(event) => {
                    set('deadline', event.target.value);
                  }}
                />
                {fieldError('deadline')}
              </Labelled>
            </div>
            <p className="mt-4 flex gap-2 rounded-lg bg-muted p-3 text-sm" data-testid="auto-close">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t('autoClose')}
                {current
                  ? ` ${t('autoCloseNow', {
                      hired: current.hiredCount,
                      positions: current.positions,
                      date: shortDate(current.deadline, locale),
                    })}`
                  : ''}
              </span>
            </p>
          </section>

          <section className={section}>
            <h2 className={heading}>{t('sections.conditions')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <Labelled label={t('fields.salaryMin')}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={input}
                  value={values.salaryMin}
                  {...fieldProps('salaryMin')}
                  onChange={(event) => {
                    set('salaryMin', event.target.value);
                  }}
                />
              </Labelled>
              <Labelled label={t('fields.salaryMax')}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={input}
                  value={values.salaryMax}
                  {...fieldProps('salaryMax')}
                  onChange={(event) => {
                    set('salaryMax', event.target.value);
                  }}
                />
                {fieldError('salaryMax')}
              </Labelled>
              <Labelled label={t('fields.salaryCurrency')}>
                <select
                  className={input}
                  value={values.salaryCurrency}
                  {...fieldProps('salaryCurrency')}
                  onChange={(event) => {
                    set('salaryCurrency', event.target.value);
                  }}
                >
                  <option value="">—</option>
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                {fieldError('salaryCurrency')}
              </Labelled>
              <Labelled label={t('fields.salaryPeriod')}>
                <select
                  className={input}
                  value={values.salaryPeriod}
                  {...fieldProps('salaryPeriod')}
                  onChange={(event) => {
                    set('salaryPeriod', event.target.value);
                  }}
                >
                  <option value="">—</option>
                  {PERIODS.map((period) => (
                    <option key={period} value={period}>
                      {t(`periods.${period}`)}
                    </option>
                  ))}
                </select>
                {fieldError('salaryPeriod')}
              </Labelled>
              <Labelled label={t('fields.contractDurationMonths')}>
                <input
                  type="number"
                  min={1}
                  className={input}
                  value={values.contractDurationMonths}
                  {...fieldProps('contractDurationMonths')}
                  onChange={(event) => {
                    set('contractDurationMonths', event.target.value);
                  }}
                />
              </Labelled>
              <Labelled label={t('fields.workingHours')}>
                <input
                  className={input}
                  value={values.workingHours}
                  {...fieldProps('workingHours')}
                  onChange={(event) => {
                    set('workingHours', event.target.value);
                  }}
                />
              </Labelled>
            </div>
            <fieldset className="mt-4" disabled={!editable}>
              <legend className="mb-1 text-sm font-medium">{t('fields.requiredLanguages')}</legend>
              <div className="grid grid-cols-2 gap-x-3">
                {LANGUAGES.map((code) => (
                  <label key={code} className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={values.requiredLanguages.includes(code)}
                      onChange={(event) => {
                        set(
                          'requiredLanguages',
                          event.target.checked
                            ? [...values.requiredLanguages, code]
                            : values.requiredLanguages.filter((entry) => entry !== code),
                        );
                      }}
                    />
                    {languageName(code, locale)}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section className={section}>
            <h2 className={heading}>{t('sections.cover')}</h2>
            {cover ? (
              // Either a local preview or a picture already stored by the API.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cover}
                alt=""
                className="mb-3 aspect-video w-full rounded-lg object-cover"
                data-testid="cover-image"
              />
            ) : (
              <p className="mb-3 rounded-lg bg-muted p-4 text-sm">{t('noCover')}</p>
            )}
            {editable ? (
              <div className="flex flex-wrap gap-2">
                <ImageCropper
                  aspect={COVER_ASPECT}
                  label={cover ? t('changeCover') : t('addCover')}
                  onCropped={setPendingCover}
                />
                {cover ? (
                  <button type="button" className={cta.ghost} onClick={() => void removeCover()}>
                    {t('removeCover')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {pendingCover ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('coverPending')}</p>
            ) : null}
          </section>
        </div>
      </div>

      <Modal
        open={previewing}
        onClose={() => {
          setPreviewing(false);
        }}
        title={t('previewTitle')}
        closeLabel={t('closePreview')}
        wide
      >
        <Preview
          values={values}
          cover={cover}
          destination={nameOf(catalog.destinations, values.destinationId)}
          category={nameOf(catalog.categories, values.categoryId)}
        />
        {current?.status === 'PUBLISHED' ? (
          <Link
            href={`/jobs/${current.slug}`}
            target="_blank"
            className="mt-4 inline-block text-sm font-medium underline"
          >
            {t('openPublic')}
          </Link>
        ) : null}
      </Modal>
    </form>
  );
}

/** Create a job (no id) or edit one. */
export function JobForm({ id }: { id?: string }) {
  const fetcher = useCallback(async () => {
    const [destinations, categories, job] = await Promise.all([
      api.GET('/api/v1/admin/destinations'),
      api.GET('/api/v1/admin/categories'),
      id ? api.GET('/api/v1/admin/jobs/{id}', { params: { path: { id } } }) : null,
    ]);
    if (!destinations.data || !categories.data || (job && !job.data)) {
      return undefined;
    }
    return {
      catalog: { destinations: destinations.data, categories: categories.data },
      job: job?.data ?? null,
    };
  }, [id]);
  const { data, loading, failed, reload } = useLoaded(fetcher);
  if (loading && !data) {
    return <Loading lines={6} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  return <Form key={data.job?.id ?? 'new'} job={data.job} catalog={data.catalog} />;
}
