'use client';

import { PASSWORD_MIN_LENGTH } from '@iconbridge/shared/auth';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, ExternalLink, ImageUp, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { PasswordField } from '@/components/auth/password-field';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { Link, useRouter } from '@/i18n/navigation';
import {
  api,
  type AdminPartnerSpace,
  type AdminUser,
  type PartnerLogin,
  type PartnerStaffMember,
} from '@/lib/client-api';
import { countryName } from '@/lib/countries';
import { cta } from '@/lib/ui';
import { useAdmin } from './admin-context';
import { fileForm } from './image-cropper';
import { SpaceSettingsFields, type PartnerLocale } from './partner-spaces';
import {
  Badge,
  DataTable,
  dateTime,
  input,
  Labelled,
  PageHeader,
  smallButton,
  useCall,
  useConfirm,
} from './ui';

const heading = 'text-lg font-semibold';
const card = 'rounded-xl border border-border bg-card p-4 md:p-5';

const spacePath = (spaceId: string) => ({ params: { path: { spaceId } } });

// ---------------------------------------------------------------------------
// Settings and logo
// ---------------------------------------------------------------------------

function Settings({
  space,
  onSaved,
}: {
  space: AdminPartnerSpace;
  onSaved: (space: AdminPartnerSpace) => void;
}) {
  const t = useTranslations('admin');
  const call = useCall();
  const [values, setValues] = useState<{
    name: string;
    country: string | null;
    defaultLocale: PartnerLocale;
  }>({ name: space.name, country: space.country, defaultLocale: space.defaultLocale });
  const [busy, setBusy] = useState(false);
  const changed =
    values.name.trim() !== space.name ||
    values.country !== space.country ||
    values.defaultLocale !== space.defaultLocale;
  const save = async () => {
    if (!values.country) {
      return;
    }
    setBusy(true);
    const result = await call(
      api.PATCH('/api/v1/admin/partner-spaces/{spaceId}', {
        ...spacePath(space.id),
        body: {
          name: values.name.trim(),
          country: values.country,
          defaultLocale: values.defaultLocale,
        },
      }),
      t('partnerSpaces.saved'),
    );
    setBusy(false);
    if (result.ok) {
      onSaved(result.data);
    }
  };
  return (
    <section className={card} aria-labelledby="space-settings">
      <h2 id="space-settings" className={`${heading} mb-4`}>
        {t('partnerSpaces.settings')}
      </h2>
      <form
        className="space-y-4"
        data-testid="space-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SpaceSettingsFields {...values} onChange={setValues} />
        <div className="flex justify-end">
          <button
            type="submit"
            className={cta.primary}
            disabled={busy || !changed || values.name.trim().length < 2 || !values.country}
          >
            {t('partnerSpaces.save')}
          </button>
        </div>
      </form>
    </section>
  );
}

function Logo({
  space,
  onSaved,
}: {
  space: AdminPartnerSpace;
  onSaved: (space: AdminPartnerSpace) => void;
}) {
  const t = useTranslations('admin');
  const call = useCall();
  const confirm = useConfirm();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    const result = await call(
      api.PUT('/api/v1/admin/partner-spaces/{spaceId}/logo', {
        ...spacePath(space.id),
        body: { file: '' } as never,
        bodySerializer: () => fileForm(file, file.name),
      }),
      t('partnerSpaces.logoSaved'),
    );
    setBusy(false);
    if (result.ok) {
      onSaved(result.data);
    }
  };
  const remove = async () => {
    const yes = await confirm({
      title: t('partnerSpaces.removeLogo'),
      text: t('partnerSpaces.removeLogoText'),
      confirmLabel: t('partnerSpaces.removeLogo'),
      destructive: true,
    });
    if (!yes) {
      return;
    }
    const result = await call(
      api.DELETE('/api/v1/admin/partner-spaces/{spaceId}/logo', spacePath(space.id)),
      t('partnerSpaces.logoRemoved'),
    );
    if (result.ok) {
      onSaved(result.data);
    }
  };
  return (
    <section className={card} aria-labelledby="space-logo">
      <h2 id="space-logo" className={`${heading} mb-2`}>
        {t('partnerSpaces.logo')}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground" data-testid="logo-state">
        {space.hasLogo ? t('partnerSpaces.hasLogo') : t('partnerSpaces.noLogo')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className={`${cta.outline} cursor-pointer`} aria-disabled={busy}>
          <ImageUp className="size-4" aria-hidden />
          {space.hasLogo ? t('partnerSpaces.replaceLogo') : t('partnerSpaces.uploadLogo')}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          data-testid="logo-input"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              void upload(file);
            }
          }}
        />
        {space.hasLogo ? (
          <button
            type="button"
            className={`${smallButton} text-destructive`}
            onClick={() => void remove()}
          >
            {t('partnerSpaces.removeLogo')}
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('partnerSpaces.logoHint')}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Members (staff) and logins (the partner company)
// ---------------------------------------------------------------------------

function AddMember({
  spaceId,
  members,
  onAdded,
  onClose,
}: {
  spaceId: string;
  members: PartnerStaffMember[];
  onAdded: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const call = useCall();
  const fetcher = useCallback(
    async () =>
      (await api.GET('/api/v1/admin/users', { params: { query: { pageSize: 100 } } })).data,
    [],
  );
  const { data, failed, reload } = useLoaded(fetcher);
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const taken = new Set(members.map((member) => member.userId));
  const choices = (data?.items ?? []).filter(
    (user: AdminUser) => user.isActive && !taken.has(user.id),
  );
  const add = async () => {
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/partner-spaces/{spaceId}/members', {
        ...spacePath(spaceId),
        body: { userId },
      }),
      t('partnerSpaces.memberAdded'),
    );
    setBusy(false);
    if (result.ok) {
      onAdded();
    }
  };
  if (failed) {
    return <LoadFailed onRetry={reload} />;
  }
  return (
    <form
      className="space-y-4"
      data-testid="add-member-form"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <p className="text-sm text-muted-foreground">{t('partnerSpaces.addMemberText')}</p>
      <Labelled label={t('partnerSpaces.account')}>
        <select
          required
          className={input}
          name="member"
          value={userId}
          onChange={(event) => {
            setUserId(event.target.value);
          }}
        >
          <option value="">{t('partnerSpaces.chooseAccount')}</option>
          {choices.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email} — {t(`roles.${user.role}`)}
            </option>
          ))}
        </select>
      </Labelled>
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || userId === ''}>
          {t('partnerSpaces.addMember')}
        </button>
      </div>
    </form>
  );
}

function Members({ space, onChange }: { space: AdminPartnerSpace; onChange: () => void }) {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const { user: me } = useAdmin();
  const [adding, setAdding] = useState(false);
  const fetcher = useCallback(
    async () =>
      (await api.GET('/api/v1/admin/partner-spaces/{spaceId}/members', spacePath(space.id))).data,
    [space.id],
  );
  const { data, loading, failed, reload } = useLoaded(fetcher);
  const columns = useMemo<ColumnDef<PartnerStaffMember>[]>(() => {
    const remove = async (member: PartnerStaffMember) => {
      const yes = await confirm({
        title: t('partnerSpaces.removeMemberTitle'),
        text: t('partnerSpaces.removeMemberText', { email: member.email }),
        confirmLabel: t('partnerSpaces.removeMember'),
        destructive: true,
      });
      if (!yes) {
        return;
      }
      const result = await call(
        api.DELETE('/api/v1/admin/partner-spaces/{spaceId}/members/{userId}', {
          params: { path: { spaceId: space.id, userId: member.userId } },
        }),
        t('partnerSpaces.memberRemoved'),
      );
      if (result.ok) {
        reload();
        onChange();
      }
    };
    return [
      {
        accessorKey: 'email',
        header: t('partnerSpaces.account'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.displayName ?? row.original.email}
            {row.original.displayName ? (
              <span className="block text-xs text-muted-foreground">{row.original.email}</span>
            ) : null}
            {row.original.userId === me.id ? (
              <span className="ms-2 text-xs text-muted-foreground">({t('users.you')})</span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'role',
        header: t('users.role'),
        cell: ({ row }) => t(`roles.${row.original.role}`),
      },
      {
        accessorKey: 'addedAt',
        header: t('partnerSpaces.addedAt'),
        cell: ({ row }) => dateTime(row.original.addedAt, locale),
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <button
              type="button"
              className={`${smallButton} text-destructive`}
              aria-label={`${t('partnerSpaces.removeMember')}: ${row.original.email}`}
              onClick={() => void remove(row.original)}
            >
              {t('partnerSpaces.removeMember')}
            </button>
          </div>
        ),
      },
    ];
  }, [call, confirm, locale, me.id, onChange, reload, space.id, t]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('partnerSpaces.membersHelp')}</p>
        <button
          type="button"
          className={cta.primary}
          onClick={() => {
            setAdding(true);
          }}
        >
          <UserPlus className="size-4" aria-hidden />
          {t('partnerSpaces.addMember')}
        </button>
      </div>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <DataTable
          label={t('partnerSpaces.members')}
          columns={columns}
          rows={data ?? []}
          rowId={(row) => row.userId}
          loading={loading}
          empty={t('partnerSpaces.noMembers')}
        />
      )}
      <Modal
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title={t('partnerSpaces.addMember')}
        closeLabel={common('close')}
      >
        {adding ? (
          <AddMember
            spaceId={space.id}
            members={data ?? []}
            onClose={() => {
              setAdding(false);
            }}
            onAdded={() => {
              setAdding(false);
              reload();
              onChange();
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

/** A login of the partner company, with its first password set now (ADR-024, ADR-027). */
function CreateLogin({
  space,
  onCreated,
  onClose,
}: {
  space: AdminPartnerSpace;
  onCreated: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const auth = useTranslations('auth');
  const call = useCall();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const ready =
    email.includes('@') && displayName.trim().length > 0 && password.length >= PASSWORD_MIN_LENGTH;
  const create = async () => {
    setBusy(true);
    const result = await call(
      api.POST('/api/v1/admin/partner-spaces/{spaceId}/logins', {
        ...spacePath(space.id),
        body: { email, displayName: displayName.trim(), password },
      }),
      t('partnerSpaces.loginCreated', { email }),
    );
    setBusy(false);
    // Never kept once sent: the password is not shown again.
    setPassword('');
    if (result.ok) {
      onCreated();
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="create-login-form"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <Labelled label={t('users.email')}>
        <input
          type="email"
          required
          autoComplete="off"
          className={input}
          name="login-email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </Labelled>
      <Labelled label={t('partnerSpaces.displayName')} hint={t('partnerSpaces.displayNameHint')}>
        <input
          required
          maxLength={80}
          className={input}
          name="login-name"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
          }}
        />
      </Labelled>
      <PasswordField
        label={auth('newPassword')}
        name="login-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        meter={{ password, inputs: [email, displayName] }}
      />
      <p className="rounded-lg bg-muted p-3 text-sm">
        {t('partnerSpaces.loginHelp', { language: space.defaultLocale.toUpperCase() })}
      </p>
      <div className="flex justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className={cta.primary} disabled={busy || !ready}>
          {t('partnerSpaces.createLogin')}
        </button>
      </div>
    </form>
  );
}

function SetLoginPassword({
  spaceId,
  login,
  onDone,
  onClose,
}: {
  spaceId: string;
  login: PartnerLogin;
  onDone: () => void;
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
      api.POST('/api/v1/admin/partner-spaces/{spaceId}/logins/{userId}/password', {
        params: { path: { spaceId, userId: login.id } },
        body: { password },
      }),
      t('users.passwordSet'),
    );
    setBusy(false);
    setPassword('');
    if (result.ok) {
      onDone();
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="login-password-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('users.setPasswordText', { email: login.email })}
      </p>
      <PasswordField
        label={auth('newPassword')}
        name="login-new-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
        meter={{ password, inputs: [login.email] }}
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

function Logins({ space, onChange }: { space: AdminPartnerSpace; onChange: () => void }) {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [passwordOf, setPasswordOf] = useState<PartnerLogin | null>(null);
  const fetcher = useCallback(
    async () =>
      (await api.GET('/api/v1/admin/partner-spaces/{spaceId}/logins', spacePath(space.id))).data,
    [space.id],
  );
  const { data, loading, failed, reload } = useLoaded(fetcher);
  const columns = useMemo<ColumnDef<PartnerLogin>[]>(() => {
    const setActive = async (login: PartnerLogin, isActive: boolean) => {
      if (!isActive) {
        const yes = await confirm({
          title: t('users.disableTitle'),
          text: t('partnerSpaces.disableLoginText', { email: login.email }),
          confirmLabel: t('users.disable'),
          destructive: true,
        });
        if (!yes) {
          return;
        }
      }
      const result = await call(
        api.PATCH('/api/v1/admin/partner-spaces/{spaceId}/logins/{userId}', {
          params: { path: { spaceId: space.id, userId: login.id } },
          body: { isActive },
        }),
        isActive ? t('users.enabled') : t('users.disabled'),
      );
      if (result.ok) {
        reload();
      }
    };
    return [
      {
        accessorKey: 'displayName',
        header: t('partnerSpaces.displayName'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.displayName ?? '—'}
            <span className="block text-xs text-muted-foreground">{row.original.email}</span>
          </span>
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
          ) : (
            <Badge tone="success">{t('users.isActive')}</Badge>
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
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className={smallButton}
              aria-label={`${t('users.setPassword')}: ${row.original.email}`}
              onClick={() => {
                setPasswordOf(row.original);
              }}
            >
              <KeyRound className="size-4" aria-hidden />
              {t('users.setPassword')}
            </button>
            <button
              type="button"
              className={`${smallButton} ${row.original.isActive ? 'text-destructive' : ''}`}
              aria-label={`${row.original.isActive ? t('users.disable') : t('users.enable')}: ${row.original.email}`}
              onClick={() => void setActive(row.original, !row.original.isActive)}
            >
              {row.original.isActive ? t('users.disable') : t('users.enable')}
            </button>
          </div>
        ),
      },
    ];
  }, [call, confirm, locale, reload, space.id, t]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('partnerSpaces.loginsHelp')}</p>
        <button
          type="button"
          className={cta.primary}
          onClick={() => {
            setCreating(true);
          }}
        >
          <UserPlus className="size-4" aria-hidden />
          {t('partnerSpaces.createLogin')}
        </button>
      </div>
      {failed ? (
        <LoadFailed onRetry={reload} />
      ) : (
        <DataTable
          label={t('partnerSpaces.logins')}
          columns={columns}
          rows={data ?? []}
          rowId={(row) => row.id}
          loading={loading}
          empty={t('partnerSpaces.noLogins')}
        />
      )}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
        title={t('partnerSpaces.createLogin')}
        closeLabel={common('close')}
      >
        {creating ? (
          <CreateLogin
            space={space}
            onClose={() => {
              setCreating(false);
            }}
            onCreated={() => {
              setCreating(false);
              reload();
              onChange();
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
          <SetLoginPassword
            spaceId={space.id}
            login={passwordOf}
            onClose={() => {
              setPasswordOf(null);
            }}
            onDone={() => {
              setPasswordOf(null);
              reload();
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs and deletion
// ---------------------------------------------------------------------------

function Tabs({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const id = useId();
  const [current, setCurrent] = useState(tabs[0]?.key ?? '');
  const select = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab) {
      setCurrent(tab.key);
      document.getElementById(`${id}-tab-${tab.key}`)?.focus();
    }
  };
  return (
    <div className={card}>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            id={`${id}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={current === tab.key}
            aria-controls={`${id}-panel-${tab.key}`}
            tabIndex={current === tab.key ? 0 : -1}
            className="-mb-px min-h-11 border-b-2 border-transparent px-4 text-sm font-semibold text-muted-foreground hover:text-foreground aria-selected:border-primary aria-selected:text-foreground"
            onClick={() => {
              setCurrent(tab.key);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const forward = (event.key === 'ArrowRight') !== (document.dir === 'rtl');
                select(index + (forward ? 1 : -1));
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={`${id}-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab.key}`}
          hidden={current !== tab.key}
        >
          {current === tab.key ? tab.content : null}
        </div>
      ))}
    </div>
  );
}

/** Deleting a space (GDPR): states what goes, and asks for the space's name. */
function DeleteSpace({ space, onClose }: { space: AdminPartnerSpace; onClose: () => void }) {
  const t = useTranslations('admin');
  const call = useCall();
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = typed.trim() === space.name;
  const remove = async () => {
    setBusy(true);
    const result = await call(
      api.DELETE('/api/v1/admin/partner-spaces/{spaceId}', {
        ...spacePath(space.id),
        body: { confirmName: typed.trim() },
      }),
      t('partnerSpaces.deleted'),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      router.push('/admin/partner-spaces');
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="delete-space-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) {
          void remove();
        }
      }}
    >
      <div>
        <p className="text-sm font-medium">{t('deletion.willRemove')}</p>
        <ul className="mt-1 list-disc ps-6 text-sm" data-testid="delete-removed">
          <li>{t('partnerSpaces.deleteJobs', { count: space.counts.jobs })}</li>
          <li>{t('partnerSpaces.deleteApplications', { count: space.counts.applications })}</li>
          <li>{t('partnerSpaces.deleteFiles', { count: space.counts.files })}</li>
          <li>{t('partnerSpaces.deleteLogins', { count: space.counts.partnerLogins })}</li>
          <li>{t('partnerSpaces.deleteHistory')}</li>
        </ul>
      </div>
      <p className="text-sm">{t('partnerSpaces.deleteKeeps')}</p>
      <Labelled label={t('partnerSpaces.typeName', { name: space.name })}>
        <input
          className={input}
          autoComplete="off"
          spellCheck={false}
          name="confirm-name"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
      </Labelled>
      <p className="text-sm text-muted-foreground">{t('deletion.irreversible')}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className={`${cta.primary} bg-destructive text-white hover:bg-destructive/90`}
          disabled={!ready || busy}
          aria-busy={busy}
        >
          {t('partnerSpaces.delete')}
        </button>
      </div>
    </form>
  );
}

/** One partner space, for super admins: settings, logo, members, logins, deletion. */
export function PartnerSpaceEditor({ id }: { id: string }) {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const fetcher = useCallback(
    async () => (await api.GET('/api/v1/admin/partner-spaces/{spaceId}', spacePath(id))).data,
    [id],
  );
  const { data: space, failed, reload, setData } = useLoaded(fetcher);

  if (!space) {
    // Only before the first answer: a reload keeps the screen (and its open dialogs).
    return failed ? <LoadFailed onRetry={reload} /> : <Loading lines={6} />;
  }
  const setActive = async (isActive: boolean) => {
    if (!isActive) {
      const yes = await confirm({
        title: t('partnerSpaces.disableTitle'),
        text: t('partnerSpaces.disableText', { name: space.name }),
        confirmLabel: t('partnerSpaces.disable'),
        destructive: true,
      });
      if (!yes) {
        return;
      }
    }
    const result = await call(
      api.PATCH('/api/v1/admin/partner-spaces/{spaceId}', {
        ...spacePath(space.id),
        body: { isActive },
      }),
      isActive ? t('partnerSpaces.enabled') : t('partnerSpaces.disabledToast'),
    );
    if (result.ok) {
      setData(result.data);
    }
  };
  return (
    <div className="space-y-5">
      <Link
        href="/admin/partner-spaces"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t('partnerSpaces.back')}
      </Link>
      <PageHeader
        title={space.name}
        intro={`${countryName(space.country, locale)} · ${t('partnerSpaces.createdOn', {
          date: dateTime(space.createdAt, locale),
        })}`}
      >
        {space.isActive ? (
          <Badge tone="success">{t('partnerSpaces.active')}</Badge>
        ) : (
          <Badge tone="danger">{t('partnerSpaces.disabled')}</Badge>
        )}
        {space.isMember ? (
          // The partner area lives outside the site's languages (ADR-027): a plain link.
          <a href={`/partners/${space.defaultLocale}/spaces/${space.id}`} className={cta.outline}>
            <ExternalLink className="size-4" aria-hidden />
            {t('partnerSpaces.open')}
          </a>
        ) : null}
        <button
          type="button"
          className={cta.outline}
          onClick={() => void setActive(!space.isActive)}
        >
          {space.isActive ? t('partnerSpaces.disable') : t('partnerSpaces.enable')}
        </button>
        <button
          type="button"
          className={`${cta.outline} text-destructive`}
          onClick={() => {
            setDeleting(true);
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          {t('partnerSpaces.delete')}
        </button>
      </PageHeader>
      {!space.isMember ? (
        <p
          className="rounded-lg border border-border bg-muted p-3 text-sm"
          data-testid="not-member"
        >
          {t('partnerSpaces.notMember')}
        </p>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-3" data-testid="space-counts">
        {(
          [
            ['jobs', space.counts.jobs],
            ['applications', space.counts.applications],
            ['files', space.counts.files],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className={card}>
            <dt className="text-sm text-muted-foreground">{t(`partnerSpaces.counts.${key}`)}</dt>
            <dd className="text-2xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-5 lg:grid-cols-2">
        <Settings space={space} onSaved={setData} />
        <Logo space={space} onSaved={setData} />
      </div>
      <Tabs
        tabs={[
          {
            key: 'members',
            label: `${t('partnerSpaces.members')} (${String(space.counts.staffMembers)})`,
            content: <Members space={space} onChange={reload} />,
          },
          {
            key: 'logins',
            label: `${t('partnerSpaces.logins')} (${String(space.counts.partnerLogins)})`,
            content: <Logins space={space} onChange={reload} />,
          },
        ]}
      />
      <Modal
        open={deleting}
        onClose={() => {
          setDeleting(false);
        }}
        title={t('partnerSpaces.deleteTitle', { name: space.name })}
        closeLabel={common('close')}
      >
        {deleting ? (
          <DeleteSpace
            space={space}
            onClose={() => {
              setDeleting(false);
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
