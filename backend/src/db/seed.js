import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postLedgerEntries } from '../modules/ledger/ledger.service.js';
import { createTransfer } from '../modules/transfers/transfers.queries.js';

const FUNDING_KEY = 'seed-init-alice-wallet-001';
const FUNDING_AMOUNT = 1000000n; // 1,000,000 paise = Rs 10,000

/** Return the id of the first row, creating it if it does not exist yet. */
async function findOrCreate(client, selectSql, selectParams, insertSql, insertParams) {
  const found = await client.query(selectSql, selectParams);
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query(insertSql, insertParams);
  return created.rows[0].id;
}

/**
 * Create the demo data: platform accounts, staff users, two customers (Alice and Bob)
 * and Rs 10,000 for Alice. Safe to run more than once.
 */
export async function seedDatabase() {
  const adminHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 10);
  const reviewerHash = await bcrypt.hash(env.SEED_REVIEWER_PASSWORD, 10);
  // Customers are not people who log in: give them a password nobody knows
  const customerHash = await bcrypt.hash(crypto.randomUUID(), 10);

  await withTransaction(async (client) => {
    const accountSql = `INSERT INTO accounts (user_id, account_type, currency, balance, version)
                        VALUES ($1, $2, 'INR', 0, 0) RETURNING id;`;
    const userSql = 'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id;';

    // The platform's own accounts
    const clearingId = await findOrCreate(client,
      "SELECT id FROM accounts WHERE account_type = 'PLATFORM_CLEARING' AND user_id IS NULL;", [],
      accountSql, [null, 'PLATFORM_CLEARING']);
    await findOrCreate(client,
      "SELECT id FROM accounts WHERE account_type = 'PROVIDER_SETTLEMENT' AND user_id IS NULL;", [],
      accountSql, [null, 'PROVIDER_SETTLEMENT']);

    // Staff users
    const users = [
      ['admin@balanceguard.local', adminHash, 'admin'],
      ['reviewer@balanceguard.local', reviewerHash, 'reviewer'],
      ['alice@example.com', customerHash, 'reviewer'],
      ['bob@example.com', customerHash, 'reviewer']
    ];
    const userIds = {};
    for (const [email, hash, role] of users) {
      userIds[email] = await findOrCreate(client,
        'SELECT id FROM users WHERE email = $1;', [email],
        userSql, [email, hash, role]);
    }

    // A wallet and a known device for each customer
    const wallets = {};
    const devices = { 'alice@example.com': 'dev-alice-laptop-primary', 'bob@example.com': 'dev-bob-mobile-primary' };
    for (const [email, fingerprint] of Object.entries(devices)) {
      const userId = userIds[email];
      wallets[email] = await findOrCreate(client,
        "SELECT id FROM accounts WHERE user_id = $1 AND account_type = 'USER_WALLET';", [userId],
        "INSERT INTO accounts (user_id, account_type, currency, balance, version) VALUES ($1, 'USER_WALLET', 'INR', 0, 0) RETURNING id;", [userId]);

      await client.query(
        `INSERT INTO user_devices (user_id, device_fingerprint, ip_address, user_agent, is_trusted, trusted_at, last_seen_at)
         VALUES ($1, $2, '127.0.0.1', 'BalanceGuard demo device', TRUE, NOW(), NOW())
         ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET last_seen_at = NOW(), is_trusted = TRUE, trusted_at = COALESCE(user_devices.trusted_at, NOW());`,
        [userId, fingerprint]
      );
    }

    // Fund Alice once, through the normal ledger code
    const funded = await client.query('SELECT 1 FROM transfers WHERE idempotency_key = $1;', [FUNDING_KEY]);
    if (funded.rowCount === 0) {
      const transfer = await createTransfer(client, {
        key: FUNDING_KEY,
        sourceAccountId: clearingId,
        destinationAccountId: wallets['alice@example.com'],
        amount: FUNDING_AMOUNT,
        type: 'INTERNAL_TRANSFER', // platform funding, not a provider top-up
        status: 'COMPLETED'
      });
      await postLedgerEntries(client, {
        transferId: transfer.id,
        sourceAccountId: clearingId,
        destinationAccountId: wallets['alice@example.com'],
        amount: FUNDING_AMOUNT,
        actorId: userIds['admin@balanceguard.local'],
        actorRole: 'admin'
      });
      logger.info('Funded Alice with Rs 10,000');
    }
  });

  logger.info('Seed finished');
}

// `npm run seed` runs this file directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err: err.message }, 'Seed failed');
      process.exit(1);
    });
}
