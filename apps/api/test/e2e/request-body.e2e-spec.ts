import { API, createTestApp, type TestApp } from './app.js';

/**
 * A body the parser cannot take is the client's error: 413 when too large, 400 when it is not
 * JSON, with a fixed message (never the parser's text) and never a 500 (audit M1).
 */
describe('request bodies the parser refuses (e2e)', () => {
  let test: TestApp;

  beforeAll(async () => {
    test = await createTestApp();
  });
  afterAll(async () => {
    await test.close();
  });

  const post = (path: string, body: string) =>
    test.http().post(`${API}${path}`).set('Content-Type', 'application/json').send(body);

  it.each(['/auth/login', '/contact'])(
    'answers 413 to a body over the limit on %s',
    async (path) => {
      const huge = JSON.stringify({ email: 'a'.repeat(3_000_000) });
      const response = await post(path, huge).expect(413);
      expect(response.body).toEqual({
        code: 'FILE_TOO_LARGE',
        message: 'The request body is too large',
      });
    },
  );

  it('answers 400 to malformed JSON without quoting it', async () => {
    const response = await post('/auth/login', '{"email": hunter2').expect(400);
    expect(response.body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'The request body could not be read',
    });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });
});
