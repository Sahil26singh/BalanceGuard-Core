import { query } from '../../config/db.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';

const ENTRY_COLUMNS = 'id, transfer_id, account_id, entry_type, amount, balance_after, created_at';

/**
 * Lock accounts in strict ascending ID order. Must be called inside a transaction.
 * Acquiring this before any foreign key insertions prevents deadlocks between concurrent
 * transactions touching the same accounts.
 */
export async function lockAccounts(client, accountIds) {
  const sortedIds = [...new Set(accountIds)].sort();
  const { rows } = await client.query(
    'SELECT id, account_type, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;',
    [sortedIds]
  );
  return rows;
}

async function insertEntry(client, { transferId, accountId, entryType, amount, balanceAfter }) {
  const { rows } = await client.query(
    `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount, balance_after)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${ENTRY_COLUMNS};`,
    [transferId, accountId, entryType, amount.toString(), balanceAfter.toString()]
  );
  return rows[0];
}

/**
 * The only function that moves money: one DEBIT on the source and one CREDIT on the
 * destination, so total debits always equal total credits.
 *
 * It must be called inside a transaction (pass the transaction's client).
 * Both accounts are locked in ascending id order, so two transfers between the same
 * accounts can never deadlock each other.
 */
export async function postLedgerEntries(
  client,
  { transferId, sourceAccountId, destinationAccountId, amount, actorId = null, actorRole = null, lockedRows = null }
) {
  const value = BigInt(amount);

  if (value <= 0n) {
    throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive whole number of paise');
  }
  if (sourceAccountId === destinationAccountId) {
    throw new AppError(400, 'IDENTICAL_ACCOUNTS', 'Source and destination accounts must be different');
  }

  const rows = lockedRows || (await lockAccounts(client, [sourceAccountId, destinationAccountId]));
  if (rows.length < 2) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'One or both accounts were not found');
  }

  const source = rows.find((row) => row.id === sourceAccountId);
  const destination = rows.find((row) => row.id === destinationAccountId);
  const sourceBalance = BigInt(source.balance);

  // Customer wallets can never go below zero. System accounts may hold a net negative position.
  if (source.account_type === 'USER_WALLET' && sourceBalance < value) {
    throw new AppError(400, 'INSUFFICIENT_FUNDS', `Insufficient funds: ${sourceBalance} paise available, ${value} required`);
  }

  const sourceBalanceAfter = sourceBalance - value;
  const destinationBalanceAfter = BigInt(destination.balance) + value;

  const updates = [
    { id: sourceAccountId, balanceAfter: sourceBalanceAfter },
    { id: destinationAccountId, balanceAfter: destinationBalanceAfter }
  ].sort((a, b) => a.id.localeCompare(b.id));

  for (const u of updates) {
    await client.query('UPDATE accounts SET balance = $1, version = version + 1, updated_at = NOW() WHERE id = $2;', [
      u.balanceAfter.toString(),
      u.id
    ]);
  }

  const debitEntry = await insertEntry(client, { transferId, accountId: sourceAccountId, entryType: 'DEBIT', amount: value, balanceAfter: sourceBalanceAfter });
  const creditEntry = await insertEntry(client, { transferId, accountId: destinationAccountId, entryType: 'CREDIT', amount: value, balanceAfter: destinationBalanceAfter });

  await client.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor_id, actor_role, metadata)
     VALUES ('TRANSFER', $1, 'LEDGER_POSTED', $2, $3, $4);`,
    [transferId, actorId, actorRole, JSON.stringify({ sourceAccountId, destinationAccountId, amount: value.toString() })]
  );

  invalidateIntegrityCache();
  logger.info({ transferId, amount: value.toString() }, 'Ledger entries posted');

  return { debitEntry, creditEntry };
}

// The integrity report scans the whole ledger. It is cached using a database-backed checkpoint (MAX(id)):
// If no new ledger entries have committed and the report is under CACHE_TTL_MS old, reuse it.
// If any transaction commits new entries, MAX(id) increments and immediately invalidates the cache.
const CACHE_TTL_MS = 30000;
let cachedReport = null;
let cachedAt = 0;
let cachedLatestEntryId = -1n;

function invalidateIntegrityCache() {
  cachedReport = null;
  cachedLatestEntryId = -1n;
}

/**
 * Check the whole ledger:
 *  1. total debits must equal total credits
 *  2. every account's cached balance must equal credits minus debits from its entries
 */
export async function getLedgerIntegrityReport() {
  const { rows: [checkpoint] } = await query(
    'SELECT COALESCE(MAX(id), 0)::TEXT AS latest_entry_id FROM ledger_entries;'
  );
  const currentEntryId = BigInt(checkpoint?.latest_entry_id || '0');

  if (cachedReport && cachedLatestEntryId === currentEntryId && Date.now() - cachedAt < CACHE_TTL_MS) {
    return { ...cachedReport, fromCache: true };
  }

  const { rows: [totals] } = await query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE entry_type = 'DEBIT'), 0) AS total_debits,
      COALESCE(SUM(amount) FILTER (WHERE entry_type = 'CREDIT'), 0) AS total_credits,
      COUNT(*) AS total_entries
    FROM ledger_entries;
  `);

  const { rows: accounts } = await query(`
    SELECT
      a.id,
      a.account_type,
      a.balance AS cached_balance,
      COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount ELSE -le.amount END), 0) AS computed_balance
    FROM accounts a
    LEFT JOIN ledger_entries le ON le.account_id = a.id
    GROUP BY a.id, a.account_type, a.balance;
  `);

  const discrepancies = accounts
    .filter((row) => BigInt(row.cached_balance) !== BigInt(row.computed_balance))
    .map((row) => ({
      accountId: row.id,
      accountType: row.account_type,
      cachedBalance: row.cached_balance,
      computedBalance: row.computed_balance,
      difference: (BigInt(row.cached_balance) - BigInt(row.computed_balance)).toString()
    }));

  const isBalanced = BigInt(totals.total_debits) === BigInt(totals.total_credits);

  cachedReport = {
    isBalanced,
    totalDebits: totals.total_debits,
    totalCredits: totals.total_credits,
    totalEntries: Number(totals.total_entries),
    accountsAudited: accounts.length,
    hasAccountDiscrepancies: discrepancies.length > 0,
    discrepancies,
    status: isBalanced && discrepancies.length === 0 ? 'HEALTHY' : 'CORRUPTED',
    cachedAt: new Date().toISOString()
  };
  cachedLatestEntryId = currentEntryId;
  cachedAt = Date.now();

  return { ...cachedReport, fromCache: false };
}
