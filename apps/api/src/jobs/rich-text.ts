import DOMPurify from 'isomorphic-dompurify';

/** True when a text holds HTML written with the editor of the back office. */
export function isRichText(text: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(text);
}

const ALLOWED_TAGS = [
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
];

/** The part of a DOM element the hook below uses (the API is compiled without the DOM types). */
interface ElementLike {
  tagName?: string;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

// Links written by a recruiter open in a new tab and pass no ranking or referrer;
// a link without a safe address keeps its text and loses the link.
DOMPurify.addHook('afterSanitizeAttributes', (node: unknown) => {
  const element = node as ElementLike;
  if (element.tagName !== 'A') {
    return;
  }
  if (element.hasAttribute('href')) {
    element.setAttribute('rel', 'noopener noreferrer nofollow');
    element.setAttribute('target', '_blank');
  } else {
    element.removeAttribute('target');
    element.removeAttribute('rel');
  }
});

/**
 * Texts of a job (description, requirements, benefits) come from a rich-text editor.
 * DOMPurify parses them as a browser would and keeps a short list of formatting tags;
 * scripts, styles, event handlers, unknown tags and unsafe addresses are removed
 * before the text is stored, and again when it is read. Plain text is left as it is.
 */
export function cleanRichText(text: string): string {
  if (!isRichText(text)) {
    return text;
  }
  return DOMPurify.sanitize(text, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'rel', 'target'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  }).trim();
}
