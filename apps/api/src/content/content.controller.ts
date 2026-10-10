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
  Redirect,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  adminHomeSlideSchema,
  adminSuccessStorySchema,
  createHomeSlideSchema,
  createSuccessStorySchema,
  homeSlideSchema,
  PERMISSIONS,
  PUBLIC_SETTING_KEYS,
  publicSuccessStorySchema,
  reorderSchema,
  updateHomeSlideSchema,
  updateSuccessStorySchema,
  uuidParamSchema,
  type AdminHomeSlide,
  type AdminSuccessStory,
  type CreateHomeSlideInput,
  type CreateSuccessStoryInput,
  type HomeSlide,
  type PublicSuccessStory,
  type ReorderInput,
  type UpdateHomeSlideInput,
  type UpdateSuccessStoryInput,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Audit } from '../admin/audit/audit.decorator.js';
import { Public, Roles } from '../auth/decorators/index.js';
import { AppException } from '../common/errors/app.exception.js';
import { ZodBody, ZodParams } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { COVER_MAX_BYTES } from '../jobs/job-cover.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ContentService } from './content.service.js';

interface IdParam {
  id: string;
}
interface Upload {
  buffer: Buffer;
}

const Id = () => ZodParams(uuidParamSchema);
const ApiId = () => ApiParam({ name: 'id', format: 'uuid' });
const FileUpload = () =>
  UseInterceptors(FileInterceptor('file', { limits: { fileSize: COVER_MAX_BYTES, files: 1 } }));
const ApiFile = () =>
  ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  });

function required(file: Upload | undefined): Buffer {
  if (!file) {
    throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
      { path: 'file', message: 'Send the file in the form field "file"' },
    ]);
  }
  return file.buffer;
}

@ApiTags('public')
@Public()
@Controller()
export class PublicContentController {
  constructor(
    private readonly content: ContentService,
    private readonly settings: SettingsService,
  ) {}

  @Get('success-stories')
  @ApiOperation({
    summary: 'Published success stories',
    description:
      'First name and initial of the last name, unless the candidate agreed to show the full name.',
  })
  @ApiZodResponse(200, z.array(publicSuccessStorySchema))
  stories(): Promise<PublicSuccessStory[]> {
    return this.content.publicStories();
  }

  @Get('home-slides')
  @ApiOperation({ summary: 'Active slides of the home page, in order' })
  @ApiZodResponse(200, z.array(homeSlideSchema))
  slides(): Promise<HomeSlide[]> {
    return this.content.publicSlides();
  }

  @Get('site-info')
  @ApiOperation({ summary: 'Contact details shown on the site' })
  async siteInfo(): Promise<Record<(typeof PUBLIC_SETTING_KEYS)[number], string>> {
    const entries = await Promise.all(
      PUBLIC_SETTING_KEYS.map(async (key) => [key, await this.settings.get(key)] as const),
    );
    return Object.fromEntries(entries) as Record<(typeof PUBLIC_SETTING_KEYS)[number], string>;
  }
}

@ApiTags('admin: success stories')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_CONTENT)
@Controller('admin/success-stories')
export class AdminSuccessStoriesController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @ApiOperation({ summary: 'Every success story, published or not' })
  @ApiZodResponse(200, z.array(adminSuccessStorySchema))
  @ApiErrors(401, 403)
  list(): Promise<AdminSuccessStory[]> {
    return this.content.listStories();
  }

  @Post()
  @Audit({ action: 'success_story.create', entityType: 'successStory' })
  @ApiOperation({ summary: 'Create a success story (unpublished)' })
  @ApiZodBody(createSuccessStorySchema)
  @ApiZodResponse(201, adminSuccessStorySchema)
  @ApiErrors(400, 401, 403)
  create(
    @ZodBody(createSuccessStorySchema) body: CreateSuccessStoryInput,
  ): Promise<AdminSuccessStory> {
    return this.content.createStory(body);
  }

  @Post('from-application/:id')
  @Audit({ action: 'success_story.create_from_application', entityType: 'successStory' })
  @ApiOperation({
    summary: 'Create a draft story from an application',
    description:
      'The application must be Visa approved or Deployed. Name, job, destination and visa date are prefilled.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Application id' })
  @ApiZodResponse(201, adminSuccessStorySchema)
  @ApiErrors(401, 403, 404, 409)
  createFromApplication(@Id() params: IdParam): Promise<AdminSuccessStory> {
    return this.content.createStoryFromApplication(params.id);
  }

  @Put('order')
  @ApiOperation({ summary: 'Reorder: send every story id, first shown first' })
  @ApiZodBody(reorderSchema)
  @ApiZodResponse(200, z.array(adminSuccessStorySchema))
  @ApiErrors(400, 401, 403)
  reorder(@ZodBody(reorderSchema) body: ReorderInput): Promise<AdminSuccessStory[]> {
    return this.content.reorderStories(body.ids);
  }

  @Patch(':id')
  @Audit({ action: 'success_story.update', entityType: 'successStory', idParam: 'id' })
  @ApiOperation({ summary: 'Edit a success story' })
  @ApiId()
  @ApiZodBody(updateSuccessStorySchema)
  @ApiZodResponse(200, adminSuccessStorySchema)
  @ApiErrors(400, 401, 403, 404)
  update(
    @Id() params: IdParam,
    @ZodBody(updateSuccessStorySchema) body: UpdateSuccessStoryInput,
  ): Promise<AdminSuccessStory> {
    return this.content.updateStory(params.id, body);
  }

  @Post(':id/photo')
  @HttpCode(HttpStatus.OK)
  @FileUpload()
  @Audit({ action: 'success_story.set_photo', entityType: 'successStory', idParam: 'id' })
  @ApiOperation({ summary: 'Upload the photo (JPEG, PNG or WebP, 5 MB at most)' })
  @ApiId()
  @ApiConsumes('multipart/form-data')
  @ApiFile()
  @ApiZodResponse(200, adminSuccessStorySchema)
  @ApiErrors(400, 401, 403, 404, 413, 415)
  photo(
    @Id() params: IdParam,
    @UploadedFile() file: Upload | undefined,
  ): Promise<AdminSuccessStory> {
    return this.content.setStoryPhoto(params.id, required(file));
  }

  @Post(':id/consent')
  @HttpCode(HttpStatus.OK)
  @FileUpload()
  @Audit({ action: 'success_story.set_consent', entityType: 'successStory', idParam: 'id' })
  @ApiOperation({
    summary: "Upload the candidate's signed consent (PDF, JPG or PNG)",
    description: 'Stored privately. Required before the story can be published.',
  })
  @ApiId()
  @ApiConsumes('multipart/form-data')
  @ApiFile()
  @ApiZodResponse(200, adminSuccessStorySchema)
  @ApiErrors(400, 401, 403, 404, 413, 415)
  consent(
    @Id() params: IdParam,
    @UploadedFile() file: Upload | undefined,
  ): Promise<AdminSuccessStory> {
    return this.content.setStoryConsent(params.id, required(file));
  }

  @Get(':id/consent')
  @Audit({ action: 'success_story.download_consent', entityType: 'successStory', idParam: 'id' })
  @Header('Cache-Control', 'no-store')
  @Redirect()
  @ApiOperation({ summary: 'Download the consent document (302 to a 5-minute link, audited)' })
  @ApiId()
  @ApiResponse({ status: 302 })
  @ApiErrors(401, 403, 404)
  async consentDownload(@Id() params: IdParam): Promise<{ url: string; statusCode: number }> {
    return { url: await this.content.storyConsentUrl(params.id), statusCode: HttpStatus.FOUND };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'success_story.publish', entityType: 'successStory', idParam: 'id' })
  @ApiOperation({ summary: 'Publish (refused without a consent document)' })
  @ApiId()
  @ApiZodResponse(200, adminSuccessStorySchema)
  @ApiErrors(401, 403, 404, 409)
  publish(@Id() params: IdParam): Promise<AdminSuccessStory> {
    return this.content.setStoryPublished(params.id, true);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'success_story.unpublish', entityType: 'successStory', idParam: 'id' })
  @ApiOperation({ summary: 'Remove from the site' })
  @ApiId()
  @ApiZodResponse(200, adminSuccessStorySchema)
  @ApiErrors(401, 403, 404)
  unpublish(@Id() params: IdParam): Promise<AdminSuccessStory> {
    return this.content.setStoryPublished(params.id, false);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'success_story.delete', entityType: 'successStory', idParam: 'id' })
  @ApiOperation({ summary: 'Delete a story with its photo and consent document' })
  @ApiId()
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404)
  async remove(@Id() params: IdParam): Promise<void> {
    await this.content.removeStory(params.id);
  }
}

@ApiTags('admin: home slides')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_CONTENT)
@Controller('admin/home-slides')
export class AdminHomeSlidesController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @ApiOperation({ summary: 'Every home slide, active or not' })
  @ApiZodResponse(200, z.array(adminHomeSlideSchema))
  @ApiErrors(401, 403)
  list(): Promise<AdminHomeSlide[]> {
    return this.content.listSlides();
  }

  @Post()
  @Audit({ action: 'home_slide.create', entityType: 'homeSlide' })
  @ApiOperation({ summary: 'Create a slide (inactive until it has an image)' })
  @ApiZodBody(createHomeSlideSchema)
  @ApiZodResponse(201, adminHomeSlideSchema)
  @ApiErrors(400, 401, 403)
  create(@ZodBody(createHomeSlideSchema) body: CreateHomeSlideInput): Promise<AdminHomeSlide> {
    return this.content.createSlide(body);
  }

  @Put('order')
  @ApiOperation({ summary: 'Reorder: send every slide id, first shown first' })
  @ApiZodBody(reorderSchema)
  @ApiZodResponse(200, z.array(adminHomeSlideSchema))
  @ApiErrors(400, 401, 403)
  reorder(@ZodBody(reorderSchema) body: ReorderInput): Promise<AdminHomeSlide[]> {
    return this.content.reorderSlides(body.ids);
  }

  @Patch(':id')
  @Audit({ action: 'home_slide.update', entityType: 'homeSlide', idParam: 'id' })
  @ApiOperation({ summary: 'Edit a slide; `isActive` shows or hides it' })
  @ApiId()
  @ApiZodBody(updateHomeSlideSchema)
  @ApiZodResponse(200, adminHomeSlideSchema)
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @Id() params: IdParam,
    @ZodBody(updateHomeSlideSchema) body: UpdateHomeSlideInput,
  ): Promise<AdminHomeSlide> {
    return this.content.updateSlide(params.id, body);
  }

  @Post(':id/image')
  @HttpCode(HttpStatus.OK)
  @FileUpload()
  @Audit({ action: 'home_slide.set_image', entityType: 'homeSlide', idParam: 'id' })
  @ApiOperation({
    summary:
      'Upload the image (JPEG, PNG or WebP, 5 MB at most; stored as WebP, 1920 px wide at most)',
  })
  @ApiId()
  @ApiConsumes('multipart/form-data')
  @ApiFile()
  @ApiZodResponse(200, adminHomeSlideSchema)
  @ApiErrors(400, 401, 403, 404, 413, 415)
  image(@Id() params: IdParam, @UploadedFile() file: Upload | undefined): Promise<AdminHomeSlide> {
    return this.content.setSlideImage(params.id, required(file));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit({ action: 'home_slide.delete', entityType: 'homeSlide', idParam: 'id' })
  @ApiOperation({ summary: 'Delete a slide and its image' })
  @ApiId()
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404)
  async remove(@Id() params: IdParam): Promise<void> {
    await this.content.removeSlide(params.id);
  }
}
