import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  adminJobListQuerySchema,
  adminJobSchema,
  createJobSchema,
  deleteJobQuerySchema,
  JOB_STATUSES,
  PERMISSIONS,
  updateJobSchema,
  uuidParamSchema,
  type AdminJob,
  type AdminJobListQuery,
  type CreateJobInput,
  type DeleteJobQuery,
  type Paginated,
  type UpdateJobInput,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Audit } from '../admin/audit/audit.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { AppException } from '../common/errors/app.exception.js';
import { ZodBody, ZodParams, ZodQuery } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { COVER_MAX_BYTES } from './job-cover.service.js';

interface IdParam {
  id: string;
}

/** The part of multer's in-memory file that is used. */
interface UploadedImage {
  buffer: Buffer;
}

const Id = () => ZodParams(uuidParamSchema);
const ApiId = () => ApiParam({ name: 'id', format: 'uuid' });
const jobPageSchema = z.object({
  items: z.array(adminJobSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

/** Job offers in the back office. Recruiters and super admins write; viewers read. */
@ApiTags('admin: jobs')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_JOBS)
@Controller('admin/jobs')
export class AdminJobsController {
  constructor(private readonly jobs: AdminJobsService) {}

  @Get()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'List jobs of every status, newest first' })
  @ApiQuery({ name: 'status', required: false, enum: JOB_STATUSES })
  @ApiQuery({ name: 'destinationId', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Part of the title' })
  @ApiQuery({
    name: 'deleted',
    required: false,
    enum: ['true', 'false'],
    description: 'true lists deleted jobs',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiZodResponse(200, jobPageSchema)
  @ApiErrors(400, 401, 403)
  list(@ZodQuery(adminJobListQuerySchema) query: AdminJobListQuery): Promise<Paginated<AdminJob>> {
    return this.jobs.list(query);
  }

  @Get(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'One job, including a deleted one' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404)
  get(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.get(params.id);
  }

  @Post()
  @Audit({ action: 'job.create', entityType: 'job' })
  @ApiOperation({
    summary: 'Create a job as a draft',
    description: 'The slug is generated from the title and the destination.',
  })
  @ApiZodBody(createJobSchema)
  @ApiZodResponse(201, adminJobSchema)
  @ApiErrors(400, 401, 403)
  create(
    @ZodBody(createJobSchema) body: CreateJobInput,
    @CurrentUser() actor: AuthUser,
  ): Promise<AdminJob> {
    return this.jobs.create(body, actor.id);
  }

  @Patch(':id')
  @Audit({ action: 'job.update', entityType: 'job', idParam: 'id' })
  @ApiOperation({
    summary: 'Edit a job',
    description: 'The slug follows the title only while the job has never been published.',
  })
  @ApiId()
  @ApiZodBody(updateJobSchema)
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(400, 401, 403, 404)
  update(@Id() params: IdParam, @ZodBody(updateJobSchema) body: UpdateJobInput): Promise<AdminJob> {
    return this.jobs.update(params.id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'job.delete', entityType: 'job', idParam: 'id' })
  @ApiOperation({
    summary: 'Delete a job',
    description:
      'Soft delete by default: the job disappears from the site and stays in the database. ' +
      '`permanent=true` removes the row, and is refused when the job has applications.',
  })
  @ApiId()
  @ApiQuery({ name: 'permanent', required: false, enum: ['true', 'false'] })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404, 409)
  async remove(
    @Id() params: IdParam,
    @ZodQuery(deleteJobQuerySchema) query: DeleteJobQuery,
  ): Promise<void> {
    await this.jobs.remove(params.id, query.permanent);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'job.publish', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Publish a draft (needs a future deadline and free positions)' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404, 409)
  publish(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.transition(params.id, 'publish');
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'job.close', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Close a published job' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404, 409)
  close(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.transition(params.id, 'close');
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'job.reopen', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Reopen a closed job (needs a future deadline and free positions)' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404, 409)
  reopen(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.transition(params.id, 'reopen');
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'job.archive', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Archive a job (final)' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404, 409)
  archive(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.transition(params.id, 'archive');
  }

  @Post(':id/duplicate')
  @Audit({ action: 'job.duplicate', entityType: 'job' })
  @ApiOperation({ summary: 'Copy a job into a new draft' })
  @ApiId()
  @ApiZodResponse(201, adminJobSchema)
  @ApiErrors(401, 403, 404)
  duplicate(@Id() params: IdParam, @CurrentUser() actor: AuthUser): Promise<AdminJob> {
    return this.jobs.duplicate(params.id, actor.id);
  }

  @Post(':id/feature')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'job.feature', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Mark a job as featured' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404)
  feature(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.setFeatured(params.id, true);
  }

  @Post(':id/unfeature')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'job.unfeature', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Remove the featured mark' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404)
  unfeature(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.setFeatured(params.id, false);
  }

  @Post(':id/cover')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: COVER_MAX_BYTES, files: 1 } }))
  @Audit({ action: 'job.set_cover', entityType: 'job', idParam: 'id' })
  @ApiOperation({
    summary: 'Upload the cover image',
    description:
      'JPEG, PNG or WebP, 5 MB at most, in the form field `file`. Stored as WebP, 1200 px wide at most, in the public media container.',
  })
  @ApiId()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(400, 401, 403, 404, 413, 415)
  setCover(
    @Id() params: IdParam,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<AdminJob> {
    if (!file) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
        { path: 'file', message: 'Send the image in the form field "file"' },
      ]);
    }
    return this.jobs.setCover(params.id, file.buffer);
  }

  @Delete(':id/cover')
  @Audit({ action: 'job.remove_cover', entityType: 'job', idParam: 'id' })
  @ApiOperation({ summary: 'Remove the cover image' })
  @ApiId()
  @ApiZodResponse(200, adminJobSchema)
  @ApiErrors(401, 403, 404)
  removeCover(@Id() params: IdParam): Promise<AdminJob> {
    return this.jobs.removeCover(params.id);
  }
}
