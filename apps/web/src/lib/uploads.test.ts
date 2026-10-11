import { describe, expect, it } from 'vitest';
import { refusal } from './uploads';

const file = (name: string, type: string, size = 1000) => ({ name, type, size }) as File;

describe('refusal (checks before an upload)', () => {
  it('accepts a PDF or a Word file as a CV', () => {
    expect(refusal(file('cv.pdf', 'application/pdf'), 'CV', 5, 0)).toBeNull();
    expect(refusal(file('CV.DOCX', ''), 'CV', 5, 0)).toBeNull();
  });

  it('refuses a picture as a CV, and accepts it as a passport scan', () => {
    expect(refusal(file('cv.png', 'image/png'), 'CV', 5, 0)).toBe('wrongType');
    expect(refusal(file('scan.jpeg', 'image/jpeg'), 'PASSPORT', 5, 0)).toBeNull();
  });

  it('refuses a file whose type contradicts its extension, or without a known extension', () => {
    expect(refusal(file('cv.pdf', 'application/x-msdownload'), 'CV', 5, 0)).toBe('wrongType');
    expect(refusal(file('archive.zip', 'application/zip'), 'OTHER', 5, 0)).toBe('wrongType');
    expect(refusal(file('noextension', ''), 'OTHER', 5, 0)).toBe('wrongType');
  });

  it('refuses an empty file and a file over the limit', () => {
    expect(refusal(file('cv.pdf', 'application/pdf', 0), 'CV', 5, 0)).toBe('empty');
    expect(refusal(file('cv.pdf', 'application/pdf', 5 * 1024 * 1024 + 1), 'CV', 5, 0)).toBe(
      'tooLarge',
    );
    expect(refusal(file('cv.pdf', 'application/pdf', 5 * 1024 * 1024), 'CV', 5, 0)).toBeNull();
  });

  it('refuses one more document than a candidate may keep', () => {
    expect(refusal(file('cv.pdf', 'application/pdf'), 'CV', 5, 30)).toBe('tooMany');
  });
});
