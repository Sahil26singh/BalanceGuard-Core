import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Filter, RefreshCw, Loader2, Lock } from 'lucide-react';

export function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [entityType, setEntityType] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadLogs() {
    setLoading(true);
    try {
      const data = await api.listAuditLogs({ entityType: entityType || undefined, limit: 50 });
      setLogs(data.logs || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, [entityType]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Immutable Audit Log</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/60 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              <span>Append-Only</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Chronological forensic trail. Protected by PostgreSQL database trigger `trg_audit_log_immutable`.
          </p>
        </div>
        <button
          onClick={loadLogs}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors self-start sm:self-auto"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
        <Filter className="w-4 h-4 text-slate-500" />
        <span className="font-semibold text-slate-400">Filter Entity:</span>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
        >
          <option value="">All Entities</option>
          <option value="TRANSFER">TRANSFER</option>
          <option value="REFUND">REFUND</option>
          <option value="TOPUP">TOPUP</option>
          <option value="PAYOUT">PAYOUT</option>
        </select>
        <span className="text-xs text-slate-500 ml-auto font-mono">
          {logs.length} Audit Events Recorded
        </span>
      </div>

      {/* Audit Log Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800 font-sans">
              <tr>
                <th className="py-3 px-4">Seq #</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Metadata Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-[11px]">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-400 font-sans">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Loading audit records...</span>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-500 font-sans text-xs">
                    No audit records found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 text-indigo-400 font-bold">#{log.id}</td>
                    <td className="py-3 px-4 text-slate-400 font-sans text-[11px]">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-slate-200">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold text-[10px]">
                        {log.entity_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-emerald-400 font-bold">{log.action}</td>
                    <td className="py-3 px-4 font-sans">
                      <span className="text-slate-300">{log.actor_email || 'System / Gateway'}</span>
                      {log.actor_role && (
                        <span className="ml-1 text-[10px] text-slate-500 uppercase">({log.actor_role})</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400 max-w-sm truncate text-[10px]">
                      {JSON.stringify(log.metadata)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

