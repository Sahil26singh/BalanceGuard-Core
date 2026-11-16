import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// BullMQ needs maxRetriesPerRequest: null
const baseOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 3000)
};

/** Connection settings shared by every BullMQ queue and worker. */
export const bullConnection = { ...baseOptions, url: env.REDIS_URL };

/** General-purpose client (risk velocity counters). Keys get the environment prefix. */
export const redisClient = new Redis(env.REDIS_URL, {
  ...baseOptions,
  keyPrefix: `${env.REDIS_KEY_PREFIX}:`
});

redisClient.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

export async function testRedisConnection() {
  try {
    await redisClient.ping();
  } catch (err) {
    // Never log REDIS_URL itself: it contains the password
    logger.error('Could not connect to Redis. Check REDIS_URL in backend/.env (use rediss:// if TLS is on).');
    throw err;
  }
  logger.info('Redis connected');

  // BullMQ needs "noeviction". Managed Redis often blocks CONFIG, so this check is best-effort.
  try {
    const [, policy] = await redisClient.config('GET', 'maxmemory-policy');
    if (policy !== 'noeviction') {
      logger.warn(`Redis eviction policy is "${policy}", but BullMQ needs "noeviction". Change it in the Redis Cloud settings.`);
    }
  } catch {
    logger.debug('CONFIG GET is not allowed by this Redis provider; skipping eviction policy check');
  }
}

export async function closeRedisConnection() {
  await redisClient.quit();
  logger.info('Redis connection closed');
}
