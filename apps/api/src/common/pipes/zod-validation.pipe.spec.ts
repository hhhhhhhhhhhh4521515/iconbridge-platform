import { registerSchema } from '@iconbridge/shared';
import { AppException } from '../errors/app.exception.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(registerSchema);
  const valid = {
    email: 'New.User@Example.test',
    password: 'a-long-enough-password',
    firstName: 'New',
    lastName: 'User',
    phone: '+21612345678',
    country: 'tn',
    gdprConsent: true,
    turnstileToken: 'token',
  };

  it('returns the parsed value: normalised, with defaults, without unknown fields', () => {
    const parsed = pipe.transform({ ...valid, role: 'SUPER_ADMIN' });
    expect(parsed).toMatchObject({ email: 'new.user@example.test', country: 'TN', locale: 'en' });
    expect(parsed).not.toHaveProperty('role');
  });

  it('throws VALIDATION_ERROR listing the fields, without echoing the values', () => {
    try {
      pipe.transform({ ...valid, password: 'short-pw', phone: '12345', gdprConsent: false });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      const exception = error as AppException;
      expect(exception.code).toBe('VALIDATION_ERROR');
      expect(exception.getStatus()).toBe(400);
      const details = exception.details as { path: string; message: string }[];
      expect(details.map((issue) => issue.path).sort()).toEqual([
        'gdprConsent',
        'password',
        'phone',
      ]);
      expect(JSON.stringify(details)).not.toContain('short-pw');
    }
  });

  it('rejects a body that is not an object', () => {
    expect(() => pipe.transform(undefined)).toThrow(AppException);
    expect(() => pipe.transform('text')).toThrow(AppException);
  });
});
