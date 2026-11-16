import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { listAuditLogs } from './audit.service.js';

export const auditRouter = Router();

// Only authenticated admins and compliance reviewers can access the audit trail
auditRouter.use(requireAuth);
auditRouter.use(requireRole('admin', 'reviewer'));

/**
 * GET /api/audit
 * Returns immutable audit log sequence.
 */
auditRouter.get('/', async (req, res, next) => {
  try {
    const { entityType, entityId, action, actorId, limit, offset } = req.query;
    const result = await listAuditLogs({
      entityType,
      entityId,
      action,
      actorId,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

