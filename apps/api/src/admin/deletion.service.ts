import { Injectable } from '@nestjs/common';
import {
  canDeleteRecords,
  type BulkDeleteInput,
  type BulkResult,
  type CandidateDeletion,
} from '@iconbridge/shared';
import { AccountService } from '../account/account.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { AppException, forbidden, notFound } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from './audit/audit.service.js';

/**
 * Deleting a candidate or an application from the back office. A super admin
 * always may; a recruiter only when the setting ALLOW_RECRUITER_DELETE is on.
 * Each deletion needs a reason and leaves an audit entry holding who, when, why
 * and counts, never a name, an address or any other personal data.
 */
@Injectable()
export class DeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly account: AccountService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  async mayDelete(user: AuthUser): Promise<boolean> {
    return canDeleteRecords(user.role, await this.settings.get('ALLOW_RECRUITER_DELETE'));
  }

  private async assertMayDelete(user: AuthUser): Promise<void> {
    if (!(await this.mayDelete(user))) {
      throw forbidden('Your role cannot delete candidates or applications');
    }
  }

  /**
   * Same erasure as when a candidate deletes their own account: the files leave the
   * storage first, then everything personal is removed or overwritten. Their
   * applications stay as anonymous rows, so counts and hired positions do not move.
   */
  async deleteCandidate(
    profileId: string,
    reason: string,
    user: AuthUser,
    ip: string | null,
  ): Promise<CandidateDeletion> {
    await this.assertMayDelete(user);
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: profileId, user: { role: 'CANDIDATE', deletedAt: null } },
      select: { userId: true },
    });
    if (!profile) {
      throw notFound('Candidate not found');
    }
    const erased = await this.account.eraseCandidate(profile.userId);
    await this.audit.record({
      actorId: user.id,
      action: 'candidate.delete',
      entityType: 'candidate',
      entityId: profileId,
      before: { documents: erased.documents, applications: erased.applications },
      after: { reason, deletedBy: user.role },
      ip,
    });
    // The number of registered candidates on the home page has changed.
    this.catalog.clearStatsCache();
    return { id: profileId, documents: erased.documents, applications: erased.applications };
  }

  /**
   * Removes the application with its status history and its internal notes. The
   * candidate keeps their documents. A position taken by a deployed candidate stays
   * taken, and the candidate may apply to the job again at once: the waiting period
   * is counted from applications that exist.
   */
  async deleteApplication(
    id: string,
    reason: string,
    user: AuthUser,
    ip: string | null,
  ): Promise<void> {
    await this.assertMayDelete(user);
    await this.prisma.$transaction(async (tx) => {
      const application = await tx.application.findUnique({
        where: { id },
        select: {
          status: true,
          jobId: true,
          _count: { select: { notes: true, statusHistory: true, documents: true } },
        },
      });
      if (!application) {
        throw notFound('Application not found');
      }
      await tx.application.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'application.delete',
          entityType: 'application',
          entityId: id,
          before: {
            status: application.status,
            jobId: application.jobId,
            notes: application._count.notes,
            statusChanges: application._count.statusHistory,
            documentsAttached: application._count.documents,
          },
          after: { reason, deletedBy: user.role },
          ip,
        },
        tx,
      );
    });
    this.catalog.clearStatsCache();
  }

  /** Each record on its own: one that cannot be deleted does not stop the others. */
  async bulk(
    input: BulkDeleteInput,
    remove: (id: string) => Promise<unknown>,
    user: AuthUser,
  ): Promise<BulkResult> {
    await this.assertMayDelete(user);
    const results: BulkResult['results'] = [];
    for (const id of input.ids) {
      try {
        await remove(id);
        results.push({ id, ok: true });
      } catch (error) {
        if (!(error instanceof AppException)) {
          throw error;
        }
        results.push({ id, ok: false, code: error.code, message: error.message });
      }
    }
    const changed = results.filter((result) => result.ok).length;
    return { changed, failed: results.length - changed, results };
  }
}
