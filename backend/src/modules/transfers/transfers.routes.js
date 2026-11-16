import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { query } from '../../config/db.js';
import { AppError, parseBody } from '../../utils/errors.js';
import { amountSchema } from '../../utils/validation.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { requireIdempotency } from '../idempotency/idempotency.middleware.js';
import { evaluateTransferRisk, incrementUserVelocity } from '../risk/risk.service.js';
import { startTopup, processPayoutOutbox } from '../gateway/gateway.service.js';
import { executeTransfer, getTransferById, listTransfers, initiatePayout } from './transfers.service.js';

export const transfersRouter = Router();

transfersRouter.use(requireAuth);

const transferSchema = z
  .object({
    sourceAccountId: z.string().uuid(),
    destinationAccountId: z.string().uuid(),
    amount: amountSchema,
    transferType: z.literal('INTERNAL_TRANSFER').default('INTERNAL_TRANSFER'),
    // Demo only: lets the Demo Lab force a risk hold. It can raise the score, never lower it.
    simulateRiskScore: z.number().int().min(0).max(100).optional(),
    locationMismatch: z.boolean().optional()
  })
  .superRefine((data, ctx) => {
    if (!env.DEMO_MODE) {
      if (data.simulateRiskScore !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['simulateRiskScore'],
          message: 'simulateRiskScore is not permitted when DEMO_MODE is disabled'
        });
      }
      if (data.locationMismatch !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locationMismatch'],
          message: 'locationMismatch is not permitted when DEMO_MODE is disabled'
        });
      }
    }
  });

const topupSchema = z.object({
  customerWalletId: z.string().uuid(),
  amount: amountSchema
});

const payoutSchema = z
  .object({
    sourceAccountId: z.string().uuid(),
    amount: amountSchema,
    shouldFail: z.boolean().default(false) // ask the simulated bank to reject the payout
  })
  .superRefine((data, ctx) => {
    if (!env.DEMO_MODE && data.shouldFail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shouldFail'],
        message: 'shouldFail is not permitted when DEMO_MODE is disabled'
      });
    }
  });

// POST /api/transfers/topup - idempotent top-up intent; wallet credited once provider webhook verifies
transfersRouter.post('/topup', requireRole('admin'), requireIdempotency('topup'), async (req, res, next) => {
  try {
    const { customerWalletId, amount } = parseBody(topupSchema, req.body, 'top-up payload');

    const result = await startTopup({
      idempotency: req.idempotency,
      customerWalletId,
      amount
    });

    res.status(result.statusCode || 200).json(result.body || result);
  } catch (err) {
    next(err);
  }
});

// POST /api/transfers/payout - money moves to clearing via transactional outbox, provider webhook settles or reverses it
transfersRouter.post('/payout', requireRole('admin'), requireIdempotency('transfers'), async (req, res, next) => {
  try {
    const { sourceAccountId, amount, shouldFail } = parseBody(payoutSchema, req.body, 'payout payload');

    const result = await initiatePayout({
      idempotency: req.idempotency,
      sourceAccountId,
      amount,
      shouldFail,
      actorId: req.user.id,
      actorRole: req.user.role
    });

    // Payout record is safely in the transactional outbox; trigger immediate dispatch with background retry guarantee
    if (result.created) {
      setImmediate(() => {
        processPayoutOutbox().catch((err) => {
          logger.warn({ err: err.message }, 'Immediate payout outbox dispatch failed; worker will retry');
        });
      });
    }

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});

// POST /api/transfers - idempotent wallet-to-wallet transfer (needs an Idempotency-Key header)
transfersRouter.post('/', requireRole('admin'), requireIdempotency('transfers'), async (req, res, next) => {
  try {
    if (!env.DEMO_MODE && req.headers['x-simulated-location-mismatch']) {
      throw new AppError(
        400,
        'SIMULATION_NOT_ALLOWED',
        'x-simulated-location-mismatch header is not permitted when DEMO_MODE is disabled'
      );
    }

    const { sourceAccountId, destinationAccountId, amount, simulateRiskScore, locationMismatch } = parseBody(
      transferSchema,
      req.body,
      'transfer payload'
    );

    // Resolve the actual owner of the source wallet to score the correct customer profile
    const { rows: sourceAccountRows } = await query(
      'SELECT user_id FROM accounts WHERE id = $1;',
      [sourceAccountId]
    );
    if (sourceAccountRows.length === 0) {
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', `Source account '${sourceAccountId}' was not found`);
    }
    const walletOwnerUserId = sourceAccountRows[0].user_id || req.user.id;

    // Score the transfer first using the wallet owner's profile (not the admin or staff actor)
    const risk = await evaluateTransferRisk({
      userId: walletOwnerUserId,
      sourceAccountId,
      destinationAccountId,
      amount,
      deviceFingerprint: req.headers['x-device-fingerprint'] || req.body.deviceFingerprint || 'standard-device',
      simulateLocationMismatch:
        env.DEMO_MODE && (locationMismatch === true || req.headers['x-simulated-location-mismatch'] === 'true')
    });

    // Simulated risk score is strictly restricted to authorized admin in DEMO_MODE and can only raise the score, never lower it
    const riskScore =
      env.DEMO_MODE && req.user.role === 'admin' && simulateRiskScore !== undefined
        ? Math.max(risk.score, simulateRiskScore)
        : risk.score;

    const result = await executeTransfer({
      idempotency: req.idempotency,
      sourceAccountId,
      destinationAccountId,
      amount,
      actorId: req.user.id,
      actorRole: req.user.role,
      riskScore,
      riskSignals: risk.signals,
      riskReasons: risk.reasons,
      signalsIncomplete: risk.signalsIncomplete
    });

    // Count it for the velocity check only if a new transfer really completed (not a retry or a hold)
    if (result.created && result.statusCode === 201) {
      await incrementUserVelocity(walletOwnerUserId);
    }

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});

// GET /api/transfers - list transfers with optional status and accountId filters
transfersRouter.get('/', async (req, res, next) => {
  try {
    const { status, accountId, limit, offset } = req.query;

    res.json(
      await listTransfers({
        status,
        accountId,
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0
      })
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/transfers/:id - one transfer with its ledger entries
transfersRouter.get('/:id', async (req, res, next) => {
  try {
    const transfer = await getTransferById(req.params.id);
    if (!transfer) {
      return res.status(404).json({ error: { code: 'TRANSFER_NOT_FOUND', message: `Transfer '${req.params.id}' was not found` } });
    }

    res.json({ transfer });
  } catch (err) {
    next(err);
  }
});
