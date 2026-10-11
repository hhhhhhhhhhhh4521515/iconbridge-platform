'use client';

import { APPLICATION_PIPELINE } from '@iconbridge/shared/enums';
import { Briefcase, FileCheck2, Inbox, Plane, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLoaded } from '@/components/account/account-context';
import { LoadFailed, Loading } from '@/components/forms/fields';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/client-api';
import { card } from '@/lib/ui';
import { ApplicationBadge } from './status';
import { PageHeader, shortDate } from './ui';

const GOLD = '#c48f2f';
const BLUE = '#3b5bdb';
const axis = { fill: 'currentColor', fontSize: 12 };

function Kpi({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  testId: string;
}) {
  const locale = useLocale();
  return (
    <div className={`${card} flex items-center gap-4 p-5`}>
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-gold-soft text-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold" data-testid={testId}>
          {new Intl.NumberFormat(locale).format(value)}
        </p>
      </div>
    </div>
  );
}

/** A chart with its title; the same figures follow as a list for screen readers. */
function Chart({
  title,
  data,
  children,
  tall,
}: {
  title: string;
  data: { name: string; count: number }[];
  children: ReactNode;
  tall?: boolean;
}) {
  return (
    <figure className={`${card} p-5`}>
      <figcaption className="mb-3 font-semibold">{title}</figcaption>
      <div className={`${tall ? 'h-96' : 'h-64'} text-muted-foreground`} aria-hidden>
        {children}
      </div>
      <ul className="sr-only">
        {data.map((entry) => (
          <li key={entry.name}>
            {entry.name}: {entry.count}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function Dashboard() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const fetcher = useCallback(async () => {
    const [stats, latest] = await Promise.all([
      api.GET('/api/v1/admin/stats'),
      api.GET('/api/v1/admin/applications', { params: { query: { pageSize: 8, sort: 'newest' } } }),
    ]);
    return stats.data && latest.data ? { stats: stats.data, latest: latest.data.items } : undefined;
  }, []);
  const { data, loading, failed, reload } = useLoaded(fetcher);

  if (loading && !data) {
    return <Loading lines={6} />;
  }
  if (failed || !data) {
    return <LoadFailed onRetry={reload} />;
  }
  const { stats, latest } = data;
  const month = (value: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${value}-01T00:00:00Z`),
    );
  const byMonth = stats.applicationsByMonth.map((entry) => ({
    name: month(entry.month),
    count: entry.count,
  }));
  const byDestination = stats.applicationsByDestination.map((entry) => ({
    name: entry.code.replaceAll('_', ' '),
    count: entry.count,
  }));
  // The funnel: how many applications are at each step of the road, plus those that left it.
  const funnel = [...APPLICATION_PIPELINE, 'REJECTED' as const, 'WITHDRAWN' as const].map(
    (status) => ({ name: t(`status.${status}`), count: stats.applicationsByStatus[status] ?? 0 }),
  );
  return (
    <>
      <PageHeader title={t('dashboard.title')} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Briefcase}
          label={t('dashboard.openJobs')}
          value={stats.openJobs}
          testId="kpi-open-jobs"
        />
        <Kpi
          icon={Inbox}
          label={t('dashboard.newThisWeek')}
          value={stats.newApplicationsThisWeek}
          testId="kpi-new-week"
        />
        <Kpi
          icon={Plane}
          label={t('dashboard.visaProcessing')}
          value={stats.applicationsByStatus.VISA_PROCESSING ?? 0}
          testId="kpi-visa-processing"
        />
        <Kpi
          icon={FileCheck2}
          label={t('dashboard.visasThisYear')}
          value={stats.visasApprovedThisYear}
          testId="kpi-visas-year"
        />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Chart title={t('dashboard.perMonth')} data={byMonth}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
              <XAxis dataKey="name" tick={axis} />
              <YAxis allowDecimals={false} tick={axis} width={32} />
              <Tooltip cursor={{ fillOpacity: 0.08 }} />
              <Bar
                dataKey="count"
                name={t('dashboard.applications')}
                fill={GOLD}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title={t('dashboard.perDestination')} data={byDestination}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDestination}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
              <XAxis dataKey="name" tick={axis} />
              <YAxis allowDecimals={false} tick={axis} width={32} />
              <Tooltip cursor={{ fillOpacity: 0.08 }} />
              <Bar
                dataKey="count"
                name={t('dashboard.applications')}
                fill={BLUE}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
        <div className="xl:col-span-2">
          <Chart title={t('dashboard.funnel')} data={funnel} tall>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
                <XAxis type="number" allowDecimals={false} tick={axis} />
                <YAxis type="category" dataKey="name" tick={axis} width={130} interval={0} />
                <Tooltip cursor={{ fillOpacity: 0.08 }} />
                <Bar
                  dataKey="count"
                  name={t('dashboard.applications')}
                  fill={GOLD}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Chart>
        </div>
      </div>
      <section className={`${card} mt-4 p-5`} aria-labelledby="latest-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="latest-title" className="font-semibold">
            {t('dashboard.latest')}
          </h2>
          <Link href="/admin/applications" className="text-sm font-medium underline">
            {t('dashboard.allApplications')}
          </Link>
        </div>
        {latest.length === 0 ? (
          <p className="rounded-lg bg-muted p-4 text-sm">{t('applications.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('applications.candidate')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('applications.job')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('applications.appliedAt')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('applications.status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {latest.map((application) => (
                  <tr key={application.id}>
                    <td className="py-2">
                      <Link
                        href={`/admin/applications?open=${application.id}`}
                        className="font-medium hover:underline"
                      >
                        {application.candidate.firstName} {application.candidate.lastName}
                      </Link>
                    </td>
                    <td className="py-2">{application.job.title}</td>
                    <td className="py-2 whitespace-nowrap">
                      {shortDate(application.appliedAt, locale)}
                    </td>
                    <td className="py-2">
                      <ApplicationBadge status={application.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
