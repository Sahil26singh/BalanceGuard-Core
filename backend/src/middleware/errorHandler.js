import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

// PostgreSQL error codes we turn into friendly HTTP errors
const PG_ERRORS = {
  '23505': [409, 'UNIQUE_CONSTRAINT_VIOLATION', 'A resource with these unique attributes already exists'],
  '23503': [400, 'FOREIGN_KEY_VIOLATION', 'Referenced entity does not exist'],
  '23514': [400, 'CHECK_CONSTRAINT_VIOLATION', 'Operation violates a database safety constraint (for example a negative balance)']
};

/** Central error handler. Every error response has the shape { error: { code, message } }. */
export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'Unexpected server error';

  if (PG_ERRORS[err.code]) {
    [statusCode, code, message] = PG_ERRORS[err.code];
  } else if (err.code === 'P0001') {
    // RAISE EXCEPTION from a trigger, for example an attempt to edit the ledger
    statusCode = 403;
    code = 'DATABASE_TRIGGER_ABORT';
  }

  if (statusCode >= 500) {
    logger.error({ err, method: req.method, url: req.originalUrl }, 'Request failed');
  } else {
    logger.warn({ code, method: req.method, url: req.originalUrl }, message);
  }

  res.status(statusCode).json({
    error: {
      code,
      // Do not leak internal details of unexpected errors in production
      message: statusCode >= 500 && env.NODE_ENV === 'production' ? 'Internal server error' : message,
      ...(err.details && { details: err.details }),
      ...(env.NODE_ENV !== 'production' && statusCode >= 500 && { stack: err.stack })
    }
  });
}
