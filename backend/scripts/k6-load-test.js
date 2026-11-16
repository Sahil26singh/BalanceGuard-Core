// Light load test with k6 (https://k6.io). Keep it small on free hosting.
//   k6 run -e BASE_URL=http://localhost:4000 -e ADMIN_PASSWORD=... scripts/k6-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  stages: [
    { duration: '5s', target: 5 },   // Ramp up to 5 VUs
    { duration: '20s', target: 10 },  // Sustained light load at 10 VUs
    { duration: '5s', target: 0 }    // Graceful ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],       // Error rate must be under 2%
    http_req_duration: ['p(95)<800']      // 95% of requests must complete under 800ms on free tier
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export function setup() {
  // 1. Authenticate to obtain token for load testing
  const loginPayload = JSON.stringify({
    email: 'admin@balanceguard.local',
    password: __ENV.ADMIN_PASSWORD
  });

  const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, {
    headers: { 'Content-Type': 'application/json' }
  });

  check(loginRes, {
    'Setup: Admin authentication successful': (r) => r.status === 200
  });

  const loginData = loginRes.json();
  const token = loginData.token;

  // 2. Fetch available accounts for transfers
  const accRes = http.get(`${BASE_URL}/api/accounts`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const accounts = accRes.json().accounts || [];
  const alice = accounts.find((a) => a.user_email === 'alice@example.com');
  const bob = accounts.find((a) => a.user_email === 'bob@example.com');

  return {
    token,
    sourceAccountId: alice ? alice.id : null,
    destinationAccountId: bob ? bob.id : null
  };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`
  };

  // Scenario 1: Zero-overhead Health Check (Fast ping)
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'Health check returns 200': (r) => r.status === 200
  });

  // Scenario 2: Idempotent Payment Transfer
  if (data.sourceAccountId && data.destinationAccountId) {
    const idempotencyKey = `k6-tx-${uuidv4()}`;
    const transferPayload = JSON.stringify({
      sourceAccountId: data.sourceAccountId,
      destinationAccountId: data.destinationAccountId,
      amount: 100 // Rs 1.00
    });

    const txRes = http.post(`${BASE_URL}/api/transfers`, transferPayload, {
      headers: {
        ...headers,
        'Idempotency-Key': idempotencyKey
      }
    });

    check(txRes, {
      'Transfer created (201) or held (202)': (r) => r.status === 201 || r.status === 202
    });
  }

  // Small sleep between VU iterations to simulate natural client pacing
  sleep(0.5);
}

export function teardown(data) {
  // Post-test: Verify mathematical ledger integrity
  const integrityRes = http.get(`${BASE_URL}/api/ledger/integrity`, {
    headers: { Authorization: `Bearer ${data.token}` }
  });

  check(integrityRes, {
    'Teardown: Ledger is 100% mathematically balanced': (r) => {
      const body = r.json();
      return body.integrity && body.integrity.isBalanced === true;
    }
  });
}

