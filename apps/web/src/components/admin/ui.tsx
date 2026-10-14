'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { toast } from 'sonner';
import { useApiErrorText } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { failure } from '@/lib/client-api';
import { cta, field } from '@/lib/ui';

export const input = `${field} aria-[invalid=true]:border-destructive`;
/** A control as wide as its content, for the filter rows. */
export const filterControl = input.replace('w-full', 'w-auto max-w-full');
export const smallButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50';

export function PageHeader({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {intro ? <p className="mt-1 text-sm text-muted-foreground">{intro}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

const TONES = {
  neutral: 'bg-muted text-foreground',
  info: 'bg-secondary text-secondary-foreground',
  gold: 'bg-brand-gold text-brand-navy',
  // emerald-700: white text on emerald-600 has too little contrast (3.7 for 4.5 required).
  success: 'bg-emerald-700 text-white',
  danger: 'bg-destructive/15 text-destructive',
  muted: 'bg-muted text-muted-foreground',
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Calls to the API with a toast
// ---------------------------------------------------------------------------

type Result<T> = { ok: true; data: T } | { ok: false; code: string; details: unknown };

/**
 * Runs a call of the typed client and tells the outcome: a toast with the translated
 * error when it fails, and the given message when it succeeds.
 */
export function useCall(): <T>(
  request: Promise<{ data?: T; error?: unknown; response?: Response }>,
  success?: string,
) => Promise<Result<T>> {
  const apiError = useApiErrorText();
  const t = useTranslations('admin.common');
  const errors = useTranslations('admin.errors');
  return useCallback(
    async <T,>(
      request: Promise<{ data?: T; error?: unknown; response?: Response }>,
      success?: string,
    ): Promise<Result<T>> => {
      let outcome: { data?: T; error?: unknown; response?: Response };
      try {
        outcome = await request;
      } catch {
        outcome = { error: { code: 'INTERNAL_ERROR' } };
      }
      if (outcome.response?.ok) {
        if (success) {
          toast.success(success);
        }
        return { ok: true, data: outcome.data as T };
      }
      const refused = failure(outcome.error);
      // The back office has its own wording for the errors only its users can meet.
      toast.error(
        refused.code === 'FORBIDDEN'
          ? t('forbidden')
          : errors.has(refused.code)
            ? errors(refused.code)
            : apiError(refused.code),
      );
      return { ok: false, code: refused.code, details: refused.details };
    },
    [apiError, errors, t],
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialog
// ---------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  destructive?: boolean;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/** `await confirm({...})` opens a dialog and answers true when the person confirms. */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm is used outside the back office');
  }
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('admin.common');
  const common = useTranslations('common');
  const [pending, setPending] = useState<{
    options: ConfirmOptions;
    resolve: (answer: boolean) => void;
  } | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );
  const answer = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => {
          answer(false);
        }}
        title={pending?.options.title ?? ''}
        closeLabel={common('close')}
      >
        {pending?.options.text ? <p className="text-sm">{pending.options.text}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className={cta.outline}
            onClick={() => {
              answer(false);
            }}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            data-testid="confirm-yes"
            className={
              pending?.options.destructive
                ? `${cta.primary} bg-destructive text-white hover:bg-destructive/90`
                : cta.primary
            }
            onClick={() => {
              answer(true);
            }}
          >
            {pending?.options.confirmLabel}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Search box with keyboard shortcut
// ---------------------------------------------------------------------------

/** "/" or Ctrl+K (⌘K on a Mac) puts the cursor in the search box of the page. */
function useSearchShortcut(target: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
      const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (combo || (event.key === '/' && !typing)) {
        event.preventDefault();
        target.current?.focus();
        target.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [target]);
}

/** Search field: what is typed is sent after a short pause, not at every key. */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const t = useTranslations('admin.common');
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  useSearchShortcut(ref);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text !== value) {
        onChange(text);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, value, onChange]);
  return (
    <div className="relative min-w-56 flex-1">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-keyshortcuts="/ Control+K"
        className={`${input} ps-9 pe-14`}
      />
      <kbd
        className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-xs text-muted-foreground sm:block"
        title={t('searchShortcut')}
      >
        /
      </kbd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data table
// ---------------------------------------------------------------------------

/**
 * A table built with TanStack Table: click a header to sort the rows shown, tick
 * rows when `selection` is given. Paging and filtering are done by the API.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowId,
  loading,
  empty,
  selection,
  onSelectionChange,
  label,
}: {
  columns: ColumnDef<Row>[];
  rows: Row[];
  rowId: (row: Row) => string;
  loading?: boolean;
  empty: string;
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  label: string;
}) {
  const t = useTranslations('admin.common');
  const [sorting, setSorting] = useState<SortingState>([]);
  // TanStack Table keeps its own mutable state: the React compiler leaves this component alone.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: rowId,
    state: { sorting, rowSelection: selection ?? {} },
    onSortingChange: setSorting,
    enableRowSelection: Boolean(onSelectionChange),
    onRowSelectionChange: (updater) => {
      onSelectionChange?.(typeof updater === 'function' ? updater(selection ?? {}) : updater);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="relative overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm" aria-label={label} aria-busy={loading}>
        <thead className="border-b border-border bg-muted/50 text-start">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    className="px-3 py-2.5 text-start font-semibold whitespace-nowrap"
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                    }
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:underline"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : null}
                        {sorted === 'desc' ? <ArrowDown className="size-3.5" aria-hidden /> : null}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/40" data-selected={row.getIsSelected()}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2.5 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {loading && rows.length === 0 ? (
        <p role="status" className="p-6 text-center text-sm text-muted-foreground">
          {t('loading')}
        </p>
      ) : null}
      {!loading && rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground" data-testid="empty">
          {empty}
        </p>
      ) : null}
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('admin.common');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" data-testid="total">
        {t('results', { count: total })}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={smallButton}
          disabled={page <= 1}
          onClick={() => {
            onPage(page - 1);
          }}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t('previous')}
        </button>
        <span>{t('pageOf', { page, pages })}</span>
        <button
          type="button"
          className={smallButton}
          disabled={page >= pages}
          onClick={() => {
            onPage(page + 1);
          }}
        >
          {t('next')}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** One text in the three languages of the site, side by side. */
export function LocalizedInput({
  label,
  value,
  onChange,
  multiline,
  required,
}: {
  label: string;
  value: { en: string; fr: string; ar: string };
  onChange: (value: { en: string; fr: string; ar: string }) => void;
  multiline?: boolean;
  required?: boolean;
}) {
  const languages = [
    ['en', 'English'],
    ['fr', 'Français'],
    ['ar', 'العربية'],
  ] as const;
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </legend>
      <div className="grid gap-2 md:grid-cols-3">
        {languages.map(([code, name]) => {
          const props = {
            'aria-label': `${label} (${name})`,
            placeholder: name,
            lang: code,
            dir: code === 'ar' ? ('rtl' as const) : ('ltr' as const),
            className: input,
            value: value[code],
            required,
          };
          return multiline ? (
            <textarea
              key={code}
              rows={3}
              {...props}
              onChange={(event) => {
                onChange({ ...value, [code]: event.target.value });
              }}
            />
          ) : (
            <input
              key={code}
              {...props}
              onChange={(event) => {
                onChange({ ...value, [code]: event.target.value });
              }}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

/** Label above a control, for the forms of the back office. */
export function Labelled({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-sm text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function dateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}
