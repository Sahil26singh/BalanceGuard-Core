import React, { useState, useEffect } from 'react';
import { subscribeToWakeState } from '../api/client.js';
import { Loader2, Server } from 'lucide-react';

/**
 * Friendly notification banner displayed when the free cloud server is waking up from idle sleep.
 * Enforces Golden Rule 10.
 */
export function WakeUpBanner() {
  const [wakeState, setWakeState] = useState({ isWakingUp: false, wakeElapsedSec: 0 });

  useEffect(() => {
    return subscribeToWakeState(setWakeState);
  }, []);

  if (!wakeState.isWakingUp) {
    return null;
  }

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-indigo-950/90 border-b border-indigo-700/60 backdrop-blur-md px-4 py-3 shadow-2xl transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center p-2 rounded-lg bg-indigo-900/80 border border-indigo-500/40">
            <Server className="w-5 h-5 text-indigo-300" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
            </span>
          </div>
          <div>
            <p className="text-sm font-semibold text-indigo-100 flex items-center gap-2">
              Server is waking up (free cloud hosting sleeps when idle)
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
            </p>
            <p className="text-xs text-indigo-300">
              Spinning up the Render web service and Neon PostgreSQL compute container. This can take up to a minute... ({wakeState.wakeElapsedSec}s elapsed)
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded bg-indigo-900/50 border border-indigo-700/40 text-xs text-indigo-200">
          <span>Auto-retrying /health</span>
        </div>
      </div>
    </div>
  );
}

