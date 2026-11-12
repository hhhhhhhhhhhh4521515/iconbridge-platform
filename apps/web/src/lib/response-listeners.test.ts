import { createServer, request, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { raiseResponseListenerLimit, RESPONSE_MAX_LISTENERS } from './response-listeners';

describe('listener limit of web responses', () => {
  it('lets a response hold the listeners of the rewrite proxy and telemetry without a warning', async () => {
    raiseResponseListenerLimit();
    raiseResponseListenerLimit();
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => {
      warnings.push(warning);
    };
    process.on('warning', onWarning);
    let limit = 0;
    const server = createServer((_req, res: ServerResponse) => {
      limit = res.getMaxListeners();
      // As many as Next.js's rewrite proxy and the HTTP instrumentation add to one response.
      for (let i = 0; i < 11; i += 1) {
        res.on('close', () => undefined);
      }
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      request({ port }, (response) => {
        response.resume().on('end', resolve);
      })
        .on('error', reject)
        .end();
    });
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await new Promise((resolve) => setImmediate(resolve));
    process.off('warning', onWarning);
    expect(limit).toBe(RESPONSE_MAX_LISTENERS);
    expect(warnings.filter((w) => w.name === 'MaxListenersExceededWarning')).toEqual([]);
  });
});
