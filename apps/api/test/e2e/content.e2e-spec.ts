import { adminSuccessStorySchema, publicSuccessStorySchema } from '@iconbridge/shared';
import {
  API,
  createTestApp,
  createUser,
  FAKE_PRIVATE_HOST,
  insertJob,
  resetDatabase,
  seedCatalog,
  type Catalog,
  type TestApp,
  type TestUser,
} from './app.js';
import { advanceTo, as, newApplication } from './back-office.js';
import { exe, jpg, pdf, png, text } from './files.js';

const quote = {
  en: 'They guided me at every step.',
  fr: "Ils m'ont accompagnée.",
  ar: 'رافقوني في كل خطوة.',
};

describe('success stories and home slides (e2e)', () => {
  let test: TestApp;
  let catalog: Catalog;
  let viewer: TestUser;
  let recruiter: TestUser;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.files.clear();
    test.privateFiles.clear();
    catalog = await seedCatalog(test);
    viewer = await createUser(test, 'VIEWER');
    recruiter = await createUser(test, 'RECRUITER');
  });

  const story = (overrides: object = {}) => ({
    firstName: 'Amira',
    lastName: 'Ben Salah',
    jobTitle: 'Hotel Receptionist',
    destinationId: catalog.destinations.MALTA,
    visaApprovedAt: '2026-06-15',
    quote,
    ...overrides,
  });
  const createStory = async (overrides: object = {}) =>
    adminSuccessStorySchema.parse(
      (await as(test, recruiter).post('/admin/success-stories', story(overrides)).expect(201)).body,
    );
  const publicStories = async () =>
    ((await test.http().get(`${API}/success-stories`).expect(200)).body as unknown[]).map((item) =>
      publicSuccessStorySchema.parse(item),
    );

  describe('consent rule', () => {
    it('refuses to publish a story without a consent document', async () => {
      const created = await createStory();
      expect(created).toMatchObject({ isPublished: false, hasConsentDocument: false });
      const refused = await as(test, recruiter)
        .post(`/admin/success-stories/${created.id}/publish`)
        .expect(409);
      expect(refused.body).toMatchObject({ code: 'CONSENT_REQUIRED' });
      expect(
        (await test.prisma.successStory.findUniqueOrThrow({ where: { id: created.id } }))
          .isPublished,
      ).toBe(false);
      expect(await publicStories()).toEqual([]);
    });

    it('publishes once the consent is uploaded, and unpublishes on request', async () => {
      const created = await createStory();
      const withConsent = await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, pdf(), 'consent.pdf')
        .expect(200);
      expect(withConsent.body).toMatchObject({ hasConsentDocument: true, isPublished: false });
      await as(test, recruiter).post(`/admin/success-stories/${created.id}/publish`).expect(200);
      expect(await publicStories()).toHaveLength(1);
      await as(test, recruiter).post(`/admin/success-stories/${created.id}/unpublish`).expect(200);
      expect(await publicStories()).toEqual([]);
    });

    it('cannot be bypassed: publication is not a field of create or update, and the database refuses it too', async () => {
      const created = await createStory({ isPublished: true, consentDocumentPath: 'x.pdf' });
      expect(created.isPublished).toBe(false);
      await as(test, recruiter)
        .patch(`/admin/success-stories/${created.id}`, { isPublished: true })
        .expect(400);
      await as(test, recruiter)
        .patch(`/admin/success-stories/${created.id}`, { jobTitle: 'Chef', isPublished: true })
        .expect(200);
      expect(
        (await test.prisma.successStory.findUniqueOrThrow({ where: { id: created.id } }))
          .isPublished,
      ).toBe(false);
      await expect(
        test.prisma.successStory.update({ where: { id: created.id }, data: { isPublished: true } }),
      ).rejects.toThrow(/success_stories_consent_check/);
    });

    it('stores the consent privately, accepts PDF, JPG and PNG, and refuses anything else', async () => {
      const created = await createStory();
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, exe(), 'consent.pdf')
        .expect(415);
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, text(), 'consent.pdf')
        .expect(415);
      expect(test.privateFiles.size).toBe(0);
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, await png(), 'consent.png')
        .expect(200);
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, await jpg(), 'consent.jpg')
        .expect(200);
      // Replaced, in the private store only.
      expect([...test.privateFiles.keys()]).toEqual([
        expect.stringMatching(new RegExp(`^consents/${created.id}/[0-9a-f-]{36}\\.jpg$`)),
      ]);
      expect(test.files.size).toBe(0);
    });

    it('lets the back office download the consent through an audited temporary link, never the public', async () => {
      const created = await createStory();
      await as(test, recruiter).get(`/admin/success-stories/${created.id}/consent`).expect(404);
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, pdf(), 'consent.pdf')
        .expect(200);
      const response = await as(test, recruiter)
        .get(`/admin/success-stories/${created.id}/consent`)
        .expect(302);
      expect(response.headers['location']).toContain(
        `${FAKE_PRIVATE_HOST}/consents/${created.id}/`,
      );
      expect(
        await test.prisma.auditLog.count({ where: { action: 'success_story.download_consent' } }),
      ).toBe(1);
      await as(test, recruiter).post(`/admin/success-stories/${created.id}/publish`).expect(200);
      expect(JSON.stringify(await publicStories())).not.toMatch(/consent/i);
    });
  });

  describe('public list', () => {
    const published = async (overrides: object = {}) => {
      const created = await createStory(overrides);
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, pdf(), 'c.pdf')
        .expect(200);
      await as(test, recruiter).post(`/admin/success-stories/${created.id}/publish`).expect(200);
      return created;
    };

    it('shows the first name and the initial of the last name, unless the full name was agreed', async () => {
      await published();
      await published({ firstName: 'Youssef', lastName: 'Trabelsi', showFullName: true });
      await published({ firstName: 'Lina', lastName: '' });
      const stories = await publicStories();
      // The newest story comes first until somebody reorders them.
      expect(stories.map((item) => item.name)).toEqual(['Lina', 'Youssef Trabelsi', 'Amira B.']);
      const raw = JSON.stringify(stories);
      expect(raw).not.toContain('Ben Salah');
      expect(raw).not.toContain('lastName');
    });

    it('returns published stories only, in their order, with destination, date, quote and photo', async () => {
      const first = await published();
      await createStory({ firstName: 'Draft' });
      const second = await published({
        firstName: 'Second',
        destinationId: catalog.destinations.POLAND,
      });
      await as(test, recruiter)
        .upload(`/admin/success-stories/${first.id}/photo`, await jpg(), 'p.jpg')
        .expect(200);

      const [newest, oldest] = await publicStories();
      // A new story is placed first, so that it is among those the home page shows.
      expect([newest?.name, oldest?.name]).toEqual(['Second B.', 'Amira B.']);
      const stories = [oldest, newest];
      expect(stories[0]).toMatchObject({
        jobTitle: 'Hotel Receptionist',
        destination: { code: 'MALTA' },
        visaApprovedAt: '2026-06-15',
        quote,
      });
      expect(stories[0]?.photoUrl).toMatch(
        new RegExp(
          `^https://media\\.example\\.test/stories/${first.id}/photo-[0-9a-f]{16}\\.webp$`,
        ),
      );
      expect(stories[1]?.photoUrl).toBeNull();

      const all = (await as(test, recruiter).get('/admin/success-stories').expect(200)).body as {
        id: string;
      }[];
      await as(test, recruiter)
        .put('/admin/success-stories/order', {
          ids: [first.id, ...all.map((s) => s.id).filter((id) => id !== first.id)],
        })
        .expect(200);
      expect((await publicStories()).map((item) => item.name)).toEqual(['Amira B.', 'Second B.']);
      await as(test, recruiter)
        .put('/admin/success-stories/order', { ids: [second.id] })
        .expect(400);
    });
  });

  describe('create from an application', () => {
    it('prefills a draft from an application that is Visa approved or Deployed', async () => {
      const job = await insertJob(test, catalog, {
        slug: 'welder',
        title: 'Welder',
        destination: 'POLAND',
      });
      const { candidate, id } = await newApplication(test, job.id);
      await test.prisma.candidateProfile.update({
        where: { id: candidate.profileId },
        data: { firstName: 'Omar', lastName: 'Haddad' },
      });

      const early = await as(test, recruiter)
        .post(`/admin/success-stories/from-application/${id}`)
        .expect(409);
      expect(early.body).toMatchObject({ code: 'CONFLICT', details: { status: 'SUBMITTED' } });

      await advanceTo(test, recruiter, id, 'VISA_APPROVED');
      const created = adminSuccessStorySchema.parse(
        (
          await as(test, recruiter)
            .post(`/admin/success-stories/from-application/${id}`)
            .expect(201)
        ).body,
      );
      expect(created).toMatchObject({
        firstName: 'Omar',
        lastName: 'Haddad',
        showFullName: false,
        publicName: 'Omar H.',
        jobTitle: 'Welder',
        destination: { code: 'POLAND' },
        visaApprovedAt: new Date().toISOString().slice(0, 10),
        applicationId: id,
        isPublished: false,
        hasConsentDocument: false,
      });
      // Still needs the consent before it can be published.
      await as(test, recruiter).post(`/admin/success-stories/${created.id}/publish`).expect(409);
      await as(test, recruiter)
        .post('/admin/success-stories/from-application/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });
  });

  describe('editing and permissions', () => {
    it('edits and deletes a story with its files', async () => {
      const created = await createStory();
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/photo`, await jpg(), 'p.jpg')
        .expect(200);
      await as(test, recruiter)
        .upload(`/admin/success-stories/${created.id}/consent`, pdf(), 'c.pdf')
        .expect(200);
      const edited = await as(test, recruiter)
        .patch(`/admin/success-stories/${created.id}`, { showFullName: true, visaApprovedAt: null })
        .expect(200);
      expect(edited.body).toMatchObject({ publicName: 'Amira Ben Salah', visaApprovedAt: null });
      await as(test, recruiter).delete(`/admin/success-stories/${created.id}`).expect(204);
      expect(test.files.size + test.privateFiles.size).toBe(0);
      expect(await test.prisma.successStory.count()).toBe(0);
    });

    it('is closed to viewers and candidates, and audited', async () => {
      const candidate = await createUser(test, 'CANDIDATE');
      for (const user of [viewer, candidate]) {
        await as(test, user).get('/admin/success-stories').expect(403);
        await as(test, user).post('/admin/success-stories', story()).expect(403);
        await as(test, user).get('/admin/home-slides').expect(403);
      }
      const created = await createStory();
      const entry = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'success_story.create' },
      });
      expect(entry).toMatchObject({
        actorId: recruiter.id,
        entityId: created.id,
        after: { isPublished: false },
      });
      // The audit entry does not copy the person's name.
      expect(JSON.stringify(entry)).not.toContain('Amira');
    });
  });

  describe('home slides', () => {
    const title = { en: 'Work in Malta', fr: 'Travaillez à Malte', ar: 'اعمل في مالطا' };
    const publicSlides = async () =>
      (await test.http().get(`${API}/home-slides`).expect(200)).body as {
        id: string;
        imageUrl: string;
      }[];

    it('creates an inactive slide, needs an image to activate it, then shows it publicly', async () => {
      const created = await as(test, recruiter)
        .post('/admin/home-slides', {
          title,
          ctaUrl: '/jobs?destination=MALTA',
          destinationId: catalog.destinations.MALTA,
        })
        .expect(201);
      const id = (created.body as { id: string }).id;
      expect(created.body).toMatchObject({
        isActive: false,
        imageUrl: null,
        destinationCode: 'MALTA',
      });
      expect(await publicSlides()).toEqual([]);

      const refused = await as(test, recruiter)
        .patch(`/admin/home-slides/${id}`, { isActive: true })
        .expect(409);
      expect(refused.body).toMatchObject({ code: 'IMAGE_REQUIRED' });

      await as(test, recruiter)
        .upload(`/admin/home-slides/${id}/image`, await jpg(), 'slide.jpg')
        .expect(200);
      await as(test, recruiter).patch(`/admin/home-slides/${id}`, { isActive: true }).expect(200);
      const slides = await publicSlides();
      expect(slides).toHaveLength(1);
      expect(slides[0]?.imageUrl).toMatch(
        new RegExp(`^https://media\\.example\\.test/slides/${id}/slide-[0-9a-f]{16}\\.webp$`),
      );

      await as(test, recruiter).patch(`/admin/home-slides/${id}`, { isActive: false }).expect(200);
      expect(await publicSlides()).toEqual([]);
    });

    it('reorders, edits and deletes slides; refuses unsafe links and bad images', async () => {
      const ids: string[] = [];
      for (const name of ['One', 'Two', 'Three']) {
        const created = await as(test, recruiter)
          .post('/admin/home-slides', { title: { en: name, fr: name, ar: name } })
          .expect(201);
        const id = (created.body as { id: string }).id;
        await as(test, recruiter)
          .upload(`/admin/home-slides/${id}/image`, await png(), 's.png')
          .expect(200);
        await as(test, recruiter).patch(`/admin/home-slides/${id}`, { isActive: true }).expect(200);
        ids.push(id);
      }
      expect((await publicSlides()).map((slide) => slide.id)).toEqual(ids);
      await as(test, recruiter)
        .put('/admin/home-slides/order', { ids: [...ids].reverse() })
        .expect(200);
      expect((await publicSlides()).map((slide) => slide.id)).toEqual([...ids].reverse());

      await as(test, recruiter)
        .patch(`/admin/home-slides/${ids[0] ?? ''}`, { ctaUrl: 'javascript:alert(1)' })
        .expect(400);
      await as(test, recruiter)
        .post('/admin/home-slides', { title: { en: 'x' } })
        .expect(400);
      await as(test, recruiter)
        .upload(`/admin/home-slides/${ids[0] ?? ''}/image`, exe(), 'slide.jpg')
        .expect(415);

      await as(test, recruiter)
        .delete(`/admin/home-slides/${ids[0] ?? ''}`)
        .expect(204);
      expect(await publicSlides()).toHaveLength(2);
      expect(test.files.size).toBe(2);
    });
  });
});
