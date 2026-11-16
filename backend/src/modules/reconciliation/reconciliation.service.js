import { query } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { enqueueWebhookJob } from '../../jobs/queue.js';
import { getSettlementReport, topupIdempotencyKey } from '../gateway/gateway.service.js';

/**
 * Compare our transfers with the payment provider's settlement report and record every difference.
 * It only reports. It never changes a balance: money moves only through the ledger service.
 *
 *  MISSING_IN_INTERNAL  the provider has a payment we have no transfer for
 *  MISSING_IN_PROVIDER  we completed a transfer the provider does not list
 *  AMOUNT_MISMATCH      both sides know the payment but disagree on the amount
 *  DUPLICATE_EXTERNAL   the provider listed the same payment twice
 */
export async function runReconciliation({ simulateMismatches = false } = {}) {
  const { rows: [run] } = await query("INSERT INTO reconciliation_runs (status) VALUES ('RUNNING') RETURNING *;");
  logger.info({ runId: run.id, simulateMismatches }, 'Reconciliation started');

  try {
    const { records: external } = await getSettlementReport({ simulateMismatches });
    const { rows: internal } = await query(
      "SELECT id, idempotency_key, amount FROM transfers WHERE transfer_type IN ('TOPUP', 'PAYOUT');"
    );

    const byId = new Map(internal.map((t) => [t.id, t]));
    const byKey = new Map(internal.map((t) => [t.idempotency_key, t]));
    const seenPayments = new Set();
    const matchedIds = new Set();
    const discrepancies = [];
    let matchedCount = 0;

    const report = (type, fields) => discrepancies.push({ type, ...fields });

    for (const ext of external) {
      if (seenPayments.has(ext.providerPaymentId)) {
        report('DUPLICATE_EXTERNAL', { externalRef: ext.providerPaymentId, externalAmount: String(ext.amount), reason: 'The provider listed this payment twice' });
        continue;
      }
      seenPayments.add(ext.providerPaymentId);

      // Payouts carry our transfer id. Top-ups are found through the key we gave their transfer.
      const match = byId.get(ext.transferId) || byKey.get(topupIdempotencyKey(ext.providerPaymentId));

      if (!match) {
        report('MISSING_IN_INTERNAL', { externalRef: ext.providerPaymentId, externalAmount: String(ext.amount), reason: 'The provider has a payment with no matching transfer here' });
        continue;
      }

      matchedIds.add(match.id);

      if (BigInt(match.amount) !== BigInt(ext.amount)) {
        report('AMOUNT_MISMATCH', {
          transferId: match.id,
          externalRef: ext.providerPaymentId,
          internalAmount: String(match.amount),
          externalAmount: String(ext.amount),
          reason: `The provider and our ledger disagree on the amount: internal ${match.amount} vs external ${ext.amount}`
        });
      } else {
        matchedCount++;
      }
    }

    for (const transfer of internal) {
      if (!matchedIds.has(transfer.id)) {
        report('MISSING_IN_PROVIDER', { transferId: transfer.id, internalAmount: String(transfer.amount), reason: 'A completed transfer is missing from the provider report' });
      }
    }

    for (const d of discrepancies) {
      await query(
        `INSERT INTO reconciliation_discrepancies
           (run_id, transfer_id, external_reference_id, discrepancy_type, internal_amount, external_amount, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [run.id, d.transferId ?? null, d.externalRef ?? null, d.type, d.internalAmount ?? null, d.externalAmount ?? null, JSON.stringify({ reason: d.reason })]
      );
    }

    const countOf = (type) => discrepancies.filter((d) => d.type === type).length;
    const summary = {
      matchedCount,
      discrepancyCount: discrepancies.length,
      types: {
        missingInProvider: countOf('MISSING_IN_PROVIDER'),
        missingInInternal: countOf('MISSING_IN_INTERNAL'),
        amountMismatch: countOf('AMOUNT_MISMATCH'),
        duplicateExternal: countOf('DUPLICATE_EXTERNAL')
      }
    };

    const { rows: [completedRun] } = await query(
      `UPDATE reconciliation_runs
       SET status = 'COMPLETED', completed_at = NOW(), total_internal_transfers = $1,
           total_external_records = $2, matched_count = $3, discrepancy_count = $4, summary = $5
       WHERE id = $6
       RETURNING *;`,
      [internal.length, external.length, matchedCount, discrepancies.length, JSON.stringify(summary), run.id]
    );

    const { rows: saved } = await query('SELECT * FROM reconciliation_discrepancies WHERE run_id = $1 ORDER BY created_at ASC;', [run.id]);
    logger.info({ runId: run.id, matchedCount, discrepancyCount: discrepancies.length }, 'Reconciliation completed');
    return { run: completedRun, discrepancies: saved };
  } catch (err) {
    await query("UPDATE reconciliation_runs SET status = 'FAILED', completed_at = NOW() WHERE id = $1;", [run.id]);
    throw err;
  }
}

/** Queue webhooks that were saved but never processed (for example when Redis was down). */
export async function requeueStuckWebhooks(maxAgeMinutes = 5) {
  const { rows } = await query(
    `SELECT id, provider_event_id FROM webhook_events
     WHERE status = 'RECEIVED' AND created_at < NOW() - INTERVAL '1 minute' * $1
     ORDER BY created_at ASC
     LIMIT 50;`,
    [maxAgeMinutes]
  );

  let requeuedCount = 0;
  for (const event of rows) {
    const job = await enqueueWebhookJob({ webhookEventId: event.id, providerEventId: event.provider_event_id });
    if (job) requeuedCount++;
  }
  return { requeuedCount };
}

export async function listReconciliationRuns(limit = 20) {
  const { rows } = await query('SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT $1;', [limit]);
  return rows;
}

export async function getReconciliationRunDetails(runId) {
  const { rows } = await query('SELECT * FROM reconciliation_runs WHERE id = $1;', [runId]);
  if (rows.length === 0) return null;

  const discrepancies = await query(
    `SELECT rd.*, t.transfer_type, t.status AS transfer_status
     FROM reconciliation_discrepancies rd
     LEFT JOIN transfers t ON rd.transfer_id = t.id
     WHERE rd.run_id = $1
     ORDER BY rd.created_at ASC;`,
    [runId]
  );
  return { ...rows[0], discrepancies: discrepancies.rows };
}
