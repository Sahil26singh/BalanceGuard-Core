import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { QUEUE_NAMES } from './queue.js';
import { processWebhookEvent, processOutboxWebhooks } from '../modules/webhooks/webhooks.service.js';
import { processPayoutOutbox } from '../modules/gateway/gateway.service.js';
import { generateRiskExplanation } from '../modules/risk/risk.explainer.js';
import { requeueStuckWebhooks, runReconciliation } from '../modules/reconciliation/reconciliation.service.js';

const workers = [];

function startWorker(queueName, handler, options = {}) {
  const worker = new Worker(queueName, handler, {
    connection: bullConnection,
    prefix: env.REDIS_KEY_PREFIX,
    ...options
  });
  worker.on('completed', (job) => logger.info({ queue: queueName, jobId: job.id }, 'Job completed'));
  worker.on('failed', (job, err) => logger.error({ queue: queueName, jobId: job?.id, err: err.message }, 'Job failed'));
  worker.on('error', (err) => logger.error({ queue: queueName, err: err.message }, 'Worker error'));
  workers.push(worker);
}

async function runDailyMaintenance() {
  const { requeuedCount } = await requeueStuckWebhooks();
  await processOutboxWebhooks(50);
  await processPayoutOutbox(50);
  const { run } = await runReconciliation();
  return { requeuedCount, reconciliationRunId: run.id };
}

/** Start the background workers inside this same process (needed on Render's free plan). */
export function initWorkers() {
  if (workers.length > 0) return;

  startWorker(QUEUE_NAMES.webhooks, (job) => processWebhookEvent(job.data.webhookEventId), { concurrency: 5 });
  // At most 5 explanations a minute, to stay inside the Gemini free tier
  startWorker(QUEUE_NAMES.risk, (job) => generateRiskExplanation(job.data), { limiter: { max: 5, duration: 60000 } });
  startWorker(QUEUE_NAMES.cron, runDailyMaintenance);

  logger.info('Background workers started');
}

/** Let running jobs finish, then stop the workers. */
export async function closeWorkers() {
  await Promise.all(workers.map((worker) => worker.close()));
  workers.length = 0;
}
