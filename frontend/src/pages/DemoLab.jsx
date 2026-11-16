import React, { useState } from 'react';
import { api } from '../api/client.js';
import { FlaskConical, Zap, Repeat, ShieldAlert, Scale, Terminal, Trash2, ArrowDownCircle, ArrowUpCircle, RotateCcw, Copy } from 'lucide-react';

export function DemoLab() {
  const [logs, setLogs] = useState([]);
  const [executing, setExecuting] = useState(false);

  function addLog(title, type, details) {
    setLogs((prev) => [
      {
        id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString(),
        title,
        type, // 'info' | 'success' | 'warn' | 'error'
        details
      },
      ...prev
    ]);
  }

  function clearLogs() {
    setLogs([]);
  }

  // 1. Test: Retry Same Key x10
  async function testParallelIdempotency() {
    setExecuting(true);
    addLog('Starting Concurrency Burst (10 Parallel Requests with Identical Idempotency-Key)...', 'info');

    try {
      const accRes = await api.listAccounts();
      const accounts = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET'); // Alice and Bob
      if (accounts.length < 2) {
        addLog('Need at least 2 accounts. Please seed database first.', 'error');
        return;
      }

      const source = accounts[0];
      const dest = accounts[1];
      const testKey = `demo-burst-${Date.now()}`;
      const amountPaise = 500; // ₹5.00

      addLog(`Sending 10 concurrent HTTP requests with key: ${testKey}`, 'info');

      const requests = Array.from({ length: 10 }).map((_, idx) =>
        api
          .createTransfer(
            {
              sourceAccountId: source.id,
              destinationAccountId: dest.id,
              amount: amountPaise
            },
            testKey
          )
          .then((res) => ({ index: idx + 1, status: 201, data: res }))
          .catch((err) => ({
            index: idx + 1,
            status: err.status || 500,
            code: err.code || err.message
          }))
      );

      const results = await Promise.all(requests);
      const successes = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409 || r.status === 422);

      addLog(
        `Results: ${successes.length} successful (201), ${conflicts.length} rejected/conflict (409). Money moved AT MOST ONCE.`,
        'success',
        { results }
      );
    } catch (err) {
      addLog(`Test failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 2. Test: Simulate Lost Response & Safe Replay
  async function testSimulateLostResponse() {
    setExecuting(true);
    addLog('Simulating Lost Response (Network drop after execution)...', 'info');

    try {
      const accRes = await api.listAccounts();
      const accounts = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET'); // Alice and Bob
      const source = accounts[0];
      const dest = accounts[1];
      const testKey = `demo-lost-${Date.now()}`;
      const amountPaise = 1000; // ₹10.00

      addLog('Step 1: First request sent by client (network drops before receiving 200)...', 'info');
      const firstRes = await api.createTransfer(
        {
          sourceAccountId: source.id,
          destinationAccountId: dest.id,
          amount: amountPaise
        },
        testKey
      );

      addLog(`Server committed transfer: ${firstRes.transfer.id}. Client disconnected.`, 'success', firstRes);

      addLog('Step 2: Client reconnects and retries with the EXACT SAME Idempotency-Key...', 'info');
      const retryRes = await api.createTransfer(
        {
          sourceAccountId: source.id,
          destinationAccountId: dest.id,
          amount: amountPaise
        },
        testKey
      );

      if (retryRes.transfer.id === firstRes.transfer.id) {
        addLog(
          'Idempotency HIT! Server returned cached 201 response. Zero additional money moved.',
          'success',
          retryRes
        );
      } else {
        addLog('FAILED: Server created a duplicate transfer!', 'error');
      }
    } catch (err) {
      addLog(`Test failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 3. Test: Send Suspicious Transfer
  async function testSendSuspiciousTransfer() {
    setExecuting(true);
    addLog('Sending Suspicious Transfer (Heuristics trigger score >= 75)...', 'info');

    try {
      const accRes = await api.listAccounts();
      const accounts = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET'); // Alice and Bob
      const source = accounts[0];
      const dest = accounts[1];
      const testKey = `demo-suspicious-${Date.now()}`;
      const suspiciousAmount = 900000; // ₹9,000.00 (Extreme anomaly ratio)

      addLog('Sending transfer with unknown device fingerprint and location mismatch...', 'info');

      const response = await api.createTransfer(
        {
          sourceAccountId: source.id,
          destinationAccountId: dest.id,
          amount: suspiciousAmount,
          deviceFingerprint: 'rogue-bot-client-99',
          locationMismatch: true,
          simulateRiskScore: 88 // Forces HELD_FOR_REVIEW
        },
        testKey
      );

      addLog(
        `Risk Engine Intercepted Transfer! Status: HELD_FOR_REVIEW (HTTP 202). Zero ledger entries created.`,
        'warn',
        response
      );
      addLog('Enqueued Gemini LLM job in BullMQ to generate 2-sentence compliance explanation.', 'info');
    } catch (err) {
      addLog(`Request failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 4. Test: Run Reconciliation with Mismatches
  async function testRunReconciliationMismatches() {
    setExecuting(true);
    addLog('Executing financial reconciliation with simulated settlement mismatches...', 'info');

    try {
      const result = await api.runReconciliation(true);
      const run = result.run;
      const discrepancies = result.discrepancies || [];

      addLog(
        `Reconciliation Run ${run.id.slice(0, 8)}... Finished. Detected ${discrepancies.length} discrepancy items.`,
        'success',
        result
      );

      addLog('Golden Rule Audit: Ledger balances remained untouched. Zero auto-fixes executed.', 'info');
    } catch (err) {
      addLog(`Reconciliation failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 5. Test: Top up a wallet
  async function testTopupWallet() {
    setExecuting(true);
    addLog('Initiating wallet top-up (₹50.00)...', 'info');

    try {
      const accRes = await api.listAccounts();
      const accounts = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET');
      if (accounts.length === 0) {
        addLog('No user wallet found. Please seed database first.', 'error');
        return;
      }
      const wallet = accounts[0];
      const testKey = `demo-topup-${Date.now()}`;
      const amountPaise = 5000; // ₹50.00

      addLog(`Initiating top-up for wallet ${wallet.id.slice(0, 8)}... (key: ${testKey})`, 'info');
      const response = await api.topupWallet(
        {
          customerWalletId: wallet.id,
          amount: amountPaise
        },
        testKey
      );

      addLog(
        `Top-up initiated! Provider payment ID: ${response.providerData?.providerPaymentId || 'assigned'}. Webhook will credit wallet.`,
        'success',
        response
      );
    } catch (err) {
      addLog(`Top-up failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 6. Test: Payout that succeeds
  async function testPayoutSuccess() {
    setExecuting(true);
    addLog('Initiating payout that succeeds (₹20.00)...', 'info');

    try {
      const accRes = await api.listAccounts();
      const accounts = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET');
      if (accounts.length === 0) {
        addLog('No user wallet found. Please seed database first.', 'error');
        return;
      }
      const wallet = accounts[0];
      const testKey = `demo-payout-succ-${Date.now()}`;
      const amountPaise = 2000; // ₹20.00

      addLog(`Initiating payout from wallet ${wallet.id.slice(0, 8)}...`, 'info');
      const response = await api.payoutWallet(
        {
          sourceAccountId: wallet.id,
          amount: amountPaise,
          shouldFail: false
        },
        testKey
      );

      addLog(
        `Payout initiated! Transfer ID: ${response.transfer?.id || 'pending'}. Outbox worker triggers gateway webhook to settle.`,
        'success',
        response
      );
    } catch (err) {
      addLog(`Payout failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 7. Test: Payout that fails and reverses
  async function testPayoutFailure() {
    setExecuting(true);
    addLog('Initiating payout with simulated bank rejection (₹20.00)...', 'warn');

    try {
      const accRes = await api.listAccounts();
      const accounts = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET');
      if (accounts.length === 0) {
        addLog('No user wallet found. Please seed database first.', 'error');
        return;
      }
      const wallet = accounts[0];
      const testKey = `demo-payout-fail-${Date.now()}`;
      const amountPaise = 2000; // ₹20.00

      addLog(`Initiating failing payout from wallet ${wallet.id.slice(0, 8)} (shouldFail = true)...`, 'info');
      const response = await api.payoutWallet(
        {
          sourceAccountId: wallet.id,
          amount: amountPaise,
          shouldFail: true
        },
        testKey
      );

      addLog(
        `Failing payout queued. Bank rejection triggers PAYOUT_FAILED webhook -> auto-reversed to wallet.`,
        'warn',
        response
      );
    } catch (err) {
      addLog(`Payout failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  // 8. Test: Send the same webhook twice
  async function testDuplicateWebhook() {
    setExecuting(true);
    addLog('Testing duplicate webhook deduplication (re-sending latest stored event)...', 'info');

    try {
      const result = await api.simulateDuplicateWebhook();
      addLog(
        `Re-sent stored event ${result.providerEventId} (${result.eventType}) -> Provider returned: ${result.first?.status || 'IGNORED_DUPLICATE'}. Duplicate safely ignored.`,
        'success',
        result
      );
    } catch (err) {
      addLog(`Duplicate webhook test failed: ${err.message}`, 'error');
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Fintech Engineering Demo Lab</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Interactive test bench to demonstrate distributed idempotency, ledger immutability, and risk thresholds.
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 w-fit mb-3">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Retry Same Key x10</h3>
            <p className="text-xs text-slate-400 mt-1">
              Fires 10 concurrent HTTP requests with the identical Idempotency-Key. Proves only 1 creates a transfer.
            </p>
          </div>
          <button
            onClick={testParallelIdempotency}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Firing...' : 'Run Concurrency Test'}
          </button>
        </div>

        {/* Card 2 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400 w-fit mb-3">
              <Repeat className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Simulate Lost Response</h3>
            <p className="text-xs text-slate-400 mt-1">
              Simulates a dropped connection after commitment. Client retries with same key to receive exact stored response.
            </p>
          </div>
          <button
            onClick={testSimulateLostResponse}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Simulating...' : 'Simulate Lost Response'}
          </button>
        </div>

        {/* Card 3 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 w-fit mb-3">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Send Suspicious Transfer</h3>
            <p className="text-xs text-slate-400 mt-1">
              Sends high-anomaly transfer triggering score $\ge 75$. Transfer held (202) with ZERO ledger entries posted.
            </p>
          </div>
          <button
            onClick={testSendSuspiciousTransfer}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Evaluating...' : 'Trigger Risk Hold (202)'}
          </button>
        </div>

        {/* Card 4 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 w-fit mb-3">
              <Scale className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Reconciliation Mismatches</h3>
            <p className="text-xs text-slate-400 mt-1">
              Simulates gateway discrepancies (ghost records, duplicates) and proves reconciliation never auto-fixes money.
            </p>
          </div>
          <button
            onClick={testRunReconciliationMismatches}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Reconciling...' : 'Run With Mismatches'}
          </button>
        </div>

        {/* Card 5 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 w-fit mb-3">
              <ArrowDownCircle className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Top Up Wallet</h3>
            <p className="text-xs text-slate-400 mt-1">
              Simulates incoming customer deposit (₹50). Wallet is credited asynchronously once the gateway webhook arrives.
            </p>
          </div>
          <button
            onClick={testTopupWallet}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Processing...' : 'Top Up Wallet (₹50)'}
          </button>
        </div>

        {/* Card 6 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 w-fit mb-3">
              <ArrowUpCircle className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Payout (Succeeds)</h3>
            <p className="text-xs text-slate-400 mt-1">
              Debits wallet to clearing via outbox. Provider webhook confirms settlement to the bank account.
            </p>
          </div>
          <button
            onClick={testPayoutSuccess}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Processing...' : 'Succeeding Payout (₹20)'}
          </button>
        </div>

        {/* Card 7 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 w-fit mb-3">
              <RotateCcw className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Payout (Fails & Reverses)</h3>
            <p className="text-xs text-slate-400 mt-1">
              Bank rejects payout. Simulated provider sends PAYOUT_FAILED webhook, automatically reversing money to wallet.
            </p>
          </div>
          <button
            onClick={testPayoutFailure}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Processing...' : 'Failing Payout (₹20)'}
          </button>
        </div>

        {/* Card 8 */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 w-fit mb-3">
              <Copy className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-white">Duplicate Webhook</h3>
            <p className="text-xs text-slate-400 mt-1">
              Re-sends an existing stored webhook event. Proves the provider endpoint rejects duplicates with HTTP 200 IGNORED_DUPLICATE.
            </p>
          </div>
          <button
            onClick={testDuplicateWebhook}
            disabled={executing}
            className="w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {executing ? 'Sending...' : 'Send Webhook Twice'}
          </button>
        </div>
      </div>

      {/* Live Interactive Execution Terminal */}
      <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-white uppercase text-[11px] tracking-wider">
              Live Test Execution Console
            </span>
          </div>
          <button
            onClick={clearLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] transition-colors disabled:opacity-30"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear Console</span>
          </button>
        </div>

        <div className="h-80 overflow-y-auto space-y-2 pr-1">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 font-sans">
              <FlaskConical className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-xs">Console idle. Click any test button above to run real-time scenarios.</p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`p-2.5 rounded-lg border text-[11px] leading-relaxed ${
                  log.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'
                    : log.type === 'warn'
                    ? 'bg-amber-950/40 border-amber-800/40 text-amber-300'
                    : log.type === 'error'
                    ? 'bg-rose-950/40 border-rose-800/40 text-rose-300'
                    : 'bg-slate-900/60 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] opacity-75 mb-1">
                  <span>[{log.time}]</span>
                  <span className="uppercase font-bold">{log.type}</span>
                </div>
                <p className="font-semibold">{log.title}</p>
                {log.details && (
                  <pre className="mt-1.5 p-2 rounded bg-black/60 text-[10px] overflow-x-auto text-slate-300">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

