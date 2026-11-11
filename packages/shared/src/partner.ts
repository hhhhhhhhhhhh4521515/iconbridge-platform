import './zod-setup.js';
import { z } from 'zod';
import { adminRoleSchema, emailSchema, passwordSchema } from './auth.js';
import { countryCodeSchema } from './countries.js';
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
