import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Plus, Filter, RefreshCw, Loader2 } from 'lucide-react';
import { formatPaise } from '../utils/format.js';

export function Transactions() {
  const [transfers, setTransfers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Transfer modal form state
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [amountRupees, setAmountRupees] = useState('100');
  const [customKey, setCustomKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  async function loadData() {
    setLoading(true);
    try {
      const [txRes, accRes] = await Promise.all([
        api.listTransfers({ status: statusFilter || undefined, limit: 50 }),
        api.listAccounts()
      ]);
      setTransfers(txRes.transfers || []);
      // Customers can only send money to each other, so only wallets are offered
      const accList = (accRes.accounts || []).filter((a) => a.account_type === 'USER_WALLET');
      setAccounts(accList);
      if (accList.length >= 2 && !sourceId) {
        setSourceId(accList[0].id);
        setDestId(accList[1].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  async function handleCreateTransfer(e) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const paise = Math.round(parseFloat(amountRupees) * 100);
    if (isNaN(paise) || paise <= 0) {
      setFormError('Please enter a valid amount');
      setSubmitting(false);
      return;
    }

    const key = customKey.trim() || `web-tx-${Date.now()}`;

    try {
      await api.createTransfer(
        {
          sourceAccountId: sourceId,
          destinationAccountId: destId,
          amount: paise
        },
        key
      );

      setShowModal(false);
      setCustomKey('');
      window.dispatchEvent(new Event('bgc_ledger_updated'));
      loadData();
    } catch (err) {
      setFormError(err.message || 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Ledger Transfers</h1>
          <p className="text-xs text-slate-400">
            Immutable, double-entry payment movements recorded in PostgreSQL.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => loadData()}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Transfer</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
        <Filter className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-semibold text-slate-400">Status:</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="HELD_FOR_REVIEW">HELD_FOR_REVIEW</option>
          <option value="REJECTED">REJECTED</option>
          <option value="REFUNDED">REFUNDED</option>
          <option value="PARTIALLY_REFUNDED">PARTIALLY_REFUNDED</option>
          <option value="REVERSED">REVERSED</option>
        </select>
        <span className="text-xs text-slate-500 ml-auto font-mono">
          Showing {transfers.length} records
        </span>
      </div>

      {/* Transfers Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Transfer ID</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Source Account</th>
                <th className="py-3 px-4">Destination Account</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Loading transfers...</span>
                  </td>
                </tr>
              ) : transfers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-500">
                    No transfers match the selected filter.
                  </td>
                </tr>
              ) : (
                transfers.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-300">
                      {tx.id.slice(0, 8)}...
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-200">
                      {tx.transfer_type}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-slate-200">{tx.source_user_email || tx.source_account_type}</div>
                      <div className="text-slate-500 font-mono text-[10px]">{tx.source_account_id.slice(0, 8)}...</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-slate-200">{tx.destination_user_email || tx.destination_account_type}</div>
                      <div className="text-slate-500 font-mono text-[10px]">{tx.destination_account_id.slice(0, 8)}...</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-white text-sm">
                      {formatPaise(tx.amount)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/transfers/${tx.id}`}
                        className="px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold text-xs border border-indigo-500/30 transition-colors"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Transfer Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-1">Initiate Double-Entry Transfer</h2>
            <p className="text-xs text-slate-400 mb-4">
              Executes in ONE database transaction. Debits source, credits destination.
            </p>

            {formError && (
              <div className="mb-4 p-2.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateTransfer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Source Account</label>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.user_email || a.account_type} ({formatPaise(a.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Destination Account</label>
                <select
                  value={destId}
                  onChange={(e) => setDestId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.user_email || a.account_type} ({formatPaise(a.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Amount (INR ₹)</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                  placeholder="100.00"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Custom Idempotency-Key (Optional)
                </label>
                <input
                  type="text"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="Auto-generated if blank"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono text-[11px]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950 disabled:opacity-50"
                >
                  {submitting ? 'Executing...' : 'Post Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

