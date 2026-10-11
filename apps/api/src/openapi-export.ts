import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument, configureHttp } from './app.setup.js';

/**
 * Writes the OpenAPI document to a file without starting the HTTP server:
 *
 *   pnpm --filter @iconbridge/api openapi:export [file]
 *
 * packages/shared generates the typed API client from it (`pnpm api:types`).
 */
const target = resolve(process.argv[2] ?? '../../packages/shared/openapi/openapi.json');
const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
configureHttp(app);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
await app.close();
process.stdout.write(`OpenAPI document written to ${target}\n`);
