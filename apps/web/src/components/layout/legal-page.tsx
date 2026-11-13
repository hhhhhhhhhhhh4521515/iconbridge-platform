import { getFormatter, getTranslations } from 'next-intl/server';

/** Date of the last change of each legal text; update it together with the messages. */
const LAST_UPDATED = {
  privacy: new Date('2026-11-13T00:00:00Z'),
  terms: new Date('2026-10-11T00:00:00Z'),
};

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
        {t('updated', { date: format.dateTime(LAST_UPDATED[document], { dateStyle: 'long' }) })}
      </p>
      {sections.map((key) => (
        <section key={key} className="mt-8">
          <h2 className="text-xl font-semibold">{t(`${document}.sections.${key}.title`)}</h2>
          {/* One paragraph per line of the message. */}
          {t(`${document}.sections.${key}.text`)
            .split('\n')
            .map((paragraph) => (
              <p key={paragraph} className="mt-2 text-base leading-relaxed">
                {paragraph}
              </p>
            ))}
        </section>
      ))}
    </article>
  );
}
