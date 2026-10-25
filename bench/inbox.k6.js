// k6 load test for one GET endpoint: 20 virtual users (concurrent connections), a 10 s warm-up
// that is not counted, then 60 s measured.
//
// Run it with the path to test in REQUEST_PATH, for example:
//   k6 run -e REQUEST_PATH="/requests?accountantId={accountant}&limit=20" bench/inbox.k6.js
//   k6 run -e REQUEST_PATH="/accountants/{accountant}/dashboard" bench/inbox.k6.js
//
// {accountant} is a placeholder: on every request it is replaced by a random accountant id from
// 1 to 200, so the load is spread over all accountants. A path without {accountant} is sent as it
// is. BASE_URL (default http://127.0.0.1:3000) and VUS (default 20) can be changed the same way.
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
