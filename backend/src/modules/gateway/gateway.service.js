import crypto from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { query, withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { claimOrReplay, resolveIdempotencyKey } from '../idempotency/idempotency.service.js';

/**
 * A simulated payment gateway that stands in for a real provider such as Razorpay.
 * It runs inside this server but behaves like an outside system:
 *  - it keeps its own records (gateway_payments table)
 *  - it tells us about results with signed webhooks, which our webhook endpoint verifies
 *  - it produces a settlement report that reconciliation compares with our ledger
 */

// The gateway calls our own webhook endpoint over HTTP, exactly like a real provider would
const WEBHOOK_URL = `http://127.0.0.1:${env.PORT}/api/webhooks/provider`;

/** The idempotency key we give the transfer that a top-up webhook creates. */
export const topupIdempotencyKey = (providerPaymentId) => `webhook-topup-${providerPaymentId}`;

const newId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

async function sendSignedWebhook(payload) {
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', env.WEBHOOK_SIGNING_SECRET).update(rawBody).digest('hex');

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Signature': `sha256=${signature}`,
        'X-Provider-Event-Id': payload.eventId
      },
      body: rawBody
    });
    if (!res.ok) logger.warn({ status: res.status, eventId: payload.eventId }, 'Webhook was not accepted');
  } catch (err) {
    logger.warn({ err: err.message, eventId: payload.eventId }, 'Webhook delivery failed');
  }
}

// Real providers answer first and call the webhook a moment later
const sendWebhookSoon = (payload) => setTimeout(() => sendSignedWebhook(payload), 100);

/** A customer pays in. The wallet is only credited when the webhook arrives. Requires idempotency. */
export async function startTopup({ idempotency, customerWalletId, amount }) {
  if (!idempotency) {
    throw new AppError(400, 'Idempotency-Key header is required for top-ups');
  }

  const { scope, key } = idempotency;
  let pendingWebhook = null;

  const result = await withTransaction(async (client) => {
    const replay = await claimOrReplay(client, idempotency);
    if (replay) return { ...replay, created: false };

    // Deduplicate against gateway_payments in case key already recorded
    const existing = await client.query(
      'SELECT provider_payment_id, amount, status FROM gateway_payments WHERE idempotency_key = $1;',
      [key]
    );
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      const body = {
        status: 'PENDING_PROVIDER',
        message: 'Top-up already initiated. The wallet is credited once the provider confirms with a webhook.',
        providerData: {
          status: 'PENDING_WEBHOOK',
          providerPaymentId: row.provider_payment_id,
          amount: row.amount.toString(),
          message: 'Top-up already initiated.'
        }
      };
      await resolveIdempotencyKey(client, { scope, key, statusCode: 200, responseBody: body });
      return { statusCode: 200, body, created: false };
    }

    const providerPaymentId = newId('pay_mock');
    const eventId = newId('evt_topup');

    await client.query(
      "INSERT INTO gateway_payments (provider_payment_id, idempotency_key, customer_wallet_id, amount, status) VALUES ($1, $2, $3, $4, 'PENDING');",
      [providerPaymentId, key, customerWalletId, amount]
    );

    const providerData = {
      status: 'PENDING_WEBHOOK',
      providerPaymentId,
      eventId,
      amount: amount.toString(),
      message: 'Top-up started. A webhook will confirm the payment.'
    };

    const body = {
      status: 'PENDING_PROVIDER',
      message: 'Top-up started. The wallet is credited once the provider confirms with a webhook.',
      providerData
    };

    await resolveIdempotencyKey(client, { scope, key, statusCode: 200, responseBody: body });

    pendingWebhook = {
      eventId,
      eventType: 'TOPUP_SUCCEEDED',
      timestamp: new Date().toISOString(),
      data: { providerPaymentId, customerWalletId, amount, currency: 'INR' }
    };

    return { statusCode: 200, body, created: true };
  });

  // Send webhook ONLY after the transaction commits successfully
  if (result.created && pendingWebhook) {
    sendWebhookSoon(pendingWebhook);
  }

  return result;
}

/**
 * Process pending payouts from the transactional outbox using FOR UPDATE SKIP LOCKED.
 * Dispatches payouts to the payment gateway and triggers webhooks reliably.
 */
export async function processPayoutOutbox(batchSize = 10) {
  const webhooksToSend = [];

  const count = await withTransaction(async (client) => {
    const { rows: entries } = await client.query(
      `SELECT id, transfer_id, customer_wallet_id, amount, should_fail, attempts
       FROM payout_outbox
       WHERE status IN ('PENDING', 'PROCESSING')
         AND next_retry_at <= NOW()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED;`,
      [batchSize]
    );

    if (entries.length === 0) return 0;

    for (const entry of entries) {
      try {
        const providerPaymentId = newId('payout_mock');
        const eventId = newId('evt_payout');

        if (!entry.should_fail) {
          await client.query(
            "INSERT INTO gateway_payments (provider_payment_id, transfer_id, customer_wallet_id, amount, status) VALUES ($1, $2, $3, $4, 'PENDING');",
            [providerPaymentId, entry.transfer_id, entry.customer_wallet_id, entry.amount]
          );
        }

        await client.query(
          `UPDATE payout_outbox
           SET status = 'DISPATCHED', dispatched_at = NOW(), updated_at = NOW(), attempts = attempts + 1
           WHERE id = $1;`,
          [entry.id]
        );

        webhooksToSend.push({
          eventId,
          eventType: entry.should_fail ? 'PAYOUT_FAILED' : 'PAYOUT_SUCCEEDED',
          timestamp: new Date().toISOString(),
          data: {
            providerPaymentId,
            transferId: entry.transfer_id,
            customerWalletId: entry.customer_wallet_id,
            amount: entry.amount.toString(),
            currency: 'INR',
            ...(entry.should_fail && { failureReason: 'Bank rejected the payout: invalid account number' })
          }
        });

        logger.info({ outboxId: entry.id, transferId: entry.transfer_id }, 'Payout dispatched from transactional outbox');
      } catch (err) {
        const nextAttempts = entry.attempts + 1;
        const delaySeconds = Math.min(300, 5 * Math.pow(2, nextAttempts));
        const isDead = nextAttempts >= 5;

        await client.query(
          `UPDATE payout_outbox
           SET status = $1, attempts = $2, last_error = $3,
               next_retry_at = NOW() + ($4 || ' seconds')::INTERVAL,
               updated_at = NOW()
           WHERE id = $5;`,
          [isDead ? 'FAILED' : 'PENDING', nextAttempts, err.message, delaySeconds, entry.id]
        );

        logger.error({ outboxId: entry.id, err: err.message, attempts: nextAttempts, isDead }, 'Failed to dispatch payout from outbox');
      }
    }

    return entries.length;
  });

  // Send webhooks ONLY after the database transaction commits
  for (const webhook of webhooksToSend) {
    sendWebhookSoon(webhook);
  }

  return count;
}

/**
 * The provider's list of settled payments.
 * With simulateMismatches it also contains errors for reconciliation to find:
 * a wrong amount, a payment we have never heard of, and a duplicated row.
 */
export async function getSettlementReport({ simulateMismatches = false } = {}) {
  const { rows } = await query(
    'SELECT provider_payment_id, transfer_id, customer_wallet_id, amount, currency, status, created_at FROM gateway_payments ORDER BY created_at ASC;'
  );

  const records = rows.map((row) => ({
    providerPaymentId: row.provider_payment_id,
    transferId: row.transfer_id,
    customerWalletId: row.customer_wallet_id,
    amount: row.amount.toString(),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at
  }));

  if (simulateMismatches) {
    if (records.length > 0) {
      const last = records[records.length - 1];
      records[records.length - 1] = { ...last, amount: (BigInt(last.amount) + 100n).toString() }; // wrong amount
    }
    records.push({
      providerPaymentId: `ext_ghost_${Date.now()}`, // we never heard of this one
      transferId: null,
      amount: '4500',
      currency: 'INR',
      status: 'SETTLED',
      createdAt: new Date().toISOString()
    });
    records.push({ ...records[0] }); // same payment listed twice
  }

  return { generatedAt: new Date().toISOString(), recordCount: records.length, records };
}
