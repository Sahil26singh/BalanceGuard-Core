-- Migration: 004_device_trust.sql
-- Description: Add trust verification status to user_devices to prevent new device risk bypass

ALTER TABLE user_devices
ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMPTZ;

-- Mark existing devices as trusted so existing initial seed/setup remains valid
UPDATE user_devices
SET is_trusted = TRUE, trusted_at = NOW()
WHERE is_trusted IS FALSE;

