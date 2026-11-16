-- Migration: 006_webhook_outbox_recovery.sql
-- Description: Add retry scheduling and processed timestamp to webhook_events for transactional outbox pattern

ALTER TABLE webhook_events
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_events_outbox_pickup
ON webhook_events (status, next_retry_at, created_at)
WHERE status = 'RECEIVED';

