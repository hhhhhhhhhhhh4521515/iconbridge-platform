import { HttpStatus, Injectable } from '@nestjs/common';
import { PASSWORD_MIN_SCORE } from '@iconbridge/shared';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as english from '@zxcvbn-ts/language-en';
import { AppException } from '../common/errors/app.exception.js';

/** Password strength with zxcvbn. Length limits are in the zod schemas of packages/shared. */
@Injectable()
export class PasswordPolicyService {
  // Building the dictionaries takes a moment: done with the first password, not at start-up.
  private factory: ZxcvbnFactory | undefined;
  private get zxcvbn(): ZxcvbnFactory {
    this.factory ??= new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...english.dictionary },
      graphs: common.adjacencyGraphs,
      translations: english.translations,
    });
    return this.factory;
  }

  /** Score from 0 (trivial) to 4. `userInputs` are words the password must not rely on. */
  score(password: string, userInputs: string[] = []): number {
    return this.zxcvbn.check(password, userInputs).score;
  }

  /** Throws WEAK_PASSWORD with zxcvbn's advice when the score is below the minimum. */
  assertStrong(password: string, userInputs: string[] = []): void {
    const result = this.zxcvbn.check(password, userInputs);
    if (result.score < PASSWORD_MIN_SCORE) {
      throw new AppException(
        'WEAK_PASSWORD',
        HttpStatus.BAD_REQUEST,
        'This password is too easy to guess',
        {
          score: result.score,
          minimumScore: PASSWORD_MIN_SCORE,
          warning: result.feedback.warning,
          suggestions: result.feedback.suggestions,
        },
      );
    }
  }
}
