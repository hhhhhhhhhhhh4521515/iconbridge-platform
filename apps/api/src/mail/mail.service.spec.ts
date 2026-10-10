import type { ConfigService } from '@nestjs/config';
import { LOCALES } from '@iconbridge/shared';
import type { Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';
import { MailService } from './mail.service.js';
import { EMAIL_TEMPLATES } from './mail.templates.js';

const config = {
  get: (key: string) =>
    ({ MAIL_FROM: 'IconBridge Jobs <no-reply@example.test>', WEB_ORIGIN: 'http://localhost:3000' })[
      key
    ],
} as unknown as ConfigService<Env, true>;

function createService(sendMail = vi.fn().mockResolvedValue({})) {
  const transport = { sendMail } as unknown as Transporter;
  return { service: new MailService(transport, config), sendMail };
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

  it('sends through the transport with the configured sender', async () => {
    const { service, sendMail } = createService();
    expect(await service.send('user@example.test', 'verify-email', 'en', variables)).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'IconBridge Jobs <no-reply@example.test>',
        to: 'user@example.test',
        subject: expect.stringContaining('Confirm your email') as string,
      }),
    );
  });

  it('returns false instead of throwing when the server refuses the message', async () => {
    const { service } = createService(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await service.send('user@example.test', 'verify-email', 'en', variables)).toBe(false);
  });
});
