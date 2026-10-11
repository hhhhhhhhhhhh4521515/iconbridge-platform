import { Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  adminUserSchema,
  changeAdminRoleSchema,
  createAdminUserSchema,
  listAdminUsersQuerySchema,
  PERMISSIONS,
  uuidParamSchema,
  type AdminUser,
  type ChangeAdminRoleInput,
  type CreateAdminUserInput,
  type ListAdminUsersQuery,
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
      'The account has no password; an invitation email with a set-password link is sent.',
  })
  @ApiZodBody(createAdminUserSchema)
  @ApiZodResponse(201, adminUserSchema)
  @ApiErrors(400, 401, 403, 409)
  create(@ZodBody(createAdminUserSchema) body: CreateAdminUserInput): Promise<AdminUser> {
    return this.users.create(body);
  }

  @Patch(':id/role')
  @Audit({ action: 'admin_user.change_role', entityType: 'user', idParam: 'id' })
  @ApiOperation({ summary: 'Change the role of a back-office account' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(changeAdminRoleSchema)
  @ApiZodResponse(200, adminUserSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  changeRole(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(changeAdminRoleSchema) body: ChangeAdminRoleInput,
  ): Promise<AdminUser> {
    return this.users.changeRole(params.id, body.role);
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
}
