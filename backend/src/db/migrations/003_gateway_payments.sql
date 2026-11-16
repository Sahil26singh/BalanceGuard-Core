-- Migration: 003_gateway_payments.sql
-- The simulated payment gateway keeps its own record of every payment, just like a real
-- provider (Razorpay, Stripe...) would. Reconciliation compares our ledger with this table.
-- It deliberately has no foreign keys: it stands in for a system outside our database.

CREATE TABLE IF NOT EXISTS gateway_payments (
    provider_payment_id VARCHAR(64) PRIMARY KEY,
    transfer_id UUID,
    customer_wallet_id UUID,
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
