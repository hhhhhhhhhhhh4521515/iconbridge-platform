/** True when a text holds HTML written with the editor of the back office. */
export function isRichText(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

/** The words of a text without its formatting, for descriptions, search engines and previews. */
export function plainText(text: string): string {
  if (!isRichText(text)) {
    return text;
  }
  return text
    .replace(/<\/(p|li|h3|h4|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PLAIN = 'leading-relaxed whitespace-pre-line text-foreground/90';

/**
 * A long text of a job. Texts written with the editor are HTML that the API has
 * reduced to a short list of formatting tags, on writing and again on reading;
 * older texts are plain and keep their line breaks.
 */
export function RichText({ text }: { text: string }) {
  return isRichText(text) ? (
    <div className="rich-text" dangerouslySetInnerHTML={{ __html: text }} />
  ) : (
    <p className={PLAIN}>{text}</p>
  );
}
