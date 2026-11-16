/**
 * BalanceGuard Core - API Client
 * 
 * Features:
 * - Automatically injects JWT Bearer token from localStorage.
 * - Enforces Golden Rule 10: If the first API call takes longer than 3s,
 *   activates the "Server is waking up" state and retries /health every 3s for up to 90s.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
// Derive backend root for /health check (strip /api suffix if present)
const HEALTH_URL = API_BASE_URL.replace(/\/api\/?$/, '') + '/health';

// Wake-up state listeners
const wakeListeners = new Set();
let isWakingUp = false;
let wakeElapsedSec = 0;

export function subscribeToWakeState(callback) {
  wakeListeners.add(callback);
  callback({ isWakingUp, wakeElapsedSec });
  return () => wakeListeners.delete(callback);
}

function notifyWakeState(waking, elapsed = 0) {
  isWakingUp = waking;
  wakeElapsedSec = elapsed;
  wakeListeners.forEach((cb) => cb({ isWakingUp, wakeElapsedSec }));
}

/**
 * Polls /health every 3s for up to 90s until the server wakes from idle sleep.
 */
async function waitForServerWakeUp() {
  const maxWaitSec = 90;
  const pollIntervalMs = 3000;
  let elapsed = 3;

  notifyWakeState(true, elapsed);

  while (elapsed < maxWaitSec) {
    try {
      const res = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (res.ok) {
        notifyWakeState(false, 0);
        return true;
      }
    } catch {
      // Server still sleeping, continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    elapsed += 3;
    notifyWakeState(true, elapsed);
  }

  notifyWakeState(false, 0);
  throw new Error('Server wake-up timeout exceeded (90s). Please check your backend status on Render.');
}

/**
 * Core HTTP Fetch wrapper with cold-start timeout detection and auth injection.
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = localStorage.getItem('bgc_token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers
  };

  // Cold-start timer: if call takes > 3s, trigger the "server is waking up" screen
  let isCompleted = false;
  const wakeTimer = setTimeout(() => {
    if (!isCompleted) {
      waitForServerWakeUp();
    }
  }, 3000);

  try {
    const res = await fetch(url, { ...options, headers });
    isCompleted = true;
    clearTimeout(wakeTimer);

    if (res.status === 401 && !endpoint.includes('/auth/login')) {
      // Clear token on 401
      localStorage.removeItem('bgc_token');
      localStorage.removeItem('bgc_user');
      window.dispatchEvent(new Event('bgc_auth_change'));
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const error = new Error(data.error?.message || `HTTP ${res.status} error`);
      error.status = res.status;
      error.code = data.error?.code;
      error.details = data.error?.details;
      throw error;
    }

    return data;
  } catch (err) {
    isCompleted = true;
    clearTimeout(wakeTimer);
    throw err;
  }
}

// ============================================================================
// API Service Methods
// ============================================================================

export const api = {
  async login(email, password) {
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    localStorage.setItem('bgc_token', data.token);
    localStorage.setItem('bgc_user', JSON.stringify(data.user));
    window.dispatchEvent(new Event('bgc_auth_change'));
    return data;
  },

  logout() {
    localStorage.removeItem('bgc_token');
    localStorage.removeItem('bgc_user');
    window.dispatchEvent(new Event('bgc_auth_change'));
  },

  getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem('bgc_user'));
    } catch {
      return null;
    }
  },

  getDemoCredentials: () => apiFetch('/auth/demo-credentials'),
  getLedgerIntegrity: () => apiFetch('/ledger/integrity'),

  listAccounts: () => apiFetch('/accounts'),

  listTransfers: (params = {}) => apiFetch(`/transfers${toQueryString(params)}`),
  getTransfer: (id) => apiFetch(`/transfers/${id}`),

  createTransfer: (payload, idempotencyKey) =>
    apiFetch('/transfers', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || newKey('web-tx') },
      body: JSON.stringify(payload)
    }),

  topupWallet: (payload, idempotencyKey) =>
    apiFetch('/transfers/topup', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || newKey('web-topup') },
      body: JSON.stringify(payload)
    }),

  payoutWallet: (payload, idempotencyKey) =>
    apiFetch('/transfers/payout', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || newKey('web-payout') },
      body: JSON.stringify(payload)
    }),

  refundTransfer: (transferId, payload, idempotencyKey) =>
    apiFetch(`/transfers/${transferId}/refunds`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey || newKey('web-refund') },
      body: JSON.stringify(payload)
    }),

  getReviewQueue: () => apiFetch('/review/queue'),
  submitReview: (transferId, decision, reviewNote) =>
    apiFetch(`/review/${transferId}`, { method: 'POST', body: JSON.stringify({ decision, reviewNote }) }),

  listReconciliationRuns: () => apiFetch('/reconciliation/runs'),
  getReconciliationRun: (id) => apiFetch(`/reconciliation/runs/${id}`),
  runReconciliation: (simulateMismatches = false) =>
    apiFetch('/reconciliation/run', { method: 'POST', body: JSON.stringify({ simulateMismatches }) }),

  listAuditLogs: (params = {}) => apiFetch(`/audit${toQueryString(params)}`),
  simulateDuplicateWebhook: () => apiFetch('/webhooks/simulate-duplicate', { method: 'POST' })
};

function toQueryString(params) {
  const query = new URLSearchParams(params).toString();
  return query ? `?${query}` : '';
}

function newKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
