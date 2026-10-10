import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AzureStorageService, contentDisposition } from './azure-storage.service.js';

// A throwaway key generated for this run: signing a link needs a key, not a real account.
const ACCOUNT_KEY = randomBytes(64).toString('base64');
const CONNECTION_STRING =
  `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${ACCOUNT_KEY};` +
  'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

function service(values: Partial<Record<keyof Env, string>>) {
  return new AzureStorageService({
    get: (key: keyof Env) => values[key] ?? '',
  } as unknown as ConfigService<Env, true>);
}

describe('AzureStorageService download links (account key)', () => {
  const storage = service({
    AZURE_STORAGE_CONNECTION_STRING: CONNECTION_STRING,
    PUBLIC_MEDIA_BASE_URL: 'http://localhost:10000/devstoreaccount1/public-media',
  });
  const link = async (expiresInSeconds?: number) =>
    new URL(
      await storage.privateDownloadUrl('candidates/p1/abc.pdf', {
        fileName: 'Mon CV été.pdf',
        contentType: 'application/pdf',
        ...(expiresInSeconds ? { expiresInSeconds } : {}),
      }),
    );

  it('points to the private container and is read-only on that single blob', async () => {
    const url = await link();
    expect(url.pathname).toBe('/devstoreaccount1/candidate-documents/candidates/p1/abc.pdf');
    expect(url.searchParams.get('sp')).toBe('r');
    expect(url.searchParams.get('sr')).toBe('b');
    expect(url.searchParams.get('sig')).toBeTruthy();
  });

  it('expires 5 minutes from now by default', async () => {
    const url = await link();
    const seconds = (new Date(url.searchParams.get('se') ?? '').getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(295);
    expect(seconds).toBeLessThanOrEqual(301);
    expect(new Date(url.searchParams.get('st') ?? '').getTime()).toBeLessThan(Date.now());
  });

  it('accepts another duration', async () => {
    const url = await link(60);
    const seconds = (new Date(url.searchParams.get('se') ?? '').getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThanOrEqual(61);
  });

  it('makes the browser download the file under its original name, without caching', async () => {
    const url = await link();
    expect(url.searchParams.get('rscd')).toContain('attachment; filename="Mon CV _t_.pdf"');
    expect(url.searchParams.get('rsct')).toBe('application/pdf');
    expect(url.searchParams.get('rscc')).toBe('private, no-store');
  });

  it('never puts the account key in the link', async () => {
    const url = (await link()).toString();
    expect(url).not.toContain(ACCOUNT_KEY);
    expect(decodeURIComponent(url)).not.toContain(ACCOUNT_KEY);
  });

  it('gives a different signature to another blob', async () => {
    const other = new URL(
      await storage.privateDownloadUrl('candidates/p2/abc.pdf', {
        fileName: 'a.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(other.searchParams.get('sig')).not.toBe((await link()).searchParams.get('sig'));
  });

  it('builds public URLs from the configured base, encoding each segment', () => {
    expect(storage.publicUrl('jobs/1/cover a.webp')).toBe(
      'http://localhost:10000/devstoreaccount1/public-media/jobs/1/cover%20a.webp',
    );
    expect(storage.publicUrl(null)).toBeNull();
  });
});

describe('AzureStorageService with a managed identity', () => {
  it('starts from the account URL alone, without any key', () => {
    expect(() =>
      service({
        AZURE_STORAGE_CONNECTION_STRING: '',
        AZURE_STORAGE_ACCOUNT_URL: 'https://example.blob.core.windows.net',
        PUBLIC_MEDIA_BASE_URL: 'https://example.blob.core.windows.net/public-media',
      }),
    ).not.toThrow();
  });
});

describe('contentDisposition', () => {
  it('cannot be broken out of by quotes, backslashes or line breaks', () => {
    const header = contentDisposition('a"b\\c\r\nX-Injected: 1.pdf');
    expect(header.startsWith('attachment; filename="a_b_c__X-Injected: 1.pdf"')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);
  });
});
