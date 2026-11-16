import { query } from '../../config/db.js';
import { AppError } from '../../utils/errors.js';

/**
 * List accounts with user email and type information.
 * @param {object} [filters]
 * @param {string} [filters.accountType]
 * @param {string} [filters.userId]
 * @returns {Promise<any[]>}
 */
export async function listAccounts(filters = {}) {
  let sql = `
    SELECT 
      a.id, 
      a.user_id, 
      u.email AS user_email,
      a.account_type, 
      a.currency, 
      a.balance, 
      a.version, 
      a.created_at, 
      a.updated_at
    FROM accounts a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.accountType) {
    params.push(filters.accountType);
    sql += ` AND a.account_type = $${params.length}`;
  }

  if (filters.userId) {
    params.push(filters.userId);
    sql += ` AND a.user_id = $${params.length}`;
  }

  sql += ' ORDER BY a.created_at ASC;';

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Retrieve account details by ID.
 * @param {string} accountId 
 * @returns {Promise<any | null>}
 */
export async function getAccountById(accountId) {
  const result = await query(
    `SELECT 
       a.id, 
       a.user_id, 
       u.email AS user_email,
       a.account_type, 
       a.currency, 
       a.balance, 
       a.version, 
       a.created_at, 
       a.updated_at
     FROM accounts a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.id = $1;`,
    [accountId]
  );
  return result.rows[0] || null;
}

/**
 * Get recent ledger entries for an account.
 * @param {string} accountId 
 * @param {number} [limit=50] 
 * @returns {Promise<any[]>}
 */
export async function getAccountLedgerEntries(accountId, limit = 50) {
  const result = await query(
    `SELECT 
       le.id,
       le.transfer_id,
       le.account_id,
       le.entry_type,
       le.amount,
       le.balance_after,
       le.created_at,
       t.transfer_type,
       t.status AS transfer_status
     FROM ledger_entries le
     JOIN transfers t ON le.transfer_id = t.id
     WHERE le.account_id = $1
     ORDER BY le.id DESC
     LIMIT $2;`,
    [accountId, limit]
  );
  return result.rows;
}


/** Find one of the platform's own accounts (PLATFORM_CLEARING or PROVIDER_SETTLEMENT). */
export async function getSystemAccountId(client, accountType) {
  const { rows } = await client.query(
    'SELECT id FROM accounts WHERE account_type = $1 AND user_id IS NULL;',
    [accountType]
  );
  if (!rows[0]) {
    throw new AppError(500, 'SYSTEM_ACCOUNT_MISSING', `${accountType} account not found. Run: npm run seed`);
  }
  return rows[0].id;
}

