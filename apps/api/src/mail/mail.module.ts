import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import { MAIL_TRANSPORT, MailService } from './mail.service.js';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Transporter => {
        const user = config.get('SMTP_USER', { infer: true });
        const production = config.get('NODE_ENV', { infer: true }) === 'production';
        return createTransport({
          host: config.get('SMTP_HOST', { infer: true }),
          port: config.get('SMTP_PORT', { infer: true }),
          // Port 587: the connection starts in clear and is upgraded with STARTTLS.
          secure: false,
          // Never send credentials or mail over an unencrypted connection in production.
          requireTLS: production,
          ...(user ? { auth: { user, pass: config.get('SMTP_PASSWORD', { infer: true }) } } : {}),
        });
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
