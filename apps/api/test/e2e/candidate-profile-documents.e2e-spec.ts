import { candidateProfileResponseSchema } from '@iconbridge/shared';
import {
  API,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  FAKE_PRIVATE_HOST,
  insertJob,
  resetDatabase,
  seedCatalog,
  type ReadyCandidate,
  type TestApp,
  type TestUser,
} from './app.js';
import { docx, exe, gif, jpg, pdf, png, text } from './files.js';

const fullProfile = (overrides: object = {}) => ({
  firstName: 'Amira',
  lastName: 'Ben Salah',
  gender: 'FEMALE',
  dateOfBirth: '1995-04-12',
  nationality: 'TN',
  countryOfResidence: 'tn',
  city: 'Tunis',
  phone: '+21612345678',
  whatsapp: '+21612345678',
  passportNumber: 'zx 9087654',
  passportIssuingCountry: 'TN',
  passportIssueDate: '2022-01-15',
  passportExpiryDate: '2032-01-14',
  currentProfession: 'Receptionist',
  yearsOfExperience: 4,
  educationLevel: 'BACHELOR',
  languages: [
    { language: 'ar', level: 'NATIVE' },
    { language: 'en', level: 'B2' },
  ],
  drivingLicenceCategories: ['B'],
  hasStcwTraining: false,
  hasSeamanBook: false,
  hasMedicalCertificate: false,
  seaExperience: null,
  ...overrides,
});

describe('candidate profile and documents (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.privateFiles.clear();
    test.clock.reset();
  });

  const as = (user: TestUser) => {
    const cookie = cookieHeader(user.cookies);
    return {
      get: (path: string) => test.http().get(`${API}${path}`).set('Cookie', cookie),
      put: (path: string, body: object) =>
        test.http().put(`${API}${path}`).set('Cookie', cookie).send(body),
      delete: (path: string) => test.http().delete(`${API}${path}`).set('Cookie', cookie),
      upload: (type: string, file: Buffer, name: string) =>
        test
          .http()
          .post(`${API}/me/documents`)
          .set('Cookie', cookie)
          .field('type', type)
          .attach('file', file, name),
    };
  };

  describe('profile', () => {
    it('starts with the registration data and lists what is missing', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const response = await as(user).get('/me/profile').expect(200);
      const profile = candidateProfileResponseSchema.parse(response.body);
      expect(profile).toMatchObject({
        firstName: 'Test',
        lastName: 'Candidate',
        passportNumber: null,
      });
      expect(profile.profileCompleteness.percentage).toBe(0);
      expect(profile.profileCompleteness.missingToApply).toEqual(
        expect.arrayContaining(['dateOfBirth', 'passportNumber', 'cvDocument', 'passportDocument']),
      );
    });

    it('saves every field, and returns the passport number in clear to its owner', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const saved = await as(user).put('/me/profile', fullProfile()).expect(200);
      const profile = candidateProfileResponseSchema.parse(saved.body);
      expect(profile).toMatchObject({
        countryOfResidence: 'TN',
        dateOfBirth: '1995-04-12',
        passportNumber: 'ZX9087654',
        passportNumberMasked: '******654',
        passportExpiryDate: '2032-01-14',
        passportExpiringSoon: false,
        languages: [
          { language: 'ar', level: 'NATIVE' },
          { language: 'en', level: 'B2' },
        ],
        drivingLicenceCategories: ['B'],
      });
      expect(profile.profileCompleteness).toEqual({
        percentage: 88,
        missing: ['cvDocument', 'passportDocument'],
        missingToApply: ['cvDocument', 'passportDocument'],
      });
      expect((await as(user).get('/me/profile').expect(200)).body).toEqual(saved.body);
    });

    it('stores the passport number encrypted: the clear number is nowhere in the database', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await as(user).put('/me/profile', fullProfile()).expect(200);
      const row = await test.prisma.candidateProfile.findUniqueOrThrow({
        where: { id: user.profileId ?? '' },
      });
      expect(row.passportNumberEncrypted).toMatch(/^v1\./);
      expect(row.passportNumberMasked).toBe('******654');
      expect(JSON.stringify(row)).not.toContain('9087654');
      expect(JSON.stringify(row)).not.toContain('ZX908');
    });

    it('replaces languages and clears the passport when asked', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await as(user).put('/me/profile', fullProfile()).expect(200);
      const cleared = await as(user)
        .put(
          '/me/profile',
          fullProfile({
            languages: [{ language: 'fr', level: 'C1' }],
            passportNumber: null,
            passportIssuingCountry: null,
            passportIssueDate: null,
            passportExpiryDate: null,
          }),
        )
        .expect(200);
      expect(cleared.body).toMatchObject({
        languages: [{ language: 'fr', level: 'C1' }],
        passportNumber: null,
        passportNumberMasked: null,
      });
      expect(await test.prisma.candidateLanguage.count()).toBe(1);
    });

    it('reaches 100% with a complete profile, a CV and a passport scan', async () => {
      const user = await createUser(test, 'CANDIDATE');
      await as(user).put('/me/profile', fullProfile()).expect(200);
      await as(user).upload('CV', pdf(), 'cv.pdf').expect(201);
      await as(user)
        .upload('PASSPORT', await jpg(), 'passport.jpg')
        .expect(201);
      const profile = (await as(user).get('/me/profile').expect(200)).body as {
        profileCompleteness: object;
      };
      expect(profile.profileCompleteness).toEqual({
        percentage: 100,
        missing: [],
        missingToApply: [],
      });
    });

    it.each([
      ['a candidate under 18', { dateOfBirth: '2010-01-01' }, 'dateOfBirth'],
      ['an unknown country code', { nationality: 'XX' }, 'nationality'],
      ['a phone that is not E.164', { phone: '06 12 34 56 78' }, 'phone'],
      ['an expired passport', { passportExpiryDate: '2020-01-01' }, 'passportExpiryDate'],
      ['a missing field', { city: undefined }, 'city'],
    ])('answers 400 for %s and saves nothing', async (_case, overrides, field) => {
      const user = await createUser(test, 'CANDIDATE');
      const response = await as(user).put('/me/profile', fullProfile(overrides)).expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(
        (response.body as { details: { path: string }[] }).details.map((issue) => issue.path),
      ).toContain(field);
      expect(JSON.stringify(response.body)).not.toContain('9087654');
      const row = await test.prisma.candidateProfile.findUniqueOrThrow({
        where: { id: user.profileId ?? '' },
      });
      expect(row.passportNumberEncrypted).toBeNull();
    });

    it('uses the application clock for the age and passport rules', async () => {
      const user = await createUser(test, 'CANDIDATE');
      test.clock.set(new Date('2027-12-31T12:00:00Z'));
      await as(user)
        .put('/me/profile', fullProfile({ dateOfBirth: '2010-01-01' }))
        .expect(400);
      test.clock.set(new Date('2028-01-01T12:00:00Z'));
      await as(user)
        .put('/me/profile', fullProfile({ dateOfBirth: '2010-01-01' }))
        .expect(200);
      test.clock.set(new Date('2032-01-14T12:00:00Z'));
      await as(user).put('/me/profile', fullProfile()).expect(400);
    });

    it('flags a passport that expires within 6 months', async () => {
      const user = await createUser(test, 'CANDIDATE');
      test.clock.set(new Date('2031-09-01T12:00:00Z'));
      const saved = await as(user).put('/me/profile', fullProfile()).expect(200);
      expect((saved.body as { passportExpiringSoon: boolean }).passportExpiringSoon).toBe(true);
    });

    it('cannot change the role, the consent date or another profile through the body', async () => {
      const user = await createUser(test, 'CANDIDATE');
      const other = await createUser(test, 'CANDIDATE');
      await as(user)
        .put(
          '/me/profile',
          fullProfile({
            id: other.profileId,
            userId: other.id,
            role: 'SUPER_ADMIN',
            gdprConsentAt: null,
          }),
        )
        .expect(200);
      expect((await test.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe(
        'CANDIDATE',
      );
      const untouched = await test.prisma.candidateProfile.findUniqueOrThrow({
        where: { id: other.profileId ?? '' },
      });
      expect(untouched.city).toBeNull();
    });

    it('is for candidates only, and needs a session', async () => {
      await test.http().get(`${API}/me/profile`).expect(401);
      for (const role of ['VIEWER', 'RECRUITER', 'SUPER_ADMIN'] as const) {
        const admin = await createUser(test, role);
        await as(admin).get('/me/profile').expect(403);
        await as(admin).put('/me/profile', fullProfile()).expect(403);
      }
    });
  });

  describe('document upload', () => {
    let user: TestUser;
    beforeEach(async () => {
      user = await createUser(test, 'CANDIDATE');
    });

    it('stores a CV under a random name in private storage, with its hash and original name', async () => {
      const content = pdf();
      const response = await as(user).upload('CV', content, 'Mon CV été.pdf').expect(201);
      expect(response.body).toMatchObject({
        type: 'CV',
        originalName: 'Mon CV été.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
      });
      expect(response.body).not.toHaveProperty('blobPath');
      expect(response.body).not.toHaveProperty('sha256');

      const row = await test.prisma.document.findFirstOrThrow();
      expect(row.blobPath).toMatch(
        new RegExp(`^candidates/${user.profileId ?? ''}/[0-9a-f-]{36}\\.pdf$`),
      );
      expect(row.blobPath).not.toContain('CV');
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(test.privateFiles.get(row.blobPath)?.content.equals(content)).toBe(true);
      expect(test.files.size).toBe(0); // nothing in the public container
    });

    it.each([
      ['CV', 'docx', docx],
      ['PASSPORT', 'pdf', pdf],
      ['PASSPORT', 'jpg', jpg],
      ['PASSPORT', 'png', png],
      ['PHOTO', 'jpg', jpg],
      ['CERTIFICATE', 'png', png],
      ['DIPLOMA', 'pdf', pdf],
    ] as const)('accepts %s as %s', async (type, extension, make) => {
      const response = await as(user)
        .upload(type, await make(), `file.${extension}`)
        .expect(201);
      expect(response.body).toMatchObject({ type });
    });

    it('rejects a file with a .pdf extension but EXE content', async () => {
      const response = await as(user).upload('CV', exe(), 'cv.pdf').expect(415);
      expect(response.body).toMatchObject({
        code: 'UNSUPPORTED_FILE',
        details: { accepted: ['pdf', 'docx'] },
      });
      expect(await test.prisma.document.count()).toBe(0);
      expect(test.privateFiles.size).toBe(0);
    });

    it.each([
      ['an EXE named .jpg as a passport scan', 'PASSPORT', exe, 'passport.jpg'],
      ['text named .pdf', 'CV', text, 'cv.pdf'],
      ['a GIF as a photo', 'PHOTO', gif, 'photo.png'],
      ['an image as a CV', 'CV', jpg, 'cv.pdf'],
      ['a Word file as a passport scan', 'PASSPORT', docx, 'passport.pdf'],
    ] as const)('rejects %s whatever its name', async (_case, type, make, name) => {
      await as(user)
        .upload(type, await make(), name)
        .expect(415);
      expect(await test.prisma.document.count()).toBe(0);
      expect(test.privateFiles.size).toBe(0);
    });

    it('rejects a file above the 5 MB limit, and follows the setting', async () => {
      const big = Buffer.concat([pdf(), Buffer.alloc(5 * 1024 * 1024)]);
      const refused = await as(user).upload('CV', big, 'big.pdf').expect(413);
      expect(refused.body).toMatchObject({ code: 'FILE_TOO_LARGE' });
      await test.prisma.setting.create({ data: { key: 'MAX_UPLOAD_SIZE_MB', value: 6 } });
      await as(user).upload('CV', big, 'big.pdf').expect(201);
    });

    it('rejects an unknown type and a missing file', async () => {
      await as(user).upload('SELFIE', pdf(), 'x.pdf').expect(400);
      await test
        .http()
        .post(`${API}/me/documents`)
        .set('Cookie', cookieHeader(user.cookies))
        .field('type', 'CV')
        .expect(400);
    });

    it('keeps a harmless display name when the upload name contains a path', async () => {
      const response = await as(user).upload('CV', pdf(), '../../etc/cron.d/evil.pdf').expect(201);
      expect((response.body as { originalName: string }).originalName).toBe('evil.pdf');
    });

    it('lists my documents only, without the deleted ones', async () => {
      const other = await createUser(test, 'CANDIDATE');
      await as(other).upload('CV', pdf(), 'other.pdf').expect(201);
      const first = await as(user).upload('CV', pdf(), 'mine.pdf').expect(201);
      await as(user)
        .upload('PASSPORT', await png(), 'passport.png')
        .expect(201);
      await as(user)
        .delete(`/me/documents/${(first.body as { id: string }).id}`)
        .expect(204);
      const listed = (await as(user).get('/me/documents').expect(200)).body as {
        originalName: string;
      }[];
      expect(listed.map((document) => document.originalName)).toEqual(['passport.png']);
    });

    it('is for candidates only', async () => {
      const recruiter = await createUser(test, 'RECRUITER');
      await as(recruiter).upload('CV', pdf(), 'cv.pdf').expect(403);
      await test
        .http()
        .post(`${API}/me/documents`)
        .field('type', 'CV')
        .attach('file', pdf(), 'cv.pdf')
        .expect(401);
    });
  });

  describe('document deletion', () => {
    it('soft-deletes and removes the file when no application used it', async () => {
      const candidate = await createReadyCandidate(test);
      await as(candidate).delete(`/me/documents/${candidate.cvId}`).expect(204);
      const row = await test.prisma.document.findUniqueOrThrow({ where: { id: candidate.cvId } });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(test.privateFiles.has(row.blobPath)).toBe(false);
      await as(candidate).delete(`/me/documents/${candidate.cvId}`).expect(404);
    });

    it('refuses while an application in progress uses the document, allows it once the application is over', async () => {
      const candidate = await createReadyCandidate(test);
      const catalog = await seedCatalog(test);
      const job = await insertJob(test, catalog, { slug: 'job' });
      const application = await test.prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.profileId,
          profileSnapshot: {},
          documents: { create: [{ documentId: candidate.cvId }] },
        },
      });
      const refused = await as(candidate).delete(`/me/documents/${candidate.cvId}`).expect(409);
      expect(refused.body).toMatchObject({ code: 'DOCUMENT_IN_USE' });

      await test.prisma.application.update({
        where: { id: application.id },
        data: { status: 'REJECTED' },
      });
      await as(candidate).delete(`/me/documents/${candidate.cvId}`).expect(204);
      // The finished application keeps its file.
      const row = await test.prisma.document.findUniqueOrThrow({ where: { id: candidate.cvId } });
      expect(test.privateFiles.has(row.blobPath)).toBe(true);
    });

    it("cannot delete another candidate's document", async () => {
      const owner = await createReadyCandidate(test);
      const other = await createReadyCandidate(test);
      await as(other).delete(`/me/documents/${owner.cvId}`).expect(404);
      expect(
        (await test.prisma.document.findUniqueOrThrow({ where: { id: owner.cvId } })).deletedAt,
      ).toBeNull();
    });
  });

  describe('document download', () => {
    let owner: ReadyCandidate;
    let other: ReadyCandidate;
    beforeEach(async () => {
      owner = await createReadyCandidate(test);
      other = await createReadyCandidate(test);
    });

    it('redirects the owner to a read-only link valid 5 minutes', async () => {
      const response = await as(owner).get(`/documents/${owner.cvId}/download`).expect(302);
      const location = new URL(response.headers['location'] as string);
      const row = await test.prisma.document.findUniqueOrThrow({ where: { id: owner.cvId } });
      expect(`${location.origin}${location.pathname}`).toBe(`${FAKE_PRIVATE_HOST}/${row.blobPath}`);
      expect(location.searchParams.get('ttl')).toBe('300');
      expect(location.searchParams.get('sp')).toBe('r');
      expect(location.searchParams.get('name')).toBe('cv.pdf');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it("candidate A cannot download candidate B's documents", async () => {
      for (const id of [owner.cvId, owner.passportId]) {
        const response = await as(other).get(`/documents/${id}/download`).expect(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
        expect(response.headers['location']).toBeUndefined();
      }
      // Same answer as for a document that does not exist.
      await as(other).get('/documents/00000000-0000-4000-8000-000000000000/download').expect(404);
    });

    it('needs a session', async () => {
      const response = await test.http().get(`${API}/documents/${owner.cvId}/download`).expect(401);
      expect(response.headers['location']).toBeUndefined();
    });

    it.each(['VIEWER', 'RECRUITER', 'SUPER_ADMIN'] as const)(
      'lets a %s download, and writes it to the audit log',
      async (role) => {
        const admin = await createUser(test, role);
        await as(admin).get(`/documents/${owner.cvId}/download`).expect(302);
        const entries = await test.prisma.auditLog.findMany();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          actorId: admin.id,
          action: 'document.download',
          entityType: 'document',
          entityId: owner.cvId,
          after: { type: 'CV', candidateId: owner.profileId },
        });
        expect(entries[0]?.ip).toBeTruthy();
        // The entry does not carry the file name, which often contains the candidate's name.
        expect(JSON.stringify(entries[0])).not.toContain('cv.pdf');
      },
    );

    it('does not write an audit entry for the owner, nor for a refused download', async () => {
      await as(owner).get(`/documents/${owner.cvId}/download`).expect(302);
      await as(other).get(`/documents/${owner.cvId}/download`).expect(404);
      expect(await test.prisma.auditLog.count()).toBe(0);
    });

    it('answers 404 for a deleted document, also to back-office users', async () => {
      await as(owner).delete(`/me/documents/${owner.cvId}`).expect(204);
      await as(owner).get(`/documents/${owner.cvId}/download`).expect(404);
      const recruiter = await createUser(test, 'RECRUITER');
      await as(recruiter).get(`/documents/${owner.cvId}/download`).expect(404);
    });
  });
});
