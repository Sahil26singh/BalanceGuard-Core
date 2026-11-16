import { Router } from 'express';
import { z } from 'zod';
import { parseBody } from '../../utils/errors.js';
import { amountSchema } from '../../utils/validation.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { requireIdempotency } from '../idempotency/idempotency.middleware.js';
import { executeRefund } from './refunds.service.js';

// Mounted at /api/transfers/:id/refunds
export const refundsRouter = Router({ mergeParams: true });

refundsRouter.use(requireAuth);

const refundSchema = z.object({
  amount: amountSchema,
  reason: z.string().min(1).default('Customer requested refund')
});

// POST /api/transfers/:id/refunds - full or partial refund (needs an Idempotency-Key header)
refundsRouter.post('/', requireRole('admin'), requireIdempotency('refunds'), async (req, res, next) => {
  try {
    const { amount, reason } = parseBody(refundSchema, req.body, 'refund payload');

    const result = await executeRefund({
      idempotency: req.idempotency,
      parentTransferId: req.params.id,
      amount,
      reason,
      actorId: req.user.id,
      actorRole: req.user.role
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});
