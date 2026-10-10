import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Redirect,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  candidateDocumentSchema,
  DOCUMENT_TYPES,
  PERMISSIONS,
  uploadDocumentSchema,
  uuidParamSchema,
  type CandidateDocument,
  type UploadDocumentInput,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Audit } from '../admin/audit/audit.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Owned, Roles } from '../auth/decorators/index.js';
import { OwnershipGuard } from '../auth/guards/ownership.guard.js';
import { AppException } from '../common/errors/app.exception.js';
import { ZodParams, ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { DocumentsService } from './documents.service.js';

/** Hard ceiling of the upload parser; the real limit is the MAX_UPLOAD_SIZE_MB setting (5 MB by default). */
const PARSER_MAX_BYTES = 25 * 1024 * 1024;

interface IdParam {
  id: string;
}

interface UploadedDocument {
  buffer: Buffer;
  originalname?: string;
}

@ApiTags('candidate: documents')
@ApiCookieAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('me/documents')
  @Roles(...PERMISSIONS.MANAGE_OWN_PROFILE)
  @ApiOperation({ summary: 'My documents' })
  @ApiZodResponse(200, z.array(candidateDocumentSchema))
  @ApiErrors(401, 403)
  list(@CurrentUser() user: AuthUser): Promise<CandidateDocument[]> {
    return this.documents.listOwn(user.id);
  }

  @Post('me/documents')
  @Roles(...PERMISSIONS.MANAGE_OWN_PROFILE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PARSER_MAX_BYTES, files: 1 } }))
  @ApiOperation({
    summary: 'Upload a document',
    description:
      'Multipart form with `type` and `file`, 5 MB at most. The format is checked from the content of the file: ' +
      'PDF or DOCX for a CV; JPG or PNG for a photo; PDF, JPG or PNG for everything else.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'file'],
      properties: {
        type: { type: 'string', enum: [...DOCUMENT_TYPES] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiZodResponse(201, candidateDocumentSchema)
  @ApiErrors(400, 401, 403, 409, 413, 415)
  upload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(uploadDocumentSchema)) body: UploadDocumentInput,
    @UploadedFile() file: UploadedDocument | undefined,
  ): Promise<CandidateDocument> {
    if (!file) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
        { path: 'file', message: 'Send the document in the form field "file"' },
      ]);
    }
    return this.documents.upload(user.id, body.type, file);
  }

  @Delete('me/documents/:id')
  @Roles(...PERMISSIONS.MANAGE_OWN_PROFILE)
  @UseGuards(OwnershipGuard)
  @Owned('document')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of my documents',
    description: 'Refused while the document is attached to an application in progress.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404, 409)
  async remove(@ZodParams(uuidParamSchema) params: IdParam): Promise<void> {
    await this.documents.removeOwn(params.id);
  }

  @Get('documents/:id/download')
  @Roles('CANDIDATE', ...PERMISSIONS.VIEW_CANDIDATES)
  @UseGuards(OwnershipGuard)
  @Owned('document')
  @Audit({ action: 'document.download', entityType: 'document', idParam: 'id' })
  @Header('Cache-Control', 'no-store')
  @Redirect()
  @ApiOperation({
    summary: 'Download a document',
    description:
      'Redirects (302) to a read-only link valid 5 minutes. Allowed to the candidate who owns the ' +
      'document and to back-office users, whose downloads are written to the audit log.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 302, description: 'Location: temporary signed URL' })
  @ApiErrors(401, 403, 404)
  async download(
    @ZodParams(uuidParamSchema) params: IdParam,
  ): Promise<{ url: string; statusCode: number }> {
    return { url: await this.documents.downloadUrl(params.id), statusCode: HttpStatus.FOUND };
  }
}
