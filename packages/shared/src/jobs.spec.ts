import { describe, expect, it } from 'vitest';
import { JOB_STATUSES } from './enums.js';
import {
  canTransitionJob,
  createDestinationSchema,
  createJobSchema,
  isJobOpen,
  jobListQuerySchema,
  jobSlugBase,
  slugify,
  updateJobSchema,
} from './jobs.js';

const DAY = 86_400_000;
const validJob = {
  title: 'Hotel Receptionist',
  destinationId: '11111111-1111-4111-8111-111111111111',
  categoryId: '22222222-2222-4222-8222-222222222222',
  description: 'Welcome guests and manage reservations at the front desk.',
  deadline: new Date(Date.now() + 30 * DAY).toISOString(),
};

describe('job status transitions', () => {
  const allowed = (action: Parameters<typeof canTransitionJob>[0]) =>
    JOB_STATUSES.filter((status) => canTransitionJob(action, status));

  it('publishes drafts only', () => {
    expect(allowed('publish')).toEqual(['DRAFT']);
  });
  it('closes published jobs only', () => {
    expect(allowed('close')).toEqual(['PUBLISHED']);
  });
  it('reopens closed jobs only', () => {
    expect(allowed('reopen')).toEqual(['CLOSED']);
  });
  it('archives anything that is not archived yet', () => {
    expect(allowed('archive')).toEqual(['DRAFT', 'PUBLISHED', 'CLOSED']);
  });
});

describe('isJobOpen', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const open = {
    status: 'PUBLISHED' as const,
    deadline: new Date(now.getTime() + DAY),
    positions: 3,
    hiredCount: 0,
    deletedAt: null,
  };

  it('is true for a published job with a future deadline and free positions', () => {
    expect(isJobOpen(open, now)).toBe(true);
  });

  it.each(['DRAFT', 'CLOSED', 'ARCHIVED'] as const)('is false for a %s job', (status) => {
    expect(isJobOpen({ ...open, status }, now)).toBe(false);
  });

  it('is false once the deadline is reached', () => {
    expect(isJobOpen({ ...open, deadline: now }, now)).toBe(false);
    expect(isJobOpen({ ...open, deadline: new Date(now.getTime() - 1) }, now)).toBe(false);
  });

  it('is false when every position is filled', () => {
    expect(isJobOpen({ ...open, hiredCount: 3 }, now)).toBe(false);
    expect(isJobOpen({ ...open, hiredCount: 2 }, now)).toBe(true);
  });

  it('is false for a deleted job', () => {
    expect(isJobOpen({ ...open, deletedAt: now }, now)).toBe(false);
  });
});

describe('slugs', () => {
  it('builds the slug from the title and the destination', () => {
    expect(jobSlugBase('Hotel Receptionist', 'Malta')).toBe('hotel-receptionist-malta');
    expect(jobSlugBase('International Truck Driver (C+E)', 'Poland')).toBe(
      'international-truck-driver-c-e-poland',
    );
    expect(jobSlugBase('Cabin Steward', 'Cruise ship')).toBe('cabin-steward-cruise-ship');
  });

  it('removes accents and symbols', () => {
    expect(slugify('  Réceptionniste d’hôtel — été 2027! ')).toBe(
      'receptionniste-d-hotel-ete-2027',
    );
  });

  it('falls back to "job" when the title has no Latin letters or digits', () => {
    expect(jobSlugBase('موظف استقبال', 'Malta')).toBe('job-malta');
  });

  it('limits the length without ending on a hyphen', () => {
    const slug = slugify('word '.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('createJobSchema', () => {
  it('accepts a minimal job and applies defaults', () => {
    expect(createJobSchema.parse(validJob)).toMatchObject({
      positions: 1,
      requiredLanguages: [],
      showEmployerName: false,
      accommodationProvided: false,
    });
  });

  it('drops status, featured, slug and hiredCount: they are not editable fields', () => {
    const parsed = createJobSchema.parse({
      ...validJob,
      status: 'PUBLISHED',
      featured: true,
      slug: 'chosen',
      hiredCount: 5,
    });
    for (const key of ['status', 'featured', 'slug', 'hiredCount']) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it('requires a currency and a period with a salary, and min <= max', () => {
    expect(createJobSchema.safeParse({ ...validJob, salaryMin: 1000 }).success).toBe(false);
    expect(
      createJobSchema.safeParse({ ...validJob, salaryMin: 1000, salaryCurrency: 'EUR' }).success,
    ).toBe(false);
    const salary = { salaryCurrency: 'eur', salaryPeriod: 'MONTH' };
    expect(
      createJobSchema.parse({ ...validJob, salaryMin: 1000, salaryMax: 1400, ...salary }),
    ).toMatchObject({
      salaryCurrency: 'EUR',
    });
    expect(
      createJobSchema.safeParse({ ...validJob, salaryMin: 1500, salaryMax: 1400, ...salary })
        .success,
    ).toBe(false);
  });

  it('rejects zero positions, a short description and a malformed deadline', () => {
    expect(createJobSchema.safeParse({ ...validJob, positions: 0 }).success).toBe(false);
    expect(createJobSchema.safeParse({ ...validJob, description: 'Too short' }).success).toBe(
      false,
    );
    expect(createJobSchema.safeParse({ ...validJob, deadline: '31/12/2026' }).success).toBe(false);
  });

  it('normalises language codes', () => {
    expect(
      createJobSchema.parse({ ...validJob, requiredLanguages: ['EN', ' fr '] }).requiredLanguages,
    ).toEqual(['en', 'fr']);
  });
});

describe('updateJobSchema', () => {
  it('accepts any subset of fields without adding defaults', () => {
    expect(updateJobSchema.parse({ title: 'New title' })).toEqual({ title: 'New title' });
  });

  it('rejects an empty body', () => {
    expect(updateJobSchema.safeParse({}).success).toBe(false);
    expect(updateJobSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(false);
  });
});

describe('jobListQuerySchema', () => {
  it('parses query-string values', () => {
    expect(
      jobListQuerySchema.parse({
        destination: 'malta',
        category: 'Hospitality',
        salaryMin: '1000',
        featured: 'false',
        language: 'EN',
        q: '  welders ',
        page: '2',
      }),
    ).toEqual({
      destination: 'MALTA',
      category: 'hospitality',
      salaryMin: 1000,
      featured: false,
      language: 'en',
      q: 'welders',
      page: 2,
      pageSize: 20,
    });
  });

  it('rejects an inverted salary range, an unknown sort and relevance without text', () => {
    expect(jobListQuerySchema.safeParse({ salaryMin: '2000', salaryMax: '1000' }).success).toBe(
      false,
    );
    expect(jobListQuerySchema.safeParse({ sort: 'random' }).success).toBe(false);
    expect(jobListQuerySchema.safeParse({ sort: 'relevance' }).success).toBe(false);
    expect(jobListQuerySchema.safeParse({ sort: 'relevance', q: 'cook' }).success).toBe(true);
  });

  it('rejects a one-letter search and an invalid boolean', () => {
    expect(jobListQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(jobListQuerySchema.safeParse({ featured: 'yes' }).success).toBe(false);
  });
});

describe('createDestinationSchema', () => {
  it('upper-cases the code and requires the three languages', () => {
    const name = { en: 'Germany', fr: 'Allemagne', ar: 'ألمانيا' };
    expect(createDestinationSchema.parse({ code: 'germany', name }).code).toBe('GERMANY');
    expect(
      createDestinationSchema.safeParse({ code: 'GERMANY', name: { en: 'Germany' } }).success,
    ).toBe(false);
    expect(createDestinationSchema.safeParse({ code: 'de many', name }).success).toBe(false);
  });
});
