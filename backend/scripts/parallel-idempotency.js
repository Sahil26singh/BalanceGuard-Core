// Fire 50 requests at the same moment with the SAME Idempotency-Key.
// Money must move exactly once, whatever mix of 201 and 409 answers come back.
//
//   npm run demo:parallel
//   API_URL=https://your-api.onrender.com ADMIN_PASSWORD=... npm run demo:parallel
import { API_URL, login, apiClient, getDemoWallets, getBalance, transferRequest } from './lib.js';

const REQUESTS = 50;
const AMOUNT = 1000n; // Rs 10.00

const api = apiClient(await login());
const { alice, bob } = await getDemoWallets(api);

const aliceBefore = await getBalance(api, alice.id);
const bobBefore = await getBalance(api, bob.id);

const key = `parallel-demo-${Date.now()}`;
console.log(`Sending ${REQUESTS} requests to ${API_URL} with the same key: ${key}`);

const responses = await Promise.all(
  Array.from({ length: REQUESTS }, async () => {
    const res = await transferRequest(api, { from: alice.id, to: bob.id, amount: Number(AMOUNT), key });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  })
);

const byStatus = {};
for (const { status } of responses) byStatus[status] = (byStatus[status] || 0) + 1;
console.log('Responses by status:', byStatus);

// Every successful answer must describe the very same transfer
const transferIds = new Set(responses.map((r) => r.body.transfer?.id).filter(Boolean));
console.log(`Different transfers across all responses: ${transferIds.size}`);

const aliceDelta = aliceBefore - (await getBalance(api, alice.id));
const bobDelta = (await getBalance(api, bob.id)) - bobBefore;
console.log(`Alice paid ${aliceDelta} paise, Bob received ${bobDelta} paise (expected ${AMOUNT} each)`);

const [transferId] = transferIds;
const { transfer } = await (await api(`/api/transfers/${transferId}`)).json();
console.log(`Ledger entries for that transfer: ${transfer.entries.length} (expected 2)`);

const passed = transferIds.size === 1 && aliceDelta === AMOUNT && bobDelta === AMOUNT && transfer.entries.length === 2;
console.log(passed ? '\nPASSED: the money moved exactly once.' : '\nFAILED: the invariant was broken.');
process.exit(passed ? 0 : 1);
