import { Router } from 'express';
import crypto from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { query } from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { recordWebhookEvent, replayDeadWebhook } from './webhooks.service.js';

export const webhooksRouter = Router();

/** The provider signs the raw request body with HMAC-SHA256 and a secret we share with it. */
function hasValidSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !rawBody) return false;

  const received = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
  const expected = crypto.createHmac('sha256', env.WEBHOOK_SIGNING_SECRET).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

// POST /api/webhooks/provider - verify, save, queue and answer quickly
webhooksRouter.post('/provider', async (req, res, next) => {
  try {
    const providerEventId = req.headers['x-provider-event-id'] || req.body?.eventId;
    if (!providerEventId) {
      return res.status(400).json({ error: { code: 'MISSING_EVENT_ID', message: "An event id is required in the 'X-Provider-Event-Id' header or the 'eventId' field" } });
    }

    if (!hasValidSignature(req.rawBody, req.headers['x-provider-signature'])) {
      logger.warn({ providerEventId }, 'Webhook signature check failed');
      return res.status(401).json({ error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'The webhook signature could not be verified' } });
    }

    const { isDuplicate, event } = await recordWebhookEvent({
      providerEventId,
      eventType: req.body.eventType || 'UNKNOWN',
      payload: req.body
    });

    if (isDuplicate) {
      return res.json({ status: 'IGNORED_DUPLICATE', message: 'This webhook was already received' });
    }
    res.json({ status: 'ACCEPTED', eventId: event.id, providerEventId });
  } catch (err) {
    next(err);
  }
});

// GET /api/webhooks/dead-letter - inspect permanently failed webhooks (staff only)
webhooksRouter.get('/dead-letter', requireAuth, requireRole('admin', 'reviewer'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, provider_event_id, event_type, attempts, last_error, payload, created_at, updated_at
       FROM webhook_events
       WHERE status = 'DEAD'
       ORDER BY updated_at DESC
       LIMIT 50;`
    );
    res.json({ deadWebhooks: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/webhooks/dead-letter/:id/replay - manual replay of dead-letter webhook (admin only)
webhooksRouter.post('/dead-letter/:id/replay', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const replayed = await replayDeadWebhook(req.params.id, {
      actorId: req.user.id,
      actorRole: req.user.role
    });
    res.json({
      success: true,
      message: 'Dead-letter webhook re-queued for processing',
      event: replayed
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/webhooks/simulate-duplicate - Demo Lab helper: safe duplicate replay of an existing event
// Only permitted for admins when DEMO_MODE is true. Re-sends the most recent stored webhook event without accepting any client payload.
webhooksRouter.post('/simulate-duplicate', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!env.DEMO_MODE) {
      throw new AppError(404, 'ROUTE_NOT_FOUND', 'Cannot POST /api/webhooks/simulate-duplicate');
    }

    // Strictly re-sends an event already stored in the database; accepts no client body or parameters
    const { rows } = await query(
      `SELECT provider_event_id, event_type, payload
       FROM webhook_events
       ORDER BY created_at DESC
       LIMIT 1;`
    );

    if (rows.length === 0) {
      throw new AppError(
        400,
        'NO_STORED_WEBHOOK',
        'No webhook events found in database. Initiate a top-up or payout first to generate a real provider event.'
      );
    }

    const storedEvent = rows[0];
    const eventId = storedEvent.provider_event_id;
    const rawBody = typeof storedEvent.payload === 'string'
      ? storedEvent.payload
      : JSON.stringify(storedEvent.payload);
    const signature = crypto.createHmac('sha256', env.WEBHOOK_SIGNING_SECRET).update(rawBody).digest('hex');

    const callProvider = async () => {
      const url = `http://127.0.0.1:${env.PORT}/api/webhooks/provider`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provider-Signature': `sha256=${signature}`,
          'X-Provider-Event-Id': eventId
        },
        body: rawBody
      });
      return response.json();
    };

    const first = await callProvider();
    const second = await callProvider();
    res.json({
      success: true,
      message: 'Re-sent existing stored webhook event. Provider safely rejected duplicate.',
      providerEventId: eventId,
      eventType: storedEvent.event_type,
      first,
      second
    });
  } catch (err) {
    next(err);
  }
});
