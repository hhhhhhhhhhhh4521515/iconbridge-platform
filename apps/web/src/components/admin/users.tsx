'use client';

import { ADMIN_ROLES } from '@iconbridge/shared/enums';
import type { ColumnDef } from '@tanstack/react-table';
import { UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { api, type AdminUser } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import {
  Badge,
  DataTable,
  dateTime,
  filterControl,
  input,
  Labelled,
  PageHeader,
  smallButton,
  useCall,
  useConfirm,
} from './ui';

type Role = AdminUser['role'];

function Invite({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const t = useTranslations('admin');
  const call = useCall();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('RECRUITER');
  const [locale, setLocale] = useState<'en' | 'fr' | 'ar'>('en');
  const [busy, setBusy] = useState(false);
  const invite = async () => {
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/users', { body: { email, role, locale } }),
      t('users.invited', { email }),
    );
    setBusy(false);
    if (result.ok) {
      onInvited();
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        void invite();
      }}
    >
      <p className="text-sm text-muted-foreground">{t('users.inviteText')}</p>
      <Labelled label={t('users.email')}>
        <input
          type="email"
          required
          className={input}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Labelled>
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label={t('users.role')}>
          <select
            className={input}
            value={role}
            onChange={(event) => {
              setRole(event.target.value as Role);
            }}
          >
            {ADMIN_ROLES.map((value) => (
              <option key={value} value={value}>
                {t(`roles.${value}`)}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label={t('users.emailLanguage')}>
          <select
            className={input}
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value as 'en' | 'fr' | 'ar');
            }}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </select>
        </Labelled>
      </div>
      <p className="rounded-lg bg-muted p-3 text-sm">{t(`users.roleHelp.${role}`)}</p>
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || !email.includes('@')}>
          {t('users.sendInvitation')}
        </button>
      </div>
    </form>
  );
}

export function UsersManager() {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const { user: me } = useAdmin();
  const [inviting, setInviting] = useState(false);
  const fetcher = useCallback(
    async () =>
      (await api.GET('/api/v1/admin/users', { params: { query: { pageSize: 100 } } })).data,
    [],
  );
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);

  const columns = useMemo<ColumnDef<AdminUser>[]>(() => {
    const replace = (user: AdminUser) => {
      if (data) {
        setData({ ...data, items: data.items.map((item) => (item.id === user.id ? user : item)) });
      }
    };
    const path = (id: string) => ({ params: { path: { id } } });
    const changeRole = async (user: AdminUser, role: Role) => {
      const yes = await confirm({
        title: t('users.roleTitle'),
        text: t('users.roleText', { email: user.email, role: t(`roles.${role}`) }),
        confirmLabel: t('users.changeRole'),
      });
      if (!yes) {
        return;
      }
      const result = await call(
        api.PATCH('/api/v1/admin/users/{id}/role', { ...path(user.id), body: { role } }),
        t('users.roleChanged'),
      );
      if (result.ok) {
        replace(result.data);
      }
    };
    const setActive = async (user: AdminUser, active: boolean) => {
      if (!active) {
        const yes = await confirm({
          title: t('users.disableTitle'),
          text: t('users.disableText', { email: user.email }),
          confirmLabel: t('users.disable'),
          destructive: true,
        });
        if (!yes) {
          return;
        }
      }
      const result = await call(
        api.POST(`/api/v1/admin/users/{id}/${active ? 'enable' : 'disable'}`, path(user.id)),
        active ? t('users.enabled') : t('users.disabled'),
      );
      if (result.ok) {
        replace(result.data);
      }
    };
    const forceLogout = async (user: AdminUser) => {
      const yes = await confirm({
        title: t('users.logoutTitle'),
        text: t('users.logoutText', { email: user.email }),
        confirmLabel: t('users.forceLogout'),
      });
      if (yes) {
        await call(
          api.POST('/api/v1/admin/users/{id}/force-logout', path(user.id)),
          t('users.loggedOut'),
        );
      }
    };
    const remove = async (user: AdminUser) => {
      const yes = await confirm({
        title: t('users.deleteTitle'),
        text: t('users.deleteText', { email: user.email }),
        confirmLabel: t('users.delete'),
        destructive: true,
      });
      if (!yes) {
        return;
      }
      const result = await call(
        api.DELETE('/api/v1/admin/users/{id}', path(user.id)),
        t('users.deleted'),
      );
      if (result.ok && data) {
        setData({
          ...data,
          items: data.items.filter((item) => item.id !== user.id),
          total: data.total - 1,
        });
      }
    };
    return [
      {
        accessorKey: 'email',
        header: t('users.email'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.email}
            {row.original.id === me.id ? (
              <span className="ms-2 text-xs text-muted-foreground">({t('users.you')})</span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'role',
        header: t('users.role'),
        cell: ({ row }) => (
          <select
            className={`${filterControl} min-h-9 py-1`}
            aria-label={`${t('users.role')}: ${row.original.email}`}
            value={row.original.role}
            disabled={row.original.id === me.id}
            onChange={(event) => void changeRole(row.original, event.target.value as Role)}
          >
            {ADMIN_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`roles.${role}`)}
              </option>
            ))}
          </select>
        ),
      },
      {
        id: 'state',
        enableSorting: false,
        header: t('users.state'),
        cell: ({ row }) =>
          !row.original.isActive ? (
            <Badge tone="danger">{t('users.isDisabled')}</Badge>
          ) : row.original.hasPassword ? (
            <Badge tone="success">{t('users.isActive')}</Badge>
          ) : (
            <Badge tone="gold">{t('users.isInvited')}</Badge>
          ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: t('users.lastLogin'),
        cell: ({ row }) =>
          row.original.lastLoginAt ? dateTime(row.original.lastLoginAt, locale) : '—',
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        cell: ({ row }) =>
          row.original.id === me.id ? null : (
            <div className="flex justify-end gap-1">
              <button
                type="button"
                className={smallButton}
                onClick={() => void forceLogout(row.original)}
              >
                {t('users.forceLogout')}
              </button>
              <button
                type="button"
                className={`${smallButton} ${row.original.isActive ? 'text-destructive' : ''}`}
                onClick={() => void setActive(row.original, !row.original.isActive)}
              >
                {row.original.isActive ? t('users.disable') : t('users.enable')}
              </button>
              <button
                type="button"
                className={`${smallButton} text-destructive`}
                aria-label={`${t('users.delete')}: ${row.original.email}`}
                onClick={() => void remove(row.original)}
              >
                {t('users.delete')}
              </button>
            </div>
          ),
      },
    ];
  }, [call, confirm, data, locale, me.id, setData, t]);

  return (
    <>
      <PageHeader title={t('users.title')} intro={t('users.intro')}>
        <button
          type="button"
          className={cta.primary}
          onClick={() => {
            setInviting(true);
          }}
        >
          <UserPlus className="size-4" aria-hidden />
          {t('users.invite')}
        </button>
      </PageHeader>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <DataTable
          label={t('users.title')}
          columns={columns}
          rows={data?.items ?? []}
          rowId={(row) => row.id}
          loading={loading}
          empty={t('users.empty')}
        />
      )}
      <Modal
        open={inviting}
        onClose={() => {
          setInviting(false);
        }}
        title={t('users.invite')}
        closeLabel={common('close')}
      >
        {inviting ? (
          <Invite
            onClose={() => {
              setInviting(false);
            }}
            onInvited={() => {
              setInviting(false);
              reload();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
