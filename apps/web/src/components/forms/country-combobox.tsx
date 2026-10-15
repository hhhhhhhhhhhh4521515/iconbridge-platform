'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { flag } from '@/lib/countries';
import {
  exactCountry,
  filterCountries,
  isPreferred,
  type CountryChoice,
} from '@/lib/country-search';
import { control } from './fields';

/**
 * A country picked by typing (WAI-ARIA combobox with a list box). The text is matched
 * against the name in the page language (accents ignored), the ISO code and the
 * choice's keywords; the flag is drawn beside the text, never typed or searched.
 *
 * Keys: ↓/↑ open the list and move, Home/End jump, Enter chooses, Esc closes, Tab
 * chooses the highlighted country when something was typed. On a phone a tap opens
 * the list and another tap chooses. Logical CSS: the list mirrors on Arabic pages.
 */
export function CountryCombobox({
  id,
  name,
  value,
  onChange,
  onBlur,
  choices,
  display = (choice) => choice.name,
  optionDetail,
  inputClassName,
  listClassName,
  className,
  testId,
  ...aria
}: {
  id?: string;
  name: string;
  value: string | null;
  onChange: (code: string | null) => void;
  onBlur?: () => void;
  /** In the order to offer them (preferred countries first). Empty until the page is hydrated. */
  choices: readonly CountryChoice[];
  /** Text of the field once a country is chosen. */
  display?: (choice: CountryChoice) => string;
  /** Shown after the name in the list, e.g. "+216". */
  optionDetail?: (choice: CountryChoice) => ReactNode;
  inputClassName?: string;
  listClassName?: string;
  className?: string;
  testId?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}) {
  const t = useTranslations('forms');
  const generated = useId();
  const inputId = id ?? generated;
  const listId = `${inputId}-list`;
  const optionId = (code: string) => `${inputId}-option-${code}`;

  // `query` is what the person typed; null while the field shows the chosen country.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = useMemo(() => choices.find((choice) => choice.code === value), [choices, value]);
  const matches = useMemo(() => filterCountries(choices, query ?? ''), [choices, query]);
  const text = query ?? (selected ? display(selected) : (value ?? ''));
  const highlighted = open ? matches[active] : undefined;

  useEffect(() => {
    if (highlighted) {
      document.getElementById(optionId(highlighted.code))?.scrollIntoView({ block: 'nearest' });
    }
    // optionId only depends on inputId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted]);

  const openList = () => {
    if (open) return;
    const index = query === null && value ? matches.findIndex((c) => c.code === value) : 0;
    setActive(Math.max(index, 0));
    setOpen(true);
  };
  const choose = (choice: CountryChoice) => {
    onChange(choice.code);
    setQuery(null);
    setOpen(false);
  };
  /** Leaving the field: a full name or code typed (or filled in by the browser) counts. */
  const commit = () => {
    if (query !== null) {
      if (query.trim() === '') {
        onChange(null);
      } else {
        const exact =
          exactCountry(choices, query) ?? (matches.length === 1 ? matches[0] : undefined);
        if (exact) onChange(exact.code);
      }
    }
    setQuery(null);
    setOpen(false);
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      {selected && query === null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-lg leading-none"
        >
          {flag(selected.code)}
        </span>
      ) : null}
      <input
        {...aria}
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={highlighted ? optionId(highlighted.code) : undefined}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t('countryPlaceholder')}
        className={`${control} pe-10 ${selected && query === null ? 'ps-10' : ''} ${inputClassName ?? ''}`}
        value={text}
        onClick={openList}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          const last = matches.length - 1;
          switch (event.key) {
            case 'ArrowDown':
              event.preventDefault();
              if (!open) openList();
              else setActive((index) => Math.min(index + 1, last));
              break;
            case 'ArrowUp':
              event.preventDefault();
              if (!open) openList();
              else setActive((index) => Math.max(index - 1, 0));
              break;
            case 'Home':
            case 'End':
              if (open) {
                event.preventDefault();
                setActive(event.key === 'Home' ? 0 : Math.max(last, 0));
              }
              break;
            case 'Enter':
              if (open) {
                // Never submits the form while the list is open.
                event.preventDefault();
                if (highlighted) choose(highlighted);
              }
              break;
            case 'Escape':
              if (open || query !== null) {
                event.preventDefault();
                setQuery(null);
                setOpen(false);
              }
              break;
            case 'Tab':
              if (open && query !== null && highlighted) choose(highlighted);
              break;
          }
        }}
        onBlur={() => {
          commit();
          onBlur?.();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('countryList')}
        aria-controls={listId}
        aria-expanded={open}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground"
        // Keeps the focus in the field, which owns the list.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          document.getElementById(inputId)?.focus();
          if (open) setOpen(false);
          else openList();
        }}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="currentColor">
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label={aria['aria-label'] ?? t('countryList')}
        hidden={!open}
        className={`absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-md border border-border bg-background py-1 shadow-lg ${listClassName ?? ''}`}
      >
        {matches.length === 0 ? (
          <li
            role="option"
            aria-selected={false}
            aria-disabled
            className="px-3 py-2 text-sm text-muted-foreground"
          >
            {t('countryNone')}
          </li>
        ) : (
          matches.map((choice, index) => {
            // A line between the preferred countries and the others, when nothing is typed.
            const divider =
              query === null &&
              index > 0 &&
              !isPreferred(choice.code) &&
              isPreferred(matches[index - 1]?.code ?? '');
            return (
              <li
                key={choice.code}
                id={optionId(choice.code)}
                role="option"
                aria-selected={choice.code === value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm ${
                  index === active ? 'bg-muted' : ''
                } ${choice.code === value ? 'font-semibold' : ''} ${divider ? 'border-t border-border' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseMove={() => {
                  if (index !== active) setActive(index);
                }}
                onClick={() => {
                  choose(choice);
                }}
              >
                <span aria-hidden className="text-lg leading-none">
                  {flag(choice.code)}
                </span>
                <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                {optionDetail ? (
                  <span className="shrink-0 text-muted-foreground" dir="ltr">
                    {optionDetail(choice)}
                  </span>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
      <input type="hidden" name={name} value={value ?? ''} data-testid={testId} />
    </div>
  );
}
