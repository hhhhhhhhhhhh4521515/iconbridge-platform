import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  adminApplicationDetailSchema,
  adminApplicationListQuerySchema,
  adminApplicationSummarySchema,
  APPLICATION_SORTS,
  APPLICATION_STATUSES,
  bulkApplicationStatusSchema,
  bulkResultSchema,
  changeApplicationStatusSchema,
  exportApplicationsSchema,
  noteSchema,
  PERMISSIONS,
  uuidParamSchema,
  type AdminApplicationDetail,
  type AdminApplicationListQuery,
  type AdminApplicationSummary,
  type BulkApplicationStatusInput,
  type BulkResult,
  type ChangeApplicationStatusInput,
  type ExportApplicationsInput,
  type NoteInput,
  type Paginated,
} from '@iconbridge/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requestMeta, type AuthUser } from '../../auth/auth.types.js';
import { CurrentUser, Roles } from '../../auth/decorators/index.js';
import { ZodBody, ZodParams, ZodQuery } from '../../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../../common/swagger/zod-openapi.js';
import { Audit, SkipAudit } from '../audit/audit.decorator.js';
import { AdminApplicationsService } from './admin-applications.service.js';
import { ApplicationExportService } from './export.service.js';

interface IdParam {
  id: string;
}
const noteParamsSchema = z.object({ id: z.uuid(), noteId: z.uuid() });
const pageSchema = z.object({
  items: z.array(adminApplicationSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
const idSchema = z.object({ id: z.uuid() });

/** Applications in the back office. Viewers read; recruiters and super admins act. */
@ApiTags('admin: applications')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_APPLICATIONS)
@Controller('admin/applications')
export class AdminApplicationsController {
  constructor(
    private readonly applications: AdminApplicationsService,
    private readonly exports: ApplicationExportService,
  ) {}

  @Get()
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  @ApiOperation({ summary: 'List applications' })
  @ApiQuery({ name: 'jobId', required: false })
  @ApiQuery({ name: 'destination', required: false, description: 'Destination code' })
  @ApiQuery({ name: 'status', required: false, enum: APPLICATION_STATUSES })
  @ApiQuery({ name: 'appliedFrom', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'appliedTo', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'nationality', required: false, description: 'ISO 3166 code' })
  @ApiQuery({
    name: 'language',
    required: false,
    description: 'ISO 639-1 code spoken by the candidate',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Part of the name or the email' })
  @ApiQuery({ name: 'sort', required: false, enum: APPLICATION_SORTS })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiZodResponse(200, pageSchema)
  @ApiErrors(400, 401, 403)
  list(
    @ZodQuery(adminApplicationListQuerySchema) query: AdminApplicationListQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<AdminApplicationSummary>> {
    return this.applications.list(query, user);
  }

  @Post('bulk-status')
  @HttpCode(HttpStatus.OK)
  @SkipAudit()
  @ApiOperation({
    summary: 'Change the status of several applications',
    description:
      'Each application is handled on its own: the answer lists which ones changed and why the others did not. ' +
      'One audit entry and one email per application changed.',
  })
  @ApiZodBody(bulkApplicationStatusSchema)
  @ApiZodResponse(200, bulkResultSchema)
  @ApiErrors(400, 401, 403)
  bulkStatus(
    @ZodBody(bulkApplicationStatusSchema) body: BulkApplicationStatusInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<BulkResult> {
    return this.applications.bulkChangeStatus(body, user, requestMeta(request).ip);
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @Roles(...PERMISSIONS.EXPORT_APPLICATIONS)
  @SkipAudit()
  @ApiOperation({
    summary: 'Export applications to CSV or Excel',
    description:
      'Choose the columns, and either a selection (`ids`) or filters. The full passport number is left out ' +
      'unless a SUPER_ADMIN selects the `passportNumber` column and sets `includeFullPassportNumber`; ' +
      'every export is written to the audit log.',
  })
  @ApiZodBody(exportApplicationsSchema)
  @ApiProduces('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: 'The file' })
  @ApiErrors(400, 401, 403)
  async export(
    @ZodBody(exportApplicationsSchema) body: ExportApplicationsInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.exports.export(body, user, requestMeta(request).ip);
    response
      .status(HttpStatus.OK)
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .setHeader('Cache-Control', 'no-store')
      .send(file.content);
  }

  @Get(':id')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  @ApiOperation({ summary: 'One application: snapshot, documents, history and internal notes' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminApplicationDetailSchema)
  @ApiErrors(401, 403, 404)
  get(
    @ZodParams(uuidParamSchema) params: IdParam,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminApplicationDetail> {
    return this.applications.get(params.id, user);
  }

  @Patch(':id/status')
  @SkipAudit()
  @ApiOperation({
    summary: 'Change the status of an application',
    description:
      'Follows the state machine: one step forward, or Rejected; Rejected and Withdrawn are final unless a ' +
      'SUPER_ADMIN reopens them. Deployed takes one position of the job. `comment` stays internal; ' +
      '`messageToCandidate` appears in the candidate timeline and in the email sent at every change.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(changeApplicationStatusSchema)
  @ApiZodResponse(200, adminApplicationDetailSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  changeStatus(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(changeApplicationStatusSchema) body: ChangeApplicationStatusInput,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<AdminApplicationDetail> {
    return this.applications.changeStatus(params.id, body, user, requestMeta(request).ip);
  }

  @Post(':id/undo-status')
  @HttpCode(HttpStatus.OK)
  @SkipAudit()
  @ApiOperation({
    summary: 'Undo my last status change',
    description:
      'Within 15 minutes, by the user who made the change, and only while it is still the current status. ' +
      'The application returns to the previous status; if the candidate had been emailed, a correction is sent.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminApplicationDetailSchema)
  @ApiErrors(401, 403, 404, 409)
  undoStatus(
    @ZodParams(uuidParamSchema) params: IdParam,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Promise<AdminApplicationDetail> {
    return this.applications.undoStatus(params.id, user, requestMeta(request).ip);
  }

  @Post(':id/notes')
  @Audit({ action: 'application.add_note', entityType: 'application', idParam: 'id' })
  @ApiOperation({ summary: 'Add an internal note (never visible to the candidate)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(noteSchema)
  @ApiZodResponse(201, idSchema)
  @ApiErrors(400, 401, 403, 404)
  addNote(
    @ZodParams(uuidParamSchema) params: IdParam,
    @ZodBody(noteSchema) body: NoteInput,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.applications.addNote(params.id, body.body, user);
  }

  @Patch(':id/notes/:noteId')
  @Audit({ action: 'application.update_note', entityType: 'application', idParam: 'id' })
  @ApiOperation({ summary: 'Edit an internal note (its author, or a super admin)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiZodBody(noteSchema)
  @ApiZodResponse(200, idSchema)
  @ApiErrors(400, 401, 403, 404)
  updateNote(
    @ZodParams(noteParamsSchema) params: { id: string; noteId: string },
    @ZodBody(noteSchema) body: NoteInput,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string }> {
    return this.applications.updateNote(params.id, params.noteId, body.body, user);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'application.delete_note', entityType: 'application', idParam: 'id' })
  @ApiOperation({ summary: 'Delete an internal note (its author, or a super admin)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404)
  async removeNote(
    @ZodParams(noteParamsSchema) params: { id: string; noteId: string },
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.applications.removeNote(params.id, params.noteId, user);
  }
}
