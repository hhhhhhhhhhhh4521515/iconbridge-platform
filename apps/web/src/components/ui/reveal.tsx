'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Fades and lifts its content the first time it scrolls into view.
 *
 * The server renders the content fully visible: it is hidden only once the
 * script runs and only if it is still below the fold, so nothing depends on
 * JavaScript to be readable. Reduced motion: no effect at all (see globals.css).
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = element.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    if (node.getBoundingClientRect().top < window.innerHeight) {
      return; // already on screen: leave it as it is
    }
    node.dataset.reveal = 'pending';
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.dataset.reveal = 'shown';
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -60px 0px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={element}
      className={`reveal ${className}`}
      style={{ '--reveal-delay': `${delay}s` } as CSSProperties}
    >
      {children}
    </div>
  );
}
