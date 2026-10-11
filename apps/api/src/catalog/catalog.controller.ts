import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  categorySchema,
  destinationSchema,
  publicStatsSchema,
  type Category,
  type Destination,
  type PublicStats,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Public } from '../auth/decorators/index.js';
import { ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { CatalogService } from './catalog.service.js';
import { PUBLIC_CACHE } from '../common/http/public-cache.js';

@ApiTags('public')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('destinations')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({ summary: 'Active destinations with their number of open jobs' })
  @ApiZodResponse(200, z.array(destinationSchema))
  destinations(): Promise<Destination[]> {
    return this.catalog.destinations();
  }

  @Get('categories')
  @Header('Cache-Control', PUBLIC_CACHE)
  @ApiOperation({ summary: 'Active job categories with their number of open jobs' })
  @ApiZodResponse(200, z.array(categorySchema))
  categories(): Promise<Category[]> {
    return this.catalog.categories();
  }

  @Get('stats')
  @Header('Cache-Control', 'public, max-age=600')
  @ApiOperation({
    summary: 'Counters of the home page',
    description:
      'Open jobs, registered candidates, visas approved and countries. Cached for 10 minutes.',
  })
  @ApiZodResponse(200, publicStatsSchema)
  stats(): Promise<PublicStats> {
    return this.catalog.publicStats();
  }
}
