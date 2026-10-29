import { Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  adminUserSchema,
  changeAdminRoleSchema,
  createAdminUserSchema,
  listAdminUsersQuerySchema,
  PERMISSIONS,
  setAdminPasswordSchema,
  uuidParamSchema,
  type AdminUser,
  type ChangeAdminRoleInput,
  type CreateAdminUserInput,
  type ListAdminUsersQuery,
  type SetAdminPasswordInput,
  type Paginated,
} from '@iconbridge/shared';
import { z } from 'zod';
import type { AuthUser } from '../../auth/auth.types.js';
import { CurrentUser, Roles } from '../../auth/decorators/index.js';
import { ZodBody, ZodParams, ZodQuery } from '../../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../../common/swagger/zod-openapi.js';
import { Audit } from '../audit/audit.decorator.js';
import { AdminUsersService } from './admin-users.service.js';

interface IdParam {
  id: string;
}
const pageSchema = z.object({
  items: z.array(adminUserSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

@ApiTags('admin: users')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_ADMIN_USERS)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List back-office accounts (super admin)' })
  @ApiQuery({ name: 'role', required: false, enum: ADMIN_ROLES })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiZodResponse(200, pageSchema)
  @ApiErrors(401, 403)
  list(
    @ZodQuery(listAdminUsersQuerySchema) query: ListAdminUsersQuery,
  ): Promise<Paginated<AdminUser>> {
    return this.users.list(query);
  }

  @Post()
  @Audit({ action: 'admin_user.create', entityType: 'user' })
  @ApiOperation({
    summary: 'Create a back-office account',
    description:
      'Without `password`, the account has none and an invitation email with a set-password link is ' +
      'sent. With `password` (same strength rules as every password), no email is sent and the person ' +
      'must choose a new password at the first sign-in. A COUNTRY_AGENT needs `countries`. The password ' +
      'is never returned, logged or audited.',
  })
  @ApiZodBody(createAdminUserSchema)
  @ApiZodResponse(201, adminUserSchema)
  @ApiErrors(400, 401, 403, 409)
  create(@ZodBody(createAdminUserSchema) body: CreateAdminUserInput): Promise<AdminUser> {
    return this.users.create(body);
  }

  @Patch(':id/role')
  @Audit({ action: 'admin_user.change_role', entityType: 'user', idParam: 'id' })
  @ApiOperation({
    summary: 'Change the role of a back-office account',
    description: 'A COUNTRY_AGENT needs `countries` (ISO codes); other roles take none.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(changeAdminRoleSchema)
  @ApiZodResponse(200, adminUserSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  changeRole(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(changeAdminRoleSchema) body: ChangeAdminRoleInput,
  ): Promise<AdminUser> {
    return this.users.changeRole(params.id, body);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'admin_user.set_password', entityType: 'user', idParam: 'id' })
  @ApiOperation({
    summary: 'Set the password of a back-office account',
    description:
      'Same strength rules as every password. Every session of the account ends, a pending invitation ' +
      'link stops working, and the person must choose a new password at the next sign-in. The audit ' +
      'entry records the change, never the password.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(setAdminPasswordSchema)
  @ApiZodResponse(200, adminUserSchema)
  @ApiErrors(400, 401, 403, 404)
  setPassword(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(setAdminPasswordSchema) body: SetAdminPasswordInput,
  ): Promise<AdminUser> {
    return this.users.setPassword(params.id, body.password);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'admin_user.disable', entityType: 'user', idParam: 'id' })
  @ApiOperation({ summary: 'Disable an account and sign it out' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminUserSchema)
  @ApiErrors(401, 403, 404, 409)
  disable(
    @ZodParams(uuidParamSchema) params: IdParam,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdminUser> {
    return this.users.disable(params.id, actor.id);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'admin_user.enable', entityType: 'user', idParam: 'id' })
  @ApiOperation({ summary: 'Enable a disabled account' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminUserSchema)
  @ApiErrors(401, 403, 404)
  enable(@ZodParams(uuidParamSchema) params: IdParam): Promise<AdminUser> {
    return this.users.enable(params.id);
  }

  @Post(':id/force-logout')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'admin_user.force_logout', entityType: 'user', idParam: 'id' })
  @ApiOperation({ summary: 'End every session of an account immediately' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminUserSchema)
  @ApiErrors(401, 403, 404)
  forceLogout(@ZodParams(uuidParamSchema) params: IdParam): Promise<AdminUser> {
    return this.users.forceLogout(params.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'admin_user.delete', entityType: 'user', idParam: 'id' })
  @ApiOperation({
    summary: 'Delete a back-office account',
    description:
      'The account is signed out and can no longer be used; its address becomes free. ' +
      'Not your own account, and never the last active super admin.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404, 409)
  async remove(
    @ZodParams(uuidParamSchema) params: IdParam,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.users.remove(params.id, user.id);
  }
}
