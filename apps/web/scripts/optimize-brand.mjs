// Converts the images of public/brand to WebP (1920 px wide at most) and removes the
// originals, which stay in the git history. The logo also keeps a PNG, used for icons.
// Usage: pnpm --filter @iconbridge/web brand:optimize
import { readdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand');
const MAX_WIDTH = 1920;
const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

let before = 0;
let after = 0;
for (const file of (await readdir(dir)).sort()) {
  const extension = extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(extension)) {
    continue;
  }
  const source = join(dir, file);
  const target = join(dir, `${file.slice(0, -extension.length)}.webp`);
  const isLogo = file.startsWith('logo');
  await sharp(source)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp(isLogo ? { lossless: true } : { quality: 80 })
    .toFile(target);
  const [sourceSize, targetSize] = [(await stat(source)).size, (await stat(target)).size];
  before += sourceSize;
  after += targetSize;
  process.stdout.write(
    `${file} (${kb(sourceSize)}) -> ${file.slice(0, -extension.length)}.webp (${kb(targetSize)})\n`,
  );
  if (!isLogo) {
    await rm(source);
  }
}
process.stdout.write(`Total: ${kb(before)} -> ${kb(after)}\n`);
