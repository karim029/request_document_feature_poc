// k6 load test for a GET endpoint: 10 s warm-up (not recorded), then 60 s measured,
// 20 virtual users (concurrent connections). A random accountant (1 to 200) is used on each request.
//
// Run:  k6 run -e REQUEST_PATH="/requests?accountantId={accountant}&limit=20" bench/inbox.k6.js
// Other endpoints: change REQUEST_PATH, for example "/requests/{accountant}/history" is NOT valid;
// use a real path, and {accountant} is replaced only where it appears.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const REQUEST_PATH = __ENV.REQUEST_PATH || '/requests?accountantId={accountant}&limit=20';
const VUS = Number(__ENV.VUS || 20);

export const options = {
  scenarios: {
    warmup: { executor: 'constant-vus', vus: VUS, duration: '10s', exec: 'hit' },
    measured: {
      executor: 'constant-vus',
      vus: VUS,
      duration: '60s',
      startTime: '10s',
      exec: 'hit',
    },
  },
  // These thresholds are always true. They exist only so k6 prints the numbers of the measured
  // scenario separately from the warm-up.
  thresholds: {
    'http_req_duration{scenario:measured}': ['p(95)>=0'],
    'http_req_failed{scenario:measured}': ['rate>=0'],
    'http_reqs{scenario:measured}': ['count>=0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function hit() {
  const accountant = 1 + Math.floor(Math.random() * 200);
  const res = http.get(`${BASE}${REQUEST_PATH.replace('{accountant}', accountant)}`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
