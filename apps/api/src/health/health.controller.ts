import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Liveness, Readiness } from '@iconbridge/shared';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/index.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

const readinessExample = (status: 'ok' | 'error') => ({
  example: {
    status,
    version: '2039c607a36ddadb07b9332e404211b21f8178c6',
    checks: { database: status },
  },
});

/** Probe endpoints. Served at /health/*, outside the /api/v1 prefix. */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  /** The commit of the image: the deployment waits until the new revision answers with it. */
  private readonly version: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.version = config.get('APP_VERSION', { infer: true });
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running' })
  @ApiOkResponse({ schema: { example: { status: 'ok', version: 'dev' } } })
  live(): Liveness {
    return { status: 'ok', version: this.version };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the API can reach its database' })
  @ApiOkResponse({ schema: readinessExample('ok') })
  @ApiServiceUnavailableResponse({ schema: readinessExample('error') })
  async ready(@Res({ passthrough: true }) response: Response): Promise<Readiness> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        `Database readiness check failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      // Set directly: the probe body is not an API error and must keep its own shape.
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', version: this.version, checks: { database: 'error' } };
    }
    return { status: 'ok', version: this.version, checks: { database: 'ok' } };
  }
}
