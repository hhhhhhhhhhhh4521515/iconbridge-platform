'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_COLUMNS,
  type ExportColumn,
} from '@iconbridge/shared/admin';
import { APPLICATION_PIPELINE, APPLICATION_STATUSES } from '@iconbridge/shared/enums';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { Columns3, Download, Table2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  api,
  attempt,
  failure,
  type AdminApplication,
  type ApplicationStatus,
} from '@/lib/client-api';
import { pick } from '@/lib/format';
import { cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import { ApplicationDrawer } from './application-drawer';
import { ApplicationBadge } from './status';
import {
  DataTable,
  filterControl,
  PageHeader,
  Pager,
  SearchBox,
  shortDate,
  smallButton,
  useCall,
} from './ui';

const PAGE_SIZE = 25;
/** The board shows the newest applications of the current filters, up to this many. */
const BOARD_SIZE = 100;
const BOARD_COLUMNS: ApplicationStatus[] = [...APPLICATION_PIPELINE, 'REJECTED', 'WITHDRAWN'];

interface Filters {
  q: string;
  status: string;
  destination: string;
  jobId: string;
}

function query(filters: Filters, withStatus: boolean) {
  return {
    ...(filters.q.trim().length >= 2 ? { q: filters.q.trim() } : {}),
    ...(withStatus && filters.status ? { status: filters.status as ApplicationStatus } : {}),
    ...(filters.destination ? { destination: filters.destination } : {}),
    ...(filters.jobId ? { jobId: filters.jobId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportDialog({
  open,
  onClose,
  ids,
  filters,
}: {
  open: boolean;
  onClose: () => void;
  ids: string[];
  filters: Filters;
}) {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const { user } = useAdmin();
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [columns, setColumns] = useState<ExportColumn[]>([...DEFAULT_EXPORT_COLUMNS]);
  const [busy, setBusy] = useState(false);
  const fullPassport = columns.includes('passportNumber');

  const download = async () => {
    setBusy(true);
    const { data, error, response } = await attempt(
      api.POST('/api/v1/admin/applications/export', {
        body: {
          format,
          // The order of the file follows the order of the list, not the order of the clicks.
          columns: EXPORT_COLUMNS.filter((column) => columns.includes(column)),
          includeFullPassportNumber: fullPassport,
          ...(ids.length > 0 ? { ids } : { filters: query(filters, true) }),
        } as never,
        parseAs: 'blob',
      }),
    );
    setBusy(false);
    if (!response?.ok || !data) {
      toast.error(
        failure(error).code === 'FORBIDDEN'
          ? t('common.forbidden')
          : t('applications.exportFailed'),
      );
      return;
    }
    const url = URL.createObjectURL(data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `applications-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('applications.exported'));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('applications.exportTitle')}
      closeLabel={common('close')}
    >
      <div className="space-y-4" data-testid="export-dialog">
        <p className="text-sm text-muted-foreground">
          {ids.length > 0
            ? t('applications.exportSelection', { count: ids.length })
            : t('applications.exportFilters')}
        </p>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('applications.format')}</legend>
          <div className="flex gap-4">
            {(['xlsx', 'csv'] as const).map((value) => (
              <label key={value} className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="format"
                  className="size-4 accent-primary"
                  checked={format === value}
                  onChange={() => {
                    setFormat(value);
                  }}
                />
                {value === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('applications.columns')}</legend>
          <div className="grid grid-cols-2 gap-x-3">
            {EXPORT_COLUMNS.filter(
              (column) => column !== 'passportNumber' || user.role === 'SUPER_ADMIN',
            ).map((column) => (
              <label key={column} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={columns.includes(column)}
                  onChange={(event) => {
                    setColumns((before) =>
                      event.target.checked
                        ? [...before, column]
                        : before.filter((entry) => entry !== column),
                    );
                  }}
                />
                {t(`exportColumns.${column}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {fullPassport ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {t('applications.fullPassportWarning')}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <button type="button" className={cta.outline} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={cta.primary}
            disabled={busy || columns.length === 0}
            onClick={() => void download()}
          >
            <Download className="size-4" aria-hidden />
            {t('applications.download')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Kanban board
// ---------------------------------------------------------------------------

function Card({
  application,
  draggable,
  onOpen,
}: {
  application: AdminApplication;
  draggable: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    disabled: !draggable,
    data: { application },
  });
  return (
    <li
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${String(transform.x)}px, ${String(transform.y)}px)` }
          : undefined
      }
      className={`rounded-lg border border-border bg-background p-2.5 text-sm shadow-sm ${
        isDragging ? 'relative z-10 opacity-80 shadow-lg' : ''
      } ${draggable ? 'cursor-grab touch-none' : ''}`}
      data-testid="board-card"
      data-id={application.id}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        className="block w-full text-start font-medium hover:underline"
        onClick={() => {
          onOpen(application.id);
        }}
      >
        {application.candidate.firstName} {application.candidate.lastName}
      </button>
      <p className="truncate text-xs text-muted-foreground">{application.job.title}</p>
    </li>
  );
}

function Column({
  status,
  applications,
  draggable,
  onOpen,
}: {
  status: ApplicationStatus;
  applications: AdminApplication[];
  draggable: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('admin.status');
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={t(status)}
      data-testid="board-column"
      data-status={status}
      className={`flex w-60 shrink-0 flex-col rounded-xl border p-2 ${
        isOver ? 'border-brand-gold bg-brand-gold-soft' : 'border-border bg-muted/50'
      }`}
    >
      <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
        {t(status)}
        <span className="rounded-full bg-background px-2 text-xs text-muted-foreground">
          {applications.length}
        </span>
      </h3>
      <ul className="flex min-h-24 flex-1 flex-col gap-2">
        {applications.map((application) => (
          <Card
            key={application.id}
            application={application}
            draggable={draggable && application.allowedTransitions.length > 0}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One column per status. Dropping a card on another column asks the API to change
 * the status; a move the state machine does not allow is refused here with a
 * message, and the API would refuse it too.
 */
function Board({
  applications,
  onMove,
  onOpen,
  draggable,
}: {
  applications: AdminApplication[];
  onMove: (application: AdminApplication, to: ApplicationStatus) => void;
  onOpen: (id: string) => void;
  draggable: boolean;
}) {
  const sensors = useSensors(
    // A small distance before a drag starts, so a click on the name still opens the detail.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const application = (
      event.active.data.current as { application?: AdminApplication } | undefined
    )?.application;
    const to = event.over?.id as ApplicationStatus | undefined;
    if (application && to && to !== application.status) {
      onMove(application, to);
    }
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3" data-testid="board">
        {BOARD_COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            applications={applications.filter((application) => application.status === status)}
            draggable={draggable}
            onOpen={onOpen}
          />
        ))}
      </div>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Applications() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const call = useCall();
  const { can } = useAdmin();
  const editable = can('MANAGE_APPLICATIONS');
  const view = search.get('view') === 'board' ? 'board' : 'table';
  const opened = search.get('open');
  const [filters, setFilters] = useState<Filters>({
    q: '',
    status: '',
    destination: '',
    jobId: search.get('jobId') ?? '',
  });
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [bulkStatus, setBulkStatus] = useState('');
  const [exporting, setExporting] = useState(false);

  const setParam = useCallback(
    (name: string, value: string | null) => {
      const params = new URLSearchParams(search.toString());
      if (value === null) {
        params.delete(name);
      } else {
        params.set(name, value);
      }
      const text = params.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [pathname, router, search],
  );
  const open = useCallback(
    (id: string) => {
      setParam('open', id);
    },
    [setParam],
  );

  const destinations = useLoaded(
    useCallback(async () => (await api.GET('/api/v1/admin/destinations')).data, []),
  ).data;

  const fetcher = useCallback(
    async () =>
      (
        await api.GET('/api/v1/admin/applications', {
          params: {
            query:
              view === 'board'
                ? { page: 1, pageSize: BOARD_SIZE, sort: 'newest', ...query(filters, false) }
                : { page, pageSize: PAGE_SIZE, sort: 'newest', ...query(filters, true) },
          },
        })
      ).data,
    [filters, page, view],
  );
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);
  const rows = useMemo(() => data?.items ?? [], [data]);
  const selected = Object.keys(selection).filter((id) => selection[id]);

  const change = (patch: Partial<Filters>) => {
    setFilters((before) => ({ ...before, ...patch }));
    setPage(1);
    setSelection({});
  };

  const move = async (application: AdminApplication, to: ApplicationStatus) => {
    if (!application.allowedTransitions.includes(to)) {
      toast.error(
        t('applications.moveRefused', {
          from: t(`status.${application.status}`),
          to: t(`status.${to}`),
        }),
      );
      return;
    }
    if (!data) {
      return;
    }
    // Shown in its new column at once; put back if the API refuses.
    setData({
      ...data,
      items: data.items.map((item) =>
        item.id === application.id ? { ...item, status: to, allowedTransitions: [] } : item,
      ),
    });
    const result = await call(
      api.PATCH('/api/v1/admin/applications/{id}/status', {
        params: { path: { id: application.id } },
        body: { status: to },
      }),
      t('applications.statusChanged', { status: t(`status.${to}`) }),
    );
    if (!result.ok) {
      setData(data);
      return;
    }
    reload();
  };

  const bulk = async () => {
    if (!bulkStatus || selected.length === 0) {
      return;
    }
    const result = await call(
      api.POST('/api/v1/admin/applications/bulk-status', {
        body: { ids: selected, status: bulkStatus as ApplicationStatus },
      }),
    );
    if (!result.ok) {
      return;
    }
    const { changed, failed: refused } = result.data;
    if (refused > 0) {
      toast.warning(t('applications.bulkPartly', { changed, refused }));
    } else {
      toast.success(t('applications.bulkDone', { changed }));
    }
    setSelection({});
    setBulkStatus('');
    reload();
  };

  const columns = useMemo<ColumnDef<AdminApplication>[]>(() => {
    const select: ColumnDef<AdminApplication> = {
      id: 'select',
      enableSorting: false,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="size-4 accent-primary"
          aria-label={t('applications.selectAll')}
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="size-4 accent-primary"
          aria-label={t('applications.selectOne', {
            name: `${row.original.candidate.firstName} ${row.original.candidate.lastName}`,
          })}
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    };
    const base: ColumnDef<AdminApplication>[] = [
      {
        id: 'candidate',
        accessorFn: (row) => `${row.candidate.lastName} ${row.candidate.firstName}`,
        header: t('applications.candidate'),
        cell: ({ row }) => (
          <div>
            <button
              type="button"
              className="text-start font-medium hover:underline"
              onClick={() => {
                open(row.original.id);
              }}
            >
              {row.original.candidate.firstName} {row.original.candidate.lastName}
            </button>
            <p className="text-xs text-muted-foreground">{row.original.candidate.email}</p>
          </div>
        ),
      },
      {
        id: 'job',
        accessorFn: (row) => row.job.title,
        header: t('applications.job'),
        cell: ({ row }) => (
          <div>
            {row.original.job.title}
            <p className="text-xs text-muted-foreground">
              {row.original.job.destinationCode.replaceAll('_', ' ')}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'appliedAt',
        header: t('applications.appliedAt'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{shortDate(row.original.appliedAt, locale)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('applications.status'),
        cell: ({ row }) => <ApplicationBadge status={row.original.status} />,
      },
    ];
    return editable ? [select, ...base] : base;
  }, [editable, locale, open, t]);

  return (
    <>
      <PageHeader title={t('applications.title')} intro={t('applications.intro')}>
        <div
          className="flex rounded-lg border border-border p-0.5"
          role="group"
          aria-label={t('applications.view')}
        >
          {(
            [
              ['table', Table2],
              ['board', Columns3],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              className={`${smallButton} aria-pressed:bg-secondary aria-pressed:text-secondary-foreground`}
              onClick={() => {
                setSelection({});
                setParam('view', key === 'board' ? 'board' : null);
              }}
            >
              <Icon className="size-4" aria-hidden />
              {t(`applications.views.${key}`)}
            </button>
          ))}
        </div>
        {can('EXPORT_APPLICATIONS') ? (
          <button
            type="button"
            className={cta.outline}
            onClick={() => {
              setExporting(true);
            }}
          >
            <Download className="size-4" aria-hidden />
            {t('applications.export')}
          </button>
        ) : null}
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox
          value={filters.q}
          onChange={(q) => {
            change({ q });
          }}
          placeholder={t('applications.search')}
        />
        {view === 'table' ? (
          <select
            className={filterControl}
            aria-label={t('applications.status')}
            value={filters.status}
            onChange={(event) => {
              change({ status: event.target.value });
            }}
          >
            <option value="">{t('applications.allStatuses')}</option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className={filterControl}
          aria-label={t('jobs.destination')}
          value={filters.destination}
          onChange={(event) => {
            change({ destination: event.target.value });
          }}
        >
          <option value="">{t('jobs.allDestinations')}</option>
          {(destinations ?? []).map((destination) => (
            <option key={destination.id} value={destination.code}>
              {pick(destination.name, locale)}
            </option>
          ))}
        </select>
        {filters.jobId ? (
          <button
            type="button"
            className={cta.ghost}
            onClick={() => {
              change({ jobId: '' });
              setParam('jobId', null);
            }}
          >
            {t('applications.clearJob')}
          </button>
        ) : null}
      </div>

      {editable && view === 'table' && selected.length > 0 ? (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
          data-testid="bulk-bar"
        >
          <span className="text-sm font-medium">
            {t('applications.selected', { count: selected.length })}
          </span>
          <select
            className={filterControl}
            aria-label={t('applications.bulkStatus')}
            value={bulkStatus}
            onChange={(event) => {
              setBulkStatus(event.target.value);
            }}
          >
            <option value="">{t('applications.bulkStatus')}</option>
            {APPLICATION_STATUSES.filter(
              (status) => status !== 'SUBMITTED' && status !== 'WITHDRAWN',
            ).map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={cta.primary}
            disabled={!bulkStatus}
            onClick={() => void bulk()}
          >
            {t('applications.apply')}
          </button>
        </div>
      ) : null}

      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : view === 'board' ? (
        <>
          <Board
            applications={rows}
            onMove={(a, to) => void move(a, to)}
            onOpen={open}
            draggable={editable}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {t('applications.boardCount', { shown: rows.length, total: data?.total ?? 0 })}
          </p>
        </>
      ) : (
        <>
          <DataTable
            label={t('applications.title')}
            columns={columns}
            rows={rows}
            rowId={(row) => row.id}
            loading={loading}
            empty={t('applications.empty')}
            selection={selection}
            {...(editable ? { onSelectionChange: setSelection } : {})}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}

      <ApplicationDrawer
        id={opened}
        onClose={() => {
          setParam('open', null);
        }}
        onChanged={reload}
      />
      <ExportDialog
        open={exporting}
        onClose={() => {
          setExporting(false);
        }}
        ids={selected}
        filters={filters}
      />
    </>
  );
}
