import { query, withTransaction } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';
import { postLedgerEntries } from '../ledger/ledger.service.js';
import { recordAuditEvent } from '../audit/audit.service.js';
import { changeTransferStatus, PARTY_COLUMNS, PARTY_JOINS } from '../transfers/transfers.queries.js';
import { STATUS } from '../transfers/transfers.states.js';

/**
 * Human review of transfers the risk engine flagged.
 * Only people decide here: the risk module only scores, it never touches money.
 */

export async function getReviewQueue(limit = 50, offset = 0) {
  const count = await query("SELECT COUNT(*) AS total FROM transfers WHERE status = 'HELD_FOR_REVIEW';");

  const { rows } = await query(
    `SELECT t.id, t.idempotency_key, t.source_account_id, t.destination_account_id,
            t.amount, t.currency, t.status, t.created_at,
            ${PARTY_COLUMNS},
            ra.id AS risk_assessment_id, ra.score AS risk_score, ra.decision AS risk_decision,
            ra.signals AS risk_signals, ra.signals_incomplete,
            ra.explanation AS risk_explanation, ra.explanation_source
     FROM transfers t ${PARTY_JOINS}
     LEFT JOIN risk_assessments ra ON ra.transfer_id = t.id
     WHERE t.status = 'HELD_FOR_REVIEW'
     ORDER BY t.created_at DESC
     LIMIT $1 OFFSET $2;`,
    [limit, offset]
  );

  return { queue: rows, total: Number(count.rows[0].total) };
}

/**
 * Approve or reject a held transfer.
 *  APPROVED -> the ledger entries are posted now and the transfer is COMPLETED
 *  REJECTED -> no money ever moves and the transfer is REJECTED
 */
export async function reviewTransfer({ transferId, reviewerId, decision, reviewNote }) {
  const note = reviewNote?.trim();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    throw new AppError(400, 'INVALID_REVIEW_DECISION', "Decision must be 'APPROVED' or 'REJECTED'");
  }
  if (!note) {
    throw new AppError(400, 'MISSING_REVIEW_NOTE', 'A review note is required');
  }

  return withTransaction(async (client) => {
    const found = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE;', [transferId]);
    const transfer = found.rows[0];
    if (!transfer) {
      throw new AppError(404, 'TRANSFER_NOT_FOUND', `Transfer '${transferId}' was not found`);
    }
    if (transfer.status !== STATUS.HELD_FOR_REVIEW) {
      throw new AppError(400, 'INVALID_TRANSFER_STATUS', `Only HELD_FOR_REVIEW transfers can be reviewed (this one is ${transfer.status})`);
    }

    // Separation of duties: Reviewers are strictly forbidden from reviewing transfers they initiated, own, or receive
    const sourceAccRes = await client.query('SELECT user_id FROM accounts WHERE id = $1;', [transfer.source_account_id]);
    const destAccRes = await client.query('SELECT user_id FROM accounts WHERE id = $1;', [transfer.destination_account_id]);
    const sourceOwnerId = sourceAccRes.rows[0]?.user_id;
    const destOwnerId = destAccRes.rows[0]?.user_id;

    if (
      (transfer.actor_id && reviewerId === transfer.actor_id) ||
      (sourceOwnerId && reviewerId === sourceOwnerId) ||
      (destOwnerId && reviewerId === destOwnerId)
    ) {
      throw new AppError(
        403,
        'SEPARATION_OF_DUTIES_VIOLATION',
        'Reviewers are strictly forbidden from approving or rejecting transfers they initiated, own, or receive'
      );
    }

    const assessment = await client.query('SELECT id, signals FROM risk_assessments WHERE transfer_id = $1;', [transferId]);
    const riskAssessmentId = assessment.rows[0]?.id;
    if (!riskAssessmentId) {
      throw new AppError(500, 'RISK_ASSESSMENT_MISSING', `No risk assessment found for transfer '${transferId}'`);
    }

    const { rows: [recordedDecision] } = await client.query(
      `INSERT INTO review_decisions (risk_assessment_id, transfer_id, reviewer_id, decision, review_note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [riskAssessmentId, transferId, reviewerId, decision, note]
    );

    let updatedTransfer;
    let entries = [];

    if (decision === 'APPROVED') {
      const { debitEntry, creditEntry } = await postLedgerEntries(client, {
        transferId,
        sourceAccountId: transfer.source_account_id,
        destinationAccountId: transfer.destination_account_id,
        amount: BigInt(transfer.amount),
        actorId: reviewerId,
        actorRole: 'reviewer'
      });
      entries = [debitEntry, creditEntry];
      updatedTransfer = await changeTransferStatus(client, transferId, STATUS.HELD_FOR_REVIEW, STATUS.COMPLETED);
    } else {
      updatedTransfer = await changeTransferStatus(client, transferId, STATUS.HELD_FOR_REVIEW, STATUS.REJECTED, note);
    }

    await recordAuditEvent(client, {
      entityType: 'TRANSFER',
      entityId: transferId,
      action: decision === 'APPROVED' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
      actorId: reviewerId,
      actorRole: 'reviewer',
      metadata: { reviewNote: note, riskAssessmentId }
    });

    logger.info({ transferId, reviewerId, decision }, 'Held transfer reviewed');
    return { transfer: updatedTransfer, decision: recordedDecision, entries };
  });
}
