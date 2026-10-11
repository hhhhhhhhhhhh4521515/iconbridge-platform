'use client';

import { ImagePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Modal } from '@/components/ui/modal';
import { cta } from '@/lib/ui';

const MAX_WIDTH = 1600;

/** Draws the chosen part of the picture on a canvas and returns it as a JPEG file. */
async function crop(source: string, area: Area): Promise<Blob | null> {
  const image = new window.Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(1, MAX_WIDTH / area.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  canvas
    .getContext('2d')
    ?.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.9);
  });
}

/**
 * Choose a picture, frame it to the shape the site uses (drag and zoom), and get the
 * cropped file. The API checks and re-encodes whatever it receives.
 */
export function ImageCropper({
  aspect,
  label,
  onCropped,
  disabled,
}: {
  /** Width divided by height of the frame. */
  aspect: number;
  label: string;
  onCropped: (file: Blob) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('admin.image');
  const common = useTranslations('common');
  const id = useId();
  const [source, setSource] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [problem, setProblem] = useState(false);
  const onComplete = useCallback((_: Area, pixels: Area) => {
    setArea(pixels);
  }, []);
  useEffect(
    () => () => {
      if (source) {
        URL.revokeObjectURL(source);
      }
    },
    [source],
  );
  const close = () => {
    setSource(null);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };
  const use = async () => {
    if (!source || !area) {
      return;
    }
    const file = await crop(source, area).catch(() => null);
    if (!file) {
      setProblem(true);
      return;
    }
    onCropped(file);
    close();
  };
  return (
    <>
      <label
        htmlFor={id}
        className={`${cta.outline} cursor-pointer ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <ImagePlus className="size-4" aria-hidden />
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            setProblem(false);
            setSource(URL.createObjectURL(file));
          }
        }}
      />
      <Modal
        open={source !== null}
        onClose={close}
        title={t('cropTitle')}
        closeLabel={common('close')}
        wide
      >
        {source ? (
          <div data-testid="image-cropper">
            <div className="relative h-[50vh] overflow-hidden rounded-lg bg-black">
              <Cropper
                image={source}
                crop={position}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setPosition}
                onZoomChange={setZoom}
                onCropComplete={onComplete}
              />
            </div>
            <label className="mt-4 flex items-center gap-3 text-sm font-medium">
              {t('zoom')}
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(event) => {
                  setZoom(Number(event.target.value));
                }}
                className="flex-1 accent-primary"
              />
            </label>
            {problem ? (
              <p role="alert" className="mt-2 text-sm font-medium text-destructive">
                {t('failed')}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button type="button" className={cta.outline} onClick={close}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className={cta.primary}
                disabled={!area}
                onClick={() => void use()}
              >
                {t('use')}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/** A FormData holding one file under "file", as the upload endpoints of the API expect. */
export function fileForm(file: Blob, name: string): FormData {
  const form = new FormData();
  form.append('file', file, name);
  return form;
}
