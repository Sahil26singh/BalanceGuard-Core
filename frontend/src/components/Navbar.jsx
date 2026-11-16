import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { ShieldCheck, ShieldAlert, ArrowRightLeft, LayoutDashboard, Scale, FlaskConical, FileText, LogOut, RefreshCw } from 'lucide-react';

export function Navbar({ user, onLogout }) {
  const [integrity, setIntegrity] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [auditing, setAuditing] = useState(false);
  const navigate = useNavigate();

  async function fetchNavbarData(manualClick = false) {
    if (manualClick) setAuditing(true);
    try {
      const [intData, queueData] = await Promise.all([
        api.getLedgerIntegrity().catch(() => null),
        api.getReviewQueue().catch(() => null)
      ]);

      if (intData?.integrity) setIntegrity(intData.integrity);
      if (queueData?.total !== undefined) setQueueCount(queueData.total);
    } catch {
      // Silently catch
    } finally {
      if (manualClick) setAuditing(false);
    }
  }

  useEffect(() => {
    // 1. Initial check on mount
    fetchNavbarData();

    // 2. Event-driven audit: refetch only when actions occur (transfers, refunds, approvals)
    function handleLedgerUpdate() {
      fetchNavbarData();
    }
    window.addEventListener('bgc_ledger_updated', handleLedgerUpdate);

    // 3. Conservative 60-second timer ONLY while tab is actively visible (protects Neon compute sleep)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchNavbarData();
      }
    }, 60000);

    return () => {
      window.removeEventListener('bgc_ledger_updated', handleLedgerUpdate);
      clearInterval(interval);
    };
  }, []);

  const navItemClass = ({ isActive }) =>
    `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 border-b border-slate-800 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center space-x-6">
            <NavLink to="/" className="flex items-center gap-2.5 group">
              <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 group-hover:border-indigo-400 transition-colors">
                <ShieldCheck className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300" />
              </div>
              <div>
                <span className="text-base font-bold text-white tracking-tight">
                  BalanceGuard <span className="text-indigo-400">Core</span>
                </span>
                <span className="hidden sm:inline-block ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  v1.0
                </span>
              </div>
            </NavLink>

            {/* Clickable Ledger Integrity Badge (Event-Driven & Cached) */}
            <button
              onClick={() => fetchNavbarData(true)}
              title="Click to manually verify ledger integrity (Debits == Credits)"
              className="hidden md:flex items-center cursor-pointer transition-transform active:scale-95"
            >
              {integrity?.isBalanced ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 hover:border-emerald-400 transition-colors shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ledger Balanced</span>
                  {auditing && <RefreshCw className="w-3 h-3 ml-1 animate-spin text-emerald-300" />}
                </div>
              ) : integrity ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950/70 border border-rose-500/40 text-rose-400">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  <span>Integrity Alert</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-800 text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                  <span>Auditing...</span>
                </div>
              )}
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center space-x-1">
            <NavLink to="/" end className={navItemClass}>
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/transfers" className={navItemClass}>
              <ArrowRightLeft className="w-4 h-4" />
              <span>Transfers</span>
            </NavLink>
            <NavLink to="/risk" className={navItemClass}>
              <ShieldAlert className="w-4 h-4" />
              <span>Risk Queue</span>
              {queueCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {queueCount}
                </span>
              )}
            </NavLink>
            <NavLink to="/reconciliation" className={navItemClass}>
              <Scale className="w-4 h-4" />
              <span>Reconciliation</span>
            </NavLink>
            <NavLink to="/demo-lab" className={navItemClass}>
              <FlaskConical className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-300 font-semibold">Demo Lab</span>
            </NavLink>
            <NavLink to="/audit" className={navItemClass}>
              <FileText className="w-4 h-4" />
              <span>Audit Log</span>
            </NavLink>
          </nav>

          {/* User Profile & Logout */}
          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-medium text-slate-200">{user?.email}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                {user?.role}
              </span>
            </div>
            <button
              onClick={() => {
                onLogout();
                navigate('/login');
              }}
              title="Sign out"
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-100 border border-slate-700/60 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
