import './zod-setup.js';
import { z } from 'zod';
import type { Locale, LocalizedText } from './i18n.js';

/** Kinds of question a recruiter can add to a job. */
export const QUESTION_TYPES = ['TEXT', 'YES_NO', 'SINGLE_CHOICE'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const MAX_JOB_QUESTIONS = 10;
export const MAX_QUESTION_OPTIONS = 12;
export const ANSWER_YES = 'yes';
export const ANSWER_NO = 'no';

/** Stable key of a question or of an option: answers are stored under it. */
const key = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Use lower-case letters, digits, hyphens and underscores');
const label = z.object({
  en: z.string().trim().min(1).max(300),
  fr: z.string().trim().min(1).max(300),
  ar: z.string().trim().min(1).max(300),
}) satisfies z.ZodType<LocalizedText>;

export const jobQuestionSchema = z
  .object({
    id: key,
    type: z.enum(QUESTION_TYPES),
    /** The candidate cannot send the application without answering. */
    required: z.boolean().default(false),
    label,
    /** Choices of a SINGLE_CHOICE question; empty for the other types. */
    options: z
      .array(z.object({ value: key, label }))
      .max(MAX_QUESTION_OPTIONS)
      .default([]),
  })
  .superRefine((question, context) => {
    if (question.type !== 'SINGLE_CHOICE') {
      if (question.options.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Only a single-choice question has options',
        });
      }
      return;
    }
    if (question.options.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'A single-choice question needs at least two options',
      });
    }
    if (new Set(question.options.map((option) => option.value)).size !== question.options.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Each option needs its own value',
      });
    }
  });
export type JobQuestion = z.infer<typeof jobQuestionSchema>;

/** The questions of one job, in the order the candidate sees them. */
export const jobQuestionsSchema = z
  .array(jobQuestionSchema)
  .max(MAX_JOB_QUESTIONS)
  .refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length, {
    message: 'Each question needs its own id',
  });

/** Reads the JSON column of a job or of an application; anything malformed counts as "no question". */
export function parseJobQuestions(value: unknown): JobQuestion[] {
  const parsed = jobQuestionsSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

export interface AnswerProblem {
  /** Question id (or the unknown key that was sent). */
  question: string;
  problem: 'required' | 'invalid' | 'unknown';
}

/**
 * Checks the answers of an application against the questions of the job. Used by the
 * API when applying and by the web form, so both refuse the same things.
 */
export function checkAnswers(
  questions: readonly JobQuestion[],
  answers: Readonly<Record<string, string>>,
): AnswerProblem[] {
  const problems: AnswerProblem[] = [];
  const known = new Set(questions.map((question) => question.id));
  for (const sent of Object.keys(answers)) {
    if (!known.has(sent)) {
      problems.push({ question: sent, problem: 'unknown' });
    }
  }
  for (const question of questions) {
    const answer = (answers[question.id] ?? '').trim();
    if (answer === '') {
      if (question.required) {
        problems.push({ question: question.id, problem: 'required' });
      }
      continue;
    }
    const valid =
      question.type === 'TEXT' ||
      (question.type === 'YES_NO' && (answer === ANSWER_YES || answer === ANSWER_NO)) ||
      (question.type === 'SINGLE_CHOICE' &&
        question.options.some((option) => option.value === answer));
    if (!valid) {
      problems.push({ question: question.id, problem: 'invalid' });
    }
  }
  return problems;
}

const YES_NO_LABELS: Record<Locale, Record<string, string>> = {
  en: { [ANSWER_YES]: 'Yes', [ANSWER_NO]: 'No' },
  fr: { [ANSWER_YES]: 'Oui', [ANSWER_NO]: 'Non' },
  ar: { [ANSWER_YES]: 'نعم', [ANSWER_NO]: 'لا' },
};

/** An answer as a person reads it: "Yes" for "yes", the label of the chosen option, or the text. */
export function answerText(question: JobQuestion, answer: string, locale: Locale): string {
  if (question.type === 'YES_NO') {
    return YES_NO_LABELS[locale][answer] ?? answer;
  }
  if (question.type === 'SINGLE_CHOICE') {
    return question.options.find((option) => option.value === answer)?.label[locale] ?? answer;
  }
  return answer;
}
