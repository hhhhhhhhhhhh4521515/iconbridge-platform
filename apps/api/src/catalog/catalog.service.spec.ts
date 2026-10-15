import type { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService, STATS_TTL_MS } from './catalog.service.js';
import type { ResultsService } from './results.service.js';

const platform = { registeredCandidates: 3, visasApproved: 1, partnerCompanies: 2, countries: 4 };

function setup() {
  let partnerCompanies = 10;
  let release: (() => void) | null = null;
  const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ count: 5 }]) };
  const results = {
    platform: vi.fn().mockResolvedValue(platform),
    // Reads the figure at the start, like a database read that began before a change.
    history: vi.fn(() => {
      const value = partnerCompanies;
      const historical = {
        registeredCandidates: 0,
        visasApproved: 0,
        partnerCompanies: value,
        countries: 0,
      };
      return release === null
        ? Promise.resolve(historical)
        : new Promise((resolve) => {
            const previous = release;
            release = () => {
              previous?.();
              resolve(historical);
            };
          });
    }),
  };
  const catalog = new CatalogService(
    prisma as unknown as PrismaService,
    results as unknown as ResultsService,
  );
  return {
    catalog,
    results,
    setFigure: (value: number) => {
      partnerCompanies = value;
    },
    holdReads: () => {
      release = () => undefined;
    },
    releaseReads: () => {
      const held = release;
      release = null;
      held?.();
    },
  };
}

describe('CatalogService.publicStats', () => {
  it('keeps the counters for ten minutes, then reads them again', async () => {
    const { catalog, results, setFigure } = setup();
    expect((await catalog.publicStats(0)).partnerCompanies).toBe(12);
    setFigure(50);
    expect((await catalog.publicStats(STATS_TTL_MS - 1)).partnerCompanies).toBe(12);
    expect((await catalog.publicStats(STATS_TTL_MS)).partnerCompanies).toBe(52);
    expect(results.history).toHaveBeenCalledTimes(2);
  });

  it('reads again at once after a clear', async () => {
    const { catalog, setFigure } = setup();
    await catalog.publicStats(0);
    setFigure(50);
    catalog.clearStatsCache();
    expect((await catalog.publicStats(1)).partnerCompanies).toBe(52);
  });

  it('does not keep counters that were being read when a figure changed', async () => {
    const { catalog, setFigure, holdReads, releaseReads } = setup();
    // A visitor's read starts with the old figure...
    holdReads();
    const inFlight = catalog.publicStats(0);
    // ...the back office changes it and clears the cache before that read ends.
    setFigure(50);
    catalog.clearStatsCache();
    releaseReads();
    expect((await inFlight).partnerCompanies).toBe(12);
    // The old value was not kept: the next visitor sees the new one.
    expect((await catalog.publicStats(1)).partnerCompanies).toBe(52);
  });
});
