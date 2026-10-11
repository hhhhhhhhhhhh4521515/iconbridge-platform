'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed } from '@/components/forms/fields';
import { Link, useRouter } from '@/i18n/navigation';
import { api, type AdminJob } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import { JobBadge } from './status';
import {
  DataTable,
  filterControl,
  PageHeader,
  Pager,
  SearchBox,
  shortDate,
  smallButton,
  useCall,
  useConfirm,
} from './ui';

const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'] as const;
const PAGE_SIZE = 20;

export function JobsList() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAdmin();
  const call = useCall();
  const confirm = useConfirm();
  const editable = can('MANAGE_JOBS');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);

  const catalog = useCallback(async () => {
    const [destinations, categories] = await Promise.all([
      api.GET('/api/v1/admin/destinations'),
      api.GET('/api/v1/admin/categories'),
    ]);
    return destinations.data && categories.data
      ? { destinations: destinations.data, categories: categories.data }
      : undefined;
  }, []);
  const lists = useLoaded(catalog).data;

  const fetcher = useCallback(
    async () =>
      (
        await api.GET('/api/v1/admin/jobs', {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(q.trim().length >= 2 ? { q: q.trim() } : {}),
              ...(status ? { status: status as AdminJob['status'] } : {}),
              ...(destinationId ? { destinationId } : {}),
              ...(categoryId ? { categoryId } : {}),
            },
          },
        })
      ).data,
    [page, q, status, destinationId, categoryId],
  );
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);

  const replace = useCallback(
    (job: AdminJob) => {
      if (data) {
        setData({ ...data, items: data.items.map((item) => (item.id === job.id ? job : item)) });
      }
    },
    [data, setData],
  );

  const columns = useMemo<ColumnDef<AdminJob>[]>(() => {
    const act = async (job: AdminJob, action: 'publish' | 'close' | 'reopen', message: string) => {
      const result = await call(
        api.POST(`/api/v1/admin/jobs/{id}/${action}`, { params: { path: { id: job.id } } }),
        message,
      );
      if (result.ok) {
        replace(result.data);
      }
    };
    const feature = async (job: AdminJob) => {
      // Shown at once; put back if the API refuses.
      replace({ ...job, featured: !job.featured });
      const result = await call(
        api.POST(`/api/v1/admin/jobs/{id}/${job.featured ? 'unfeature' : 'feature'}`, {
          params: { path: { id: job.id } },
        }),
      );
      replace(result.ok ? result.data : job);
    };
    const duplicate = async (job: AdminJob) => {
      const result = await call(
        api.POST('/api/v1/admin/jobs/{id}/duplicate', { params: { path: { id: job.id } } }),
        t('jobs.duplicated'),
      );
      if (result.ok) {
        router.push(`/admin/jobs/${result.data.id}`);
      }
    };
    const remove = async (job: AdminJob) => {
      const yes = await confirm({
        title: t('jobs.deleteTitle'),
        text: t('jobs.deleteText', { title: job.title }),
        confirmLabel: t('jobs.delete'),
        destructive: true,
      });
      if (!yes) {
        return;
      }
      const result = await call(
        api.DELETE('/api/v1/admin/jobs/{id}', { params: { path: { id: job.id } } }),
        t('jobs.deleted'),
      );
      if (result.ok) {
        reload();
      }
    };
    const base: ColumnDef<AdminJob>[] = [
      {
        accessorKey: 'title',
        header: t('jobs.columns.title'),
        cell: ({ row }) => (
          <div className="min-w-48">
            <Link href={`/admin/jobs/${row.original.id}`} className="font-medium hover:underline">
              {row.original.title}
            </Link>
            {row.original.featured ? (
              <Star
                className="ms-1.5 inline size-3.5 fill-brand-gold text-brand-gold"
                aria-label={t('jobs.featured')}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              {pick(row.original.destination.name, locale)} ·{' '}
              {pick(row.original.category.name, locale)}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('jobs.columns.status'),
        cell: ({ row }) => <JobBadge status={row.original.status} />,
      },
      {
        id: 'positions',
        accessorFn: (job) => job.positions,
        header: t('jobs.columns.positions'),
        cell: ({ row }) => `${String(row.original.hiredCount)} / ${String(row.original.positions)}`,
      },
      {
        accessorKey: 'applicationCount',
        header: t('jobs.columns.applications'),
        cell: ({ row }) => (
          <Link href={`/admin/applications?jobId=${row.original.id}`} className="hover:underline">
            {row.original.applicationCount}
          </Link>
        ),
      },
      {
        accessorKey: 'deadline',
        header: t('jobs.columns.deadline'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{shortDate(row.original.deadline, locale)}</span>
        ),
      },
    ];
    if (!editable) {
      return base;
    }
    return [
      ...base,
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        cell: ({ row }) => {
          const job = row.original;
          return (
            <div
              className="flex flex-nowrap items-center justify-end gap-1"
              data-testid="job-actions"
            >
              {job.status === 'DRAFT' ? (
                <button
                  type="button"
                  className={`${smallButton} text-emerald-700 dark:text-emerald-400`}
                  onClick={() => void act(job, 'publish', t('jobs.published'))}
                >
                  {t('jobs.publish')}
                </button>
              ) : null}
              {job.status === 'PUBLISHED' ? (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => void act(job, 'close', t('jobs.closed'))}
                >
                  {t('jobs.close')}
                </button>
              ) : null}
              {job.status === 'CLOSED' ? (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => void act(job, 'reopen', t('jobs.reopened'))}
                >
                  {t('jobs.reopen')}
                </button>
              ) : null}
              <Link
                href={`/admin/jobs/${job.id}`}
                className={smallButton}
                aria-label={`${t('jobs.edit')}: ${job.title}`}
                title={t('jobs.edit')}
              >
                <Pencil className="size-4" aria-hidden />
              </Link>
              <button
                type="button"
                className={smallButton}
                aria-label={`${t('jobs.duplicate')}: ${job.title}`}
                title={t('jobs.duplicate')}
                onClick={() => void duplicate(job)}
              >
                <Copy className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={smallButton}
                aria-pressed={job.featured}
                aria-label={`${t('jobs.feature')}: ${job.title}`}
                title={t('jobs.feature')}
                onClick={() => void feature(job)}
              >
                <Star
                  className={`size-4 ${job.featured ? 'fill-brand-gold text-brand-gold' : ''}`}
                  aria-hidden
                />
              </button>
              <button
                type="button"
                className={`${smallButton} text-destructive`}
                aria-label={`${t('jobs.delete')}: ${job.title}`}
                title={t('jobs.delete')}
                onClick={() => void remove(job)}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          );
        },
      },
    ];
  }, [call, confirm, editable, locale, reload, replace, router, t]);

  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <>
      <PageHeader title={t('jobs.title')} intro={t('jobs.intro')}>
        {editable ? (
          <Link href="/admin/jobs/new" className={cta.primary}>
            <Plus className="size-4" aria-hidden />
            {t('jobs.new')}
          </Link>
        ) : null}
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={filter(setQ)} placeholder={t('jobs.search')} />
        <select
          className={filterControl}
          aria-label={t('jobs.columns.status')}
          value={status}
          onChange={(event) => {
            filter(setStatus)(event.target.value);
          }}
        >
          <option value="">{t('jobs.allStatuses')}</option>
          {JOB_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`jobStatus.${value}`)}
            </option>
          ))}
        </select>
        <select
          className={filterControl}
          aria-label={t('jobs.destination')}
          value={destinationId}
          onChange={(event) => {
            filter(setDestinationId)(event.target.value);
          }}
        >
          <option value="">{t('jobs.allDestinations')}</option>
          {(lists?.destinations ?? []).map((destination) => (
            <option key={destination.id} value={destination.id}>
              {pick(destination.name, locale)}
            </option>
          ))}
        </select>
        <select
          className={filterControl}
          aria-label={t('jobs.category')}
          value={categoryId}
          onChange={(event) => {
            filter(setCategoryId)(event.target.value);
          }}
        >
          <option value="">{t('jobs.allCategories')}</option>
          {(lists?.categories ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {pick(category.name, locale)}
            </option>
          ))}
        </select>
      </div>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <>
          <DataTable
            label={t('jobs.title')}
            columns={columns}
            rows={data?.items ?? []}
            rowId={(job) => job.id}
            loading={loading}
            empty={t('jobs.empty')}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}
