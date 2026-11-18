import { withTransaction } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';
import { postLedgerEntries, lockAccounts } from '../ledger/ledger.service.js';
import { claimOrReplay, resolveIdempotencyKey } from '../idempotency/idempotency.service.js';
import { recordAuditEvent } from '../audit/audit.service.js';
import { createTransfer, changeTransferStatus } from '../transfers/transfers.queries.js';
import { STATUS } from '../transfers/transfers.states.js';

async function lockTransfer(client, transferId, notFoundCode) {
  const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE;', [transferId]);
  if (rows.length === 0) {
    throw new AppError(404, notFoundCode, `Transfer '${transferId}' was not found`);
  }
  return rows[0];
}

/**
 * Refund all or part of a completed transfer by posting NEW reversing entries.
 * The original entries are never touched. The total refunded can never exceed the original amount.
 */
export async function executeRefund({
  idempotency,
  parentTransferId,
  amount,
  reason = 'Customer refund',
  actorId = null,
  actorRole = null
}) {
  const refundAmount = BigInt(amount);
  const scope = idempotency.scope || 'refunds';
  const { key } = idempotency;

  if (refundAmount <= 0n) {
    throw new AppError(400, 'INVALID_REFUND_AMOUNT', 'Refund amount must be a positive whole number of paise');
  }

  const result = await withTransaction(async (client) => {
    const replay = await claimOrReplay(client, { ...idempotency, scope });
    if (replay) return replay;

    const parent = await lockTransfer(client, parentTransferId, 'PARENT_TRANSFER_NOT_FOUND');

    if (parent.status !== STATUS.COMPLETED && parent.status !== STATUS.PARTIALLY_REFUNDED) {
      throw new AppError(400, 'TRANSFER_NOT_REFUNDABLE', `Cannot refund a transfer in status '${parent.status}'`);
    }

    if (parent.transfer_type !== 'INTERNAL_TRANSFER') {
      throw new AppError(
        400,
        'TRANSFER_NOT_REFUNDABLE',
        `Only completed wallet-to-wallet transfers (INTERNAL_TRANSFER) can be refunded via this endpoint (transfer type is '${parent.transfer_type}')`
      );
    }

    const { rows } = await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS refunded FROM transfers WHERE parent_transfer_id = $1 AND status = 'COMPLETED';",
      [parentTransferId]
    );
    const originalAmount = BigInt(parent.amount);
    const alreadyRefunded = BigInt(rows[0].refunded);
    const totalRefunded = alreadyRefunded + refundAmount;

    if (totalRefunded > originalAmount) {
      throw new AppError(
        400,
        'REFUND_EXCEEDS_ORIGINAL',
        `Refund of ${refundAmount} paise is more than the ${originalAmount - alreadyRefunded} paise still refundable`
      );
    }

    const newParentStatus = totalRefunded === originalAmount ? STATUS.REFUNDED : STATUS.PARTIALLY_REFUNDED;

    // Lock accounts in ascending ID order before creating the transfer to avoid foreign-key lock conflicts
    const lockedRows = await lockAccounts(client, [parent.destination_account_id, parent.source_account_id]);

    // The refund moves money back the other way: recipient -> original sender
    const refund = await createTransfer(client, {
      key,
      sourceAccountId: parent.destination_account_id,
      destinationAccountId: parent.source_account_id,
      amount: refundAmount,
      type: 'REFUND',
      status: STATUS.PENDING,
      parentTransferId: parent.id,
      reason,
      actorId
    });

    const { debitEntry, creditEntry } = await postLedgerEntries(client, {
      transferId: refund.id,
      sourceAccountId: parent.destination_account_id,
      destinationAccountId: parent.source_account_id,
      amount: refundAmount,
      actorId,
      actorRole,
      lockedRows
    });

    const completedRefund = await changeTransferStatus(client, refund.id, STATUS.PENDING, STATUS.COMPLETED);
    await changeTransferStatus(client, parent.id, parent.status, newParentStatus);

    await recordAuditEvent(client, {
      entityType: 'REFUND',
      entityId: refund.id,
      action: newParentStatus === STATUS.REFUNDED ? 'FULL_REFUND' : 'PARTIAL_REFUND',
      actorId,
      actorRole,
      metadata: {
        parentTransferId,
        refundAmount: refundAmount.toString(),
        totalRefundedNow: totalRefunded.toString(),
        originalAmount: originalAmount.toString(),
        reason
      }
    });

    const body = {
      refund: completedRefund,
      parentTransfer: {
        id: parent.id,
        status: newParentStatus,
        originalAmount: originalAmount.toString(),
        totalRefunded: totalRefunded.toString(),
        remainingRefundable: (originalAmount - totalRefunded).toString()
      },
      entries: [debitEntry, creditEntry]
    };
    await resolveIdempotencyKey(client, { scope, key, statusCode: 201, responseBody: body });
    return { statusCode: 201, body };
  });

  logger.info({ parentTransferId, amount: refundAmount.toString() }, 'Refund processed');
  return result;
}

/**
 * Undo a payout that the provider rejected: post the opposite entries and mark the
 * transfer REVERSED. Pass the client of a running transaction, so the reversal and
 * the caller's other changes commit (or roll back) together.
 */
export async function reverseTransfer(client, { transferId, reason, actorId = null, actorRole = null }) {
  const transfer = await lockTransfer(client, transferId, 'TRANSFER_NOT_FOUND');

  if (transfer.status !== STATUS.PENDING_PROVIDER && transfer.status !== STATUS.FAILED) {
    throw new AppError(400, 'INVALID_STATE_FOR_REVERSAL', `Cannot reverse a transfer in status '${transfer.status}'`);
  }

  const { debitEntry, creditEntry } = await postLedgerEntries(client, {
    transferId: transfer.id,
    sourceAccountId: transfer.destination_account_id,
    destinationAccountId: transfer.source_account_id,
    amount: BigInt(transfer.amount),
    actorId,
    actorRole
  });

  const reversed = await changeTransferStatus(client, transfer.id, transfer.status, STATUS.REVERSED, reason);

  await recordAuditEvent(client, {
    entityType: 'TRANSFER',
    entityId: transfer.id,
    action: 'PAYOUT_REVERSED',
    actorId,
    actorRole,
    metadata: { reason, amount: transfer.amount }
  });

  logger.info({ transferId, reason }, 'Transfer reversed');
  return { transfer: reversed, entries: [debitEntry, creditEntry] };
}
