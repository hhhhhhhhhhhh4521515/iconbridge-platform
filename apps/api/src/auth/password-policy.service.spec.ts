import { AppException } from '../common/errors/app.exception.js';
import { PasswordPolicyService } from './password-policy.service.js';

describe('PasswordPolicyService', () => {
  const policy = new PasswordPolicyService();

  it.each(['password123', 'qwertyuiop', '1234567890', 'aaaaaaaaaaaa', 'iloveyou2024'])(
    'refuses the guessable password %s',
    (password) => {
      expect(() => {
        policy.assertStrong(password);
      }).toThrow(AppException);
    },
  );

  it.each(['river-lantern-quartz-42', 'Tr0ub4dor&3-horse-staple', 'vX9#mQ2$pL7@wN4'])(
    'accepts the strong password %s',
    (password) => {
      expect(() => {
        policy.assertStrong(password);
      }).not.toThrow();
    },
  );

  it('scores a password lower when it is built from the user own data', () => {
    const password = 'amira.bensalah';
    expect(policy.score(password, ['amira', 'bensalah'])).toBeLessThan(policy.score(password));
  });

  it('reports WEAK_PASSWORD with the score and advice, never the password', () => {
    try {
      policy.assertStrong('password123');
      expect.unreachable();
    } catch (error) {
      const exception = error as AppException;
      expect(exception.code).toBe('WEAK_PASSWORD');
      expect(exception.getStatus()).toBe(400);
      expect(exception.details).toMatchObject({ minimumScore: 3 });
      expect(JSON.stringify(exception.details)).not.toContain('password123');
    }
  });
});
