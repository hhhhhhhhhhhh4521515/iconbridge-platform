'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A dialog on top of the page. Built on the browser's <dialog>: focus stays inside,
 * Escape closes it and the page behind cannot be used meanwhile.
 */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  children,
  wide,
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  wide?: boolean;
  /** A panel along the edge of the screen instead of a centred box. */
  side?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      // A dialog opened from inside this one tells React it closed, and React passes
      // that on to its ancestors: only the closing of this very dialog counts.
      onClose={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      className={`border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60 ${
        side
          ? 'ms-auto me-0 my-0 h-dvh max-h-dvh w-full max-w-3xl border-s'
          : `m-auto w-[calc(100%-2rem)] rounded-2xl border ${wide ? 'max-w-4xl' : 'max-w-lg'}`
      }`}
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
