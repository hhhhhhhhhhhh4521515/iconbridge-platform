// Runs the browser tests in WebKit inside the Playwright container.
//
// WebKit needs system libraries that only `sudo pnpm exec playwright install-deps webkit`
// installs. Where that is not possible, the official Playwright image has them. This
// script runs inside that image (see `pnpm test:browser:webkit`): it reaches the
// compose services of the host (PostgreSQL, Azurite, Mailpit) through local ports,
// starts the built API and web app, and runs the WebKit projects against them.
//
// The site is served over HTTPS here, as in production: WebKit does not keep a
// `Secure` cookie received over plain http://localhost (Chromium and Firefox make an
// exception for localhost), so over http nobody would stay signed in.
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.SERVICES_HOST ?? 'host.docker.internal';
// PostgreSQL and Mailpit (SMTP and API): the same ports as on the host, so the `.env`
// files work unchanged. Azurite (10000) is served over HTTPS below.
const PORTS = [5432, 2525, 8025];

for (const port of PORTS) {
  net
    .createServer((client) => {
      const upstream = net.connect(port, HOST);
      client.pipe(upstream).pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
    })
    .listen(port, '127.0.0.1');
}

/** The site as the browser sees it, with a certificate made for this run. */
const SITE = 'https://localhost:3443';
const tls = mkdtempSync(path.join(os.tmpdir(), 'webkit-tls-'));
const CERTIFICATE = path.join(tls, 'cert.pem');
execFileSync(
  'openssl',
  [
    ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2'],
    ...['-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'],
    ...['-keyout', path.join(tls, 'key.pem'), '-out', CERTIFICATE],
  ],
  { stdio: 'ignore' },
);

/** HTTPS on a local port, in front of a plain HTTP server. */
function serveHttps(port, host, targetPort) {
  https
    .createServer(
      { key: readFileSync(path.join(tls, 'key.pem')), cert: readFileSync(CERTIFICATE) },
      (request, response) => {
        const upstream = http.request(
          {
            host,
            port: targetPort,
            method: request.method,
            path: request.url,
            headers: { ...request.headers, 'x-forwarded-proto': 'https' },
          },
          (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(response);
          },
        );
        upstream.on('error', () => {
          response.writeHead(502).end();
        });
        request.pipe(upstream);
      },
    )
    .listen(port, '127.0.0.1');
}
// The file storage too: a page served over HTTPS may not show a picture or a document
// fetched over HTTP. In Azure the storage account is HTTPS already.
serveHttps(10000, HOST, 10000);

/**
 * The connection string of the storage emulator with an HTTPS address. The account
 * and its key are the ones every Azurite uses; they are read from the Azure SDK
 * instead of being written here.
 */
function azuriteOverHttps() {
  const { BlobServiceClient } = createRequire(path.join(root, 'apps/api/package.json'))(
    '@azure/storage-blob',
  );
  const { accountName, accountKey } = BlobServiceClient.fromConnectionString(
    'UseDevelopmentStorage=true',
  ).credential;
  return [
    'DefaultEndpointsProtocol=https',
    `AccountName=${accountName}`,
    `AccountKey=${accountKey.toString('base64')}`,
    `BlobEndpoint=https://localhost:10000/${accountName}`,
  ].join(';');
}

const LOGS = path.join(root, 'apps/web/test-results-webkit-stack');
mkdirSync(LOGS, { recursive: true });
const children = [];
function start(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd: path.join(root, cwd),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // What the two servers say, to read after a failed run.
  const log = createWriteStream(path.join(LOGS, `${name}.log`));
  let tail = '';
  const keep = (chunk) => {
    log.write(chunk);
    tail = (tail + String(chunk)).slice(-4000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', (code) => {
    if (code && !stopping) {
      process.stderr.write(`${name} stopped (${String(code)}):\n${tail}\n`);
    }
  });
  children.push(child);
  return child;
}
let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

async function ready(url, name) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${name} did not start`);
}

/**
 * The web app keeps API answers on disk. They hold addresses of pictures: http ones
 * written by a run on the host must not be served here, nor the https ones of this
 * run on the host afterwards.
 */
const forgetCachedData = () => {
  rmSync(path.join(root, 'apps/web/.next/cache/fetch-cache'), { recursive: true, force: true });
};

let code = 1;
try {
  forgetCachedData();
  // Every test signs in from the same address: without this the sign-in limit (5 a
  // minute) makes the run wait most of its time. Refused when NODE_ENV=production.
  start('api', 'node', ['dist/main.js'], 'apps/api', {
    NODE_EXTRA_CA_CERTS: CERTIFICATE,
    AZURE_STORAGE_CONNECTION_STRING: azuriteOverHttps(),
    PUBLIC_MEDIA_BASE_URL: 'https://localhost:10000/devstoreaccount1/public-media',
    RATE_LIMITS_ENABLED: 'false',
    // The origin the browser uses, for the links of the emails and the origin check...
    WEB_ORIGIN: SITE,
    // ...and the plain address of the web app for the API itself.
    WEB_INTERNAL_URL: 'http://localhost:3000',
  });
  await ready('http://localhost:4000/health/ready', 'The API');
  start('web', 'node', ['node_modules/next/dist/bin/next', 'start', '--port', '3000'], 'apps/web', {
    NODE_EXTRA_CA_CERTS: CERTIFICATE,
    CSP_MEDIA_ORIGINS: 'https://localhost:10000',
  });
  await ready('http://localhost:3000/en', 'The web app');
  serveHttps(3443, '127.0.0.1', 3000);
  const tests = spawn(
    'node',
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--project=webkit',
      '--project=webkit-admin',
      ...process.argv.slice(2),
    ],
    {
      cwd: path.join(root, 'apps/web'),
      env: { ...process.env, E2E_WEBKIT: '1', E2E_BASE_URL: SITE },
      stdio: 'inherit',
    },
  );
  code = await new Promise((resolve) => tests.on('exit', (status) => resolve(status ?? 1)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  stop();
  forgetCachedData();
}
process.exit(code);
