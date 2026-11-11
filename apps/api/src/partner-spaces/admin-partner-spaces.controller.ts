import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  addPartnerStaffMemberSchema,
  createPartnerLoginSchema,
  createPartnerSpaceSchema,
  deletePartnerSpaceSchema,
  partnerLoginSchema,
  partnerSpaceMemberParamsSchema,
  partnerSpaceParamsSchema,
  partnerSpaceSchema,
  partnerStaffMemberSchema,
  PERMISSIONS,
  setAdminPasswordSchema,
  updatePartnerLoginSchema,
  updatePartnerSpaceSchema,
  type AddPartnerStaffMemberInput,
  type CreatePartnerLoginInput,
  type CreatePartnerSpaceInput,
  type DeletePartnerSpaceInput,
  type PartnerLogin,
  type PartnerSpace,
  type PartnerStaffMember,
  type SetAdminPasswordInput,
  type UpdatePartnerLoginInput,
  type UpdatePartnerSpaceInput,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { Audit, SkipAudit } from '../admin/audit/audit.decorator.js';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { ZodBody, ZodParams } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { AdminPartnerSpacesService } from './admin-partner-spaces.service.js';

interface SpaceParams {
  spaceId: string;
}
interface MemberParams extends SpaceParams {
  userId: string;
}

/**
 * Partner spaces in the back office (ADR-027), for super admins. They manage the spaces,
 * the staff members and the partner logins; the content of a space is reached only through
 * the partner area, by its members.
 */
@ApiTags('admin: partner spaces')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_PARTNER_SPACES)
@Controller('admin/partner-spaces')
export class AdminPartnerSpacesController {
  constructor(private readonly spaces: AdminPartnerSpacesService) {}

  @Get()
  @ApiOperation({ summary: 'List the partner spaces, with counts and no content (super admin)' })
  @ApiZodResponse(200, z.array(partnerSpaceSchema))
  @ApiErrors(401, 403)
  list(@CurrentUser() user: AuthUser): Promise<PartnerSpace[]> {
    return this.spaces.list(user);
  }

  @Post()
  @Audit({ action: 'partner_space.create', entityType: 'partner_space' })
  @ApiOperation({ summary: 'Create a partner space' })
  @ApiZodBody(createPartnerSpaceSchema)
  @ApiZodResponse(201, partnerSpaceSchema)
  @ApiErrors(400, 401, 403, 409)
  create(
    @ZodBody(createPartnerSpaceSchema) body: CreatePartnerSpaceInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerSpace> {
    return this.spaces.create(body, user);
  }

  @Get(':spaceId')
  @ApiOperation({ summary: 'One partner space: settings and counts, no content' })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodResponse(200, partnerSpaceSchema)
  @ApiErrors(401, 403, 404)
  get(
    @ZodParams(partnerSpaceParamsSchema) params: SpaceParams,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerSpace> {
    return this.spaces.get(params.spaceId, user);
  }

  @Patch(':spaceId')
  @Audit({ action: 'partner_space.update', entityType: 'partner_space', idParam: 'spaceId' })
  @ApiOperation({
    summary: 'Rename a partner space, change its country or language, disable or enable it',
    description:
      'Disabling cuts the access of every member at their next request. The partner logins follow ' +
      'the default language for their emails.',
  })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodBody(updatePartnerSpaceSchema)
  @ApiZodResponse(200, partnerSpaceSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @ZodParams(partnerSpaceParamsSchema) params: SpaceParams,
    @ZodBody(updatePartnerSpaceSchema) body: UpdatePartnerSpaceInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerSpace> {
    return this.spaces.update(params.spaceId, body, user);
  }

  @Delete(':spaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipAudit()
  @ApiOperation({
    summary: 'Delete a partner space and everything in it',
    description:
      '`confirmName` must be the name of the space. The files are deleted first, then every row of the ' +
      'space, then its partner logins and their sessions. The audit entry holds the counts, never names.',
  })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodBody(deletePartnerSpaceSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 401, 403, 404, 409)
  async remove(
    @ZodParams(partnerSpaceParamsSchema) params: SpaceParams,
    @ZodBody(deletePartnerSpaceSchema) body: DeletePartnerSpaceInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.spaces.remove(params.spaceId, body.confirmName, user, requestMeta(request).ip);
  }

  @Get(':spaceId/members')
  @ApiOperation({ summary: 'The staff members of a partner space' })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodResponse(200, z.array(partnerStaffMemberSchema))
  @ApiErrors(401, 403, 404)
  members(@ZodParams(partnerSpaceParamsSchema) params: SpaceParams): Promise<PartnerStaffMember[]> {
    return this.spaces.listStaff(params.spaceId);
  }

  @Post(':spaceId/members')
  @Audit({ action: 'partner_space.add_member', entityType: 'partner_space', idParam: 'spaceId' })
  @ApiOperation({
    summary: 'Add a back-office account as a member',
    description:
      'Any active back-office role, with full rights inside the space. A super admin adds themselves ' +
      'to see the content; the addition is in the space history.',
  })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodBody(addPartnerStaffMemberSchema)
  @ApiZodResponse(201, z.array(partnerStaffMemberSchema))
  @ApiErrors(400, 401, 403, 404)
  addMember(
    @ZodParams(partnerSpaceParamsSchema) params: SpaceParams,
    @ZodBody(addPartnerStaffMemberSchema) body: AddPartnerStaffMemberInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerStaffMember[]> {
    return this.spaces.addStaff(params.spaceId, body, user);
  }

  @Delete(':spaceId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'partner_space.remove_member', entityType: 'partner_space', idParam: 'spaceId' })
  @ApiOperation({ summary: 'Remove a staff member; the space answers 404 to them at once' })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404)
  async removeMember(
    @ZodParams(partnerSpaceMemberParamsSchema) params: MemberParams,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.spaces.removeStaff(params.spaceId, params.userId, user);
  }

  @Get(':spaceId/logins')
  @ApiOperation({ summary: 'The partner logins of a space' })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodResponse(200, z.array(partnerLoginSchema))
  @ApiErrors(401, 403, 404)
  logins(@ZodParams(partnerSpaceParamsSchema) params: SpaceParams): Promise<PartnerLogin[]> {
    return this.spaces.listLogins(params.spaceId);
  }

  @Post(':spaceId/logins')
  @Audit({ action: 'partner_login.create', entityType: 'user' })
  @ApiOperation({
    summary: 'Create a login of the partner company',
    description:
      'The password is set now (same strength rules as every password) and must be changed at the ' +
      'first sign-in. It is never returned, logged or audited. The login belongs to this space only.',
  })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiZodBody(createPartnerLoginSchema)
  @ApiZodResponse(201, partnerLoginSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  createLogin(
    @ZodParams(partnerSpaceParamsSchema) params: SpaceParams,
    @ZodBody(createPartnerLoginSchema) body: CreatePartnerLoginInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerLogin> {
    return this.spaces.createLogin(params.spaceId, body, user);
  }

  @Patch(':spaceId/logins/:userId')
  @Audit({ action: 'partner_login.update', entityType: 'user', idParam: 'userId' })
  @ApiOperation({
    summary: 'Rename, disable or enable a partner login',
    description:
      'Disabling ends every session at once: the next request with an old token answers 401.',
  })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiZodBody(updatePartnerLoginSchema)
  @ApiZodResponse(200, partnerLoginSchema)
  @ApiErrors(400, 401, 403, 404)
  updateLogin(
    @ZodParams(partnerSpaceMemberParamsSchema) params: MemberParams,
    @ZodBody(updatePartnerLoginSchema) body: UpdatePartnerLoginInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerLogin> {
    return this.spaces.updateLogin(params.spaceId, params.userId, body, user);
  }

  @Post(':spaceId/logins/:userId/password')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'partner_login.set_password', entityType: 'user', idParam: 'userId' })
  @ApiOperation({
    summary: 'Set a new password for a partner login',
    description:
      'Every session ends and the person must choose a new password at the next sign-in. The audit ' +
      'entry and the space history record the fact, never the password.',
  })
  @ApiParam({ name: 'spaceId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiZodBody(setAdminPasswordSchema)
  @ApiZodResponse(200, partnerLoginSchema)
  @ApiErrors(400, 401, 403, 404)
  setLoginPassword(
    @ZodParams(partnerSpaceMemberParamsSchema) params: MemberParams,
    @ZodBody(setAdminPasswordSchema) body: SetAdminPasswordInput,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerLogin> {
    return this.spaces.setLoginPassword(params.spaceId, params.userId, body.password, user);
  }
}
