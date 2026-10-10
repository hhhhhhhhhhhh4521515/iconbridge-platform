import type { Locale } from '@iconbridge/shared';

export const EMAIL_TEMPLATES = [
  'verify-email',
  'reset-password',
  'invitation',
  'account-exists',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/** Variables available to every template. */
export interface EmailVariables {
  /** Absolute link for the button; its target depends on the template. */
  actionUrl: string;
  /** How long the link works, in hours. */
  expiresInHours: number;
}

export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  buttonLabel: string;
  /** Shown under the button; anti-phishing and anti-scam reminders. */
  footnotes: string[];
}

type Builder = (variables: EmailVariables) => EmailContent;

const BRAND = 'IconBridge Jobs';

const NEVER_PAY: Record<Locale, string> = {
  en: `${BRAND} never asks candidates for money to apply.`,
  fr: `${BRAND} ne demande jamais d'argent aux candidats pour postuler.`,
  ar: `${BRAND} لا تطلب أبدًا أي مبلغ مالي من المترشحين للتقديم.`,
};

const en: Record<EmailTemplate, Builder> = {
  'verify-email': ({ expiresInHours }) => ({
    subject: `Confirm your email address - ${BRAND}`,
    heading: 'Confirm your email address',
    paragraphs: [
      `Welcome to ${BRAND}. Confirm your email address to finish creating your account.`,
      'You need a confirmed address before you can apply for a job.',
    ],
    buttonLabel: 'Confirm my email',
    footnotes: [
      `This link works for ${expiresInHours} hours.`,
      'If you did not create an account, ignore this email.',
      NEVER_PAY.en,
    ],
  }),
  'reset-password': ({ expiresInHours }) => ({
    subject: `Reset your password - ${BRAND}`,
    heading: 'Reset your password',
    paragraphs: ['We received a request to reset the password of your account.'],
    buttonLabel: 'Choose a new password',
    footnotes: [
      `This link works once, for ${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}.`,
      'If you did not ask for this, ignore this email: your password stays the same.',
    ],
  }),
  invitation: ({ expiresInHours }) => ({
    subject: `You are invited to ${BRAND}`,
    heading: 'Your administrator account',
    paragraphs: [
      `An administrator created an account for you on ${BRAND}.`,
      'Choose a password to activate it.',
    ],
    buttonLabel: 'Set my password',
    footnotes: [`This link works once, for ${expiresInHours} hours.`],
  }),
  'account-exists': () => ({
    subject: `You already have an account - ${BRAND}`,
    heading: 'You already have an account',
    paragraphs: [
      'Someone tried to create an account with this email address, but one already exists.',
      'If it was you, sign in, or reset your password if you forgot it.',
    ],
    buttonLabel: 'Reset my password',
    footnotes: ['If it was not you, ignore this email: nothing was changed.'],
  }),
};

const fr: Record<EmailTemplate, Builder> = {
  'verify-email': ({ expiresInHours }) => ({
    subject: `Confirmez votre adresse e-mail - ${BRAND}`,
    heading: 'Confirmez votre adresse e-mail',
    paragraphs: [
      `Bienvenue sur ${BRAND}. Confirmez votre adresse e-mail pour terminer la création de votre compte.`,
      'Une adresse confirmée est nécessaire pour postuler à une offre.',
    ],
    buttonLabel: 'Confirmer mon e-mail',
    footnotes: [
      `Ce lien est valable ${expiresInHours} heures.`,
      "Si vous n'avez pas créé de compte, ignorez cet e-mail.",
      NEVER_PAY.fr,
    ],
  }),
  'reset-password': ({ expiresInHours }) => ({
    subject: `Réinitialisez votre mot de passe - ${BRAND}`,
    heading: 'Réinitialisez votre mot de passe',
    paragraphs: [
      'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte.',
    ],
    buttonLabel: 'Choisir un nouveau mot de passe',
    footnotes: [
      `Ce lien est utilisable une seule fois, pendant ${expiresInHours} heure${expiresInHours === 1 ? '' : 's'}.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.",
    ],
  }),
  invitation: ({ expiresInHours }) => ({
    subject: `Vous êtes invité(e) sur ${BRAND}`,
    heading: 'Votre compte administrateur',
    paragraphs: [
      `Un administrateur vous a créé un compte sur ${BRAND}.`,
      "Choisissez un mot de passe pour l'activer.",
    ],
    buttonLabel: 'Définir mon mot de passe',
    footnotes: [`Ce lien est utilisable une seule fois, pendant ${expiresInHours} heures.`],
  }),
  'account-exists': () => ({
    subject: `Vous avez déjà un compte - ${BRAND}`,
    heading: 'Vous avez déjà un compte',
    paragraphs: [
      "Quelqu'un a essayé de créer un compte avec cette adresse e-mail, mais un compte existe déjà.",
      "Si c'était vous, connectez-vous, ou réinitialisez votre mot de passe si vous l'avez oublié.",
    ],
    buttonLabel: 'Réinitialiser mon mot de passe',
    footnotes: ["Si ce n'était pas vous, ignorez cet e-mail : rien n'a été modifié."],
  }),
};

const ar: Record<EmailTemplate, Builder> = {
  'verify-email': ({ expiresInHours }) => ({
    subject: `أكّد عنوان بريدك الإلكتروني - ${BRAND}`,
    heading: 'أكّد عنوان بريدك الإلكتروني',
    paragraphs: [
      `مرحبًا بك في ${BRAND}. أكّد عنوان بريدك الإلكتروني لإتمام إنشاء حسابك.`,
      'يجب تأكيد العنوان قبل التقديم على أي وظيفة.',
    ],
    buttonLabel: 'تأكيد بريدي الإلكتروني',
    footnotes: [
      `هذا الرابط صالح لمدة ${expiresInHours} ساعة.`,
      'إذا لم تقم بإنشاء حساب، تجاهل هذه الرسالة.',
      NEVER_PAY.ar,
    ],
  }),
  'reset-password': ({ expiresInHours }) => ({
    subject: `إعادة تعيين كلمة المرور - ${BRAND}`,
    heading: 'إعادة تعيين كلمة المرور',
    paragraphs: ['تلقّينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك.'],
    buttonLabel: 'اختيار كلمة مرور جديدة',
    footnotes: [
      `هذا الرابط صالح للاستخدام مرة واحدة ولمدة ${expiresInHours} ساعة.`,
      'إذا لم تطلب ذلك، تجاهل هذه الرسالة: كلمة المرور لن تتغيّر.',
    ],
  }),
  invitation: ({ expiresInHours }) => ({
    subject: `دعوة للانضمام إلى ${BRAND}`,
    heading: 'حسابك كمسؤول',
    paragraphs: [`أنشأ أحد المسؤولين حسابًا لك على ${BRAND}.`, 'اختر كلمة مرور لتفعيله.'],
    buttonLabel: 'تعيين كلمة المرور',
    footnotes: [`هذا الرابط صالح للاستخدام مرة واحدة ولمدة ${expiresInHours} ساعة.`],
  }),
  'account-exists': () => ({
    subject: `لديك حساب بالفعل - ${BRAND}`,
    heading: 'لديك حساب بالفعل',
    paragraphs: [
      'حاول شخص ما إنشاء حساب بهذا البريد الإلكتروني، لكن يوجد حساب مسجّل به بالفعل.',
      'إذا كنت أنت، سجّل الدخول، أو أعد تعيين كلمة المرور إذا نسيتها.',
    ],
    buttonLabel: 'إعادة تعيين كلمة المرور',
    footnotes: ['إذا لم تكن أنت، تجاهل هذه الرسالة: لم يتم تغيير أي شيء.'],
  }),
};

const CONTENT: Record<Locale, Record<EmailTemplate, Builder>> = { en, fr, ar };

export function emailContent(
  template: EmailTemplate,
  locale: Locale,
  variables: EmailVariables,
): EmailContent {
  return CONTENT[locale][template](variables);
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** MJML source of the single layout shared by all emails. Arabic is rendered right-to-left. */
export function emailMjml(content: EmailContent, locale: Locale, actionUrl: string): string {
  const rtl = locale === 'ar';
  const align = rtl ? 'right' : 'left';
  const text = (body: string, extra = '') =>
    `<mj-text align="${align}" ${extra}>${escapeHtml(body)}</mj-text>`;
  return `
<mjml lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">
  <mj-head>
    <mj-title>${escapeHtml(content.subject)}</mj-title>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#1f2937" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f3f4f6">
    <mj-section padding="24px 0 0">
      <mj-column>
        <mj-text align="center" font-size="18px" font-weight="700" color="#0f3d5c">${BRAND}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="24px">
      <mj-column>
        ${text(content.heading, 'font-size="20px" font-weight="700"')}
        ${content.paragraphs.map((paragraph) => text(paragraph)).join('\n        ')}
        <mj-button href="${escapeHtml(actionUrl)}" background-color="#0f3d5c" color="#ffffff" border-radius="6px" font-size="15px" align="${align}">${escapeHtml(content.buttonLabel)}</mj-button>
        ${content.footnotes.map((note) => text(note, 'font-size="13px" color="#6b7280"')).join('\n        ')}
        <mj-text align="${align}" font-size="12px" color="#6b7280" css-class="link"><span dir="ltr">${escapeHtml(actionUrl)}</span></mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

/** Plain-text alternative, for clients that do not show HTML. */
export function emailText(content: EmailContent, actionUrl: string): string {
  return [
    content.heading,
    '',
    ...content.paragraphs,
    '',
    `${content.buttonLabel}: ${actionUrl}`,
    '',
    ...content.footnotes,
  ].join('\n');
}
