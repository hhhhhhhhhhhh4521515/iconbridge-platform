'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { Modal } from '@/components/ui/modal';
import { api, type AdminDestination, type AdminSlide } from '@/lib/client-api';
import { DESTINATION_IMAGES, pick } from '@/lib/format';
import { card, cta } from '@/lib/ui';
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

const SLIDE_ASPECT = 16 / 9;
const EMPTY = { en: '', fr: '', ar: '' };
type Text = typeof EMPTY;

interface Draft {
  title: Text;
  subtitle: Text;
  ctaLabel: Text;
  ctaUrl: string;
  destinationId: string;
}

/** All three languages or nothing: a half-filled optional text is sent as absent. */
const optional = (text: Text) => (text.en.trim() && text.fr.trim() && text.ar.trim() ? text : null);

function SlideEditor({
  slide,
  destinations,
  onClose,
  onSaved,
}: {
  slide: AdminSlide | null;
  destinations: AdminDestination[];
  onClose: () => void;
  onSaved: (slide: AdminSlide) => void;
}) {
  const t = useTranslations('admin.slides');
  const common = useTranslations('admin.common');
  const locale = useLocale();
  const call = useCall();
  const [draft, setDraft] = useState<Draft>({
    title: slide?.title ?? EMPTY,
    subtitle: slide?.subtitle ?? EMPTY,
    ctaLabel: slide?.ctaLabel ?? EMPTY,
    ctaUrl: slide?.ctaUrl ?? '',
    destinationId: slide?.destinationId ?? '',
  });
  const [busy, setBusy] = useState(false);
  const complete = draft.title.en.trim() && draft.title.fr.trim() && draft.title.ar.trim();
  const save = async () => {
    setBusy(true);
    const body = {
      title: draft.title,
      subtitle: optional(draft.subtitle),
      ctaLabel: optional(draft.ctaLabel),
      ctaUrl: draft.ctaUrl.trim() || null,
      destinationId: draft.destinationId || null,
    };
    const result = slide
      ? await call(
          api.PATCH('/api/v1/admin/home-slides/{id}', {
            params: { path: { id: slide.id } },
            body,
          }),
          common('saved'),
        )
      : await call(api.POST('/api/v1/admin/home-slides', { body }), t('created'));
    setBusy(false);
    if (result.ok) {
      onSaved(result.data);
    }
  };
  return (
    <form
      className="space-y-4"
      data-testid="slide-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <LocalizedInput
        label={t('slideTitle')}
        required
        value={draft.title}
        onChange={(title) => {
          setDraft({ ...draft, title });
        }}
      />
      <LocalizedInput
        label={t('subtitle')}
        value={draft.subtitle}
        onChange={(subtitle) => {
          setDraft({ ...draft, subtitle });
        }}
      />
      <LocalizedInput
        label={t('ctaLabel')}
        value={draft.ctaLabel}
        onChange={(ctaLabel) => {
          setDraft({ ...draft, ctaLabel });
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Labelled label={t('ctaUrl')} hint={t('ctaUrlHint')}>
          <input
            className={input}
            dir="ltr"
            placeholder="/jobs?destination=MALTA"
            value={draft.ctaUrl}
            onChange={(event) => {
              setDraft({ ...draft, ctaUrl: event.target.value });
            }}
          />
        </Labelled>
        <Labelled label={t('destination')}>
          <select
            className={input}
            value={draft.destinationId}
            onChange={(event) => {
              setDraft({ ...draft, destinationId: event.target.value });
            }}
          >
            <option value="">—</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {pick(destination.name, locale)}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
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

/** The real slider of the home page, at half size, fed with the active slides as they are now. */
function LivePreview({ slides }: { slides: AdminSlide[] }) {
  const t = useTranslations('admin.slides');
  const locale = useLocale();
  const active = slides.filter((slide) => slide.isActive);
  if (active.length === 0) {
    return <p className="rounded-xl bg-muted p-6 text-center text-sm">{t('previewEmpty')}</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border" data-testid="slider-preview">
      <div style={{ zoom: 0.5 }}>
        <HeroCarousel
          // A new list of slides starts the slider again from the first one.
          key={active.map((slide) => `${slide.id}:${slide.imageUrl ?? ''}`).join('|')}
          slides={active.map((slide) => ({
            id: slide.id,
            title: pick(slide.title, locale),
            subtitle: pick(slide.subtitle, locale),
            image:
              slide.imageUrl ??
              DESTINATION_IMAGES[slide.destinationCode ?? ''] ??
              '/brand/hero-malta-1.webp',
            ctaLabel: pick(slide.ctaLabel, locale) || t('previewCta'),
            ctaHref: '#',
          }))}
          labels={{
            region: t('preview'),
            slideOf: t('previewSlideOf'),
            pause: t('previewPause'),
            play: t('previewPlay'),
            secondaryCta: t('previewSecondary'),
          }}
        >
          {null}
        </HeroCarousel>
      </div>
    </div>
  );
}

export function SlidesManager() {
  const t = useTranslations('admin.slides');
  const common = useTranslations('common');
  const locale = useLocale();
  const call = useCall();
  const confirm = useConfirm();
  const fetcher = useCallback(async () => {
    const [slides, destinations] = await Promise.all([
      api.GET('/api/v1/admin/home-slides'),
      api.GET('/api/v1/admin/destinations'),
    ]);
    return slides.data && destinations.data
      ? { slides: slides.data, destinations: destinations.data }
      : undefined;
  }, []);
  const { data, loading, failed, reload, setData } = useLoaded(fetcher);
  const [editing, setEditing] = useState<string | null>(null);

  if (loading && !data) {
    return <Loading lines={5} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  const { slides, destinations } = data;
  const replace = (slide: AdminSlide) => {
    setData({
      ...data,
      slides: slides.some((entry) => entry.id === slide.id)
        ? slides.map((entry) => (entry.id === slide.id ? slide : entry))
        : [...slides, slide],
    });
  };
  const reorder = async (next: AdminSlide[]) => {
    setData({ ...data, slides: next });
    const result = await call(
      api.PUT('/api/v1/admin/home-slides/order', { body: { ids: next.map((slide) => slide.id) } }),
      t('reordered'),
    );
    setData({ ...data, slides: result.ok ? result.data : slides });
  };
  const toggle = async (slide: AdminSlide) => {
    replace({ ...slide, isActive: !slide.isActive });
    const result = await call(
      api.PATCH('/api/v1/admin/home-slides/{id}', {
        params: { path: { id: slide.id } },
        body: { isActive: !slide.isActive },
      }),
    );
    replace(result.ok ? result.data : slide);
  };
  const upload = async (slide: AdminSlide, file: Blob) => {
    const result = await call(
      api.POST('/api/v1/admin/home-slides/{id}/image', {
        params: { path: { id: slide.id } },
        body: { file: '' } as never,
        bodySerializer: () => fileForm(file, 'slide.jpg'),
      }),
      t('imageSaved'),
    );
    if (result.ok) {
      replace(result.data);
    }
  };
  const remove = async (slide: AdminSlide) => {
    const yes = await confirm({
      title: t('deleteTitle'),
      text: t('deleteText', { title: pick(slide.title, locale) }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!yes) {
      return;
    }
    const result = await call(
      api.DELETE('/api/v1/admin/home-slides/{id}', { params: { path: { id: slide.id } } }),
      t('deleted'),
    );
    if (result.ok) {
      reload();
    }
  };
  const edited = editing && editing !== 'new' ? slides.find((slide) => slide.id === editing) : null;
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
      {/* minmax(0, 1fr): the slider inside the preview must not widen its column. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        <div className="min-w-0">
          {slides.length === 0 ? (
            <p className="rounded-xl bg-muted p-6 text-center text-sm">{t('empty')}</p>
          ) : (
            <SortableList
              items={slides}
              onReorder={(next) => void reorder(next)}
              handleLabel={(slide) => t('move', { title: pick(slide.title, locale) })}
              render={(slide) => (
                <div className="flex flex-wrap items-center gap-3" data-testid="slide">
                  {slide.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={slide.imageUrl}
                      alt=""
                      className="h-14 w-24 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
                      {t('noImage')}
                    </span>
                  )}
                  <div className="min-w-32 flex-1 text-sm">
                    <p className="font-semibold">{pick(slide.title, locale)}</p>
                    <Badge tone={slide.isActive ? 'success' : 'neutral'}>
                      {slide.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <ImageCropper
                      aspect={SLIDE_ASPECT}
                      label={t('image')}
                      onCropped={(file) => void upload(slide, file)}
                    />
                    <button
                      type="button"
                      className={cta.outline}
                      onClick={() => void toggle(slide)}
                    >
                      {slide.isActive ? t('deactivate') : t('activate')}
                    </button>
                    <button
                      type="button"
                      className={smallButton}
                      aria-label={`${t('edit')}: ${pick(slide.title, locale)}`}
                      onClick={() => {
                        setEditing(slide.id);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${smallButton} text-destructive`}
                      aria-label={`${t('delete')}: ${pick(slide.title, locale)}`}
                      onClick={() => void remove(slide)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            />
          )}
        </div>
        <section className={`${card} min-w-0 self-start p-4`} aria-labelledby="preview-title">
          <h2 id="preview-title" className="mb-3 font-semibold">
            {t('preview')}
          </h2>
          <LivePreview slides={slides} />
          <p className="mt-2 text-sm text-muted-foreground">{t('previewHint')}</p>
        </section>
      </div>
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
          <SlideEditor
            key={editing}
            slide={edited ?? null}
            destinations={destinations}
            onClose={() => {
              setEditing(null);
            }}
            onSaved={(slide) => {
              replace(slide);
              setEditing(null);
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}
