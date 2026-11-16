import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { testDatabaseConnection, closeDatabasePool } from './config/db.js';
import { testRedisConnection, closeRedisConnection } from './config/redis.js';
import { runMigrations } from './db/migrate.js';
import { initWorkers, closeWorkers } from './jobs/worker.js';

async function start() {
  logger.info(`Starting BalanceGuard Core in ${env.NODE_ENV} mode`);

  await testDatabaseConnection();
  await testRedisConnection();

  if (env.RUN_MIGRATIONS_ON_START) {
    await runMigrations();
  }

  // On Render's free plan the API and the background worker share one process
  if (env.RUN_WORKER) {
    initWorkers();
  }

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`API listening on port ${env.PORT}`);
  });

  // Render stops the process with SIGTERM on every deploy and restart
  async function shutdown(signal) {
    logger.info(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 10000).unref(); // do not hang forever

    server.close(async () => {
      try {
        await closeWorkers();
        await closeDatabasePool();
        await closeRedisConnection();
        process.exit(0);
      } catch (err) {
        logger.error({ err: err.message }, 'Error while shutting down');
        process.exit(1);
      }
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error({ err: err.message }, 'Failed to start the server');
  process.exit(1);
});
