// Small helpers shared by the demo scripts. They only use the HTTP API, so they work
// against a local server and the deployed one alike, without database access.
import 'dotenv/config';

// The server address: first command-line argument, else API_URL, else the local server
const urlArg = process.argv[2]?.startsWith('http') ? process.argv[2] : undefined;
export const API_URL = (urlArg || process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, '');

const ADMIN_EMAIL = 'admin@balanceguard.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;

export async function login() {
  if (!ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_PASSWORD (or SEED_ADMIN_PASSWORD in backend/.env) to log in as the admin.');
  }

  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}). Is the server running at ${API_URL}?`);
  return (await res.json()).token;
}

/** fetch() with the auth header and JSON body filled in. */
export function apiClient(token) {
  return (path, { body, headers, ...options } = {}) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
}

/** The two demo customer wallets created by `npm run seed`. */
export async function getDemoWallets(api) {
  const { accounts } = await (await api('/api/accounts')).json();
  const alice = accounts.find((a) => a.user_email === 'alice@example.com');
  const bob = accounts.find((a) => a.user_email === 'bob@example.com');
  if (!alice || !bob) throw new Error('Demo wallets not found. Run: npm run seed');
  return { alice, bob };
}

export async function getBalance(api, accountId) {
  const { account } = await (await api(`/api/accounts/${accountId}`)).json();
  return BigInt(account.balance);
}

export function transferRequest(api, { from, to, amount, key }) {
  return api('/api/transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { sourceAccountId: from, destinationAccountId: to, amount }
  });
}
