import { describe, expect, it } from 'vitest';
import { answerText, checkAnswers, jobQuestionsSchema, parseJobQuestions } from './questions.js';

const label = (text: string) => ({ en: text, fr: `${text} fr`, ar: `${text} ar` });
const questions = jobQuestionsSchema.parse([
  { id: 'night', type: 'YES_NO', required: true, label: label('Night shifts?') },
  {
    id: 'level',
    type: 'SINGLE_CHOICE',
    label: label('Level'),
    options: [
      { value: 'junior', label: label('Junior') },
      { value: 'senior', label: label('Senior') },
    ],
  },
  { id: 'tools', type: 'TEXT', label: label('Tools') },
]);

describe('job questions', () => {
  it('accepts complete, valid answers and optional questions left empty', () => {
    expect(checkAnswers(questions, { night: 'no', level: 'senior', tools: 'MIG' })).toEqual([]);
    expect(checkAnswers(questions, { night: 'yes', level: '  ' })).toEqual([]);
  });

  it('reports a required question left empty', () => {
    expect(checkAnswers(questions, {})).toEqual([{ question: 'night', problem: 'required' }]);
    expect(checkAnswers(questions, { night: '   ' })).toEqual([
      { question: 'night', problem: 'required' },
    ]);
  });

  it('reports answers outside the choices and keys that are not questions', () => {
    expect(checkAnswers(questions, { night: 'perhaps', level: 'expert', extra: 'x' })).toEqual([
      { question: 'extra', problem: 'unknown' },
      { question: 'night', problem: 'invalid' },
      { question: 'level', problem: 'invalid' },
    ]);
  });

  it('writes an answer as a person reads it', () => {
    const [night, level, tools] = questions;
    if (!night || !level || !tools) throw new Error('fixture');
    expect(answerText(night, 'yes', 'fr')).toBe('Oui');
    expect(answerText(level, 'senior', 'en')).toBe('Senior');
    expect(answerText(level, 'gone', 'en')).toBe('gone');
    expect(answerText(tools, 'MIG torch', 'ar')).toBe('MIG torch');
  });

  it('refuses more than ten questions and malformed lists read from the database', () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      id: `q${String(index)}`,
      type: 'TEXT',
      label: label('Q'),
    }));
    expect(jobQuestionsSchema.safeParse(many).success).toBe(false);
    expect(parseJobQuestions('not a list')).toEqual([]);
    expect(parseJobQuestions(null)).toEqual([]);
  });
});
