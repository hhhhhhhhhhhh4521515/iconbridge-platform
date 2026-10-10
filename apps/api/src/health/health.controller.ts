import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
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
import { PrismaService } from '../prisma/prisma.service.js';

const readinessExample = (status: 'ok' | 'error') => ({
  example: { status, checks: { database: status } },
});

/** Probe endpoints. Served at /health/*, outside the /api/v1 prefix. */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  live(): Liveness {
    return { status: 'ok' };
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
      return { status: 'error', checks: { database: 'error' } };
    }
    return { status: 'ok', checks: { database: 'ok' } };
  }
}
