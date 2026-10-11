'use client';

import { DOCUMENT_FORMATS, utcDateString } from '@iconbridge/shared/candidate';
import { DOCUMENT_TYPES, type DocumentType } from '@iconbridge/shared/enums';
import { Download, Eye, FileText, Image as ImageIcon, Trash2, UploadCloud } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { control, FormError, useApiErrorText } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { Link } from '@/i18n/navigation';
import {
  api,
  attempt,
  failure,
  refreshSession,
  sessionLost,
  type CandidateDocument,
} from '@/lib/client-api';
import { card, cta } from '@/lib/ui';
import { refusal } from '@/lib/uploads';
import { useAccount, useLoaded } from './account-context';
import { useDate } from './status';

const DEFAULT_MAX_MB = 5;
const UPLOAD_URL = '/api/v1/me/documents';
const downloadUrl = (id: string, inline = false) =>
  `/api/v1/documents/${id}/download${inline ? '?inline=true' : ''}`;

/** Sends one file with XMLHttpRequest, the only browser API that reports upload progress. */
function send(
  file: File,
  type: DocumentType,
  onProgress: (percent: number) => void,
): Promise<number | string> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append('type', type);
    body.append('file', file);
    request.open('POST', UPLOAD_URL);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => {
      resolve('INTERNAL_ERROR');
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.status);
        return;
      }
      if (request.status === 401) {
        resolve(401);
        return;
      }
      try {
        resolve(failure(JSON.parse(request.responseText)).code);
      } catch {
        resolve('INTERNAL_ERROR');
      }
    };
    request.send(body);
  });
}

/** Uploads a file; an expired access token is renewed once, like every other call. */
async function upload(
  file: File,
  type: DocumentType,
  onProgress: (percent: number) => void,
): Promise<string | null> {
  let result = await send(file, type, onProgress);
  if (result === 401) {
    if (!(await refreshSession())) {
      sessionLost();
      return 'UNAUTHENTICATED';
    }
    result = await send(file, type, onProgress);
  }
  return typeof result === 'number' && result < 300 ? null : String(result);
}

function useSize(): (bytes: number) => string {
  const locale = useLocale();
  return (bytes) => {
    const [value, unit] =
      bytes >= 1024 * 1024 ? [bytes / 1024 / 1024, 'megabyte'] : [bytes / 1024, 'kilobyte'];
    return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(
      value,
    );
  };
}

/** Banner about the passport of the profile: expired (blocks applying) or expiring within 6 months. */
export function PassportWarning() {
  const t = useTranslations('account.documents');
  const date = useDate();
  const { profile } = useAccount();
  const expiry = profile.passportExpiryDate;
  if (!expiry) {
    return null;
  }
  const expired = expiry < utcDateString(new Date());
  if (!expired && !profile.passportExpiringSoon) {
    return null;
  }
  return (
    <div
      role="alert"
      data-testid="passport-warning"
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm font-medium ${
        expired
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-brand-gold bg-brand-gold-soft text-foreground'
      }`}
    >
      <p>
        {expired
          ? t('passportExpired', { date: date(expiry) })
          : t('passportExpiring', { date: date(expiry) })}
      </p>
      <Link href="/account/profile?step=passport" className={cta.outline}>
        {t('updatePassport')}
      </Link>
    </div>
  );
}

function Uploader() {
  const t = useTranslations('account.documents');
  const types = useTranslations('account.documentTypes');
  const apiError = useApiErrorText();
  const { documents, reload } = useAccount();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<DocumentType>('CV');
  const [dragging, setDragging] = useState(false);
  const [current, setCurrent] = useState<{ name: string; percent: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const siteInfo = useCallback(async () => (await api.GET('/api/v1/site-info')).data, []);
  const maxMb = useLoaded(siteInfo).data?.MAX_UPLOAD_SIZE_MB ?? DEFAULT_MAX_MB;
  const formats = DOCUMENT_FORMATS[type];
  const formatList = formats.map((format) => format.toUpperCase()).join(', ');

  const handle = async (files: File[]) => {
    const found: string[] = [];
    let count = documents.length;
    let sent: string | null = null;
    setProblems([]);
    setDone(null);
    for (const file of files) {
      const refused = refusal(file, type, maxMb, count);
      if (refused) {
        found.push(t(`refused.${refused}`, { name: file.name, max: maxMb, formats: formatList }));
        continue;
      }
      setCurrent({ name: file.name, percent: 0 });
      const code = await upload(file, type, (percent) => {
        setCurrent({ name: file.name, percent });
      });
      if (code) {
        found.push(`${file.name}: ${apiError(code)}`);
      } else {
        count += 1;
        sent = file.name;
      }
    }
    setCurrent(null);
    setProblems(found);
    if (sent) {
      setDone(sent);
      await reload();
    }
    if (input.current) {
      input.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!current) {
      void handle([...event.dataTransfer.files]);
    }
  };

  return (
    <section className={`${card} p-5`} aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="text-lg font-semibold">
        {t('uploadTitle')}
      </h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${inputId}-type`} className="mb-1 block text-sm font-medium">
            {t('type')}
          </label>
          <select
            id={`${inputId}-type`}
            className={control}
            value={type}
            disabled={current !== null}
            onChange={(event) => {
              setType(event.target.value as DocumentType);
            }}
          >
            {DOCUMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {types(value)}
              </option>
            ))}
          </select>
        </div>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          data-testid="dropzone"
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center focus-within:border-primary ${
            dragging ? 'border-primary bg-muted' : 'border-input'
          }`}
        >
          <UploadCloud className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm">{t('drop')}</p>
          <label htmlFor={inputId} className={`${cta.outline} cursor-pointer`}>
            {t('choose')}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            multiple
            className="sr-only"
            disabled={current !== null}
            accept={formats.map((format) => `.${format}`).join(',')}
            aria-describedby={`${inputId}-rules`}
            onChange={(event) => {
              void handle([...(event.target.files ?? [])]);
            }}
          />
          <p id={`${inputId}-rules`} className="text-sm text-muted-foreground">
            {t('rules', { formats: formatList, max: maxMb })}
          </p>
        </div>
      </div>
      {current ? (
        <div className="mt-4" data-testid="upload-progress">
          <p className="mb-1 text-sm" dir="auto">
            {t('uploading', { name: current.name, percent: current.percent })}
          </p>
          <div
            role="progressbar"
            aria-label={t('uploading', { name: current.name, percent: current.percent })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={current.percent}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${String(current.percent)}%` }} />
          </div>
        </div>
      ) : null}
      <div className="mt-4 space-y-2" aria-live="polite">
        {done ? (
          <p
            role="status"
            className="text-sm font-medium text-emerald-700 dark:text-emerald-400"
            data-testid="upload-done"
          >
            {t('uploaded', { name: done })}
          </p>
        ) : null}
        {problems.map((problem) => (
          <FormError key={problem}>{problem}</FormError>
        ))}
      </div>
    </section>
  );
}

const canPreview = (document: CandidateDocument) =>
  document.mimeType === 'application/pdf' || document.mimeType.startsWith('image/');

function DocumentList() {
  const t = useTranslations('account.documents');
  const types = useTranslations('account.documentTypes');
  const common = useTranslations('common');
  const apiError = useApiErrorText();
  const date = useDate();
  const size = useSize();
  const { documents, reload } = useAccount();
  const [preview, setPreview] = useState<CandidateDocument | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /** Links to files are followed by the browser itself: make sure the access token is fresh first. */
  const withSession = async (then: () => void) => {
    const { response } = await attempt(api.GET('/api/v1/me/documents'));
    if (response?.ok) {
      then();
    }
  };
  const remove = async (id: string) => {
    setProblem(null);
    const { error, response } = await attempt(
      api.DELETE('/api/v1/me/documents/{id}', { params: { path: { id } } }),
    );
    setConfirming(null);
    if (!response?.ok) {
      const { code } = failure(error);
      setProblem(code === 'DOCUMENT_IN_USE' ? t('inUse') : apiError(code));
      return;
    }
    await reload();
  };

  const action = `${cta.ghost} px-3`;
  return (
    <section className={`${card} p-5`} aria-labelledby="documents-list-title">
      <h2 id="documents-list-title" className="text-lg font-semibold">
        {t('listTitle', { count: documents.length })}
      </h2>
      <FormError>{problem}</FormError>
      {documents.length === 0 ? (
        <p className="mt-3 rounded-lg bg-muted p-4 text-sm" data-testid="no-documents">
          {t('empty')}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border" data-testid="documents">
          {documents.map((document) => (
            <li key={document.id} className="py-3" data-type={document.type}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  {document.mimeType.startsWith('image/') ? (
                    <ImageIcon className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{types(document.type)}</p>
                    <p className="truncate text-sm text-muted-foreground" dir="auto">
                      {document.originalName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {size(document.sizeBytes)} · {date(document.uploadedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {canPreview(document) ? (
                    <button
                      type="button"
                      className={action}
                      aria-label={`${t('preview')}: ${document.originalName}`}
                      onClick={() =>
                        void withSession(() => {
                          setPreview(document);
                        })
                      }
                    >
                      <Eye className="size-4" aria-hidden />
                      {t('preview')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={action}
                    aria-label={`${t('download')}: ${document.originalName}`}
                    onClick={() =>
                      void withSession(() => {
                        window.location.assign(downloadUrl(document.id));
                      })
                    }
                  >
                    <Download className="size-4" aria-hidden />
                    {t('download')}
                  </button>
                  <button
                    type="button"
                    className={`${action} text-destructive`}
                    aria-label={`${t('delete')}: ${document.originalName}`}
                    onClick={() => {
                      setConfirming(document.id);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t('delete')}
                  </button>
                </div>
              </div>
              {confirming === document.id ? (
                <div
                  role="alertdialog"
                  aria-label={t('confirmDelete')}
                  className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3"
                >
                  <p className="text-sm font-medium">{t('confirmDelete')}</p>
                  <button
                    type="button"
                    className={`${cta.primary} bg-destructive text-white hover:bg-destructive/90`}
                    onClick={() => void remove(document.id)}
                  >
                    {t('confirmDeleteYes')}
                  </button>
                  <button
                    type="button"
                    className={cta.outline}
                    onClick={() => {
                      setConfirming(null);
                    }}
                  >
                    {t('cancel')}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={preview !== null}
        onClose={() => {
          setPreview(null);
        }}
        title={preview?.originalName ?? ''}
        closeLabel={common('close')}
        wide
      >
        {preview ? (
          <div data-testid="document-preview">
            {preview.mimeType.startsWith('image/') ? (
              // A private file behind a short-lived signed link: not something to optimise or cache.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={downloadUrl(preview.id, true)}
                alt={preview.originalName}
                className="mx-auto max-h-[70vh] rounded-lg"
              />
            ) : (
              <iframe
                src={downloadUrl(preview.id, true)}
                title={preview.originalName}
                className="h-[70vh] w-full rounded-lg border border-border"
              />
            )}
            <a
              href={downloadUrl(preview.id, true)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-medium underline"
            >
              {t('openInTab')}
            </a>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

export function DocumentsManager() {
  return (
    <div className="space-y-6">
      <Uploader />
      <DocumentList />
    </div>
  );
}
