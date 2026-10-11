import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminCandidateDetailSchema,
  adminCandidateListQuerySchema,
  adminCandidateSummarySchema,
  bulkDeleteSchema,
  bulkResultSchema,
  candidateDeletionSchema,
  deleteRecordSchema,
  PERMISSIONS,
  revealedPassportSchema,
  uuidParamSchema,
  type AdminCandidateDetail,
  type AdminCandidateListQuery,
  type AdminCandidateSummary,
  type BulkDeleteInput,
  type BulkResult,
  type CandidateDeletion,
  type DeleteRecordInput,
  type Paginated,
  type RevealedPassport,
} from '@iconbridge/shared';
import { z } from 'zod';
import type { Request } from 'express';
import { requestMeta, type AuthUser } from '../../auth/auth.types.js';
import { CurrentUser, Roles } from '../../auth/decorators/index.js';
import { ZodBody, ZodParams, ZodQuery } from '../../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../../common/swagger/zod-openapi.js';
import { Audit, SkipAudit } from '../audit/audit.decorator.js';
import { DeletionService } from '../deletion.service.js';
import { AdminCandidatesService } from './admin-candidates.service.js';

interface IdParam {
  id: string;
}
const pageSchema = z.object({
  items: z.array(adminCandidateSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

@ApiTags('admin: candidates')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_APPLICATIONS)
@Controller('admin/candidates')
export class AdminCandidatesController {
  constructor(
    private readonly candidates: AdminCandidatesService,
    private readonly deletion: DeletionService,
  ) {}

  @Get()
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  @ApiOperation({ summary: 'Search candidates (passport numbers masked)' })
  @ApiQuery({ name: 'q', required: false, description: 'Part of the name or the email' })
  @ApiQuery({ name: 'nationality', required: false })
  @ApiQuery({ name: 'language', required: false })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiZodResponse(200, pageSchema)
  @ApiErrors(400, 401, 403)
  list(
    @ZodQuery(adminCandidateListQuerySchema) query: AdminCandidateListQuery,
  ): Promise<Paginated<AdminCandidateSummary>> {
    return this.candidates.list(query);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  @SkipAudit()
  @ApiOperation({
    summary: 'Delete several candidates',
    description:
      'Same rule and same erasure as deleting one. The answer says which ones were deleted; one audit entry each.',
  })
  @ApiZodBody(bulkDeleteSchema)
  @ApiZodResponse(200, bulkResultSchema)
  @ApiErrors(400, 401, 403)
  bulkDelete(
    @ZodBody(bulkDeleteSchema) body: BulkDeleteInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<BulkResult> {
    const { ip } = requestMeta(request);
    return this.deletion.bulk(
      body,
      (id) => this.deletion.deleteCandidate(id, body.reason, user, ip),
      user,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @SkipAudit()
  @ApiOperation({
    summary: 'Delete a candidate',
    description:
      'For a super admin, and for a recruiter when the setting ALLOW_RECRUITER_DELETE is on. The files are ' +
      'removed from storage, then the personal data is erased as for a GDPR request; the applications stay as ' +
      'anonymous rows. The audit entry holds who, when, the reason and the counts, no personal data.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Candidate profile id' })
  @ApiZodBody(deleteRecordSchema)
  @ApiZodResponse(200, candidateDeletionSchema)
  @ApiErrors(400, 401, 403, 404)
  remove(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(deleteRecordSchema) body: DeleteRecordInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<CandidateDeletion> {
    return this.deletion.deleteCandidate(params.id, body.reason, user, requestMeta(request).ip);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  @ApiOperation({
    summary: 'One candidate: profile, documents and all applications',
    description:
      'The passport number is masked for every role. Recruiters and super admins get the clear ' +
      'number through `POST /admin/candidates/{id}/reveal-passport`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Candidate profile id' })
  @ApiZodResponse(200, adminCandidateDetailSchema)
  @ApiErrors(401, 403, 404)
  get(
    @ZodParams(uuidParamSchema) params: IdParam,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminCandidateDetail> {
    return this.candidates.get(params.id, user);
  }

  @Post(':id/reveal-passport')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'candidate.reveal_passport', entityType: 'candidate', idParam: 'id' })
  @ApiOperation({
    summary: 'Show the full passport number of a candidate',
    description:
      'For recruiters and super admins only; a viewer always sees the masked number. Every call is written to the audit log.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Candidate profile id' })
  @ApiZodResponse(200, revealedPassportSchema)
  @ApiErrors(401, 403, 404)
  async revealPassport(@ZodParams(uuidParamSchema) params: IdParam): Promise<RevealedPassport> {
    return { passportNumber: await this.candidates.revealPassport(params.id) };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'candidate.disable', entityType: 'candidate', idParam: 'id' })
  @ApiOperation({ summary: 'Disable a candidate account and sign it out' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminCandidateSummarySchema)
  @ApiErrors(401, 403, 404)
  disable(@ZodParams(uuidParamSchema) params: IdParam): Promise<AdminCandidateSummary> {
    return this.candidates.setActive(params.id, false);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'candidate.enable', entityType: 'candidate', idParam: 'id' })
  @ApiOperation({ summary: 'Enable a disabled candidate account' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminCandidateSummarySchema)
  @ApiErrors(401, 403, 404)
  enable(@ZodParams(uuidParamSchema) params: IdParam): Promise<AdminCandidateSummary> {
    return this.candidates.setActive(params.id, true);
  }
}
