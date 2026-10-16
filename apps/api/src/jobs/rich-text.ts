import { createRequire } from 'node:module';
import type { DOMPurify as Purifier } from 'isomorphic-dompurify';

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

const load = createRequire(import.meta.url);
let purifier: Purifier | undefined;

/**
 * DOMPurify and jsdom take about a second to load on the API's 0.5 vCPU, and the first
 * requests after a cold start (home page, job list) do not need them: they are loaded
 * with the first rich text, not when the API starts. Synchronous (a CommonJS require),
 * so `cleanRichText` stays synchronous.
 */
function purify(): Purifier {
  if (!purifier) {
    const loaded = load('isomorphic-dompurify') as { default?: Purifier } & Purifier;
    purifier = loaded.default ?? loaded;
    // Links written by a recruiter open in a new tab and pass no ranking or referrer;
    // a link without a safe address keeps its text and loses the link.
    purifier.addHook('afterSanitizeAttributes', (node: unknown) => {
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
  }
  return purifier;
}

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
  return purify()
    .sanitize(text, {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ['href', 'rel', 'target'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    })
    .trim();
}
