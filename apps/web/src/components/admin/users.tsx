'use client';

import { PASSWORD_MIN_LENGTH } from '@iconbridge/shared/auth';
import { ADMIN_ROLES } from '@iconbridge/shared/enums';
import type { ColumnDef } from '@tanstack/react-table';
import { UserPlus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { PasswordField } from '@/components/auth/password-field';
import { CountrySelect } from '@/components/forms/country-select';
import { LoadFailed } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { api, type AdminUser } from '@/lib/client-api';
import { countryName, flag } from '@/lib/countries';
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

/** The countries of a country agent: chosen one by one, each removable (ISO codes). */
function CountriesPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (countries: string[]) => void;
}) {
  const t = useTranslations('admin.users');
  const locale = useLocale();
  return (
    <div className="space-y-2" data-testid="agent-countries">
      <CountrySelect
        label={t('countries')}
        hint={t('countriesHint')}
        name="agent-country"
        value={null}
        onChange={(code) => {
          if (code && !value.includes(code)) {
            onChange([...value, code]);
          }
        }}
      />
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((code) => (
            <li key={code}>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-secondary px-3 text-sm text-secondary-foreground hover:bg-secondary/80"
                aria-label={t('removeCountry', { country: countryName(code, locale) })}
                onClick={() => {
                  onChange(value.filter((item) => item !== code));
                }}
              >
                <span aria-hidden>{flag(code)}</span>
                {countryName(code, locale)}
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A new back-office account: by invitation email, or with a first password set now (ADR-024). */
function AddAccount({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const t = useTranslations('admin');
  const auth = useTranslations('auth');
  const call = useCall();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('RECRUITER');
  const [locale, setLocale] = useState<'en' | 'fr' | 'ar'>('en');
  const [countries, setCountries] = useState<string[]>([]);
  const [mode, setMode] = useState<'invitation' | 'password'>('invitation');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const agent = role === 'COUNTRY_AGENT';
  const ready =
    email.includes('@') &&
    (!agent || countries.length > 0) &&
    (mode === 'invitation' || password.length >= PASSWORD_MIN_LENGTH);
  const add = async () => {
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/users', {
        body: {
          email,
          role,
          locale,
          ...(agent ? { countries } : {}),
          ...(mode === 'password' ? { password } : {}),
        },
      }),
      mode === 'password' ? t('users.created', { email }) : t('users.invited', { email }),
    );
    setBusy(false);
    if (result.ok) {
      // Never kept once sent: the password is not shown again.
      setPassword('');
      onAdded();
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
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
      {agent ? <CountriesPicker value={countries} onChange={setCountries} /> : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('users.access')}</legend>
        {(['invitation', 'password'] as const).map((value) => (
          <label key={value} className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="radio"
              name="access"
              className="mt-1 size-4"
              checked={mode === value}
              onChange={() => {
                setMode(value);
              }}
            />
            <span>
              <span className="font-medium">{t(`users.accessMode.${value}`)}</span>
              <span className="block text-muted-foreground">{t(`users.accessHelp.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === 'password' ? (
        <PasswordField
          label={auth('newPassword')}
          name="first-password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          meter={{ password, inputs: [email] }}
        />
      ) : null}
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || !ready}>
          {mode === 'password' ? t('users.createAccount') : t('users.sendInvitation')}
        </button>
      </div>
    </form>
  );
}

/** Countries of an agent, when the role becomes COUNTRY_AGENT or to change them. */
function AgentCountries({
  user,
  onDone,
  onClose,
}: {
  user: AdminUser;
  onDone: (user: AdminUser) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const call = useCall();
  const [countries, setCountries] = useState<string[]>(user.assignedCountries);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const result = await call(
      api.PATCH('/api/v1/admin/users/{id}/role', {
        params: { path: { id: user.id } },
        body: { role: 'COUNTRY_AGENT', countries },
      }),
      t('users.countriesSaved'),
    );
    setBusy(false);
    if (result.ok) {
      onDone(result.data);
    }
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('users.countriesText', { email: user.email })}
      </p>
      <CountriesPicker value={countries} onChange={setCountries} />
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || countries.length === 0}>
          {t('users.saveCountries')}
        </button>
      </div>
    </form>
  );
}

/** A super admin sets the password of an account; the person must change it at the next sign-in. */
function SetPassword({
  user,
  onDone,
  onClose,
}: {
  user: AdminUser;
  onDone: (user: AdminUser) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const auth = useTranslations('auth');
  const call = useCall();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/users/{id}/password', {
        params: { path: { id: user.id } },
        body: { password },
      }),
      t('users.passwordSet'),
    );
    setBusy(false);
    setPassword('');
    if (result.ok) {
      onDone(result.data);
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="set-password-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('users.setPasswordText', { email: user.email })}
      </p>
      <PasswordField
        label={auth('newPassword')}
        name="set-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        meter={{ password, inputs: [user.email] }}
      />
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className={cta.primary}
          disabled={busy || password.length < PASSWORD_MIN_LENGTH}
        >
          {t('users.setPassword')}
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
  /** Account whose countries are being chosen, or whose password is being set. */
  const [countriesOf, setCountriesOf] = useState<AdminUser | null>(null);
  const [passwordOf, setPasswordOf] = useState<AdminUser | null>(null);
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
      if (role === 'COUNTRY_AGENT') {
        // An agent needs his countries: they are chosen with the role.
        setCountriesOf(user);
        return;
      }
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
        id: 'countries',
        enableSorting: false,
        header: t('users.countries'),
        cell: ({ row }) =>
          row.original.role === 'COUNTRY_AGENT' ? (
            <button
              type="button"
              className={`${smallButton} font-mono`}
              aria-label={t('users.editCountries', { email: row.original.email })}
              onClick={() => {
                setCountriesOf(row.original);
              }}
            >
              {row.original.assignedCountries.join(', ')}
            </button>
          ) : (
            '—'
          ),
      },
      {
        id: 'state',
        enableSorting: false,
        header: t('users.state'),
        cell: ({ row }) =>
          !row.original.isActive ? (
            <Badge tone="danger">{t('users.isDisabled')}</Badge>
          ) : row.original.passwordChangeRequired ? (
            <Badge tone="gold">{t('users.mustChangePassword')}</Badge>
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
                aria-label={`${t('users.setPassword')}: ${row.original.email}`}
                onClick={() => {
                  setPasswordOf(row.original);
                }}
              >
                {t('users.setPassword')}
              </button>
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
        open={countriesOf !== null}
        onClose={() => {
          setCountriesOf(null);
        }}
        title={t('users.countriesTitle')}
        closeLabel={common('close')}
      >
        {countriesOf ? (
          <AgentCountries
            user={countriesOf}
            onClose={() => {
              setCountriesOf(null);
            }}
            onDone={(user) => {
              setCountriesOf(null);
              if (data) {
                setData({
                  ...data,
                  items: data.items.map((item) => (item.id === user.id ? user : item)),
                });
              }
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={passwordOf !== null}
        onClose={() => {
          setPasswordOf(null);
        }}
        title={t('users.setPasswordTitle')}
        closeLabel={common('close')}
      >
        {passwordOf ? (
          <SetPassword
            user={passwordOf}
            onClose={() => {
              setPasswordOf(null);
            }}
            onDone={(user) => {
              setPasswordOf(null);
              if (data) {
                setData({
                  ...data,
                  items: data.items.map((item) => (item.id === user.id ? user : item)),
                });
              }
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={inviting}
        onClose={() => {
          setInviting(false);
        }}
        title={t('users.invite')}
        closeLabel={common('close')}
      >
        {inviting ? (
          <AddAccount
            onClose={() => {
              setInviting(false);
            }}
            onAdded={() => {
              setInviting(false);
              reload();
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
