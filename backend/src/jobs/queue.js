import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';

export const QUEUE_NAMES = {
  webhooks: 'webhooks-queue',
  risk: 'risk-queue',
  cron: 'cron-queue'
};

// Keep very little in Redis: the free plan only has 30 MB
const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }
};

function createQueue(name, jobOptions = defaultJobOptions) {
  const queue = new Queue(name, {
    connection: bullConnection,
    prefix: env.REDIS_KEY_PREFIX,
    defaultJobOptions: jobOptions
  });
  queue.on('error', (err) => logger.error({ queue: name, err: err.message }, 'Queue error'));
  return queue;
}

const webhooksQueue = createQueue(QUEUE_NAMES.webhooks);
const riskQueue = createQueue(QUEUE_NAMES.risk, { ...defaultJobOptions, attempts: 2 });
const cronQueue = createQueue(QUEUE_NAMES.cron);

/**
 * Queue a webhook for processing.
 * If Redis is down the webhook stays RECEIVED in PostgreSQL and the daily job picks it up later.
 */
export async function enqueueWebhookJob({ webhookEventId, providerEventId }) {
  try {
    // Same jobId twice = BullMQ ignores the duplicate
    return await webhooksQueue.add('process-webhook', { webhookEventId, providerEventId }, { jobId: `webhook-${providerEventId}` });
  } catch (err) {
    logger.error({ err: err.message, providerEventId }, 'Could not queue webhook; it stays RECEIVED in PostgreSQL');
    return null;
  }
}

/** Ask the worker to write an AI explanation for a held transfer. Failure is harmless. */
export async function enqueueRiskExplainerJob(data) {
  try {
    return await riskQueue.add('explain-risk', data, { jobId: `risk-explain-${data.riskAssessmentId}` });
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not queue risk explanation');
    return null;
  }
}

/** Queue the daily maintenance job. Calling it twice in a day does not run it twice at once. */
export async function enqueueDailyCronJob() {
  const date = new Date().toISOString().slice(0, 10);
  const jobId = `daily-cron-${date}`;

  const existing = await cronQueue.getJob(jobId);
  if (existing && ['active', 'waiting', 'delayed'].includes(await existing.getState())) {
    return { status: 'ALREADY_QUEUED', jobId };
  }

  const job = await cronQueue.add('daily-maintenance', { date }, { jobId, removeOnComplete: true });
  return { status: 'QUEUED', jobId: job.id };
}
