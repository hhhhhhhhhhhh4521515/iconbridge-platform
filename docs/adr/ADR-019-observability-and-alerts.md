# ADR-019: Observability and alerts within the student budget

Date: 2026-10-20. Status: accepted.

## Context

Prompt 14 asks for traces and business events in Application Insights, a workbook, and alerts by email on server errors, availability, the database, the storage, the scheduled tasks and abandoned emails, without exceeding 15 USD a month. Both apps scale to zero (ADR-013, ADR-017) and the API is an ES module, which OpenTelemetry instruments only with a loader hook.

## Decisions

1. **Azure Monitor OpenTelemetry distro** (`@azure/monitor-opentelemetry`) in the API and the web app, started only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (Azure), so local runs and tests send nothing. Cloud role names `iconbridge-api` and `iconbridge-web`.
2. **API without the ESM loader hook.** Measured on 0.5 vCPU: start-up 4.2 s without telemetry, 6.0 s with telemetry started by `node --import ./dist/telemetry/telemetry.js`, 9.2 s or more with the loader hook, which also needed more files kept in the image (`import-in-the-middle`, `cjs-module-lexer`, …). Without the hook, OpenTelemetry still hooks the CommonJS modules: Express and its HTTP server (requests), pg (database dependencies), the Azure SDK. Verified against Application Insights with a test role name.
3. **Web app** starts the distro in `instrumentation.ts` (dynamic import, `serverExternalPackages`); Next.js creates the spans of its requests and `fetch` calls (the calls to the API, as dependencies). About 1.3 s more at start (1.6 → 2.9 s on 0.5 vCPU).
4. **No personal data in telemetry**: query strings are removed from every URL attribute (email links carry tokens, searches carry text), health probes and static files are not recorded (they would also fill the daily cap), exceptions keep their type and stack but not their message, custom events carry ids and statuses only. Log lines gain `traceId` and `spanId`, so a request's logs and its trace meet.
5. **Business events** through the OpenTelemetry logs API with `microsoft.custom_event.name`: `application_submitted` (application and job ids), `status_changed` (application id, from, to), `cooldown_blocked` (job id).
6. **Ingestion sampling 100 %** instead of 25 %. At this traffic, sampling dropped whole requests: in the first test, the database calls of a request arrived and the request did not, and the "more than 5 errors in 5 minutes" alert could not be trusted. Volume stays tiny; the 0.15 GB/day cap of the workspace still bounds the cost.
7. **Alerts to an action group (email to the owner)**, never through the app's outbox, which an incident or the 10-emails-an-hour quota could block (Terraform `modules/monitoring`):

   | Alert                   | Signal                                                                                                                             |
   | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
   | API 5xx                 | Application Insights metric `requests/failed`, role `iconbridge-api`, more than 5 in 5 minutes                                     |
   | Database CPU            | `cpu_percent` above 80 % for 15 minutes                                                                                            |
   | Storage failures        | Blob storage `Availability` below 99 % over 15 minutes                                                                             |
   | Scheduled tasks         | Log alert every 15 minutes over the last hour: a task reported `ok: false`, an execution failed, or no `send-emails` report at all |
   | Emails abandoned        | Log alert every hour: "Email not sent … given up" in the API or tasks logs                                                         |
   | Availability (optional) | Standard tests on `/en` and `/api/health/ready`, every 15 minutes from one location, 120 s timeout                                 |
   | Budget                  | Already in place: 50, 80, 100 % of 15 USD                                                                                          |

8. **Availability tests off by default** (`enable_availability_tests`). Each run wakes the apps from zero and keeps them running through their 5-minute cooldown; apps that scale to zero pay the active rate whenever a replica runs (the idle rate only applies to a minimum replica count). Every 15 minutes, both apps would run about 40 % of the month: about 25–30 USD of compute, twice the budget, plus about 0.0005 USD per run. They are switched on to check them, and for good together with a warm replica (ADR-017).
9. **Forced error for checks**: `POST /admin/diagnostics/error` (super admin, audited) answers 500 on purpose; more than 5 calls in 5 minutes must fire the API 5xx alert (docs/RUNBOOK.md).
10. **Workbook in Terraform**: requests per minute, p95 latency, error rate, applications per day, business events, scheduled tasks, exceptions by type, container restarts (Container Apps metric `RestartCount`).

## Consequences

- Monitoring costs about 1–2 USD a month (four metric alerts at about 0.10 USD, two log alerts at about 0.50 USD, telemetry inside the free 5 GB).
- Without availability tests, an outage while nobody visits is only noticed by the next visitor, the next deployment's smoke test, or the tasks alert if the database is down.
- Telemetry adds about 1–2 s to each cold start (about 58 s in all).
