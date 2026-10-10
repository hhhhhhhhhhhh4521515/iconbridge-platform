import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  applySchema,
  candidateApplicationSchema,
  eligibilitySchema,
  PERMISSIONS,
  uuidParamSchema,
  type ApplyInput,
  type CandidateApplication,
  type Eligibility,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Owned, RequireVerifiedEmail, Roles } from '../auth/decorators/index.js';
import { OwnershipGuard } from '../auth/guards/ownership.guard.js';
import { ZodBody, ZodParams } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { ApplicationsService } from './applications.service.js';

interface IdParam {
  id: string;
}

@ApiTags('candidate: applications')
@ApiCookieAuth()
@Roles(...PERMISSIONS.APPLY_TO_JOBS)
@Controller()
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get('jobs/:id/eligibility')
  @ApiOperation({
    summary: 'Can I apply to this job?',
    description:
      'Lists every reason that blocks the candidate now, and `nextAllowedAt` when the 6-month rule applies. ' +
      'The job page uses it to show "Apply" or "You applied on ... you can apply again from ...".',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Job id' })
  @ApiZodResponse(200, eligibilitySchema)
  @ApiErrors(401, 403, 404)
  eligibility(
    @CurrentUser() user: AuthUser,
    @ZodParams(uuidParamSchema) params: IdParam,
  ): Promise<Eligibility> {
    return this.applications.eligibility(user, params.id);
  }

  @Post('jobs/:id/apply')
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Apply to a job',
    description:
      'Needs a verified email, a profile complete enough (CV and passport scan included), a valid passport, ' +
      'an open job and fewer active applications than the limit. A candidate can apply to the same job ' +
      'once every 6 calendar months, whatever became of the previous application: otherwise ' +
      '`409 REAPPLY_COOLDOWN` with `nextAllowedAt`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Job id' })
  @ApiZodBody(applySchema)
  @ApiZodResponse(201, candidateApplicationSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  apply(
    @CurrentUser() user: AuthUser,
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(applySchema) body: ApplyInput,
    @Req() request: Request,
  ): Promise<CandidateApplication> {
    return this.applications.apply(user, params.id, body, requestMeta(request).ip);
  }

  @Get('me/applications')
  @ApiOperation({
    summary: 'My applications with their status history',
    description: 'Internal notes and recruiter comments are never included.',
  })
  @ApiZodResponse(200, z.array(candidateApplicationSchema))
  @ApiErrors(401, 403)
  list(@CurrentUser() user: AuthUser): Promise<CandidateApplication[]> {
    return this.applications.listOwn(user.id);
  }

  @Post('me/applications/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @Owned('application')
  @ApiOperation({ summary: 'Withdraw an application (possible until the contract is signed)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, candidateApplicationSchema)
  @ApiErrors(401, 403, 404, 409)
  withdraw(
    @CurrentUser() user: AuthUser,
    @ZodParams(uuidParamSchema) params: IdParam,
  ): Promise<CandidateApplication> {
    return this.applications.withdrawOwn(user, params.id);
  }
}
