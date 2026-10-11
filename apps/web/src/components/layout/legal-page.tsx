import { getFormatter, getTranslations } from 'next-intl/server';

/** Date of the last change of the legal texts; update it together with the messages. */
const LAST_UPDATED = new Date('2026-10-11T00:00:00Z');

export async function LegalPage({
  document,
  sections,
}: {
  document: 'privacy' | 'terms';
  sections: readonly string[];
}) {
  const [t, format] = await Promise.all([getTranslations('legal'), getFormatter()]);
  return (
    <article className="container-page max-w-3xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">{t(`${document}.title`)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('updated', { date: format.dateTime(LAST_UPDATED, { dateStyle: 'long' }) })}
      </p>
      <p
        role="note"
        className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground"
      >
        {t('draftNotice')}
      </p>
      {sections.map((key) => (
        <section key={key} className="mt-8">
          <h2 className="text-xl font-semibold">{t(`${document}.sections.${key}.title`)}</h2>
          <p className="mt-2 text-base leading-relaxed">{t(`${document}.sections.${key}.text`)}</p>
        </section>
      ))}
    </article>
  );
}
