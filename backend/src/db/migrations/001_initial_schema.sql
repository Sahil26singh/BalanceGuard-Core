-- Migration: 001_initial_schema.sql
-- Description: Core tables for BalanceGuard Core payment backend

-- 2. Users (Admin and Reviewer roles)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('admin', 'reviewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Accounts (Wallets, Clearing, Settlement)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    account_type VARCHAR(32) NOT NULL CHECK (account_type IN ('USER_WALLET', 'PLATFORM_CLEARING', 'PROVIDER_SETTLEMENT')),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    balance BIGINT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- In double-entry accounting, PLATFORM_CLEARING and PROVIDER_SETTLEMENT legitimately go negative to track net clearing/settlement positions.
    -- Only customer USER_WALLET accounts are strictly prohibited from having a negative balance.
    CONSTRAINT chk_user_wallet_non_negative CHECK (
        account_type != 'USER_WALLET' OR balance >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type);

-- 4. Transfers (Money movement intentions and states)
CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) NOT NULL,
    source_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    destination_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    transfer_type VARCHAR(32) NOT NULL CHECK (transfer_type IN ('INTERNAL_TRANSFER', 'TOPUP', 'PAYOUT', 'REFUND')),
    status VARCHAR(32) NOT NULL CHECK (status IN ('PENDING', 'PENDING_PROVIDER', 'COMPLETED', 'FAILED', 'HELD_FOR_REVIEW', 'REJECTED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED')),
    parent_transfer_id UUID REFERENCES transfers(id) ON DELETE RESTRICT,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_different_accounts CHECK (source_account_id != destination_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_source ON transfers(source_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_destination ON transfers(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_parent ON transfers(parent_transfer_id);

-- 5. Ledger Entries (Double-entry debits and credits)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_type VARCHAR(8) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    balance_after BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transfer ON ledger_entries(transfer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);

-- 6. Idempotency Keys (Deduplication and concurrency control)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope VARCHAR(64) NOT NULL,
    key VARCHAR(255) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('IN_PROGRESS', 'RESOLVED', 'FAILED')),
    response_status_code INTEGER,
    response_body JSONB,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_idempotency_scope_key UNIQUE (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_locked_at ON idempotency_keys(locked_at);

-- 7. Webhook Events (Inbound provider payloads)
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_event_id VARCHAR(255) UNIQUE NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSED', 'DEAD')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);

-- 8. Reconciliation Runs & Discrepancies
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(32) NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    total_internal_transfers INTEGER NOT NULL DEFAULT 0,
    total_external_records INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    discrepancy_count INTEGER NOT NULL DEFAULT 0,
    summary JSONB
);

CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    transfer_id UUID REFERENCES transfers(id),
    external_reference_id VARCHAR(255),
    discrepancy_type VARCHAR(64) NOT NULL CHECK (discrepancy_type IN ('MISSING_IN_PROVIDER', 'MISSING_IN_INTERNAL', 'AMOUNT_MISMATCH', 'DUPLICATE_EXTERNAL')),
    internal_amount BIGINT,
    external_amount BIGINT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_discrepancies_run ON reconciliation_discrepancies(run_id);

-- 9. Risk Assessments & Review Decisions
CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('ALLOW', 'HOLD')),
    signals JSONB NOT NULL,
    signals_incomplete BOOLEAN NOT NULL DEFAULT FALSE,
    explanation TEXT,
    explanation_source VARCHAR(32) CHECK (explanation_source IN ('GEMINI', 'TEMPLATE_FALLBACK')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_assessments_transfer ON risk_assessments(transfer_id);

CREATE TABLE IF NOT EXISTS review_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    risk_assessment_id UUID NOT NULL REFERENCES risk_assessments(id) ON DELETE RESTRICT,
    transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE RESTRICT,
    reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    review_note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_transfer ON review_decisions(transfer_id);

-- 10. User Devices (Heuristic for Device Fingerprinting)
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
    trusted_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_device UNIQUE (user_id, device_fingerprint)
);

-- 11. Immutable Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    actor_id UUID REFERENCES users(id),
    actor_role VARCHAR(32),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

