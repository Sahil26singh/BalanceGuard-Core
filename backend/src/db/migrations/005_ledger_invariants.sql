-- Migration: 005_ledger_invariants.sql
-- Description: Enforce double-entry ledger invariants at database commit via deferred constraint trigger

CREATE OR REPLACE FUNCTION tg_validate_ledger_transaction_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_debit_count INT;
    v_credit_count INT;
    v_total_debits BIGINT;
    v_total_credits BIGINT;
    v_transfer_type VARCHAR(32);
BEGIN
    -- Aggregate all entries for this transfer
    SELECT 
        COUNT(*) FILTER (WHERE entry_type = 'DEBIT'),
        COUNT(*) FILTER (WHERE entry_type = 'CREDIT'),
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'DEBIT'), 0),
        COALESCE(SUM(amount) FILTER (WHERE entry_type = 'CREDIT'), 0)
    INTO 
        v_debit_count,
        v_credit_count,
        v_total_debits,
        v_total_credits
    FROM ledger_entries
    WHERE transfer_id = NEW.transfer_id;

    -- Invariant 1: Double-Entry Balance Equation (Total Debits must strictly equal Total Credits)
    IF v_total_debits <> v_total_credits THEN
        RAISE EXCEPTION 'CRITICAL FINANCIAL INTEGRITY FAILURE: transfer % ledger is unbalanced. Total debits (%) != total credits (%)',
            NEW.transfer_id, v_total_debits, v_total_credits;
    END IF;

    -- Invariant 2: Entry Count Parity (Debits must match Credits count, and at least 1 pair)
    IF v_debit_count <> v_credit_count OR v_debit_count < 1 THEN
        RAISE EXCEPTION 'CRITICAL FINANCIAL INTEGRITY FAILURE: transfer % has asymmetric entry count (% debits vs % credits)',
            NEW.transfer_id, v_debit_count, v_credit_count;
    END IF;

    -- Invariant 3: Single-phase transfers (INTERNAL_TRANSFER, TOPUP, REFUND) must have exactly 1 debit and 1 credit
    SELECT transfer_type INTO v_transfer_type
    FROM transfers
    WHERE id = NEW.transfer_id;

    IF v_transfer_type IN ('INTERNAL_TRANSFER', 'TOPUP', 'REFUND') AND (v_debit_count <> 1 OR v_credit_count <> 1) THEN
        RAISE EXCEPTION 'CRITICAL FINANCIAL INTEGRITY FAILURE: transfer % of type % requires exactly 1 DEBIT and 1 CREDIT entry, found % debits and % credits',
            NEW.transfer_id, v_transfer_type, v_debit_count, v_credit_count;
    END IF;

    -- Invariant 4: Two-phase transfers (PAYOUT) must have exactly 1 pair (initiated) or 2 pairs (settled or reversed)
    IF v_transfer_type = 'PAYOUT' AND v_debit_count NOT IN (1, 2) THEN
        RAISE EXCEPTION 'CRITICAL FINANCIAL INTEGRITY FAILURE: payout % requires 1 entry pair (initiated) or 2 pairs (settled/reversed), found % pairs',
            NEW.transfer_id, v_debit_count;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_balance_check ON ledger_entries;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balance_check
AFTER INSERT ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION tg_validate_ledger_transaction_balance();

