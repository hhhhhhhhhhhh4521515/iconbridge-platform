import { Module } from '@nestjs/common';
import { AccountController } from '../account/account.controller.js';
import { AccountService } from '../account/account.service.js';
import { ApplicationsController } from '../applications/applications.controller.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { DocumentsController } from '../documents/documents.controller.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

/** The candidate side: profile, documents, applications and GDPR rights. */
@Module({
  controllers: [ProfileController, DocumentsController, ApplicationsController, AccountController],
  providers: [ProfileService, DocumentsService, ApplicationsService, AccountService],
  exports: [ProfileService, DocumentsService, ApplicationsService, AccountService],
})
export class CandidatesModule {}
