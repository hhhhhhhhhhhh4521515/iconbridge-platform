import { Global, Module } from '@nestjs/common';
import { CandidatesModule } from '../candidates/candidates.module.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminStatsService } from './admin-stats.service.js';
import { AdminApplicationsController } from './applications/admin-applications.controller.js';
import { AdminApplicationsService } from './applications/admin-applications.service.js';
import { ApplicationExportService } from './applications/export.service.js';
import { AuditLogsController } from './audit/audit-logs.controller.js';
import { AuditSnapshotService } from './audit/audit-snapshot.service.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuditService } from './audit/audit.service.js';
import { AdminCandidatesController } from './candidates/admin-candidates.controller.js';
import { AdminCandidatesService } from './candidates/admin-candidates.service.js';
import { ContactMessagesController } from './contact-messages.controller.js';
import { AdminUsersController } from './users/admin-users.controller.js';
import { AdminUsersService } from './users/admin-users.service.js';

@Global()
@Module({
  imports: [CandidatesModule],
  controllers: [
    AdminUsersController,
    AuditLogsController,
    AdminApplicationsController,
    AdminCandidatesController,
    AdminSettingsController,
    ContactMessagesController,
  ],
  providers: [
    AdminUsersService,
    AuditSnapshotService,
    AuditInterceptor,
    AuditService,
    AdminApplicationsService,
    ApplicationExportService,
    AdminCandidatesService,
    AdminStatsService,
  ],
  exports: [AuditInterceptor, AuditSnapshotService, AuditService],
})
export class AdminModule {}
