import { describe, expect, it } from 'vitest';
import { USER_ROLES, type UserRole } from './enums.js';
import { hasPermission, PERMISSIONS, type Permission } from './permissions.js';

// Rows of the privileges table in docs/SPEC.md, in the column order
// Candidate, Viewer, Recruiter, Super admin.
const SPEC_TABLE: Record<Permission, [boolean, boolean, boolean, boolean]> = {
  MANAGE_OWN_PROFILE: [true, false, false, false],
  APPLY_TO_JOBS: [true, false, false, false],
  MANAGE_OWN_DATA: [true, false, false, false],
  VIEW_CANDIDATES: [false, true, true, true],
  MANAGE_JOBS: [false, false, true, true],
  MANAGE_APPLICATIONS: [false, false, true, true],
  MANAGE_CONTENT: [false, false, true, true],
  EXPORT_APPLICATIONS: [false, false, true, true],
  MANAGE_ADMIN_USERS: [false, false, false, true],
  MANAGE_SETTINGS: [false, false, false, true],
};

const COLUMNS: UserRole[] = ['CANDIDATE', 'VIEWER', 'RECRUITER', 'SUPER_ADMIN'];

describe('PERMISSIONS', () => {
  it('covers every row of the specification and nothing else', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
    expect(COLUMNS).toEqual([...USER_ROLES]);
  });

  it.each(Object.entries(SPEC_TABLE) as [Permission, boolean[]][])(
    '%s matches the specification',
    (permission, expected) => {
      expect(COLUMNS.map((role) => hasPermission(role, permission))).toEqual(expected);
    },
  );

  it('gives the viewer exactly one capability, and it is a read', () => {
    const viewer = (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
      hasPermission('VIEWER', p),
    );
    expect(viewer).toEqual(['VIEW_CANDIDATES']);
  });

  it('gives a candidate no back-office capability', () => {
    const backOffice: Permission[] = [
      'VIEW_CANDIDATES',
      'MANAGE_JOBS',
      'MANAGE_APPLICATIONS',
      'MANAGE_CONTENT',
      'EXPORT_APPLICATIONS',
      'MANAGE_ADMIN_USERS',
      'MANAGE_SETTINGS',
    ];
    expect(backOffice.some((p) => hasPermission('CANDIDATE', p))).toBe(false);
  });
});
