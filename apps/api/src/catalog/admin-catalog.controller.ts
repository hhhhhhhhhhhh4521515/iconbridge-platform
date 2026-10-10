import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  adminCategorySchema,
  adminDestinationSchema,
  createCategorySchema,
  createDestinationSchema,
  PERMISSIONS,
  removalResultSchema,
  updateCategorySchema,
  updateDestinationSchema,
  uuidParamSchema,
  type AdminCategory,
  type AdminDestination,
  type CreateCategoryInput,
  type CreateDestinationInput,
  type RemovalResult,
  type UpdateCategoryInput,
  type UpdateDestinationInput,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Audit } from '../admin/audit/audit.decorator.js';
import { Roles } from '../auth/decorators/index.js';
import { ZodBody, ZodParams } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { AdminCatalogService } from './admin-catalog.service.js';

interface IdParam {
  id: string;
}

@ApiTags('admin: destinations')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_CONTENT)
@Controller('admin/destinations')
export class AdminDestinationsController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'All destinations, active or not' })
  @ApiZodResponse(200, z.array(adminDestinationSchema))
  @ApiErrors(401, 403)
  list(): Promise<AdminDestination[]> {
    return this.catalog.listDestinations();
  }

  @Post()
  @Audit({ action: 'destination.create', entityType: 'destination' })
  @ApiOperation({ summary: 'Add a destination' })
  @ApiZodBody(createDestinationSchema)
  @ApiZodResponse(201, adminDestinationSchema)
  @ApiErrors(400, 401, 403, 409)
  create(
    @ZodBody(createDestinationSchema) body: CreateDestinationInput,
  ): Promise<AdminDestination> {
    return this.catalog.createDestination(body);
  }

  @Patch(':id')
  @Audit({ action: 'destination.update', entityType: 'destination', idParam: 'id' })
  @ApiOperation({ summary: 'Edit a destination (the code cannot change)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateDestinationSchema)
  @ApiZodResponse(200, adminDestinationSchema)
  @ApiErrors(400, 401, 403, 404)
  update(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(updateDestinationSchema) body: UpdateDestinationInput,
  ): Promise<AdminDestination> {
    return this.catalog.updateDestination(params.id, body);
  }

  @Delete(':id')
  @Audit({ action: 'destination.remove', entityType: 'destination', idParam: 'id' })
  @ApiOperation({
    summary: 'Remove a destination',
    description: 'Deleted when unused; deactivated when jobs, stories or slides refer to it.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, removalResultSchema)
  @ApiErrors(401, 403, 404)
  remove(@ZodParams(uuidParamSchema) params: IdParam): Promise<RemovalResult> {
    return this.catalog.removeDestination(params.id);
  }
}

@ApiTags('admin: categories')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_CONTENT)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'All job categories, active or not' })
  @ApiZodResponse(200, z.array(adminCategorySchema))
  @ApiErrors(401, 403)
  list(): Promise<AdminCategory[]> {
    return this.catalog.listCategories();
  }

  @Post()
  @Audit({ action: 'category.create', entityType: 'jobCategory' })
  @ApiOperation({ summary: 'Add a job category' })
  @ApiZodBody(createCategorySchema)
  @ApiZodResponse(201, adminCategorySchema)
  @ApiErrors(400, 401, 403, 409)
  create(@ZodBody(createCategorySchema) body: CreateCategoryInput): Promise<AdminCategory> {
    return this.catalog.createCategory(body);
  }

  @Patch(':id')
  @Audit({ action: 'category.update', entityType: 'jobCategory', idParam: 'id' })
  @ApiOperation({ summary: 'Edit a job category (the slug cannot change)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateCategorySchema)
  @ApiZodResponse(200, adminCategorySchema)
  @ApiErrors(400, 401, 403, 404)
  update(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(updateCategorySchema) body: UpdateCategoryInput,
  ): Promise<AdminCategory> {
    return this.catalog.updateCategory(params.id, body);
  }

  @Delete(':id')
  @Audit({ action: 'category.remove', entityType: 'jobCategory', idParam: 'id' })
  @ApiOperation({
    summary: 'Remove a job category',
    description: 'Deleted when unused; deactivated when jobs refer to it.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, removalResultSchema)
  @ApiErrors(401, 403, 404)
  remove(@ZodParams(uuidParamSchema) params: IdParam): Promise<RemovalResult> {
    return this.catalog.removeCategory(params.id);
  }
}
