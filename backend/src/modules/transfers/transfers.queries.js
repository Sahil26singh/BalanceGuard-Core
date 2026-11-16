import { assertValidTransition } from './transfers.states.js';

// Source and destination account details, shared by the list and detail queries
export const PARTY_COLUMNS = `
  sa.user_id AS source_user_id, sa.account_type AS source_account_type, su.email AS source_user_email,
  da.user_id AS destination_user_id, da.account_type AS destination_account_type, du.email AS destination_user_email`;

export const PARTY_JOINS = `
  JOIN accounts sa ON t.source_account_id = sa.id
  LEFT JOIN users su ON sa.user_id = su.id
  JOIN accounts da ON t.destination_account_id = da.id
  LEFT JOIN users du ON da.user_id = du.id`;

/** Insert a transfer row. Used by transfers, refunds and webhook top-ups. */
export async function createTransfer(client, t) {
  const { rows } = await client.query(
    `INSERT INTO transfers (
       idempotency_key, source_account_id, destination_account_id, amount, currency,
       transfer_type, status, parent_transfer_id, failure_reason, actor_id
     )
     VALUES ($1, $2, $3, $4, 'INR', $5, $6, $7, $8, $9)
     RETURNING *;`,
    [t.key, t.sourceAccountId, t.destinationAccountId, t.amount.toString(), t.type, t.status, t.parentTransferId ?? null, t.reason ?? null, t.actorId ?? null]
  );
  return rows[0];
}

/** Move a transfer to a new status (the state machine decides if that is allowed). */
export async function changeTransferStatus(client, transferId, from, to, reason = null) {
  assertValidTransition(from, to);
  const { rows } = await client.query(
    `UPDATE transfers
     SET status = $1, failure_reason = COALESCE($2, failure_reason), updated_at = NOW()
     WHERE id = $3
     RETURNING *;`,
    [to, reason, transferId]
  );
  return rows[0];
}
