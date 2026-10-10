import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { isTaskName, TASK_NAMES, TasksService } from './tasks/tasks.service.js';

/**
 * Command line for the scheduled tasks:
 *
 *   pnpm --filter @iconbridge/api task close-jobs
 *   pnpm --filter @iconbridge/api task job-alerts
 *   pnpm --filter @iconbridge/api task all
 *
 * In Azure a scheduled Container Apps Job runs `node dist/cli.js all`. The
 * process starts the application without the HTTP server, runs the task, prints
 * one JSON report per task and exits with 1 if any task failed.
 */
async function main(): Promise<number> {
  const name = process.argv[2] ?? '';
  if (name !== 'all' && !isTaskName(name)) {
    process.stderr.write(`Usage: task <${[...TASK_NAMES, 'all'].join('|')}>\n`);
    return 2;
  }
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  try {
    const tasks = app.get(TasksService);
    const reports = name === 'all' ? await tasks.runAll() : [await tasks.run(name)];
    for (const report of reports) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    }
    return reports.every((report) => report.ok) ? 0 : 1;
  } finally {
    await app.close();
  }
}

process.exitCode = await main();
