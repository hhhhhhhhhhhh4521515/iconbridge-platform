// Copies entry points and the files they really load at run time into one directory.
//
//   node scripts/trace-runtime.mjs <source> <target> <entry>... [--keep <path>]...
//
// `pnpm deploy --prod` gives the production dependencies, but whole: the Prisma CLI
// and its studio come in as peers of the Prisma client, and many packages ship
// builds for every platform and database. @vercel/nft (the tracer of the Next.js
// standalone output) follows the imports of the entries, including native modules
// and files opened with `path.join(__dirname, ...)`, and only those files are copied.
// `--keep` adds a file or folder loaded through a name the tracer cannot follow.
// Paths are relative to <source>. Used by apps/api/Dockerfile.
import { cpSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { nodeFileTrace } from '@vercel/nft';

const args = process.argv.slice(2);
const keep = [];
const positional = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--keep') {
    keep.push(args[++index] ?? '');
  } else {
    positional.push(args[index] ?? '');
  }
}
const [sourceArg, targetArg, ...entries] = positional;
if (!sourceArg || !targetArg || entries.length === 0) {
  throw new Error('Usage: trace-runtime.mjs <source> <target> <entry>... [--keep <path>]...');
}
const source = path.resolve(sourceArg);
const target = path.resolve(targetArg);

const { fileList, warnings } = await nodeFileTrace(
  entries.map((entry) => path.join(source, entry)),
  { base: source },
);
for (const warning of warnings) {
  const message = String(warning.message);
  // Optional dependencies that are not installed, and files that are not JavaScript.
  if (!message.includes('Failed to resolve dependency') && !message.includes('Failed to parse')) {
    process.stderr.write(`trace: ${message}\n`);
  }
}
const files = new Set([...fileList, ...keep]);
let bytes = 0;
for (const file of files) {
  const from = path.join(source, file);
  const to = path.join(target, file);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, dereference: true });
  const stat = statSync(from);
  bytes += stat.isFile() ? stat.size : 0;
}
process.stdout.write(
  `trace: ${String(files.size)} entries, ${String(Math.round(bytes / 1e6))} MB\n`,
);
