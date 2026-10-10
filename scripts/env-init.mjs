// Creates the .env files from the .env.example files and keeps them complete:
// - a missing .env is copied from its example;
// - a variable that exists in the example but not in the .env is appended;
// - local secrets left empty are generated (never committed: .env files are git-ignored).
// Existing values are never changed.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const generated = {
  PASSPORT_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  SEED_ADMIN_PASSWORD: () => randomBytes(18).toString('base64url'),
  JWT_ACCESS_SECRET: () => randomBytes(48).toString('base64url'),
};

const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/;

for (const dir of ['.', 'apps/api', 'apps/web']) {
  const examplePath = join(root, dir, '.env.example');
  const targetPath = join(root, dir, '.env');
  const label = join(dir, '.env');
  const example = readFileSync(examplePath, 'utf8');

  const created = !existsSync(targetPath);
  let lines = (created ? example : readFileSync(targetPath, 'utf8')).split('\n');
  const changes = [];

  const present = new Set(lines.map((line) => assignment.exec(line)?.[1]).filter(Boolean));
  for (const line of example.split('\n')) {
    const name = assignment.exec(line)?.[1];
    if (name && !present.has(name)) {
      lines.push(line);
      changes.push(`added ${name}`);
    }
  }

  lines = lines.map((line) => {
    const match = assignment.exec(line);
    if (match && match[2] === '' && generated[match[1]]) {
      changes.push(`generated ${match[1]}`);
      return `${match[1]}=${generated[match[1]]()}`;
    }
    return line;
  });

  if (created || changes.length > 0) {
    writeFileSync(targetPath, lines.join('\n').replace(/\n*$/, '\n'));
  }
  const status = created ? 'created' : changes.length > 0 ? 'updated' : 'kept   ';
  console.log(`${status} ${label}${changes.length > 0 ? ` (${changes.join(', ')})` : ''}`);
}
