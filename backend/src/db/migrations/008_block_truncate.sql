-- Migration: 008_block_truncate.sql
-- Description: Block TRUNCATE statements on append-only financial tables (ledger_entries, audit_log)

-- 1. Block TRUNCATE on ledger_entries
CREATE OR REPLACE FUNCTION tg_block_ledger_truncate()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL FINANCIAL VIOLATION: ledger_entries is strictly append-only. TRUNCATE is forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_block_truncate ON ledger_entries;

CREATE TRIGGER trg_ledger_entries_block_truncate
BEFORE TRUNCATE ON ledger_entries
FOR EACH STATEMENT
EXECUTE FUNCTION tg_block_ledger_truncate();

-- 2. Block TRUNCATE on audit_log
CREATE OR REPLACE FUNCTION tg_block_audit_truncate()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: audit_log is strictly append-only. TRUNCATE is forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_block_truncate ON audit_log;

CREATE TRIGGER trg_audit_log_block_truncate
BEFORE TRUNCATE ON audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION tg_block_audit_truncate();

