import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { getLedgerIntegrityReport } from './ledger.service.js';

export const ledgerRouter = Router();

ledgerRouter.use(requireAuth, requireRole('admin', 'reviewer'));

// GET /api/ledger/integrity - total debits must equal total credits, and every cached balance must match its entries
ledgerRouter.get('/integrity', async (req, res, next) => {
  try {
    res.json({ integrity: await getLedgerIntegrityReport() });
  } catch (err) {
    next(err);
  }
});
