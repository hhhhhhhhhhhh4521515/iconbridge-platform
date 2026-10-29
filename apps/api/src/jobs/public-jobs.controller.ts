import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  JOB_SORTS,
  jobListQuerySchema,
  publicJobSchema,
  type JobListQuery,
  type Paginated,
  type PublicJob,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Public } from '../auth/decorators/index.js';
import { ZodParams, ZodQuery } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { PublicJobsService } from './public-jobs.service.js';
import { PUBLIC_CACHE } from '../common/http/public-cache.js';

const slugParamSchema = z.object({ slug: z.string().trim().toLowerCase().min(1).max(120) });
const jobPageSchema = z.object({
  items: z.array(publicJobSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

@ApiTags('public')
@Public()
@Controller('jobs')
export class PublicJobsController {
  constructor(private readonly jobs: PublicJobsService) {}

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'Search the jobs of the site (open ones first, closed ones marked isOpen: false)',
    description:
      'Only jobs that are published, not deleted, whose deadline has not passed and with positions left. ' +
      '`q` searches the title and the description and tolerates plurals and typos on the title ' +
      '("welders" finds "Welder").',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search text, 2 to 100 characters',
    example: 'welders',
  })
  @ApiQuery({
    name: 'destination',
    required: false,
    description: 'Destination code',
    example: 'POLAND',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Category slug',
    example: 'construction',
  })
  @ApiQuery({
    name: 'salaryMin',
    required: false,
    type: Number,
    description: 'Pays at least this amount',
  })
  @ApiQuery({
    name: 'salaryMax',
    required: false,
    type: Number,
    description: 'Pays at most this amount',
  })
  @ApiQuery({
    name: 'currency',
    required: false,
    description: 'ISO 4217 code; use it with a salary filter',
    example: 'EUR',
  })
  @ApiQuery({
    name: 'language',
    required: false,
    description: 'Required language (ISO 639 code)',
    example: 'en',
  })
  @ApiQuery({ name: 'featured', required: false, enum: ['true', 'false'] })
  @ApiQuery({
    name: 'open',
    required: false,
    enum: ['true', 'false'],
    description:
      'true: open jobs only. Otherwise every listed job, open ones first, closed ones with `isOpen: false`',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: JOB_SORTS,
    description: 'Default: relevance with q, newest without',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'From 1 (default 1)' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: '1 to 100 (default 20)',
  })
  @ApiZodResponse(200, jobPageSchema)
  @ApiErrors(400)
  list(@ZodQuery(jobListQuerySchema) query: JobListQuery): Promise<Paginated<PublicJob>> {
    return this.jobs.list(query);
  }

  @Get(':slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({
    summary: 'One job of the site, open or closed, with its destination and category',
    description: 'A draft, closed, archived, deleted, expired or full job answers 404.',
  })
  @ApiParam({ name: 'slug', example: 'sample-welder-poland' })
  @ApiZodResponse(200, publicJobSchema)
  @ApiErrors(404)
  get(@ZodParams(slugParamSchema) params: { slug: string }): Promise<PublicJob> {
    return this.jobs.getBySlug(params.slug);
  }
}
