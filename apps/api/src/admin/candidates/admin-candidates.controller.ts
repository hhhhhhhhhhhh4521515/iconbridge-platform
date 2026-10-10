import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminCandidateListQuerySchema,
  adminCandidateSummarySchema,
  PERMISSIONS,
  uuidParamSchema,
  type AdminCandidateListQuery,
  type AdminCandidateSummary,
  type Paginated,
} from '@iconbridge/shared';
import { z } from 'zod';
import type { AuthUser } from '../../auth/auth.types.js';
import { CurrentUser, Roles } from '../../auth/decorators/index.js';
import { ZodParams, ZodQuery } from '../../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodResponse } from '../../common/swagger/zod-openapi.js';
import { Audit } from '../audit/audit.decorator.js';
import { AdminCandidatesService, type AdminCandidateDetail } from './admin-candidates.service.js';

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
  constructor(private readonly candidates: AdminCandidatesService) {}

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

  @Get(':id')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  @Audit({ action: 'candidate.view', entityType: 'candidate', idParam: 'id' })
  @ApiOperation({
    summary: 'One candidate: profile, documents and all applications',
    description: 'Shows the full passport number, so each view is written to the audit log.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Candidate profile id' })
  @ApiErrors(401, 403, 404)
  get(
    @ZodParams(uuidParamSchema) params: IdParam,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminCandidateDetail> {
    return this.candidates.get(params.id, user);
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
