import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatPaise } from '../utils/format.js';
import { ShieldCheck, ShieldAlert, ArrowRightLeft, Wallet, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';

export function Dashboard() {
  const [integrity, setIntegrity] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [riskQueue, setRiskQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    try {
      const [intRes, accRes, txRes, riskRes] = await Promise.all([
        api.getLedgerIntegrity().catch(() => null),
        api.listAccounts().catch(() => ({ accounts: [] })),
        api.listTransfers({ limit: 10 }).catch(() => ({ transfers: [] })),
        api.getReviewQueue().catch(() => ({ queue: [] }))
      ]);

      if (intRes?.integrity) setIntegrity(intRes.integrity);
      setAccounts(accRes.accounts || []);
      setTransfers(txRes.transfers || []);
      setRiskQueue(riskRes.queue || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    loadData();
  }


  function getStatusBadge(status) {
    switch (status) {
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">COMPLETED</span>;
      case 'HELD_FOR_REVIEW':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60">HELD_FOR_REVIEW</span>;
      case 'REJECTED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800/60">REJECTED</span>;
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60">{status}</span>;
      case 'REVERSED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">REVERSED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300">{status}</span>;
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-400">Loading ledger state and accounts...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Ledger Operations Overview</h1>
          <p className="text-xs text-slate-400">
            Real-time double-entry equilibrium, account balances, and automated compliance risk stream.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700/80 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh State</span>
          </button>
          <Link
            to="/demo-lab"
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950 transition-colors"
          >
            <span>Open Demo Lab</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Ledger Integrity Hero Card */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950/50 border border-slate-800 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl border ${integrity?.isBalanced ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-400' : 'bg-rose-950/80 border-rose-500/40 text-rose-400'}`}>
              {integrity?.isBalanced ? <ShieldCheck className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-white">Mathematical Ledger Equilibrium</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${integrity?.isBalanced ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60' : 'bg-rose-950 text-rose-300 border border-rose-700/60'}`}>
                  {integrity?.isBalanced ? 'BALANCED' : 'OUT OF BALANCE'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                Every transaction posts atomic debit and credit pairs. Integrity verified: total debits equal total credits across {integrity?.totalEntries || 0} ledger entries with {integrity?.discrepancies?.length || 0} account discrepancies.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-t md:border-t-0 md:border-l border-slate-800 pt-4 md:pt-0 md:pl-6">
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Debits</span>
              <p className="text-sm font-bold text-slate-100 font-mono mt-0.5">{formatPaise(integrity?.totalDebits)}</p>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Credits</span>
              <p className="text-sm font-bold text-slate-100 font-mono mt-0.5">{formatPaise(integrity?.totalCredits)}</p>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Accounts Audited</span>
              <p className="text-sm font-bold text-indigo-400 font-mono mt-0.5">{integrity?.accountsAudited || accounts.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Account Balances Grid */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-indigo-400" />
          <span>Accounts & Cached Balances</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-semibold">{acc.account_type}</span>
                <span className="font-mono text-[10px]">v{acc.version}</span>
              </div>
              <div className="text-lg font-bold text-white font-mono tracking-tight">
                {formatPaise(acc.balance)}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between">
                <span className="truncate">{acc.user_email || 'Platform Singleton'}</span>
                <span className="text-slate-500 font-mono text-[10px]">{acc.id.slice(0, 8)}...</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two Column Section: Recent Transfers & Risk Review Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Transfers (2/3 width) */}
        <div className="lg:col-span-2 bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
              <span>Recent Money Movements</span>
            </h3>
            <Link to="/transfers" className="text-xs font-semibold text-indigo-400 hover:text-indigo-300">
              View All Transfers →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Parties</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-6 text-center text-slate-500">
                      No transfers found. Use the Demo Lab to create demo transactions.
                    </td>
                  </tr>
                ) : (
                  transfers.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 font-semibold text-slate-300">
                        {tx.transfer_type}
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-200 text-xs">
                          {tx.source_user_email || tx.source_account_type}
                        </div>
                        <div className="text-slate-500 text-[10px]">
                          → {tx.destination_user_email || tx.destination_account_type}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-white">
                        {formatPaise(tx.amount)}
                      </td>
                      <td className="py-3 px-3">
                        {getStatusBadge(tx.status)}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <Link
                          to={`/transfers/${tx.id}`}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold"
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

        {/* Right Column: Pending Compliance Risk Queue (1/3 width) */}
        <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Flagged Risk Queue</span>
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800/60">
                {riskQueue.length} Pending
              </span>
            </div>

            {riskQueue.length === 0 ? (
              <div className="py-10 text-center">
                <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
                <p className="text-xs font-semibold text-slate-300">Queue Clean</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                  No transfers currently held for review. High-risk transactions will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {riskQueue.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-950/80 border border-amber-500/30 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-300">
                        Score: {item.risk_score} / 100
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {formatPaise(item.amount)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 line-clamp-2 italic">
                      "{item.risk_explanation || 'Awaiting compliance analysis...'}"
                    </p>
                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">
                        {item.source_user_email || 'User'}
                      </span>
                      <Link
                        to="/risk"
                        className="text-[11px] font-semibold text-amber-400 hover:text-amber-300"
                      >
                        Review Now →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-center">
            <Link
              to="/risk"
              className="w-full inline-block py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30 transition-colors"
            >
              Open Compliance Queue ({riskQueue.length})
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

