import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { listAccounts, getAccountById, getAccountLedgerEntries } from './accounts.service.js';

export const accountsRouter = Router();

// All account routes require authentication
accountsRouter.use(requireAuth);

/**
 * GET /api/accounts
 * Lists accounts with balances and owner emails.
 */
accountsRouter.get('/', async (req, res, next) => {
  try {
    const { accountType, userId } = req.query;
    const accounts = await listAccounts({ accountType, userId });
    return res.status(200).json({ accounts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/accounts/:id
 * Retrieves single account summary.
 */
accountsRouter.get('/:id', async (req, res, next) => {
  try {
    const account = await getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: `Account with ID '${req.params.id}' was not found`
        }
      });
    }

    return res.status(200).json({ account });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/accounts/:id/entries
 * Returns ledger entry history for an account.
 */
accountsRouter.get('/:id/entries', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const entries = await getAccountLedgerEntries(req.params.id, limit);
    return res.status(200).json({ entries });
  } catch (err) {
    next(err);
  }
});

