'use client';

import { Menu, Moon, Sun, X } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { LOCALE_NAMES, LOCALES } from '@/i18n/routing';

const iconButton =
  'inline-flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted';

/** Links to the same page in the other languages. Plain links: they work without JavaScript and are crawlable. */
export function LocaleSwitcher({ label }: { label: string }) {
  const pathname = usePathname();
  const current = useLocale();
  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-1 text-sm">
        {LOCALES.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? 'true' : undefined}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=true]:bg-secondary aria-[current=true]:text-secondary-foreground"
              title={LOCALE_NAMES[locale]}
            >
              <span aria-hidden>{locale.toUpperCase()}</span>
              <span className="sr-only">{LOCALE_NAMES[locale]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ThemeToggle({ lightLabel, darkLabel }: { lightLabel: string; darkLabel: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // False on the server and during hydration, true afterwards: the stored theme is only known in the browser.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <button
      type="button"
      className={iconButton}
      onClick={() => {
        setTheme(dark ? 'light' : 'dark');
      }}
      aria-label={dark ? lightLabel : darkLabel}
      title={dark ? lightLabel : darkLabel}
    >
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}

/** The navigation on small screens: a button that opens a panel under the header. */
export function MobileMenu({
  openLabel,
  closeLabel,
  children,
}: {
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="xl:hidden">
      <button
        type="button"
        className={iconButton}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? closeLabel : openLabel}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
      </button>
      <div
        id="mobile-menu"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-border bg-background shadow-lg"
      >
        {/* Following a link closes the panel. */}
        <div
          className="container-page py-4"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
