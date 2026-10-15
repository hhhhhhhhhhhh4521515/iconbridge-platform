import type { ConfigService } from '@nestjs/config';
import { LOCALES } from '@iconbridge/shared';
import type { MailTransport } from './mail-transport.js';
import type { Env } from '../config/env.js';
import { Clock } from '../common/clock/clock.js';
import type { FieldCipher } from '../common/crypto/field-cipher.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { MailService, retryDelayMs } from './mail.service.js';
import { EMAIL_TEMPLATES } from './mail.templates.js';

const config = {
  get: (key: string) =>
    ({ MAIL_FROM: 'IconBridge Jobs <no-reply@example.test>', WEB_ORIGIN: 'http://localhost:3000' })[
      key
    ],
} as unknown as ConfigService<Env, true>;

function createService(sendMail = vi.fn().mockResolvedValue({})) {
  const transport = { sendMail } as unknown as MailTransport;
  // Rendering and the hand-over to the transport need no database; the outbox itself is
  // tested against PostgreSQL in test/e2e/email-outbox.e2e-spec.ts.
  const service = new MailService(
    transport,
    config,
    undefined as unknown as PrismaService,
    undefined as unknown as FieldCipher,
    new Clock(),
  );
  return { service, sendMail };
}

const variables = {
  actionUrl: 'http://localhost:3000/en/verify-email?token=abc',
  expiresInHours: 24,
};

describe('MailService', () => {
  const combinations = EMAIL_TEMPLATES.flatMap((template) =>
    LOCALES.map((locale) => [template, locale] as const),
  );

  it.each(combinations)(
    'renders %s in %s as valid MJML with the link',
    async (template, locale) => {
      const { service } = createService();
      const email = await service.render(template, locale, variables);
      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.html).toContain('token=abc');
      expect(email.text).toContain(variables.actionUrl);
      expect(email.html).toContain(`lang="${locale}"`);
    },
  );

  it('renders Arabic right-to-left and other languages left-to-right', async () => {
    const { service } = createService();
    expect((await service.render('verify-email', 'ar', variables)).html).toContain('dir="rtl"');
    expect((await service.render('verify-email', 'fr', variables)).html).toContain('dir="ltr"');
  });

  it('uses a different subject in each language', async () => {
    const { service } = createService();
    const subjects = await Promise.all(
      LOCALES.map(
        async (locale) => (await service.render('reset-password', locale, variables)).subject,
      ),
    );
    expect(new Set(subjects).size).toBe(LOCALES.length);
  });

  it('tells candidates they never pay, in the verification email', async () => {
    const { service } = createService();
    expect((await service.render('verify-email', 'en', variables)).text).toContain(
      'never asks candidates for money',
    );
  });

  it('escapes HTML in the link', async () => {
    const { service } = createService();
    const email = await service.render('verify-email', 'en', {
      ...variables,
      actionUrl: 'http://localhost:3000/en/verify-email?token=a"><script>x</script>',
    });
    expect(email.html).not.toContain('<script>x</script>');
  });

  it('builds links to the localised web pages', () => {
    const { service } = createService();
    expect(service.linkFor('verify-email', 'fr', 'tok en')).toBe(
      'http://localhost:3000/fr/verify-email?token=tok+en',
    );
    expect(service.linkFor('invitation', 'ar', 't')).toBe(
      'http://localhost:3000/ar/set-password?token=t',
    );
    expect(service.linkFor('account-exists', 'en')).toBe(
      'http://localhost:3000/en/forgot-password',
    );
  });

  it('hands the email to the transport with the configured sender', async () => {
    const { service, sendMail } = createService();
    await service.deliver('user@example.test', 'verify-email', 'en', variables, {
      replyTo: 'reply@example.test',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'IconBridge Jobs <no-reply@example.test>',
        to: 'user@example.test',
        replyTo: 'reply@example.test',
        subject: expect.stringContaining('Confirm your email') as string,
      }),
    );
  });

  it('lets the failure of the mail server reach the outbox, which will try again', async () => {
    const { service } = createService(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(
      service.deliver('user@example.test', 'verify-email', 'en', variables),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('waits longer after each failed attempt, up to six hours', () => {
    expect([1, 2, 3, 4, 8].map(retryDelayMs)).toEqual(
      [1, 2, 4, 8, 128].map((minutes) => minutes * 60_000),
    );
    expect(retryDelayMs(20)).toBe(6 * 3_600_000);
  });
});
