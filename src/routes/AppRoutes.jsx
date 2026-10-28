import { Routes, Route, Navigate } from "react-router-dom";

import AwarenessLanding  from "../pages/AwarenessLanding";
import Login             from "../pages/Login";
import EmailConfirmed    from "../pages/EmailConfirmed";
import StudentDashboard  from "../pages/StudentDashboard";
import AdminDashboard    from "../pages/AdminDashboard";


export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/"                  element={<AwarenessLanding />} />
      <Route path="/login"             element={<Login />} />
      <Route path="/email-confirmed"   element={<EmailConfirmed />} />
      <Route path="/studentdashboard"  element={<StudentDashboard />} />
      <Route path="/admindashboard"    element={<AdminDashboard />} />

      {/* Catch-all: redirect unknown paths to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
