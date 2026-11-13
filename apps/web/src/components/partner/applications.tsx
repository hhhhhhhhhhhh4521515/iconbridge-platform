'use client';

import {
  createPartnerApplicationSchema,
  updatePartnerApplicationSchema,
} from '@iconbridge/shared/partner';
import {
  Check,
  Download,
  Eye,
  FileBadge,
  FileImage,
  FileText,
  FolderOpen,
  Stamp,
  Trash2,
  Truck,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { CountrySelect } from '@/components/forms/country-select';
import { fileForm } from '@/components/admin/image-cropper';
import { Modal } from '@/components/ui/modal';
import { countryName } from '@/lib/countries';
import {
  api,
  attempt,
  type PartnerApplication,
  type PartnerFile,
  type PartnerJob,
} from '@/lib/client-api';
import { partnerHref } from '@/lib/partner-locale';
import { cta } from '@/lib/ui';
import { Comments, HistoryList } from './activity';
import { DatePicker } from './date-picker';
import { FormField, input } from './jobs';
import {
  Avatar,
  card,
  CardTitle,
  Failed,
  formatDate,
  formatDateTime,
  IconTile,
  LoadingText,
  useIssueTexts,
  usePartner,
  usePartnerApiError,
  usePartnerCall,
  useSpace,
  VISA_STATUSES,
  VisaBadge,
  WORK_PERMIT_STATUSES,
  WorkPermitBadge,
  type VisaStatus,
  type WorkPermitStatus,
} from './partner-ui';

const FILE_KINDS = ['PASSPORT', 'CV', 'WORK_PERMIT'] as const;
type FileKind = (typeof FILE_KINDS)[number];

const backLink =
  'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground';

interface Values {
  firstName: string;
  lastName: string;
  nationality: string | null;
  phone: string;
  email: string;
  workPermitStatus: WorkPermitStatus;
  workPermitSubmittedDate: string;
  workPermitDecisionDate: string;
  visaStatus: VisaStatus;
  visaAppointmentDate: string;
  visaDecisionDate: string;
  dhlSentDate: string;
  dhlTrackingNumber: string;
  documentsReceivedDate: string;
}

type DateFieldName =
  | 'workPermitSubmittedDate'
  | 'workPermitDecisionDate'
  | 'visaAppointmentDate'
  | 'visaDecisionDate'
  | 'dhlSentDate'
  | 'documentsReceivedDate';

/** A work permit decision date only for a decided work permit (the API checks it again). */
const isDecided = (status: WorkPermitStatus) => status === 'APPROVED' || status === 'REFUSED';

const toValues = (application: PartnerApplication | null): Values => ({
  firstName: application?.firstName ?? '',
  lastName: application?.lastName ?? '',
  nationality: application?.nationality ?? null,
  phone: application?.phone ?? '',
  email: application?.email ?? '',
  workPermitStatus: application?.workPermitStatus ?? 'NOT_STARTED',
  workPermitSubmittedDate: application?.workPermitSubmittedDate ?? '',
  workPermitDecisionDate: application?.workPermitDecisionDate ?? '',
  visaStatus: application?.visaStatus ?? 'NOT_STARTED',
  visaAppointmentDate: application?.visaAppointmentDate ?? '',
  visaDecisionDate: application?.visaDecisionDate ?? '',
  dhlSentDate: application?.dhlSentDate ?? '',
  dhlTrackingNumber: application?.dhlTrackingNumber ?? '',
  documentsReceivedDate: application?.documentsReceivedDate ?? '',
});

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

const toBody = (values: Values) => ({
  firstName: values.firstName.trim(),
  lastName: values.lastName.trim(),
  nationality: values.nationality ?? '',
  phone: orNull(values.phone),
  email: orNull(values.email),
  workPermitStatus: values.workPermitStatus,
  workPermitSubmittedDate: orNull(values.workPermitSubmittedDate),
  // The field is hidden until the work permit is decided: a hidden date is not kept.
  workPermitDecisionDate: isDecided(values.workPermitStatus)
    ? orNull(values.workPermitDecisionDate)
    : null,
  visaStatus: values.visaStatus,
  visaAppointmentDate: orNull(values.visaAppointmentDate),
  visaDecisionDate: orNull(values.visaDecisionDate),
  dhlSentDate: orNull(values.dhlSentDate),
  dhlTrackingNumber: orNull(values.dhlTrackingNumber),
  documentsReceivedDate: orNull(values.documentsReceivedDate),
});

const sameValues = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A section of the form as a card. The legend floats so it sits inside the card instead of
 * on its border; the content clears it.
 */
function Section({
  icon,
  title,
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <fieldset className={`${card} min-w-0`} data-testid={testId}>
      <legend className="float-start mb-5 flex w-full items-center gap-3 text-lg font-semibold tracking-tight">
        <IconTile icon={icon} />
        {title}
      </legend>
      <div className="clear-both space-y-5">{children}</div>
    </fieldset>
  );
}

/** Create an application for a job demand, or edit one. */
function ApplicationForm({
  jobId,
  application,
  onSaved,
}: {
  jobId: string;
  application?: PartnerApplication;
  onSaved?: (application: PartnerApplication) => void;
}) {
  const t = useTranslations('partner.application');
  const visa = useTranslations('partner.visa');
  const permit = useTranslations('partner.workPermit');
  const errorText = useTranslations('partner.errors');
  const space = useSpace();
  const { lang } = usePartner();
  const router = useRouter();
  const call = usePartnerCall();
  const issueTexts = useIssueTexts();
  const [initial] = useState<Values>(() => toValues(application ?? null));
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = !sameValues(values, initial);
  const year = new Date().getUTCFullYear();
  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!application || !dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [application, dirty]);
  const set = (key: keyof Values) => (event: { target: { value: string } }) => {
    setValues({ ...values, [key]: event.target.value });
  };
  const custom = {
    'A decision date needs the visa status Approved or Refused': errorText('decisionNeedsStatus'),
    'A decision date needs the work permit status Approved or Refused': errorText(
      'permitDecisionNeedsStatus',
    ),
    'A tracking number needs the date it was sent': errorText('trackingNeedsDate'),
    phone: errorText('phone'),
    dhlTrackingNumber: errorText('tracking'),
  };
  const submit = async () => {
    const body = toBody(values);
    const parsed = application
      ? updatePartnerApplicationSchema.safeParse(body)
      : createPartnerApplicationSchema.safeParse({ ...body, jobId });
    // The rules between fields, checked on the whole form (the API checks them again).
    const rules = createPartnerApplicationSchema.safeParse({ ...body, jobId });
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues),
      ...(rules.success ? [] : rules.error.issues.filter((issue) => issue.code === 'custom')),
    ];
    if (issues.length > 0) {
      setErrors(issueTexts(issues, custom));
      return;
    }
    setErrors({});
    setBusy(true);
    const result = application
      ? await call(
          api.PATCH('/api/v1/partner-spaces/{spaceId}/applications/{applicationId}', {
            params: { path: { spaceId: space.id, applicationId: application.id } },
            body,
          }),
          t('saved'),
        )
      : await call(
          api.POST('/api/v1/partner-spaces/{spaceId}/applications', {
            params: { path: { spaceId: space.id } },
            body: { ...body, jobId },
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
      router.push(partnerHref(lang, `/spaces/${space.id}/applications/${result.data.id}`));
    }
  };
  const dateField = (key: DateFieldName, label: string, hint?: string) => (
    <DatePicker
      label={label}
      lang={lang}
      value={values[key]}
      onChange={(value) => {
        setValues((current) => ({ ...current, [key]: value }));
      }}
      fromYear={year - 3}
      toYear={year + 2}
      error={errors[key] ?? null}
      hint={hint}
    />
  );
  const statusSelect = <S extends string>(
    key: 'workPermitStatus' | 'visaStatus',
    label: string,
    statuses: readonly S[],
    text: (status: S) => string,
  ) => (
    <FormField label={label} error={errors[key]}>
      {(props) => (
        <select
          {...props}
          className={`${input} sm:max-w-xs`}
          value={values[key]}
          onChange={set(key)}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {text(status)}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
  return (
    <form
      className={`space-y-6 ${application && dirty ? 'pb-24' : ''}`}
      data-testid="application-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Section icon={UserRound} title={t('person')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label={t('firstName')} error={errors.firstName}>
            {(props) => (
              <input
                {...props}
                required
                maxLength={100}
                autoComplete="off"
                className={input}
                value={values.firstName}
                onChange={set('firstName')}
              />
            )}
          </FormField>
          <FormField label={t('lastName')} error={errors.lastName}>
            {(props) => (
              <input
                {...props}
                required
                maxLength={100}
                autoComplete="off"
                className={input}
                value={values.lastName}
                onChange={set('lastName')}
              />
            )}
          </FormField>
        </div>
        <div>
          <CountrySelect
            label={t('nationality')}
            name="nationality"
            required
            value={values.nationality}
            onChange={(code) => {
              setValues((current) => ({ ...current, nationality: code }));
            }}
          />
          {errors.nationality ? (
            <p role="alert" className="mt-1 text-sm font-medium text-destructive">
              {errors.nationality}
            </p>
          ) : null}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label={t('phone')} hint={t('phoneHint')} error={errors.phone}>
            {(props) => (
              <input
                {...props}
                type="tel"
                autoComplete="off"
                className={input}
                value={values.phone}
                onChange={set('phone')}
              />
            )}
          </FormField>
          <FormField label={t('email')} error={errors.email}>
            {(props) => (
              <input
                {...props}
                type="email"
                autoComplete="off"
                className={input}
                value={values.email}
                onChange={set('email')}
              />
            )}
          </FormField>
        </div>
      </Section>
      <Section icon={FileBadge} title={t('workPermit')} testId="work-permit-section">
        {statusSelect('workPermitStatus', t('workPermitStatus'), WORK_PERMIT_STATUSES, (status) =>
          permit(status),
        )}
        <div className="grid gap-5 md:grid-cols-2">
          {dateField('workPermitSubmittedDate', t('workPermitSubmitted'))}
          {isDecided(values.workPermitStatus)
            ? dateField('workPermitDecisionDate', t('decisionDate'), t('workPermitDecisionHint'))
            : null}
        </div>
        <p className="text-sm text-muted-foreground">{t('workPermitFileHint')}</p>
      </Section>
      <Section icon={Stamp} title={t('visa')}>
        {statusSelect('visaStatus', t('visaStatus'), VISA_STATUSES, (status) => visa(status))}
        <div className="grid gap-5 md:grid-cols-2">
          {dateField('visaAppointmentDate', t('appointmentDate'))}
          {dateField('visaDecisionDate', t('decisionDate'), t('decisionHint'))}
        </div>
      </Section>
      <Section icon={Truck} title={t('dhl')}>
        <div className="grid gap-5 md:grid-cols-2">
          {dateField('dhlSentDate', t('dhlSent'))}
          <FormField label={t('dhlTracking')} error={errors.dhlTrackingNumber}>
            {(props) => (
              <input
                {...props}
                maxLength={40}
                autoComplete="off"
                className={input}
                value={values.dhlTrackingNumber}
                onChange={set('dhlTrackingNumber')}
              />
            )}
          </FormField>
        </div>
        <div className="md:w-1/2 md:pe-2.5">
          {dateField('documentsReceivedDate', t('documentsReceived'))}
        </div>
      </Section>
      {application ? (
        // Editing: a bar fixed at the bottom of the screen once something changed.
        dirty ? (
          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 shadow-[0_-4px_16px_rgb(0_0_0/0.08)] backdrop-blur"
            data-testid="save-bar"
          >
            <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3">
              <p className="text-sm font-medium" role="status">
                {t('unsaved')}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cta.outline}
                  onClick={() => {
                    setValues(initial);
                    setErrors({});
                  }}
                >
                  {t('discard')}
                </button>
                <button type="submit" className={cta.primary} disabled={busy}>
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </div>
          </div>
        ) : null
      ) : (
        <div className="flex justify-end">
          <button type="submit" className={cta.primary} disabled={busy}>
            {t('create')}
          </button>
        </div>
      )}
    </form>
  );
}

export function NewApplication() {
  const t = useTranslations('partner.application');
  const space = useSpace();
  const { lang } = usePartner();
  const jobId = useSearchParams().get('jobId') ?? '';
  const [job, setJob] = useState<PartnerJob | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void attempt(
      api.GET('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}', {
        params: { path: { spaceId: space.id, jobId } },
      }),
    ).then(({ data }) => {
      if (!cancelled) {
        setJob(data ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, space.id]);
  if (job === undefined) {
    return <LoadingText variant="page" />;
  }
  if (job === null) {
    return (
      <Failed
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <NextLink href={partnerHref(lang, `/spaces/${space.id}/jobs/${job.id}`)} className={backLink}>
        <span aria-hidden>←</span> {t('back')}
      </NextLink>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('newTitle')}</h1>
        <p className="mt-1 text-muted-foreground">
          {t('job')}: {job.role}
        </p>
      </div>
      <ApplicationForm jobId={job.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

type StepState = 'done' | 'current' | 'refused' | 'todo';

/** The five steps of an application, from its saved state. */
function stepsOf(application: PartnerApplication) {
  const decided = (status: string): StepState =>
    status === 'APPROVED'
      ? 'done'
      : status === 'REFUSED'
        ? 'refused'
        : status === 'SUBMITTED'
          ? 'current'
          : 'todo';
  const reached = (value: unknown): StepState => (value ? 'done' : 'todo');
  return [
    {
      key: 'workPermit',
      state: decided(application.workPermitStatus),
      date: application.workPermitDecisionDate ?? application.workPermitSubmittedDate,
    },
    {
      key: 'appointment',
      state: reached(application.visaAppointmentDate ?? application.visaStatus !== 'NOT_STARTED'),
      date: application.visaAppointmentDate,
    },
    {
      key: 'decision',
      state: decided(application.visaStatus),
      date: application.visaDecisionDate,
    },
    { key: 'dhl', state: reached(application.dhlSentDate), date: application.dhlSentDate },
    {
      key: 'documents',
      state: reached(application.documentsReceivedDate),
      date: application.documentsReceivedDate,
    },
  ] as const;
}

const STEP_STYLES: Record<StepState, { circle: string; line: string }> = {
  done: {
    circle: 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950',
    line: 'bg-emerald-600 dark:bg-emerald-500',
  },
  current: {
    circle: 'border-2 border-blue-600 bg-background text-blue-700 dark:text-blue-300',
    line: 'bg-border',
  },
  refused: { circle: 'bg-red-600 text-white', line: 'bg-border' },
  todo: { circle: 'border-2 border-border bg-background text-muted-foreground', line: 'bg-border' },
};

/** Work permit → visa appointment → visa decision → DHL sent → documents received. */
function Stepper({ application }: { application: PartnerApplication }) {
  const t = useTranslations('partner.steps');
  const { lang } = usePartner();
  const steps = stepsOf(application);
  return (
    <section className={card} aria-labelledby="application-progress">
      <h2 id="application-progress" className="sr-only">
        {t('label')}
      </h2>
      <ol className="grid gap-4 md:grid-cols-5 md:gap-0" data-testid="progress-stepper">
        {steps.map((step, index) => (
          <li
            key={step.key}
            data-state={step.state}
            data-step={step.key}
            className="relative flex items-center gap-3 md:flex-col md:items-center md:gap-2 md:text-center"
          >
            {index > 0 ? (
              <span
                aria-hidden
                className={`absolute end-1/2 top-5 hidden h-0.5 w-full -translate-y-1/2 md:block ${STEP_STYLES[step.state === 'todo' ? 'todo' : (steps[index - 1]?.state ?? 'todo')].line}`}
              />
            ) : null}
            <span
              aria-hidden
              className={`relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${STEP_STYLES[step.state].circle}`}
            >
              {step.state === 'done' ? (
                <Check className="size-5" />
              ) : step.state === 'refused' ? (
                <X className="size-5" />
              ) : (
                index + 1
              )}
            </span>
            <span className="min-w-0 md:px-2">
              <span className="block text-sm font-semibold">{t(step.key)}</span>
              <span className="block text-xs text-muted-foreground">
                <span className="sr-only">{t(step.state)}: </span>
                {step.date ? formatDate(step.date, lang) : t(`${step.state}Short`)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 240 KB, 1.4 MB, in the reader's language. */
function formatSize(bytes: number, lang: string): string {
  const mb = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(lang, {
    style: 'unit',
    unit: mb ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: mb ? 1 : 0,
  }).format(mb ? bytes / (1024 * 1024) : Math.max(1, Math.round(bytes / 1024)));
}

function FileRow({
  kind,
  file,
  applicationId,
  onChanged,
}: {
  kind: FileKind;
  file: PartnerFile | null;
  applicationId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('partner.files');
  const space = useSpace();
  const { lang } = usePartner();
  const call = usePartnerCall();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const upload = async (chosen: File) => {
    setBusy(true);
    const result = await call(
      api.PUT('/api/v1/partner-spaces/{spaceId}/applications/{applicationId}/files/{kind}', {
        params: { path: { spaceId: space.id, applicationId, kind } },
        body: { file: '' } as never,
        bodySerializer: () => fileForm(chosen, chosen.name),
      }),
      t('uploaded'),
    );
    setBusy(false);
    if (result.ok) {
      onChanged();
    }
  };
  /** Each link is asked for when needed (5 minutes) and written to the history. */
  const open = async (inline: boolean) => {
    if (!file) {
      return;
    }
    // Opened at once, so the browser does not block it as a pop-up; filled when the link comes.
    const target = inline ? window.open('', '_blank') : null;
    const result = await call(
      api.GET('/api/v1/partner-spaces/{spaceId}/files/{fileId}/link', {
        params: {
          path: { spaceId: space.id, fileId: file.id },
          query: { inline: inline ? 'true' : 'false' },
        },
      }),
    );
    if (!result.ok) {
      target?.close();
      return;
    }
    if (target) {
      target.opener = null;
      target.location.href = result.data.url;
      return;
    }
    // Saved through a hidden frame: the page stays on screen whatever the storage answers.
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = t('download');
    frame.src = result.data.url;
    document.body.append(frame);
    window.setTimeout(() => {
      frame.remove();
    }, 60_000);
  };
  const formats = kind === 'CV' ? t('formatsCv') : t('formatsScan');
  const accept =
    kind === 'CV' ? `application/pdf,${DOCX},.docx` : 'application/pdf,image/jpeg,image/png';
  return (
    <li
      className={`rounded-xl border p-3 transition-colors ${
        over ? 'border-primary bg-muted' : 'border-border'
      }`}
      data-testid={`file-${kind}`}
      data-drop={over ? 'over' : undefined}
      // Dropping a file is a shortcut; the upload button does the same with the keyboard.
      onDragOver={(event) => {
        if (busy || !event.dataTransfer.types.includes('Files')) {
          return;
        }
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const dropped = event.dataTransfer.files[0];
        if (dropped && !busy) {
          void upload(dropped);
        }
      }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${
            file
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {!file ? (
            <FolderOpen className="size-5" />
          ) : file.mimeType.startsWith('image/') ? (
            <FileImage className="size-5" />
          ) : (
            <FileText className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t(kind)}</p>
          {file ? (
            <>
              <p className="truncate text-sm" title={file.originalName}>
                {file.originalName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatSize(file.sizeBytes, lang)} ·{' '}
                {t('by', {
                  name: file.uploadedBy ?? '—',
                  date: formatDateTime(file.uploadedAt, lang),
                })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('none')} ({formats})
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {file && file.mimeType !== DOCX ? (
          <button type="button" className={`${cta.outline} px-3`} onClick={() => void open(true)}>
            <Eye className="size-4" aria-hidden />
            {t('preview')}
            <span className="sr-only">: {t(kind)}</span>
          </button>
        ) : null}
        {file ? (
          <button type="button" className={`${cta.outline} px-3`} onClick={() => void open(false)}>
            <Download className="size-4" aria-hidden />
            {t('download')}
            <span className="sr-only">: {t(kind)}</span>
          </button>
        ) : null}
        <label
          htmlFor={inputId}
          className={`${cta.outline} cursor-pointer px-3`}
          aria-disabled={busy}
        >
          <Upload className="size-4" aria-hidden />
          {busy ? t('uploading') : file ? t('replace') : t('upload')}
          <span className="sr-only">: {t(kind)}</span>
        </label>
        <span className="hidden text-xs text-muted-foreground sm:inline">{t('orDrop')}</span>
        <input
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label={t('chooseFile', { kind: t(kind) })}
          data-testid={`file-input-${kind}`}
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) {
              void upload(chosen);
            }
          }}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Deleting (super admin and member, ADR-027 rule 11)
// ---------------------------------------------------------------------------

function DeleteApplication({
  application,
  onClose,
}: {
  application: PartnerApplication;
  onClose: () => void;
}) {
  const t = useTranslations('partner.delete');
  const ui = useTranslations('partner.ui');
  const space = useSpace();
  const { lang } = usePartner();
  const call = usePartnerCall();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const name = `${application.firstName} ${application.lastName}`;
  const files = FILE_KINDS.filter((kind) => application.files[kind]).length;
  const remove = async () => {
    setBusy(true);
    const result = await call(
      api.DELETE('/api/v1/partner-spaces/{spaceId}/applications/{applicationId}', {
        params: { path: { spaceId: space.id, applicationId: application.id } },
        body: { confirmName: typed.trim() },
      }),
      t('done'),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      window.location.assign(partnerHref(lang, `/spaces/${space.id}/jobs/${application.jobId}`));
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="delete-application-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed.trim() === name) {
          void remove();
        }
      }}
    >
      <div>
        <p className="text-sm font-medium">{t('willRemove')}</p>
        <ul className="mt-1 list-disc ps-6 text-sm">
          <li>{t('items', { files })}</li>
        </ul>
      </div>
      <p className="text-sm">{t('keeps')}</p>
      <FormField label={t('typeName', { name })}>
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
          disabled={busy || typed.trim() !== name}
        >
          {t('confirm')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Application detail
// ---------------------------------------------------------------------------

export function ApplicationDetail({ applicationId }: { applicationId: string }) {
  const t = useTranslations('partner.application');
  const filesText = useTranslations('partner.files');
  const deleteText = useTranslations('partner.delete');
  const history = useTranslations('partner.history');
  const common = useTranslations('common');
  const apiError = usePartnerApiError();
  const space = useSpace();
  const { lang, user } = usePartner();
  const [application, setApplication] = useState<PartnerApplication | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [version, setVersion] = useState(0);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void attempt(
      api.GET('/api/v1/partner-spaces/{spaceId}/applications/{applicationId}', {
        params: { path: { spaceId: space.id, applicationId } },
      }),
    ).then(({ data }) => {
      if (!cancelled) {
        setApplication(data ?? null);
        setVersion((value) => value + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId, asked, space.id]);
  const load = () => {
    setAsked((value) => value + 1);
  };
  if (application === undefined) {
    return <LoadingText variant="page" />;
  }
  if (application === null) {
    return (
      <div role="alert" className={card}>
        {apiError('NOT_FOUND')}
      </div>
    );
  }
  const name = `${application.firstName} ${application.lastName}`;
  return (
    <div className="space-y-6">
      <NextLink
        href={partnerHref(lang, `/spaces/${space.id}/jobs/${application.jobId}`)}
        className={backLink}
      >
        <span aria-hidden>←</span> {t('back')}
      </NextLink>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('job')}: {application.jobRole} · {countryName(application.nationality, lang)}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('workPermit')}:</span>
              <WorkPermitBadge status={application.workPermitStatus} />
              <span className="ms-2 text-muted-foreground">{t('visa')}:</span>
              <VisaBadge status={application.visaStatus} />
            </p>
            {application.updatedBy ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('updatedBy', {
                  name: application.updatedBy,
                  date: formatDateTime(application.updatedAt, lang),
                })}
              </p>
            ) : null}
          </div>
        </div>
        {/* Only a super admin who is a member may delete (ADR-027, answer 4); the API decides. */}
        {user.role === 'SUPER_ADMIN' ? (
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
      <Stepper application={application} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ApplicationForm
          key={version}
          jobId={application.jobId}
          application={application}
          onSaved={(saved) => {
            setApplication(saved);
            setVersion((value) => value + 1);
          }}
        />
        <div className="space-y-6">
          <section className={card} aria-labelledby="application-files">
            <CardTitle icon={FolderOpen} id="application-files">
              {filesText('title')}
            </CardTitle>
            <ul className="mt-5 space-y-3">
              {FILE_KINDS.map((kind) => (
                <FileRow
                  key={kind}
                  kind={kind}
                  file={application.files[kind]}
                  applicationId={application.id}
                  onChanged={load}
                />
              ))}
            </ul>
          </section>
          <Comments target={{ applicationId: application.id }} />
        </div>
      </div>
      <section className={card} aria-labelledby="application-history">
        <h2 id="application-history" className="mb-5 text-lg font-semibold tracking-tight">
          {history('title')}
        </h2>
        <HistoryList applicationId={application.id} key={version} />
      </section>
      <Modal
        open={deleting}
        onClose={() => {
          setDeleting(false);
        }}
        title={deleteText('title')}
        closeLabel={common('close')}
      >
        {deleting ? (
          <DeleteApplication
            application={application}
            onClose={() => {
              setDeleting(false);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
