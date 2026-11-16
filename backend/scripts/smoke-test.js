// Quick check that a deployment works: health, login, a transfer, a safe retry, ledger balance.
//
//   npm run smoke-test                      (local server)
//   npm run smoke-test -- https://your-api.onrender.com
import { API_URL, login, apiClient, getDemoWallets, transferRequest } from './lib.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok  ${message}`);
}

try {
  console.log(`Smoke test against ${API_URL}\n`);

  const health = await fetch(`${API_URL}/health`);
  check(health.ok && (await health.json()).status === 'OK', '/health responds');

  const api = apiClient(await login());
  check(true, 'admin can log in');

  const { alice, bob } = await getDemoWallets(api);
  const key = `smoke-${Date.now()}`;
  const send = () => transferRequest(api, { from: alice.id, to: bob.id, amount: 100, key });

  const first = await send();
  const firstBody = await first.json();
  check(first.status === 201 || first.status === 202, `transfer accepted (HTTP ${first.status})`);

  const retry = await send();
  const retryBody = await retry.json();
  check(retry.status === first.status && retryBody.transfer.id === firstBody.transfer.id, 'retry with the same key returns the same transfer');

  const { integrity } = await (await api('/api/ledger/integrity')).json();
  check(integrity.isBalanced && !integrity.hasAccountDiscrepancies, 'ledger is balanced (debits = credits)');

  console.log('\nSmoke test passed.');
} catch (err) {
  console.error(`\nSmoke test failed: ${err.message}`);
  process.exit(1);
}
