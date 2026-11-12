'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { CountrySelect } from '@/components/forms/country-select';
import { LoadFailed } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { Link, useRouter } from '@/i18n/navigation';
import { api, type AdminPartnerSpace } from '@/lib/client-api';
import { countryName, flag } from '@/lib/countries';
import { cta } from '@/lib/ui';
import { Badge, DataTable, input, Labelled, PageHeader, useCall } from './ui';

/** The languages of the partner area (ADR-027), each written in itself. */
export const PARTNER_LOCALES = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['pl', 'Polski'],
] as const;
export type PartnerLocale = (typeof PARTNER_LOCALES)[number][0];

/** Name, country and default language: creating a space, or editing its settings. */
export function SpaceSettingsFields({
  name,
  country,
  defaultLocale,
  onChange,
}: {
  name: string;
  country: string | null;
  defaultLocale: PartnerLocale;
  onChange: (values: {
    name: string;
    country: string | null;
    defaultLocale: PartnerLocale;
  }) => void;
}) {
  const t = useTranslations('admin.partnerSpaces');
  const values = { name, country, defaultLocale };
  return (
    <div className="space-y-4">
      <Labelled label={t('name')}>
        <input
          required
          minLength={2}
          maxLength={120}
          className={input}
          name="space-name"
          value={name}
          onChange={(event) => {
            onChange({ ...values, name: event.target.value });
          }}
        />
      </Labelled>
      <div className="grid gap-4 sm:grid-cols-2">
        <CountrySelect
          label={t('country')}
          name="space-country"
          required
          value={country}
          onChange={(code) => {
            onChange({ ...values, country: code });
          }}
        />
        <Labelled label={t('defaultLocale')} hint={t('defaultLocaleHint')}>
          <select
            className={input}
            name="space-locale"
            value={defaultLocale}
            onChange={(event) => {
              onChange({ ...values, defaultLocale: event.target.value as PartnerLocale });
            }}
          >
            {PARTNER_LOCALES.map(([code, label]) => (
              <option key={code} value={code} lang={code}>
                {label}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
    </div>
  );
}

function CreateSpace({ onClose }: { onClose: () => void }) {
  const t = useTranslations('admin');
  const call = useCall();
  const router = useRouter();
  const [values, setValues] = useState<{
    name: string;
    country: string | null;
    defaultLocale: PartnerLocale;
  }>({ name: '', country: null, defaultLocale: 'en' });
  const [busy, setBusy] = useState(false);
  const ready = values.name.trim().length >= 2 && values.country !== null;
  const create = async () => {
    if (!values.country) {
      return;
    }
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/partner-spaces', {
        body: {
          name: values.name.trim(),
          country: values.country,
          defaultLocale: values.defaultLocale,
        },
      }),
      t('partnerSpaces.created'),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      router.push(`/admin/partner-spaces/${result.data.id}`);
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="create-space-form"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <SpaceSettingsFields {...values} onChange={setValues} />
      <p className="rounded-lg bg-muted p-3 text-sm">{t('partnerSpaces.createHelp')}</p>
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || !ready}>
          {t('partnerSpaces.create')}
        </button>
      </div>
    </form>
  );
}

/** The partner spaces (ADR-027), for super admins: settings and counts, never content. */
export function PartnerSpacesList() {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const locale = useLocale();
  const [creating, setCreating] = useState(false);
  const fetcher = useCallback(async () => (await api.GET('/api/v1/admin/partner-spaces')).data, []);
  const { data, loading, failed, reload } = useLoaded(fetcher);

  const columns = useMemo<ColumnDef<AdminPartnerSpace>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('partnerSpaces.name'),
        cell: ({ row }) => (
          <Link
            href={`/admin/partner-spaces/${row.original.id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'country',
        header: t('partnerSpaces.country'),
        cell: ({ row }) => (
          <span>
            <span aria-hidden>{flag(row.original.country)} </span>
            {countryName(row.original.country, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('partnerSpaces.state'),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge tone="success">{t('partnerSpaces.active')}</Badge>
          ) : (
            <Badge tone="danger">{t('partnerSpaces.disabled')}</Badge>
          ),
      },
      {
        id: 'members',
        header: t('partnerSpaces.staffMembers'),
        accessorFn: (row) => row.counts.staffMembers,
      },
      {
        id: 'logins',
        header: t('partnerSpaces.partnerLogins'),
        accessorFn: (row) => row.counts.partnerLogins,
      },
      {
        id: 'membership',
        enableSorting: false,
        header: t('partnerSpaces.you'),
        cell: ({ row }) =>
          row.original.isMember ? <Badge tone="info">{t('partnerSpaces.member')}</Badge> : '—',
      },
    ],
    [locale, t],
  );

  return (
    <>
      <PageHeader title={t('partnerSpaces.title')} intro={t('partnerSpaces.intro')}>
        <button
          type="button"
          className={cta.primary}
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t('partnerSpaces.new')}
        </button>
      </PageHeader>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <DataTable
          label={t('partnerSpaces.title')}
          columns={columns}
          rows={data ?? []}
          rowId={(row) => row.id}
          loading={loading}
          empty={t('partnerSpaces.empty')}
        />
      )}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        title={t('partnerSpaces.new')}
        closeLabel={common('close')}
      >
        {creating ? (
          <CreateSpace
            onClose={() => {
              setCreating(false);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
