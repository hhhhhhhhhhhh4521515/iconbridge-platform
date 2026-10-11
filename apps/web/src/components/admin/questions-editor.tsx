'use client';

import {
  MAX_JOB_QUESTIONS,
  MAX_QUESTION_OPTIONS,
  QUESTION_TYPES,
} from '@iconbridge/shared/questions';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JobQuestion } from '@/lib/client-api';
import { cta } from '@/lib/ui';
import { input, LocalizedInput, smallButton } from './ui';

const EMPTY = { en: '', fr: '', ar: '' };
/** Keys are never shown: a short random one keeps answers attached to their question. */
const newKey = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The questions a recruiter adds to a job: free text, yes/no or one choice among
 * several, each with its wording in the three languages of the site.
 */
export function QuestionsEditor({
  value,
  onChange,
}: {
  value: JobQuestion[];
  onChange: (questions: JobQuestion[]) => void;
}) {
  const t = useTranslations('admin.questions');
  const update = (index: number, patch: Partial<JobQuestion>) => {
    onChange(value.map((question, at) => (at === index ? { ...question, ...patch } : question)));
  };
  const move = (index: number, by: number) => {
    const next = [...value];
    const [moved] = next.splice(index, 1);
    if (moved) {
      next.splice(index + by, 0, moved);
      onChange(next);
    }
  };
  return (
    <div className="space-y-4" data-testid="questions-editor">
      {value.length === 0 ? <p className="rounded-lg bg-muted p-4 text-sm">{t('none')}</p> : null}
      {value.map((question, index) => (
        <fieldset
          key={question.id}
          className="rounded-xl border border-border p-4"
          data-testid="question"
        >
          <legend className="px-1 text-sm font-semibold">
            {t('question', { number: index + 1 })}
          </legend>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t('type')}</span>
              <select
                className={`${input} min-w-48`}
                value={question.type}
                onChange={(event) => {
                  const type = event.target.value as JobQuestion['type'];
                  update(index, {
                    type,
                    options:
                      type === 'SINGLE_CHOICE'
                        ? question.options.length >= 2
                          ? question.options
                          : [
                              { value: newKey('o'), label: EMPTY },
                              { value: newKey('o'), label: EMPTY },
                            ]
                        : [],
                  });
                }}
              >
                {QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={question.required}
                onChange={(event) => {
                  update(index, { required: event.target.checked });
                }}
              />
              {t('required')}
            </label>
            <div className="ms-auto flex gap-1">
              <button
                type="button"
                className={smallButton}
                aria-label={t('moveUp')}
                disabled={index === 0}
                onClick={() => {
                  move(index, -1);
                }}
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={smallButton}
                aria-label={t('moveDown')}
                disabled={index === value.length - 1}
                onClick={() => {
                  move(index, 1);
                }}
              >
                <ArrowDown className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={`${smallButton} text-destructive`}
                aria-label={t('remove')}
                onClick={() => {
                  onChange(value.filter((_, at) => at !== index));
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <LocalizedInput
            label={t('label')}
            required
            value={question.label}
            onChange={(label) => {
              update(index, { label });
            }}
          />
          {question.type === 'SINGLE_CHOICE' ? (
            <div className="mt-3 space-y-2">
              {question.options.map((option, at) => (
                <div key={option.value} className="flex items-end gap-2">
                  <div className="flex-1">
                    <LocalizedInput
                      label={t('option', { number: at + 1 })}
                      required
                      value={option.label}
                      onChange={(label) => {
                        update(index, {
                          options: question.options.map((entry, position) =>
                            position === at ? { ...entry, label } : entry,
                          ),
                        });
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className={`${smallButton} text-destructive`}
                    aria-label={t('removeOption')}
                    disabled={question.options.length <= 2}
                    onClick={() => {
                      update(index, {
                        options: question.options.filter((_, position) => position !== at),
                      });
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={smallButton}
                disabled={question.options.length >= MAX_QUESTION_OPTIONS}
                onClick={() => {
                  update(index, {
                    options: [...question.options, { value: newKey('o'), label: EMPTY }],
                  });
                }}
              >
                <Plus className="size-4" aria-hidden />
                {t('addOption')}
              </button>
            </div>
          ) : null}
        </fieldset>
      ))}
      <button
        type="button"
        className={cta.outline}
        disabled={value.length >= MAX_JOB_QUESTIONS}
        onClick={() => {
          onChange([
            ...value,
            { id: newKey('q'), type: 'TEXT', required: false, label: EMPTY, options: [] },
          ]);
        }}
      >
        <Plus className="size-4" aria-hidden />
        {t('add')}
      </button>
    </div>
  );
}
