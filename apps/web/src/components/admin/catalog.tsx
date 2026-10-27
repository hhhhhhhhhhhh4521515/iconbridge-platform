'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { CATEGORY_ICONS } from '@/lib/category-icons';
import { api, type AdminCategory, type AdminDestination } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { card, cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import {
  Badge,
  input,
  Labelled,
  LocalizedInput,
  PageHeader,
  smallButton,
  useCall,
  useConfirm,
} from './ui';

/** A category's icon as on the home page; an emoji or any other value as typed. */
function EntryIcon({ icon }: { icon: string | null }) {
  if (!icon) {
    return null;
  }
  const Icon = CATEGORY_ICONS[icon];
  return Icon ? (
    <Icon className="me-1 inline size-4 align-[-2px] text-muted-foreground" aria-hidden />
  ) : (
    <span className="me-1">{icon}</span>
  );
}

type Kind = 'destinations' | 'categories';
type Entry = (AdminDestination | AdminCategory) & {
  code?: string;
  slug?: string;
  sortOrder?: number;
};
const EMPTY = { en: '', fr: '', ar: '' };

function EntryEditor({
  kind,
  entry,
  onClose,
  onSaved,
}: {
  kind: Kind;
  entry: Entry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('admin.catalog');
  const common = useTranslations('admin.common');
  const call = useCall();
  const [key, setKey] = useState(entry?.code ?? entry?.slug ?? '');
  const [name, setName] = useState(entry?.name ?? EMPTY);
  const [icon, setIcon] = useState(entry?.icon ?? '');
  const [sortOrder, setSortOrder] = useState(String(entry?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(entry?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const complete = key.trim() && name.en.trim() && name.fr.trim() && name.ar.trim();

  const save = async () => {
    setBusy(true);
    const shared = { name, icon: icon.trim() || null, isActive };
    const request =
      kind === 'destinations'
        ? entry
          ? api.PATCH('/api/v1/admin/destinations/{id}', {
              params: { path: { id: entry.id } },
              body: { ...shared, sortOrder: Number(sortOrder) || 0 },
            })
          : api.POST('/api/v1/admin/destinations', {
              body: {
                ...shared,
                code: key.trim().toUpperCase(),
                sortOrder: Number(sortOrder) || 0,
              },
            })
        : entry
          ? api.PATCH('/api/v1/admin/categories/{id}', {
              params: { path: { id: entry.id } },
              body: shared,
            })
          : api.POST('/api/v1/admin/categories', {
              body: { ...shared, slug: key.trim().toLowerCase() },
            });
    const result = await call(
      request as Promise<{ data?: unknown; response?: Response }>,
      common('saved'),
    );
    setBusy(false);
    if (result.ok) {
      onSaved();
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="catalog-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled
          label={kind === 'destinations' ? t('code') : t('slug')}
          hint={entry ? t('keyLocked') : kind === 'destinations' ? t('codeHint') : t('slugHint')}
        >
          <input
            className={input}
            dir="ltr"
            value={key}
            disabled={entry !== null}
            onChange={(event) => {
              setKey(event.target.value);
            }}
          />
        </Labelled>
        <Labelled label={t('icon')} hint={t('iconHint')}>
          <input
            className={input}
            value={icon}
            onChange={(event) => {
              setIcon(event.target.value);
            }}
          />
        </Labelled>
        {kind === 'destinations' ? (
          <Labelled label={t('sortOrder')}>
            <input
              type="number"
              min={0}
              className={input}
              value={sortOrder}
              onChange={(event) => {
                setSortOrder(event.target.value);
              }}
            />
          </Labelled>
        ) : null}
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={isActive}
            onChange={(event) => {
              setIsActive(event.target.checked);
            }}
          />
          {t('isActive')}
        </label>
      </div>
      <LocalizedInput label={t('name')} required value={name} onChange={setName} />
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {common('cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || !complete}>
          {common('save')}
        </button>
      </div>
    </form>
  );
}

function Section({ kind, entries, reload }: { kind: Kind; entries: Entry[]; reload: () => void }) {
  const t = useTranslations('admin.catalog');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const { can } = useAdmin();
  const editable = can('MANAGE_CONTENT');
  // "new", an id, or null when the editor is closed.
  const [editing, setEditing] = useState<string | null>(null);

  const remove = async (entry: Entry) => {
    const yes = await confirm({
      title: t('deleteTitle'),
      text: t('deleteText', { name: pick(entry.name, locale) }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!yes) {
      return;
    }
    const result = await call(
      kind === 'destinations'
        ? api.DELETE('/api/v1/admin/destinations/{id}', { params: { path: { id: entry.id } } })
        : api.DELETE('/api/v1/admin/categories/{id}', { params: { path: { id: entry.id } } }),
    );
    if (result.ok) {
      // Something still used by jobs is switched off instead of deleted.
      toast.success(result.data.outcome === 'deleted' ? t('deleted') : t('deactivated'));
      reload();
    }
  };
  const edited =
    editing && editing !== 'new' ? entries.find((entry) => entry.id === editing) : null;
  return (
    <section className={`${card} p-5`} data-testid={`catalog-${kind}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t(kind)}</h2>
        {editable ? (
          <button
            type="button"
            className={cta.outline}
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t('add')}
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <div>
              <span className="font-medium">
                <EntryIcon icon={entry.icon} />
                {pick(entry.name, locale)}
              </span>{' '}
              <span className="text-xs text-muted-foreground" dir="ltr">
                {entry.code ?? entry.slug}
              </span>
              {entry.isActive ? null : <Badge tone="muted">{t('inactive')}</Badge>}
              <p className="text-xs text-muted-foreground">
                {t('jobCount', { count: entry.jobCount })}
              </p>
            </div>
            {editable ? (
              <div className="flex gap-1">
                <button
                  type="button"
                  className={smallButton}
                  aria-label={`${t('edit')}: ${pick(entry.name, locale)}`}
                  onClick={() => {
                    setEditing(entry.id);
                  }}
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${smallButton} text-destructive`}
                  aria-label={`${t('delete')}: ${pick(entry.name, locale)}`}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Modal
        open={editing !== null}
        onClose={() => {
          setEditing(null);
        }}
        title={editing === 'new' ? t('add') : t('edit')}
        closeLabel={common('close')}
        wide
      >
        {editing !== null ? (
          <EntryEditor
            key={editing}
            kind={kind}
            entry={edited ?? null}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        ) : null}
      </Modal>
    </section>
  );
}

export function CatalogManager() {
  const t = useTranslations('admin.catalog');
  const fetcher = useCallback(async () => {
    const [destinations, categories] = await Promise.all([
      api.GET('/api/v1/admin/destinations'),
      api.GET('/api/v1/admin/categories'),
    ]);
    return destinations.data && categories.data
      ? { destinations: destinations.data, categories: categories.data }
      : undefined;
  }, []);
  const { data, loading, failed, reload } = useLoaded(fetcher);
  if (loading && !data) {
    return <Loading lines={5} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Section kind="destinations" entries={data.destinations} reload={reload} />
        <Section kind="categories" entries={data.categories} reload={reload} />
      </div>
    </>
  );
}
