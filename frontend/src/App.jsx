import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api/client.js';
import { WakeUpBanner } from './components/WakeUpBanner.jsx';
import { Navbar } from './components/Navbar.jsx';

import { Login } from './pages/Login.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Transactions } from './pages/Transactions.jsx';
import { TransactionDetail } from './pages/TransactionDetail.jsx';
import { RiskQueue } from './pages/RiskQueue.jsx';
import { Reconciliation } from './pages/Reconciliation.jsx';
import { DemoLab } from './pages/DemoLab.jsx';
import { AuditLog } from './pages/AuditLog.jsx';

export function App() {
  const [user, setUser] = useState(api.getStoredUser());

  useEffect(() => {
    function handleAuthChange() {
      setUser(api.getStoredUser());
    }
    window.addEventListener('bgc_auth_change', handleAuthChange);
    return () => window.removeEventListener('bgc_auth_change', handleAuthChange);
  }, []);

  function handleLogout() {
    api.logout();
    setUser(null);
  }

  return (
    <BrowserRouter>
      {/* Global "Server is Waking Up" Cold-Start Banner (Golden Rule 10) */}
      <WakeUpBanner />

      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
        {user && <Navbar user={user} onLogout={handleLogout} />}

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Routes>
            <Route
              path="/login"
              element={
                !user ? <Login onLoginSuccess={(u) => setUser(u)} /> : <Navigate to="/" replace />
              }
            />

            {/* Protected Routes */}
            <Route
              path="/"
              element={user ? <Dashboard /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/transfers"
              element={user ? <Transactions /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/transfers/:id"
              element={user ? <TransactionDetail /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/risk"
              element={user ? <RiskQueue /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/reconciliation"
              element={user ? <Reconciliation /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/demo-lab"
              element={user ? <DemoLab /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/audit"
              element={user ? <AuditLog /> : <Navigate to="/login" replace />}
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;

