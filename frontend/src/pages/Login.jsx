import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { ShieldCheck, Lock, Mail, ArrowRight, ShieldAlert, Sparkles, Loader2 } from 'lucide-react';

export function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [demoCreds, setDemoCreds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch demo credentials if available in demo mode
    api.getDemoCredentials()
      .then((data) => {
        if (data?.demoMode) setDemoCreds(data.credentials);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await api.login(email, password);
      onLoginSuccess(data.user);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  function fillCredentials(cred) {
    setEmail(cred.email);
    setPassword(cred.password);
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-slate-950">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex p-3 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-4 shadow-lg shadow-indigo-950">
          <ShieldCheck className="w-10 h-10 text-indigo-400" />
        </div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          BalanceGuard <span className="text-indigo-400">Core</span>
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Double-Entry Ledger, Idempotent APIs & AI Risk Engine
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900/90 py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {error && (
            <div className="mb-6 p-3 rounded-lg bg-rose-950/60 border border-rose-800/60 flex items-start gap-2.5 text-rose-300 text-xs">
              <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@balanceguard.local"
                  className="block w-full pl-9 pr-3 py-2 bg-slate-950/80 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-9 pr-3 py-2 bg-slate-950/80 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center items-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500 transition-colors shadow-lg shadow-indigo-900/40 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Demo Mode Quick Access */}
          {demoCreds && demoCreds.length > 0 && (
            <div className="mt-8 pt-6 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-3">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Demo Mode Credentials</span>
              </div>
              <div className="space-y-2">
                {demoCreds.map((cred) => (
                  <button
                    key={cred.role}
                    type="button"
                    onClick={() => fillCredentials(cred)}
                    className="w-full text-left p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200 capitalize">{cred.role}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/40">
                          {cred.email}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{cred.description}</p>
                    </div>
                    <span className="text-xs font-medium text-indigo-400 group-hover:text-indigo-300 flex-shrink-0 ml-2">
                      Fill
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 text-center text-[11px] text-slate-500">
            Powered by Neon PostgreSQL, Redis Cloud, Render & Gemini AI.
          </div>
        </div>
      </div>
    </div>
  );
}

