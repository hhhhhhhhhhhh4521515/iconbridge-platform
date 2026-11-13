'use client';

import {
  createPartnerApplicationSchema,
  updatePartnerApplicationSchema,
} from '@iconbridge/shared/partner';
import { Download, Eye, Upload } from 'lucide-react';
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { CountrySelect } from '@/components/forms/country-select';
import { DateSelects } from '@/components/forms/date-field';
import { fileForm } from '@/components/admin/image-cropper';
import { Modal } from '@/components/ui/modal';
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
import { FormField, input } from './jobs';
import {
  card,
  Failed,
  formatDateTime,
  heading,
  LoadingText,
  useIssueTexts,
  usePartner,
  usePartnerApiError,
  usePartnerCall,
  useSpace,
} from './partner-ui';

const VISA_STATUSES = [
  'NOT_STARTED',
  'APPOINTMENT_BOOKED',
  'SUBMITTED',
  'APPROVED',
  'REFUSED',
] as const;
type VisaStatus = (typeof VISA_STATUSES)[number];
const FILE_KINDS = ['PASSPORT', 'CV', 'WORK_PERMIT'] as const;
type FileKind = (typeof FILE_KINDS)[number];

interface Values {
  firstName: string;
  lastName: string;
  nationality: string | null;
  phone: string;
  email: string;
  visaStatus: VisaStatus;
  visaAppointmentDate: string;
  visaDecisionDate: string;
  dhlSentDate: string;
  dhlTrackingNumber: string;
  documentsReceivedDate: string;
}

type DateFieldName =
  'visaAppointmentDate' | 'visaDecisionDate' | 'dhlSentDate' | 'documentsReceivedDate';

const toValues = (application: PartnerApplication | null): Values => ({
  firstName: application?.firstName ?? '',
  lastName: application?.lastName ?? '',
  nationality: application?.nationality ?? null,
  phone: application?.phone ?? '',
  email: application?.email ?? '',
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
  visaStatus: values.visaStatus,
  visaAppointmentDate: orNull(values.visaAppointmentDate),
  visaDecisionDate: orNull(values.visaDecisionDate),
  dhlSentDate: orNull(values.dhlSentDate),
  dhlTrackingNumber: orNull(values.dhlTrackingNumber),
  documentsReceivedDate: orNull(values.documentsReceivedDate),
});

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
  const errorText = useTranslations('partner.errors');
  const space = useSpace();
  const { lang } = usePartner();
  const router = useRouter();
  const call = usePartnerCall();
  const issueTexts = useIssueTexts();
  const [values, setValues] = useState<Values>(() => toValues(application ?? null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const year = new Date().getUTCFullYear();
  const set = (key: keyof Values) => (event: { target: { value: string } }) => {
    setValues({ ...values, [key]: event.target.value });
  };
  const custom = {
    'A decision date needs the visa status Approved or Refused': errorText('decisionNeedsStatus'),
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
    <DateSelects
      label={label}
      value={values[key]}
      onChange={(value) => {
        setValues((current) => ({ ...current, [key]: value }));
      }}
      fromYear={year + 2}
      toYear={year - 3}
      error={errors[key] ?? null}
      {...(hint ? { hint } : {})}
    />
  );
  return (
    <form
      className="space-y-6"
      data-testid="application-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="space-y-4">
        <legend className={`${heading} mb-2`}>{t('person')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <p role="alert" className="-mt-2 text-sm font-medium text-destructive">
            {errors.nationality}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
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
      </fieldset>
      <fieldset className="space-y-4">
        <legend className={`${heading} mb-2`}>{t('visa')}</legend>
        <FormField label={t('visaStatus')} error={errors.visaStatus}>
          {(props) => (
            <select
              {...props}
              className={`${input} max-w-xs`}
              value={values.visaStatus}
              onChange={set('visaStatus')}
            >
              {VISA_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {visa(status)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <div className="grid gap-4 md:grid-cols-2">
          {dateField('visaAppointmentDate', t('appointmentDate'))}
          {dateField('visaDecisionDate', t('decisionDate'), t('decisionHint'))}
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className={`${heading} mb-2`}>{t('dhl')}</legend>
        <div className="grid gap-4 md:grid-cols-2">
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
        {dateField('documentsReceivedDate', t('documentsReceived'))}
      </fieldset>
      <div className="flex justify-end">
        <button type="submit" className={cta.primary} disabled={busy}>
          {application ? t('save') : t('create')}
        </button>
      </div>
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
    return <LoadingText />;
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
    <div className="mx-auto max-w-3xl space-y-4">
      <NextLink
        href={partnerHref(lang, `/spaces/${space.id}/jobs/${job.id}`)}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t('back')}
      </NextLink>
      <div className={card}>
        <h1 className="text-2xl font-bold tracking-tight">{t('newTitle')}</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          {t('job')}: {job.role}
        </p>
        <ApplicationForm jobId={job.id} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

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
    kind === 'CV'
      ? 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx'
      : 'application/pdf,image/jpeg,image/png';
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 py-3"
      data-testid={`file-${kind}`}
    >
      <div className="min-w-0">
        <p className="font-medium">{t(kind)}</p>
        {file ? (
          <p className="truncate text-sm text-muted-foreground">
            {file.originalName} ·{' '}
            {t('by', { name: file.uploadedBy ?? '—', date: formatDateTime(file.uploadedAt, lang) })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('none')} ({formats})
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {file &&
        file.mimeType !==
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? (
          <button type="button" className={cta.outline} onClick={() => void open(true)}>
            <Eye className="size-4" aria-hidden />
            {t('preview')}
            <span className="sr-only">: {t(kind)}</span>
          </button>
        ) : null}
        {file ? (
          <button type="button" className={cta.outline} onClick={() => void open(false)}>
            <Download className="size-4" aria-hidden />
            {t('download')}
            <span className="sr-only">: {t(kind)}</span>
          </button>
        ) : null}
        <label htmlFor={inputId} className={`${cta.outline} cursor-pointer`} aria-disabled={busy}>
          <Upload className="size-4" aria-hidden />
          {busy ? t('uploading') : file ? t('replace') : t('upload')}
          <span className="sr-only">: {t(kind)}</span>
        </label>
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
    return <LoadingText />;
  }
  if (application === null) {
    return (
      <div role="alert" className={card}>
        {apiError('NOT_FOUND')}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <NextLink
        href={partnerHref(lang, `/spaces/${space.id}/jobs/${application.jobId}`)}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        ← {t('back')}
      </NextLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {application.firstName} {application.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('job')}: {application.jobRole}
            {application.updatedBy
              ? ` · ${t('updatedBy', { name: application.updatedBy, date: formatDateTime(application.updatedAt, lang) })}`
              : ''}
          </p>
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
            {deleteText('button')}
          </button>
        ) : null}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className={card} aria-label={t('save')}>
          <ApplicationForm
            key={version}
            jobId={application.jobId}
            application={application}
            onSaved={(saved) => {
              setApplication(saved);
              setVersion((value) => value + 1);
            }}
          />
        </section>
        <div className="space-y-5">
          <section className={card} aria-labelledby="application-files">
            <h2 id="application-files" className={heading}>
              {filesText('title')}
            </h2>
            <ul className="divide-y divide-border">
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
        <h2 id="application-history" className={`${heading} mb-3`}>
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
