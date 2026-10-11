'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Eye, EyeOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Link } from '@/i18n/navigation';
import { api, type AdminCandidate } from '@/lib/client-api';
import { countryName, flag } from '@/lib/countries';
import { languageName } from '@/lib/format';
import { card, cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import { DocumentsList } from './documents-list';
import { ApplicationBadge } from './status';
import {
  Badge,
  DataTable,
  filterControl,
  PageHeader,
  Pager,
  SearchBox,
  shortDate,
  useCall,
  useConfirm,
} from './ui';

const PAGE_SIZE = 25;

export function CandidatesList() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const fetcher = useCallback(
    async () =>
      (
        await api.GET('/api/v1/admin/candidates', {
          params: {
            query: {
              page,
              pageSize: PAGE_SIZE,
              ...(q.trim().length >= 2 ? { q: q.trim() } : {}),
              ...(active ? { active: active as 'true' | 'false' } : {}),
            },
          },
        })
      ).data,
    [active, page, q],
  );
  const { data, loading, failed, reload } = useLoaded(fetcher);
  const columns = useMemo<ColumnDef<AdminCandidate>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (row) => `${row.lastName} ${row.firstName}`,
        header: t('candidates.name'),
        cell: ({ row }) => (
          <div>
            <Link
              href={`/admin/candidates/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {row.original.firstName} {row.original.lastName}
            </Link>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        ),
      },
      {
        accessorKey: 'nationality',
        header: t('candidates.nationality'),
        cell: ({ row }) =>
          row.original.nationality
            ? `${flag(row.original.nationality)} ${countryName(row.original.nationality, locale)}`
            : '—',
      },
      {
        accessorKey: 'currentProfession',
        header: t('candidates.profession'),
        cell: ({ row }) => row.original.currentProfession ?? '—',
      },
      {
        accessorKey: 'passportNumberMasked',
        enableSorting: false,
        header: t('candidates.passport'),
        cell: ({ row }) => <span dir="ltr">{row.original.passportNumberMasked ?? '—'}</span>,
      },
      { accessorKey: 'applicationCount', header: t('candidates.applications') },
      {
        accessorKey: 'registeredAt',
        header: t('candidates.registered'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{shortDate(row.original.registeredAt, locale)}</span>
        ),
      },
      {
        id: 'state',
        enableSorting: false,
        header: t('candidates.account'),
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge tone={row.original.emailVerified ? 'success' : 'neutral'}>
              {row.original.emailVerified ? t('candidates.verified') : t('candidates.notVerified')}
            </Badge>
          ) : (
            <Badge tone="danger">{t('candidates.disabled')}</Badge>
          ),
      },
    ],
    [locale, t],
  );
  return (
    <>
      <PageHeader title={t('candidates.title')} intro={t('candidates.intro')} />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
          placeholder={t('candidates.search')}
        />
        <select
          className={filterControl}
          aria-label={t('candidates.account')}
          value={active}
          onChange={(event) => {
            setActive(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('candidates.allAccounts')}</option>
          <option value="true">{t('candidates.activeOnly')}</option>
          <option value="false">{t('candidates.disabledOnly')}</option>
        </select>
      </div>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <>
          <DataTable
            label={t('candidates.title')}
            columns={columns}
            rows={data?.items ?? []}
            rowId={(row) => row.id}
            loading={loading}
            empty={t('candidates.empty')}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}

/**
 * The passport number is masked for everybody. Recruiters and super admins can show
 * it with a button; each use is written to the audit log by the API. A viewer has
 * no button, and the API would answer 403.
 */
function Passport({ candidateId, masked }: { candidateId: string; masked: string | null }) {
  const t = useTranslations('admin.candidates');
  const call = useCall();
  const { can } = useAdmin();
  const [clear, setClear] = useState<string | null>(null);
  if (!masked) {
    return <span>—</span>;
  }
  const reveal = async () => {
    const result = await call(
      api.POST('/api/v1/admin/candidates/{id}/reveal-passport', {
        params: { path: { id: candidateId } },
      }),
    );
    if (result.ok) {
      setClear(result.data.passportNumber);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span dir="ltr" className="font-mono" data-testid="passport-number">
        {clear ?? masked}
      </span>
      {can('MANAGE_APPLICATIONS') ? (
        clear ? (
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium hover:bg-muted"
            onClick={() => {
              setClear(null);
            }}
          >
            <EyeOff className="size-4" aria-hidden />
            {t('hide')}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium hover:bg-muted"
            title={t('revealHint')}
            onClick={() => void reveal()}
          >
            <Eye className="size-4" aria-hidden />
            {t('reveal')}
          </button>
        )
      ) : null}
    </span>
  );
}

export function CandidateDetail({ id }: { id: string }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const { can } = useAdmin();
  const fetcher = useCallback(
    async () => (await api.GET('/api/v1/admin/candidates/{id}', { params: { path: { id } } })).data,
    [id],
  );
  const { data, loading, failed, reload } = useLoaded(fetcher);
  if (loading && !data) {
    return <Loading lines={6} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  const { profile } = data;
  const country = (code: string | null) =>
    code ? `${flag(code)} ${countryName(code, locale)}` : '—';
  const setActive = async (active: boolean) => {
    if (!active) {
      const yes = await confirm({
        title: t('candidates.disableTitle'),
        text: t('candidates.disableText'),
        confirmLabel: t('candidates.disable'),
        destructive: true,
      });
      if (!yes) {
        return;
      }
    }
    const result = await call(
      api.POST(`/api/v1/admin/candidates/{id}/${active ? 'enable' : 'disable'}`, {
        params: { path: { id } },
      }),
      active ? t('candidates.enabled') : t('candidates.disabledDone'),
    );
    if (result.ok) {
      reload();
    }
  };
  const rows: [string, React.ReactNode][] = [
    ['email', data.email],
    [
      'phone',
      <span key="phone" dir="ltr">
        {profile.phone ?? '—'}
      </span>,
    ],
    ['dateOfBirth', profile.dateOfBirth ?? '—'],
    ['nationality', country(profile.nationality)],
    ['countryOfResidence', country(profile.countryOfResidence)],
    ['city', profile.city ?? '—'],
    [
      'passport',
      <Passport key="passport" candidateId={id} masked={profile.passportNumberMasked} />,
    ],
    ['passportExpiryDate', profile.passportExpiryDate ?? '—'],
    ['profession', profile.currentProfession ?? '—'],
    ['experience', profile.yearsOfExperience === null ? '—' : String(profile.yearsOfExperience)],
    [
      'languages',
      profile.languages.length > 0
        ? profile.languages
            .map((entry) => `${languageName(entry.language, locale)} (${entry.level})`)
            .join(', ')
        : '—',
    ],
    ['completeness', `${String(profile.profileCompleteness.percentage)}%`],
  ];
  return (
    <>
      <PageHeader title={`${data.firstName} ${data.lastName}`}>
        {data.isActive ? null : <Badge tone="danger">{t('candidates.disabled')}</Badge>}
        {can('MANAGE_APPLICATIONS') ? (
          <button
            type="button"
            className={
              data.isActive ? `${cta.outline} border-destructive text-destructive` : cta.outline
            }
            onClick={() => void setActive(!data.isActive)}
          >
            {data.isActive ? t('candidates.disable') : t('candidates.enable')}
          </button>
        ) : null}
      </PageHeader>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className={`${card} p-5`}>
          <h2 className="mb-3 text-lg font-semibold">{t('candidates.profile')}</h2>
          <dl
            className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2"
            data-testid="candidate-profile"
          >
            {rows.map(([key, value]) => (
              <div key={key}>
                <dt className="text-muted-foreground">{t(`candidates.fields.${key}`)}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="space-y-5">
          <section className={`${card} p-5`}>
            <h2 className="mb-3 text-lg font-semibold">{t('candidates.documents')}</h2>
            <DocumentsList documents={data.documents} />
          </section>
          <section className={`${card} p-5`}>
            <h2 className="mb-3 text-lg font-semibold">{t('candidates.applicationsTitle')}</h2>
            {data.applications.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('applications.empty')}</p>
            ) : (
              <ul className="divide-y divide-border" data-testid="candidate-applications">
                {data.applications.map((application) => (
                  <li
                    key={application.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div>
                      <Link
                        href={`/admin/applications?open=${application.id}`}
                        className="font-medium hover:underline"
                      >
                        {application.job.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {shortDate(application.appliedAt, locale)}
                      </p>
                    </div>
                    <ApplicationBadge status={application.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
