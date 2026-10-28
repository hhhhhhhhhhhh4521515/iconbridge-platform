# ADR-017: Shorter cold starts without a warm replica

Date: 2026-10-16. Status: accepted.

## Context

Both Container Apps scale to zero (ADR-013) to stay inside the credit. On 15 October a visit with both apps at zero took 141 s. The timeline from the platform logs (seconds after the request):

| Step                                                         | Web                  | API                                                                                                             |
| ------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Scale-up starts                                              | 0                    | 42.7: only when the first page called it                                                                        |
| Platform (scheduling, identity, Key Vault secrets, sidecars) | 2 → 21.8             | 42.7 → 62.8                                                                                                     |
| Image pull (cached on the node)                              | 0.2 s                | 0.1 s                                                                                                           |
| Process ready                                                | +1.2 s               | +13.7 s (Nest, on 0.5 vCPU)                                                                                     |
| Probes                                                       | readiness every 15 s | readiness every 15 s with a 1 s timeout: the first check, which opened the first database connection, timed out |
| First request served                                         |                      | 123.9                                                                                                           |

Measured locally at the same CPU: the API listened after 12.0 s on 0.5 vCPU and 6.0 s on 1 vCPU (CPU-bound module loading: in ESM the whole import graph is read and compiled before any code runs); the web app was ready in 3.5 s and rendered its first page in 1.4 s on 0.25 vCPU, against 1.8 s and 0.7 s on 0.5 vCPU.

## Decision

1. **Probes**: startup probes every second from the start (no initial delay, up to 60 s); readiness every 3 s with a 3 s timeout, for both apps.
2. **Wake the API with the web app**: when the web server starts (`instrumentation.ts`), it sends one request to the API's liveness endpoint without waiting, so the two start-ups overlap instead of following each other. Probes still never call the API.
3. **Lazy loading in the API**: mjml, exceljs, archiver, sharp and the Azure Storage and Email SDKs are imported on first use (`lazy()`, dynamic `import()`); DOMPurify with jsdom is loaded synchronously on the first rich text; zxcvbn builds its dictionaries on the first password; `date-fns` is imported by sub-path. Start-up on 0.5 vCPU: 10.5 s → 4.2–4.9 s.
4. **Database connection opened just after the API listens**, in the background, so the readiness probe and the first request do not pay for TLS and authentication.
5. **Web app at 0.5 vCPU / 1 GiB** (was 0.25 / 0.5): it only costs while it runs, and its start-up and first render are CPU-bound.

Rejected for now:

- A warm replica (`min_replicas = 1`): the only way to remove the platform's share, but it costs money every hour; left to the owner.
- Node's compile cache filled at image build: 0.4 s more after lazy loading, for 16 MB and a start of the app during the build.
- Background loading of jsdom after start-up: a synchronous load blocks the event loop for about a second on 0.5 vCPU, possibly under the first request.

## Later changes

- 28 October 2026: the owner raised the budget to 40 USD a month and both apps keep one warm replica ([ADR-022](ADR-022-warm-replicas.md)). The measures above still shorten the start of a second replica and of every new revision.

## Consequences

- What remains is mostly the platform's own start of each replica (about 10–20 s per app), which only a warm replica avoids.
- An export, an email, an image upload or the first job page with rich text takes up to about a second longer on a fresh replica.
- New heavy dependencies should be imported where they are used, not at the top of a module loaded at start-up; `scripts/measure-cold-start.sh` measures a cold start on Azure.
