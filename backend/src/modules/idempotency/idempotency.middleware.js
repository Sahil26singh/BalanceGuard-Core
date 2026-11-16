import { computeRequestHash, getIdempotencyRecord, STALE_LOCK_MS } from './idempotency.service.js';
import { AppError } from '../../utils/errors.js';

/**
 * Requires an Idempotency-Key header and answers early for keys we have already seen:
 *  - finished request, same body  -> replay the stored response
 *  - finished request, other body -> 422
 *  - still running                -> 409
 * A new key continues to the route with req.idempotency = { scope, key, requestHash }.
 */
export function requireIdempotency(scope) {
  return async (req, res, next) => {
    try {
      const key = String(req.headers['idempotency-key'] || '').trim();
      if (!key) {
        throw new AppError(400, 'MISSING_IDEMPOTENCY_KEY', "The 'Idempotency-Key' header is required for this request");
      }
      if (key.length > 255) {
        throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', "The 'Idempotency-Key' must be at most 255 characters");
      }

      const requestHash = computeRequestHash(req.body);
      const existing = await getIdempotencyRecord(scope, key);

      if (existing?.status === 'RESOLVED') {
        if (existing.request_hash !== requestHash) {
          throw new AppError(422, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'This Idempotency-Key was already used with a different request body');
        }
        res.setHeader('X-Cache-Lookup', 'IDEMPOTENCY_HIT');
        return res.status(existing.response_status_code).json(existing.response_body);
      }

      if (existing?.status === 'IN_PROGRESS' && Date.now() - new Date(existing.locked_at).getTime() < STALE_LOCK_MS) {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still in progress. Retry shortly.');
      }

      req.idempotency = { scope, key, requestHash };
      next();
    } catch (err) {
      next(err);
    }
  };
}
