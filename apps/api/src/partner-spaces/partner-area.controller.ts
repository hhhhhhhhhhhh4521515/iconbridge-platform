import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Req,
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
  createPartnerApplicationSchema,
  createPartnerCommentSchema,
  createPartnerJobSchema,
  deletePartnerApplicationSchema,
  downloadQuerySchema,
  PARTNER_FILE_KINDS,
  partnerFileLinkSchema,
  partnerFileParamsSchema,
  partnerFileSchema,
  partnerFileUploadParamsSchema,
  listPartnerApplicationsQuerySchema,
  listPartnerHistoryQuerySchema,
  listPartnerJobsQuerySchema,
  partnerApplicationParamsSchema,
  partnerApplicationSchema,
  partnerCommentSchema,
  partnerHistoryPageSchema,
  partnerJobParamsSchema,
  partnerJobSchema,
  partnerSpaceParamsSchema,
  partnerSpaceSummarySchema,
  updatePartnerApplicationSchema,
  updatePartnerJobSchema,
  type CreatePartnerApplicationInput,
  type CreatePartnerCommentInput,
  type CreatePartnerJobInput,
  type DeletePartnerApplicationInput,
  type DownloadQuery,
  type PartnerFile,
  type PartnerFileKind,
  type PartnerFileLink,
  type ListPartnerApplicationsQuery,
  type ListPartnerHistoryQuery,
  type ListPartnerJobsQuery,
  type Paginated,
  type PartnerApplication,
  type PartnerComment,
  type PartnerHistoryEntry,
  type PartnerJob,
  type PartnerSpaceSummary,
  type UpdatePartnerApplicationInput,
  type UpdatePartnerJobInput,
} from '@iconbridge/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import { CurrentUser, PartnerAccess } from '../auth/decorators/index.js';
import { AppException } from '../common/errors/app.exception.js';
import { ZodBody, ZodParams, ZodQuery } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { PartnerAreaService } from './partner-area.service.js';
import { PartnerFilesService } from './partner-files.service.js';
import {
  CurrentSpace,
  PartnerSpaceRoute,
  type PartnerSpaceContext,
} from './partner-space.guard.js';

interface JobParams {
  spaceId: string;
  jobId: string;
}
interface ApplicationParams {
  spaceId: string;
  applicationId: string;
}

interface FileUploadParams {
  spaceId: string;
  applicationId: string;
  kind: PartnerFileKind;
}
interface FileParams {
  spaceId: string;
  fileId: string;
}
interface UploadedPartnerFile {
  buffer: Buffer;
  originalname?: string;
}

/** Hard ceiling of the upload parser; the real limit is the MAX_UPLOAD_SIZE_MB setting. */
const PARSER_MAX_BYTES = 25 * 1024 * 1024;

const SPACE_PARAM = { name: 'spaceId', format: 'uuid' } as const;

/**
 * The partner area (ADR-027), for the members of a space: its partner logins and the staff
 * a super admin added. Every member has the same rights. A space the caller is not a member
 * of, a disabled space and an id of another space all answer 404.
 */
@ApiTags('partner spaces')
@ApiCookieAuth()
@Controller('partner-spaces')
export class PartnerAreaController {
  constructor(
    private readonly area: PartnerAreaService,
    private readonly files: PartnerFilesService,
  ) {}

  @Get()
  @PartnerAccess()
  @ApiOperation({ summary: 'My partner spaces (members only see their own)' })
  @ApiZodResponse(200, z.array(partnerSpaceSummarySchema))
  @ApiErrors(401, 403)
  mySpaces(@CurrentUser() user: AuthUser): Promise<PartnerSpaceSummary[]> {
    return this.area.mySpaces(user);
  }

  @Get(':spaceId')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'One of my partner spaces' })
  @ApiParam(SPACE_PARAM)
  @ApiZodResponse(200, partnerSpaceSummarySchema)
  @ApiErrors(401, 403, 404)
  space(
    @ZodParams(partnerSpaceParamsSchema) _params: { spaceId: string },
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerSpaceSummary> {
    return this.area.space(space.id, user);
  }

  // -------------------------------------------------------------------------
  // Job demands
  // -------------------------------------------------------------------------

  @Get(':spaceId/jobs')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Job demands of the space, open first, with counts per visa status' })
  @ApiParam(SPACE_PARAM)
  @ApiZodResponse(200, z.array(partnerJobSchema))
  @ApiErrors(400, 401, 403, 404)
  listJobs(
    @ZodParams(partnerSpaceParamsSchema) _params: { spaceId: string },
    @ZodQuery(listPartnerJobsQuerySchema) query: ListPartnerJobsQuery,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<PartnerJob[]> {
    return this.area.listJobs(space.id, query);
  }

  @Post(':spaceId/jobs')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Create a job demand' })
  @ApiParam(SPACE_PARAM)
  @ApiZodBody(createPartnerJobSchema)
  @ApiZodResponse(201, partnerJobSchema)
  @ApiErrors(400, 401, 403, 404)
  createJob(
    @ZodParams(partnerSpaceParamsSchema) _params: { spaceId: string },
    @ZodBody(createPartnerJobSchema) body: CreatePartnerJobInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerJob> {
    return this.area.createJob(space.id, body, user);
  }

  @Get(':spaceId/jobs/:jobId')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'One job demand' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiZodResponse(200, partnerJobSchema)
  @ApiErrors(401, 403, 404)
  getJob(
    @ZodParams(partnerJobParamsSchema) params: JobParams,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<PartnerJob> {
    return this.area.getJob(space.id, params.jobId);
  }

  @Patch(':spaceId/jobs/:jobId')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Edit a job demand' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiZodBody(updatePartnerJobSchema)
  @ApiZodResponse(200, partnerJobSchema)
  @ApiErrors(400, 401, 403, 404)
  updateJob(
    @ZodParams(partnerJobParamsSchema) params: JobParams,
    @ZodBody(updatePartnerJobSchema) body: UpdatePartnerJobInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerJob> {
    return this.area.updateJob(space.id, params.jobId, body, user);
  }

  @Post(':spaceId/jobs/:jobId/close')
  @HttpCode(HttpStatus.OK)
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Close a job demand (nothing changes if it is already closed)' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiZodResponse(200, partnerJobSchema)
  @ApiErrors(401, 403, 404)
  closeJob(
    @ZodParams(partnerJobParamsSchema) params: JobParams,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerJob> {
    return this.area.setJobStatus(space.id, params.jobId, 'CLOSED', user);
  }

  @Post(':spaceId/jobs/:jobId/reopen')
  @HttpCode(HttpStatus.OK)
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Reopen a closed job demand' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiZodResponse(200, partnerJobSchema)
  @ApiErrors(401, 403, 404)
  reopenJob(
    @ZodParams(partnerJobParamsSchema) params: JobParams,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerJob> {
    return this.area.setJobStatus(space.id, params.jobId, 'OPEN', user);
  }

  @Get(':spaceId/jobs/:jobId/comments')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Comments of a job demand, oldest first' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiZodResponse(200, z.array(partnerCommentSchema))
  @ApiErrors(401, 403, 404)
  jobComments(
    @ZodParams(partnerJobParamsSchema) params: JobParams,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<PartnerComment[]> {
    return this.area.listComments(space.id, { jobId: params.jobId });
  }

  @Post(':spaceId/jobs/:jobId/comments')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Comment on a job demand (comments cannot be edited or deleted)' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiZodBody(createPartnerCommentSchema)
  @ApiZodResponse(201, partnerCommentSchema)
  @ApiErrors(400, 401, 403, 404)
  commentJob(
    @ZodParams(partnerJobParamsSchema) params: JobParams,
    @ZodBody(createPartnerCommentSchema) body: CreatePartnerCommentInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerComment> {
    return this.area.addComment(space.id, { jobId: params.jobId }, body, user);
  }

  // -------------------------------------------------------------------------
  // Applications
  // -------------------------------------------------------------------------

  @Get(':spaceId/applications')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Applications of the space; filter by job demand, visa status or name' })
  @ApiParam(SPACE_PARAM)
  @ApiZodResponse(200, z.array(partnerApplicationSchema))
  @ApiErrors(400, 401, 403, 404)
  listApplications(
    @ZodParams(partnerSpaceParamsSchema) _params: { spaceId: string },
    @ZodQuery(listPartnerApplicationsQuerySchema) query: ListPartnerApplicationsQuery,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<PartnerApplication[]> {
    return this.area.listApplications(space.id, query);
  }

  @Post(':spaceId/applications')
  @PartnerSpaceRoute()
  @ApiOperation({
    summary: 'Put a person forward for a job demand',
    description: '`jobId` must be a job demand of the same space; otherwise the answer is 404.',
  })
  @ApiParam(SPACE_PARAM)
  @ApiZodBody(createPartnerApplicationSchema)
  @ApiZodResponse(201, partnerApplicationSchema)
  @ApiErrors(400, 401, 403, 404)
  createApplication(
    @ZodParams(partnerSpaceParamsSchema) _params: { spaceId: string },
    @ZodBody(createPartnerApplicationSchema) body: CreatePartnerApplicationInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerApplication> {
    return this.area.createApplication(space.id, body, user);
  }

  @Get(':spaceId/applications/:applicationId')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'One application' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiZodResponse(200, partnerApplicationSchema)
  @ApiErrors(401, 403, 404)
  getApplication(
    @ZodParams(partnerApplicationParamsSchema) params: ApplicationParams,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<PartnerApplication> {
    return this.area.getApplication(space.id, params.applicationId);
  }

  @Patch(':spaceId/applications/:applicationId')
  @PartnerSpaceRoute()
  @ApiOperation({
    summary: 'Edit an application, including the visa and DHL follow-up',
    description:
      'A decision date needs the visa status Approved or Refused; a DHL tracking number needs the ' +
      'date it was sent. The rules are checked on the application as it will be after the change.',
  })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiZodBody(updatePartnerApplicationSchema)
  @ApiZodResponse(200, partnerApplicationSchema)
  @ApiErrors(400, 401, 403, 404)
  updateApplication(
    @ZodParams(partnerApplicationParamsSchema) params: ApplicationParams,
    @ZodBody(updatePartnerApplicationSchema) body: UpdatePartnerApplicationInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerApplication> {
    return this.area.updateApplication(space.id, params.applicationId, body, user);
  }

  @Delete(':spaceId/applications/:applicationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @PartnerSpaceRoute()
  @ApiOperation({
    summary: 'Delete an application with its files, comments and history (super admin)',
    description:
      'For a super admin who is a member of the space, for example after an erasure request. ' +
      "`confirmName` is the applicant's first and last name. Other members get 404. The history " +
      'keeps one entry without personal data; the audit entry holds counts.',
  })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiZodBody(deletePartnerApplicationSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 401, 403, 404, 503)
  async deleteApplication(
    @ZodParams(partnerApplicationParamsSchema) params: ApplicationParams,
    @ZodBody(deletePartnerApplicationSchema) body: DeletePartnerApplicationInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<void> {
    await this.area.deleteApplication(
      space.id,
      params.applicationId,
      body.confirmName,
      user,
      requestMeta(request).ip,
    );
  }

  @Get(':spaceId/applications/:applicationId/comments')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Comments of an application, oldest first' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiZodResponse(200, z.array(partnerCommentSchema))
  @ApiErrors(401, 403, 404)
  applicationComments(
    @ZodParams(partnerApplicationParamsSchema) params: ApplicationParams,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<PartnerComment[]> {
    return this.area.listComments(space.id, { applicationId: params.applicationId });
  }

  @Post(':spaceId/applications/:applicationId/comments')
  @PartnerSpaceRoute()
  @ApiOperation({ summary: 'Comment on an application (comments cannot be edited or deleted)' })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiZodBody(createPartnerCommentSchema)
  @ApiZodResponse(201, partnerCommentSchema)
  @ApiErrors(400, 401, 403, 404)
  commentApplication(
    @ZodParams(partnerApplicationParamsSchema) params: ApplicationParams,
    @ZodBody(createPartnerCommentSchema) body: CreatePartnerCommentInput,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerComment> {
    return this.area.addComment(space.id, { applicationId: params.applicationId }, body, user);
  }

  @Get(':spaceId/history')
  @PartnerSpaceRoute()
  @ApiOperation({
    summary: 'History of the space, newest first',
    description:
      'Who changed what and when, with the old and the new value. Filter by entity or application.',
  })
  @ApiParam(SPACE_PARAM)
  @ApiZodResponse(200, partnerHistoryPageSchema)
  @ApiErrors(400, 401, 403, 404)
  history(
    @ZodParams(partnerSpaceParamsSchema) _params: { spaceId: string },
    @ZodQuery(listPartnerHistoryQuerySchema) query: ListPartnerHistoryQuery,
    @CurrentSpace() space: PartnerSpaceContext,
  ): Promise<Paginated<PartnerHistoryEntry>> {
    return this.area.listHistory(space.id, query);
  }

  // -------------------------------------------------------------------------
  // Files (ADR-027, section 5)
  // -------------------------------------------------------------------------

  @Put(':spaceId/applications/:applicationId/files/:kind')
  @PartnerSpaceRoute()
  // After the guards: a caller outside the space gets 404 before the upload is read.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PARSER_MAX_BYTES, files: 1 } }))
  @ApiOperation({
    summary: 'Upload or replace the passport, CV or work permit of an application',
    description:
      'Multipart form with `file`, at most the MAX_UPLOAD_SIZE_MB setting (5 MB by default). The format ' +
      'is checked from the content: PDF or DOCX for a CV; PDF, JPG or PNG for a passport or a work ' +
      'permit. Images are re-encoded without their metadata. A replaced file is deleted.',
  })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'applicationId', format: 'uuid' })
  @ApiParam({ name: 'kind', enum: [...PARTNER_FILE_KINDS] })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiZodResponse(200, partnerFileSchema)
  @ApiErrors(400, 401, 403, 404, 413, 415)
  uploadFile(
    @ZodParams(partnerFileUploadParamsSchema) params: FileUploadParams,
    @UploadedFile() file: UploadedPartnerFile | undefined,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerFile> {
    if (!file) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
        { path: 'file', message: 'Send the file in the form field "file"' },
      ]);
    }
    return this.files.upload(space.id, params.applicationId, params.kind, file, user);
  }

  @Get(':spaceId/files/:fileId/link')
  @PartnerSpaceRoute()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'A 5-minute read-only link to a file',
    description:
      '`inline=true` previews a PDF or an image in the browser; other formats are saved. Each link ' +
      "is written to the space's history.",
  })
  @ApiParam(SPACE_PARAM)
  @ApiParam({ name: 'fileId', format: 'uuid' })
  @ApiQuery({ name: 'inline', required: false, enum: ['true', 'false'] })
  @ApiZodResponse(200, partnerFileLinkSchema)
  @ApiErrors(400, 401, 403, 404)
  fileLink(
    @ZodParams(partnerFileParamsSchema) params: FileParams,
    @ZodQuery(downloadQuerySchema) query: DownloadQuery,
    @CurrentSpace() space: PartnerSpaceContext,
    @CurrentUser() user: AuthUser,
  ): Promise<PartnerFileLink> {
    return this.files.link(space.id, params.fileId, query.inline, user);
  }
}
