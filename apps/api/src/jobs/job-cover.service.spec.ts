import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception.js';
import { JobCoverService } from './job-cover.service.js';

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 90, b: 140 } } });

type Image = ReturnType<typeof image>;

async function failure(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the call to fail');
}

describe('JobCoverService', () => {
  const service = new JobCoverService();

  it.each([
    ['JPEG', (i: Image) => i.jpeg()],
    ['PNG', (i: Image) => i.png()],
    ['WebP', (i: Image) => i.webp()],
  ])('accepts %s and stores WebP limited to 1200 px wide', async (_format, encode) => {
    const cover = await service.process(await encode(image(2400, 1600)).toBuffer());
    expect(cover.contentType).toBe('image/webp');
    expect([cover.width, cover.height]).toEqual([1200, 800]);
    const stored = await sharp(cover.content).metadata();
    expect([stored.format, stored.width, stored.height]).toEqual(['webp', 1200, 800]);
  });

  it('does not enlarge a small image', async () => {
    const cover = await service.process(await image(600, 400).jpeg().toBuffer());
    expect([cover.width, cover.height]).toEqual([600, 400]);
  });

  it('names the file after its content', async () => {
    const first = await service.process(await image(800, 600).png().toBuffer());
    const same = await service.process(await image(800, 600).png().toBuffer());
    const other = await service.process(await image(800, 601).png().toBuffer());
    expect(first.fileName).toMatch(/^cover-[0-9a-f]{16}\.webp$/);
    expect(same.fileName).toBe(first.fileName);
    expect(other.fileName).not.toBe(first.fileName);
  });

  it('removes EXIF metadata', async () => {
    const withExif = await image(800, 600)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner', Make: 'CameraMaker' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const cover = await service.process(withExif);
    expect((await sharp(cover.content).metadata()).exif).toBeUndefined();
    expect(cover.content.includes('secret-owner')).toBe(false);
  });

  it.each([
    ['a GIF', () => image(100, 100).gif().toBuffer()],
    ['an AVIF', () => image(100, 100).avif().toBuffer()],
    [
      'an SVG',
      () =>
        Promise.resolve(
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
        ),
    ],
    ['text renamed to .png', () => Promise.resolve(Buffer.from('not an image at all'))],
    ['a truncated JPEG', async () => (await image(800, 600).jpeg().toBuffer()).subarray(0, 200)],
    ['an empty file', () => Promise.resolve(Buffer.alloc(0))],
  ])('refuses %s with UNSUPPORTED_FILE (415)', async (_case, make) => {
    const error = await failure(service.process(await make()));
    expect(error.code).toBe('UNSUPPORTED_FILE');
    expect(error.getStatus()).toBe(415);
  });

  it('refuses a file above 5 MB', async () => {
    const error = await failure(service.process(Buffer.alloc(5 * 1024 * 1024 + 1)));
    expect(error.code).toBe('UNSUPPORTED_FILE');
  });
});
