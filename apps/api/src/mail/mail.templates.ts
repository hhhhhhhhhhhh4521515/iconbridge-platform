import type { ApplicationStatus, Locale } from '@iconbridge/shared';

export const EMAIL_TEMPLATES = [
  'verify-email',
  'reset-password',
  'invitation',
  'account-exists',
  'application-received',
  'new-application',
  'application-status',
  'application-status-correction',
  'retention-warning',
  'job-alert-confirm',
  'job-alert',
  'contact-message',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/** Variables available to the templates. */
export interface EmailVariables {
  /** Absolute link for the button; its target depends on the template. */
  actionUrl: string;
  /** How long the link works, in hours (templates with a one-time link). */
  expiresInHours?: number;
  /** Title of the job (application templates). */
  jobTitle?: string;
  /** New status of the application (application-status). */
  status?: ApplicationStatus;
  /** Free text: the recruiter's message to the candidate, or a contact-form message. */
  message?: string | null;
  /** Links listed in the email (job alerts): one per job. */
  links?: { label: string; url: string }[];
  /** Day the account will be erased, already written for the reader (retention warning). */
  date?: string;
  /** Link to stop receiving these emails (job alerts). */
  unsubscribeUrl?: string;
  /** Who wrote through the contact form. */
  sender?: { name: string; email: string; phone: string | null; subject: string | null };
}

export interface EmailContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  buttonLabel: string;
  /** Shown under the button; anti-phishing and anti-scam reminders. */
  footnotes: string[];
  /** A quoted block (message written by a person), shown as is. */
  quote?: string | null;
  /** A list of links above the button. */
  links?: { label: string; url: string }[];
}

type Builder = (variables: EmailVariables) => EmailContent;

const BRAND = 'IconBridge Jobs';

const NEVER_PAY: Record<Locale, string> = {
  en: `${BRAND} never asks candidates for money to apply.`,
  fr: `${BRAND} ne demande jamais d'argent aux candidats pour postuler.`,
  ar: `${BRAND} لا تطلب أبدًا أي مبلغ مالي من المترشحين للتقديم.`,
};

/** Names of the application statuses, as candidates read them. */
export const STATUS_LABELS: Record<Locale, Record<ApplicationStatus, string>> = {
  en: {
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under review',
    SHORTLISTED: 'Shortlisted',
    INTERVIEW: 'Interview',
    OFFER: 'Offer',
    CONTRACT_SIGNED: 'Contract signed',
    VISA_PROCESSING: 'Visa processing',
    VISA_APPROVED: 'Visa approved',
    DEPLOYED: 'Deployed',
    REJECTED: 'Not selected',
    WITHDRAWN: 'Withdrawn',
  },
  fr: {
    SUBMITTED: 'Envoyée',
    UNDER_REVIEW: "En cours d'examen",
    SHORTLISTED: 'Présélectionnée',
    INTERVIEW: 'Entretien',
    OFFER: 'Offre',
    CONTRACT_SIGNED: 'Contrat signé',
    VISA_PROCESSING: 'Visa en cours',
    VISA_APPROVED: 'Visa approuvé',
    DEPLOYED: 'En poste',
    REJECTED: 'Non retenue',
    WITHDRAWN: 'Retirée',
  },
  ar: {
    SUBMITTED: 'تم الإرسال',
    UNDER_REVIEW: 'قيد المراجعة',
    SHORTLISTED: 'ضمن القائمة المختصرة',
    INTERVIEW: 'مقابلة',
    OFFER: 'عرض عمل',
    CONTRACT_SIGNED: 'تم توقيع العقد',
    VISA_PROCESSING: 'التأشيرة قيد المعالجة',
    VISA_APPROVED: 'تمت الموافقة على التأشيرة',
    DEPLOYED: 'التحق بالعمل',
    REJECTED: 'لم يتم الاختيار',
    WITHDRAWN: 'تم السحب',
  },
};

const en: Record<EmailTemplate, Builder> = {
  'verify-email': ({ expiresInHours = 0 }) => ({
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
  'reset-password': ({ expiresInHours = 0 }) => ({
    subject: `Reset your password - ${BRAND}`,
    heading: 'Reset your password',
    paragraphs: ['We received a request to reset the password of your account.'],
    buttonLabel: 'Choose a new password',
    footnotes: [
      `This link works once, for ${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}.`,
      'If you did not ask for this, ignore this email: your password stays the same.',
    ],
  }),
  invitation: ({ expiresInHours = 0 }) => ({
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
  'application-received': ({ jobTitle = '' }) => ({
    subject: `We received your application - ${BRAND}`,
    heading: 'Application received',
    paragraphs: [
      `Your application for "${jobTitle}" has been received.`,
      'We will email you each time its status changes. You can follow it in your account.',
    ],
    buttonLabel: 'View my applications',
    footnotes: [NEVER_PAY.en],
  }),
  'new-application': ({ jobTitle = '' }) => ({
    subject: `New application: ${jobTitle} - ${BRAND}`,
    heading: 'New application',
    paragraphs: [`A candidate applied for "${jobTitle}".`],
    buttonLabel: 'Open the application',
    footnotes: ['You receive this email because you are a recruiter on the platform.'],
  }),
  'application-status': ({ jobTitle = '', status = 'UNDER_REVIEW', message }) => ({
    subject: `Your application: ${STATUS_LABELS.en[status]} - ${BRAND}`,
    heading: `Status: ${STATUS_LABELS.en[status]}`,
    paragraphs: [
      `The status of your application for "${jobTitle}" is now: ${STATUS_LABELS.en[status]}.`,
    ],
    quote: message ?? null,
    buttonLabel: 'View my applications',
    footnotes: [NEVER_PAY.en],
  }),
  'application-status-correction': ({ jobTitle = '', status = 'UNDER_REVIEW' }) => ({
    subject: `Correction about your application - ${BRAND}`,
    heading: 'Correction',
    paragraphs: [
      `Our last message about your application for "${jobTitle}" was sent by mistake. Please ignore it. The status of your application is: ${STATUS_LABELS.en[status]}.`,
    ],
    buttonLabel: 'View my applications',
    footnotes: [NEVER_PAY.en],
  }),
  'retention-warning': ({ date = '' }) => ({
    subject: `Your account will be deleted soon - ${BRAND}`,
    heading: 'Your account has not been used for a long time',
    paragraphs: [
      `You have not signed in to ${BRAND} for almost two years. To protect your personal data, your account, your profile and your documents will be deleted on ${date}.`,
      'To keep your account, sign in before that date. If you no longer need it, you have nothing to do.',
    ],
    buttonLabel: 'Sign in to keep my account',
    footnotes: [NEVER_PAY.en],
  }),
  'job-alert-confirm': ({ expiresInHours = 0 }) => ({
    subject: `Confirm your job alert - ${BRAND}`,
    heading: 'Confirm your job alert',
    paragraphs: ['Confirm your email address to receive new job offers that match your choices.'],
    buttonLabel: 'Confirm my alert',
    footnotes: [
      `This link works for ${expiresInHours} hours.`,
      'If you did not ask for this, ignore this email: you will receive nothing.',
    ],
  }),
  'job-alert': ({ links = [], unsubscribeUrl = '' }) => ({
    subject: `${links.length} new job${links.length === 1 ? '' : 's'} for you - ${BRAND}`,
    heading: 'New jobs matching your alert',
    paragraphs: ['These offers were published recently:'],
    links,
    buttonLabel: 'See all jobs',
    footnotes: [NEVER_PAY.en, `To stop these emails: ${unsubscribeUrl}`],
  }),
  'contact-message': ({ sender, message }) => ({
    subject: `Contact form: ${sender?.subject ?? 'new message'} - ${BRAND}`,
    heading: 'Message from the contact form',
    paragraphs: [
      `From: ${sender?.name ?? ''} <${sender?.email ?? ''}>`,
      ...(sender?.phone ? [`Phone: ${sender.phone}`] : []),
    ],
    quote: message ?? null,
    buttonLabel: 'Open the site',
    footnotes: ['Reply to this email to answer the sender.'],
  }),
};

const fr: Record<EmailTemplate, Builder> = {
  'verify-email': ({ expiresInHours = 0 }) => ({
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
  'reset-password': ({ expiresInHours = 0 }) => ({
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
  invitation: ({ expiresInHours = 0 }) => ({
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
  'application-received': ({ jobTitle = '' }) => ({
    subject: `Nous avons bien reçu votre candidature - ${BRAND}`,
    heading: 'Candidature reçue',
    paragraphs: [
      `Votre candidature pour « ${jobTitle} » a bien été reçue.`,
      'Vous recevrez un e-mail à chaque changement de statut. Vous pouvez la suivre dans votre compte.',
    ],
    buttonLabel: 'Voir mes candidatures',
    footnotes: [NEVER_PAY.fr],
  }),
  'new-application': ({ jobTitle = '' }) => ({
    subject: `Nouvelle candidature : ${jobTitle} - ${BRAND}`,
    heading: 'Nouvelle candidature',
    paragraphs: [`Un candidat a postulé pour « ${jobTitle} ».`],
    buttonLabel: 'Ouvrir la candidature',
    footnotes: ['Vous recevez cet e-mail car vous êtes recruteur sur la plateforme.'],
  }),
  'application-status': ({ jobTitle = '', status = 'UNDER_REVIEW', message }) => ({
    subject: `Votre candidature : ${STATUS_LABELS.fr[status]} - ${BRAND}`,
    heading: `Statut : ${STATUS_LABELS.fr[status]}`,
    paragraphs: [
      `Le statut de votre candidature pour « ${jobTitle} » est désormais : ${STATUS_LABELS.fr[status]}.`,
    ],
    quote: message ?? null,
    buttonLabel: 'Voir mes candidatures',
    footnotes: [NEVER_PAY.fr],
  }),
  'application-status-correction': ({ jobTitle = '', status = 'UNDER_REVIEW' }) => ({
    subject: `Rectification concernant votre candidature - ${BRAND}`,
    heading: 'Rectification',
    paragraphs: [
      `Notre dernier message concernant votre candidature pour « ${jobTitle} » a été envoyé par erreur. Merci de ne pas en tenir compte. Le statut de votre candidature est : ${STATUS_LABELS.fr[status]}.`,
    ],
    buttonLabel: 'Voir mes candidatures',
    footnotes: [NEVER_PAY.fr],
  }),
  'retention-warning': ({ date = '' }) => ({
    subject: `Votre compte sera bientôt supprimé - ${BRAND}`,
    heading: "Votre compte n'est plus utilisé depuis longtemps",
    paragraphs: [
      `Vous ne vous êtes pas connecté à ${BRAND} depuis près de deux ans. Pour protéger vos données personnelles, votre compte, votre profil et vos documents seront supprimés le ${date}.`,
      "Pour conserver votre compte, connectez-vous avant cette date. Si vous n'en avez plus besoin, vous n'avez rien à faire.",
    ],
    buttonLabel: 'Me connecter pour garder mon compte',
    footnotes: [NEVER_PAY.fr],
  }),
  'job-alert-confirm': ({ expiresInHours = 0 }) => ({
    subject: `Confirmez votre alerte emploi - ${BRAND}`,
    heading: 'Confirmez votre alerte emploi',
    paragraphs: [
      'Confirmez votre adresse e-mail pour recevoir les nouvelles offres qui correspondent à vos choix.',
    ],
    buttonLabel: 'Confirmer mon alerte',
    footnotes: [
      `Ce lien est valable ${expiresInHours} heures.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : vous ne recevrez rien.",
    ],
  }),
  'job-alert': ({ links = [], unsubscribeUrl = '' }) => ({
    subject: `${links.length} ${links.length === 1 ? 'nouvelle offre' : 'nouvelles offres'} pour vous - ${BRAND}`,
    heading: 'Nouvelles offres correspondant à votre alerte',
    paragraphs: ['Ces offres ont été publiées récemment :'],
    links,
    buttonLabel: 'Voir toutes les offres',
    footnotes: [NEVER_PAY.fr, `Pour ne plus recevoir ces e-mails : ${unsubscribeUrl}`],
  }),
  'contact-message': ({ sender, message }) => ({
    subject: `Formulaire de contact : ${sender?.subject ?? 'nouveau message'} - ${BRAND}`,
    heading: 'Message du formulaire de contact',
    paragraphs: [
      `De : ${sender?.name ?? ''} <${sender?.email ?? ''}>`,
      ...(sender?.phone ? [`Téléphone : ${sender.phone}`] : []),
    ],
    quote: message ?? null,
    buttonLabel: 'Ouvrir le site',
    footnotes: ["Répondez à cet e-mail pour répondre à l'expéditeur."],
  }),
};

const ar: Record<EmailTemplate, Builder> = {
  'verify-email': ({ expiresInHours = 0 }) => ({
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
  'reset-password': ({ expiresInHours = 0 }) => ({
    subject: `إعادة تعيين كلمة المرور - ${BRAND}`,
    heading: 'إعادة تعيين كلمة المرور',
    paragraphs: ['تلقّينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك.'],
    buttonLabel: 'اختيار كلمة مرور جديدة',
    footnotes: [
      `هذا الرابط صالح للاستخدام مرة واحدة ولمدة ${expiresInHours} ساعة.`,
      'إذا لم تطلب ذلك، تجاهل هذه الرسالة: كلمة المرور لن تتغيّر.',
    ],
  }),
  invitation: ({ expiresInHours = 0 }) => ({
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
  'application-received': ({ jobTitle = '' }) => ({
    subject: `لقد استلمنا طلبك - ${BRAND}`,
    heading: 'تم استلام الطلب',
    paragraphs: [
      `تم استلام طلبك لوظيفة «${jobTitle}».`,
      'سنرسل إليك بريدًا إلكترونيًا عند كل تغيير في حالة الطلب. يمكنك متابعته من حسابك.',
    ],
    buttonLabel: 'عرض طلباتي',
    footnotes: [NEVER_PAY.ar],
  }),
  'new-application': ({ jobTitle = '' }) => ({
    subject: `طلب جديد: ${jobTitle} - ${BRAND}`,
    heading: 'طلب جديد',
    paragraphs: [`تقدّم مترشح لوظيفة «${jobTitle}».`],
    buttonLabel: 'فتح الطلب',
    footnotes: ['تصلك هذه الرسالة لأنك مسؤول توظيف على المنصة.'],
  }),
  'application-status': ({ jobTitle = '', status = 'UNDER_REVIEW', message }) => ({
    subject: `طلبك: ${STATUS_LABELS.ar[status]} - ${BRAND}`,
    heading: `الحالة: ${STATUS_LABELS.ar[status]}`,
    paragraphs: [`أصبحت حالة طلبك لوظيفة «${jobTitle}»: ${STATUS_LABELS.ar[status]}.`],
    quote: message ?? null,
    buttonLabel: 'عرض طلباتي',
    footnotes: [NEVER_PAY.ar],
  }),
  'application-status-correction': ({ jobTitle = '', status = 'UNDER_REVIEW' }) => ({
    subject: `تصحيح بخصوص طلبك - ${BRAND}`,
    heading: 'تصحيح',
    paragraphs: [
      `أُرسلت رسالتنا الأخيرة بخصوص طلبك لوظيفة «${jobTitle}» عن طريق الخطأ. نرجو تجاهلها. حالة طلبك هي: ${STATUS_LABELS.ar[status]}.`,
    ],
    buttonLabel: 'عرض طلباتي',
    footnotes: [NEVER_PAY.ar],
  }),
  'retention-warning': ({ date = '' }) => ({
    subject: `سيُحذف حسابك قريبًا - ${BRAND}`,
    heading: 'لم يُستخدم حسابك منذ مدة طويلة',
    paragraphs: [
      `لم تسجّل الدخول إلى ${BRAND} منذ قرابة سنتين. لحماية بياناتك الشخصية، سيُحذف حسابك وملفك الشخصي ومستنداتك بتاريخ ${date}.`,
      'للاحتفاظ بحسابك، سجّل الدخول قبل هذا التاريخ. إذا لم تعد بحاجة إليه، فلا يلزمك فعل أي شيء.',
    ],
    buttonLabel: 'تسجيل الدخول للاحتفاظ بحسابي',
    footnotes: [NEVER_PAY.ar],
  }),
  'job-alert-confirm': ({ expiresInHours = 0 }) => ({
    subject: `أكّد تنبيه الوظائف - ${BRAND}`,
    heading: 'أكّد تنبيه الوظائف',
    paragraphs: ['أكّد عنوان بريدك الإلكتروني لتصلك عروض العمل الجديدة المطابقة لاختياراتك.'],
    buttonLabel: 'تأكيد التنبيه',
    footnotes: [
      `هذا الرابط صالح لمدة ${expiresInHours} ساعة.`,
      'إذا لم تطلب ذلك، تجاهل هذه الرسالة: لن يصلك أي شيء.',
    ],
  }),
  'job-alert': ({ links = [], unsubscribeUrl = '' }) => ({
    subject: `وظائف جديدة لك (${links.length}) - ${BRAND}`,
    heading: 'وظائف جديدة مطابقة لتنبيهك',
    paragraphs: ['تم نشر هذه العروض مؤخرًا:'],
    links,
    buttonLabel: 'عرض كل الوظائف',
    footnotes: [NEVER_PAY.ar, `لإيقاف هذه الرسائل: ${unsubscribeUrl}`],
  }),
  'contact-message': ({ sender, message }) => ({
    subject: `نموذج الاتصال: ${sender?.subject ?? 'رسالة جديدة'} - ${BRAND}`,
    heading: 'رسالة من نموذج الاتصال',
    paragraphs: [
      `من: ${sender?.name ?? ''} <${sender?.email ?? ''}>`,
      ...(sender?.phone ? [`الهاتف: ${sender.phone}`] : []),
    ],
    quote: message ?? null,
    buttonLabel: 'فتح الموقع',
    footnotes: ['ردّ على هذه الرسالة للإجابة على المرسل.'],
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
        ${content.quote ? `<mj-text align="${align}" padding="12px 16px" container-background-color="#f3f4f6" font-style="italic">${escapeHtml(content.quote).replaceAll('\n', '<br />')}</mj-text>` : ''}
        ${(content.links ?? []).map((link) => `<mj-text align="${align}" padding-top="0" padding-bottom="4px"><a href="${escapeHtml(link.url)}" style="color:#0f3d5c;font-weight:700;">${escapeHtml(link.label)}</a></mj-text>`).join('\n        ')}
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
    ...(content.quote ? ['', content.quote] : []),
    ...(content.links ?? []).map((link) => `- ${link.label}: ${link.url}`),
    '',
    `${content.buttonLabel}: ${actionUrl}`,
    '',
    ...content.footnotes,
  ].join('\n');
}
