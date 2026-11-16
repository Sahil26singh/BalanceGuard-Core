import { Router } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { evaluateTransferRisk } from './risk.service.js';

export const riskRouter = Router();

riskRouter.use(requireAuth, requireRole('admin', 'reviewer'));

// POST /api/risk/evaluate - preview the risk score of a transfer without creating it
riskRouter.post('/evaluate', async (req, res, next) => {
  try {
    const { sourceAccountId, destinationAccountId, amount, deviceFingerprint, simulateLocationMismatch } = req.body;

    if (!env.DEMO_MODE && (simulateLocationMismatch !== undefined || req.headers['x-simulated-location-mismatch'])) {
      throw new AppError(
        400,
        'SIMULATION_NOT_ALLOWED',
        'simulateLocationMismatch is not permitted when DEMO_MODE is disabled'
      );
    }

    const evaluation = await evaluateTransferRisk({
      userId: req.user.id,
      sourceAccountId,
      destinationAccountId,
      amount,
      deviceFingerprint: deviceFingerprint || 'preview-device',
      simulateLocationMismatch:
        env.DEMO_MODE && (simulateLocationMismatch === true || req.headers['x-simulated-location-mismatch'] === 'true')
    });

    res.json({ evaluation });
  } catch (err) {
    next(err);
  }
});
