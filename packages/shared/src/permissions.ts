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
  /**
   * See candidates, applications, status history, documents (read only for VIEWER; own
   * countries only for COUNTRY_AGENT, enforced by the API's candidate scope).
   */
  VIEW_CANDIDATES: ['VIEWER', 'COUNTRY_AGENT', 'RECRUITER', 'SUPER_ADMIN'],
  /** See the back-office lists that are not about candidates: jobs with drafts, contact messages. */
  VIEW_BACK_OFFICE: ['VIEWER', 'RECRUITER', 'SUPER_ADMIN'],
  /** Create / edit / publish / close / delete job offers. */
  MANAGE_JOBS: ['RECRUITER', 'SUPER_ADMIN'],
  /** Change application status (with a message to the candidate), add internal notes. Own countries for COUNTRY_AGENT. */
  MANAGE_APPLICATIONS: ['COUNTRY_AGENT', 'RECRUITER', 'SUPER_ADMIN'],
  /** Disable / enable a candidate account, reveal a full passport number; deleting also needs canDeleteRecords. */
  MANAGE_CANDIDATES: ['RECRUITER', 'SUPER_ADMIN'],
  /** Manage success stories, home slides, categories, destinations. */
  MANAGE_CONTENT: ['RECRUITER', 'SUPER_ADMIN'],
  /** Export applications to CSV / Excel. */
  EXPORT_APPLICATIONS: ['RECRUITER', 'SUPER_ADMIN'],
  /** Create / disable admin accounts, assign roles. */
  MANAGE_ADMIN_USERS: ['SUPER_ADMIN'],
  /** Global settings (cooldown period, upload limits), audit log. */
  MANAGE_SETTINGS: ['SUPER_ADMIN'],
  /** Lift the re-application waiting period of one finished application (reason, audited). */
  WAIVE_COOLDOWN: ['SUPER_ADMIN'],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** Roles limited to the candidates of their countries (ADR-024). */
export const COUNTRY_SCOPED_ROLES = ['COUNTRY_AGENT'] as const satisfies readonly UserRole[];

/** VIEWER is read only: it never appears in a capability that writes. */
export const READ_ONLY_ROLES = ['VIEWER'] as const satisfies readonly UserRole[];

/**
 * Deleting a candidate or an application: a super admin always; a recruiter only
 * when the setting ALLOW_RECRUITER_DELETE is on; nobody else.
 */
export function canDeleteRecords(role: UserRole, allowRecruiterDelete: boolean): boolean {
  return role === 'SUPER_ADMIN' || (role === 'RECRUITER' && allowRecruiterDelete);
}
