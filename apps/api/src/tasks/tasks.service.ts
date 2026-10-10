import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../config/env.js';
import { JobAvailabilityService } from '../jobs/job-availability.service.js';
import { JobAlertsService } from '../public-forms/job-alerts.service.js';

export const TASK_NAMES = ['close-jobs', 'job-alerts'] as const;
export type TaskName = (typeof TASK_NAMES)[number];

export function isTaskName(value: string): value is TaskName {
  return (TASK_NAMES as readonly string[]).includes(value);
}

export interface TaskReport {
  task: TaskName;
  ok: boolean;
  /** False when another instance held the lock and this one skipped. */
  ran?: boolean;
  result?: unknown;
  error?: string;
}

/**
 * The scheduled work of the platform, in one place. Each task can be started
 * - by the in-process scheduler below, every 15 minutes, when SCHEDULER_ENABLED is
 *   true (local development);
 * - by the command line (`pnpm --filter @iconbridge/api task <name|all>`), which is
 *   what a scheduled Azure Container Apps Job runs, because the API scales to zero
 *   and its timers stop when nobody visits.
 * Both paths call the same functions, and each task takes a database advisory
 * lock, so running them at the same time is harmless.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly schedulerEnabled: boolean;

  constructor(
    private readonly jobAvailability: JobAvailabilityService,
    private readonly jobAlerts: JobAlertsService,
    config: ConfigService<Env, true>,
  ) {
    this.schedulerEnabled = config.get('SCHEDULER_ENABLED', { infer: true });
  }

  private readonly tasks: Record<TaskName, () => Promise<{ ran: boolean }>> = {
    'close-jobs': () => this.jobAvailability.closeUnavailableJobs(),
    'job-alerts': () => this.jobAlerts.sendDue(),
  };

  /** Runs one task. Never throws: a failure is logged and reported. */
  async run(task: TaskName): Promise<TaskReport> {
    try {
      const result = await this.tasks[task]();
      return { task, ok: true, ran: result.ran, result };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown error';
      this.logger.error(`Task ${task} failed: ${name}`);
      return { task, ok: false, error: name };
    }
  }

  /** Runs every task in order; one failing does not stop the next. */
  async runAll(): Promise<TaskReport[]> {
    const reports: TaskReport[] = [];
    for (const task of TASK_NAMES) {
      reports.push(await this.run(task));
    }
    return reports;
  }

  @Cron('0 */15 * * * *', { name: 'scheduled-tasks' })
  async scheduled(): Promise<void> {
    if (this.schedulerEnabled) {
      await this.runAll();
    }
  }
}
