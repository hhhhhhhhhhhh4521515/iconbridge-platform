import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminPartnerSpacesController } from './admin-partner-spaces.controller.js';
import { AdminPartnerSpacesService } from './admin-partner-spaces.service.js';
import { PartnerAreaController } from './partner-area.controller.js';
import { JobCoverService } from '../jobs/job-cover.service.js';
import { PartnerAreaService } from './partner-area.service.js';
import { PartnerFilesService } from './partner-files.service.js';
import { PartnerHistoryService } from './partner-history.service.js';
import { PartnerSpaceGuard } from './partner-space.guard.js';

/** Partner spaces (ADR-027): a private workspace per partner company. */
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [AdminPartnerSpacesController, PartnerAreaController],
  providers: [
    AdminPartnerSpacesService,
    PartnerAreaService,
    PartnerFilesService,
    PartnerHistoryService,
    // Stateless: the image checks of job covers, for the logo.
    JobCoverService,
    PartnerSpaceGuard,
  ],
})
export class PartnerSpacesModule {}
