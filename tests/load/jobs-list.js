/* global __ENV */
// Load test of the public job list and search: 50 visitors browsing at the same time.
//
//   k6 run tests/load/jobs-list.js
//
// Needs the API on http://localhost:4000 (or API_URL) with the seeded data, started
// with RATE_LIMITS_ENABLED=false: every virtual user comes from this machine, and
// the normal limit (120 requests a minute per address) would refuse nearly all of them.
//
// Against the production site (read only, rate limits on), keep under that limit with
// fewer users who read longer, e.g. 20 users reading about 40 s (about 90 requests a minute):
//
//   API_URL=https://<site> VUS=20 DURATION=3m THINK_SECONDS=40 k6 run tests/load/jobs-list.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = `${__ENV.API_URL || 'http://localhost:4000'}/api/v1`;
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '40s';
// Mean reading time between two pages, in seconds (0.5 to 1.5 s by default).
const THINK_SECONDS = Number(__ENV.THINK_SECONDS || 1);

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Refused by the rate limit: the run measured the limit, not the site.
    'checks{check:not rate limited}': ['rate==1'],
    'http_req_duration{name:list}': ['p(95)<400'],
    'http_req_duration{name:search}': ['p(95)<600'],
    'http_req_duration{name:detail}': ['p(95)<400'],
  },
};

const QUERIES = [
  '',
  '?destination=MALTA',
  '?destination=POLAND&sort=deadline',
  '?destination=CRUISE_SHIP',
  '?featured=true',
  '?page=2&pageSize=5',
  '?sort=salary&currency=EUR&salaryMin=1000',
];
// With a typo and a plural: the search tolerates both.
const SEARCHES = ['welder', 'welders', 'reciptionist', 'driver', 'cook', 'hotel'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function setup() {
  const page = http.get(`${API}/jobs?pageSize=50`).json();
  if (!page.items || page.items.length === 0) {
    throw new Error('No open job: run `pnpm db:seed` first');
  }
  return { slugs: page.items.map((job) => job.slug) };
}

export default function (data) {
  const list = http.get(`${API}/jobs${pick(QUERIES)}`, { tags: { name: 'list' } });
  check(list, {
    'list answers 200': (response) => response.status === 200,
    'not rate limited': (response) => response.status !== 429,
  });
  const search = http.get(`${API}/jobs?q=${pick(SEARCHES)}`, { tags: { name: 'search' } });
  check(search, { 'search answers 200': (response) => response.status === 200 });
  const detail = http.get(`${API}/jobs/${pick(data.slugs)}`, { tags: { name: 'detail' } });
  check(detail, { 'detail answers 200': (response) => response.status === 200 });
  // A visitor reads a little between two pages.
  sleep(THINK_SECONDS * (0.5 + Math.random()));
}
