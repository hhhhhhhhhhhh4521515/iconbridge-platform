import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Env } from '../config/env.js';
import { AzureEmailTransport } from './azure-email.transport.js';
import type { MailTransport } from './mail-transport.js';
import { MAIL_TRANSPORT, MailService, OUTBOX_CONCURRENCY } from './mail.service.js';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailTransport => {
        // Azure: Communication Services Email with the managed identity, no password.
        if (config.get('EMAIL_TRANSPORT', { infer: true }) === 'azure') {
          return AzureEmailTransport.create(
            config.get('AZURE_COMMUNICATION_ENDPOINT', { infer: true }),
          );
        }
        const user = config.get('SMTP_USER', { infer: true });
        const production = config.get('NODE_ENV', { infer: true }) === 'production';
        return createTransport({
          host: config.get('SMTP_HOST', { infer: true }),
          port: config.get('SMTP_PORT', { infer: true }),
          // Port 587: the connection starts in clear and is upgraded with STARTTLS.
          secure: false,
          // Never send credentials or mail over an unencrypted connection in production.
          requireTLS: production,
          // The outbox sends a few emails at a time: keep the connections open between them.
          pool: true,
          maxConnections: OUTBOX_CONCURRENCY,
          ...(user ? { auth: { user, pass: config.get('SMTP_PASSWORD', { infer: true }) } } : {}),
        });
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
