import {
  localizedTextSchema,
  optionalLocalizedTextSchema,
  parseJobQuestions,
  type AdminJob,
  type LocalizedText,
  type OptionalLocalizedText,
  type PublicJob,
} from '@iconbridge/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { cleanRichText } from './rich-text.js';

export const JOB_INCLUDE = {
  destination: true,
  category: true,
} satisfies Prisma.JobInclude;

export const ADMIN_JOB_INCLUDE = {
  ...JOB_INCLUDE,
  _count: { select: { applications: true } },
} satisfies Prisma.JobInclude;

export type JobRow = Prisma.JobGetPayload<{ include: typeof JOB_INCLUDE }>;
export type AdminJobRow = Prisma.JobGetPayload<{ include: typeof ADMIN_JOB_INCLUDE }>;

type MediaUrl = (path: string | null) => string | null;

const EMPTY_NAME: LocalizedText = { en: '', fr: '', ar: '' };

/** i18n JSON column as a typed object; a malformed value gives empty texts instead of an error. */
export function localized(value: unknown): LocalizedText {
  return localizedTextSchema.catch(EMPTY_NAME).parse(value);
}

/** An optional translated text (a story quote): each language may be empty, and stays as written. */
export function optionalLocalized(value: unknown): OptionalLocalizedText {
  return optionalLocalizedTextSchema.catch(EMPTY_NAME).parse(value);
}

const money = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

function commonFields(job: JobRow, mediaUrl: MediaUrl) {
  return {
    id: job.id,
    slug: job.slug,
    title: job.title,
    // Cleaned again on the way out: the site renders these as HTML, whenever they were written.
    description: cleanRichText(job.description),
    requirements: job.requirements === null ? null : cleanRichText(job.requirements),
    benefits: job.benefits === null ? null : cleanRichText(job.benefits),
    accommodationProvided: job.accommodationProvided,
    transportProvided: job.transportProvided,
    mealsProvided: job.mealsProvided,
    salaryMin: money(job.salaryMin),
    salaryMax: money(job.salaryMax),
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    contractDurationMonths: job.contractDurationMonths,
    workingHours: job.workingHours,
    positions: job.positions,
    requiredLanguages: job.requiredLanguages,
    deadline: job.deadline.toISOString(),
    coverImageUrl: mediaUrl(job.coverImagePath),
    featured: job.featured,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    questions: parseJobQuestions(job.questions),
  };
}

/** What the public site may see. The employer name is dropped unless the employer agreed to show it. */
export function toPublicJob(job: JobRow, mediaUrl: MediaUrl): PublicJob {
  return {
    ...commonFields(job, mediaUrl),
    employerName: job.showEmployerName ? job.employerName : null,
    destination: {
      code: job.destination.code,
      name: localized(job.destination.name),
      icon: job.destination.icon,
    },
    category: {
      slug: job.category.slug,
      name: localized(job.category.name),
      icon: job.category.icon,
    },
  };
}

export function toAdminJob(job: AdminJobRow, mediaUrl: MediaUrl): AdminJob {
  return {
    ...commonFields(job, mediaUrl),
    employerName: job.employerName,
    showEmployerName: job.showEmployerName,
    destination: {
      id: job.destination.id,
      code: job.destination.code,
      name: localized(job.destination.name),
    },
    category: {
      id: job.category.id,
      slug: job.category.slug,
      name: localized(job.category.name),
    },
    status: job.status,
    hiredCount: job.hiredCount,
    applicationCount: job._count.applications,
    createdById: job.createdById,
    closedAt: job.closedAt?.toISOString() ?? null,
    deletedAt: job.deletedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
