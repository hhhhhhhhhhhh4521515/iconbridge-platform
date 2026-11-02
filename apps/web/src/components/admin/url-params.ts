'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Changes some parameters of the page address, keeping the others. The address is applied
 * by Next.js a little later, so two quick changes (a click that opens an application, then
 * the search box reporting its text) would each start from the old address and undo the
 * other. The parameters wanted are kept here instead; a navigation that this hook did not
 * make (back, forward, a link) puts them back in line with the address.
 */
export function useUrlParams(): (patch: Record<string, string | null>) => void {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams().toString();
  const wanted = useRef<URLSearchParams | null>(null);
  const written = useRef(new Set<string>());

  useEffect(() => {
    if (written.current.has(current)) {
      written.current.delete(current);
    } else if (written.current.size === 0) {
      wanted.current = new URLSearchParams(current);
    }
  }, [current]);

  return useCallback(
    (patch) => {
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
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [pathname, router],
  );
}
