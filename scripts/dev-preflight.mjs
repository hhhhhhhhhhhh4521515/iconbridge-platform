// Run before `pnpm dev`: says plainly when a port the dev servers need is taken,
// instead of leaving a stack trace somewhere in the output of two servers.
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const PORTS = [
  { port: 3000, name: 'web (Next.js)' },
  { port: 4000, name: 'api (NestJS)' },
];

/** True when something already listens on the port, on IPv4 or IPv6. */
function taken(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => {
      resolve(error.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(false);
      });
    });
    server.listen(port, '::');
  });
}

/** "pid 1234 (node)" when the system can tell; empty otherwise. */
function owner(port) {
  try {
    const line = execFileSync('ss', ['-ltnpH', `sport = :${String(port)}`], { encoding: 'utf8' });
    const match = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    return match ? ` by pid ${match[2]} (${match[1]})` : '';
  } catch {
    return '';
  }
}

const busy = [];
for (const entry of PORTS) {
  if (await taken(entry.port)) {
    busy.push(entry);
  }
}
if (busy.length > 0) {
  for (const { port, name } of busy) {
    console.error(`Port ${String(port)} is already in use${owner(port)}: ${name} cannot start.`);
  }
  console.error(
    'Stop that process (kill <pid>), or the other `pnpm dev` / `pnpm start` still running, then try again.',
  );
  process.exit(1);
}
