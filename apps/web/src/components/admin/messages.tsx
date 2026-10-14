'use client';

import { CheckCheck, Mail, RotateCcw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { api, type ContactMessage } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import {
  Badge,
  dateTime,
  filterControl,
  PageHeader,
  Pager,
  SearchBox,
  useCall,
  useConfirm,
} from './ui';

const PAGE_SIZE = 20;

export function MessagesInbox() {
  const t = useTranslations('admin.messages');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const { can } = useAdmin();
  const [handled, setHandled] = useState('false');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [reading, setReading] = useState<ContactMessage | null>(null);
  const fetcher = useCallback(
    async () =>
      (
        await api.GET('/api/v1/admin/contact-messages', {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(handled ? { handled: handled as 'true' | 'false' } : {}),
              ...(q.trim().length >= 2 ? { q: q.trim() } : {}),
            },
          },
        })
      ).data,
    [handled, page, q],
  );
  const { data, loading, failed, reload } = useLoaded(fetcher);

  const mark = async (message: ContactMessage, done: boolean) => {
    const result = await call(
      api.POST(`/api/v1/admin/contact-messages/{id}/${done ? 'handle' : 'reopen'}`, {
        params: { path: { id: message.id } },
      }),
      done ? t('markedHandled') : t('reopened'),
    );
    if (result.ok) {
      setReading(null);
      reload();
    }
  };

  const remove = async (message: ContactMessage) => {
    const yes = await confirm({
      title: t('deleteTitle'),
      text: t('deleteText', { name: message.name }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!yes) {
      return;
    }
    const result = await call(
      api.DELETE('/api/v1/admin/contact-messages/{id}', { params: { path: { id: message.id } } }),
      t('deleted'),
    );
    if (result.ok) {
      setReading(null);
      reload();
    }
  };

  return (
    <>
      <PageHeader title={t('title')} intro={t('intro', { count: data?.unhandled ?? 0 })} />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
          placeholder={t('search')}
        />
        <select
          className={filterControl}
          aria-label={t('filter')}
          value={handled}
          onChange={(event) => {
            setHandled(event.target.value);
            setPage(1);
          }}
        >
          <option value="false">{t('toHandle')}</option>
          <option value="true">{t('handled')}</option>
          <option value="">{t('all')}</option>
        </select>
      </div>
      {failed ? <LoadFailed onRetry={reload} /> : null}
      {loading && !data ? <Loading lines={4} /> : null}
      {data?.items.length === 0 ? (
        <p className="rounded-xl bg-muted p-6 text-center text-sm" data-testid="empty">
          {t('empty')}
        </p>
      ) : null}
      <ul className="space-y-2" data-testid="messages">
        {(data?.items ?? []).map((message) => (
          <li key={message.id}>
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-start text-sm hover:bg-muted"
              onClick={() => {
                setReading(message);
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{message.name}</span>{' '}
                <span className="text-muted-foreground">· {message.subject ?? t('noSubject')}</span>
                <span className="block truncate text-muted-foreground" dir="auto">
                  {message.message}
                </span>
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Badge tone={message.handledAt ? 'muted' : 'gold'}>
                  {message.handledAt ? t('handledOne') : t('toHandleOne')}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {dateTime(message.createdAt, locale)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
      <Modal
        open={reading !== null}
        onClose={() => {
          setReading(null);
        }}
        title={reading?.subject ?? t('noSubject')}
        closeLabel={common('close')}
        wide
      >
        {reading ? (
          <div className="space-y-4 text-sm" data-testid="message-detail">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('from')}</dt>
                <dd className="font-medium">{reading.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('received')}</dt>
                <dd className="font-medium">{dateTime(reading.createdAt, locale)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('email')}</dt>
                <dd className="font-medium" dir="ltr">
                  {reading.email}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('phone')}</dt>
                <dd className="font-medium" dir="ltr">
                  {reading.phone ?? '—'}
                </dd>
              </div>
            </dl>
            <p className="rounded-lg bg-muted p-4 whitespace-pre-wrap" dir="auto">
              {reading.message}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              {can('MANAGE_SETTINGS') ? (
                <button
                  type="button"
                  className={`${cta.outline} me-auto border-destructive text-destructive`}
                  onClick={() => void remove(reading)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t('delete')}
                </button>
              ) : null}
              <a
                className={cta.outline}
                href={`mailto:${reading.email}?subject=${encodeURIComponent(`Re: ${reading.subject ?? ''}`)}`}
              >
                <Mail className="size-4" aria-hidden />
                {t('reply')}
              </a>
              {can('MANAGE_CONTENT') ? (
                reading.handledAt ? (
                  <button
                    type="button"
                    className={cta.outline}
                    onClick={() => void mark(reading, false)}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    {t('reopen')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={cta.primary}
                    onClick={() => void mark(reading, true)}
                  >
                    <CheckCheck className="size-4" aria-hidden />
                    {t('markHandled')}
                  </button>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
