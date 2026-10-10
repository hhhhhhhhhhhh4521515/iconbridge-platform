// Copies every .env.example to .env when the .env file does not exist yet.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const dir of ['.', 'apps/api', 'apps/web']) {
  const example = join(root, dir, '.env.example');
  const target = join(root, dir, '.env');
  if (existsSync(target)) {
    console.log(`kept    ${join(dir, '.env')}`);
  } else {
    copyFileSync(example, target);
    console.log(`created ${join(dir, '.env')}`);
  }
}
