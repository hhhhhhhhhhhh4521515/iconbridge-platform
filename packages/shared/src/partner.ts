import './zod-setup.js';
import { z } from 'zod';
import { adminRoleSchema, emailSchema, passwordSchema, phoneSchema } from './auth.js';
import type { DocumentFormat } from './candidate.js';
import { countryCodeSchema } from './countries.js';
import {
  partnerFileKindSchema,
  partnerJobStatusSchema,
  partnerMemberKindSchema,
  partnerVisaStatusSchema,
  partnerWorkPermitStatusSchema,
} from './enums.js';
import { partnerLocaleSchema } from './i18n.js';

/**
 * Partner spaces (ADR-027): what the super admin sends and receives to manage them. The
 * content of a space (job demands, applications, files, comments, history) has its own
 * schemas, used by the partner area.
 */

const spaceNameSchema = z.string().trim().min(2).max(120);

export const createPartnerSpaceSchema = z.object({
  name: spaceNameSchema,
  /** ISO 3166-1 alpha-2 country of the partner company. */
  country: countryCodeSchema,
  /** Language of the partner area and of the emails to the space's partner logins. */
  defaultLocale: partnerLocaleSchema,
});
export type CreatePartnerSpaceInput = z.infer<typeof createPartnerSpaceSchema>;

export const updatePartnerSpaceSchema = z
  .object({
    name: spaceNameSchema,
    country: countryCodeSchema,
    defaultLocale: partnerLocaleSchema,
    /** False cuts every member's access at the next request; true gives it back. */
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdatePartnerSpaceInput = z.infer<typeof updatePartnerSpaceSchema>;

/** Deleting a space (its files, rows and partner logins): the super admin types its name. */
export const deletePartnerSpaceSchema = z.object({
  confirmName: z.string().trim().min(1).max(120),
});
export type DeletePartnerSpaceInput = z.infer<typeof deletePartnerSpaceSchema>;

export const partnerSpaceParamsSchema = z.object({ spaceId: z.uuid() });
export const partnerSpaceMemberParamsSchema = z.object({ spaceId: z.uuid(), userId: z.uuid() });

/** A space as the super admin sees it: settings and counts, never content. */
export const partnerSpaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string(),
  defaultLocale: partnerLocaleSchema,
  isActive: z.boolean(),
  hasLogo: z.boolean(),
  counts: z.object({
    staffMembers: z.number().int(),
    partnerLogins: z.number().int(),
    jobs: z.number().int(),
    applications: z.number().int(),
    files: z.number().int(),
  }),
  /** Whether the caller is a member, and can therefore open the space. */
  isMember: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PartnerSpace = z.infer<typeof partnerSpaceSchema>;

/** Adds a back-office account (any role) as a member with full rights inside the space. */
export const addPartnerStaffMemberSchema = z.object({ userId: z.uuid() });
export type AddPartnerStaffMemberInput = z.infer<typeof addPartnerStaffMemberSchema>;

export const partnerStaffMemberSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
  role: adminRoleSchema,
  isActive: z.boolean(),
  addedAt: z.iso.datetime(),
});
export type PartnerStaffMember = z.infer<typeof partnerStaffMemberSchema>;

const displayNameSchema = z.string().trim().min(1).max(80);

/**
 * A login of the partner company. The password is set now: the person must change it at the
 * first sign-in, and it is never returned, logged or audited (ADR-024, ADR-027).
 */
export const createPartnerLoginSchema = z.object({
  email: emailSchema,
  /** Shown to the other members as the author of comments and changes. */
  displayName: displayNameSchema,
  password: passwordSchema,
});
export type CreatePartnerLoginInput = z.infer<typeof createPartnerLoginSchema>;

export const updatePartnerLoginSchema = z
  .object({
    displayName: displayNameSchema,
    /** False signs the login out everywhere at once and refuses every further request. */
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdatePartnerLoginInput = z.infer<typeof updatePartnerLoginSchema>;

export const partnerLoginSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
  isActive: z.boolean(),
  passwordChangeRequired: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type PartnerLogin = z.infer<typeof partnerLoginSchema>;

// ---------------------------------------------------------------------------
// The partner area (ADR-027): what members of a space send and receive. Every id in a path
// or a body is looked up inside the space of the path; another space's id answers 404.
// ---------------------------------------------------------------------------

export const partnerJobParamsSchema = z.object({ spaceId: z.uuid(), jobId: z.uuid() });
export const partnerApplicationParamsSchema = z.object({
  spaceId: z.uuid(),
  applicationId: z.uuid(),
});

/** A space as its members see it. */
export const partnerSpaceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string(),
  defaultLocale: partnerLocaleSchema,
  hasLogo: z.boolean(),
  /** A 5-minute read-only link to the logo, for members only; null without a logo. */
  logoUrl: z.url().nullable(),
  /** How the caller belongs to it. */
  membership: partnerMemberKindSchema,
});
export type PartnerSpaceSummary = z.infer<typeof partnerSpaceSummarySchema>;

const plainText = (max: number) => z.string().trim().max(max);
const locationSchema = z.string().trim().min(1).max(100);

const partnerJobFields = z.object({
  /** For example "Housekeeping". */
  role: z.string().trim().min(1).max(120),
  positions: z.number().int().min(1).max(1000),
  /** 1 to 10 places, each once. */
  locations: z
    .array(locationSchema)
    .min(1)
    .max(10)
    .refine((items) => new Set(items.map((item) => item.toLowerCase())).size === items.length, {
      message: 'Each place may appear once',
    }),
  /** Free text, e.g. "4,500 PLN gross a month". */
  salary: plainText(200).nullable(),
  /** Plain text, shown as text, never as HTML. */
  description: plainText(5000),
});

export const createPartnerJobSchema = partnerJobFields.extend({
  salary: partnerJobFields.shape.salary.optional().default(null),
  description: partnerJobFields.shape.description.optional().default(''),
});
export type CreatePartnerJobInput = z.infer<typeof createPartnerJobSchema>;

export const updatePartnerJobSchema = partnerJobFields
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdatePartnerJobInput = z.infer<typeof updatePartnerJobSchema>;

export const listPartnerJobsQuerySchema = z.object({
  status: partnerJobStatusSchema.optional(),
});
export type ListPartnerJobsQuery = z.infer<typeof listPartnerJobsQuerySchema>;

const visaCounts = z.object({
  NOT_STARTED: z.number().int(),
  APPOINTMENT_BOOKED: z.number().int(),
  SUBMITTED: z.number().int(),
  APPROVED: z.number().int(),
  REFUSED: z.number().int(),
});

const workPermitCounts = z.object({
  NOT_STARTED: z.number().int(),
  SUBMITTED: z.number().int(),
  APPROVED: z.number().int(),
  REFUSED: z.number().int(),
});

export const partnerJobSchema = z.object({
  id: z.uuid(),
  role: z.string(),
  positions: z.number().int(),
  locations: z.array(z.string()),
  salary: z.string().nullable(),
  description: z.string(),
  status: partnerJobStatusSchema,
  closedAt: z.iso.datetime().nullable(),
  /** Applications of this job demand per visa status. */
  applications: visaCounts,
  /** Applications of this job demand per work permit status. */
  workPermits: workPermitCounts,
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PartnerJob = z.infer<typeof partnerJobSchema>;

const calendarDate = z.iso.date();
/** Decision dates only for a decided visa. */
export const DECIDED_VISA_STATUSES = ['APPROVED', 'REFUSED'] as const;
/** Decision dates only for a decided work permit. */
export const DECIDED_WORK_PERMIT_STATUSES = ['APPROVED', 'REFUSED'] as const;

const partnerApplicationFields = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  nationality: countryCodeSchema,
  phone: phoneSchema.nullable(),
  email: emailSchema.nullable(),
  workPermitStatus: partnerWorkPermitStatusSchema,
  workPermitSubmittedDate: calendarDate.nullable(),
  workPermitDecisionDate: calendarDate.nullable(),
  visaStatus: partnerVisaStatusSchema,
  visaAppointmentDate: calendarDate.nullable(),
  visaDecisionDate: calendarDate.nullable(),
  dhlSentDate: calendarDate.nullable(),
  dhlTrackingNumber: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .regex(/^[A-Za-z0-9 -]+$/, 'Letters, digits, spaces and dashes only')
    .nullable(),
  documentsReceivedDate: calendarDate.nullable(),
});

/** The fields the rules between fields read; loose, so a stored row can be checked too. */
interface ApplicationState {
  workPermitStatus?: string | undefined;
  workPermitDecisionDate?: string | null | undefined;
  visaStatus?: string | undefined;
  visaDecisionDate?: string | null | undefined;
  dhlSentDate?: string | null | undefined;
  dhlTrackingNumber?: string | null | undefined;
}

/**
 * The rules between fields, checked on the whole application after a change (the API merges
 * a partial change with the stored row first; the database checks them again).
 */
export function partnerApplicationIssues(
  state: ApplicationState,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (
    state.workPermitDecisionDate &&
    !(DECIDED_WORK_PERMIT_STATUSES as readonly string[]).includes(
      state.workPermitStatus ?? 'NOT_STARTED',
    )
  ) {
    issues.push({
      path: 'workPermitDecisionDate',
      message: 'A decision date needs the work permit status Approved or Refused',
    });
  }
  if (
    state.visaDecisionDate &&
    !(DECIDED_VISA_STATUSES as readonly string[]).includes(state.visaStatus ?? 'NOT_STARTED')
  ) {
    issues.push({
      path: 'visaDecisionDate',
      message: 'A decision date needs the visa status Approved or Refused',
    });
  }
  if (state.dhlTrackingNumber && !state.dhlSentDate) {
    issues.push({
      path: 'dhlTrackingNumber',
      message: 'A tracking number needs the date it was sent',
    });
  }
  return issues;
}

const withApplicationRules = <T extends z.ZodType<ApplicationState>>(schema: T) =>
  schema.superRefine((body, context) => {
    for (const issue of partnerApplicationIssues(body)) {
      context.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }
  });

export const createPartnerApplicationSchema = withApplicationRules(
  partnerApplicationFields
    .extend({
      /** The job demand, in the same space. */
      jobId: z.uuid(),
      workPermitStatus: partnerWorkPermitStatusSchema.default('NOT_STARTED'),
      visaStatus: partnerVisaStatusSchema.default('NOT_STARTED'),
    })
    .partial({
      workPermitSubmittedDate: true,
      workPermitDecisionDate: true,
      phone: true,
      email: true,
      visaAppointmentDate: true,
      visaDecisionDate: true,
      dhlSentDate: true,
      dhlTrackingNumber: true,
      documentsReceivedDate: true,
    }),
);
export type CreatePartnerApplicationInput = z.infer<typeof createPartnerApplicationSchema>;

export const updatePartnerApplicationSchema = partnerApplicationFields
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdatePartnerApplicationInput = z.infer<typeof updatePartnerApplicationSchema>;

export const listPartnerApplicationsQuerySchema = z.object({
  jobId: z.uuid().optional(),
  visaStatus: partnerVisaStatusSchema.optional(),
  workPermitStatus: partnerWorkPermitStatusSchema.optional(),
  /** Part of a first or last name. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListPartnerApplicationsQuery = z.infer<typeof listPartnerApplicationsQuerySchema>;

// ---------------------------------------------------------------------------
// Files (ADR-027, section 5)
// ---------------------------------------------------------------------------

/** Formats accepted for each file, detected from the content: the rules of candidate documents. */
export const PARTNER_FILE_FORMATS: Record<
  z.infer<typeof partnerFileKindSchema>,
  readonly DocumentFormat[]
> = {
  PASSPORT: ['pdf', 'jpg', 'png'],
  CV: ['pdf', 'docx'],
  WORK_PERMIT: ['pdf', 'jpg', 'png'],
};

export const partnerFileUploadParamsSchema = z.object({
  spaceId: z.uuid(),
  applicationId: z.uuid(),
  kind: partnerFileKindSchema,
});
export const partnerFileParamsSchema = z.object({ spaceId: z.uuid(), fileId: z.uuid() });

export const partnerFileSchema = z.object({
  id: z.uuid(),
  kind: partnerFileKindSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.iso.datetime(),
});
export type PartnerFile = z.infer<typeof partnerFileSchema>;

/** A 5-minute read-only link to one file. */
export const partnerFileLinkSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
export type PartnerFileLink = z.infer<typeof partnerFileLinkSchema>;

export const partnerApplicationSchema = partnerApplicationFields.extend({
  nationality: z.string(),
  id: z.uuid(),
  jobId: z.uuid(),
  jobRole: z.string(),
  /** The current file of each kind, or null. */
  files: z.object({
    PASSPORT: partnerFileSchema.nullable(),
    CV: partnerFileSchema.nullable(),
    WORK_PERMIT: partnerFileSchema.nullable(),
  }),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PartnerApplication = z.infer<typeof partnerApplicationSchema>;

/** Deleting one application (super admin and member): the applicant's first and last name. */
export const deletePartnerApplicationSchema = z.object({
  confirmName: z.string().trim().min(1).max(201),
});
export type DeletePartnerApplicationInput = z.infer<typeof deletePartnerApplicationSchema>;

export const createPartnerCommentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export type CreatePartnerCommentInput = z.infer<typeof createPartnerCommentSchema>;

export const partnerCommentSchema = z.object({
  id: z.uuid(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type PartnerComment = z.infer<typeof partnerCommentSchema>;

export const PARTNER_HISTORY_ENTITY_TYPES = [
  'space',
  'member',
  'login',
  'job',
  'application',
  'file',
  'comment',
] as const;

export const listPartnerHistoryQuerySchema = z.object({
  entityType: z.enum(PARTNER_HISTORY_ENTITY_TYPES).optional(),
  entityId: z.uuid().optional(),
  /** Entries about one application, whatever their entity (files, comments). */
  applicationId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListPartnerHistoryQuery = z.infer<typeof listPartnerHistoryQuerySchema>;

export const partnerHistoryEntrySchema = z.object({
  id: z.uuid(),
  actorName: z.string(),
  entityType: z.enum(PARTNER_HISTORY_ENTITY_TYPES),
  entityId: z.uuid(),
  action: z.string(),
  field: z.string().nullable(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PartnerHistoryEntry = z.infer<typeof partnerHistoryEntrySchema>;

export const partnerHistoryPageSchema = z.object({
  items: z.array(partnerHistoryEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
