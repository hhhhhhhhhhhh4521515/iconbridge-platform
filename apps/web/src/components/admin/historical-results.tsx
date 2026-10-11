'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { api, type AdminDestination, type HistoricalFigure } from '@/lib/client-api';
import { pick } from '@/lib/format';
import { card, cta } from '@/lib/ui';
import { input, smallButton, useCall } from './ui';

const YEARLY = ['VISAS_APPROVED', 'CANDIDATES_DEPLOYED', 'CANDIDATES_REGISTERED'] as const;
const GLOBAL = ['PARTNER_COMPANIES', 'COUNTRIES_SERVED'] as const;
type Metric = (typeof YEARLY)[number] | (typeof GLOBAL)[number];
const FIRST_YEAR = 1990;

/** Key of one cell of the form: a metric, with its year and destination when it has them. */
const cell = (metric: Metric, year: number | null, destinationId: string | null) =>
  `${metric}|${String(year)}|${String(destinationId)}`;

function Editor({
  figures,
  destinations,
  onSaved,
}: {
  figures: HistoricalFigure[];
  destinations: AdminDestination[];
  onSaved: () => void;
}) {
  const t = useTranslations('admin.history');
  const locale = useLocale();
  const call = useCall();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1);
  // What was typed and not saved yet, by cell.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const stored = new Map(
    figures.map((figure) => [cell(figure.metric, figure.year, figure.destinationId), figure]),
  );
  const value = (key: string) => draft[key] ?? String(stored.get(key)?.value ?? '');
  const years = [...new Set(figures.flatMap((figure) => figure.year ?? []))].sort((a, b) => b - a);
  // Destinations offered on the site, and those that already hold a figure.
  const rows = destinations.filter(
    (destination) =>
      destination.isActive || figures.some((figure) => figure.destinationId === destination.id),
  );
  const changed = Object.entries(draft).filter(
    ([key, text]) => text.trim() !== '' && Number(text) !== (stored.get(key)?.value ?? -1),
  );
  const valid = changed.every(([, text]) => /^\d{1,8}$/.test(text.trim()));

  const save = async () => {
    setBusy(true);
    let saved = 0;
    for (const [key, text] of changed) {
      const [metric, yearText, destinationText] = key.split('|');
      const destinationId = destinationText === 'null' ? null : (destinationText ?? null);
      const result = await call(
        api.PUT('/api/v1/admin/historical-figures', {
          body: {
            metric: metric as Metric,
            year: yearText === 'null' ? null : Number(yearText),
            destinationId,
            value: Number(text),
            note: notes[`${String(yearText)}|${String(destinationText)}`]?.trim() || null,
          },
        }),
      );
      if (!result.ok) {
        break;
      }
      saved += 1;
    }
    setBusy(false);
    if (saved === changed.length) {
      toast.success(t('saved', { count: saved }));
      setDraft({});
      setNotes({});
    }
    onSaved();
  };

  const number = (key: string, label: string, testId: string) => (
    <input
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      className={`${input} min-w-24`}
      aria-label={label}
      data-testid={testId}
      value={value(key)}
      onChange={(event) => {
        setDraft({ ...draft, [key]: event.target.value });
      }}
    />
  );

  return (
    <form
      className={`${card} p-5`}
      data-testid="historical-results"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="text-lg font-semibold">{t('title')}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t('intro')}</p>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('year')}</span>
          <input
            type="number"
            min={FIRST_YEAR}
            max={thisYear}
            className={`${input} w-28`}
            data-testid="history-year"
            value={year}
            onChange={(event) => {
              setYear(Number(event.target.value));
            }}
          />
        </label>
        {years.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-muted-foreground">{t('yearsWithFigures')}</span>
            {years.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`${smallButton} aria-pressed:bg-secondary aria-pressed:text-secondary-foreground`}
                aria-pressed={entry === year}
                onClick={() => {
                  setYear(entry);
                }}
              >
                {entry}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={t('tableLabel', { year })}>
          <thead>
            <tr className="text-start">
              <th scope="col" className="py-2 pe-3 text-start font-semibold">
                {t('destination')}
              </th>
              {YEARLY.map((metric) => (
                <th key={metric} scope="col" className="px-2 py-2 text-start font-semibold">
                  {t(`metrics.${metric}`)}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-start font-semibold">
                {t('note')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((destination) => {
              const name = pick(destination.name, locale);
              const noteKey = `${String(year)}|${destination.id}`;
              const storedNote =
                YEARLY.map((metric) => stored.get(cell(metric, year, destination.id))?.note).find(
                  Boolean,
                ) ?? '';
              return (
                <tr key={destination.id}>
                  <th scope="row" className="py-2 pe-3 text-start font-medium whitespace-nowrap">
                    {name}
                  </th>
                  {YEARLY.map((metric) => (
                    <td key={metric} className="px-2 py-2">
                      {number(
                        cell(metric, year, destination.id),
                        `${t(`metrics.${metric}`)}: ${name}, ${String(year)}`,
                        `history-${destination.code}-${metric}`,
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <input
                      className={`${input} min-w-40`}
                      aria-label={`${t('note')}: ${name}, ${String(year)}`}
                      placeholder={t('notePlaceholder')}
                      value={notes[noteKey] ?? storedNote}
                      onChange={(event) => {
                        setNotes({ ...notes, [noteKey]: event.target.value });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 font-semibold">{t('globalTitle')}</h3>
      <p className="mb-3 text-sm text-muted-foreground">{t('globalIntro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {GLOBAL.map((metric) => (
          <label key={metric} className="block">
            <span className="mb-1 block text-sm font-medium">{t(`metrics.${metric}`)}</span>
            {number(cell(metric, null, null), t(`metrics.${metric}`), `history-${metric}`)}
            <span className="mt-1 block text-sm text-muted-foreground">{t(`help.${metric}`)}</span>
          </label>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('audited')}</p>
        <button
          type="submit"
          className={cta.primary}
          disabled={busy || changed.length === 0 || !valid}
        >
          {t('save')}
        </button>
      </div>
    </form>
  );
}

/**
 * Figures from before the platform, entered by the super admin: per year and
 * destination, plus two global figures. They are stored apart from the applications
 * and only added to them when a total is shown.
 */
export function HistoricalResults() {
  const fetcher = useCallback(async () => {
    const [figures, destinations] = await Promise.all([
      api.GET('/api/v1/admin/historical-figures'),
      api.GET('/api/v1/admin/destinations'),
    ]);
    return figures.data && destinations.data
      ? { figures: figures.data, destinations: destinations.data }
      : undefined;
  }, []);
  const { data, loading, failed, reload } = useLoaded(fetcher);
  if (loading && !data) {
    return <Loading lines={4} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  return <Editor figures={data.figures} destinations={data.destinations} onSaved={reload} />;
}
