import sanitizeHtml from 'sanitize-html';

/** True when a text holds HTML written with the editor of the back office. */
export function isRichText(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'h3',
    'h4',
    'a',
    'blockquote',
  ],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  // Links written by a recruiter open in a new tab and pass no ranking or referrer.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
  },
};

/**
 * Texts of a job (description, requirements, benefits) come from a rich-text editor.
 * Only a short list of formatting tags is kept; scripts, styles, event handlers and
 * unknown tags are removed before the text is stored. Plain text is left as it is.
 */
export function cleanRichText(text: string): string {
  return isRichText(text) ? sanitizeHtml(text, OPTIONS).trim() : text;
}
