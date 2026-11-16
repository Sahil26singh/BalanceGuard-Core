import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Scale, CheckCircle, RefreshCw, Loader2, Play, Sparkles } from 'lucide-react';
import { formatPaise } from '../utils/format.js';

export function Reconciliation() {
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function loadRuns() {
    setLoading(true);
    try {
      const data = await api.listReconciliationRuns();
      setRuns(data.runs || []);
      if (data.runs?.length > 0 && !selectedRun) {
        loadRunDetails(data.runs[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadRunDetails(runId) {
    try {
      const data = await api.getReconciliationRun(runId);
      setSelectedRun(data.run);
    } catch {
      // Catch
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function handleTriggerRun(simulateMismatches = false) {
    setRunning(true);
    try {
      const result = await api.runReconciliation(simulateMismatches);
      await loadRuns();
      if (result.run) {
        await loadRunDetails(result.run.id);
      }
    } finally {
      setRunning(false);
    }
  }


  function getDiscrepancyBadge(type) {
    switch (type) {
      case 'MISSING_IN_INTERNAL':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800/60">MISSING_IN_INTERNAL</span>;
      case 'MISSING_IN_PROVIDER':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800/60">MISSING_IN_PROVIDER</span>;
      case 'AMOUNT_MISMATCH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800/60">AMOUNT_MISMATCH</span>;
      case 'DUPLICATE_EXTERNAL':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/60">DUPLICATE_EXTERNAL</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">{type}</span>;
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Reconciliation Center</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Cross-system settlement verification between internal PostgreSQL ledger and gateway settlement files.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleTriggerRun(false)}
            disabled={running}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 text-indigo-400" />
            <span>Run Clean Reconciliation</span>
          </button>
          <button
            onClick={() => handleTriggerRun(true)}
            disabled={running}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950 transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Run With Seeded Mismatches</span>
          </button>
        </div>
      </div>

      {/* Principle Banner */}
      <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-800/40 flex items-start gap-3 text-xs text-indigo-200">
        <Scale className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white">Reconciliation Invariant:</span> Automated reconciliation{' '}
          <strong className="text-indigo-300">NEVER auto-fixes money or mutates ledger entries</strong>. Any detected anomaly is logged as an immutable discrepancy for compliance officer investigation.
        </div>
      </div>

      {/* Two Column Layout: Historical Runs & Discrepancies Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Runs List */}
        <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-white">Reconciliation Runs</h2>
            <button onClick={loadRuns} className="text-slate-400 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
              <span>Loading runs...</span>
            </div>
          ) : runs.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              No reconciliation runs executed yet. Click "Run" above to trigger.
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadRunDetails(r.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedRun?.id === r.id
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-white'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">
                      {new Date(r.started_at).toLocaleDateString()} {new Date(r.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span
                      className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                        r.discrepancy_count > 0
                          ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                      }`}
                    >
                      {r.discrepancy_count} Discrepancies
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Matched: {r.matched_count}</span>
                    <span className="font-mono text-[10px]">{r.id.slice(0, 8)}...</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Detailed Discrepancy Table */}
        <div className="lg:col-span-2 bg-slate-900/90 rounded-2xl border border-slate-800 p-5 shadow-xl space-y-4">
          {!selectedRun ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              Select a reconciliation run on the left to inspect discrepancies.
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Run Summary: {selectedRun.id.slice(0, 8)}...</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                      {selectedRun.status}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    Completed at: {new Date(selectedRun.completed_at || selectedRun.started_at).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-500 block">Matched</span>
                    <span className="text-emerald-400 font-bold">{selectedRun.matched_count}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-500 block">Discrepancies</span>
                    <span className="text-amber-400 font-bold">{selectedRun.discrepancy_count}</span>
                  </div>
                </div>
              </div>

              {/* Discrepancies Table */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                  Flagged Discrepancy Items ({selectedRun.discrepancies?.length || 0})
                </h4>

                {!selectedRun.discrepancies || selectedRun.discrepancies.length === 0 ? (
                  <div className="py-8 text-center bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-emerald-400 flex items-center justify-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>Clean settlement! Zero discrepancies detected in this reconciliation run.</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Transfer / Ref ID</th>
                          <th className="py-2.5 px-3">Internal Amt</th>
                          <th className="py-2.5 px-3">External Amt</th>
                          <th className="py-2.5 px-3">Audit Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {selectedRun.discrepancies.map((d) => (
                          <tr key={d.id} className="hover:bg-slate-800/40">
                            <td className="py-3 px-3 font-sans font-semibold">
                              {getDiscrepancyBadge(d.discrepancy_type)}
                            </td>
                            <td className="py-3 px-3 text-slate-300">
                              {d.transfer_id ? d.transfer_id.slice(0, 8) + '...' : d.external_reference_id || 'N/A'}
                            </td>
                            <td className="py-3 px-3 text-slate-200">
                              {formatPaise(d.internal_amount, 'N/A')}
                            </td>
                            <td className="py-3 px-3 text-slate-200">
                              {formatPaise(d.external_amount, 'N/A')}
                            </td>
                            <td className="py-3 px-3 font-sans text-slate-400 text-[11px] max-w-xs truncate">
                              {d.details?.reason || JSON.stringify(d.details)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

