import type { ApplicationStatus } from '@iconbridge/shared';
import {
  API,
  cookieHeader,
  createReadyCandidate,
  type ReadyCandidate,
  type TestApp,
  type TestUser,
} from './app.js';

/** HTTP calls as a given user. */
export const as = (test: TestApp, user: TestUser) => {
  const cookie = cookieHeader(user.cookies);
  return {
    get: (path: string) => test.http().get(`${API}${path}`).set('Cookie', cookie),
    post: (path: string, body: object = {}) =>
      test.http().post(`${API}${path}`).set('Cookie', cookie).send(body),
    patch: (path: string, body: object = {}) =>
      test.http().patch(`${API}${path}`).set('Cookie', cookie).send(body),
    put: (path: string, body: object = {}) =>
      test.http().put(`${API}${path}`).set('Cookie', cookie).send(body),
    delete: (path: string) => test.http().delete(`${API}${path}`).set('Cookie', cookie),
    upload: (path: string, file: Buffer, name: string) =>
      test.http().post(`${API}${path}`).set('Cookie', cookie).attach('file', file, name),
  };
};

/** A candidate applies to a job through the API; returns the application id. */
export async function applyTo(
  test: TestApp,
  candidate: ReadyCandidate,
  jobId: string,
): Promise<string> {
  const response = await test
    .http()
    .post(`${API}/jobs/${jobId}/apply`)
    .set('Cookie', cookieHeader(candidate.cookies))
    .send({ documentIds: [candidate.cvId, candidate.passportId], turnstileToken: 'ok' })
    .expect(201);
  return (response.body as { id: string }).id;
}

export async function newApplication(test: TestApp, jobId: string, email?: string) {
  const candidate = await createReadyCandidate(test, email);
  return { candidate, id: await applyTo(test, candidate, jobId) };
}

export const PIPELINE_AFTER_SUBMITTED: ApplicationStatus[] = [
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFER',
  'CONTRACT_SIGNED',
  'VISA_PROCESSING',
  'VISA_APPROVED',
  'DEPLOYED',
];

/** Moves an application forward, as a recruiter would, up to and including `target`. */
export async function advanceTo(
  test: TestApp,
  recruiter: TestUser,
  id: string,
  target: ApplicationStatus,
): Promise<void> {
  for (const status of PIPELINE_AFTER_SUBMITTED) {
    await as(test, recruiter).patch(`/admin/applications/${id}/status`, { status }).expect(200);
    if (status === target) {
      return;
    }
  }
  throw new Error(`${target} is not on the pipeline`);
}
