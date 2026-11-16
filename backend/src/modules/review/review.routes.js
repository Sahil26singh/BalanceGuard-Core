import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { parseBody } from '../../utils/errors.js';
import { getReviewQueue, reviewTransfer } from './review.service.js';

export const reviewRouter = Router();

reviewRouter.use(requireAuth, requireRole('admin', 'reviewer'));

const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().min(5, 'Review note must be at least 5 characters long')
});

// GET /api/review/queue - transfers waiting for a human decision
reviewRouter.get('/queue', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json(await getReviewQueue(limit, offset));
  } catch (err) {
    next(err);
  }
});

// POST /api/review/:transferId - approve or reject a held transfer
reviewRouter.post('/:transferId', async (req, res, next) => {
  try {
    const { decision, reviewNote } = parseBody(reviewSchema, req.body, 'review');
    const result = await reviewTransfer({
      transferId: req.params.transferId,
      reviewerId: req.user.id,
      decision,
      reviewNote
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
