/* global __ENV, __VU, __ITER */
// Load test of "apply to a job": 50 candidates applying at the same time.
//
//   k6 run tests/load/apply.js
//
// Needs, on this machine: the API on http://localhost:4000 (or API_URL) with the seeded
// data, started with RATE_LIMITS_ENABLED=false, and Mailpit on http://localhost:8025
// (or MAILPIT_URL): the test registers 50 candidates and verifies their addresses with
// the links found in Mailpit. Each candidate then applies once to each of a few open
// jobs (an application is allowed once per job).
//
// Cleaning up: with ADMIN_EMAIL and ADMIN_PASSWORD (a super admin), the test deletes its
// candidates and their applications through the back office, and nothing is left but one
// audit entry. Without them every test account erases itself, which keeps its
// applications as anonymous, withdrawn rows.
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = `${__ENV.API_URL || 'http://localhost:4000'}/api/v1`;
const MAILPIT = __ENV.MAILPIT_URL || 'http://localhost:8025';
const VUS = Number(__ENV.VUS || 50);
const JOBS_PER_CANDIDATE = 4;
const PASSWORD = 'harbour-violet-compass-58';
const PDF = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  setupTimeout: '5m',
  teardownTimeout: '3m',
  scenarios: {
    apply: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: JOBS_PER_CANDIDATE,
      maxDuration: '3m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_duration{name:apply}': ['p(95)<1500'],
    'http_req_duration{name:eligibility}': ['p(95)<800'],
  },
};

const cookieOf = (response) =>
  ['ib_access', 'ib_refresh']
    .map((name) => `${name}=${response.cookies[name] ? response.cookies[name][0].value : ''}`)
    .join('; ');

function verificationToken(email) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = http
      .get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
      .json();
    for (const message of found.messages || []) {
      const text = http.get(`${MAILPIT}/api/v1/message/${message.ID}`).json().Text || '';
      const match = /verify-email\?token=([\w-]+)/.exec(text);
      if (match) {
        return match[1];
      }
    }
    // Emails are sent in the background, right after the request.
    sleep(0.25);
  }
  throw new Error(`No verification email for ${email}`);
}

export function setup() {
  const stamp = Date.now().toString(36);
  const jobs = http
    .get(`${API}/jobs?pageSize=50`)
    .json()
    .items.filter((job) => job.questions.length === 0 && job.positions > 0)
    .slice(0, JOBS_PER_CANDIDATE);
  if (jobs.length < JOBS_PER_CANDIDATE) {
    throw new Error(`The seeded data must hold ${JOBS_PER_CANDIDATE} open jobs without questions`);
  }
  const candidates = [];
  for (let index = 0; index < VUS; index++) {
    const email = `load-${stamp}-${index}@example.test`;
    const jar = { jar: null };
    const registered = http.post(
      `${API}/auth/register`,
      JSON.stringify({
        email,
        password: PASSWORD,
        firstName: 'Load',
        lastName: `Test ${index}`,
        phone: '+21620123456',
        country: 'TN',
        gdprConsent: true,
        turnstileToken: 'load-test',
        locale: 'en',
      }),
      { headers: JSON_HEADERS, ...jar },
    );
    if (registered.status !== 201) {
      throw new Error(`Registration failed (${registered.status}). Is RATE_LIMITS_ENABLED=false?`);
    }
    http.post(`${API}/auth/verify-email`, JSON.stringify({ token: verificationToken(email) }), {
      headers: JSON_HEADERS,
    });
    const login = http.post(`${API}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
      headers: JSON_HEADERS,
    });
    const cookie = cookieOf(login);
    const auth = { headers: { ...JSON_HEADERS, Cookie: cookie }, jar: null };
    const profile = http.put(
      `${API}/me/profile`,
      JSON.stringify({
        firstName: 'Load',
        lastName: `Test ${index}`,
        gender: 'MALE',
        dateOfBirth: '1995-04-12',
        nationality: 'TN',
        countryOfResidence: 'TN',
        city: 'Tunis',
        phone: '+21620123456',
        whatsapp: null,
        passportNumber: `L${String(1000000 + index)}`,
        passportIssuingCountry: 'TN',
        passportIssueDate: '2022-01-15',
        passportExpiryDate: '2032-01-14',
        currentProfession: 'Welder',
        yearsOfExperience: 3,
        educationLevel: 'VOCATIONAL',
        languages: [{ language: 'en', level: 'B1' }],
        drivingLicenceCategories: [],
        preferredDestinations: [],
        hasStcwTraining: false,
        hasSeamanBook: false,
        hasMedicalCertificate: false,
        seaExperience: null,
      }),
      auth,
    );
    const documentIds = ['CV', 'PASSPORT'].map((type) => {
      const uploaded = http.post(
        `${API}/me/documents`,
        { type, file: http.file(PDF, `${type.toLowerCase()}.pdf`, 'application/pdf') },
        { headers: { Cookie: cookie }, jar: null },
      );
      return uploaded.json().id;
    });
    candidates.push({ email, cookie, documentIds, profileId: profile.json().id });
  }
  return { candidates, jobs: jobs.map((job) => job.id) };
}

export default function (data) {
  const me = data.candidates[__VU - 1];
  const jobId = data.jobs[__ITER];
  const params = { headers: { ...JSON_HEADERS, Cookie: me.cookie }, jar: null };
  const eligibility = http.get(`${API}/jobs/${jobId}/eligibility`, {
    ...params,
    tags: { name: 'eligibility' },
  });
  check(eligibility, { 'may apply': (response) => response.json().canApply === true });
  const applied = http.post(
    `${API}/jobs/${jobId}/apply`,
    JSON.stringify({
      documentIds: me.documentIds,
      coverLetter: 'Applying under load.',
      turnstileToken: 'load-test',
    }),
    { ...params, tags: { name: 'apply' } },
  );
  check(applied, { 'application created': (response) => response.status === 201 });
}

export function teardown(data) {
  if (__ENV.ADMIN_EMAIL && __ENV.ADMIN_PASSWORD) {
    const login = http.post(
      `${API}/auth/login`,
      JSON.stringify({ email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD }),
      { headers: JSON_HEADERS, jar: null },
    );
    const deleted = http.post(
      `${API}/admin/candidates/bulk-delete`,
      JSON.stringify({
        ids: data.candidates.map((candidate) => candidate.profileId),
        reason: 'Accounts created by the k6 load test',
      }),
      { headers: { ...JSON_HEADERS, Cookie: cookieOf(login) }, jar: null },
    );
    if (deleted.status < 300) {
      return;
    }
    console.warn(`Back-office deletion refused (${deleted.status}): the accounts erase themselves`);
  }
  for (const candidate of data.candidates) {
    // The access token may be over after a long run: sign in again to erase the account.
    const login = http.post(
      `${API}/auth/login`,
      JSON.stringify({ email: candidate.email, password: PASSWORD }),
      { headers: JSON_HEADERS, jar: null },
    );
    http.del(`${API}/me/account`, JSON.stringify({ password: PASSWORD }), {
      headers: { ...JSON_HEADERS, Cookie: cookieOf(login) },
      jar: null,
    });
  }
}
