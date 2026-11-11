import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminPartnerSpacesController } from './admin-partner-spaces.controller.js';
import { AdminPartnerSpacesService } from './admin-partner-spaces.service.js';
import { PartnerHistoryService } from './partner-history.service.js';

/** Partner spaces (ADR-027): a private workspace per partner company. */
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [AdminPartnerSpacesController],
  providers: [AdminPartnerSpacesService, PartnerHistoryService],
})
export class PartnerSpacesModule {}
