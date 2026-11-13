'use client';

import { PARTNER_HISTORY_ENTITY_TYPES } from '@iconbridge/shared/partner';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { api, attempt, type PartnerComment, type PartnerHistoryEntry } from '@/lib/client-api';
import { cta, field } from '@/lib/ui';
import {
  card,
  Failed,
  formatDate,
  formatDateTime,
  heading,
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
      <h2 id={`${fieldId}-title`} className={`${heading} mb-3`}>
        {t('title')}
      </h2>
      {failed ? (
        <Failed onRetry={load} />
      ) : items === null ? (
        <LoadingText />
      ) : items.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="mb-4 space-y-3">
          {items.map((comment) => (
            <li key={comment.id} className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">
                {t('by', {
                  name: comment.authorName,
                  date: formatDateTime(comment.createdAt, lang),
                })}
              </p>
              {/* Plain text, never HTML (ADR-027, rule 9). */}
              <p className="mt-1 text-sm whitespace-pre-line">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="space-y-2"
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
          rows={3}
          maxLength={2000}
          className={field}
          value={body}
          aria-describedby={`${fieldId}-hint`}
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {t('hint')}
        </p>
        <button type="submit" className={cta.outline} disabled={busy || body.trim() === ''}>
          {t('submit')}
        </button>
      </form>
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
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="bg-muted/50 text-start">
              <tr>
                {(['when', 'who', 'what', 'change'] as const).map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 text-start font-semibold">
                    {t(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDateTime(entry.createdAt, lang)}
                  </td>
                  <td className="px-3 py-2">{entry.actorName}</td>
                  <td className="px-3 py-2">{actionName(entry.action)}</td>
                  <td className="px-3 py-2">
                    {entry.field
                      ? t('fieldChange', {
                          field: fieldName(entry.field),
                          from: valueText(entry.field, entry.oldValue),
                          to: valueText(entry.field, entry.newValue),
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
