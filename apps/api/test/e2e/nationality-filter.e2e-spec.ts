import {
  createReadyCandidate,
  createTestApp,
  createUser,
  insertJob,
  resetDatabase,
  seedCatalog,
  type ReadyCandidate,
  type TestApp,
  type TestUser,
} from './app.js';
import { applyTo, as } from './back-office.js';

/**
 * The nationality filter of the candidate and application lists: one country or OTHER
 * (neither Morocco nor Tunisia, or none given), by nationality only, combined with the other
 * filters, in the totals and the export. A country agent never gets another country.
 */
describe('nationality filter (e2e)', () => {
  let test: TestApp;
  let recruiter: TestUser;
  let agentMA: TestUser;
  let agentTN: TestUser;
  let moroccan: ReadyCandidate;
  let tunisian: ReadyCandidate;
  /** Algerian national living in Tunisia: OTHER, never Tunisian. */
  let algerian: ReadyCandidate;
  /** No nationality given yet: OTHER too. */
  let unknown: ReadyCandidate;
  const app: Record<string, string> = {};

  const profile = async (
    candidate: ReadyCandidate,
    nationality: string | null,
    lastName: string,
    countryOfResidence = 'TN',
  ) =>
    test.prisma.candidateProfile.update({
      where: { id: candidate.profileId },
      data: { nationality, lastName, countryOfResidence },
    });

  beforeAll(async () => {
    test = await createTestApp();
    await resetDatabase(test.prisma);
    const catalog = await seedCatalog(test);
    const malta = (await insertJob(test, catalog, { slug: 'malta-job', destination: 'MALTA' })).id;
    const poland = (await insertJob(test, catalog, { slug: 'poland-job', destination: 'POLAND' }))
      .id;
    recruiter = await createUser(test, 'RECRUITER');
    agentMA = await createUser(test, 'COUNTRY_AGENT', undefined, ['MA']);
    agentTN = await createUser(test, 'COUNTRY_AGENT', undefined, ['TN']);
    moroccan = await createReadyCandidate(test);
    tunisian = await createReadyCandidate(test);
    algerian = await createReadyCandidate(test);
    unknown = await createReadyCandidate(test);
    await profile(moroccan, 'MA', 'Alaoui', 'MA');
    await profile(tunisian, 'TN', 'Trabelsi');
    await profile(algerian, 'DZ', 'Benali', 'TN');
    app.maMalta = await applyTo(test, moroccan, malta);
    app.maPoland = await applyTo(test, moroccan, poland);
    app.tnMalta = await applyTo(test, tunisian, malta);
    app.dzPoland = await applyTo(test, algerian, poland);
    // Applied while the nationality was known, then removed (the profile can be edited).
    app.unknownMalta = await applyTo(test, unknown, malta);
    await profile(unknown, null, 'Nomad');
    await as(test, recruiter)
      .patch(`/admin/applications/${app.maMalta}/status`, { status: 'UNDER_REVIEW' })
      .expect(200);
    await as(test, recruiter)
      .patch(`/admin/applications/${app.dzPoland}/status`, { status: 'UNDER_REVIEW' })
      .expect(200);
  });
  afterAll(async () => {
    await test.close();
  });

  const list = async (user: TestUser, path: string) => {
    const body = (await as(test, user).get(path).expect(200)).body as {
      items: { id: string }[];
      total: number;
    };
    return { ids: body.items.map((item) => item.id).sort(), total: body.total };
  };

  describe('candidates list', () => {
    it.each([
      ['MA', () => [moroccan.profileId]],
      ['ma', () => [moroccan.profileId]],
      ['TN', () => [tunisian.profileId]],
      ['OTHER', () => [algerian.profileId, unknown.profileId]],
    ])('nationality=%s', async (filter, expected) => {
      const { ids, total } = await list(recruiter, `/admin/candidates?nationality=${filter}`);
      expect(ids).toEqual(expected().sort());
      expect(total).toBe(ids.length);
    });

    it('uses the nationality, never the country of residence', async () => {
      // The Algerian lives in Tunisia, the Moroccan in Morocco.
      const tn = await list(recruiter, '/admin/candidates?nationality=TN');
      expect(tn.ids).not.toContain(algerian.profileId);
    });

    it('combines with the search', async () => {
      expect((await list(recruiter, '/admin/candidates?nationality=OTHER&q=Benali')).ids).toEqual([
        algerian.profileId,
      ]);
      expect((await list(recruiter, '/admin/candidates?nationality=MA&q=Benali')).ids).toEqual([]);
    });

    it('refuses an unknown code', async () => {
      await as(test, recruiter).get('/admin/candidates?nationality=XX').expect(400);
    });
  });

  describe('applications list', () => {
    it.each([
      ['nationality=MA', () => [app.maMalta, app.maPoland]],
      ['nationality=OTHER', () => [app.dzPoland, app.unknownMalta]],
      ['nationality=MA&status=UNDER_REVIEW', () => [app.maMalta]],
      ['nationality=MA&destination=POLAND', () => [app.maPoland]],
      ['nationality=OTHER&destination=POLAND&status=UNDER_REVIEW', () => [app.dzPoland]],
      ['nationality=TN&destination=POLAND', () => []],
      ['nationality=MA&q=Alaoui&destination=MALTA', () => [app.maMalta]],
      ['nationality=OTHER&q=Nomad', () => [app.unknownMalta]],
    ])('%s', async (query, expected) => {
      const { ids, total } = await list(recruiter, `/admin/applications?${query}`);
      expect(ids).toEqual(expected().sort());
      expect(total).toBe(ids.length);
    });
  });

  describe('export', () => {
    const exportCsv = (filters: object) =>
      as(test, recruiter)
        .post('/admin/applications/export', {
          format: 'csv',
          columns: ['lastName', 'nationality', 'status'],
          filters,
        })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        });

    it('follows the nationality filter with the others', async () => {
      const tn = ((await exportCsv({ nationality: 'TN' }).expect(200)).body as Buffer).toString();
      expect(tn).toContain('Trabelsi');
      expect(tn).not.toMatch(/Alaoui|Benali|Nomad/);
      const other = (
        (await exportCsv({ nationality: 'OTHER', status: 'UNDER_REVIEW' }).expect(200))
          .body as Buffer
      ).toString();
      expect(other).toContain('Benali');
      expect(other).not.toMatch(/Alaoui|Trabelsi|Nomad/);
    });
  });

  describe('country agents cannot pick another country', () => {
    it.each([
      ['/admin/candidates?nationality=TN'],
      ['/admin/candidates?nationality=OTHER'],
      ['/admin/candidates?nationality=DZ'],
      ['/admin/applications?nationality=TN'],
      ['/admin/applications?nationality=OTHER&status=UNDER_REVIEW'],
    ])('the Moroccan agent gets nothing for %s', async (path) => {
      expect(await list(agentMA, path)).toEqual({ ids: [], total: 0 });
    });

    it('gets his own country, filtered or not, and the Tunisian agent his', async () => {
      expect((await list(agentMA, '/admin/candidates')).ids).toEqual([moroccan.profileId]);
      expect((await list(agentMA, '/admin/candidates?nationality=MA')).ids).toEqual([
        moroccan.profileId,
      ]);
      expect(
        (await list(agentMA, '/admin/applications?nationality=MA&destination=POLAND')).ids,
      ).toEqual([app.maPoland]);
      expect((await list(agentTN, '/admin/candidates?nationality=MA')).ids).toEqual([]);
      expect((await list(agentTN, '/admin/applications')).ids).toEqual([app.tnMalta]);
    });

    it('cannot export at all', async () => {
      await as(test, agentMA)
        .post('/admin/applications/export', { format: 'csv', filters: { nationality: 'TN' } })
        .expect(403);
    });
  });
});
