import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { formatPaise } from '../utils/format.js';
import { ShieldCheck, CheckCircle, XCircle, Sparkles, RefreshCw, Loader2 } from 'lucide-react';

export function RiskQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTransfer, setSelectedTransfer] = useState(null);
  const [decision, setDecision] = useState('APPROVED');
  const [reviewNote, setReviewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState(null);

  async function loadQueue() {
    setLoading(true);
    try {
      const data = await api.getReviewQueue();
      setQueue(data.queue || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  async function handleSubmitReview(e) {
    e.preventDefault();
    if (!selectedTransfer) return;
    setModalError(null);
    setSubmitting(true);

    try {
      await api.submitReview(selectedTransfer.id, decision, reviewNote);
      window.dispatchEvent(new Event('bgc_ledger_updated'));
      setSelectedTransfer(null);
      setReviewNote('');
      loadQueue();
    } catch (err) {
      setModalError(err.message || 'Review submission failed');
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-white tracking-tight">Compliance Risk Queue</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800/60">
              {queue.length} Pending Review
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Transfers held by automated deterministic heuristics. Reviewers decide final routing. AI never moves money.
          </p>
        </div>
        <button
          onClick={loadQueue}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Queue Items */}
      {loading ? (
        <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-12">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-xs text-slate-400">Loading flagged transfers...</p>
        </div>
      ) : queue.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl">
          <ShieldCheck className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-90" />
          <h2 className="text-lg font-bold text-white">Review Queue Clear</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Zero transfers currently held for manual review. All recent transactions passed automated risk heuristics.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {queue.map((item) => (
            <div
              key={item.id}
              className="p-5 rounded-2xl bg-slate-900 border border-amber-500/30 hover:border-amber-500/50 transition-all shadow-xl space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 font-bold font-mono text-sm border border-amber-500/30">
                    {item.risk_score}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wide">
                        Risk Score: {item.risk_score} / 100
                      </span>
                      <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-800/60">
                        HELD_FOR_REVIEW
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">Transfer: {item.id}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-semibold text-slate-500">Amount</span>
                    <p className="text-base font-bold font-mono text-white">{formatPaise(item.amount)}</p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedTransfer(item);
                      setDecision('APPROVED');
                      setReviewNote('');
                    }}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition-colors"
                  >
                    Review Action
                  </button>
                </div>
              </div>

              {/* Signals and Explanation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* AI / Automated Explanation */}
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Compliance Summary</span>
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                      {item.explanation_source || 'AI Explainer'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 italic leading-relaxed">
                    "{item.risk_explanation || 'Awaiting automated risk explanation job...'}"
                  </p>
                </div>

                {/* Evaluated Heuristic Signals */}
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                  <span className="text-[11px] font-semibold text-slate-400">Triggered Heuristics</span>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-500 text-[10px] block">Amount Ratio</span>
                      <span className="text-slate-200 font-bold">{item.risk_signals?.amountRatio || '1.0'}x</span>
                    </div>
                    <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-500 text-[10px] block">Velocity (10m)</span>
                      <span className="text-slate-200 font-bold">{item.risk_signals?.velocity10m ?? 'N/A'}</span>
                    </div>
                    <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-500 text-[10px] block">New Device</span>
                      <span className={item.risk_signals?.newDevice ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                        {item.risk_signals?.newDevice ? 'YES' : 'NO'}
                      </span>
                    </div>
                    <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
                      <span className="text-slate-500 text-[10px] block">First Payee</span>
                      <span className={item.risk_signals?.newPayee ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                        {item.risk_signals?.newPayee ? 'YES' : 'NO'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review Decision Modal */}
      {selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white">Compliance Review Action</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Reviewing transfer {selectedTransfer.id} ({formatPaise(selectedTransfer.amount)}).
              </p>
            </div>

            {modalError && (
              <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmitReview} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Decision</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDecision('APPROVED')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-2 transition-all ${
                      decision === 'APPROVED'
                        ? 'bg-emerald-950 border-emerald-500 text-emerald-300 shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>APPROVE & POST</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDecision('REJECTED')}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-2 transition-all ${
                      decision === 'REJECTED'
                        ? 'bg-rose-950 border-rose-500 text-rose-300 shadow-lg'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <XCircle className="w-4 h-4 text-rose-400" />
                    <span>REJECT TRANSFER</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  {decision === 'APPROVED'
                    ? 'Approving will execute atomic double-entry ledger entries in PostgreSQL.'
                    : 'Rejecting will mark transfer as REJECTED. Zero money moves.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mandatory Compliance Note
                </label>
                <textarea
                  rows="3"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Explain why this transfer was approved or rejected (minimum 5 characters)..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedTransfer(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || reviewNote.trim().length < 5}
                  className={`px-4 py-1.5 rounded-lg text-white text-xs font-bold shadow-md transition-colors disabled:opacity-50 ${
                    decision === 'APPROVED'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  {submitting ? 'Submitting...' : `Confirm ${decision}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

