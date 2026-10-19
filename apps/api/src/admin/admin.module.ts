import { Global, Module } from '@nestjs/common';
import { CandidatesModule } from '../candidates/candidates.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { AdminDiagnosticsController } from './admin-diagnostics.controller.js';
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
import { DeletionService } from './deletion.service.js';
import { AdminJobAlertsController } from './job-alerts.controller.js';
import { HistoricalFiguresController } from './historical-figures.controller.js';
import { ContactMessagesController } from './contact-messages.controller.js';
import { AdminUsersController } from './users/admin-users.controller.js';
import { AdminUsersService } from './users/admin-users.service.js';

@Global()
@Module({
  imports: [CandidatesModule, JobsModule],
  controllers: [
    AdminUsersController,
    AuditLogsController,
    AdminApplicationsController,
    AdminCandidatesController,
    AdminSettingsController,
    AdminDiagnosticsController,
    ContactMessagesController,
    HistoricalFiguresController,
    AdminJobAlertsController,
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
    DeletionService,
  ],
  exports: [AuditInterceptor, AuditSnapshotService, AuditService],
})
export class AdminModule {}
