'use client';

import { FileCheck2, FileWarning, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useId, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { DateSelects } from '@/components/forms/date-field';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Modal } from '@/components/ui/modal';
import { api, type AdminDestination, type AdminStory } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { cta } from '@/lib/ui';
import { fileForm, ImageCropper } from './image-cropper';
import { SortableList } from './sortable';
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

const PHOTO_ASPECT = 4 / 5;
const EMPTY = { en: '', fr: '', ar: '' };

interface Draft {
  firstName: string;
  lastName: string;
  showFullName: boolean;
  jobTitle: string;
  destinationId: string;
  visaApprovedAt: string;
  quote: { en: string; fr: string; ar: string };
}

const toDraft = (story: AdminStory | null, destinations: AdminDestination[]): Draft => ({
  firstName: story?.firstName ?? '',
  lastName: story?.lastName ?? '',
  showFullName: story?.showFullName ?? false,
  jobTitle: story?.jobTitle ?? '',
  destinationId: story?.destination.id ?? destinations[0]?.id ?? '',
  visaApprovedAt: story?.visaApprovedAt ?? '',
  // A story created from an application starts with a placeholder quote.
  quote: story && story.quote.en !== '-' ? story.quote : EMPTY,
});

function StoryEditor({
  story,
  destinations,
  onClose,
  onSaved,
}: {
  story: AdminStory | null;
  destinations: AdminDestination[];
  onClose: () => void;
  onSaved: (story: AdminStory) => void;
}) {
  const t = useTranslations('admin.stories');
  const common = useTranslations('admin.common');
  const locale = useLocale();
  const call = useCall();
  const [draft, setDraft] = useState<Draft>(() => toDraft(story, destinations));
  const [busy, setBusy] = useState(false);
  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => {
    setDraft((before) => ({ ...before, [key]: value }));
  };
  // "What the candidate says" is optional in every language (ADR-024).
  const complete = draft.firstName.trim() && draft.jobTitle.trim() && draft.destinationId;
  const save = async () => {
    setBusy(true);
    const body = { ...draft, visaApprovedAt: draft.visaApprovedAt || null };
    const result = story
      ? await call(
          api.PATCH('/api/v1/admin/success-stories/{id}', {
            params: { path: { id: story.id } },
            body,
          }),
          common('saved'),
        )
      : await call(api.POST('/api/v1/admin/success-stories', { body }), t('created'));
    setBusy(false);
    if (result.ok) {
      onSaved(result.data);
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="story-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label={`${t('firstName')} *`}>
          <input
            className={input}
            value={draft.firstName}
            onChange={(event) => {
              set('firstName', event.target.value);
            }}
          />
        </Labelled>
        <Labelled label={t('lastName')}>
          <input
            className={input}
            value={draft.lastName}
            onChange={(event) => {
              set('lastName', event.target.value);
            }}
          />
        </Labelled>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={draft.showFullName}
            onChange={(event) => {
              set('showFullName', event.target.checked);
            }}
          />
          {t('showFullName')}
        </label>
        <Labelled label={`${t('jobTitle')} *`}>
          <input
            className={input}
            value={draft.jobTitle}
            onChange={(event) => {
              set('jobTitle', event.target.value);
            }}
          />
        </Labelled>
        <Labelled label={`${t('destination')} *`}>
          <select
            className={input}
            value={draft.destinationId}
            onChange={(event) => {
              set('destinationId', event.target.value);
            }}
          >
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {pick(destination.name, locale)}
              </option>
            ))}
          </select>
        </Labelled>
        <DateSelects
          label={t('visaApprovedAt')}
          value={draft.visaApprovedAt}
          onChange={(value) => {
            set('visaApprovedAt', value);
          }}
          fromYear={new Date().getFullYear()}
          toYear={2010}
        />
      </div>
      <LocalizedInput
        label={t('quote')}
        hint={t('quoteHint')}
        multiline
        value={draft.quote}
        onChange={(quote) => {
          set('quote', quote);
        }}
      />
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

function StoryRow({
  story,
  onChanged,
  onEdit,
  onDeleted,
}: {
  story: AdminStory;
  onChanged: (story: AdminStory) => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('admin.stories');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const consentId = useId();
  const path = { params: { path: { id: story.id } } };

  const upload = async (kind: 'photo' | 'consent', file: Blob, name: string, message: string) => {
    const result = await call(
      api.POST(`/api/v1/admin/success-stories/{id}/${kind}`, {
        ...path,
        body: { file: '' } as never,
        bodySerializer: () => fileForm(file, name),
      }),
      message,
    );
    if (result.ok) {
      onChanged(result.data);
    }
  };
  const publish = async (on: boolean) => {
    const result = await call(
      api.POST(`/api/v1/admin/success-stories/{id}/${on ? 'publish' : 'unpublish'}`, path),
      on ? t('published') : t('unpublished'),
    );
    if (result.ok) {
      onChanged(result.data);
    }
  };
  const remove = async () => {
    const yes = await confirm({
      title: t('deleteTitle'),
      text: t('deleteText', { name: story.publicName }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!yes) {
      return;
    }
    const result = await call(api.DELETE('/api/v1/admin/success-stories/{id}', path), t('deleted'));
    if (result.ok) {
      onDeleted();
    }
  };
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="story"
      data-published={story.isPublished}
    >
      {story.photoUrl ? (
        // Pictures of the back office come straight from the storage, at their stored size.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={story.photoUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
          {t('noPhoto')}
        </span>
      )}
      <div className="min-w-40 flex-1 text-sm">
        <p className="font-semibold">
          {story.publicName}{' '}
          <Badge tone={story.isPublished ? 'success' : 'neutral'}>
            {story.isPublished ? t('isPublished') : t('draft')}
          </Badge>
        </p>
        <p className="text-muted-foreground">
          {story.jobTitle} · {pick(story.destination.name, locale)}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs">
          {story.hasConsentDocument ? (
            <>
              <FileCheck2 className="size-3.5 text-emerald-600" aria-hidden />
              {t('consentOk')}
            </>
          ) : (
            <>
              <FileWarning className="size-3.5 text-destructive" aria-hidden />
              {t('consentMissing')}
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <ImageCropper
          aspect={PHOTO_ASPECT}
          label={t('photo')}
          onCropped={(file) => void upload('photo', file, 'photo.jpg', t('photoSaved'))}
        />
        <label htmlFor={consentId} className={`${cta.outline} cursor-pointer`}>
          <Upload className="size-4" aria-hidden />
          {t('consent')}
        </label>
        <input
          id={consentId}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          data-testid="consent-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              void upload('consent', file, file.name, t('consentSaved'));
            }
          }}
        />
        <button
          type="button"
          className={story.isPublished ? cta.outline : cta.gold}
          onClick={() => void publish(!story.isPublished)}
        >
          {story.isPublished ? t('unpublish') : t('publish')}
        </button>
        <button
          type="button"
          className={smallButton}
          aria-label={`${t('edit')}: ${story.publicName}`}
          onClick={onEdit}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={`${smallButton} text-destructive`}
          aria-label={`${t('delete')}: ${story.publicName}`}
          onClick={() => void remove()}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function StoriesManager() {
  const t = useTranslations('admin.stories');
  const common = useTranslations('common');
  const call = useCall();
  const requested = useSearchParams().get('edit');
  const fetcher = useCallback(async () => {
    const [stories, destinations] = await Promise.all([
      api.GET('/api/v1/admin/success-stories'),
      api.GET('/api/v1/admin/destinations'),
    ]);
    return stories.data && destinations.data
      ? { stories: stories.data, destinations: destinations.data }
      : undefined;
  }, []);
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);
  // "new", the id of a story, or null when the editor is closed.
  const [editing, setEditing] = useState<string | null>(requested);

  if (loading && !data) {
    return <Loading lines={5} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  const { stories, destinations } = data;
  const replace = (story: AdminStory) => {
    setData({
      ...data,
      stories: stories.some((entry) => entry.id === story.id)
        ? stories.map((entry) => (entry.id === story.id ? story : entry))
        : [...stories, story],
    });
  };
  const reorder = async (next: AdminStory[]) => {
    // The new order is shown at once and put back if the API refuses.
    setData({ ...data, stories: next });
    const result = await call(
      api.PUT('/api/v1/admin/success-stories/order', {
        body: { ids: next.map((story) => story.id) },
      }),
      t('reordered'),
    );
    setData({ ...data, stories: result.ok ? result.data : stories });
  };
  const edited =
    editing && editing !== 'new' ? stories.find((story) => story.id === editing) : null;
  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')}>
        <button
          type="button"
          className={cta.primary}
          onClick={() => {
            setEditing('new');
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t('new')}
        </button>
      </PageHeader>
      {stories.length === 0 ? (
        <p className="rounded-xl bg-muted p-6 text-center text-sm">{t('empty')}</p>
      ) : (
        <SortableList
          items={stories}
          onReorder={(next) => void reorder(next)}
          handleLabel={(story) => t('move', { name: story.publicName })}
          render={(story) => (
            <StoryRow
              story={story}
              onChanged={replace}
              onEdit={() => {
                setEditing(story.id);
              }}
              onDeleted={reload}
            />
          )}
        />
      )}
      <Modal
        open={editing !== null}
        onClose={() => {
          setEditing(null);
        }}
        title={editing === 'new' ? t('new') : t('edit')}
        closeLabel={common('close')}
        wide
      >
        {editing !== null ? (
          <StoryEditor
            key={editing}
            story={edited ?? null}
            destinations={destinations}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={(story) => {
              replace(story);
              setEditing(null);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
