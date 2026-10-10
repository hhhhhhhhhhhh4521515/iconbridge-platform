import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  publicStoryName,
  type AdminHomeSlide,
  type AdminSuccessStory,
  type CreateHomeSlideInput,
  type CreateSuccessStoryInput,
  type HomeSlide,
  type PublicSuccessStory,
  type UpdateHomeSlideInput,
  type UpdateSuccessStoryInput,
} from '@iconbridge/shared';
import { AppException, notFound } from '../common/errors/app.exception.js';
import { inspectDocument } from '../documents/file-inspection.js';
import { Prisma } from '../generated/prisma/client.js';
import { JobCoverService } from '../jobs/job-cover.service.js';
import { localized } from '../jobs/job.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const STORY_INCLUDE = { destination: true } satisfies Prisma.SuccessStoryInclude;
const SLIDE_INCLUDE = { destination: { select: { code: true } } } satisfies Prisma.HomeSlideInclude;
type StoryRow = Prisma.SuccessStoryGetPayload<{ include: typeof STORY_INCLUDE }>;
type SlideRow = Prisma.HomeSlideGetPayload<{ include: typeof SLIDE_INCLUDE }>;

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);
const json = (value: unknown) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

/** Success stories and home slides: what the home page shows, and how the back office edits it. */
@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly images: JobCoverService,
  ) {}

  // --- Success stories --------------------------------------------------------

  /** Published stories only. The last name is reduced to its initial unless the full name was agreed. */
  async publicStories(): Promise<PublicSuccessStory[]> {
    const rows = await this.prisma.successStory.findMany({
      where: { isPublished: true, consentDocumentPath: { not: null } },
      include: STORY_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: publicStoryName(row),
      photoUrl: this.storage.publicUrl(row.photoPath),
      jobTitle: row.jobTitle,
      destination: { code: row.destination.code, name: localized(row.destination.name) },
      visaApprovedAt: dateOnly(row.visaApprovedAt),
      quote: localized(row.quote),
    }));
  }

  async listStories(): Promise<AdminSuccessStory[]> {
    const rows = await this.prisma.successStory.findMany({
      include: STORY_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toAdminStory(row));
  }

  async createStory(
    input: CreateSuccessStoryInput,
    applicationId: string | null = null,
  ): Promise<AdminSuccessStory> {
    await this.requireDestination(input.destinationId);
    const last = await this.prisma.successStory.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.successStory.create({
      data: {
        ...input,
        visaApprovedAt: toDate(input.visaApprovedAt) ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        applicationId,
      },
      include: STORY_INCLUDE,
    });
    return this.toAdminStory(row);
  }

  /**
   * A draft story from an application that reached Visa approved or Deployed:
   * name, job, destination and visa date are copied; the quote, the photo and
   * the consent document still have to be added before it can be published.
   */
  async createStoryFromApplication(applicationId: string): Promise<AdminSuccessStory> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: { select: { firstName: true, lastName: true } },
        job: { select: { title: true, destinationId: true } },
        statusHistory: {
          where: { toStatus: 'VISA_APPROVED' },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!application) {
      throw notFound('Application not found');
    }
    if (application.status !== 'VISA_APPROVED' && application.status !== 'DEPLOYED') {
      throw new AppException(
        'CONFLICT',
        HttpStatus.CONFLICT,
        'A success story can be created once the visa is approved',
        { status: application.status },
      );
    }
    return this.createStory(
      {
        firstName: application.candidate.firstName,
        lastName: application.candidate.lastName,
        showFullName: false,
        jobTitle: application.job.title,
        destinationId: application.job.destinationId,
        visaApprovedAt: dateOnly(application.statusHistory[0]?.createdAt ?? null),
        quote: { en: '-', fr: '-', ar: '-' },
      },
      applicationId,
    );
  }

  async updateStory(id: string, input: UpdateSuccessStoryInput): Promise<AdminSuccessStory> {
    await this.story(id);
    if (input.destinationId) {
      await this.requireDestination(input.destinationId);
    }
    const row = await this.prisma.successStory.update({
      where: { id },
      data: { ...input, visaApprovedAt: toDate(input.visaApprovedAt) },
      include: STORY_INCLUDE,
    });
    return this.toAdminStory(row);
  }

  /** Publishing needs the written consent of the candidate on file. */
  async setStoryPublished(id: string, published: boolean): Promise<AdminSuccessStory> {
    const story = await this.story(id);
    if (published && !story.consentDocumentPath) {
      throw new AppException(
        'CONSENT_REQUIRED',
        HttpStatus.CONFLICT,
        'Upload the consent document of the candidate before publishing',
      );
    }
    const row = await this.prisma.successStory.update({
      where: { id },
      data: { isPublished: published },
      include: STORY_INCLUDE,
    });
    return this.toAdminStory(row);
  }

  async setStoryPhoto(id: string, file: Buffer): Promise<AdminSuccessStory> {
    const story = await this.story(id);
    const image = await this.images.process(file);
    const path = `stories/${id}/${image.fileName.replace('cover-', 'photo-')}`;
    await this.storage.uploadPublic(path, image.content, image.contentType);
    const row = await this.prisma.successStory.update({
      where: { id },
      data: { photoPath: path },
      include: STORY_INCLUDE,
    });
    if (story.photoPath && story.photoPath !== path) {
      await this.storage.deletePublic(story.photoPath);
    }
    return this.toAdminStory(row);
  }

  /** The signed consent (PDF, JPG or PNG) goes to private storage: it is a personal document. */
  async setStoryConsent(id: string, file: Buffer): Promise<AdminSuccessStory> {
    const story = await this.story(id);
    const inspected = await inspectDocument(file, 'OTHER');
    const path = `consents/${id}/${randomUUID()}.${inspected.format}`;
    await this.storage.uploadPrivate(path, file, inspected.mimeType);
    const row = await this.prisma.successStory.update({
      where: { id },
      data: { consentDocumentPath: path },
      include: STORY_INCLUDE,
    });
    if (story.consentDocumentPath) {
      await this.storage.deletePrivate(story.consentDocumentPath).catch(() => undefined);
    }
    return this.toAdminStory(row);
  }

  async storyConsentUrl(id: string): Promise<string> {
    const story = await this.story(id);
    if (!story.consentDocumentPath) {
      throw notFound('No consent document');
    }
    const extension = story.consentDocumentPath.split('.').at(-1) ?? 'pdf';
    return this.storage.privateDownloadUrl(story.consentDocumentPath, {
      fileName: `consent-${id}.${extension}`,
      contentType:
        extension === 'pdf'
          ? 'application/pdf'
          : `image/${extension === 'jpg' ? 'jpeg' : extension}`,
    });
  }

  async removeStory(id: string): Promise<void> {
    const story = await this.story(id);
    await this.prisma.successStory.delete({ where: { id } });
    if (story.photoPath) {
      await this.storage.deletePublic(story.photoPath);
    }
    if (story.consentDocumentPath) {
      await this.storage.deletePrivate(story.consentDocumentPath).catch(() => undefined);
    }
  }

  async reorderStories(ids: string[]): Promise<AdminSuccessStory[]> {
    await this.reorder('successStory', ids);
    return this.listStories();
  }

  // --- Home slides --------------------------------------------------------------

  /** Active slides that have an image, in display order. */
  async publicSlides(): Promise<HomeSlide[]> {
    const rows = await this.prisma.homeSlide.findMany({
      where: { isActive: true, imagePath: { not: null } },
      include: SLIDE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toSlide(row));
  }

  async listSlides(): Promise<AdminHomeSlide[]> {
    const rows = await this.prisma.homeSlide.findMany({
      include: SLIDE_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toAdminSlide(row));
  }

  /** A new slide is inactive: it needs an image before it can be shown. */
  async createSlide(input: CreateHomeSlideInput): Promise<AdminHomeSlide> {
    if (input.destinationId) {
      await this.requireDestination(input.destinationId);
    }
    const last = await this.prisma.homeSlide.aggregate({ _max: { sortOrder: true } });
    const row = await this.prisma.homeSlide.create({
      data: {
        title: input.title,
        subtitle: json(input.subtitle ?? null),
        ctaLabel: json(input.ctaLabel ?? null),
        ctaUrl: input.ctaUrl ?? null,
        destinationId: input.destinationId ?? null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        isActive: false,
      },
      include: SLIDE_INCLUDE,
    });
    return this.toAdminSlide(row);
  }

  async updateSlide(id: string, input: UpdateHomeSlideInput): Promise<AdminHomeSlide> {
    const slide = await this.slide(id);
    if (input.isActive && !slide.imagePath) {
      throw new AppException(
        'IMAGE_REQUIRED',
        HttpStatus.CONFLICT,
        'Upload an image before activating the slide',
      );
    }
    if (input.destinationId) {
      await this.requireDestination(input.destinationId);
    }
    const { subtitle, ctaLabel, ...rest } = input;
    const row = await this.prisma.homeSlide.update({
      where: { id },
      data: {
        ...rest,
        ...(subtitle === undefined ? {} : { subtitle: json(subtitle) }),
        ...(ctaLabel === undefined ? {} : { ctaLabel: json(ctaLabel) }),
      },
      include: SLIDE_INCLUDE,
    });
    return this.toAdminSlide(row);
  }

  async setSlideImage(id: string, file: Buffer): Promise<AdminHomeSlide> {
    const slide = await this.slide(id);
    const image = await this.images.process(file, 1920);
    const path = `slides/${id}/${image.fileName.replace('cover-', 'slide-')}`;
    await this.storage.uploadPublic(path, image.content, image.contentType);
    const row = await this.prisma.homeSlide.update({
      where: { id },
      data: { imagePath: path },
      include: SLIDE_INCLUDE,
    });
    if (slide.imagePath && slide.imagePath !== path) {
      await this.storage.deletePublic(slide.imagePath);
    }
    return this.toAdminSlide(row);
  }

  async removeSlide(id: string): Promise<void> {
    const slide = await this.slide(id);
    await this.prisma.homeSlide.delete({ where: { id } });
    if (slide.imagePath) {
      await this.storage.deletePublic(slide.imagePath);
    }
  }

  async reorderSlides(ids: string[]): Promise<AdminHomeSlide[]> {
    await this.reorder('homeSlide', ids);
    return this.listSlides();
  }

  // --- Helpers ---------------------------------------------------------------------

  /** `ids` must be exactly the existing rows; their position becomes the sort order. */
  private async reorder(model: 'successStory' | 'homeSlide', ids: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing =
        model === 'successStory'
          ? await tx.successStory.findMany({ select: { id: true } })
          : await tx.homeSlide.findMany({ select: { id: true } });
      const known = new Set(existing.map((row) => row.id));
      if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
        throw new AppException(
          'VALIDATION_ERROR',
          HttpStatus.BAD_REQUEST,
          'The request is invalid',
          [{ path: 'ids', message: 'Send every item of the list exactly once' }],
        );
      }
      for (const [index, id] of ids.entries()) {
        if (model === 'successStory') {
          await tx.successStory.update({ where: { id }, data: { sortOrder: index + 1 } });
        } else {
          await tx.homeSlide.update({ where: { id }, data: { sortOrder: index + 1 } });
        }
      }
    });
  }

  private async story(id: string) {
    const story = await this.prisma.successStory.findUnique({ where: { id } });
    if (!story) {
      throw notFound('Success story not found');
    }
    return story;
  }

  private async slide(id: string) {
    const slide = await this.prisma.homeSlide.findUnique({ where: { id } });
    if (!slide) {
      throw notFound('Home slide not found');
    }
    return slide;
  }

  private async requireDestination(id: string): Promise<void> {
    if (!(await this.prisma.destination.findUnique({ where: { id }, select: { id: true } }))) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'The request is invalid', [
        { path: 'destinationId', message: 'Unknown destination' },
      ]);
    }
  }

  private toAdminStory(row: StoryRow): AdminSuccessStory {
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      showFullName: row.showFullName,
      publicName: publicStoryName(row),
      photoUrl: this.storage.publicUrl(row.photoPath),
      jobTitle: row.jobTitle,
      destination: {
        id: row.destination.id,
        code: row.destination.code,
        name: localized(row.destination.name),
      },
      visaApprovedAt: dateOnly(row.visaApprovedAt),
      quote: localized(row.quote),
      hasConsentDocument: row.consentDocumentPath !== null,
      isPublished: row.isPublished,
      sortOrder: row.sortOrder,
      applicationId: row.applicationId,
    };
  }

  private toSlide(row: SlideRow): HomeSlide {
    return {
      id: row.id,
      title: localized(row.title),
      subtitle: row.subtitle === null ? null : localized(row.subtitle),
      imageUrl: this.storage.publicUrl(row.imagePath),
      ctaLabel: row.ctaLabel === null ? null : localized(row.ctaLabel),
      ctaUrl: row.ctaUrl,
      destinationCode: row.destination?.code ?? null,
      sortOrder: row.sortOrder,
    };
  }

  private toAdminSlide(row: SlideRow): AdminHomeSlide {
    return { ...this.toSlide(row), isActive: row.isActive, destinationId: row.destinationId };
  }
}
