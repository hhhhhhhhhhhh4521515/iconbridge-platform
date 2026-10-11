import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adminContactMessageSchema,
  contactMessageListQuerySchema,
  PERMISSIONS,
  uuidParamSchema,
  type AdminContactMessage,
  type ContactMessageListQuery,
  type Paginated,
} from '@iconbridge/shared';
import { z } from 'zod';
import { Roles } from '../auth/decorators/index.js';
import { Clock } from '../common/clock/clock.js';
import { notFound } from '../common/errors/app.exception.js';
import { ZodParams, ZodQuery } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import type { ContactMessage, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Audit } from './audit/audit.decorator.js';

const pageSchema = z.object({
  items: z.array(adminContactMessageSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  /** Messages still to handle, whatever the filter. */
  unhandled: z.number().int(),
});
type Page = Paginated<AdminContactMessage> & { unhandled: number };

const toMessage = (row: ContactMessage): AdminContactMessage => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  subject: row.subject,
  message: row.message,
  handledAt: row.handledAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Inbox of the contact form. Everybody in the back office reads; recruiters and super admins mark as handled. */
@ApiTags('admin: contact messages')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_CONTENT)
@Controller('admin/contact-messages')
export class ContactMessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  @ApiOperation({ summary: 'Messages of the contact form, newest first' })
  @ApiQuery({ name: 'handled', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'q', required: false, description: 'Part of the name, email or subject' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiZodResponse(200, pageSchema)
  @ApiErrors(400, 401, 403)
  async list(
    @ZodQuery(contactMessageListQuerySchema) query: ContactMessageListQuery,
  ): Promise<Page> {
    const where: Prisma.ContactMessageWhereInput = {
      ...(query.handled === undefined ? {} : { handledAt: query.handled ? { not: null } : null }),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q.toLowerCase() } },
              { subject: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total, unhandled] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.count({ where: { handledAt: null } }),
    ]);
    return {
      items: rows.map(toMessage),
      page: query.page,
      pageSize: query.pageSize,
      total,
      unhandled,
    };
  }

  @Post(':id/handle')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'contact_message.handle', entityType: 'contactMessage', idParam: 'id' })
  @ApiOperation({ summary: 'Mark a message as handled' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminContactMessageSchema)
  @ApiErrors(401, 403, 404)
  handle(@ZodParams(uuidParamSchema) params: { id: string }): Promise<AdminContactMessage> {
    return this.setHandled(params.id, this.clock.now());
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: 'contact_message.reopen', entityType: 'contactMessage', idParam: 'id' })
  @ApiOperation({ summary: 'Put a message back among those to handle' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(200, adminContactMessageSchema)
  @ApiErrors(401, 403, 404)
  reopen(@ZodParams(uuidParamSchema) params: { id: string }): Promise<AdminContactMessage> {
    return this.setHandled(params.id, null);
  }

  private async setHandled(id: string, handledAt: Date | null): Promise<AdminContactMessage> {
    const updated = await this.prisma.contactMessage.updateMany({
      where: { id },
      data: { handledAt },
    });
    if (updated.count === 0) {
      throw notFound('Message not found');
    }
    return toMessage(await this.prisma.contactMessage.findUniqueOrThrow({ where: { id } }));
  }
}
