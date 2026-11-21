# Appendix: Core System Code

The following code excerpts represent the central implementation of the CNHS Bullying Reporting and Management System: application routing, authentication, API communication, incident reporting, case status updates, notifications, and database structure.

## A. Application Entry Point

This figure shows the core application entry point of the CNHS Bullying Reporting and Management System. This source code initializes React, loads the main application component and global styles, and enables browser-based routing.

Source: `src/main.jsx`

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/Global.css";
import "./styles/SystemDesign.css";
import { BrowserRouter } from "react-router-dom";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

Source: `src/App.jsx`

```jsx
import AppRoutes from "./routes/AppRoutes";

export default function App() {
  return <AppRoutes />;
}
```

## B. Role-Based Protected Routing

This figure shows the core routing and access-control process of the system. This source code verifies the current user session and redirects unauthenticated users to the login page, while allowing students and administrators to access only their respective dashboards.

Source: `src/routes/AppRoutes.jsx`

```jsx
import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AwarenessLanding from "../pages/AwarenessLanding";
import Login from "../pages/Login";
import StudentDashboard from "../pages/StudentDashboard";
import AdminDashboard from "../pages/AdminDashboard";
import { getCurrentSession } from "../lib/auth";

function ProtectedRoute({ role, children }) {
  const [session, setSession] = useState({
    loading: true,
    user: null,
    error: "",
  });

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
  }, []);

  if (session.loading) {
    return <main role="status">Checking your account session…</main>;
  }
  if (session.error) {
    return <main role="alert">Could not verify your account session: {session.error}</main>;
  }
  if (!session.user) return <Navigate to="/login" replace />;
  if (session.user.role !== role) {
    return (
      <Navigate
        to={session.user.role === "admin" ? "/admindashboard" : "/studentdashboard"}
        replace
      />
    );
  }
  return children;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AwarenessLanding />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/studentdashboard"
        element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>}
      />
      <Route
        path="/admindashboard"
        element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

## C. Frontend Authentication

This figure shows the core authentication process of the system for student and administrator accounts. This source code handles sign-in, login OTP verification, session restoration, user profile caching, and logout using the system's server-side authentication service.

Source: `src/lib/auth.js`

```js
export async function signIn(email, password) {
  try {
    const result = await authRequest("signin", { email, password });
    if (result.needsLoginOtp) {
      return { success: true, needsLoginOtp: true };
    }
    if (typeof result.token !== "string" || !result.token) {
      throw new Error("The server did not create a session.");
    }
    localStorage.setItem("cnhsSessionToken", result.token);
    if (result.role === "admin") cacheAdminSession(result.profile);
    else cacheStudentSession(result.profile);
    return {
      success: true,
      role: result.role,
      [result.role]: result.profile,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function verifyLoginOtp(email, code) {
  try {
    const result = await authRequest("verify-login", { email, code });
    if (typeof result.token !== "string" || !result.token) {
      throw new Error("The server did not create a session.");
    }
    localStorage.setItem("cnhsSessionToken", result.token);
    if (result.role === "admin") cacheAdminSession(result.profile);
    else cacheStudentSession(result.profile);
    return { success: true, role: result.role };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getCurrentSession() {
  if (!localStorage.getItem("cnhsSessionToken")) return null;

  const result = await authRequest("session");
  if (!result.user && !result.profile) {
    clearCachedSession();
    return null;
  }
  if (!["admin", "student"].includes(result.role) || !result.profile) {
    throw new Error("The server returned an invalid account session.");
  }

  if (result.role === "admin") cacheAdminSession(result.profile);
  else cacheStudentSession(result.profile);

  return { role: result.role, profile: result.profile };
}

export async function signOut() {
  clearCachedSession();
}
```

## D. Frontend-to-Edge-Function Communication

This figure shows the core communication process between the frontend and backend of the system. This source code sends actions and request data to the Supabase Edge Function in JSON format and includes session credentials for authenticated database and service operations.

Source: `src/lib/apiClient.js`

```js
async function post(action, data = {}) {
  const projectUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!projectUrl || !anonKey) {
    throw new Error(
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY "
      + "in the frontend environment."
    );
  }

  const sessionToken = localStorage.getItem("cnhsSessionToken");
  const response = await fetch(
    `${projectUrl.replace(/\/$/, "")}/functions/v1/api`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${sessionToken || anonKey}`,
      },
      body: JSON.stringify({ action, ...data }),
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "The server could not complete the request.");
  }
  return payload;
}

export async function authRequest(action, data = {}) {
  return post(action, data);
}

export const supabase = {
  from(table) {
    return new DatabaseQuery(table);
  },

  async rpc(functionName, args = {}) {
    try {
      return { data: await post("rpc", { functionName, args }), error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error.message, code: error.code },
      };
    }
  },
};
```

## E. Student Registration and Login Request

This figure shows the core login workflow of the student and administrator accounts. This source code validates the entered credentials, requests authentication from the server, handles email OTP verification, and redirects the authenticated user to the appropriate dashboard.

Source: `src/pages/Login.jsx`

```jsx
const handleLogin = async (e) => {
  e.preventDefault();
  setError("");
  setSuccess("");

  if (!email.trim() || !password.trim()) {
    setError("Please enter your email and password.");
    return;
  }

  setLoading(true);
  const result = await signIn(email.trim(), password);
  setLoading(false);

  if (!result.success) {
    setError(result.error);
    return;
  }
  if (result.needsLoginOtp) {
    setPassword("");
    setMode("login-otp");
    setSuccess("A 6-digit sign-in code was sent to your email.");
    return;
  }

  navigate(result.role === "admin" ? "/admindashboard" : "/studentdashboard");
};
```

## F. Core Incident Submission

This figure shows the core incident-report submission process of the system. This source code collects report details, involved persons, anonymity preferences, evidence, and student information, calculates the report priority, and saves the report with a `Pending` status.

Source: `src/data/store.js`

```js
export async function submitReport(reportData, evidenceFiles = []) {
  const existingReports = await getReportPriorityContext();
  const submittedBy = getCurrentUserName();

  const row = {
    type: reportData.type,
    date: reportData.date,
    time: reportData.time || null,
    location: reportData.location || null,
    description: reportData.description || null,
    description_lead_up: reportData.descriptionLeadUp || null,
    description_impact: reportData.descriptionImpact || null,
    description_actions: reportData.descriptionActions || null,
    reporter_type: reportData.reporterType || null,
    victims: reportData.victims || [],
    offenders: reportData.offenders || [],
    witnesses: reportData.witnesses || [],
    status: "Pending",
    submitted_by: submittedBy,
    submitted_id: getCurrentUserId(),
    reporter_age: getCurrentUserAge() || null,
    reporter_sex: getCurrentUserSex() || null,
    reporter_grade: getCurrentUserGrade() || null,
    reporter_section: getCurrentUserSection() || null,
    is_anonymous: !!reportData.isAnonymous,
    admin_notes: "",
    evidence: evidenceFiles,
  };

  row.priority = computePriority(
    {
      type: row.type,
      status: row.status,
      date: row.date,
      submittedBy: row.submitted_by,
      id: -1,
    },
    existingReports
  );

  const { data, error } = await supabase
    .from("reports")
    .insert(row)
    .select(REPORT_COLUMNS_WITHOUT_EVIDENCE)
    .single();

  if (error) throw error;
  return reportRowToObj(data);
}
```

## G. Case Status Update and Student Notification

This figure shows the core case-management process of the system. This source code allows an administrator to update a report status and monitoring period, record the change, recalculate the case priority, and notify the affected student.

Source: `src/data/store.js`

```js
export async function updateReportStatus(
  reportId,
  newStatus,
  adminNotes = "",
  { auditReason = "", monitoringUntil } = {}
) {
  if (newStatus === "More Information Requested" && !adminNotes.trim()) {
    throw new Error(
      "Please explain what additional proof or information is needed."
    );
  }

  const { data: currentRow, error: fetchError } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS_WITHOUT_EVIDENCE)
    .eq("id", reportId)
    .single();
  if (fetchError) throw fetchError;

  const nextMonitoringUntil = monitoringUntil === undefined
    ? currentRow.monitoring_until || null
    : monitoringUntil || null;

  const allReports = (await getReportPriorityContext())
    .filter((report) => report.id !== reportId);

  const priority = computePriority(
    reportRowToObj({
      ...currentRow,
      status: newStatus,
      admin_notes: adminNotes,
      monitoring_until: nextMonitoringUntil,
    }),
    allReports
  );

  const data = await offenseRpc("update_report_case_status", {
    target_report_id: reportId,
    next_status: newStatus,
    staff_notes: adminNotes,
    audit_reason: auditReason,
    monitor_until: nextMonitoringUntil,
    next_priority: priority,
  });

  await addStudentNotification(
    {
      title: `Case #${reportId} status updated to '${newStatus}'`,
      type: "status",
    },
    data.submitted_id
  );

  return reportRowToObj(data);
}

async function addStudentNotification(notif, studentId) {
  const { error } = await supabase
    .from("notifications")
    .insert({
      audience: "student",
      student_id: studentId,
      title: notif.title,
      type: notif.type,
      read: false,
    });
  if (error) throw error;
}
```

## H. Server-Side API and Session Validation

This figure shows the core server-side authentication and request-validation process of the system. This source code verifies the signed session token, account role, and session version before processing protected database operations and authentication actions.

Source: `supabase/functions/_shared/api.js`

```js
async function getSession(req, { optional = false } = {}) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const payload = token ? verifyToken(token) : null;

  if (!payload) {
    if (optional) return null;
    throw Object.assign(
      new Error("Please sign in to continue."),
      { status: 401 }
    );
  }

  const { data: account, error } = await getDatabase()
    .from("auth_credentials")
    .select("id,email,role,email_verified,session_version")
    .eq("id", payload.sub)
    .maybeSingle();

  if (error) throw error;
  if (
    !account ||
    !account.email_verified ||
    account.role !== payload.role ||
    account.session_version !== payload.ver
  ) {
    if (optional) return null;
    throw Object.assign(
      new Error("Your session has expired. Please sign in again."),
      { status: 401 }
    );
  }

  return {
    id: account.id,
    email: account.email,
    role: account.role,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed." });
    }

    const body = await readJson(req);
    const result = body.action === "rpc"
      ? await runRpc(body.functionName, body.args || {}, req)
      : await handleAuth(body.action, body, req);

    return send(res, 200, result);
  } catch (error) {
    const status =
      Number(error.status) || (error.code === "23505" ? 409 : 500);
    return send(res, status, {
      error: status === 500
        ? "The request could not be completed. Please try again later."
        : error.message,
    });
  }
}
```

## I. Main Database Tables

This figure shows the core database structure of the system. This source code defines the main tables for student and administrator accounts, incident reports, and notifications, including the relationships that connect reports and notifications to students.

Source: `supabase/schema.sql`

```sql
create table students (
  id uuid primary key,
  name text not null,
  email text unique not null,
  lrn text unique,
  age int,
  sex text,
  grade text,
  section text,
  student_id_front_path text,
  approved boolean not null default false,
  created_at timestamptz default now()
);

create table admins (
  id uuid primary key,
  email text unique not null,
  name text
);

create table reports (
  id bigint generated always as identity primary key,
  type text not null,
  date date not null,
  time text,
  location text,
  description text,
  description_lead_up text,
  description_impact text,
  description_actions text,
  reporter_type text,
  victims jsonb default '[]',
  offenders jsonb default '[]',
  witnesses jsonb default '[]',
  status text default 'Pending',
  priority text,
  submitted_by text,
  submitted_id uuid references students(id) on delete cascade,
  is_anonymous boolean default false,
  admin_notes text,
  evidence jsonb default '[]',
  scheduled_conference jsonb,
  under_investigation_at timestamptz,
  resolved_at timestamptz,
  monitoring_until date,
  submitted_at timestamptz default now(),
  updated_at timestamptz
);

create table notifications (
  id bigint generated always as identity primary key,
  audience text
    check (audience in ('student', 'admin')) not null,
  student_id uuid references students(id) on delete cascade,
  title text,
  type text,
  read boolean default false,
  created_at timestamptz default now()
);
```

## J. Database Security and Status Automation

This figure shows the core database security and status automation process of the system. This source code implements row-level access control for students and administrators and automatically records investigation and resolution timestamps when a report status changes.

Source: `supabase/schema.sql`

```sql
alter table students enable row level security;
alter table admins enable row level security;
alter table reports enable row level security;
alter table notifications enable row level security;

create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

create policy "reports insert own" on reports for insert
  with check (auth.uid() = submitted_id);

create policy "reports select own or admin" on reports for select
  using (auth.uid() = submitted_id or is_admin());

create policy "reports update admin" on reports for update
  using (is_admin());

create or replace function set_report_status_timestamps()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Under Investigation'
      and new.under_investigation_at is null then
      new.under_investigation_at := now();
    end if;
    if new.status = 'Resolved'
      and new.resolved_at is null then
      new.resolved_at := now();
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'Pending' then
      new.under_investigation_at := null;
      new.resolved_at := null;
    elsif new.status = 'Under Investigation' then
      new.under_investigation_at := now();
      new.resolved_at := null;
    elsif new.status = 'Resolved' then
      new.resolved_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger reports_stamp_status_timestamps
before insert or update of status on reports
for each row execute function set_report_status_timestamps();
```
