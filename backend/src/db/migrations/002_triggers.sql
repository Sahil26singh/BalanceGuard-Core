-- Migration: 002_triggers.sql
-- Description: PostgreSQL triggers ensuring ledger_entries and audit_log are append-only

-- 1. Ledger Entries Immutability Function & Trigger
CREATE OR REPLACE FUNCTION tg_block_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL FINANCIAL VIOLATION: ledger_entries is strictly append-only. % operation on row % is forbidden.', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_immutable ON ledger_entries;

CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION tg_block_ledger_mutation();

-- 2. Audit Log Immutability Function & Trigger
CREATE OR REPLACE FUNCTION tg_block_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: audit_log is strictly append-only. % operation on sequence % is forbidden.', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;

CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION tg_block_audit_mutation();


