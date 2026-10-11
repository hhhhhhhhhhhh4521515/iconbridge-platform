import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/** Rules written as sentences in packages/shared, and the message key of each. */
const CUSTOM_MESSAGES: Record<string, string> = {
  'The date of birth cannot be in the future': 'dobFuture',
  'You must be at least 18 years old': 'minAge',
  'Fill in every passport field, or none': 'passportAllOrNone',
  'The passport must not be expired': 'passportExpired',
  'The issue date cannot be in the future': 'issueFuture',
  'The expiry date must be after the issue date': 'expiryAfterIssue',
  'Each language may appear once': 'languageOnce',
  'Use the international format, e.g. +21612345678': 'phone',
  'Use 5 to 20 letters and digits': 'passportNumber',
  'Use a two-letter ISO 639-1 language code': 'required',
};

type Issue = z.core.$ZodIssue;

/**
 * Message key (under `forms.errors`) of a zod issue, with its number when it has one:
 * "tooShort:10". The form shows the translated sentence, never zod's English text.
 */
export function issueKey(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
    case 'invalid_value':
      return 'required';
    case 'too_small':
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1 ? 'required' : `tooShort:${String(issue.minimum)}`;
      }
      return issue.origin === 'array' ? 'required' : `min:${String(issue.minimum)}`;
    case 'too_big':
      return issue.origin === 'string'
        ? `tooLong:${String(issue.maximum)}`
        : `max:${String(issue.maximum)}`;
    case 'invalid_format':
      if (issue.format === 'email') return 'email';
      if (issue.format === 'date') return 'date';
      return CUSTOM_MESSAGES[issue.message] ?? 'invalid';
    default:
      return CUSTOM_MESSAGES[issue.message] ?? 'invalid';
  }
}

function setIn(target: Record<string, unknown>, path: PropertyKey[], value: unknown): void {
  let node = target;
  path.forEach((part, index) => {
    const key = String(part);
    if (index === path.length - 1) {
      // The first problem of a field is the one shown.
      node[key] ??= value;
      return;
    }
    node[key] ??= {};
    node = node[key] as Record<string, unknown>;
  });
}

export interface ResolverOptions<Values> {
  /** Builds what is validated from the form values, e.g. the whole profile from one step. */
  prepare?: (values: Values) => unknown;
  /** Only problems on these top-level fields stop the form; the others are for the server to report. */
  only?: readonly string[];
}

/**
 * Validates a form with a zod schema of packages/shared. The same schema validates
 * the request in the API, so the two can never disagree.
 */
export function zodResolver<Schema extends z.ZodType, Values extends FieldValues = FieldValues>(
  schema: Schema,
  options: ResolverOptions<Values> = {},
): Resolver<Values, unknown, z.output<Schema>> {
  return (values) => {
    const result = schema.safeParse(options.prepare ? options.prepare(values) : values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }
    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      const [field = 'root', ...rest] = issue.path;
      if (options.only && !options.only.includes(String(field))) {
        setIn(errors, ['root', 'other'], { type: 'other', message: String(field) });
        continue;
      }
      // A problem on a list as a whole (not on one of its rows) is kept under "root".
      const path =
        rest.length === 0 && Array.isArray(values[String(field)]) ? [field, 'root'] : issue.path;
      setIn(errors, path, { type: issue.code, message: issueKey(issue) });
    }
    return { values: {}, errors: errors as FieldErrors<Values> };
  };
}

/** Fields of a form the API refused (VALIDATION_ERROR), from the `details` of the error. */
export function refusedFields(details: unknown): string[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.flatMap((entry: unknown) =>
    typeof entry === 'object' && entry !== null && 'path' in entry && typeof entry.path === 'string'
      ? [entry.path]
      : [],
  );
}

/** Only paths inside the site are accepted after sign-in: "/jobs/x", never "//evil.example". */
export function safeNext(next: string | null | undefined, fallback: string): string {
  return next && /^\/(?![/\\])/.test(next) ? next : fallback;
}
