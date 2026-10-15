/** Countries most candidates live in or come from: offered first, in this order. */
export const PREFERRED_COUNTRIES = ['TN', 'MA', 'DZ', 'EG', 'MT', 'PL'] as const;

export interface CountryChoice {
  /** ISO 3166-1 alpha-2 code: the value of the field. */
  code: string;
  /** Name in the page language. */
  name: string;
  /** Other text the choice can be found by, e.g. the calling code "216" of a phone field. */
  keywords?: readonly string[];
}

/**
 * Text as it is compared: lower case, no accents or Arabic vowel marks, and the Arabic
 * letters people type interchangeably written one way ("Égypte" → "egypte", "الجزائر"
 * and "ألجزائر" alike).
 */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The preferred countries first (in their order), then every other one sorted by its
 * name in the page language.
 */
export function orderCountries(choices: readonly CountryChoice[], locale: string): CountryChoice[] {
  const collator = new Intl.Collator(locale);
  const rank = (code: string) => {
    const index = (PREFERRED_COUNTRIES as readonly string[]).indexOf(code);
    return index === -1 ? PREFERRED_COUNTRIES.length : index;
  };
  return [...choices].sort(
    (a, b) => rank(a.code) - rank(b.code) || collator.compare(a.name, b.name),
  );
}

/** Whether a choice is one of the preferred countries (shown in their own group). */
export function isPreferred(code: string): boolean {
  return (PREFERRED_COUNTRIES as readonly string[]).includes(code);
}

/**
 * The choices matching what was typed, best first: the ISO code itself, then names that
 * start with the text, then names with a word starting with it, then names containing
 * it, then keywords. An empty text matches everything, in the given order.
 */
export function filterCountries(choices: readonly CountryChoice[], query: string): CountryChoice[] {
  const text = normalizeSearch(query).replace(/^\+/, '');
  if (!text) {
    return [...choices];
  }
  const scored: { choice: CountryChoice; score: number; index: number }[] = [];
  choices.forEach((choice, index) => {
    const name = normalizeSearch(choice.name);
    const code = choice.code.toLowerCase();
    let score = -1;
    if (code === text) {
      score = 0;
    } else if (name.startsWith(text)) {
      score = 1;
    } else if (name.split(/[\s\-'’(),]+/).some((word) => word.startsWith(text))) {
      score = 2;
    } else if (name.includes(text)) {
      score = 3;
    } else if (choice.keywords?.some((keyword) => normalizeSearch(keyword).startsWith(text))) {
      score = 4;
    }
    if (score >= 0) {
      scored.push({ choice, score, index });
    }
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((entry) => entry.choice);
}

/** The single choice a typed or autofilled text names exactly (name or code), if any. */
export function exactCountry(
  choices: readonly CountryChoice[],
  text: string,
): CountryChoice | undefined {
  const typed = normalizeSearch(text);
  if (!typed) {
    return undefined;
  }
  return choices.find(
    (choice) => normalizeSearch(choice.name) === typed || choice.code.toLowerCase() === typed,
  );
}
