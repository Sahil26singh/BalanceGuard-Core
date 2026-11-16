-- Migration: 007_hardening_and_outbox.sql
-- 1. Add idempotency_key to gateway_payments to guarantee payment-intent idempotency at the database level
ALTER TABLE gateway_payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255) UNIQUE;

-- 2. Add actor_id to transfers to track initiator and enforce separation of duties
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id);

-- 3. Add unique constraint on risk_assessments(transfer_id) to prevent duplicate risk evaluations
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_risk_assessments_transfer_id'
    ) THEN
        ALTER TABLE risk_assessments ADD CONSTRAINT uq_risk_assessments_transfer_id UNIQUE (transfer_id);
    END IF;
END $$;

-- 4. Extend reconciliation_discrepancies discrepancy_type to support CURRENCY_MISMATCH and STATUS_MISMATCH
ALTER TABLE reconciliation_discrepancies DROP CONSTRAINT IF EXISTS reconciliation_discrepancies_discrepancy_type_check;
ALTER TABLE reconciliation_discrepancies ADD CONSTRAINT reconciliation_discrepancies_discrepancy_type_check
    CHECK (discrepancy_type IN ('MISSING_IN_PROVIDER', 'MISSING_IN_INTERNAL', 'AMOUNT_MISMATCH', 'DUPLICATE_EXTERNAL', 'CURRENCY_MISMATCH', 'STATUS_MISMATCH'));

-- 5. Payout Transactional Outbox for at-least-once, crash-resilient provider notification
CREATE TABLE IF NOT EXISTS payout_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    customer_wallet_id UUID NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    should_fail BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DISPATCHED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_outbox_pickup 
ON payout_outbox(status, next_retry_at, created_at) 
WHERE status IN ('PENDING', 'PROCESSING');
