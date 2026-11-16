import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatPaise } from '../utils/format.js';
import { ArrowLeft, RotateCcw, ArrowRightLeft, Loader2, AlertCircle } from 'lucide-react';

export function TransactionDetail() {
  const { id } = useParams();
  const [transfer, setTransfer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Refund modal state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundRupees, setRefundRupees] = useState('');
  const [refundReason, setRefundReason] = useState('Customer requested refund');
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState(null);

  async function loadTransfer() {
    setLoading(true);
    try {
      const data = await api.getTransfer(id);
      setTransfer(data.transfer);
      if (data.transfer) {
        setRefundRupees((Number(data.transfer.amount) / 100).toString());
      }
    } catch (err) {
      setError(err.message || 'Failed to load transfer');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTransfer();
  }, [id]);

  async function handleExecuteRefund(e) {
    e.preventDefault();
    setRefundError(null);
    setRefunding(true);

    const paise = Math.round(parseFloat(refundRupees) * 100);
    if (isNaN(paise) || paise <= 0) {
      setRefundError('Please enter a valid refund amount');
      setRefunding(false);
      return;
    }

    try {
      await api.refundTransfer(transfer.id, {
        amount: paise,
        reason: refundReason
      });
      window.dispatchEvent(new Event('bgc_ledger_updated'));
      setShowRefundModal(false);
      loadTransfer();
    } catch (err) {
      setRefundError(err.message || 'Refund failed');
    } finally {
      setRefunding(false);
    }
  }


  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-xs text-slate-400">Loading transfer and ledger entries...</p>
      </div>
    );
  }

  if (error || !transfer) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl">
        <AlertCircle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-white">Transfer Not Found</h2>
        <p className="text-xs text-slate-400 mt-1">{error || 'Could not locate transfer record.'}</p>
        <Link to="/transfers" className="inline-block mt-4 text-xs font-semibold text-indigo-400">
          ← Back to Transfers
        </Link>
      </div>
    );
  }

  const canRefund =
    transfer.status === 'COMPLETED' || transfer.status === 'PARTIALLY_REFUNDED';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Navigation & Header */}
      <div className="flex items-center justify-between">
        <Link
          to="/transfers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Transfers</span>
        </Link>
        {canRefund && (
          <button
            onClick={() => setShowRefundModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Issue Refund</span>
          </button>
        )}
      </div>

      {/* Main Transfer Overview Card */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-white tracking-tight">
                Transfer Details
              </h1>
              <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-slate-800 text-indigo-300 border border-slate-700">
                {transfer.status}
              </span>
            </div>
            <p className="text-xs font-mono text-slate-400 mt-1">ID: {transfer.id}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Total Amount</span>
            <p className="text-2xl font-bold text-white font-mono mt-0.5">
              {formatPaise(transfer.amount)}
            </p>
          </div>
        </div>

        {/* Parties and Keys Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Source (Debit)</span>
            <p className="text-white font-bold mt-1">{transfer.source_user_email || transfer.source_account_type}</p>
            <p className="text-slate-500 font-mono text-[10px] mt-0.5">{transfer.source_account_id}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Destination (Credit)</span>
            <p className="text-white font-bold mt-1">{transfer.destination_user_email || transfer.destination_account_type}</p>
            <p className="text-slate-500 font-mono text-[10px] mt-0.5">{transfer.destination_account_id}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Idempotency Key</span>
            <p className="text-indigo-300 font-mono text-[11px] mt-1 break-all">{transfer.idempotency_key}</p>
            <p className="text-slate-500 text-[10px] mt-0.5">Created: {new Date(transfer.created_at).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Double-Entry Ledger Rows Table */}
      <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
            <span>Double-Entry Ledger Rows (Immutable)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            PostgreSQL triggers prevent any UPDATE or DELETE. Corrections require new reversing entries.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Entry ID</th>
                <th className="py-2.5 px-3">Account ID</th>
                <th className="py-2.5 px-3">Entry Type</th>
                <th className="py-2.5 px-3">Amount</th>
                <th className="py-2.5 px-3">Balance After</th>
                <th className="py-2.5 px-3 text-right">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {!transfer.entries || transfer.entries.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-6 text-center text-slate-500 font-sans">
                    No ledger entries created (e.g. transfer is held for review or rejected).
                  </td>
                </tr>
              ) : (
                transfer.entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-3 text-slate-400">#{entry.id}</td>
                    <td className="py-3 px-3 text-slate-200">{entry.account_id}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          entry.entry_type === 'DEBIT'
                            ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                        }`}
                      >
                        {entry.entry_type}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-bold text-white">{formatPaise(entry.amount)}</td>
                    <td className="py-3 px-3 text-slate-300">{formatPaise(entry.balance_after)}</td>
                    <td className="py-3 px-3 text-right text-slate-500 font-sans text-[11px]">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-1">Issue Reversing Refund</h2>
            <p className="text-xs text-slate-400 mb-4">
              Posts reversing ledger entries. Original entries remain completely untouched.
            </p>

            {refundError && (
              <div className="mb-4 p-2.5 rounded bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                {refundError}
              </div>
            )}

            <form onSubmit={handleExecuteRefund} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Refund Amount (INR ₹)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={(Number(transfer.amount) / 100).toString()}
                  value={refundRupees}
                  onChange={(e) => setRefundRupees(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                  required
                />
                <span className="text-[10px] text-slate-500">
                  Maximum refundable: {formatPaise(transfer.amount)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Refund Reason</label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refunding}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md disabled:opacity-50"
                >
                  {refunding ? 'Posting Reversal...' : 'Confirm Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

