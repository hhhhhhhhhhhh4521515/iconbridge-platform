import {
  API,
  cookieHeader,
  createReadyCandidate,
  createTestApp,
  createUser,
  insertJob,
  login,
  resetDatabase,
  seedCatalog,
  type ReadyCandidate,
  type TestApp,
  type TestUser,
} from './app.js';
import { applyTo, as } from './back-office.js';

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Country agents (ADR-024): a candidate belongs to a country by nationality only. An agent
 * reaches the candidates of his countries, their documents and applications; anything else
 * answers 404, and every action outside his role answers 403.
 */
describe('country agents (e2e)', () => {
  let test: TestApp;
  let superAdmin: TestUser;
  let recruiter: TestUser;
  let agentMA: TestUser;
  let agentTN: TestUser;
  /** Moroccan national living in Italy. */
  let moroccan: ReadyCandidate;
  /** Tunisian national living in Tunisia. */
  let tunisian: ReadyCandidate;
  /** Tunisian national living in Morocco: Tunisian for the agents. */
  let tunisianInMorocco: ReadyCandidate;
  let jobId: string;
  let moroccanApp: string;
  let tunisianApp: string;
  let tunisianInMoroccoApp: string;

  const nationalityOf = async (
    candidate: ReadyCandidate,
    nationality: string,
    countryOfResidence: string,
    lastName: string,
  ) => {
    await test.prisma.candidateProfile.update({
      where: { id: candidate.profileId },
      data: { nationality, countryOfResidence, lastName },
    });
  };

  beforeAll(async () => {
    test = await createTestApp();
    await resetDatabase(test.prisma);
    const catalog = await seedCatalog(test);
    jobId = (await insertJob(test, catalog, { slug: 'agent-job', positions: 10 })).id;
    superAdmin = await createUser(test, 'SUPER_ADMIN');
    recruiter = await createUser(test, 'RECRUITER');
    agentMA = await createUser(test, 'COUNTRY_AGENT', undefined, ['MA']);
    agentTN = await createUser(test, 'COUNTRY_AGENT', undefined, ['TN']);
    moroccan = await createReadyCandidate(test);
    tunisian = await createReadyCandidate(test);
    tunisianInMorocco = await createReadyCandidate(test);
    await nationalityOf(moroccan, 'MA', 'IT', 'Alaoui');
    await nationalityOf(tunisian, 'TN', 'TN', 'Trabelsi');
    await nationalityOf(tunisianInMorocco, 'TN', 'MA', 'Jebali');
    moroccanApp = await applyTo(test, moroccan, jobId);
    tunisianApp = await applyTo(test, tunisian, jobId);
    tunisianInMoroccoApp = await applyTo(test, tunisianInMorocco, jobId);
  });
  afterAll(async () => {
    await test.close();
  });

  const ids = (body: unknown) =>
    ((body as { items: { id: string }[] }).items ?? []).map((item) => item.id).sort();

  describe('scope: by nationality only', () => {
    it('lists only the candidates of the agent nationalities, never by residence', async () => {
      const ma = await as(test, agentMA).get('/admin/candidates').expect(200);
      expect(ids(ma.body)).toEqual([moroccan.profileId]);
      const tn = await as(test, agentTN).get('/admin/candidates').expect(200);
      expect(ids(tn.body)).toEqual([tunisian.profileId, tunisianInMorocco.profileId].sort());
      const all = await as(test, superAdmin).get('/admin/candidates').expect(200);
      expect(ids(all.body)).toEqual(
        [moroccan.profileId, tunisian.profileId, tunisianInMorocco.profileId].sort(),
      );
    });

    it('keeps the scope with filters and search', async () => {
      const filtered = await as(test, agentMA).get('/admin/candidates?nationality=TN').expect(200);
      expect(ids(filtered.body)).toEqual([]);
      const searched = await as(test, agentMA).get('/admin/candidates?q=Trabelsi').expect(200);
      expect(ids(searched.body)).toEqual([]);
      const applications = await as(test, agentMA)
        .get('/admin/applications?q=Trabelsi')
        .expect(200);
      expect(ids(applications.body)).toEqual([]);
      const byNationality = await as(test, agentMA)
        .get('/admin/applications?nationality=TN')
        .expect(200);
      expect(ids(byNationality.body)).toEqual([]);
    });

    it('answers 404 for a candidate outside his countries, and the detail for his own', async () => {
      const own = await as(test, agentMA)
        .get(`/admin/candidates/${moroccan.profileId}`)
        .expect(200);
      expect((own.body as { nationality: string }).nationality).toBe('MA');
      for (const other of [tunisian, tunisianInMorocco]) {
        const response = await as(test, agentMA)
          .get(`/admin/candidates/${other.profileId}`)
          .expect(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
        expect(JSON.stringify(response.body)).not.toContain(other.email);
      }
      await as(test, agentTN).get(`/admin/candidates/${moroccan.profileId}`).expect(404);
    });

    it('scopes the applications list and detail, with history and documents', async () => {
      const list = await as(test, agentMA).get('/admin/applications').expect(200);
      expect(ids(list.body)).toEqual([moroccanApp]);
      const detail = await as(test, agentMA).get(`/admin/applications/${moroccanApp}`).expect(200);
      const body = detail.body as { history: unknown[]; documents: unknown[] };
      expect(body.history.length).toBeGreaterThan(0);
      expect(body.documents.length).toBe(2);
      await as(test, agentMA).get(`/admin/applications/${tunisianApp}`).expect(404);
      await as(test, agentMA).get(`/admin/applications/${tunisianInMoroccoApp}`).expect(404);
      const tn = await as(test, agentTN).get('/admin/applications').expect(200);
      expect(ids(tn.body)).toEqual([tunisianApp, tunisianInMoroccoApp].sort());
    });

    it('gives his candidates documents through a 5-minute link, audited, and 404 for others', async () => {
      const response = await as(test, agentMA).get(`/documents/${moroccan.cvId}/download`);
      expect(response.status).toBe(302);
      expect(response.headers.location).toBeTruthy();
      const entry = await test.prisma.auditLog.findFirst({
        where: { action: 'document.download', entityId: moroccan.cvId, actorId: agentMA.id },
      });
      expect(entry).not.toBeNull();
      await as(test, agentMA).get(`/documents/${tunisian.cvId}/download`).expect(404);
      await as(test, agentMA)
        .get(`/documents/${tunisianInMorocco.passportId}/download`)
        .expect(404);
      await as(test, agentMA).get(`/documents/${ZERO_UUID}/download`).expect(404);
    });

    it('shows a dashboard of his countries only, without the historical figures', async () => {
      const malta = await test.prisma.destination.findUniqueOrThrow({ where: { code: 'MALTA' } });
      await test.prisma.historicalFigure.create({
        data: { metric: 'VISAS_APPROVED', value: 500, year: 2020, destinationId: malta.id },
      });
      const ma = (await as(test, agentMA).get('/admin/stats').expect(200)).body as {
        scopeCountries: string[] | null;
        applicationsByStatus: Record<string, number>;
        history: { visasApproved: number };
        platform: { registeredCandidates: number };
      };
      expect(ma.scopeCountries).toEqual(['MA']);
      expect(Object.values(ma.applicationsByStatus).reduce((a, b) => a + b, 0)).toBe(1);
      expect(ma.history.visasApproved).toBe(0);
      expect(ma.platform.registeredCandidates).toBe(1);
      const all = (await as(test, superAdmin).get('/admin/stats').expect(200)).body as {
        scopeCountries: string[] | null;
        applicationsByStatus: Record<string, number>;
        history: { visasApproved: number };
      };
      expect(all.scopeCountries).toBeNull();
      expect(Object.values(all.applicationsByStatus).reduce((a, b) => a + b, 0)).toBe(3);
      expect(all.history.visasApproved).toBe(500);
    });
  });

  describe('what an agent may do on his candidates', () => {
    it('moves an application with a message: timeline and email, internal comment kept back', async () => {
      test.outbox.length = 0;
      await as(test, agentMA)
        .patch(`/admin/applications/${moroccanApp}/status`, {
          status: 'UNDER_REVIEW',
          comment: 'INTERNAL-ONLY',
          messageToCandidate: 'Your file is complete, we call you this week.',
        })
        .expect(200);
      const email = test.outbox.find((message) => message.to === moroccan.email);
      expect(email?.text).toContain('Your file is complete, we call you this week.');
      expect(`${email?.text ?? ''}${email?.html ?? ''}`).not.toContain('INTERNAL-ONLY');
      const timeline = JSON.stringify(
        (await as(test, moroccan).get('/me/applications').expect(200)).body,
      );
      expect(timeline).toContain('Your file is complete, we call you this week.');
      expect(timeline).not.toContain('INTERNAL-ONLY');
      const entry = await test.prisma.auditLog.findFirst({
        where: { action: 'application.change_status', entityId: moroccanApp, actorId: agentMA.id },
      });
      expect(entry).not.toBeNull();
    });

    it('follows the state machine, and cannot reopen a rejected application', async () => {
      await as(test, agentMA)
        .patch(`/admin/applications/${moroccanApp}/status`, { status: 'OFFER' })
        .expect(409);
      for (const status of ['SHORTLISTED', 'INTERVIEW'] as const) {
        await as(test, agentMA)
          .patch(`/admin/applications/${moroccanApp}/status`, { status })
          .expect(200);
      }
      const extra = await createReadyCandidate(test);
      await nationalityOf(extra, 'MA', 'MA', 'Bennani');
      const rejected = await applyTo(test, extra, jobId);
      await as(test, agentMA)
        .patch(`/admin/applications/${rejected}/status`, { status: 'REJECTED' })
        .expect(200);
      const response = await as(test, agentMA)
        .patch(`/admin/applications/${rejected}/status`, { status: 'UNDER_REVIEW' })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'INVALID_APPLICATION_TRANSITION' });
    });

    it('undoes his own last change', async () => {
      const extra = await createReadyCandidate(test);
      await nationalityOf(extra, 'MA', 'MA', 'Idrissi');
      const id = await applyTo(test, extra, jobId);
      await as(test, agentMA)
        .patch(`/admin/applications/${id}/status`, { status: 'UNDER_REVIEW' })
        .expect(200);
      const undone = await as(test, agentMA)
        .post(`/admin/applications/${id}/undo-status`)
        .expect(200);
      expect((undone.body as { status: string }).status).toBe('SUBMITTED');
    });

    it('adds, edits and deletes his internal notes, never visible to the candidate', async () => {
      const note = await as(test, agentMA)
        .post(`/admin/applications/${moroccanApp}/notes`, { body: 'Called him, NOTE-SECRET' })
        .expect(201);
      const noteId = (note.body as { id: string }).id;
      await as(test, agentMA)
        .patch(`/admin/applications/${moroccanApp}/notes/${noteId}`, { body: 'Edited NOTE-SECRET' })
        .expect(200);
      const mine = JSON.stringify(
        (await as(test, moroccan).get('/me/applications').expect(200)).body,
      );
      expect(mine).not.toContain('NOTE-SECRET');
      await as(test, agentMA)
        .delete(`/admin/applications/${moroccanApp}/notes/${noteId}`)
        .expect(204);
    });
  });

  describe('outside his countries: 404, never the data', () => {
    it('cannot move, undo or annotate a Tunisian application', async () => {
      for (const id of [tunisianApp, tunisianInMoroccoApp]) {
        await as(test, agentMA)
          .patch(`/admin/applications/${id}/status`, {
            status: 'UNDER_REVIEW',
            messageToCandidate: 'x',
          })
          .expect(404);
        await as(test, agentMA).post(`/admin/applications/${id}/undo-status`).expect(404);
        await as(test, agentMA).post(`/admin/applications/${id}/notes`, { body: 'x' }).expect(404);
      }
      const note = await as(test, recruiter)
        .post(`/admin/applications/${tunisianApp}/notes`, { body: 'Recruiter note' })
        .expect(201);
      const noteId = (note.body as { id: string }).id;
      await as(test, agentMA)
        .patch(`/admin/applications/${tunisianApp}/notes/${noteId}`, { body: 'x' })
        .expect(404);
      await as(test, agentMA)
        .delete(`/admin/applications/${tunisianApp}/notes/${noteId}`)
        .expect(404);
      const unchanged = await test.prisma.application.findUniqueOrThrow({
        where: { id: tunisianApp },
      });
      expect(unchanged.status).toBe('SUBMITTED');
    });

    it('changes nothing outside his countries in a bulk change, and says why', async () => {
      const extra = await createReadyCandidate(test);
      await nationalityOf(extra, 'MA', 'MA', 'Tazi');
      const own = await applyTo(test, extra, jobId);
      const response = await as(test, agentMA)
        .post('/admin/applications/bulk-status', {
          ids: [own, tunisianApp],
          status: 'UNDER_REVIEW',
        })
        .expect(200);
      expect(response.body).toMatchObject({
        changed: 1,
        failed: 1,
        results: [
          { id: own, ok: true },
          { id: tunisianApp, ok: false, code: 'NOT_FOUND' },
        ],
      });
    });
  });

  describe('forbidden actions: 403', () => {
    it('refuses every back-office route whose roles leave the agent out', async () => {
      const document = (await test.http().get('/api/docs-json').expect(200)).body as {
        paths: Record<string, Record<string, { 'x-roles'?: string[] }>>;
      };
      const forbidden = Object.entries(document.paths)
        .filter(([path]) => path.startsWith(`${API}/admin`))
        .flatMap(([path, operations]) =>
          Object.entries(operations)
            .filter(([, operation]) => !(operation['x-roles'] ?? []).includes('COUNTRY_AGENT'))
            .map(([method]) => ({ method, path: path.replaceAll(/\{[^}]+\}/g, ZERO_UUID) })),
        );
      // Jobs, content, catalog writes, export, settings, figures, users, audit, cooldown,
      // candidate accounts, passports and deletions are all in this list.
      expect(forbidden.length).toBeGreaterThan(40);
      const cookie = cookieHeader(agentMA.cookies);
      const allowed: string[] = [];
      for (const { method, path } of forbidden) {
        const agent = test.http();
        const call = (
          agent as unknown as Record<string, (url: string) => ReturnType<typeof agent.get>>
        )[method]?.call(agent, path);
        const response = await call?.set('Cookie', cookie).send({});
        if (response?.status !== 403) {
          allowed.push(`${method.toUpperCase()} ${path} -> ${response?.status ?? 'none'}`);
        }
      }
      expect(allowed).toEqual([]);
    });

    it('cannot edit profiles or documents, delete, export, touch jobs or reveal passports', async () => {
      const a = as(test, agentMA);
      const id = moroccan.profileId;
      await a.put('/me/profile', { firstName: 'X' }).expect(403);
      await a.delete(`/me/documents/${moroccan.cvId}`).expect(403);
      await a.post(`/admin/candidates/${id}/reveal-passport`).expect(403);
      await a.post(`/admin/candidates/${id}/disable`).expect(403);
      await a.delete(`/admin/candidates/${id}`).send({ reason: 'Asked for it' }).expect(403);
      await a.delete(`/admin/applications/${moroccanApp}`).send({ reason: 'Asked' }).expect(403);
      await a.post('/admin/applications/export', { format: 'csv' }).expect(403);
      await a
        .post(`/admin/applications/${moroccanApp}/waive-cooldown`, { reason: 'x' })
        .expect(403);
      await a.get('/admin/jobs').expect(403);
      await a.post('/admin/jobs', { title: 'X' }).expect(403);
      await a.get('/admin/contact-messages').expect(403);
      await a.get('/admin/users').expect(403);
      await a.get('/admin/settings').expect(403);
      await a.get('/admin/audit-logs').expect(403);
      await a.get('/admin/success-stories').expect(403);
      await a.get('/admin/historical-figures').expect(403);
      const profile = await test.prisma.candidateProfile.findUniqueOrThrow({ where: { id } });
      expect(profile.firstName).not.toBe('X');
    });
  });

  describe('accounts: countries and a password set by the super admin', () => {
    const NEW_AGENT = 'e2e-agent-new@example.test';
    const FIRST = 'harbor-violet-summit-71';
    const OWN = 'copper-meadow-lantern-58';

    it('creates an agent with his countries and a first password, without sending an email', async () => {
      test.outbox.length = 0;
      const created = await as(test, superAdmin)
        .post('/admin/users', {
          email: NEW_AGENT,
          role: 'COUNTRY_AGENT',
          countries: ['MA'],
          password: FIRST,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        role: 'COUNTRY_AGENT',
        assignedCountries: ['MA'],
        hasPassword: true,
        passwordChangeRequired: true,
      });
      expect(JSON.stringify(created.body)).not.toContain(FIRST);
      expect(test.outbox).toHaveLength(0);
      const audit = await test.prisma.auditLog.findFirst({
        where: { action: 'admin_user.create', entityId: (created.body as { id: string }).id },
      });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit)).not.toContain(FIRST);
      expect(JSON.stringify(audit)).not.toMatch(/\$argon2/);
    });

    it('forces a new password at the first sign-in, and nothing else before it', async () => {
      const first = await test
        .http()
        .post(`${API}/auth/login`)
        .send({ email: NEW_AGENT, password: FIRST })
        .expect(200);
      expect(first.body).toMatchObject({ passwordChangeRequired: true, assignedCountries: ['MA'] });
      const cookie = first.headers['set-cookie'] as unknown as string[];
      const blocked = await test
        .http()
        .get(`${API}/admin/candidates`)
        .set('Cookie', cookie)
        .expect(403);
      expect(blocked.body).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
      await test.http().get(`${API}/admin/stats`).set('Cookie', cookie).expect(403);
      await test.http().get(`${API}/auth/me`).set('Cookie', cookie).expect(200);
      const same = await test
        .http()
        .post(`${API}/me/password`)
        .set('Cookie', cookie)
        .send({ currentPassword: FIRST, newPassword: FIRST })
        .expect(400);
      expect(same.body).toMatchObject({ code: 'WEAK_PASSWORD' });
      const changed = await test
        .http()
        .post(`${API}/me/password`)
        .set('Cookie', cookie)
        .send({ currentPassword: FIRST, newPassword: OWN })
        .expect(204);
      const fresh = changed.headers['set-cookie'] as unknown as string[];
      const list = await test
        .http()
        .get(`${API}/admin/candidates`)
        .set('Cookie', fresh)
        .expect(200);
      // Earlier tests added Moroccans: every candidate listed is a Moroccan national.
      const listed = (list.body as { items: { id: string; nationality: string }[] }).items;
      expect(listed.map((item) => item.id)).toContain(moroccan.profileId);
      expect(new Set(listed.map((item) => item.nationality))).toEqual(new Set(['MA']));
      const me = await test.http().get(`${API}/auth/me`).set('Cookie', fresh).expect(200);
      expect(me.body).toMatchObject({ passwordChangeRequired: false });
      await login(test, NEW_AGENT, OWN);
    });

    it('refuses a weak first password and an agent without a country', async () => {
      const weak = await as(test, superAdmin)
        .post('/admin/users', {
          email: 'e2e-agent-weak@example.test',
          role: 'COUNTRY_AGENT',
          countries: ['TN'],
          password: 'aaaaaaaaaaaa',
        })
        .expect(400);
      expect(weak.body).toMatchObject({ code: 'WEAK_PASSWORD' });
      await as(test, superAdmin)
        .post('/admin/users', { email: 'e2e-agent-none@example.test', role: 'COUNTRY_AGENT' })
        .expect(400);
      await as(test, superAdmin)
        .post('/admin/users', {
          email: 'e2e-recruiter-country@example.test',
          role: 'RECRUITER',
          countries: ['TN'],
        })
        .expect(400);
    });

    it('sets a password on an existing account: sessions end, change forced, audited without it', async () => {
      const target = await createUser(test, 'COUNTRY_AGENT', undefined, ['TN']);
      const reset = 'ember-quarry-willow-36';
      const response = await as(test, superAdmin)
        .post(`/admin/users/${target.id}/password`, { password: reset })
        .expect(200);
      expect(response.body).toMatchObject({ passwordChangeRequired: true });
      await as(test, target).get('/admin/candidates').expect(401);
      const cookies = await login(test, target.email, reset);
      await test
        .http()
        .get(`${API}/admin/candidates`)
        .set('Cookie', cookieHeader(cookies))
        .expect(403);
      const audit = await test.prisma.auditLog.findFirst({
        where: { action: 'admin_user.set_password', entityId: target.id },
      });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit)).not.toContain(reset);
      // Only a super admin sets passwords.
      await as(test, recruiter)
        .post(`/admin/users/${target.id}/password`, { password: reset })
        .expect(403);
    });

    it('changes the role and the countries together, audited', async () => {
      const viewer = await createUser(test, 'VIEWER');
      await as(test, superAdmin)
        .patch(`/admin/users/${viewer.id}/role`, { role: 'COUNTRY_AGENT' })
        .expect(400);
      const agent = await as(test, superAdmin)
        .patch(`/admin/users/${viewer.id}/role`, { role: 'COUNTRY_AGENT', countries: ['TN', 'MA'] })
        .expect(200);
      expect(agent.body).toMatchObject({ assignedCountries: ['TN', 'MA'] });
      const back = await as(test, superAdmin)
        .patch(`/admin/users/${viewer.id}/role`, { role: 'RECRUITER' })
        .expect(200);
      expect(back.body).toMatchObject({ role: 'RECRUITER', assignedCountries: [] });
      const entries = await test.prisma.auditLog.count({
        where: { action: 'admin_user.change_role', entityId: viewer.id },
      });
      // The refused change (no country) writes nothing.
      expect(entries).toBe(2);
    });

    it('keeps the countries consistent with the role in the database', async () => {
      await expect(
        test.prisma.user.create({
          data: {
            email: 'e2e-agent-db@example.test',
            role: 'COUNTRY_AGENT',
            assignedCountries: [],
          },
        }),
      ).rejects.toThrow();
      await expect(
        test.prisma.user.create({
          data: { email: 'e2e-viewer-db@example.test', role: 'VIEWER', assignedCountries: ['MA'] },
        }),
      ).rejects.toThrow();
      await expect(
        test.prisma.user.create({
          data: {
            email: 'e2e-agent-lc@example.test',
            role: 'COUNTRY_AGENT',
            assignedCountries: ['ma'],
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('the super admin still sees everything', () => {
    it('reads every candidate and application, and moves a Tunisian one', async () => {
      const all = await as(test, superAdmin).get('/admin/applications').expect(200);
      expect(ids(all.body)).toEqual(
        expect.arrayContaining([moroccanApp, tunisianApp, tunisianInMoroccoApp]),
      );
      await as(test, superAdmin).get(`/admin/candidates/${tunisian.profileId}`).expect(200);
      await as(test, superAdmin)
        .patch(`/admin/applications/${tunisianInMoroccoApp}/status`, { status: 'UNDER_REVIEW' })
        .expect(200);
    });
  });
});
