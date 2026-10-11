'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Check = (password: string, inputs: string[]) => number;
let checker: Promise<Check> | undefined;

/** zxcvbn and its dictionaries are large: they are fetched when a password field is first used. */
function loadChecker(): Promise<Check> {
  checker ??= Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common')]).then(
    ([core, common]) => {
      const zxcvbn = new core.ZxcvbnFactory({
        dictionary: common.dictionary,
        graphs: common.adjacencyGraphs,
      });
      return (password, inputs) => zxcvbn.check(password, inputs).score;
    },
  );
  return checker;
}

const COLOURS = [
  'bg-destructive',
  'bg-destructive',
  'bg-brand-gold',
  'bg-emerald-600',
  'bg-emerald-600',
];

/**
 * Strength of a password, 0 to 4, with the same library the API uses to accept or
 * refuse it (score 3 at least). A guide only: the API has the last word.
 */
export function PasswordMeter({
  password,
  inputs,
  id,
}: {
  password: string;
  inputs: string[];
  id: string;
}) {
  const t = useTranslations('auth.strength');
  const [score, setScore] = useState<number | null>(null);
  const joined = inputs.join('\n');

  useEffect(() => {
    if (!password) {
      return;
    }
    let cancelled = false;
    void loadChecker().then((check) => {
      if (!cancelled) {
        setScore(check(password, joined.split('\n').filter(Boolean)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [password, joined]);

  const shown = password ? score : null;
  return (
    <div id={id} className="mt-2" data-testid="password-strength" data-score={shown ?? ''}>
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={`h-1.5 flex-1 rounded-full ${
              shown !== null && bar < Math.max(1, shown) ? (COLOURS[shown] ?? '') : 'bg-muted'
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {shown === null ? t('hint') : `${t('label')} ${t(`score${String(shown)}`)}`}
      </p>
    </div>
  );
}
