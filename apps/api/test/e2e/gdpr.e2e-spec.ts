import { strFromU8, unzipSync } from 'fflate';
import {
  API,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  insertJob,
  login,
  PASSWORD,
  resetDatabase,
  seedCatalog,
  type ReadyCandidate,
  type TestApp,
} from './app.js';

describe('GDPR: export and erasure (e2e)', () => {
  let test: TestApp;
  let candidate: ReadyCandidate;
  let applicationId: string;
  let jobId: string;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });
  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.privateFiles.clear();
    test.outbox.length = 0;
    const catalog = await seedCatalog(test);
    candidate = await createReadyCandidate(test, 'amira@example.test');
    jobId = (await insertJob(test, catalog, { slug: 'receptionist', title: 'Hotel Receptionist' }))
      .id;
    const response = await test
      .http()
      .post(`${API}/jobs/${jobId}/apply`)
      .set('Cookie', cookieHeader(candidate.cookies))
      .send({
        documentIds: [candidate.cvId, candidate.passportId],
        coverLetter: 'My letter',
        answers: { shift: 'night' },
        turnstileToken: 'ok',
      })
      .expect(201);
    applicationId = (response.body as { id: string }).id;
  });

  const cookie = () => cookieHeader(candidate.cookies);

  describe('GET /me/export', () => {
    const download = async () => {
      const response = await test
        .http()
        .get(`${API}/me/export`)
        .set('Cookie', cookie())
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            callback(null, Buffer.concat(chunks));
          });
        })
        .expect(200);
      return { response, files: unzipSync(new Uint8Array(response.body as Buffer)) };
    };

    it('returns a zip with data.json and every document', async () => {
      const { response, files } = await download();
      expect(response.headers['content-type']).toBe('application/zip');
      expect(response.headers['content-disposition']).toContain(
        'attachment; filename="iconbridge-my-data.zip"',
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(Object.keys(files).sort()).toEqual([
        'data.json',
        'documents/01-CV-cv.pdf',
        'documents/02-PASSPORT-passport.jpg',
      ]);
      expect(strFromU8(files['documents/01-CV-cv.pdf'] ?? new Uint8Array())).toBe(
        'CV of amira@example.test',
      );
    });

    it('puts the account, the profile with the clear passport number, documents and applications in data.json', async () => {
      const { files } = await download();
      const data = JSON.parse(strFromU8(files['data.json'] ?? new Uint8Array())) as {
        account: { email: string };
        profile: { passportNumber: string; firstName: string };
        documents: { type: string; file: string; sha256: string }[];
        applications: { id: string; coverLetter: string; answers: object; history: unknown[] }[];
      };
      expect(data.account.email).toBe('amira@example.test');
      expect(data.profile).toMatchObject({ firstName: 'Test', passportNumber: 'FAKE1234567' });
      expect(data.documents.map((document) => [document.type, document.file])).toEqual([
        ['CV', 'documents/01-CV-cv.pdf'],
        ['PASSPORT', 'documents/02-PASSPORT-passport.jpg'],
      ]);
      expect(data.applications).toHaveLength(1);
      expect(data.applications[0]).toMatchObject({
        id: applicationId,
        coverLetter: 'My letter',
        answers: { shift: 'night' },
      });
      expect(data.applications[0]?.history).toHaveLength(1);
    });

    it('contains no secret, no internal note and nothing about other people', async () => {
      const other = await createReadyCandidate(test, 'other@example.test');
      const recruiter = await createUser(test, 'RECRUITER');
      await test.prisma.applicationNote.create({
        data: { applicationId, authorId: recruiter.id, body: 'INTERNAL NOTE' },
      });
      const { files } = await download();
      const json = strFromU8(files['data.json'] ?? new Uint8Array());
      for (const forbidden of [
        'passwordHash',
        'argon2',
        'tokenHash',
        'blobPath',
        'candidates/',
        'INTERNAL NOTE',
        other.email,
        recruiter.email,
        'v1.',
      ]) {
        expect(json).not.toContain(forbidden);
      }
      expect(Object.keys(files).join()).not.toContain('other');
    });

    it('is for the signed-in candidate only', async () => {
      await test.http().get(`${API}/me/export`).expect(401);
      const recruiter = await createUser(test, 'RECRUITER');
      await test
        .http()
        .get(`${API}/me/export`)
        .set('Cookie', cookieHeader(recruiter.cookies))
        .expect(403);
    });
  });

  describe('DELETE /me/account', () => {
    const erase = (password = PASSWORD) =>
      test.http().delete(`${API}/me/account`).set('Cookie', cookie()).send({ password });

    it('needs the right password', async () => {
      const response = await erase('wrong-password-123').expect(403);
      expect(response.body).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await test.http().delete(`${API}/me/account`).set('Cookie', cookie()).send({}).expect(400);
      expect(
        (await test.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).email,
      ).toBe('amira@example.test');
      expect(test.privateFiles.size).toBe(2);
    });

    it('deletes the files, anonymises the profile and signs the candidate out', async () => {
      const response = await erase().expect(204);
      expect(response.headers['set-cookie']).toBeDefined();

      // Files
      expect(test.privateFiles.size).toBe(0);
      expect(await test.prisma.document.count()).toBe(0);
      expect(await test.prisma.applicationDocument.count()).toBe(0);

      // Account
      const user = await test.prisma.user.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(user.email).toMatch(/^deleted-[0-9a-f-]{36}@deleted\.invalid$/);
      expect(user).toMatchObject({ passwordHash: null, isActive: false, emailVerifiedAt: null });
      expect(user.deletedAt).toBeInstanceOf(Date);
      expect(await test.prisma.refreshToken.count({ where: { userId: candidate.id } })).toBe(0);

      // Profile
      const profile = await test.prisma.candidateProfile.findUniqueOrThrow({
        where: { id: candidate.profileId },
      });
      expect(profile).toMatchObject({
        firstName: 'Deleted',
        lastName: 'User',
        dateOfBirth: null,
        nationality: null,
        city: null,
        phone: null,
        passportNumberEncrypted: null,
        passportNumberMasked: null,
        passportExpiryDate: null,
        currentProfession: null,
        gdprConsentAt: null,
      });
      expect(await test.prisma.candidateLanguage.count()).toBe(0);

      // Session
      await test.http().get(`${API}/auth/me`).set('Cookie', cookie()).expect(401);
      await test.http().post(`${API}/auth/refresh`).set('Cookie', cookie()).expect(401);
      await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: 'amira@example.test', password: PASSWORD })
        .expect(401);
    });

    it('keeps anonymous application statistics: job, dates and status, nothing personal', async () => {
      const recruiter = await createUser(test, 'RECRUITER');
      await test.prisma.applicationNote.create({
        data: { applicationId, authorId: recruiter.id, body: 'Spoke to Amira on the phone' },
      });
      await test.prisma.applicationStatusHistory.create({
        data: {
          applicationId,
          fromStatus: 'SUBMITTED',
          toStatus: 'UNDER_REVIEW',
          changedById: recruiter.id,
          comment: 'Amira has good English',
        },
      });
      await erase().expect(204);

      const application = await test.prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { statusHistory: true, notes: true },
      });
      expect(application).toMatchObject({
        jobId,
        status: 'WITHDRAWN',
        coverLetter: null,
        answers: null,
        profileSnapshot: {},
      });
      expect(application.appliedAt).toBeInstanceOf(Date);
      expect(application.notes).toEqual([]);
      expect(application.statusHistory.every((entry) => entry.comment === null)).toBe(true);
      expect(application.statusHistory.map((entry) => entry.toStatus)).toEqual(
        expect.arrayContaining(['SUBMITTED', 'WITHDRAWN']),
      );

      // Nothing that identified the person is left anywhere in these rows.
      const everything = JSON.stringify({
        application,
        users: await test.prisma.user.findMany({ where: { id: candidate.id } }),
        profiles: await test.prisma.candidateProfile.findMany({
          where: { id: candidate.profileId },
        }),
      });
      // The masked number too ("*****567"); not the bare digits, which a random id may contain.
      for (const personal of ['amira', 'Amira', '+21612345678', 'Tunis', 'FAKE1234567', '*567']) {
        expect(everything).not.toContain(personal);
      }
    });

    it('keeps a finished application with its final status', async () => {
      await test.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'DEPLOYED' },
      });
      await erase().expect(204);
      expect(
        (await test.prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status,
      ).toBe('DEPLOYED');
    });

    it('leaves an application nobody can move any more, not even a super admin', async () => {
      await erase().expect(204);
      const superAdmin = await createUser(test, 'SUPER_ADMIN');
      const admin = cookieHeader(superAdmin.cookies);
      test.outbox.length = 0;

      // A withdrawn application can normally be reopened by a super admin; not this one.
      const detail = await test
        .http()
        .get(`${API}/admin/applications/${applicationId}`)
        .set('Cookie', admin)
        .expect(200);
      expect(detail.body).toMatchObject({ status: 'WITHDRAWN', allowedTransitions: [] });
      const moved = await test
        .http()
        .patch(`${API}/admin/applications/${applicationId}/status`)
        .set('Cookie', admin)
        .send({ status: 'UNDER_REVIEW' })
        .expect(409);
      expect(moved.body).toMatchObject({ code: 'INVALID_APPLICATION_TRANSITION' });
      expect(
        (await test.prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status,
      ).toBe('WITHDRAWN');
      // Nobody is written to.
      expect(test.outbox).toEqual([]);
    });

    it('frees the email address: the person can register again and starts from nothing', async () => {
      await erase().expect(204);
      await test
        .http()
        .post(`${API}/auth/register`)
        .send({
          email: 'amira@example.test',
          password: PASSWORD,
          firstName: 'Amira',
          lastName: 'Again',
          phone: '+21612345678',
          country: 'TN',
          gdprConsent: true,
          turnstileToken: 'ok',
        })
        .expect(201);
      const cookies = await login(test, 'amira@example.test');
      const applications = await test
        .http()
        .get(`${API}/me/applications`)
        .set('Cookie', cookieHeader(cookies))
        .expect(200);
      expect(applications.body).toEqual([]);
      expect(await test.prisma.user.count({ where: { email: 'amira@example.test' } })).toBe(1);
    });

    it('does not touch other candidates', async () => {
      const other = await createReadyCandidate(test, 'other@example.test');
      await erase().expect(204);
      expect(test.privateFiles.size).toBe(2);
      expect(await test.prisma.document.count({ where: { candidateId: other.profileId } })).toBe(2);
      await test
        .http()
        .get(`${API}/me/profile`)
        .set('Cookie', cookieHeader(other.cookies))
        .expect(200);
    });

    it('is not available to back-office accounts', async () => {
      const superAdmin = await createUser(test, 'SUPER_ADMIN');
      await test
        .http()
        .delete(`${API}/me/account`)
        .set('Cookie', cookieHeader(superAdmin.cookies))
        .send({ password: PASSWORD })
        .expect(403);
      expect(
        (await test.prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } })).isActive,
      ).toBe(true);
    });
  });
});
