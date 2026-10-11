'use client';

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 1400;

/**
 * Counts up to `value` when it becomes visible. The server renders the final
 * number (for search engines and without JavaScript); with reduced motion it stays so.
 */
export function Counter({ value, locale }: { value: number; locale: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const node = element.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    let frame = 0;
    setShown(0);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / DURATION_MS);
          setShown(Math.round(value * (1 - (1 - progress) ** 3)));
          if (progress < 1) {
            frame = requestAnimationFrame(tick);
          }
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <span ref={element} className="tabular-nums">
      {new Intl.NumberFormat(locale).format(shown)}
    </span>
  );
}
