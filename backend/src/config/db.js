import pg from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

function getSslConfig() {
  if (process.env.DATABASE_SSL === 'false') {
    return false;
  }

  const isLocalhost =
    env.DATABASE_URL.includes('localhost') ||
    env.DATABASE_URL.includes('127.0.0.1');

  if (isLocalhost && !env.DATABASE_URL.includes('sslmode=require')) {
    return false;
  }

  const isProd = env.NODE_ENV === 'production';
  // In production, rejectUnauthorized defaults to true to verify CA certificates and prevent MITM attacks.
  // In non-production, it defaults to false unless explicitly configured.
  const rejectUnauthorized =
    env.DATABASE_SSL_REJECT_UNAUTHORIZED !== undefined
      ? env.DATABASE_SSL_REJECT_UNAUTHORIZED
      : isProd;

  if (isProd && !rejectUnauthorized) {
    logger.warn('PostgreSQL SSL certificate verification (rejectUnauthorized) is disabled in production!');
  }

  const sslConfig = {
    rejectUnauthorized
  };

  if (env.DATABASE_CA_CERT) {
    sslConfig.ca = env.DATABASE_CA_CERT;
  }

  return sslConfig;
}

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 5, // small on purpose: free-tier database
  connectionTimeoutMillis: 30000, // a sleeping Neon database can take a while to wake
  idleTimeoutMillis: 10000,
  ssl: getSslConfig()
});

pool.on('error', (err) => logger.error({ err: err.message }, 'Idle PostgreSQL client error'));

/** Run a single query. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `work(client)` inside one database transaction.
 * Commits if it returns, rolls back if it throws.
 */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ rollbackErr: rollbackErr.message, originalErr: err.message }, 'Transaction ROLLBACK failed');
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Connect with retries: a sleeping Neon database needs a few seconds to wake up. */
export async function testDatabaseConnection() {
  const startedAt = Date.now();
  let delayMs = 2000;

  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      logger.info('PostgreSQL connected');
      return;
    } catch (err) {
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      if (attempt >= 10 || elapsedSec > 60) {
        logger.error(
          'Could not connect to PostgreSQL. Check DATABASE_URL in backend/.env: it must be the ' +
            'direct (not -pooler) Neon connection string, and the Neon branch must be active.'
        );
        throw new Error(`Database connection failed after ${elapsedSec}s: ${err.message}`);
      }
      logger.warn({ attempt, err: err.message }, 'Database not ready yet (Neon may be waking up), retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 1.5, 8000);
    }
  }
}

export async function closeDatabasePool() {
  await pool.end();
  logger.info('PostgreSQL pool closed');
}
