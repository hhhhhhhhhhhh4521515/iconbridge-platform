'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { Application } from '@/lib/client-api';

type Status = Application['status'];

const TONES: Record<Status, string> = {
  SUBMITTED: 'bg-muted text-foreground',
  UNDER_REVIEW: 'bg-secondary text-secondary-foreground',
  SHORTLISTED: 'bg-secondary text-secondary-foreground',
  INTERVIEW: 'bg-brand-gold-soft text-foreground',
  OFFER: 'bg-brand-gold text-brand-navy',
  CONTRACT_SIGNED: 'bg-emerald-100 text-emerald-900',
  VISA_PROCESSING: 'bg-emerald-100 text-emerald-900',
  VISA_APPROVED: 'bg-emerald-600 text-white',
  DEPLOYED: 'bg-emerald-700 text-white',
  REJECTED: 'bg-destructive/15 text-destructive',
  WITHDRAWN: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations('account.status');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[status]}`}
      data-testid="status-badge"
      data-status={status}
    >
      {t(status)}
    </span>
  );
}

/** Long dates in the page language: "12 October 2026". */
export function useDate(): (iso: string) => string {
  const locale = useLocale();
  return (iso) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
}
