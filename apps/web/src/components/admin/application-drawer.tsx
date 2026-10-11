'use client';

import { answerText } from '@iconbridge/shared/questions';
import { Award, Trash2, Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { Link, useRouter } from '@/i18n/navigation';
import { api, type AdminApplicationDetail, type ApplicationStatus } from '@/lib/client-api';
import { countryName } from '@/lib/countries';
import { languageName } from '@/lib/format';
import { cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import { DeleteDialog } from './delete-dialog';
import { DocumentsList } from './documents-list';
import { ApplicationBadge } from './status';
import { dateTime, input, smallButton, useCall, useConfirm } from './ui';

type Snapshot = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** The profile as it was when the candidate applied. The passport number is the masked one. */
function SnapshotList({ snapshot }: { snapshot: Snapshot }) {
  const t = useTranslations('admin.snapshot');
  const locale = useLocale();
  const country = (value: unknown) => (str(value) ? countryName(str(value) ?? '', locale) : null);
  const languages = Array.isArray(snapshot.languages)
    ? (snapshot.languages as { language: string; level: string }[])
        .map((entry) => `${languageName(entry.language, locale)} (${entry.level})`)
        .join(', ')
    : null;
  const rows: [string, string | null][] = [
    ['dateOfBirth', str(snapshot.dateOfBirth)],
    ['nationality', country(snapshot.nationality)],
    ['countryOfResidence', country(snapshot.countryOfResidence)],
    ['city', str(snapshot.city)],
    ['phone', str(snapshot.phone)],
    ['passportNumberMasked', str(snapshot.passportNumberMasked)],
    ['passportExpiryDate', str(snapshot.passportExpiryDate)],
    ['currentProfession', str(snapshot.currentProfession)],
    [
      'yearsOfExperience',
      typeof snapshot.yearsOfExperience === 'number' ? String(snapshot.yearsOfExperience) : null,
    ],
    ['educationLevel', str(snapshot.educationLevel)],
    ['languages', languages],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="snapshot">
      {rows
        .filter(([, value]) => value !== null)
        .map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd className="font-medium" dir="auto">
              {value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function StatusActions({
  detail,
  onChanged,
}: {
  detail: AdminApplicationDetail;
  onChanged: (detail: AdminApplicationDetail) => void;
}) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const [message, setMessage] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const change = async (status: ApplicationStatus) => {
    if (status === 'REJECTED') {
      const yes = await confirm({
        title: t('applications.rejectTitle'),
        text: t('applications.rejectText'),
        confirmLabel: t('applications.reject'),
        destructive: true,
      });
      if (!yes) {
        return;
      }
    }
    setBusy(true);
    const result = await call(
      api.PATCH('/api/v1/admin/applications/{id}/status', {
        params: { path: { id: detail.id } },
        body: {
          status,
          messageToCandidate: message.trim() || null,
          comment: comment.trim() || null,
        },
      }),
      t('applications.statusChanged', { status: t(`status.${status}`) }),
    );
    setBusy(false);
    if (result.ok) {
      setMessage('');
      setComment('');
      onChanged(result.data);
    }
  };
  const undo = async () => {
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/applications/{id}/undo-status', {
        params: { path: { id: detail.id } },
      }),
      t('applications.undone'),
    );
    setBusy(false);
    if (result.ok) {
      onChanged(result.data);
    }
  };

  if (detail.allowedTransitions.length === 0 && !detail.undo) {
    return <p className="rounded-lg bg-muted p-3 text-sm">{t('applications.noTransition')}</p>;
  }
  return (
    <div className="space-y-3" data-testid="status-actions">
      {detail.undo ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-gold bg-brand-gold-soft p-3 text-sm">
          <span>
            {t('applications.undoHint', {
              status: t(`status.${detail.undo.toStatus}`),
              time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
                new Date(detail.undo.until),
              ),
            })}
          </span>
          <button type="button" className={cta.outline} disabled={busy} onClick={() => void undo()}>
            <Undo2 className="size-4" aria-hidden />
            {t('applications.undo')}
          </button>
        </div>
      ) : null}
      {detail.allowedTransitions.length > 0 ? (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              {t('applications.messageToCandidate')}
            </span>
            <textarea
              rows={2}
              className={input}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t('applications.messageHint')}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              {t('applications.internalComment')}
            </span>
            <textarea
              rows={2}
              className={input}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {detail.allowedTransitions.map((status) => (
              <button
                key={status}
                type="button"
                disabled={busy}
                data-testid={`move-${status}`}
                className={
                  status === 'REJECTED'
                    ? `${cta.outline} border-destructive text-destructive`
                    : cta.primary
                }
                onClick={() => void change(status)}
              >
                {status === 'REJECTED'
                  ? t('applications.reject')
                  : t('applications.moveTo', { status: t(`status.${status}`) })}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Notes({ detail, onChanged }: { detail: AdminApplicationDetail; onChanged: () => void }) {
  const t = useTranslations('admin.applications');
  const locale = useLocale();
  const call = useCall();
  const { user, can } = useAdmin();
  const [body, setBody] = useState('');
  const add = async () => {
    const result = await call(
      api.POST('/api/v1/admin/applications/{id}/notes', {
        params: { path: { id: detail.id } },
        body: { body },
      }),
    );
    if (result.ok) {
      setBody('');
      onChanged();
    }
  };
  const remove = async (noteId: string) => {
    const result = await call(
      api.DELETE('/api/v1/admin/applications/{id}/notes/{noteId}', {
        params: { path: { id: detail.id, noteId } },
      }),
    );
    if (result.ok) {
      onChanged();
    }
  };
  return (
    <div data-testid="notes">
      {detail.notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noNotes')}</p>
      ) : (
        <ul className="space-y-2">
          {detail.notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-muted p-3 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {note.authorEmail} · {dateTime(note.createdAt, locale)}
                </span>
                {note.authorId === user.id || user.role === 'SUPER_ADMIN' ? (
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded text-destructive hover:bg-background"
                    aria-label={t('deleteNote')}
                    onClick={() => void remove(note.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap" dir="auto">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      {can('MANAGE_APPLICATIONS') ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <textarea
            rows={2}
            className={input}
            aria-label={t('addNote')}
            placeholder={t('notePlaceholder')}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <button type="submit" className={cta.outline} disabled={body.trim() === ''}>
            {t('addNote')}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Detail({
  detail,
  setDetail,
  reload,
  onChanged,
  onDeleted,
}: {
  detail: AdminApplicationDetail;
  setDetail: (detail: AdminApplicationDetail) => void;
  reload: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const call = useCall();
  const router = useRouter();
  const { can, canDelete } = useAdmin();
  const [deleting, setDeleting] = useState(false);
  const answerLocale = locale === 'fr' ? 'fr' : 'en';

  const createStory = async () => {
    const result = await call(
      api.POST('/api/v1/admin/success-stories/from-application/{id}', {
        params: { path: { id: detail.id } },
      }),
      t('applications.storyCreated'),
    );
    if (result.ok) {
      router.push(`/admin/content/stories?edit=${result.data.id}`);
    }
  };
  const answers = Object.entries(detail.answers ?? {});
  const asked = new Map(detail.questions.map((question) => [question.id, question]));
  const heading = 'mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase';

  return (
    <div className="space-y-6" data-testid="application-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {detail.job.title} · {detail.candidate.email}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('applications.appliedOn', { date: dateTime(detail.appliedAt, locale) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationBadge status={detail.status} />
          <Link href={`/admin/candidates/${detail.candidate.id}`} className={smallButton}>
            {t('applications.openCandidate')}
          </Link>
        </div>
      </div>

      {can('MANAGE_APPLICATIONS') ? (
        <section>
          <h3 className={heading}>{t('applications.changeStatus')}</h3>
          <StatusActions
            detail={detail}
            onChanged={(next) => {
              setDetail(next);
              onChanged();
            }}
          />
        </section>
      ) : null}

      {can('MANAGE_CONTENT') &&
      (detail.status === 'VISA_APPROVED' || detail.status === 'DEPLOYED') ? (
        <button type="button" className={cta.gold} onClick={() => void createStory()}>
          <Award className="size-4" aria-hidden />
          {t('applications.createStory')}
        </button>
      ) : null}

      <section>
        <h3 className={heading}>{t('applications.snapshot')}</h3>
        <SnapshotList snapshot={detail.profileSnapshot} />
      </section>

      {answers.length > 0 ? (
        <section data-testid="answers">
          <h3 className={heading}>{t('applications.answers')}</h3>
          <dl className="space-y-2 text-sm">
            {answers.map(([key, answer]) => {
              const question = asked.get(key);
              return (
                <div key={key}>
                  <dt className="text-muted-foreground">
                    {question ? question.label[answerLocale] : key}
                  </dt>
                  <dd className="font-medium whitespace-pre-wrap" dir="auto">
                    {question ? answerText(question, answer, answerLocale) : answer}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ) : null}

      {detail.coverLetter ? (
        <section>
          <h3 className={heading}>{t('applications.coverLetter')}</h3>
          <p className="text-sm whitespace-pre-wrap" dir="auto">
            {detail.coverLetter}
          </p>
        </section>
      ) : null}

      <section>
        <h3 className={heading}>{t('applications.documents')}</h3>
        <DocumentsList documents={detail.documents} />
      </section>

      <section>
        <h3 className={heading}>{t('applications.timeline')}</h3>
        <ol className="space-y-3" data-testid="admin-timeline">
          {detail.history.map((entry) => (
            <li
              key={entry.id}
              className={`border-s-2 ps-3 text-sm ${entry.revertedAt ? 'border-border opacity-60' : 'border-brand-gold'}`}
              data-reverted={entry.revertedAt !== null}
            >
              <p className="font-medium">
                <span className={entry.revertedAt ? 'line-through' : ''}>
                  {t(`status.${entry.toStatus}`)}
                </span>
                {entry.revertedAt ? (
                  <span className="ms-2 no-underline">({t('applications.undoneMark')})</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {dateTime(entry.at, locale)}
                {entry.changedByEmail ? ` · ${entry.changedByEmail}` : ''}
              </p>
              {entry.messageToCandidate ? (
                <p className="mt-1 rounded bg-muted p-2" dir="auto">
                  <span className="text-xs text-muted-foreground">
                    {t('applications.toCandidate')}:{' '}
                  </span>
                  {entry.messageToCandidate}
                </p>
              ) : null}
              {entry.comment ? (
                <p className="mt-1 rounded bg-muted p-2" dir="auto">
                  <span className="text-xs text-muted-foreground">
                    {t('applications.internal')}:{' '}
                  </span>
                  {entry.comment}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className={heading}>{t('applications.notes')}</h3>
        <Notes detail={detail} onChanged={reload} />
      </section>

      {canDelete ? (
        <section className="border-t border-border pt-4">
          <button
            type="button"
            className={`${cta.outline} border-destructive text-destructive`}
            onClick={() => {
              setDeleting(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('applications.delete')}
          </button>
          <DeleteDialog
            open={deleting}
            title={t('applications.deleteTitle')}
            removed={[
              t('applications.removedApplications', { count: 1 }),
              t('applications.removedHistory'),
            ]}
            notes={[
              t('applications.keptDocuments'),
              t('applications.cooldownLifted'),
              ...(detail.status === 'DEPLOYED' ? [t('applications.hiredKept')] : []),
            ]}
            confirmLabel={t('applications.delete')}
            onClose={() => {
              setDeleting(false);
            }}
            onConfirm={async (reason) => {
              const result = await call(
                api.DELETE('/api/v1/admin/applications/{id}', {
                  params: { path: { id: detail.id } },
                  body: { reason },
                }),
                t('applications.deleted'),
              );
              if (result.ok) {
                setDeleting(false);
                onDeleted();
              }
            }}
          />
        </section>
      ) : null}
    </div>
  );
}

/** Side panel with everything about one application. `onChanged` tells the list to read again. */
export function ApplicationDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('admin.applications');
  const common = useTranslations('common');
  const fetcher = useCallback(
    async () =>
      id
        ? (await api.GET('/api/v1/admin/applications/{id}', { params: { path: { id } } })).data
        : undefined,
    [id],
  );
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);
  const detail = data && data.id === id ? data : undefined;
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={
        detail ? `${detail.candidate.firstName} ${detail.candidate.lastName}` : t('detailTitle')
      }
      closeLabel={common('close')}
      side
    >
      {id === null ? null : detail ? (
        <Detail
          detail={detail}
          setDetail={setData}
          reload={reload}
          onChanged={onChanged}
          onDeleted={() => {
            onChanged();
            onClose();
          }}
        />
      ) : failed && !loading ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <Loading lines={5} />
      )}
    </Modal>
  );
}
