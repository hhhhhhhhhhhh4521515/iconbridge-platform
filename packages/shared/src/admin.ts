import './zod-setup.js';
import { z } from 'zod';
import { emailSchema } from './auth.js';
import { countryCodeSchema } from './countries.js';
import {
  APPLICATION_PIPELINE,
  applicationStatusSchema,
  historicalMetricSchema,
  isGlobalHistoricalMetric,
  type ApplicationStatus,
  type UserRole,
} from './enums.js';
import { localeSchema, localizedTextSchema, optionalLocalizedTextSchema } from './i18n.js';
import { candidateDocumentSchema, candidateProfileResponseSchema } from './candidate.js';
import { jobQuestionSchema } from './questions.js';
import { paginationQuerySchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Application state machine
// ---------------------------------------------------------------------------

/** Statuses from which nobody but a super admin can move an application. */
export const FINAL_APPLICATION_STATUSES = ['DEPLOYED', 'REJECTED', 'WITHDRAWN'] as const;
/** Where a super admin puts back a rejected or withdrawn application. */
export const REOPEN_STATUS = 'UNDER_REVIEW' satisfies ApplicationStatus;

function nextInPipeline(status: ApplicationStatus): ApplicationStatus | undefined {
  const index = (APPLICATION_PIPELINE as readonly ApplicationStatus[]).indexOf(status);
  return index === -1 ? undefined : APPLICATION_PIPELINE[index + 1];
}

/**
 * Statuses a back-office user of the given role may move an application to.
 *
 * - One step forward along the pipeline, never a jump (Submitted cannot become Visa approved).
 * - Rejected from any step that is not final.
 * - Rejected and Withdrawn are final; only a SUPER_ADMIN can reopen them, to Under review.
 * - Deployed is final for everybody. Withdrawn is set by the candidate only.
 */
export function allowedApplicationTransitions(
  from: ApplicationStatus,
  role: UserRole,
): ApplicationStatus[] {
  if (role !== 'RECRUITER' && role !== 'SUPER_ADMIN' && role !== 'COUNTRY_AGENT') {
    return [];
  }
  if (from === 'REJECTED' || from === 'WITHDRAWN') {
    return role === 'SUPER_ADMIN' ? [REOPEN_STATUS] : [];
  }
  if (from === 'DEPLOYED') {
    return [];
  }
  const next = nextInPipeline(from);
  return next ? [next, 'REJECTED'] : ['REJECTED'];
}

export function canTransitionApplication(
  from: ApplicationStatus,
  to: ApplicationStatus,
  role: UserRole,
): boolean {
  return allowedApplicationTransitions(from, role).includes(to);
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const searchText = z.string().trim().min(2).max(100);
const languageCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/);
const calendarDate = z.iso.date();

const applicationFilters = {
  jobId: z.uuid().optional(),
  /** Destination code, e.g. MALTA. */
  destination: z.string().trim().toUpperCase().max(40).optional(),
  status: applicationStatusSchema.optional(),
  /** Applied on or after this day (UTC). */
  appliedFrom: calendarDate.optional(),
  /** Applied on or before this day (UTC). */
  appliedTo: calendarDate.optional(),
  nationality: countryCodeSchema.optional(),
  /** Candidates who speak this language (ISO 639-1). */
  language: languageCode.optional(),
  /** Part of the first name, last name or email. */
  q: searchText.optional(),
};

export const APPLICATION_SORTS = ['newest', 'oldest', 'name', 'status'] as const;

export const adminApplicationListQuerySchema = paginationQuerySchema.extend({
  ...applicationFilters,
  sort: z.enum(APPLICATION_SORTS).default('newest'),
});
export type AdminApplicationListQuery = z.infer<typeof adminApplicationListQuerySchema>;
export type ApplicationFilters = Pick<AdminApplicationListQuery, keyof typeof applicationFilters>;

const internalComment = z.string().trim().min(1).max(2000).nullable().optional();
const messageToCandidate = z.string().trim().min(1).max(2000).nullable().optional();

export const changeApplicationStatusSchema = z.object({
  status: applicationStatusSchema,
  /** Internal: for the back office only, never shown to the candidate. */
  comment: internalComment,
  /** Shown in the candidate's timeline and included in the email. */
  messageToCandidate,
});
export type ChangeApplicationStatusInput = z.infer<typeof changeApplicationStatusSchema>;

export const BULK_MAX_APPLICATIONS = 100;

export const bulkApplicationStatusSchema = changeApplicationStatusSchema.extend({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(BULK_MAX_APPLICATIONS)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each id may appear once' }),
});
export type BulkApplicationStatusInput = z.infer<typeof bulkApplicationStatusSchema>;

export const bulkResultSchema = z.object({
  changed: z.number().int(),
  failed: z.number().int(),
  results: z.array(
    z.object({
      id: z.uuid(),
      ok: z.boolean(),
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;

/** A recruiter may undo their own last status change during this many minutes. */
export const UNDO_STATUS_MINUTES = 15;

export const noteSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export type NoteInput = z.infer<typeof noteSchema>;

export const adminApplicationSummarySchema = z.object({
  id: z.uuid(),
  status: applicationStatusSchema,
  appliedAt: z.iso.datetime(),
  job: z.object({ id: z.uuid(), title: z.string(), slug: z.string(), destinationCode: z.string() }),
  candidate: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    nationality: z.string().nullable(),
  }),
  /** Statuses the current user may move this application to. */
  allowedTransitions: z.array(applicationStatusSchema),
});
export type AdminApplicationSummary = z.infer<typeof adminApplicationSummarySchema>;

export const adminApplicationDetailSchema = adminApplicationSummarySchema.extend({
  withdrawnAt: z.iso.datetime().nullable(),
  /**
   * Set when a super admin lifted the re-application waiting period of this application:
   * it no longer stops the candidate from applying to the job again.
   */
  cooldownWaivedAt: z.iso.datetime().nullable(),
  coverLetter: z.string().nullable(),
  answers: z.record(z.string(), z.string()).nullable(),
  /** The questions of the job as they were when the candidate applied; `answers` is keyed by their ids. */
  questions: z.array(jobQuestionSchema),
  /** The profile as submitted (masked passport number). */
  profileSnapshot: z.record(z.string(), z.unknown()),
  documents: z.array(
    z.object({
      id: z.uuid(),
      type: z.string(),
      originalName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number().int(),
      deleted: z.boolean(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.uuid(),
      fromStatus: applicationStatusSchema.nullable(),
      toStatus: applicationStatusSchema,
      at: z.iso.datetime(),
      changedByEmail: z.string().nullable(),
      comment: z.string().nullable(),
      messageToCandidate: z.string().nullable(),
      /** Set when the author undid this change: it no longer counts and candidates do not see it. */
      revertedAt: z.iso.datetime().nullable(),
    }),
  ),
  /**
   * Present when the current user may undo the last status change (their own, made
   * less than 15 minutes ago): the status it would go back to, and until when.
   */
  undo: z.object({ toStatus: applicationStatusSchema, until: z.iso.datetime() }).nullable(),
  notes: z.array(
    z.object({
      id: z.uuid(),
      body: z.string(),
      authorId: z.uuid(),
      authorEmail: z.string(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
});
export type AdminApplicationDetail = z.infer<typeof adminApplicationDetailSchema>;

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const EXPORT_COLUMNS = [
  'applicationId',
  'status',
  'appliedAt',
  'jobTitle',
  'destination',
  'firstName',
  'lastName',
  'email',
  'phone',
  'nationality',
  'countryOfResidence',
  'dateOfBirth',
  'passportNumberMasked',
  'passportExpiryDate',
  'currentProfession',
  'yearsOfExperience',
  'languages',
  'answers',
  'passportNumber',
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/** The full passport number: SUPER_ADMIN only, with an explicit confirmation, and logged. */
export const RESTRICTED_EXPORT_COLUMN = 'passportNumber' satisfies ExportColumn;

export const DEFAULT_EXPORT_COLUMNS = EXPORT_COLUMNS.filter(
  (column) => column !== RESTRICTED_EXPORT_COLUMN,
);

export const EXPORT_MAX_ROWS = 5000;

export const exportApplicationsSchema = z
  .object({
    format: z.enum(['csv', 'xlsx']),
    columns: z
      .array(z.enum(EXPORT_COLUMNS))
      .min(1)
      .refine((columns) => new Set(columns).size === columns.length, {
        message: 'Each column may appear once',
      })
      .default(DEFAULT_EXPORT_COLUMNS),
    /** Export exactly these applications (a selection)... */
    ids: z.array(z.uuid()).min(1).max(EXPORT_MAX_ROWS).optional(),
    /** ...or everything matching these filters. */
    filters: z.object(applicationFilters).optional(),
    /**
     * Must be true to export the `passportNumber` column, and only a SUPER_ADMIN may
     * set it. It is a deliberate second confirmation, not a default.
     */
    includeFullPassportNumber: z.boolean().default(false),
  })
  .refine(
    (body) => body.columns.includes(RESTRICTED_EXPORT_COLUMN) === body.includeFullPassportNumber,
    {
      path: ['includeFullPassportNumber'],
      message: 'Select the passportNumber column and set includeFullPassportNumber together',
    },
  );
export type ExportApplicationsInput = z.infer<typeof exportApplicationsSchema>;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const adminCandidateListQuerySchema = paginationQuerySchema.extend({
  q: searchText.optional(),
  nationality: countryCodeSchema.optional(),
  language: languageCode.optional(),
  /** "false" lists disabled accounts. */
  active: queryBoolean.optional(),
});
export type AdminCandidateListQuery = z.infer<typeof adminCandidateListQuerySchema>;

export const adminCandidateSummarySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  nationality: z.string().nullable(),
  countryOfResidence: z.string().nullable(),
  currentProfession: z.string().nullable(),
  passportNumberMasked: z.string().nullable(),
  isActive: z.boolean(),
  emailVerified: z.boolean(),
  applicationCount: z.number().int(),
  /** Documents the candidate keeps (not deleted). */
  documentCount: z.number().int(),
  registeredAt: z.iso.datetime(),
});
export type AdminCandidateSummary = z.infer<typeof adminCandidateSummarySchema>;

/** One candidate as the back office sees it. The passport number is masked; see the reveal action. */
export const adminCandidateDetailSchema = adminCandidateSummarySchema.extend({
  profile: candidateProfileResponseSchema,
  documents: z.array(candidateDocumentSchema),
  applications: z.array(adminApplicationSummarySchema),
});
export type AdminCandidateDetail = z.infer<typeof adminCandidateDetailSchema>;

/** Answer of the audited "reveal passport number" action. */
export const revealedPassportSchema = z.object({ passportNumber: z.string().nullable() });
export type RevealedPassport = z.infer<typeof revealedPassportSchema>;

// ---------------------------------------------------------------------------
// Contact messages
// ---------------------------------------------------------------------------

export const contactMessageListQuerySchema = paginationQuerySchema.extend({
  /** "true": handled messages only; "false": those still to handle; absent: all. */
  handled: queryBoolean.optional(),
  q: searchText.optional(),
});
export type ContactMessageListQuery = z.infer<typeof contactMessageListQuerySchema>;

export const adminContactMessageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  subject: z.string().nullable(),
  message: z.string(),
  handledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminContactMessage = z.infer<typeof adminContactMessageSchema>;

// ---------------------------------------------------------------------------
// Success stories and home slides
// ---------------------------------------------------------------------------

const storyFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(''),
  /** Needs the candidate's consent to their full name; otherwise the site shows "Amira B." */
  showFullName: z.boolean().default(false),
  jobTitle: z.string().trim().min(1).max(150),
  destinationId: z.uuid(),
  visaApprovedAt: calendarDate.nullable().optional(),
  /** "What the candidate says": optional, each language may be empty (ADR-024). */
  quote: optionalLocalizedTextSchema.default({ en: '', fr: '', ar: '' }),
};

export const createSuccessStorySchema = z.object(storyFields);
export type CreateSuccessStoryInput = z.infer<typeof createSuccessStorySchema>;

export const updateSuccessStorySchema = z
  .object({
    firstName: storyFields.firstName.optional(),
    lastName: z.string().trim().max(100).optional(),
    showFullName: z.boolean().optional(),
    jobTitle: storyFields.jobTitle.optional(),
    destinationId: z.uuid().optional(),
    visaApprovedAt: calendarDate.nullable().optional(),
    quote: optionalLocalizedTextSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field' });
export type UpdateSuccessStoryInput = z.infer<typeof updateSuccessStorySchema>;

/** New order: every id of the list, first shown first. */
export const reorderSchema = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each id may appear once' }),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

/** How a published story appears on the site. */
export function publicStoryName(story: {
  firstName: string;
  lastName: string;
  showFullName: boolean;
}): string {
  const lastName = story.lastName.trim();
  if (!lastName) {
    return story.firstName;
  }
  return story.showFullName
    ? `${story.firstName} ${lastName}`
    : `${story.firstName} ${String.fromCodePoint(lastName.codePointAt(0) ?? 0x3f).toUpperCase()}.`;
}

export const publicSuccessStorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  photoUrl: z.string().nullable(),
  jobTitle: z.string(),
  destination: z.object({ code: z.string(), name: localizedTextSchema }),
  visaApprovedAt: z.iso.date().nullable(),
  /** Empty texts when the story has no quote in that language. */
  quote: optionalLocalizedTextSchema,
});
export type PublicSuccessStory = z.infer<typeof publicSuccessStorySchema>;

export const adminSuccessStorySchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  showFullName: z.boolean(),
  /** The name as the site would show it. */
  publicName: z.string(),
  photoUrl: z.string().nullable(),
  jobTitle: z.string(),
  destination: z.object({ id: z.uuid(), code: z.string(), name: localizedTextSchema }),
  visaApprovedAt: z.iso.date().nullable(),
  quote: optionalLocalizedTextSchema,
  hasConsentDocument: z.boolean(),
  isPublished: z.boolean(),
  sortOrder: z.number().int(),
  applicationId: z.uuid().nullable(),
});
export type AdminSuccessStory = z.infer<typeof adminSuccessStorySchema>;

const slideFields = {
  title: localizedTextSchema,
  subtitle: localizedTextSchema.nullable().optional(),
  ctaLabel: localizedTextSchema.nullable().optional(),
  /** A path of the site ("/jobs?destination=MALTA") or an https URL. */
  ctaUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^(\/(?!\/)|https:\/\/)/, 'Use a path starting with "/" or an https URL')
    .nullable()
    .optional(),
  destinationId: z.uuid().nullable().optional(),
};

export const createHomeSlideSchema = z.object(slideFields);
export type CreateHomeSlideInput = z.infer<typeof createHomeSlideSchema>;

export const updateHomeSlideSchema = z
  .object({
    ...slideFields,
    title: localizedTextSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field' });
export type UpdateHomeSlideInput = z.infer<typeof updateHomeSlideSchema>;

export const homeSlideSchema = z.object({
  id: z.uuid(),
  title: localizedTextSchema,
  subtitle: localizedTextSchema.nullable(),
  imageUrl: z.string().nullable(),
  ctaLabel: localizedTextSchema.nullable(),
  ctaUrl: z.string().nullable(),
  destinationCode: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type HomeSlide = z.infer<typeof homeSlideSchema>;

export const adminHomeSlideSchema = homeSlideSchema.extend({
  isActive: z.boolean(),
  destinationId: z.uuid().nullable(),
});
export type AdminHomeSlide = z.infer<typeof adminHomeSlideSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditLogQuerySchema = paginationQuerySchema.extend({
  /** Part of the action name, e.g. "job." or "undo". */
  action: z.string().trim().min(2).max(60).optional(),
  entityType: z.string().trim().min(1).max(40).optional(),
  /** Part of the email address of the person who acted. */
  actor: z.string().trim().min(2).max(100).optional(),
  /** On or after this day (UTC). */
  from: calendarDate.optional(),
  /** On or before this day (UTC). */
  to: calendarDate.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

// ---------------------------------------------------------------------------
// Settings, dashboard
// ---------------------------------------------------------------------------

export const updateSettingSchema = z.object({ value: z.unknown() });

// ---------------------------------------------------------------------------
// Lifting the re-application waiting period (SPEC section 6)
// ---------------------------------------------------------------------------

/** Why the waiting period is lifted; kept in the audit log. It must not contain personal data. */
export const waiveCooldownSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export type WaiveCooldownInput = z.infer<typeof waiveCooldownSchema>;

// ---------------------------------------------------------------------------
// Deleting candidates and applications
// ---------------------------------------------------------------------------

/** Why the record is deleted; kept in the audit log. It must not contain personal data. */
const deletionReason = z.string().trim().min(5).max(500);
export const DELETE_MAX_RECORDS = 50;
const deletionIds = z
  .array(z.uuid())
  .min(1)
  .max(DELETE_MAX_RECORDS)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Each id may appear once' });

export const deleteRecordSchema = z.object({ reason: deletionReason });
export type DeleteRecordInput = z.infer<typeof deleteRecordSchema>;

export const bulkDeleteSchema = z.object({ ids: deletionIds, reason: deletionReason });
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;

/** What deleting one candidate removed. */
export const candidateDeletionSchema = z.object({
  id: z.uuid(),
  documents: z.number().int(),
  applications: z.number().int(),
});
export type CandidateDeletion = z.infer<typeof candidateDeletionSchema>;

/** What the current user may do beyond the fixed permissions of their role. */
export const adminCapabilitiesSchema = z.object({ canDeleteRecords: z.boolean() });
export type AdminCapabilities = z.infer<typeof adminCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// Historical results (before the platform)
// ---------------------------------------------------------------------------

export const HISTORY_FIRST_YEAR = 1990;

export const historicalFigureInputSchema = z
  .object({
    metric: historicalMetricSchema,
    /** Null for the two global figures. */
    year: z.number().int().min(HISTORY_FIRST_YEAR).max(2100).nullable(),
    /** Null for the two global figures. */
    destinationId: z.uuid().nullable(),
    value: z.number().int().min(0).max(10_000_000),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .superRefine((figure, context) => {
    const global = isGlobalHistoricalMetric(figure.metric);
    if (global && (figure.year !== null || figure.destinationId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['year'],
        message: 'This figure is global: it has no year and no destination',
      });
    }
    if (!global && (figure.year === null || figure.destinationId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['year'],
        message: 'This figure needs a year and a destination',
      });
    }
  });
export type HistoricalFigureInput = z.infer<typeof historicalFigureInputSchema>;

export const historicalFigureSchema = z.object({
  id: z.uuid(),
  metric: historicalMetricSchema,
  year: z.number().int().nullable(),
  destinationId: z.uuid().nullable(),
  destinationCode: z.string().nullable(),
  value: z.number().int(),
  note: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type HistoricalFigure = z.infer<typeof historicalFigureSchema>;

const yearCount = z.object({ year: z.number().int(), count: z.number().int() });
const destinationCount = z.object({ code: z.string(), count: z.number().int() });
/** The same figures from one source: the platform, or the history entered by hand. */
const resultsSchema = z.object({
  visasApproved: z.number().int(),
  visasApprovedThisYear: z.number().int(),
  candidatesDeployed: z.number().int(),
  registeredCandidates: z.number().int(),
  partnerCompanies: z.number().int(),
  countries: z.number().int(),
  visasByYear: z.array(yearCount),
  visasByDestination: z.array(destinationCount),
});
export type ResultFigures = z.infer<typeof resultsSchema>;

export const adminStatsSchema = z.object({
  /**
   * Null: the figures cover the whole platform. A list: a country agent's dashboard, where
   * the application, visa and candidate figures cover these nationalities only and the
   * historical figures (not recorded by nationality) are left at zero.
   */
  scopeCountries: z.array(z.string()).nullable(),
  /** Results computed from the applications and accounts of the platform. */
  platform: resultsSchema,
  /** Results from before the platform, entered by the super admin. Never mixed with the data above. */
  history: resultsSchema,
  openJobs: z.number().int(),
  /** Applications received since Monday 00:00 UTC. */
  newApplicationsThisWeek: z.number().int(),
  applicationsByStatus: z.record(applicationStatusSchema, z.number().int()),
  applicationsByDestination: z.array(z.object({ code: z.string(), count: z.number().int() })),
  /** The last 12 months, oldest first, months without application included. */
  applicationsByMonth: z.array(z.object({ month: z.string(), count: z.number().int() })),
  visasApprovedThisYear: z.number().int(),
  /** Null when no application has reached Visa approved yet. */
  averageDaysToVisaApproved: z.number().nullable(),
});
export type AdminStats = z.infer<typeof adminStatsSchema>;

// ---------------------------------------------------------------------------
// Job alerts and contact form (public)
// ---------------------------------------------------------------------------

export const subscribeJobAlertSchema = z.object({
  email: emailSchema,
  /** Destination codes to follow; empty or omitted means every destination. */
  destinations: z.array(z.string().trim().toUpperCase().max(40)).max(20).default([]),
  /** Category slugs to follow; empty or omitted means every category. */
  categories: z.array(z.string().trim().toLowerCase().max(80)).max(20).default([]),
  locale: localeSchema.default('en'),
  turnstileToken: z.string().min(1).max(2048),
});
export type SubscribeJobAlertInput = z.infer<typeof subscribeJobAlertSchema>;

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export type TokenInput = z.infer<typeof tokenSchema>;

export const contactMessageSchema = z.object({
  name: z.string().trim().min(1).max(150),
  email: emailSchema,
  phone: z.string().trim().max(30).nullable().optional(),
  subject: z.string().trim().min(1).max(200).nullable().optional(),
  message: z.string().trim().min(10).max(5000),
  turnstileToken: z.string().min(1).max(2048),
});
export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

// ---------------------------------------------------------------------------
// Job alerts
// ---------------------------------------------------------------------------

/** Body of POST /admin/job-alerts/erase: the address whose alerts are removed. */
export const eraseJobAlertsSchema = z.object({ email: emailSchema });
export type EraseJobAlertsInput = z.infer<typeof eraseJobAlertsSchema>;

export const eraseJobAlertsResultSchema = z.object({ removed: z.number().int() });
export type EraseJobAlertsResult = z.infer<typeof eraseJobAlertsResultSchema>;
