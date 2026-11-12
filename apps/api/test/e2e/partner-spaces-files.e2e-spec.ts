import { createHash } from 'node:crypto';
import {
  partnerApplicationSchema,
  partnerFileLinkSchema,
  partnerFileSchema,
  partnerSpaceSchema,
  partnerSpaceSummarySchema,
} from '@iconbridge/shared';
import sharp from 'sharp';
import {
  API,
  cookieHeader,
  createPartnerLogin,
  createTestApp,
  createUser,
  FAKE_PRIVATE_HOST,
  privateKey,
  resetDatabase,
  type TestApp,
  type TestUser,
} from './app.js';
import { docx, exe, gif, jpg, pdf, png, text } from './files.js';

/** The files of partner spaces (ADR-027, sections 5 and 7): checks, links, history, deletion. */
describe('partner spaces: files and logo (e2e, ADR-027)', () => {
  let test: TestApp;
  let root: TestUser;
  let partner: TestUser;
  let spaceId: string;
  let applicationId: string;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });

  beforeEach(async () => {
    await resetDatabase(test.prisma);
    test.privateFiles.clear();
    test.storageState.down = false;
    root = await createUser(test, 'SUPER_ADMIN', 'root@example.test');
    const space = await test.prisma.partnerSpace.create({
      data: { name: 'E2E Files Co', country: 'PL', defaultLocale: 'pl' },
    });
    spaceId = space.id;
    const job = await test.prisma.partnerJob.create({
      data: { partnerSpaceId: spaceId, role: 'E2E Welder', positions: 2, locations: ['Gdańsk'] },
    });
    applicationId = (
      await test.prisma.partnerApplication.create({
        data: {
          partnerSpaceId: spaceId,
          partnerJobId: job.id,
          firstName: 'Ola',
          lastName: 'E2EFiles',
          nationality: 'TN',
        },
      })
    ).id;
    partner = await createPartnerLogin(test, spaceId);
  });

  const upload = (user: TestUser, kind: string, content: Buffer, name: string) =>
    test
      .http()
      .put(`${API}/partner-spaces/${spaceId}/applications/${applicationId}/files/${kind}`)
      .set('Cookie', cookieHeader(user.cookies))
      .attach('file', content, name);

  const get = (user: TestUser, path: string) =>
    test.http().get(`${API}${path}`).set('Cookie', cookieHeader(user.cookies));

  /** Blobs of the space in the private partner-files container. */
  const blobs = () =>
    [...test.privateFiles.keys()].filter((key) =>
      key.startsWith(privateKey(`spaces/${spaceId}/`, 'partner-files')),
    );

  describe('uploads', () => {
    it('stores the file under a random name in the private container, with its hash', async () => {
      const response = await upload(partner, 'PASSPORT', pdf(), '../../Passport Ola.pdf').expect(
        200,
      );
      const file = partnerFileSchema.parse(response.body);
      expect(file).toMatchObject({
        kind: 'PASSPORT',
        originalName: 'Passport Ola.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf().length,
      });
      expect(blobs()).toHaveLength(1);
      expect(blobs()[0]).not.toContain('Passport');
      // Never in the container of the candidate documents.
      expect([...test.privateFiles.keys()].filter((key) => key.startsWith('spaces/'))).toEqual([]);
      const row = await test.prisma.partnerFile.findUniqueOrThrow({ where: { id: file.id } });
      expect(row.sha256).toBe(createHash('sha256').update(pdf()).digest('hex'));
      expect(row.storagePath).toMatch(new RegExp(`^spaces/${spaceId}/[0-9a-f-]{36}\\.pdf$`));

      const application = partnerApplicationSchema.parse(
        (await get(partner, `/partner-spaces/${spaceId}/applications/${applicationId}`).expect(200))
          .body,
      );
      expect(application.files).toMatchObject({
        PASSPORT: { id: file.id, originalName: 'Passport Ola.pdf' },
        CV: null,
        WORK_PERMIT: null,
      });
    });

    it.each([
      ['a CV as an image', 'CV', jpg, 'cv.jpg'],
      ['a passport as a Word file', 'PASSPORT', async () => Promise.resolve(docx()), 'p.docx'],
      ['a work permit as a GIF', 'WORK_PERMIT', gif, 'permit.pdf'],
      ['an executable named as a PDF', 'PASSPORT', async () => Promise.resolve(exe()), 'p.pdf'],
      ['plain text', 'CV', async () => Promise.resolve(text()), 'cv.pdf'],
    ] as const)('refuses %s (format read from the content)', async (_case, kind, make, name) => {
      const refused = await upload(partner, kind, await make(), name).expect(415);
      expect(refused.body).toMatchObject({ code: 'UNSUPPORTED_FILE' });
      expect(await test.prisma.partnerFile.count()).toBe(0);
      expect(blobs()).toEqual([]);
    });

    it('accepts the formats of each kind', async () => {
      await upload(partner, 'PASSPORT', await jpg(), 'p.jpg').expect(200);
      await upload(partner, 'CV', docx(), 'cv.docx').expect(200);
      await upload(partner, 'WORK_PERMIT', await png(), 'permit.png').expect(200);
      expect(await test.prisma.partnerFile.count()).toBe(3);
    });

    it('follows the size limit setting, refuses an empty file and a missing one', async () => {
      const big = Buffer.concat([pdf(), Buffer.alloc(5 * 1024 * 1024)]);
      const refused = await upload(partner, 'CV', big, 'big.pdf').expect(413);
      expect(refused.body).toMatchObject({ code: 'FILE_TOO_LARGE' });
      await test.prisma.setting.create({ data: { key: 'MAX_UPLOAD_SIZE_MB', value: 6 } });
      await upload(partner, 'CV', big, 'big.pdf').expect(200);
      await upload(partner, 'PASSPORT', Buffer.alloc(0), 'empty.pdf').expect(413);
      await test
        .http()
        .put(`${API}/partner-spaces/${spaceId}/applications/${applicationId}/files/CV`)
        .set('Cookie', cookieHeader(partner.cookies))
        .expect(400);
      await upload(partner, 'SELFIE', pdf(), 'x.pdf').expect(400);
    });

    it('removes the metadata of photos (position, device)', async () => {
      const withExif = await sharp({
        create: { width: 64, height: 64, channels: 3, background: '#468' },
      })
        .jpeg()
        .withExif({ IFD0: { Make: 'E2E Phone', Model: 'Secret Model' } })
        .toBuffer();
      expect((await sharp(withExif).metadata()).exif).toBeDefined();
      await upload(partner, 'PASSPORT', withExif, 'scan.jpg').expect(200);
      const stored = test.privateFiles.get(blobs()[0] ?? '');
      expect(stored).toBeDefined();
      const metadata = await sharp(stored?.content).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(stored?.content.includes('Secret Model')).toBe(false);
    });

    it('replaces the file of a kind and deletes the old blob, in the history', async () => {
      const first = partnerFileSchema.parse(
        (await upload(partner, 'CV', pdf(), 'cv-2025.pdf').expect(200)).body,
      );
      const [oldBlob] = blobs();
      const second = partnerFileSchema.parse(
        (await upload(partner, 'CV', docx(), 'cv-2026.docx').expect(200)).body,
      );
      expect(second.id).toBe(first.id);
      expect(second.originalName).toBe('cv-2026.docx');
      expect(blobs()).toHaveLength(1);
      expect(blobs()).not.toContain(oldBlob);

      const history = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: spaceId, entityType: 'file' },
        orderBy: [{ createdAt: 'asc' }, { field: 'asc' }],
      });
      expect(
        history.map((entry) => [entry.action, entry.field, entry.oldValue, entry.newValue]),
      ).toEqual([
        ['FILE_UPLOADED', 'kind', null, 'CV'],
        ['FILE_UPLOADED', 'originalName', null, 'cv-2025.pdf'],
        ['FILE_REPLACED', 'kind', 'CV', 'CV'],
        ['FILE_REPLACED', 'originalName', 'cv-2025.pdf', 'cv-2026.docx'],
      ]);
      expect(history.every((entry) => entry.partnerApplicationId === applicationId)).toBe(true);
    });
  });

  describe('links', () => {
    it('gives a 5-minute read-only link, inline only for what a browser displays', async () => {
      const passport = partnerFileSchema.parse(
        (await upload(partner, 'PASSPORT', pdf(), 'passport.pdf').expect(200)).body,
      );
      const cv = partnerFileSchema.parse(
        (await upload(partner, 'CV', docx(), 'cv.docx').expect(200)).body,
      );
      const preview = partnerFileLinkSchema.parse(
        (
          await get(partner, `/partner-spaces/${spaceId}/files/${passport.id}/link?inline=true`)
            .expect(200)
            .expect('Cache-Control', 'no-store')
        ).body,
      );
      expect(preview.url.startsWith(`${FAKE_PRIVATE_HOST}/partner-files/spaces/${spaceId}/`)).toBe(
        true,
      );
      const url = new URL(preview.url);
      expect(url.searchParams.get('sp')).toBe('r');
      expect(url.searchParams.get('ttl')).toBe('300');
      expect(url.searchParams.get('inline')).toBe('1');
      const expiresIn = new Date(preview.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(4 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(5 * 60_000);

      const download = partnerFileLinkSchema.parse(
        (await get(partner, `/partner-spaces/${spaceId}/files/${passport.id}/link`).expect(200))
          .body,
      );
      expect(new URL(download.url).searchParams.get('inline')).toBeNull();
      // A Word file cannot be previewed: it is saved.
      const word = partnerFileLinkSchema.parse(
        (
          await get(partner, `/partner-spaces/${spaceId}/files/${cv.id}/link?inline=true`).expect(
            200,
          )
        ).body,
      );
      expect(new URL(word.url).searchParams.get('inline')).toBeNull();
      expect(new URL(word.url).searchParams.get('name')).toBe('cv.docx');

      // Who looked at which file, and when.
      const seen = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: spaceId, action: { in: ['FILE_PREVIEWED', 'FILE_DOWNLOADED'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(seen.map((entry) => [entry.action, entry.entityId, entry.actorId])).toEqual([
        ['FILE_PREVIEWED', passport.id, partner.id],
        ['FILE_DOWNLOADED', passport.id, partner.id],
        ['FILE_DOWNLOADED', cv.id, partner.id],
      ]);
    });

    it('refuses an unknown file and a bad query', async () => {
      await get(
        partner,
        `/partner-spaces/${spaceId}/files/00000000-0000-4000-8000-000000000000/link`,
      ).expect(404);
      const file = partnerFileSchema.parse(
        (await upload(partner, 'PASSPORT', pdf(), 'p.pdf').expect(200)).body,
      );
      await get(partner, `/partner-spaces/${spaceId}/files/${file.id}/link?inline=yes`).expect(400);
    });
  });

  describe('logo (super admin)', () => {
    const putLogo = (user: TestUser, content: Buffer) =>
      test
        .http()
        .put(`${API}/admin/partner-spaces/${spaceId}/logo`)
        .set('Cookie', cookieHeader(user.cookies))
        .attach('file', content, 'logo.png');

    it('is re-encoded, private, linked for members only, replaced and removed', async () => {
      const big = await sharp({
        create: { width: 1600, height: 400, channels: 4, background: '#00000000' },
      })
        .png()
        .toBuffer();
      const space = partnerSpaceSchema.parse((await putLogo(root, big).expect(200)).body);
      expect(space.hasLogo).toBe(true);
      const [logo] = blobs();
      expect(logo).toMatch(/\/logo-[0-9a-f-]{36}\.webp$/);
      const stored = test.privateFiles.get(logo ?? '');
      expect(stored?.contentType).toBe('image/webp');
      expect((await sharp(stored?.content).metadata()).width).toBe(400);

      // A member gets a short link; the super admin's management view only says there is one.
      const summary = partnerSpaceSummarySchema.parse(
        (await get(partner, `/partner-spaces/${spaceId}`).expect(200)).body,
      );
      expect(summary.logoUrl?.startsWith(`${FAKE_PRIVATE_HOST}/partner-files/`)).toBe(true);
      expect(new URL(summary.logoUrl ?? '').searchParams.get('inline')).toBe('1');
      expect(JSON.stringify(space)).not.toContain(FAKE_PRIVATE_HOST);

      await putLogo(root, await jpg()).expect(200);
      expect(blobs()).toHaveLength(1);
      expect(blobs()).not.toContain(logo);

      const removed = await test
        .http()
        .delete(`${API}/admin/partner-spaces/${spaceId}/logo`)
        .set('Cookie', cookieHeader(root.cookies))
        .expect(200);
      expect(partnerSpaceSchema.parse(removed.body).hasLogo).toBe(false);
      expect(blobs()).toEqual([]);
      const after = partnerSpaceSummarySchema.parse(
        (await get(partner, `/partner-spaces/${spaceId}`).expect(200)).body,
      );
      expect(after.logoUrl).toBeNull();

      const actions = await test.prisma.partnerHistory.findMany({
        where: { partnerSpaceId: spaceId, entityType: 'space' },
        orderBy: { createdAt: 'asc' },
        select: { action: true },
      });
      expect(actions.map((entry) => entry.action)).toEqual([
        'LOGO_UPDATED',
        'LOGO_UPDATED',
        'LOGO_REMOVED',
      ]);
      expect(
        await test.prisma.auditLog.count({ where: { action: 'partner_space.set_logo' } }),
      ).toBe(2);
    });

    it('refuses what is not an image, and every role but super admin', async () => {
      const refused = await putLogo(root, pdf()).expect(415);
      expect(refused.body).toMatchObject({ code: 'UNSUPPORTED_FILE' });
      for (const role of ['COUNTRY_AGENT', 'RECRUITER', 'VIEWER', 'CANDIDATE'] as const) {
        await putLogo(await createUser(test, role), await png()).expect(403);
      }
      await putLogo(partner, await png()).expect(403);
      expect(blobs()).toEqual([]);
    });
  });

  describe('deleting the space (GDPR)', () => {
    const remove = () =>
      test
        .http()
        .delete(`${API}/admin/partner-spaces/${spaceId}`)
        .set('Cookie', cookieHeader(root.cookies))
        .send({ confirmName: 'E2E Files Co' });

    it('deletes every blob first, then every row; nothing when the storage fails', async () => {
      await upload(partner, 'PASSPORT', pdf(), 'p.pdf').expect(200);
      await upload(partner, 'CV', docx(), 'cv.docx').expect(200);
      await test
        .http()
        .put(`${API}/admin/partner-spaces/${spaceId}/logo`)
        .set('Cookie', cookieHeader(root.cookies))
        .attach('file', await png(), 'logo.png')
        .expect(200);
      // A blob that no row points to (an interrupted upload) goes too.
      test.privateFiles.set(privateKey(`spaces/${spaceId}/orphan.pdf`, 'partner-files'), {
        contentType: 'application/pdf',
        content: pdf(),
      });
      const other = await test.prisma.partnerSpace.create({
        data: { name: 'E2E Other Co', country: 'FR', defaultLocale: 'fr' },
      });
      const otherBlob = privateKey(`spaces/${other.id}/keep.pdf`, 'partner-files');
      test.privateFiles.set(otherBlob, { contentType: 'application/pdf', content: pdf() });
      expect(blobs()).toHaveLength(4);

      test.storageState.down = true;
      try {
        const down = await remove().expect(503);
        expect(down.body).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
      } finally {
        test.storageState.down = false;
      }
      expect(await test.prisma.partnerSpace.count({ where: { id: spaceId } })).toBe(1);
      expect(await test.prisma.partnerFile.count({ where: { partnerSpaceId: spaceId } })).toBe(2);

      await remove().expect(204);
      expect(blobs()).toEqual([]);
      expect(await test.prisma.partnerSpace.count({ where: { id: spaceId } })).toBe(0);
      expect(await test.prisma.partnerFile.count()).toBe(0);
      expect(await test.prisma.user.count({ where: { id: partner.id } })).toBe(0);
      expect(test.privateFiles.has(otherBlob)).toBe(true);
      const audit = await test.prisma.auditLog.findFirstOrThrow({
        where: { action: 'partner_space.delete' },
      });
      expect(audit.before).toMatchObject({ files: 2, blobs: 4 });
    });
  });
});
