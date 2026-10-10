import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { JobAlertsService } from '../public-forms/job-alerts.service.js';
import { PublicFormsController } from '../public-forms/public-forms.controller.js';
import { TaskLockService } from '../tasks/task-lock.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import {
  AdminHomeSlidesController,
  AdminSuccessStoriesController,
  PublicContentController,
} from './content.controller.js';
import { ContentService } from './content.service.js';

/** Site content (success stories, home slides), public forms (job alerts, contact) and scheduled tasks. */
@Module({
  imports: [JobsModule],
  controllers: [
    PublicContentController,
    AdminSuccessStoriesController,
    AdminHomeSlidesController,
    PublicFormsController,
  ],
  providers: [ContentService, JobAlertsService, TaskLockService, TasksService],
  exports: [TasksService, JobAlertsService],
})
export class ContentModule {}
