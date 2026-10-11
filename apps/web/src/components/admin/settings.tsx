'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { api, type AuditEntry, type SettingValues } from '@/lib/client-api';
import { card, cta } from '@/lib/ui';
import {
  DataTable,
  dateTime,
  input,
  Labelled,
  PageHeader,
  Pager,
  smallButton,
  useCall,
} from './ui';

type Key = keyof SettingValues;
const NUMBERS: Key[] = ['REAPPLY_COOLDOWN_MONTHS', 'MAX_ACTIVE_APPLICATIONS', 'MAX_UPLOAD_SIZE_MB'];
const GROUPS: { group: string; keys: Key[] }[] = [
  { group: 'rules', keys: NUMBERS },
  {
    group: 'contact',
    keys: ['CONTACT_EMAIL', 'CONTACT_PHONE', 'CONTACT_WHATSAPP', 'CONTACT_ADDRESS'],
  },
  {
    group: 'social',
    keys: ['SOCIAL_FACEBOOK', 'SOCIAL_INSTAGRAM', 'SOCIAL_TIKTOK', 'SOCIAL_LINKEDIN'],
  },
];

function SettingsForm({ initial }: { initial: SettingValues }) {
  const t = useTranslations('admin.settings');
  const call = useCall();
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState<Record<Key, string>>(
    () =>
      Object.fromEntries(
        Object.entries(initial).map(([key, value]) => [key, String(value)]),
      ) as Record<Key, string>,
  );
  const [busy, setBusy] = useState(false);
  const changed = (Object.keys(values) as Key[]).filter(
    (key) => values[key] !== String(saved[key]),
  );

  /** Each setting is its own call and its own audit entry; only what changed is sent. */
  const save = async () => {
    setBusy(true);
    let next = saved;
    for (const key of changed) {
      const value = NUMBERS.includes(key) ? Number(values[key]) : values[key].trim();
      const result = await call(
        api.PUT('/api/v1/admin/settings/{key}', {
          params: { path: { key } },
          body: { value },
        }),
      );
      if (!result.ok) {
        break;
      }
      next = { ...next, [key]: value };
    }
    setSaved(next);
    setBusy(false);
    if (changed.every((key) => String(next[key]) === values[key].trim())) {
      toast.success(t('saved'));
    }
  };
  return (
    <form
      className="space-y-5"
      data-testid="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {GROUPS.map(({ group, keys }) => (
        <section key={group} className={`${card} p-5`}>
          <h2 className="text-lg font-semibold">{t(`groups.${group}`)}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t(`groupHelp.${group}`)}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {keys.map((key) => (
              <Labelled key={key} label={t(`keys.${key}`)} hint={t(`help.${key}`)}>
                <input
                  className={input}
                  type={
                    NUMBERS.includes(key) ? 'number' : key === 'CONTACT_EMAIL' ? 'email' : 'text'
                  }
                  min={NUMBERS.includes(key) ? 0 : undefined}
                  dir={key === 'CONTACT_ADDRESS' ? undefined : 'ltr'}
                  name={key}
                  value={values[key]}
                  onChange={(event) => {
                    setValues({ ...values, [key]: event.target.value });
                  }}
                />
              </Labelled>
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-end">
        <button type="submit" className={cta.primary} disabled={busy || changed.length === 0}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}

export function SettingsManager() {
  const t = useTranslations('admin.settings');
  const fetcher = useCallback(async () => (await api.GET('/api/v1/admin/settings')).data, []);
  const { data, loading, failed, reload } = useLoaded(fetcher);
  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      {loading && !data ? <Loading lines={6} /> : null}
      {failed ? <LoadFailed onRetry={reload} /> : null}
      {data ? <SettingsForm initial={data} /> : null}
    </>
  );
}

const PAGE_SIZE = 30;
const ENTITY_TYPES = [
  'application',
  'candidate',
  'job',
  'user',
  'successStory',
  'homeSlide',
  'document',
  'destination',
  'jobCategory',
  'contactMessage',
  'setting',
] as const;

/** Who did what, when, on which record. Read-only: nothing in the log can be changed. */
export function AuditLog() {
  const t = useTranslations('admin.audit');
  const common = useTranslations('common');
  const locale = useLocale();
  const [filters, setFilters] = useState({
    action: '',
    entityType: '',
    actor: '',
    from: '',
    to: '',
  });
  const [page, setPage] = useState(1);
  const [reading, setReading] = useState<AuditEntry | null>(null);
  const fetcher = useCallback(
    async () =>
      (
        await api.GET('/api/v1/admin/audit-logs', {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(filters.action.trim().length >= 2 ? { action: filters.action.trim() } : {}),
              ...(filters.entityType ? { entityType: filters.entityType } : {}),
              ...(filters.actor.trim().length >= 2 ? { actor: filters.actor.trim() } : {}),
              ...(filters.from ? { from: filters.from } : {}),
              ...(filters.to ? { to: filters.to } : {}),
            },
          },
        })
      ).data,
    [filters, page],
  );
  const { data, loading, failed, reload } = useLoaded(fetcher);
  const change = (patch: Partial<typeof filters>) => {
    setFilters((before) => ({ ...before, ...patch }));
    setPage(1);
  };
  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('when'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{dateTime(row.original.createdAt, locale)}</span>
        ),
      },
      {
        accessorKey: 'actorEmail',
        header: t('who'),
        cell: ({ row }) => row.original.actorEmail ?? t('system'),
      },
      {
        accessorKey: 'action',
        header: t('action'),
        cell: ({ row }) => <code className="text-xs">{row.original.action}</code>,
      },
      {
        accessorKey: 'entityType',
        header: t('record'),
        cell: ({ row }) => (
          <span>
            {row.original.entityType}
            {row.original.entityId ? (
              <span className="block text-xs text-muted-foreground" dir="ltr">
                {row.original.entityId}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'details',
        enableSorting: false,
        header: () => <span className="sr-only">{t('details')}</span>,
        cell: ({ row }) => (
          <button
            type="button"
            className={smallButton}
            onClick={() => {
              setReading(row.original);
            }}
          >
            {t('details')}
          </button>
        ),
      },
    ],
    [locale, t],
  );
  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" data-testid="audit-filters">
        <Labelled label={t('action')}>
          <input
            className={input}
            placeholder="job.publish"
            value={filters.action}
            onChange={(event) => {
              change({ action: event.target.value });
            }}
          />
        </Labelled>
        <Labelled label={t('record')}>
          <select
            className={input}
            value={filters.entityType}
            onChange={(event) => {
              change({ entityType: event.target.value });
            }}
          >
            <option value="">{t('allRecords')}</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t('who')}>
          <input
            className={input}
            value={filters.actor}
            onChange={(event) => {
              change({ actor: event.target.value });
            }}
          />
        </Labelled>
        <Labelled label={t('from')}>
          <input
            type="date"
            className={input}
            value={filters.from}
            onChange={(event) => {
              change({ from: event.target.value });
            }}
          />
        </Labelled>
        <Labelled label={t('to')}>
          <input
            type="date"
            className={input}
            value={filters.to}
            onChange={(event) => {
              change({ to: event.target.value });
            }}
          />
        </Labelled>
      </div>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <>
          <DataTable
            label={t('title')}
            columns={columns}
            rows={data?.items ?? []}
            rowId={(row) => row.id}
            loading={loading}
            empty={t('empty')}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
      <Modal
        open={reading !== null}
        onClose={() => {
          setReading(null);
        }}
        title={reading?.action ?? ''}
        closeLabel={common('close')}
        wide
      >
        {reading ? (
          <div className="grid gap-4 text-sm md:grid-cols-2" data-testid="audit-detail">
            {(['before', 'after'] as const).map((side) => (
              <div key={side}>
                <h3 className="mb-1 font-semibold">{t(side)}</h3>
                <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs" dir="ltr">
                  {reading[side] === null || reading[side] === undefined
                    ? '—'
                    : JSON.stringify(reading[side], null, 2)}
                </pre>
              </div>
            ))}
            <p className="text-muted-foreground md:col-span-2">
              {dateTime(reading.createdAt, locale)} · {reading.actorEmail ?? t('system')}
              {reading.ip ? ` · ${reading.ip}` : ''}
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
