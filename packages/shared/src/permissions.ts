import type { UserRole } from './enums.js';

/**
 * Privileges table of docs/SPEC.md (section 2): which roles hold each capability.
 * Visitors (not signed in) only reach public routes and are not listed here.
 * The API uses these lists in `@Roles(...)`; the web app uses them to show or hide actions.
 */
export const PERMISSIONS = {
  /** Register, verify email, manage own profile and documents. */
  MANAGE_OWN_PROFILE: ['CANDIDATE'],
  /** Apply to a job, withdraw, track status. */
  APPLY_TO_JOBS: ['CANDIDATE'],
  /** Download / delete own data (GDPR). */
  MANAGE_OWN_DATA: ['CANDIDATE'],
  /** See candidates, applications, documents (read only for VIEWER). */
  VIEW_CANDIDATES: ['VIEWER', 'RECRUITER', 'SUPER_ADMIN'],
  /** Create / edit / publish / close / delete job offers. */
  MANAGE_JOBS: ['RECRUITER', 'SUPER_ADMIN'],
  /** Change application status, add internal notes. */
  MANAGE_APPLICATIONS: ['RECRUITER', 'SUPER_ADMIN'],
  /** Manage success stories, home slides, categories, destinations. */
  MANAGE_CONTENT: ['RECRUITER', 'SUPER_ADMIN'],
  /** Export applications to CSV / Excel. */
  EXPORT_APPLICATIONS: ['RECRUITER', 'SUPER_ADMIN'],
  /** Create / disable admin accounts, assign roles. */
  MANAGE_ADMIN_USERS: ['SUPER_ADMIN'],
  /** Global settings (cooldown period, upload limits), audit log. */
  MANAGE_SETTINGS: ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** VIEWER is read only: it never appears in a capability that writes. */
export const READ_ONLY_ROLES = ['VIEWER'] as const satisfies readonly UserRole[];

/**
 * Deleting a candidate or an application: a super admin always; a recruiter only
 * when the setting ALLOW_RECRUITER_DELETE is on; nobody else.
 */
export function canDeleteRecords(role: UserRole, allowRecruiterDelete: boolean): boolean {
  return role === 'SUPER_ADMIN' || (role === 'RECRUITER' && allowRecruiterDelete);
}
