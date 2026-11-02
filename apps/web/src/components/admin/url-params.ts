'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Changes some parameters of the page address, keeping the others, without a navigation
 * (`history.replaceState`, which Next.js follows in `useSearchParams`).
 *
 * The parameters wanted are kept here: two quick changes (a click that opens an
 * application, then the search box reporting its text a moment later) never undo each
 * other. A navigation this hook did not make (back, forward, a link) puts them back in
 * line with the address, and a change that comes after the page was left is dropped, so
 * it cannot pull the browser back to the list.
 */
export function useUrlParams(): (patch: Record<string, string | null>) => void {
  const current = useSearchParams().toString();
  const wanted = useRef<URLSearchParams | null>(null);
  const written = useRef(new Set<string>());
  const page = useRef<string | null>(null);

  useEffect(() => {
    page.current = window.location.pathname;
  }, []);

  useEffect(() => {
    if (written.current.has(current)) {
      written.current.delete(current);
    } else if (written.current.size === 0) {
      wanted.current = new URLSearchParams(current);
    }
  }, [current]);

  return useCallback((patch) => {
    if (page.current !== null && window.location.pathname !== page.current) {
      return;
    }
    const params = wanted.current ?? new URLSearchParams(window.location.search);
    for (const [name, value] of Object.entries(patch)) {
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
    }
    wanted.current = params;
    const text = params.toString();
    written.current.add(text);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${text ? `?${text}` : ''}`,
    );
  }, []);
}
