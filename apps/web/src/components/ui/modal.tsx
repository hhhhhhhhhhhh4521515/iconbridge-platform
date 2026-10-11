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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  wide?: boolean;
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
      onClose={onClose}
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
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
