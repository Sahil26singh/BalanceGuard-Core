import crypto from 'crypto';
import { query } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';

// An IN_PROGRESS key older than this belongs to a crashed server and may be taken over
export const STALE_LOCK_MS = 60000;

/** Sort object keys so the same body always gives the same hash, whatever the key order. */
function sortKeys(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

export function computeRequestHash(body) {
  const text = body == null ? '' : JSON.stringify(sortKeys(body));
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function getIdempotencyRecord(scope, key) {
  const { rows } = await query('SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2;', [scope, key]);
  return rows[0] || null;
}

/**
 * Try to claim an idempotency key inside the current transaction.
 * Returns { claimed: true } when this request owns the key, otherwise the existing row.
 */
async function claimIdempotencyKey(client, { scope, key, requestHash }) {
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (scope, key, request_hash, status, locked_at)
     VALUES ($1, $2, $3, 'IN_PROGRESS', NOW())
     ON CONFLICT (scope, key) DO NOTHING
     RETURNING id;`,
    [scope, key, requestHash]
  );
  if (inserted.rowCount === 1) return { claimed: true };

  // Someone else has the key: lock their row and look at it
  const { rows } = await client.query(
    'SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2 FOR UPDATE;',
    [scope, key]
  );
  const existing = rows[0];

  // A server that crashed mid-request leaves a stale IN_PROGRESS row. Take it over.
  const lockAgeMs = Date.now() - new Date(existing.locked_at).getTime();
  if (existing.status === 'IN_PROGRESS' && lockAgeMs > STALE_LOCK_MS) {
    logger.warn({ scope, key, lockAgeMs }, 'Taking over a stale idempotency key');
    await client.query(
      'UPDATE idempotency_keys SET locked_at = NOW(), request_hash = $1, updated_at = NOW() WHERE id = $2;',
      [requestHash, existing.id]
    );
    return { claimed: true };
  }

  return { claimed: false, existingRecord: existing };
}

/**
 * Claim the key, or work out what to answer when it was already used.
 * Returns null when this request may go ahead, or the stored { statusCode, body } to replay.
 */
export async function claimOrReplay(client, { scope, key, requestHash }) {
  const { claimed, existingRecord } = await claimIdempotencyKey(client, { scope, key, requestHash });
  if (claimed) return null;

  if (existingRecord.status === 'RESOLVED') {
    if (existingRecord.request_hash !== requestHash) {
      throw new AppError(422, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'This Idempotency-Key was already used with a different request body');
    }
    return { statusCode: existingRecord.response_status_code, body: existingRecord.response_body };
  }

  throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still in progress. Retry shortly.');
}

/** Store the final response so any retry with the same key gets exactly the same answer. */
export async function resolveIdempotencyKey(client, { scope, key, statusCode, responseBody }) {
  await client.query(
    `UPDATE idempotency_keys
     SET status = 'RESOLVED', response_status_code = $1, response_body = $2, updated_at = NOW()
     WHERE scope = $3 AND key = $4;`,
    [statusCode, JSON.stringify(responseBody), scope, key]
  );
}
