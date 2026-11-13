'use client';

import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { field } from '@/lib/ui';

/** Dates are YYYY-MM-DD, computed in UTC so no time zone moves a day. */
const parse = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
};
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
/** The same day in another month, kept inside that month (31 January + 1 month = 28/29 February). */
const addMonths = (date: Date, months: number) => {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(date.getUTCDate(), last)),
  );
};
const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

/** Six weeks from the Monday on or before the 1st of the month. */
function weeksOf(month: Date): Date[][] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const start = addDays(first, -((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  );
}

/**
 * A date chosen on a calendar, in the language of the page (a native date input follows the
 * browser's language instead). The button shows the date; the calendar opens below it, with
 * the month and the year as lists, and works with the keyboard: arrows move by a day or a
 * week, Page Up and Page Down by a month, Home and End to the week's ends, Escape closes.
 * The value is YYYY-MM-DD, or an empty text.
 */
export function DatePicker({
  label,
  value,
  onChange,
  lang,
  hint,
  error,
  fromYear,
  toYear,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  lang: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  fromYear: number;
  toYear: number;
}) {
  const t = useTranslations('partner.datePicker');
  const id = useId();
  const selected = parse(value);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<Date>(() => selected ?? todayUtc());
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  /** Moves the focus to the focused day once the calendar has rendered it. */
  const focusDay = useRef(false);

  const formats = useMemo(
    () => ({
      shown: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }),
      full: new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'UTC' }),
      month: new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }),
      weekday: new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }),
      weekdayLong: new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }),
    }),
    [lang],
  );
  const low = Math.min(fromYear, toYear);
  const high = Math.max(fromYear, toYear);
  const years = Array.from({ length: high - low + 1 }, (_, index) => low + index);
  const clamp = (date: Date) =>
    date.getUTCFullYear() < low
      ? new Date(Date.UTC(low, 0, 1))
      : date.getUTCFullYear() > high
        ? new Date(Date.UTC(high, 11, 31))
        : date;

  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open && focusDay.current) {
      grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
      focusDay.current = false;
    }
  }, [open, focused]);

  const show = () => {
    setFocused(clamp(selected ?? todayUtc()));
    setOpen(true);
    focusDay.current = true;
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      trigger.current?.focus();
    }
  };
  const choose = (date: Date) => {
    onChange(iso(date));
    close(true);
  };
  const move = (date: Date) => {
    setFocused(clamp(date));
    focusDay.current = true;
  };
  const onGridKey = (event: KeyboardEvent) => {
    const keys: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
      Home: () => addDays(focused, -((focused.getUTCDay() + 6) % 7)),
      End: () => addDays(focused, 6 - ((focused.getUTCDay() + 6) % 7)),
    };
    const next = keys[event.key];
    if (next) {
      event.preventDefault();
      move(next());
    }
  };

  const month = focused.getUTCMonth();
  const weeks = weeksOf(focused);
  const today = iso(todayUtc());
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <span id={`${id}-label`} className="mb-1 block text-sm font-medium">
        {label}
      </span>
      <div className="flex gap-2">
        <button
          ref={trigger}
          type="button"
          id={id}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-describedby={describedBy}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="date-picker"
          className={`${field} flex items-center justify-between gap-2 text-start ${error ? 'border-destructive' : ''}`}
          onClick={() => {
            if (open) {
              close(false);
            } else {
              show();
            }
          }}
        >
          <span id={`${id}-value`} className={selected ? '' : 'text-muted-foreground'}>
            {selected ? formats.shown.format(selected) : t('choose')}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {selected ? (
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('clear', { label })}
            onClick={() => {
              onChange('');
              trigger.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute start-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
              aria-label={t('previousMonth')}
              onClick={() => {
                setFocused(clamp(addMonths(focused, -1)));
              }}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            </button>
            <select
              aria-label={t('month')}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
              value={month}
              onChange={(event) => {
                const next = new Date(
                  Date.UTC(focused.getUTCFullYear(), Number(event.target.value), 1),
                );
                setFocused(addMonths(next, 0));
              }}
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index} value={index}>
                  {formats.month.format(new Date(Date.UTC(2001, index, 1)))}
                </option>
              ))}
            </select>
            <select
              aria-label={t('year')}
              className="min-h-11 rounded-lg border border-input bg-background px-2 text-sm"
              value={focused.getUTCFullYear()}
              onChange={(event) => {
                setFocused(new Date(Date.UTC(Number(event.target.value), month, 1)));
              }}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
              aria-label={t('nextMonth')}
              onClick={() => {
                setFocused(clamp(addMonths(focused, 1)));
              }}
            >
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
            </button>
          </div>
          <table
            ref={grid}
            role="grid"
            aria-label={`${formats.month.format(focused)} ${String(focused.getUTCFullYear())}`}
            className="w-full table-fixed border-collapse text-center text-sm"
            onKeyDown={onGridKey}
          >
            <thead>
              <tr>
                {(weeks[0] ?? []).map((day) => (
                  <th
                    key={iso(day)}
                    scope="col"
                    abbr={formats.weekdayLong.format(day)}
                    className="pb-1 text-xs font-medium text-muted-foreground"
                  >
                    {formats.weekday.format(day)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={iso(week[0] ?? focused)}>
                  {week.map((day) => {
                    const key = iso(day);
                    const isSelected = value === key;
                    const outside = day.getUTCMonth() !== month;
                    const isFocused = key === iso(focused);
                    return (
                      <td key={key} className="p-0.5">
                        <button
                          type="button"
                          tabIndex={isFocused ? 0 : -1}
                          aria-label={formats.full.format(day)}
                          aria-pressed={isSelected}
                          aria-current={key === today ? 'date' : undefined}
                          className={`inline-flex size-9 items-center justify-center rounded-lg tabular-nums transition-colors ${
                            isSelected
                              ? 'bg-primary font-semibold text-primary-foreground'
                              : outside
                                ? 'text-muted-foreground hover:bg-muted'
                                : 'hover:bg-muted'
                          } ${key === today && !isSelected ? 'ring-1 ring-brand-gold' : ''}`}
                          onClick={() => {
                            choose(day);
                          }}
                        >
                          {day.getUTCDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
