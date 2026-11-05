import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AwarenessLanding  from "../pages/AwarenessLanding";
import Login             from "../pages/Login";
import StudentDashboard  from "../pages/StudentDashboard";
import AdminDashboard    from "../pages/AdminDashboard";
import { getCurrentSession } from "../lib/auth";

function ProtectedRoute({ role, children }) {
  const [session, setSession] = useState({ loading: true, user: null, error: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getCurrentSession()
      .then((user) => {
        if (active) setSession({ loading: false, user, error: "" });
      })
      .catch((error) => {
        if (active) setSession({ loading: false, user: null, error: error.message });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  if (session.loading) {
    return <main role="status" aria-live="polite">Checking your account session…</main>;
  }
  if (session.error) {
    return (
      <main role="alert">
        <p>Could not verify your account session: {session.error}</p>
        <button type="button" onClick={() => {
          setSession({ loading: true, user: null, error: "" });
          setAttempt((current) => current + 1);
        }}>Try again</button>
      </main>
    );
  }
  if (!session.user) return <Navigate to="/login" replace />;
  if (session.user.role !== role) {
    return <Navigate to={session.user.role === "admin" ? "/admindashboard" : "/studentdashboard"} replace />;
  }
  return children;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/"                  element={<AwarenessLanding />} />
      <Route path="/login"             element={<Login />} />
      <Route path="/studentdashboard"  element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>} />
      <Route path="/admindashboard"    element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />

      {/* Catch-all: redirect unknown paths to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
