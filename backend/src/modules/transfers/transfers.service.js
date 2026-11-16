import { query, withTransaction } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { postLedgerEntries } from '../ledger/ledger.service.js';
import { claimOrReplay, resolveIdempotencyKey } from '../idempotency/idempotency.service.js';
import { getSystemAccountId } from '../accounts/accounts.service.js';
import { templateExplanation } from '../risk/risk.explainer.js';
import { enqueueRiskExplainerJob } from '../../jobs/queue.js';
import { STATUS } from './transfers.states.js';
import { createTransfer, changeTransferStatus, PARTY_COLUMNS, PARTY_JOINS } from './transfers.queries.js';

// Customers may only send money to other customers. Moving money from or to the
// platform's own accounts is done by top-ups, payouts and refunds, never by this endpoint.
async function assertBothAreWallets(sourceAccountId, destinationAccountId) {
  const { rows } = await query(
    "SELECT COUNT(*) AS wallets FROM accounts WHERE id IN ($1, $2) AND account_type = 'USER_WALLET';",
    [sourceAccountId, destinationAccountId]
  );
  if (Number(rows[0].wallets) !== 2) {
    throw new AppError(400, 'WALLETS_ONLY', 'Transfers are only allowed between two existing customer wallets');
  }
}

/**
 * Create a wallet-to-wallet transfer. Safe to retry: the same idempotency key always
 * gives the same result and money moves at most once.
 *
 * - risk score >= HOLD_THRESHOLD: the transfer is saved as HELD_FOR_REVIEW, no money moves (202)
 * - otherwise: ONE database transaction claims the key, posts the ledger entries and
 *   stores the response (201)
 *
 * `created` is false when the answer is a replay of an earlier request.
 */
export async function executeTransfer({
  idempotency,
  sourceAccountId,
  destinationAccountId,
  amount,
  actorId = null,
  actorRole = null,
  riskScore = 0,
  riskSignals = {},
  riskReasons = [],
  signalsIncomplete = false
}) {
  await assertBothAreWallets(sourceAccountId, destinationAccountId);

  const { scope, key } = idempotency;
  const hold = riskScore >= env.HOLD_THRESHOLD;
  if (hold) {
    logger.warn({ key, riskScore, threshold: env.HOLD_THRESHOLD }, 'Transfer held for review');
  }

  const result = await withTransaction(async (client) => {
    const replay = await claimOrReplay(client, idempotency);
    if (replay) return { ...replay, created: false };

    const transfer = await createTransfer(client, {
      key,
      sourceAccountId,
      destinationAccountId,
      amount,
      type: 'INTERNAL_TRANSFER',
      status: hold ? STATUS.HELD_FOR_REVIEW : STATUS.PENDING,
      actorId
    });

    if (hold) {
      const explanation = templateExplanation(riskScore, riskReasons);
      const { rows } = await client.query(
        `INSERT INTO risk_assessments
           (transfer_id, score, decision, signals, signals_incomplete, explanation, explanation_source)
         VALUES ($1, $2, 'HOLD', $3, $4, $5, 'TEMPLATE_FALLBACK')
         RETURNING id;`,
        [transfer.id, riskScore, JSON.stringify(riskSignals), signalsIncomplete, explanation]
      );

      const body = {
        transfer,
        status: STATUS.HELD_FOR_REVIEW,
        riskScore,
        riskAssessmentId: rows[0].id,
        explanation,
        message: 'Transfer held for security review. No money has moved.'
      };
      await resolveIdempotencyKey(client, { scope, key, statusCode: 202, responseBody: body });
      return { statusCode: 202, body, created: true };
    }

    const { debitEntry, creditEntry } = await postLedgerEntries(client, {
      transferId: transfer.id,
      sourceAccountId,
      destinationAccountId,
      amount,
      actorId,
      actorRole
    });
    const completed = await changeTransferStatus(client, transfer.id, STATUS.PENDING, STATUS.COMPLETED);

    const body = { transfer: completed, entries: [debitEntry, creditEntry] };
    await resolveIdempotencyKey(client, { scope, key, statusCode: 201, responseBody: body });
    return { statusCode: 201, body, created: true };
  });

  // After the commit: ask for an AI explanation of the hold (a failure here is harmless)
  if (result.created && hold) {
    await enqueueRiskExplainerJob({
      riskAssessmentId: result.body.riskAssessmentId,
      score: riskScore,
      signals: riskSignals,
      reasons: riskReasons
    });
  }

  return result;
}

/**
 * Start a payout to a bank account. The customer's money moves to PLATFORM_CLEARING right
 * away and the transfer waits in PENDING_PROVIDER until the gateway's webhook confirms
 * it (or fails it, which reverses the money).
 */
export async function initiatePayout({ idempotency, sourceAccountId, amount, shouldFail = false, actorId = null, actorRole = null }) {
  const { scope, key } = idempotency;

  return withTransaction(async (client) => {
    const replay = await claimOrReplay(client, idempotency);
    if (replay) return { ...replay, created: false };

    const clearingAccountId = await getSystemAccountId(client, 'PLATFORM_CLEARING');
    const transfer = await createTransfer(client, {
      key,
      sourceAccountId,
      destinationAccountId: clearingAccountId,
      amount,
      type: 'PAYOUT',
      status: STATUS.PENDING_PROVIDER,
      actorId
    });

    const { debitEntry, creditEntry } = await postLedgerEntries(client, {
      transferId: transfer.id,
      sourceAccountId,
      destinationAccountId: clearingAccountId,
      amount,
      actorId,
      actorRole
    });

    // Write to payout_outbox inside the exact same database transaction
    await client.query(
      `INSERT INTO payout_outbox (transfer_id, customer_wallet_id, amount, should_fail, status)
       VALUES ($1, $2, $3, $4, 'PENDING');`,
      [transfer.id, sourceAccountId, amount, shouldFail]
    );

    const body = {
      transfer,
      status: STATUS.PENDING_PROVIDER,
      message: 'Payout started. The money is held in platform clearing until the provider confirms.',
      entries: [debitEntry, creditEntry]
    };
    await resolveIdempotencyKey(client, { scope, key, statusCode: 201, responseBody: body });
    return { statusCode: 201, body, created: true };
  });
}

export async function getTransferById(id) {
  const { rows } = await query(
    `SELECT t.*, ${PARTY_COLUMNS} FROM transfers t ${PARTY_JOINS} WHERE t.id = $1;`,
    [id]
  );
  if (rows.length === 0) return null;

  const transfer = rows[0];
  const entries = await query(
    `SELECT id, account_id, entry_type, amount, balance_after, created_at
     FROM ledger_entries WHERE transfer_id = $1 ORDER BY id ASC;`,
    [id]
  );
  transfer.entries = entries.rows;
  return transfer;
}

export async function listTransfers({ status, accountId, limit = 50, offset = 0 } = {}) {
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (accountId) {
    params.push(accountId);
    conditions.push(`(t.source_account_id = $${params.length} OR t.destination_account_id = $${params.length})`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const count = await query(`SELECT COUNT(*) AS total FROM transfers t ${where};`, params);

  params.push(Math.min(limit || 50, 100), offset || 0);
  const { rows } = await query(
    `SELECT t.id, t.idempotency_key, t.source_account_id, t.destination_account_id,
            t.amount, t.currency, t.transfer_type, t.status, t.created_at, t.updated_at,
            ${PARTY_COLUMNS}
     FROM transfers t ${PARTY_JOINS}
     ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params
  );

  return { transfers: rows, total: Number(count.rows[0].total) };
}
