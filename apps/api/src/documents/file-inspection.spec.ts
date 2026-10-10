import { createHash } from 'node:crypto';
import { docx, exe, gif, jpg, pdf, plainZip, png, text } from '../../test/e2e/files.js';
import { AppException } from '../common/errors/app.exception.js';
import { decodeUploadName, inspectDocument, sanitizeFileName } from './file-inspection.js';

async function rejected(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the file to be refused');
}

describe('inspectDocument', () => {
  it('recognises PDF and DOCX for a CV from their content', async () => {
    expect(await inspectDocument(pdf(), 'CV')).toMatchObject({
      format: 'pdf',
      mimeType: 'application/pdf',
    });
    expect(await inspectDocument(docx(), 'CV')).toMatchObject({
      format: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('recognises PDF, JPG and PNG for a passport scan and for certificates', async () => {
    for (const type of [
      'PASSPORT',
      'CERTIFICATE',
      'DIPLOMA',
      'STCW',
      'SEAMAN_BOOK',
      'MEDICAL',
      'OTHER',
    ] as const) {
      expect((await inspectDocument(pdf(), type)).format).toBe('pdf');
      expect((await inspectDocument(await jpg(), type)).format).toBe('jpg');
      expect((await inspectDocument(await png(), type)).format).toBe('png');
    }
  });

  it('returns the SHA-256 of the content', async () => {
    const content = pdf();
    expect((await inspectDocument(content, 'CV')).sha256).toBe(
      createHash('sha256').update(content).digest('hex'),
    );
  });

  it.each([
    ['an executable', exe, 'CV'],
    ['an executable sent as a passport scan', exe, 'PASSPORT'],
    ['plain text', text, 'CV'],
    ['a zip that is not a DOCX', plainZip, 'CV'],
    ['a GIF', gif, 'PHOTO'],
    ['an image as a CV', jpg, 'CV'],
    ['a Word file as a passport scan', docx, 'PASSPORT'],
    ['a PDF as an ID photo', pdf, 'PHOTO'],
    ['an empty file', () => Buffer.alloc(0), 'CV'],
  ] as const)('refuses %s', async (_case, make, type) => {
    const error = await rejected(inspectDocument(await make(), type));
    expect(error.code).toBe('UNSUPPORTED_FILE');
    expect(error.getStatus()).toBe(415);
  });

  it('lists the accepted formats in the error', async () => {
    const error = await rejected(inspectDocument(pdf(), 'PHOTO'));
    expect(error.details).toMatchObject({ accepted: ['jpg', 'png'] });
  });
});

describe('sanitizeFileName', () => {
  it('keeps a normal name, including accents and spaces', () => {
    expect(sanitizeFileName('Mon CV été 2026.pdf', 'pdf')).toBe('Mon CV été 2026.pdf');
  });

  it('drops folders, so a name can never point outside', () => {
    expect(sanitizeFileName('../../etc/passwd', 'pdf')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\me\\cv.docx', 'docx')).toBe('cv.docx');
  });

  it('removes control characters and limits the length', () => {
    expect(sanitizeFileName('cv\r\nSet-Cookie: x=1.pdf', 'pdf')).toBe('cvSet-Cookie: x=1.pdf');
    expect(sanitizeFileName(`${'a'.repeat(500)}.pdf`, 'pdf')).toHaveLength(200);
  });

  it('falls back to a generic name', () => {
    expect(sanitizeFileName(undefined, 'pdf')).toBe('document.pdf');
    expect(sanitizeFileName('   ', 'jpg')).toBe('document.jpg');
    expect(sanitizeFileName('..', 'png')).toBe('document.png');
    expect(sanitizeFileName('folder/', 'pdf')).toBe('document.pdf');
  });
});

describe('decodeUploadName', () => {
  it('restores UTF-8 names that the upload parser read as latin1', () => {
    const asReceived = Buffer.from('été.pdf', 'utf8').toString('latin1');
    expect(decodeUploadName(asReceived)).toBe('été.pdf');
    expect(decodeUploadName(undefined)).toBeUndefined();
  });
});
