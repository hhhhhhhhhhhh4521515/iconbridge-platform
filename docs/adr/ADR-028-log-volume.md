# ADR-028: Less telemetry noise, so the Log Analytics cap is not reached

Date: 2026-11-11. Status: accepted.

## Context

The Log Analytics workspace has a daily cap of 0.15 GB, so that its volume stays under the 5 GB a month that Log Analytics includes. The workspace reached the cap every day from 4 to 11 November. On 11 November it was reached at 20:00 UTC.

Past the cap, nothing is ingested until 01:00 UTC. The log alerts lose their data:

- the tasks alert ("no `send-emails` report for an hour") fired falsely at 01:15 to 02:00 UTC on 8, 9 and 10 November;
- a real failure in the evening would not have been seen.

Billable volume on 10 November (the cap stopped ingestion at 22:18 UTC, so 22.3 hours of data):

| Table                                | MB    | What fills it                                                                                                                                                                                  |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppDependencies                      | 89.4  | API to PostgreSQL 69.4: `SELECT` 37.0, `pg-pool.connect` 21.9, `pg.connect` 5.1, `BEGIN`/`COMMIT` 4.0. Web to API 20.0                                                                         |
| AppRequests                          | 38.6  | Web 32.1 (pages, RSC requests, the 307/308 redirects to `https://www.`), API 6.8                                                                                                               |
| AppMetrics                           | 13.4  | Standard metrics 5.3 (behind the 5xx alert), `db.client.*` 4.7, `http.*.duration` 3.5                                                                                                          |
| AppPerformanceCounters               | 10.3  | CPU, memory, requests per second and exceptions per second, every minute per replica                                                                                                           |
| ContainerAppConsoleLogs_CL           | 9.6   | API "request completed" for 2xx and 3xx 7.2; Nest start-up lines of the tasks job (one per module, 96 runs a day) 1.0; web `MaxListenersExceededWarning` 0.7; pg SSL warning 0.2; the rest 0.5 |
| ContainerAppSystemLogs_CL and others | 0.7   | Container Apps events, blob logs, exceptions, custom events                                                                                                                                    |
| **Total**                            | 162.0 | About 174 MB for a full day                                                                                                                                                                    |

Health probes were already left out (ADR-019, decision 4): fewer than 10 rows a day.

## Decisions

1. **No spans for opening a pooled connection.** `ignoreConnectSpans` of the pg instrumentation. Queries are still recorded.
2. **No performance counters** (`enablePerformanceCounters: false`). CPU, memory and replica counts are in the Container Apps metrics, which cost nothing to ingest. No alert used the counters.
3. **No log line for successful requests and redirects.** pino-http logs 4xx at `warn` and 5xx and errors at `error` (`requestLogLevel`). Successful requests stay visible in Application Insights.
4. **Nest's start-up messages only from `warn` up** (`isFrameworkNoise`, a pino hook): contexts `InstanceLoader`, `RoutesResolver`, `RouterExplorer`, `NestFactory`, `NestApplication`. The application's own info lines, such as task reports and job alerts, are kept.
5. **Traces sampled at 50 % in the SDK**, the same ratio in the API and the web (`TELEMETRY_SAMPLING` in `packages/shared`). This replaces ADR-019 decision 6 ("sampling 100 %"). Ingestion sampling on the Application Insights resource stays at 100 %.
   - The distro's sampler decides from the trace id. A page and the API calls it makes are therefore kept or dropped together, unlike the ingestion sampling tried in October, which kept a request's database calls without the request.
   - Sampled-out spans are still recorded and pass through the distro's span processor. The standard metrics, which the 5xx alert and the failure charts read, therefore count every request and every failure.
   - Kept rows carry their sample rate (`ItemCount` = 2). The workbook already sums `ItemCount`.
6. **Kept complete**:
   - every 4xx and 5xx line and every error in the container logs;
   - the task reports and job events that the log alerts read;
   - business events (`enableTraceBasedSamplingForLogs: false`);
   - the standard metrics;
   - the audit log, which lives in the database (`audit_logs`) and is not telemetry.

   Exceptions in Application Insights follow their trace, so half of them are kept. Their count is extrapolated, and each one is also in the container logs.

7. **The cap stays at 0.15 GB.** Expected volume about 71 MB a day: dependencies 34, requests 21, metrics 14, console logs 1.4, the rest 1. That is under half the cap, so the traffic can double before the cap is reached again. Ingestion stays inside the included 5 GB a month, so the cost is unchanged (0 USD) and well under the 40 USD budget.

## Consequences

- A single successful request may be missing from Application Insights. Use the metrics, or reproduce the request.
- The volume is checked after the deployment, from the `Usage` table, and recorded in the journal.
- Two noise sources remain for later:
  - the web's `MaxListenersExceededWarning` (0.7 MB a day), which may point to a listener leak and is worth fixing in the code rather than hiding;
  - the pg warning about `sslmode=require` (0.2 MB a day). Changing the address to `verify-full` also changes what Prisma, `pg_dump` and the migration job do.
