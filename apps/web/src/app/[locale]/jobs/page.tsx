import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JobCard } from '@/components/jobs/job-card';
import { Link } from '@/i18n/navigation';
import { api, type JobQuery } from '@/lib/api';
import { languageName, pick } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import { card, cta, field } from '@/lib/ui';

const PAGE_SIZE = 12;
const SORTS = ['relevance', 'newest', 'deadline', 'salary'] as const;
const LANGUAGES = ['en', 'fr', 'ar', 'it', 'pl', 'de'] as const;
const CURRENCIES = ['EUR', 'PLN', 'USD'] as const;

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/** The filters live in the URL, so a search can be shared or bookmarked. Invalid values are ignored. */
function readQuery(search: Search): JobQuery {
  const q = one(search.q);
  const sort = SORTS.find((value) => value === one(search.sort));
  const salaryMin = Number(one(search.salaryMin));
  const page = Number(one(search.page));
  return {
    ...(q && q.length >= 2 ? { q: q.slice(0, 100) } : {}),
    ...(one(search.destination) ? { destination: one(search.destination) } : {}),
    ...(one(search.category) ? { category: one(search.category) } : {}),
    ...(one(search.language) ? { language: one(search.language) } : {}),
    ...(Number.isFinite(salaryMin) && salaryMin > 0 ? { salaryMin } : {}),
    ...(one(search.currency) ? { currency: one(search.currency) } : {}),
    ...(one(search.featured) === 'true' ? { featured: 'true' as const } : {}),
    ...(sort && (sort !== 'relevance' || (q && q.length >= 2)) ? { sort } : {}),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
  };
}

function href(query: JobQuery, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...query,
    page: page > 1 ? page : undefined,
    pageSize: undefined,
  })) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `/jobs?${text}` : '/jobs';
}

export async function generateMetadata({ params }: PageProps<'/[locale]/jobs'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({
    locale,
    path: '/jobs',
    title: t('jobsTitle'),
    description: t('jobsDescription'),
    siteName: t('siteName'),
  });
}

export default async function JobsPage({ params, searchParams }: PageProps<'/[locale]/jobs'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = readQuery(await searchParams);
  const [t, result, destinations, categories] = await Promise.all([
    getTranslations('jobs'),
    api.jobs(query),
    api.destinations(),
    api.categories(),
  ]);
  const page = query.page ?? 1;
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const label = 'mb-1 block text-sm font-medium';

  return (
    <div className="container-page py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <form
          method="get"
          action={`/${locale}/jobs`}
          aria-labelledby="filters-title"
          className={`${card} h-fit space-y-4 p-5`}
        >
          <h2 id="filters-title" className="text-lg font-semibold">
            {t('filters.title')}
          </h2>
          <div>
            <label htmlFor="f-q" className={label}>
              {t('filters.keyword')}
            </label>
            <input
              id="f-q"
              name="q"
              type="search"
              defaultValue={query.q ?? ''}
              placeholder={t('filters.keywordPlaceholder')}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="f-destination" className={label}>
              {t('filters.destination')}
            </label>
            <select
              id="f-destination"
              name="destination"
              defaultValue={query.destination ?? ''}
              className={field}
            >
              <option value="">{t('filters.any')}</option>
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.code}>
                  {pick(destination.name, locale)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-category" className={label}>
              {t('filters.category')}
            </label>
            <select
              id="f-category"
              name="category"
              defaultValue={query.category ?? ''}
              className={field}
            >
              <option value="">{t('filters.any')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.slug}>
                  {pick(category.name, locale)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-language" className={label}>
              {t('filters.language')}
            </label>
            <select
              id="f-language"
              name="language"
              defaultValue={query.language ?? ''}
              className={field}
            >
              <option value="">{t('filters.any')}</option>
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {languageName(code, locale)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div>
              <label htmlFor="f-salary" className={label}>
                {t('filters.salaryMin')}
              </label>
              <input
                id="f-salary"
                name="salaryMin"
                type="number"
                min={0}
                step={50}
                inputMode="numeric"
                defaultValue={query.salaryMin ?? ''}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="f-currency" className={label}>
                {t('filters.currency')}
              </label>
              <select
                id="f-currency"
                name="currency"
                defaultValue={query.currency ?? ''}
                className={field}
              >
                <option value="">{t('filters.any')}</option>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="f-sort" className={label}>
              {t('filters.sort')}
            </label>
            <select id="f-sort" name="sort" defaultValue={query.sort ?? ''} className={field}>
              <option value="">
                {query.q ? t('filters.sortRelevance') : t('filters.sortNewest')}
              </option>
              <option value="newest">{t('filters.sortNewest')}</option>
              <option value="deadline">{t('filters.sortDeadline')}</option>
              <option value="salary">{t('filters.sortSalary')}</option>
            </select>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="featured"
              value="true"
              defaultChecked={query.featured === 'true'}
              className="size-5 accent-[var(--brand-blue)]"
            />
            {t('filters.featured')}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={cta.primary}>
              {t('filters.apply')}
            </button>
            <Link href="/jobs" className={cta.ghost}>
              {t('filters.reset')}
            </Link>
          </div>
        </form>

        <section aria-labelledby="results-title">
          <h2
            id="results-title"
            className="mb-4 text-base font-semibold"
            aria-live="polite"
            data-testid="job-count"
          >
            {t('results', { count: result.total })}
          </h2>
          {result.items.length === 0 ? (
            <div
              className={`${card} flex flex-col items-center gap-3 p-10 text-center`}
              data-testid="jobs-empty"
            >
              <SearchX className="size-10 text-muted-foreground" aria-hidden />
              <p className="text-lg font-semibold">{t('empty.title')}</p>
              <p className="text-muted-foreground">{t('empty.text')}</p>
              <Link href="/jobs" className={cta.outline}>
                {t('empty.reset')}
              </Link>
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" data-testid="job-list">
              {result.items.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
          )}

          {pages > 1 ? (
            <nav
              aria-label={t('pagination.label')}
              className="mt-8 flex items-center justify-between gap-4"
            >
              {page > 1 ? (
                <Link href={href(query, page - 1)} className={cta.outline} rel="prev">
                  {t('pagination.previous')}
                </Link>
              ) : (
                <span />
              )}
              <p className="text-sm text-muted-foreground">
                {t('pagination.page', { page, total: pages })}
              </p>
              {page < pages ? (
                <Link href={href(query, page + 1)} className={cta.outline} rel="next">
                  {t('pagination.next')}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
