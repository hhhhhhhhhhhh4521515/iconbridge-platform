import { Module } from '@nestjs/common';
import {
  AdminCategoriesController,
  AdminDestinationsController,
} from '../catalog/admin-catalog.controller.js';
import { AdminCatalogService } from '../catalog/admin-catalog.service.js';
import { CatalogController } from '../catalog/catalog.controller.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ResultsService } from '../catalog/results.service.js';
import { AdminJobsController } from './admin-jobs.controller.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { JobAvailabilityService } from './job-availability.service.js';
import { JobCoverService } from './job-cover.service.js';
import { PublicJobsController } from './public-jobs.controller.js';
import { PublicJobsService } from './public-jobs.service.js';

/** Job offers and their catalogue (destinations, categories), public and back-office sides. */
@Module({
  controllers: [
    PublicJobsController,
    CatalogController,
    AdminJobsController,
    AdminDestinationsController,
    AdminCategoriesController,
  ],
  providers: [
    PublicJobsService,
    CatalogService,
    ResultsService,
    AdminJobsService,
    AdminCatalogService,
    JobCoverService,
    JobAvailabilityService,
  ],
  exports: [JobAvailabilityService, CatalogService, ResultsService, JobCoverService],
})
export class JobsModule {}
