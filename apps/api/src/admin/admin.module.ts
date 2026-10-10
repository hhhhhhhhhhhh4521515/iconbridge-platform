import { Module } from '@nestjs/common';
import { AuditLogsController } from './audit/audit-logs.controller.js';
import { AuditSnapshotService } from './audit/audit-snapshot.service.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AdminUsersController } from './users/admin-users.controller.js';
import { AdminUsersService } from './users/admin-users.service.js';

@Module({
  controllers: [AdminUsersController, AuditLogsController],
  providers: [AdminUsersService, AuditSnapshotService, AuditInterceptor],
  exports: [AuditInterceptor, AuditSnapshotService],
})
export class AdminModule {}
