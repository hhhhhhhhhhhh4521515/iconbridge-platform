'use client';

import { PARTNER_HISTORY_ENTITY_TYPES } from '@iconbridge/shared/partner';
import { MessagesSquare, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { api, attempt, type PartnerComment, type PartnerHistoryEntry } from '@/lib/client-api';
import { cta, field } from '@/lib/ui';
import {
  Avatar,
  card,
  CardTitle,
  Failed,
  formatDate,
  formatDateTime,
  LoadingText,
  usePartner,
  usePartnerCall,
  useSpace,
} from './partner-ui';

type Target = { jobId: string } | { applicationId: string };

const commentsPath = (spaceId: string, target: Target) =>
  'jobId' in target
    ? api.GET('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}/comments', {
        params: { path: { spaceId, jobId: target.jobId } },
      })
    : api.GET('/api/v1/partner-spaces/{spaceId}/applications/{applicationId}/comments', {
        params: { path: { spaceId, applicationId: target.applicationId } },
      });

/** Comments of a job demand or an application: oldest first, append-only (ADR-027, answer 3). */
export function Comments({ target }: { target: Target }) {
  const t = useTranslations('partner.comments');
  const space = useSpace();
  const { lang } = usePartner();
  const call = usePartnerCall();
  const fieldId = useId();
  const [items, setItems] = useState<PartnerComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const targetKey = 'jobId' in target ? `job:${target.jobId}` : `app:${target.applicationId}`;
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void attempt(commentsPath(space.id, target)).then(({ data }) => {
      if (cancelled) {
        return;
      }
      if (data) {
        setItems(data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // The target is identified by its key; the object itself is new at every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.id, targetKey, version]);
  const load = () => {
    setVersion((value) => value + 1);
  };
  const add = async () => {
    setBusy(true);
    const result = await call(
      'jobId' in target
        ? api.POST('/api/v1/partner-spaces/{spaceId}/jobs/{jobId}/comments', {
            params: { path: { spaceId: space.id, jobId: target.jobId } },
            body: { body },
          })
        : api.POST('/api/v1/partner-spaces/{spaceId}/applications/{applicationId}/comments', {
            params: { path: { spaceId: space.id, applicationId: target.applicationId } },
            body: { body },
          }),
      t('added'),
    );
    setBusy(false);
    if (result.ok) {
      setBody('');
      load();
    }
  };
  return (
    <section className={card} aria-labelledby={`${fieldId}-title`} data-testid="comments">
      <CardTitle icon={MessagesSquare} id={`${fieldId}-title`}>
        {t('title')}
      </CardTitle>
      <div className="mt-5">
        {failed ? (
          <Failed onRetry={load} />
        ) : items === null ? (
          <LoadingText />
        ) : items.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          // A thread, oldest first.
          <ol className="mb-5 space-y-4">
            {items.map((comment) => {
              return (
                <li key={comment.id} className="flex items-start gap-2.5">
                  <Avatar name={comment.authorName} size="sm" />
                  <div className="max-w-[85%] min-w-0">
                    <p className="mb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{comment.authorName}</span> ·{' '}
                      <time dateTime={comment.createdAt}>
                        {formatDateTime(comment.createdAt, lang)}
                      </time>
                    </p>
                    {/* Plain text, never HTML (ADR-027, rule 9). */}
                    <p className="rounded-2xl rounded-ss-sm bg-muted px-4 py-2.5 text-sm break-words whitespace-pre-line">
                      {comment.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <form
          className="space-y-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim()) {
              void add();
            }
          }}
        >
          <label htmlFor={fieldId} className="block text-sm font-medium">
            {t('label')}
          </label>
          <textarea
            id={fieldId}
            rows={2}
            maxLength={2000}
            className={field}
            value={body}
            aria-describedby={`${fieldId}-hint`}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
              {t('hint')}
            </p>
            <button type="submit" className={cta.primary} disabled={busy || body.trim() === ''}>
              <Send className="size-4 rtl:-scale-x-100" aria-hidden />
              {t('submit')}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

type EntityType = (typeof PARTNER_HISTORY_ENTITY_TYPES)[number];

/** The value of a field as the reader reads it: a visa status by its name, a date as a date. */
function useValueText(): (field: string | null, value: string | null) => string {
  const t = useTranslations('partner.history');
  const visa = useTranslations('partner.visa');
  const permit = useTranslations('partner.workPermit');
  const { lang } = usePartner();
  return (fieldName, value) => {
    if (value === null || value === '') {
      return t('empty_value');
    }
    if (fieldName === 'visaStatus' && visa.has(value)) {
      return visa(value);
    }
    if (fieldName === 'workPermitStatus' && permit.has(value)) {
      return permit(value);
    }
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(value) && fieldName?.toLowerCase().includes('date')) {
      return formatDate(value.slice(0, 10), lang);
    }
    return value;
  };
}

/** The colour of an entry's dot: created green, deleted red, files blue, the rest grey. */
function dotOf(action: string): string {
  if (/DELETED|REMOVED/.test(action)) {
    return 'bg-red-600';
  }
  if (/CREATED|ADDED|REOPENED/.test(action)) {
    return 'bg-emerald-600';
  }
  if (action.startsWith('FILE_')) {
    return 'bg-blue-600';
  }
  return 'bg-muted-foreground';
}

/** Entries of the history, newest first; filtered by entity, or by application. */
export function HistoryList({
  applicationId,
  entityType,
}: {
  applicationId?: string;
  entityType?: EntityType;
}) {
  const t = useTranslations('partner.history');
  const space = useSpace();
  const { lang } = usePartner();
  const valueText = useValueText();
  const [items, setItems] = useState<PartnerHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  /** The page asked for, and the last page that arrived (or failed). */
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<{ page: number; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void attempt(
      api.GET('/api/v1/partner-spaces/{spaceId}/history', {
        params: {
          path: { spaceId: space.id },
          query: {
            page,
            pageSize: 50,
            ...(applicationId ? { applicationId } : {}),
            ...(entityType ? { entityType } : {}),
          },
        },
      }),
    ).then(({ data }) => {
      if (cancelled) {
        return;
      }
      if (!data) {
        setLoaded({ page, failed: true });
        return;
      }
      setItems((current) => (page === 1 ? data.items : [...current, ...data.items]));
      setTotal(data.total);
      setLoaded({ page, failed: false });
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId, entityType, page, retry, space.id]);
  const state = loaded?.page !== page ? 'loading' : loaded.failed ? 'failed' : 'ready';
  const fieldName = (name: string) => (t.has(`field.${name}`) ? t(`field.${name}`) : name);
  const actionName = (action: string) =>
    t.has(`action.${action}`) ? t(`action.${action}`) : t('action.other');
  if (state === 'failed' && items.length === 0) {
    return (
      <Failed
        onRetry={() => {
          setLoaded(null);
          setRetry((value) => value + 1);
        }}
      />
    );
  }
  return (
    <div data-testid="history">
      {state === 'loading' && items.length === 0 ? <LoadingText /> : null}
      {state !== 'loading' && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      {items.length > 0 ? (
        // A vertical timeline, newest first: the line joins the dots.
        <ol className="relative ms-2 border-s-2 border-border" aria-label={t('title')}>
          {items.map((entry) => (
            <li key={entry.id} className="relative ms-6 pb-5 last:pb-0">
              <span
                aria-hidden
                className={`absolute -start-[1.95rem] top-1 size-3.5 rounded-full border-2 border-card ${dotOf(entry.action)}`}
              />
              <p className="text-sm">
                <span className="font-semibold">{actionName(entry.action)}</span>
                <span className="text-muted-foreground"> · {entry.actorName}</span>
              </p>
              {entry.field ? (
                <p className="mt-0.5 text-sm">
                  {t('fieldChange', {
                    field: fieldName(entry.field),
                    from: valueText(entry.field, entry.oldValue),
                    to: valueText(entry.field, entry.newValue),
                  })}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-muted-foreground">
                <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt, lang)}</time>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {items.length < total ? (
        <button
          type="button"
          className={`${cta.outline} mt-3`}
          disabled={state === 'loading'}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {t('more')}
        </button>
      ) : null}
    </div>
  );
}

/** The history of the whole space, filtered by entity (ADR-027, section 6). */
export function SpaceHistory() {
  const t = useTranslations('partner.history');
  const selectId = useId();
  const [entityType, setEntityType] = useState<EntityType | ''>('');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('spaceTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-sm font-medium">
          {t('filter')}
        </label>
        <select
          id={selectId}
          className={`${field} w-auto`}
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value as EntityType | '');
          }}
        >
          <option value="">{t('all')}</option>
          {PARTNER_HISTORY_ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`entity.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={card}>
        <HistoryList {...(entityType ? { entityType } : {})} key={entityType || 'all'} />
      </div>
    </div>
  );
}
