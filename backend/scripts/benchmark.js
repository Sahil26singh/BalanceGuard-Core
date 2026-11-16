// A small benchmark: 50 transfers of Rs 1 from 5 parallel workers, then a ledger check.
// Only run it against the dev setup or your own machine: it adds fake transfers.
//
//   npm run benchmark
import { API_URL, login, apiClient, getDemoWallets, transferRequest } from './lib.js';

const WORKERS = 5;
const TOTAL = 50;

const api = apiClient(await login());
const { alice, bob } = await getDemoWallets(api);

console.log(`Benchmarking ${API_URL}: ${TOTAL} transfers, ${WORKERS} at a time`);

const latencies = [];
let succeeded = 0;
let failed = 0;
let next = 0;
const startedAt = Date.now();

async function worker() {
  while (next < TOTAL) {
    const n = next++;
    const requestStart = Date.now();
    try {
      const res = await transferRequest(api, { from: alice.id, to: bob.id, amount: 100, key: `bench-${startedAt}-${n}` });
      latencies.push(Date.now() - requestStart);
      if (res.status === 201 || res.status === 202) succeeded++;
      else failed++;
    } catch {
      failed++;
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, worker));

const seconds = (Date.now() - startedAt) / 1000;
latencies.sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;

console.log(`Succeeded: ${succeeded}/${TOTAL}   Failed: ${failed}`);
console.log(`Duration: ${seconds.toFixed(2)} s   Throughput: ${(succeeded / seconds).toFixed(1)} transfers/s`);
console.log(`Latency  p50: ${percentile(0.5)} ms   p95: ${percentile(0.95)} ms   p99: ${percentile(0.99)} ms`);

const { integrity } = await (await api('/api/ledger/integrity')).json();
console.log(`Ledger: ${integrity.isBalanced && !integrity.hasAccountDiscrepancies ? 'balanced' : 'OUT OF BALANCE'}`);
process.exit(failed === 0 && integrity.isBalanced ? 0 : 1);
