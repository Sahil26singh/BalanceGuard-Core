import { query, withTransaction } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';
import { enqueueWebhookJob } from '../../jobs/queue.js';
import { postLedgerEntries } from '../ledger/ledger.service.js';
import { recordAuditEvent } from '../audit/audit.service.js';
import { getSystemAccountId } from '../accounts/accounts.service.js';
import { createTransfer, changeTransferStatus } from '../transfers/transfers.queries.js';
import { reverseTransfer } from '../refunds/refunds.service.js';
import { topupIdempotencyKey } from '../gateway/gateway.service.js';
import { STATUS } from '../transfers/transfers.states.js';

const MAX_ATTEMPTS = 3;

/**
 * Save a webhook, then queue it. The unique provider_event_id means a webhook the
 * provider sends twice is stored only once.
 * Implements Transactional Outbox pattern: if Redis enqueue fails, next_retry_at is scheduled
 * and the outbox recovery worker processes it from PostgreSQL.
 */
export async function recordWebhookEvent({ providerEventId, eventType, payload }) {
  const { rows } = await query(
    `INSERT INTO webhook_events (provider_event_id, event_type, payload, status, next_retry_at)
     VALUES ($1, $2, $3, 'RECEIVED', NOW())
     ON CONFLICT (provider_event_id) DO NOTHING
     RETURNING id, provider_event_id, event_type, status, created_at;`,
    [providerEventId, eventType, JSON.stringify(payload)]
  );

  if (rows.length === 0) {
    logger.info({ providerEventId }, 'Duplicate webhook ignored');
    return { isDuplicate: true };
  }

  // Fast-path enqueue to BullMQ. If Redis is unavailable, outbox processor will dispatch.
  try {
    await enqueueWebhookJob({ webhookEventId: rows[0].id, providerEventId });
  } catch (err) {
    logger.warn({ err: err.message, providerEventId }, 'Fast-path webhook queueing failed; outbox worker will dispatch');
  }

  return { isDuplicate: false, event: rows[0] };
}

// One handler per event type. Each runs inside the webhook's database transaction
// and strictly validates provider payment state machines before state transitions.
const handlers = {
  async TOPUP_SUCCEEDED(client, { data, providerEventId }) {
    const { customerWalletId, amount, providerPaymentId } = data;
    if (!providerPaymentId) {
      throw new Error('Top-up rejected: missing providerPaymentId in webhook payload');
    }

    let validAmount;
    try {
      validAmount = BigInt(amount);
      if (validAmount <= 0n) throw new Error();
    } catch {
      throw new Error(`Top-up rejected: invalid amount in webhook payload: '${amount}'`);
    }

    // Defense-in-depth: verify against gateway_payments to ensure this top-up was legitimately initiated
    const { rows } = await client.query(
      'SELECT * FROM gateway_payments WHERE provider_payment_id = $1 FOR UPDATE;',
      [providerPaymentId]
    );
    const payment = rows[0];
    if (!payment) {
      throw new Error(`Top-up rejected: no gateway payment record found for '${providerPaymentId}'`);
    }
    if (payment.customer_wallet_id !== customerWalletId || BigInt(payment.amount) !== validAmount) {
      throw new Error('Top-up rejected: payload parameters do not match recorded gateway payment');
    }

    // Payment state validation: cannot settle an already settled or non-pending payment
    if (payment.status === 'SETTLED') {
      logger.info({ providerPaymentId }, 'Top-up payment is already settled; duplicate confirmation ignored');
      return 'ALREADY_SETTLED';
    }
    if (payment.status !== 'PENDING') {
      throw new Error(`Top-up rejected: payment is in invalid status '${payment.status}'`);
    }

    const settlementAccountId = await getSystemAccountId(client, 'PROVIDER_SETTLEMENT');

    const transfer = await createTransfer(client, {
      key: topupIdempotencyKey(providerPaymentId || providerEventId),
      sourceAccountId: settlementAccountId,
      destinationAccountId: customerWalletId,
      amount: validAmount,
      type: 'TOPUP',
      status: STATUS.PENDING
    });

    await postLedgerEntries(client, {
      transferId: transfer.id,
      sourceAccountId: settlementAccountId,
      destinationAccountId: customerWalletId,
      amount: validAmount
    });
    await changeTransferStatus(client, transfer.id, STATUS.PENDING, STATUS.COMPLETED);

    // Transition payment state from PENDING to terminal SETTLED
    await client.query(
      "UPDATE gateway_payments SET transfer_id = $1, status = 'SETTLED' WHERE provider_payment_id = $2;",
      [transfer.id, providerPaymentId]
    );

    await recordAuditEvent(client, {
      entityType: 'TOPUP',
      entityId: transfer.id,
      action: 'TOPUP_CONFIRMED',
      metadata: { providerEventId, customerWalletId, amount: String(amount), providerPaymentId }
    });
    return 'WALLET_CREDITED';
  },

  async PAYOUT_SUCCEEDED(client, { data, providerEventId }) {
    const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE;', [data.transferId]);
    const payout = rows[0];
    if (!payout) {
      throw new Error(`Payout transfer '${data.transferId}' not found`);
    }

    // Idempotent completion check
    if (payout.status === STATUS.COMPLETED) {
      return 'ALREADY_COMPLETED';
    }

    // State transition guard: payout cannot complete if already reversed or failed
    if (payout.status === STATUS.REVERSED || payout.status === STATUS.FAILED) {
      logger.warn({ transferId: data.transferId, currentStatus: payout.status }, 'Payout cannot settle: already failed/reversed');
      return 'IGNORED_INVALID_STATE';
    }

    if (payout.status !== STATUS.PENDING_PROVIDER) {
      throw new Error(`Payout transfer '${data.transferId}' is in unexpected status '${payout.status}'`);
    }

    // The money waiting in clearing is now settled with the provider
    const settlementAccountId = await getSystemAccountId(client, 'PROVIDER_SETTLEMENT');
    await postLedgerEntries(client, {
      transferId: payout.id,
      sourceAccountId: payout.destination_account_id, // PLATFORM_CLEARING
      destinationAccountId: settlementAccountId,
      amount: BigInt(payout.amount)
    });
    await changeTransferStatus(client, payout.id, STATUS.PENDING_PROVIDER, STATUS.COMPLETED);

    await client.query("UPDATE gateway_payments SET status = 'SETTLED' WHERE transfer_id = $1;", [payout.id]);

    await recordAuditEvent(client, {
      entityType: 'PAYOUT',
      entityId: payout.id,
      action: 'PAYOUT_SETTLED',
      metadata: { providerEventId }
    });
    return 'PAYOUT_SETTLED';
  },

  async PAYOUT_FAILED(client, { data }) {
    const { rows } = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE;', [data.transferId]);
    const payout = rows[0];
    if (!payout) {
      throw new Error(`Payout transfer '${data.transferId}' not found`);
    }

    // Idempotent reversal check
    if (payout.status === STATUS.REVERSED) {
      return 'ALREADY_REVERSED';
    }

    // State transition guard: cannot reverse an already settled payout
    if (payout.status === STATUS.COMPLETED) {
      logger.warn({ transferId: data.transferId }, 'Settled payout cannot be reversed by late failure event');
      return 'IGNORED_ALREADY_COMPLETED';
    }

    if (payout.status !== STATUS.PENDING_PROVIDER && payout.status !== STATUS.FAILED) {
      throw new Error(`Payout transfer '${data.transferId}' is in unexpected status '${payout.status}'`);
    }

    await reverseTransfer(client, {
      transferId: data.transferId,
      reason: data.failureReason || 'The provider reported that the payout failed'
    });

    await client.query("UPDATE gateway_payments SET status = 'FAILED' WHERE transfer_id = $1;", [payout.id]);

    return 'PAYOUT_REVERSED_TO_WALLET';
  }
};

/**
 * Process one stored webhook (called by the background worker or outbox recovery).
 * Everything happens in one transaction, so the webhook is marked PROCESSED only if
 * the money movement it caused was committed too.
 */
export async function processWebhookEvent(webhookEventId) {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM webhook_events WHERE id = $1 FOR UPDATE;', [webhookEventId]);
      const event = rows[0];
      if (!event) throw new Error(`Webhook event '${webhookEventId}' not found`);

      if (event.status === 'PROCESSED') {
        return { processed: true, actionTaken: 'ALREADY_PROCESSED' };
      }

      const handler = handlers[event.event_type];
      const actionTaken = handler
        ? await handler(client, { data: event.payload.data || {}, providerEventId: event.provider_event_id })
        : 'NONE';

      await client.query(
        "UPDATE webhook_events SET status = 'PROCESSED', processed_at = NOW(), updated_at = NOW() WHERE id = $1;",
        [webhookEventId]
      );
      logger.info({ webhookEventId, actionTaken }, 'Webhook processed');
      return { processed: true, actionTaken };
    });
  } catch (err) {
    logger.error({ webhookEventId, err: err.message }, 'Webhook processing failed');
    await markAttemptFailed(webhookEventId, err.message);
    throw err; // BullMQ retries the job
  }
}

/**
 * Records attempt failure with exponential retry backoff and alerts if moved to DEAD status.
 */
async function markAttemptFailed(webhookEventId, message) {
  try {
    const { rows } = await query(
      'SELECT attempts, provider_event_id, event_type FROM webhook_events WHERE id = $1;',
      [webhookEventId]
    );
    if (!rows[0]) return;

    const newAttempts = rows[0].attempts + 1;
    const isDead = newAttempts >= MAX_ATTEMPTS;
    // Exponential backoff: 5s, 15s, 45s...
    const backoffSeconds = Math.pow(3, newAttempts) * 5;

    await query(
      `UPDATE webhook_events
       SET attempts = $1,
           last_error = $2,
           status = CASE WHEN $3 THEN 'DEAD' ELSE status END,
           next_retry_at = CASE WHEN $3 THEN NULL ELSE NOW() + INTERVAL '1 second' * $4 END,
           updated_at = NOW()
       WHERE id = $5;`,
      [newAttempts, message, isDead, backoffSeconds, webhookEventId]
    );

    if (isDead) {
      logger.error(
        {
          webhookEventId,
          providerEventId: rows[0].provider_event_id,
          eventType: rows[0].event_type,
          attempts: newAttempts,
          lastError: message
        },
        'CRITICAL WEBHOOK ALERT: Webhook moved to DEAD status after maximum attempts. Manual intervention required.'
      );

      await recordAuditEvent(null, {
        entityType: 'WEBHOOK',
        entityId: webhookEventId,
        action: 'WEBHOOK_DEAD_LETTER',
        actorId: null,
        actorRole: 'system',
        metadata: {
          providerEventId: rows[0].provider_event_id,
          eventType: rows[0].event_type,
          attempts: newAttempts,
          error: message
        }
      });
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Could not record webhook failure');
  }
}

/**
 * Transactional Outbox Worker:
 * Reads due 'RECEIVED' webhooks and processes them directly, guaranteeing complete recovery even if Redis was down.
 */
export async function processOutboxWebhooks(limit = 10) {
  const { rows } = await query(
    `SELECT id FROM webhook_events
     WHERE status = 'RECEIVED'
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at ASC
     LIMIT $1;`,
    [limit]
  );

  let processedCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    try {
      await processWebhookEvent(row.id);
      processedCount++;
    } catch (err) {
      errorCount++;
      logger.warn({ id: row.id, err: err.message }, 'Outbox webhook processing attempt failed');
    }
  }

  return { processedCount, errorCount };
}

/**
 * Manual Dead-Letter Replay:
 * Allows an authorized administrator to inspect and re-trigger a failed DEAD webhook.
 */
export async function replayDeadWebhook(webhookEventId, { actorId = null, actorRole = null } = {}) {
  const { rows } = await query(
    `UPDATE webhook_events
     SET status = 'RECEIVED',
         attempts = 0,
         last_error = NULL,
         next_retry_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'DEAD'
     RETURNING id, provider_event_id, event_type, status;`,
    [webhookEventId]
  );

  const event = rows[0];
  if (!event) {
    throw new AppError(404, 'WEBHOOK_NOT_DEAD', `Webhook '${webhookEventId}' not found or is not in DEAD status`);
  }

  await recordAuditEvent(null, {
    entityType: 'WEBHOOK',
    entityId: event.id,
    action: 'WEBHOOK_DEAD_LETTER_REPLAY',
    actorId,
    actorRole,
    metadata: { providerEventId: event.provider_event_id, eventType: event.event_type }
  });

  try {
    await enqueueWebhookJob({ webhookEventId: event.id, providerEventId: event.provider_event_id });
  } catch (err) {
    logger.warn({ err: err.message, webhookEventId: event.id }, 'Replay enqueue failed; outbox poller will process');
  }

  return event;
}
