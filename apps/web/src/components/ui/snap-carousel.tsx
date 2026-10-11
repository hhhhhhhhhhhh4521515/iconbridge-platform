'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

/**
 * A row that scrolls sideways with snap points: swipe on touch screens, arrow
 * buttons and keyboard scrolling elsewhere. No autoplay, so nothing moves on its own.
 */
export function SnapCarousel({
  children,
  label,
  previousLabel,
  nextLabel,
}: {
  children: ReactNode;
  label: string;
  previousLabel: string;
  nextLabel: string;
}) {
  const row = useRef<HTMLUListElement>(null);
  const scroll = (direction: 1 | -1) => {
    const node = row.current;
    if (!node) {
      return;
    }
    // In right-to-left pages "next" moves towards the left.
    const rtl = getComputedStyle(node).direction === 'rtl' ? -1 : 1;
    node.scrollBy({ left: direction * rtl * node.clientWidth * 0.85, behavior: 'smooth' });
  };
  const button =
    'inline-flex size-11 items-center justify-center rounded-full border border-input bg-background text-foreground hover:bg-muted';
  return (
    <div>
      <ul ref={row} className="snap-row" aria-label={label} tabIndex={0}>
        {children}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className={button}
          onClick={() => scroll(-1)}
          aria-label={previousLabel}
        >
          <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden />
        </button>
        <button type="button" className={button} onClick={() => scroll(1)} aria-label={nextLabel}>
          <ChevronRight className="size-5 rtl:rotate-180" aria-hidden />
        </button>
      </div>
    </div>
  );
}
