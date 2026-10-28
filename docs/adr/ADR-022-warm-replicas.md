# ADR-022: One warm replica for the web app and the API

Date: 2026-10-28. Status: accepted.

## Context

Both Container Apps scaled to zero (ADR-013) to fit a 15 USD budget. ADR-017 cut the cold start from 141 s, but the platform's own start of each replica (about 10–20 s per app) remained, and only a replica that never stops avoids it. The owner raised the budget to 40 USD a month to remove the wait for the first visitor.

Container Apps price a running replica in two ways (Italy North list prices, 28 October 2026): memory 0.000004 USD per GiB-second at all times, and vCPU 0.000034 USD per second while the replica is **active** against 0.000004 while it is **idle**. A replica is idle when it serves no request, uses under 0.01 vCPU and receives under 1,000 bytes a second, and the idle rate applies only to the replicas kept by the minimum count. The subscription's free grant (180,000 vCPU-seconds and 360,000 GiB-seconds a month) is mostly used by the jobs today.

Measured over 25–28 October, while running: API 0.055 vCPU and 190 MB on average (285 MB at most), web 0.040 vCPU and 125 MB (216 MB at most). These hours include start-ups, the load test and the browser checks, so a quiet replica uses less.

## Decision

1. `min_replicas = 1` for the web app and the API (`api_size`, `web_size`). Sizes stay at 0.5 vCPU / 1 GiB and the maximum at 2 replicas.
2. Budget of the resource group: 40 USD a month, emails at 50, 80 and 100 % (20, 32 and 40 USD).

## Expected cost

For a 730-hour month, the two replicas use 2,628,000 vCPU-seconds and 5,256,000 GiB-seconds:

| Part                                            | USD a month  |
| ----------------------------------------------- | ------------ |
| Memory, 2 × 1 GiB, after the free grant         | about 19.8   |
| vCPU, 2 × 0.5, idle the whole month             | about 9.9    |
| **Floor (no visitor at all)**                   | **about 30** |
| Each hour one replica is active instead of idle | + 0.054      |
| Both apps active 2 hours a day                  | + about 6.5  |
| Other services (free tiers, ADR-013)            | 0 to 1       |
| **Expected**                                    | **30 to 37** |

The bill cannot be read from the CLI on this offer (usage rows carry no price); Cost Management in the portal shows it, and the budget emails warn first.

## Consequences

- No cold start: the first visitor gets the page in well under a second; the web app's wake-up call to the API (ADR-017) only matters for the second replica.
- The credit now goes at 30 to 37 USD a month instead of almost nothing (the free tiers covered everything with scale to zero); the spending limit still stops everything when it is spent, so the remaining credit (portal, **Education**) divided by the month's cost is how long the site stays up.
- Cheaper alternatives if the bill comes in high: the API at 0.25 vCPU / 0.5 GiB (its measured peak of 285 MB fits, about 7.5 USD a month less, but image re-encoding and exports have less headroom), or a warm replica for the web app only (the API then cold-starts behind it, about 15 USD less).
- The availability tests (ADR-019) no longer wake anything and could be switched on; they stay off until the bill of a full month is known.
