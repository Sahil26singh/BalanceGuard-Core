import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';
import { logger } from '../config/logger.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Any number works: it just has to be the same for every instance that runs migrations
const ADVISORY_LOCK_ID = 987654321;

/**
 * Apply the .sql files in db/migrations that have not run yet, in file-name order.
 * An advisory lock makes sure only one server instance migrates at a time.
 */
export async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1);', [ADVISORY_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await client.query('SELECT name FROM schema_migrations;');
    const applied = new Set(rows.map((row) => row.name));
    const pending = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql') && !applied.has(file)).sort();

    for (const file of pending) {
      logger.info({ file }, 'Applying migration');
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      // Each file runs in its own transaction: it is applied completely or not at all
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ file, err: err.message }, 'Migration failed');
        throw err;
      }
    }

    logger.info(pending.length === 0 ? 'Database is up to date' : `Applied ${pending.length} migration(s)`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1);', [ADVISORY_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// `npm run migrate` runs this file directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err: err.message }, 'Migration run failed');
      process.exit(1);
    });
}
