import { Router } from 'express';
import crypto from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';
import { enqueueDailyCronJob } from '../../jobs/queue.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { runReconciliation, listReconciliationRuns, getReconciliationRunDetails } from './reconciliation.service.js';

export const reconciliationRouter = Router();
export const internalCronRouter = Router();

function isValidCronSecret(provided) {
  if (typeof provided !== 'string') return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(env.CRON_SECRET));
  } catch {
    return false; // different length
  }
}

// POST /api/internal/cron/daily - called once a day by cron-job.org.
// It only queues the work and answers at once, so a slow cold start cannot time the caller out.
internalCronRouter.post('/daily', async (req, res, next) => {
  if (!isValidCronSecret(req.headers['x-cron-secret'])) {
    logger.warn('Rejected a cron call with a missing or wrong X-Cron-Secret');
    return res.status(401).json({ error: { code: 'UNAUTHORIZED_CRON', message: 'Invalid or missing X-Cron-Secret header' } });
  }

  try {
    const job = await enqueueDailyCronJob();
    res.status(202).json({ status: 'ACCEPTED', job, timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

reconciliationRouter.use(requireAuth, requireRole('admin', 'reviewer'));

// POST /api/reconciliation/run - run now. { "simulateMismatches": true } adds fake errors for demos.
reconciliationRouter.post('/run', async (req, res, next) => {
  try {
    if (!env.DEMO_MODE && req.body.simulateMismatches) {
      throw new AppError(
        400,
        'SIMULATION_NOT_ALLOWED',
        'simulateMismatches is not permitted when DEMO_MODE is disabled'
      );
    }
    const simulateMismatches = env.DEMO_MODE && req.body.simulateMismatches === true;
    res.json(await runReconciliation({ simulateMismatches }));
  } catch (err) {
    next(err);
  }
});

reconciliationRouter.get('/runs', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    res.json({ runs: await listReconciliationRuns(limit) });
  } catch (err) {
    next(err);
  }
});

reconciliationRouter.get('/runs/:id', async (req, res, next) => {
  try {
    const run = await getReconciliationRunDetails(req.params.id);
    if (!run) {
      return res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: `Reconciliation run '${req.params.id}' was not found` } });
    }
    res.json({ run });
  } catch (err) {
    next(err);
  }
});
