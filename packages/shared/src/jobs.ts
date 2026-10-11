import { z } from 'zod';
import { JOB_STATUSES, jobStatusSchema, salaryPeriodSchema, type JobStatus } from './enums.js';
import { localizedTextSchema } from './i18n.js';
import { jobQuestionSchema, jobQuestionsSchema } from './questions.js';
import { paginationQuerySchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export const JOB_ACTIONS = ['publish', 'close', 'reopen', 'archive'] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

/** Which statuses an action may start from, and where it leads. */
export const JOB_TRANSITIONS: Record<JobAction, { from: readonly JobStatus[]; to: JobStatus }> = {
  publish: { from: ['DRAFT'], to: 'PUBLISHED' },
  close: { from: ['PUBLISHED'], to: 'CLOSED' },
  reopen: { from: ['CLOSED'], to: 'PUBLISHED' },
  archive: { from: ['DRAFT', 'PUBLISHED', 'CLOSED'], to: 'ARCHIVED' },
};

export function canTransitionJob(action: JobAction, status: JobStatus): boolean {
  return JOB_TRANSITIONS[action].from.includes(status);
}

/**
 * A job is open to candidates when it is published, not deleted, its deadline is
 * in the future and positions remain. The API applies the same rule in SQL.
 */
export function isJobOpen(
  job: {
    status: JobStatus;
    deadline: Date;
    positions: number;
    hiredCount: number;
    deletedAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  return (
    job.status === 'PUBLISHED' &&
    job.deletedAt === null &&
    job.deadline > now &&
    job.hiredCount < job.positions
  );
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

export const SLUG_MAX_LENGTH = 80;

/** Lower-case ASCII words joined by hyphens; accents removed; "" when nothing usable is left. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

/** "Hotel Receptionist" in "Malta" gives "hotel-receptionist-malta". */
export function jobSlugBase(title: string, destinationName: string): string {
  return slugify(`${slugify(title) || 'job'} ${destinationName}`);
}

// ---------------------------------------------------------------------------
// Query strings
// ---------------------------------------------------------------------------

/** "true"/"false" from a query string; z.coerce.boolean would turn "false" into true. */
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const languageCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}$/, 'Use an ISO 639 language code');
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use an ISO 4217 currency code');
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, digits and hyphens')
  .max(SLUG_MAX_LENGTH);

export const JOB_SORTS = ['relevance', 'newest', 'deadline', 'salary'] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export const jobListQuerySchema = paginationQuerySchema
  .extend({
    /** Destination code, e.g. MALTA. */
    destination: z.string().trim().toUpperCase().max(40).optional(),
    /** Category slug, e.g. hospitality. */
    category: slug.optional(),
    /** Jobs paying at least this (compared with the top of their range). */
    salaryMin: z.coerce.number().min(0).optional(),
    /** Jobs paying at most this (compared with the bottom of their range). */
    salaryMax: z.coerce.number().min(0).optional(),
    /** Recommended with a salary filter: amounts in different currencies are not comparable. */
    currency: currencyCode.optional(),
    /** Jobs that require this language. */
    language: languageCode.optional(),
    featured: queryBoolean.optional(),
    /** Free text: full-text search on title and description, tolerant of plurals and typos on the title. */
    q: z.string().trim().min(2).max(100).optional(),
    /** Defaults to relevance when `q` is given, newest otherwise. */
    sort: z.enum(JOB_SORTS).optional(),
  })
  .refine(
    (query) =>
      query.salaryMin === undefined ||
      query.salaryMax === undefined ||
      query.salaryMin <= query.salaryMax,
    { path: ['salaryMax'], message: 'salaryMax must not be below salaryMin' },
  )
  .refine((query) => query.sort !== 'relevance' || query.q !== undefined, {
    path: ['sort'],
    message: 'Sorting by relevance needs a search text (q)',
  });
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export const adminJobListQuerySchema = paginationQuerySchema.extend({
  status: jobStatusSchema.optional(),
  destinationId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  q: z.string().trim().min(2).max(100).optional(),
  /** "true" lists soft-deleted jobs instead of the live ones. */
  deleted: queryBoolean.default(false),
});
export type AdminJobListQuery = z.infer<typeof adminJobListQuerySchema>;

/** `?permanent=true` asks for a real delete instead of a soft delete. */
export const deleteJobQuerySchema = z.object({ permanent: queryBoolean.default(false) });
export type DeleteJobQuery = z.infer<typeof deleteJobQuerySchema>;

// ---------------------------------------------------------------------------
// Write bodies
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const money = z.number().min(0).max(99_999_999).multipleOf(0.01);

const jobFieldsSchema = z.object({
  title: z.string().trim().min(3).max(150),
  destinationId: z.uuid(),
  categoryId: z.uuid(),
  employerName: optionalText(150),
  /** When false the employer name is never sent to the public site. */
  showEmployerName: z.boolean().default(false),
  description: z.string().trim().min(20).max(20_000),
  requirements: optionalText(10_000),
  benefits: optionalText(5_000),
  accommodationProvided: z.boolean().default(false),
  transportProvided: z.boolean().default(false),
  mealsProvided: z.boolean().default(false),
  salaryMin: money.nullable().optional(),
  salaryMax: money.nullable().optional(),
  salaryCurrency: currencyCode.nullable().optional(),
  salaryPeriod: salaryPeriodSchema.nullable().optional(),
  contractDurationMonths: z.number().int().min(1).max(120).nullable().optional(),
  workingHours: optionalText(200),
  positions: z.number().int().min(1).max(10_000).default(1),
  requiredLanguages: z.array(languageCode).max(10).default([]),
  /** Application deadline (ISO 8601). Must be in the future to publish. */
  deadline: z.iso.datetime({ offset: true }),
  /** Questions asked when applying, besides the cover letter. */
  questions: jobQuestionsSchema.default([]),
});

function checkSalary(
  job: {
    salaryMin?: number | null | undefined;
    salaryMax?: number | null | undefined;
    salaryCurrency?: string | null | undefined;
    salaryPeriod?: string | null | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin > job.salaryMax) {
    context.addIssue({
      code: 'custom',
      path: ['salaryMax'],
      message: 'salaryMax must not be below salaryMin',
    });
  }
  if ((job.salaryMin != null || job.salaryMax != null) && !job.salaryCurrency) {
    context.addIssue({
      code: 'custom',
      path: ['salaryCurrency'],
      message: 'A salary needs a currency',
    });
  }
  if ((job.salaryMin != null || job.salaryMax != null) && !job.salaryPeriod) {
    context.addIssue({
      code: 'custom',
      path: ['salaryPeriod'],
      message: 'A salary needs a period',
    });
  }
}

/** A new job is always created as a DRAFT; status and "featured" change through actions. */
export const createJobSchema = jobFieldsSchema.superRefine(checkSalary);
export type CreateJobInput = z.infer<typeof createJobSchema>;

/**
 * Partial update. The salary rules are checked again by the API on the merged
 * job, because a partial body cannot be judged on its own.
 */
export const updateJobSchema = z
  .object(
    Object.fromEntries(
      Object.entries(jobFieldsSchema.shape).map(([key, field]) => [
        key,
        (field instanceof z.ZodDefault ? field.unwrap() : field).optional(),
      ]),
    ) as {
      [K in keyof typeof jobFieldsSchema.shape]: z.ZodOptional<
        (typeof jobFieldsSchema.shape)[K] extends z.ZodDefault<infer Inner>
          ? Inner
          : (typeof jobFieldsSchema.shape)[K]
      >;
    },
  )
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field',
  });
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

/** Checks the salary rules on a complete job (after merging an update). */
export const jobSalarySchema = z
  .object({
    salaryMin: z.number().nullable(),
    salaryMax: z.number().nullable(),
    salaryCurrency: z.string().nullable(),
    salaryPeriod: z.string().nullable(),
  })
  .superRefine(checkSalary);

export const createDestinationSchema = z.object({
  /** Stable upper-case code, e.g. MALTA. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use upper-case letters, digits and underscores'),
  name: localizedTextSchema,
  /** Flag emoji or icon name. */
  icon: z.string().trim().min(1).max(50).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;

export const updateDestinationSchema = z
  .object({
    name: localizedTextSchema.optional(),
    icon: z.string().trim().min(1).max(50).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field',
  });
export type UpdateDestinationInput = z.infer<typeof updateDestinationSchema>;

export const createCategorySchema = z.object({
  slug,
  name: localizedTextSchema,
  icon: z.string().trim().min(1).max(50).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: localizedTextSchema.optional(),
    icon: z.string().trim().min(1).max(50).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field',
  });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const destinationSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: localizedTextSchema,
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  /** Jobs currently open in this destination. */
  openJobs: z.number().int(),
});
export type Destination = z.infer<typeof destinationSchema>;

export const categorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: localizedTextSchema,
  icon: z.string().nullable(),
  openJobs: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;

export const adminDestinationSchema = destinationSchema
  .omit({ openJobs: true })
  .extend({ isActive: z.boolean(), jobCount: z.number().int() });
export type AdminDestination = z.infer<typeof adminDestinationSchema>;

export const adminCategorySchema = categorySchema
  .omit({ openJobs: true })
  .extend({ isActive: z.boolean(), jobCount: z.number().int() });
export type AdminCategory = z.infer<typeof adminCategorySchema>;

/** Result of deleting a destination or a category. */
export const removalResultSchema = z.object({
  /** "deleted" when nothing used it; "deactivated" when jobs or content still refer to it. */
  outcome: z.enum(['deleted', 'deactivated']),
});
export type RemovalResult = z.infer<typeof removalResultSchema>;

/** A job as the public site sees it. Internal fields (hired count, author, status) are absent. */
export const publicJobSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  destination: z.object({
    code: z.string(),
    name: localizedTextSchema,
    icon: z.string().nullable(),
  }),
  category: z.object({ slug: z.string(), name: localizedTextSchema, icon: z.string().nullable() }),
  /** Null when the employer chose to stay hidden. */
  employerName: z.string().nullable(),
  description: z.string(),
  requirements: z.string().nullable(),
  benefits: z.string().nullable(),
  accommodationProvided: z.boolean(),
  transportProvided: z.boolean(),
  mealsProvided: z.boolean(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: salaryPeriodSchema.nullable(),
  contractDurationMonths: z.number().int().nullable(),
  workingHours: z.string().nullable(),
  positions: z.number().int(),
  requiredLanguages: z.array(z.string()),
  deadline: z.iso.datetime(),
  coverImageUrl: z.string().nullable(),
  featured: z.boolean(),
  publishedAt: z.iso.datetime().nullable(),
  questions: z.array(jobQuestionSchema),
});
export type PublicJob = z.infer<typeof publicJobSchema>;

/** A job as the back office sees it. */
export const adminJobSchema = publicJobSchema.omit({ destination: true, category: true }).extend({
  destination: z.object({ id: z.uuid(), code: z.string(), name: localizedTextSchema }),
  category: z.object({ id: z.uuid(), slug: z.string(), name: localizedTextSchema }),
  showEmployerName: z.boolean(),
  status: z.enum(JOB_STATUSES),
  hiredCount: z.number().int(),
  applicationCount: z.number().int(),
  createdById: z.uuid(),
  closedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminJob = z.infer<typeof adminJobSchema>;

/** Counters of the home page. */
export const publicStatsSchema = z.object({
  openJobs: z.number().int(),
  registeredCandidates: z.number().int(),
  visasApproved: z.number().int(),
  /** Active destinations. */
  countries: z.number().int(),
});
export type PublicStats = z.infer<typeof publicStatsSchema>;
