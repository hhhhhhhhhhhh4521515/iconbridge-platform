'use client';

import { useTranslations } from 'next-intl';
import type { AdminJob, ApplicationStatus } from '@/lib/client-api';
import { Badge, type Tone } from './ui';

export const APPLICATION_TONES: Record<ApplicationStatus, Tone> = {
  SUBMITTED: 'neutral',
  UNDER_REVIEW: 'info',
  SHORTLISTED: 'info',
  INTERVIEW: 'info',
  OFFER: 'gold',
  CONTRACT_SIGNED: 'gold',
  VISA_PROCESSING: 'gold',
  VISA_APPROVED: 'success',
  DEPLOYED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'muted',
};

export function ApplicationBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations('admin.status');
  return (
    <span data-testid="application-status" data-status={status}>
      <Badge tone={APPLICATION_TONES[status]}>{t(status)}</Badge>
    </span>
  );
}

const JOB_TONES: Record<AdminJob['status'], Tone> = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  CLOSED: 'muted',
  ARCHIVED: 'muted',
};

export function JobBadge({ status }: { status: AdminJob['status'] }) {
  const t = useTranslations('admin.jobStatus');
  return (
    <span data-testid="job-status" data-status={status}>
      <Badge tone={JOB_TONES[status]}>{t(status)}</Badge>
    </span>
  );
}
