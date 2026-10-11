import { z } from 'zod';
import { phoneSchema } from './auth.js';
import { countryCodeSchema } from './countries.js';
import {
  applicationStatusSchema,
  documentTypeSchema,
  educationLevelSchema,
  genderSchema,
  languageLevelSchema,
  type ApplicationStatus,
  type DocumentType,
} from './enums.js';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const MINIMUM_AGE = 18;
/** A passport that expires within this many months gets a warning (it does not block). */
export const PASSPORT_WARNING_MONTHS = 6;

const calendarDate = z.iso.date();

/** Today's date in UTC, as YYYY-MM-DD. Calendar dates are compared as strings. */
export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds whole years to a calendar date; 29 February becomes 28 February in a common year. */
function addYears(date: string, years: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year + years, month - 1, day));
  if (target.getUTCMonth() !== month - 1) {
    target.setUTCDate(0);
  }
  return utcDateString(target);
}

/** True when the person born on `dateOfBirth` is at least `age` years old on `today`. */
export function isAtLeast(age: number, dateOfBirth: string, today: string): boolean {
  return addYears(dateOfBirth, age) <= today;
}

/** A passport is usable up to and including its expiry date. */
export function isPassportExpired(expiryDate: string, today: string): boolean {
  return expiryDate < today;
}

export function isPassportExpiringSoon(expiryDate: string, today: Date): boolean {
  const limit = new Date(today);
  limit.setUTCMonth(limit.getUTCMonth() + PASSPORT_WARNING_MONTHS);
  return !isPassportExpired(expiryDate, utcDateString(today)) && expiryDate < utcDateString(limit);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

export const candidateLanguageSchema = z.object({
  /** ISO 639-1 code: en, fr, ar, it, pl, de... */
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, 'Use a two-letter ISO 639-1 language code'),
  level: languageLevelSchema,
});
export type CandidateLanguage = z.infer<typeof candidateLanguageSchema>;

/** Letters, digits; spaces are removed and letters upper-cased before storage. */
export const passportNumberSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{5,20}$/, 'Use 5 to 20 letters and digits'));

const profileFields = z.object({
  // Identity
  firstName: text(100),
  lastName: text(100),
  gender: nullable(genderSchema),
  /** YYYY-MM-DD. The candidate must be 18 or older. */
  dateOfBirth: nullable(calendarDate),
  nationality: nullable(countryCodeSchema),
  countryOfResidence: nullable(countryCodeSchema),
  city: nullable(text(100)),
  phone: nullable(phoneSchema),
  whatsapp: nullable(phoneSchema),

  // Passport
  passportNumber: nullable(passportNumberSchema),
  passportIssuingCountry: nullable(countryCodeSchema),
  passportIssueDate: nullable(calendarDate),
  /** Must be in the future when the profile is saved. */
  passportExpiryDate: nullable(calendarDate),

  // Experience and education
  currentProfession: nullable(text(150)),
  yearsOfExperience: nullable(z.number().int().min(0).max(70)),
  educationLevel: nullable(educationLevelSchema),
  languages: z
    .array(candidateLanguageSchema)
    .max(15)
    .refine((languages) => new Set(languages.map((l) => l.language)).size === languages.length, {
      message: 'Each language may appear once',
    }),
  /** Licence categories such as B, C, CE. */
  drivingLicenceCategories: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{1,4}$/),
    )
    .max(15),

  /**
   * Destination codes the candidate is interested in (MALTA, POLAND, CRUISE_SHIP...).
   * Used to recommend jobs; CRUISE_SHIP also shows the cruise-ship questions.
   */
  preferredDestinations: z
    .array(z.string().trim().toUpperCase().min(1).max(40))
    .max(10)
    .default([]),

  // Cruise-ship extras
  hasStcwTraining: z.boolean(),
  hasSeamanBook: z.boolean(),
  hasMedicalCertificate: z.boolean(),
  seaExperience: nullable(text(2000)),
});

/**
 * Body of PUT /me/profile: the whole profile, every field present (null = not provided).
 * `now` is injectable because three rules depend on today's date.
 */
export function makeCandidateProfileSchema(now: () => Date = () => new Date()) {
  return profileFields.superRefine((profile, context) => {
    const today = utcDateString(now());
    const issue = (path: keyof typeof profile, message: string) => {
      context.addIssue({ code: 'custom', path: [path], message });
    };

    if (profile.dateOfBirth) {
      if (profile.dateOfBirth > today) {
        issue('dateOfBirth', 'The date of birth cannot be in the future');
      } else if (!isAtLeast(MINIMUM_AGE, profile.dateOfBirth, today)) {
        issue('dateOfBirth', `You must be at least ${MINIMUM_AGE} years old`);
      }
    }

    const passport = [
      profile.passportNumber,
      profile.passportIssuingCountry,
      profile.passportIssueDate,
      profile.passportExpiryDate,
    ];
    if (passport.some((value) => value !== null) && passport.some((value) => value === null)) {
      issue('passportNumber', 'Fill in every passport field, or none');
    }
    if (profile.passportExpiryDate && profile.passportExpiryDate <= today) {
      issue('passportExpiryDate', 'The passport must not be expired');
    }
    if (profile.passportIssueDate && profile.passportIssueDate > today) {
      issue('passportIssueDate', 'The issue date cannot be in the future');
    }
    if (
      profile.passportIssueDate &&
      profile.passportExpiryDate &&
      profile.passportIssueDate >= profile.passportExpiryDate
    ) {
      issue('passportExpiryDate', 'The expiry date must be after the issue date');
    }
  });
}

export const candidateProfileSchema = makeCandidateProfileSchema();

/** The fields of the profile, without the rules that span several fields. For building forms. */
export const candidateProfileFields = profileFields;

/** Steps of the profile wizard and the fields each one edits. */
export const PROFILE_STEPS = {
  identity: [
    'firstName',
    'lastName',
    'gender',
    'dateOfBirth',
    'nationality',
    'countryOfResidence',
    'city',
    'phone',
    'whatsapp',
    'preferredDestinations',
  ],
  passport: ['passportNumber', 'passportIssuingCountry', 'passportIssueDate', 'passportExpiryDate'],
  experience: ['currentProfession', 'yearsOfExperience', 'educationLevel'],
  languages: ['languages'],
  licence: ['drivingLicenceCategories'],
  cruise: ['hasStcwTraining', 'hasSeamanBook', 'hasMedicalCertificate', 'seaExperience'],
} as const satisfies Record<string, readonly (keyof typeof profileFields.shape)[]>;
export type ProfileStep = keyof typeof PROFILE_STEPS;

export const CRUISE_DESTINATION = 'CRUISE_SHIP';
export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

/** Items counted in the completeness percentage. */
export const PROFILE_ITEMS = [
  'gender',
  'dateOfBirth',
  'nationality',
  'countryOfResidence',
  'city',
  'phone',
  'passportNumber',
  'passportIssuingCountry',
  'passportIssueDate',
  'passportExpiryDate',
  'currentProfession',
  'yearsOfExperience',
  'educationLevel',
  'languages',
  'cvDocument',
  'passportDocument',
] as const;
export type ProfileItem = (typeof PROFILE_ITEMS)[number];

/** The subset without which a candidate cannot apply. */
export const REQUIRED_TO_APPLY = [
  'dateOfBirth',
  'nationality',
  'countryOfResidence',
  'phone',
  'passportNumber',
  'passportIssuingCountry',
  'passportIssueDate',
  'passportExpiryDate',
  'cvDocument',
  'passportDocument',
] as const satisfies readonly ProfileItem[];

export interface CompletenessInput {
  gender: unknown;
  dateOfBirth: unknown;
  nationality: unknown;
  countryOfResidence: unknown;
  city: unknown;
  phone: unknown;
  /** Clear or masked: only its presence matters. */
  passportNumber: unknown;
  passportIssuingCountry: unknown;
  passportIssueDate: unknown;
  passportExpiryDate: unknown;
  currentProfession: unknown;
  yearsOfExperience: unknown;
  educationLevel: unknown;
  languages: readonly unknown[];
  /** Types of the candidate's documents that are not deleted. */
  documentTypes: readonly DocumentType[];
}

export interface ProfileCompleteness {
  /** 0 to 100. */
  percentage: number;
  missing: ProfileItem[];
  /** Missing items that block applying. Empty when the candidate may apply. */
  missingToApply: ProfileItem[];
}

export function profileCompleteness(input: CompletenessInput): ProfileCompleteness {
  const filled = (value: unknown) => value !== null && value !== undefined && value !== '';
  const present: Record<ProfileItem, boolean> = {
    gender: filled(input.gender),
    dateOfBirth: filled(input.dateOfBirth),
    nationality: filled(input.nationality),
    countryOfResidence: filled(input.countryOfResidence),
    city: filled(input.city),
    phone: filled(input.phone),
    passportNumber: filled(input.passportNumber),
    passportIssuingCountry: filled(input.passportIssuingCountry),
    passportIssueDate: filled(input.passportIssueDate),
    passportExpiryDate: filled(input.passportExpiryDate),
    currentProfession: filled(input.currentProfession),
    yearsOfExperience: filled(input.yearsOfExperience),
    educationLevel: filled(input.educationLevel),
    languages: input.languages.length > 0,
    cvDocument: input.documentTypes.includes('CV'),
    passportDocument: input.documentTypes.includes('PASSPORT'),
  };
  const missing = PROFILE_ITEMS.filter((item) => !present[item]);
  const required: readonly ProfileItem[] = REQUIRED_TO_APPLY;
  return {
    percentage: Math.round(((PROFILE_ITEMS.length - missing.length) / PROFILE_ITEMS.length) * 100),
    missing,
    missingToApply: missing.filter((item) => required.includes(item)),
  };
}

export const profileCompletenessSchema = z.object({
  percentage: z.number().int().min(0).max(100),
  missing: z.array(z.enum(PROFILE_ITEMS)),
  missingToApply: z.array(z.enum(PROFILE_ITEMS)),
});

/** Body of GET and PUT /me/profile. */
export const candidateProfileResponseSchema = z.object({
  id: z.uuid(),
  ...profileFields.shape,
  /** Clear number for the owner and for back-office users; null for anybody else. */
  passportNumber: z.string().nullable(),
  /** Always safe to display, e.g. "******567". */
  passportNumberMasked: z.string().nullable(),
  /** True when the passport expires within 6 months. */
  passportExpiringSoon: z.boolean(),
  preferredDestinations: z.array(z.string()),
  gdprConsentAt: z.iso.datetime().nullable(),
  profileCompleteness: profileCompletenessSchema,
});
export type CandidateProfileResponse = z.infer<typeof candidateProfileResponseSchema>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
} as const;
export type DocumentFormat = keyof typeof DOCUMENT_MIME_TYPES;

const SCANS: readonly DocumentFormat[] = ['pdf', 'jpg', 'png'];

/** Formats accepted for each document type. The API checks the content, not the file name. */
export const DOCUMENT_FORMATS: Record<DocumentType, readonly DocumentFormat[]> = {
  CV: ['pdf', 'docx'],
  PASSPORT: SCANS,
  PHOTO: ['jpg', 'png'],
  DIPLOMA: SCANS,
  CERTIFICATE: SCANS,
  STCW: SCANS,
  SEAMAN_BOOK: SCANS,
  MEDICAL: SCANS,
  OTHER: SCANS,
};

/** Documents a candidate may keep at the same time. */
export const MAX_DOCUMENTS_PER_CANDIDATE = 30;

/** The `type` form field of POST /me/documents. */
export const uploadDocumentSchema = z.object({ type: documentTypeSchema });
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const candidateDocumentSchema = z.object({
  id: z.uuid(),
  type: documentTypeSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  uploadedAt: z.iso.datetime(),
});
export type CandidateDocument = z.infer<typeof candidateDocumentSchema>;

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/** A candidate may withdraw until the contract is signed. */
export const WITHDRAWABLE_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
] as const satisfies readonly ApplicationStatus[];

/** Applications still in progress; they count towards MAX_ACTIVE_APPLICATIONS. */
export const ACTIVE_APPLICATION_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
  'CONTRACT_SIGNED',
  'VISA_PROCESSING',
  'VISA_APPROVED',
] as const satisfies readonly ApplicationStatus[];

export function canWithdrawApplication(status: ApplicationStatus): boolean {
  return (WITHDRAWABLE_STATUSES as readonly ApplicationStatus[]).includes(status);
}

export const applySchema = z.object({
  /** Documents sent with the application: the candidate's own, including a CV and a passport scan. */
  documentIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Each document may appear once',
    }),
  coverLetter: z.string().trim().min(1).max(5000).nullable().optional(),
  /** Answers to job-specific questions, keyed by question. */
  answers: z
    .record(z.string().min(1).max(100), z.string().max(2000))
    .refine((answers) => Object.keys(answers).length <= 20, { message: 'At most 20 answers' })
    .optional(),
  /** Cloudflare Turnstile response token. */
  turnstileToken: z.string().min(1).max(2048),
});
export type ApplyInput = z.infer<typeof applySchema>;

/** Why a candidate cannot apply to a job right now. */
export const INELIGIBILITY_REASONS = [
  'EMAIL_NOT_VERIFIED',
  'PROFILE_INCOMPLETE',
  'PASSPORT_EXPIRED',
  'JOB_NOT_OPEN',
  'REAPPLY_COOLDOWN',
  'MAX_ACTIVE_APPLICATIONS',
] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

/** Body of GET /jobs/:id/eligibility. */
export const eligibilitySchema = z.object({
  canApply: z.boolean(),
  reasons: z.array(z.enum(INELIGIBILITY_REASONS)),
  /** With REAPPLY_COOLDOWN: first moment the candidate may apply again. */
  nextAllowedAt: z.iso.datetime().nullable(),
  /** Date of the candidate's latest application to this job, whatever its status. */
  lastAppliedAt: z.iso.datetime().nullable(),
  /** With PROFILE_INCOMPLETE: what is missing. */
  missing: z.array(z.enum(PROFILE_ITEMS)),
  /** Does not block: the passport expires within 6 months. */
  passportExpiringSoon: z.boolean(),
});
export type Eligibility = z.infer<typeof eligibilitySchema>;

/** An application as its candidate sees it: no internal note, no recruiter comment, no author. */
export const candidateApplicationSchema = z.object({
  id: z.uuid(),
  status: applicationStatusSchema,
  appliedAt: z.iso.datetime(),
  withdrawnAt: z.iso.datetime().nullable(),
  canWithdraw: z.boolean(),
  coverLetter: z.string().nullable(),
  job: z.object({ id: z.uuid(), slug: z.string(), title: z.string(), destinationCode: z.string() }),
  documents: z.array(
    z.object({ id: z.uuid(), type: documentTypeSchema, originalName: z.string() }),
  ),
  history: z.array(
    z.object({
      fromStatus: applicationStatusSchema.nullable(),
      toStatus: applicationStatusSchema,
      at: z.iso.datetime(),
      /** Text the recruiter wrote for the candidate at this step, if any. */
      message: z.string().nullable(),
    }),
  ),
});
export type CandidateApplication = z.infer<typeof candidateApplicationSchema>;

/** Body of DELETE /me/account: the password confirms the irreversible deletion. */
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  /** Same rules as at registration: 10 characters at least, zxcvbn score 3 or more. */
  newPassword: z.string().min(10).max(128),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const accountSettingsSchema = z.object({
  /** Language of the emails sent to the user. */
  locale: z.enum(['en', 'fr', 'ar']),
});
export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;

/** A job alert created from the account: no confirmation email, the address is already verified. */
export const myJobAlertSchema = z.object({
  destinations: z.array(z.string().trim().toUpperCase().max(40)).max(20).default([]),
  categories: z.array(z.string().trim().toLowerCase().max(80)).max(20).default([]),
});
export type MyJobAlertInput = z.infer<typeof myJobAlertSchema>;

export const myJobAlertResponseSchema = z.object({
  id: z.uuid(),
  /** Destination codes; empty means every destination. */
  destinations: z.array(z.string()),
  /** Category slugs; empty means every category. */
  categories: z.array(z.string()),
  confirmed: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type MyJobAlert = z.infer<typeof myJobAlertResponseSchema>;

/** `?inline=true` asks for a link the browser displays (preview) instead of saving. */
export const downloadQuerySchema = z.object({
  inline: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type DownloadQuery = z.infer<typeof downloadQuerySchema>;

// ---------------------------------------------------------------------------
// Data retention
// ---------------------------------------------------------------------------

/** A candidate account without any activity for this many months is erased. */
export const RETENTION_MONTHS = 24;
/** The candidate is warned by email this many days before the erasure; signing in keeps the account. */
export const RETENTION_NOTICE_DAYS = 30;
