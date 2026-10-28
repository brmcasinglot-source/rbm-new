/**
 * store.js — Supabase-backed data layer.
 * Both StudentDashboard and AdminDashboard import from here.
 *
 * All CRUD functions are async — callers must `await` them. Login,
 * registration, and session management live in src/lib/auth.js.
 */
import { supabase } from "../lib/supabaseClient";

// ─── CURRENT-USER CACHE ────────────────────────────────────────────────────
// Populated at login time by src/lib/auth.js. Kept as localStorage so the
// rest of the app can read "who's logged in" synchronously, same as before.
export function getCurrentUserName()    { return localStorage.getItem("studentName")    || "Student User"; }
export function getCurrentUserId()      { return localStorage.getItem("studentId")      || null; }
export function getCurrentUserAge()     { return localStorage.getItem("studentAge")     || ""; }
export function getCurrentUserSex()     { return localStorage.getItem("studentSex")     || ""; }
export function getCurrentUserGrade()   { return localStorage.getItem("studentGrade")   || ""; }
export function getCurrentUserSection() { return localStorage.getItem("studentSection") || ""; }

// ─── PRIORITY ENGINE (pure — unchanged) ───────────────────────────────────
export function computePriority(report, allReports = []) {
  const type   = (report.type   || "").toLowerCase();
  const status = (report.status || "").toLowerCase();

  if (status === "resolved") return "Low";

  const reportDate = new Date(report.date);
  const now        = new Date();
  const daysDiff   = (now - reportDate) / (1000 * 60 * 60 * 24);

  if (type === "physical") return "High";

  const recentSameStudent = allReports.filter(
    (r) =>
      r.id !== report.id &&
      r.submittedBy === report.submittedBy &&
      r.status !== "Resolved" &&
      (now - new Date(r.date)) / (1000 * 60 * 60 * 24) <= 7
  );
  if (recentSameStudent.length >= 1 && type !== "property") return "High";

  if (type === "cyber" || type === "verbal") {
    return daysDiff <= 3 ? "High" : "Medium";
  }

  if (daysDiff > 14) return "Low";
  return "Medium";
}

// Shared by the Sign Up form and the Submit Report form's Grade/Section
// pickers — must match the `grade` check constraint on grade_sections.
export const GRADE_OPTIONS = ["Grade 7", "Grade 8", "Grade 9", "Grade 10"];

// ─── BUILT-IN LOCATIONS (shared by Student report form + Admin analytics) ─
export const LOCATION_META = [
  { key: "Classroom",          color: "#6366f1", icon: "🏫", zone: "inside"  },
  { key: "Hallway",            color: "#f97316", icon: "🚶", zone: "inside"  },
  { key: "Cafeteria/Canteen",  color: "#f59e0b", icon: "🍽️", zone: "inside"  },
  { key: "Comfort Room",       color: "#06b6d4", icon: "🚻", zone: "inside"  },
  { key: "Gymnasium",          color: "#22c55e", icon: "🏀", zone: "inside"  },
  { key: "Library",            color: "#8b5cf6", icon: "📚", zone: "inside"  },
  { key: "Staircase",          color: "#ec4899", icon: "🪜", zone: "inside"  },
  { key: "School Entrance",    color: "#14b8a6", icon: "🚪", zone: "inside"  },
  { key: "Near School Gate",   color: "#ef4444", icon: "🛑", zone: "outside" },
  { key: "Street/Road",        color: "#dc2626", icon: "🛣️",  zone: "outside" },
  { key: "Online/Cyber",       color: "#7c3aed", icon: "💻", zone: "outside" },
  { key: "Other",              color: "#94a3b8", icon: "📍", zone: "outside" },
];

// ─── ROW <-> APP-OBJECT MAPPERS ────────────────────────────────────────────
function reportRowToObj(row) {
  return {
    id:                 row.id,
    type:               row.type,
    date:               row.date,
    time:               row.time,
    location:           row.location,
    description:        row.description,
    descriptionLeadUp:  row.description_lead_up,
    descriptionImpact:  row.description_impact,
    descriptionActions: row.description_actions,
    reporterType:       row.reporter_type,
    victims:            row.victims   || [],
    offenders:          row.offenders || [],
    witnesses:          row.witnesses || [],
    status:             row.status,
    priority:           row.priority,
    submittedBy:        row.submitted_by,
    submittedId:        row.submitted_id,
    reporterAge:        row.reporter_age,
    reporterSex:        row.reporter_sex,
    reporterGrade:      row.reporter_grade,
    reporterSection:    row.reporter_section,
    isAnonymous:        !!row.is_anonymous,
    adminNotes:         row.admin_notes,
    evidence:           row.evidence || [],
    scheduledConference: row.scheduled_conference || null,
    submittedAt:        row.submitted_at,
    updatedAt:           row.updated_at,
  };
}

function awarenessRowToObj(row) {
  return {
    id: row.id, type: row.type, title: row.title, desc: row.desc,
    link: row.link, thumbnail: row.thumbnail, videoUrl: row.video_url,
  };
}

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function notifRowToObj(row) {
  return { id: row.id, title: row.title, time: timeAgo(row.created_at), type: row.type, read: !!row.read };
}

function locationRowToObj(row) {
  return { key: row.key, icon: row.icon, color: row.color, zone: row.zone, keywords: row.keywords || [], custom: !!row.custom };
}

// ─── REPORTS API ────────────────────────────────────────────────────────────
export async function getReports() {
  const { data, error } = await supabase.from("reports").select("*").order("submitted_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(reportRowToObj);
}

export async function submitReport(reportData, evidenceFiles = []) {
  const existingReports = await getReports();
  const isAnon = !!reportData.isAnonymous;
  const submittedBy = getCurrentUserName();

  const row = {
    type:                reportData.type,
    date:                reportData.date,
    time:                reportData.time || null,
    location:            reportData.location || null,
    description:         reportData.description || null,
    description_lead_up: reportData.descriptionLeadUp || null,
    description_impact:  reportData.descriptionImpact || null,
    description_actions: reportData.descriptionActions || null,
    reporter_type:       reportData.reporterType || null,
    victims:             reportData.victims   || [],
    offenders:           reportData.offenders || [],
    witnesses:           reportData.witnesses || [],
    status:              "Pending",
    submitted_by:        submittedBy,
    submitted_id:        getCurrentUserId(),
    reporter_age:        getCurrentUserAge() || null,
    reporter_sex:        getCurrentUserSex() || null,
    reporter_grade:      getCurrentUserGrade() || null,
    reporter_section:    getCurrentUserSection() || null,
    is_anonymous:        isAnon,
    admin_notes:         "",
    evidence:            evidenceFiles,
  };

  row.priority = computePriority(
    { type: row.type, status: row.status, date: row.date, submittedBy: row.submitted_by, id: -1 },
    existingReports
  );

  const { data, error } = await supabase.from("reports").insert(row).select().single();
  if (error) throw error;

  await addAdminNotification({
    title: `New report #${data.id} submitted — ${reportData.type} by ${isAnon ? "Anonymous" : submittedBy}`,
    type: "report",
  });

  return reportRowToObj(data);
}

export async function updateReportStatus(reportId, newStatus, adminNotes = "", conference = undefined) {
  const { data: currentRow, error: fetchError } = await supabase.from("reports").select("*").eq("id", reportId).single();
  if (fetchError) throw fetchError;

  const updates = { status: newStatus, updated_at: new Date().toISOString() };
  if (adminNotes !== undefined) updates.admin_notes = adminNotes;

  if (conference !== undefined) {
    const hasConferenceValues = conference && (conference.date || conference.time || conference.location || conference.notes);
    updates.scheduled_conference = hasConferenceValues
      ? { date: conference.date || "", time: conference.time || "", location: conference.location || "", notes: conference.notes || "", createdAt: new Date().toISOString() }
      : null;
  }

  const allReports = (await getReports()).filter((r) => r.id !== reportId);
  updates.priority = computePriority(reportRowToObj({ ...currentRow, ...updates }), allReports);

  const { data, error } = await supabase.from("reports").update(updates).eq("id", reportId).select().single();
  if (error) throw error;

  const conferenceText = data.scheduled_conference
    ? ` • Conference scheduled on ${data.scheduled_conference.date || "TBD"}${data.scheduled_conference.time ? ` at ${data.scheduled_conference.time}` : ""}`
    : "";

  await addStudentNotification(
    { title: `Case #${reportId} status updated to '${newStatus}'${conferenceText}`, type: "status" },
    data.submitted_id
  );

  return reportRowToObj(data);
}

export async function deleteReport(reportId) {
  const { error } = await supabase.from("reports").delete().eq("id", reportId);
  if (error) throw error;
}

// ─── AWARENESS API ──────────────────────────────────────────────────────────
export async function getAwarenessContent() {
  const { data, error } = await supabase.from("awareness_content").select("*").order("id", { ascending: false });
  if (error) throw error;
  return (data || []).map(awarenessRowToObj);
}

export async function addAwarenessContent(item) {
  const row = { type: item.type, title: item.title, desc: item.desc, link: item.link, thumbnail: item.thumbnail, video_url: item.videoUrl };
  const { data, error } = await supabase.from("awareness_content").insert(row).select().single();
  if (error) throw error;

  await addStudentNotification({ title: `New Awareness Content: '${item.title}'`, type: "hub" }, null);
  return awarenessRowToObj(data);
}

export async function updateAwarenessContent(id, updates) {
  const row = {};
  if (updates.type      !== undefined) row.type      = updates.type;
  if (updates.title     !== undefined) row.title     = updates.title;
  if (updates.desc      !== undefined) row.desc      = updates.desc;
  if (updates.link      !== undefined) row.link      = updates.link;
  if (updates.thumbnail !== undefined) row.thumbnail = updates.thumbnail;
  if (updates.videoUrl  !== undefined) row.video_url = updates.videoUrl;

  const { error } = await supabase.from("awareness_content").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteAwarenessContent(id) {
  const { error } = await supabase.from("awareness_content").delete().eq("id", id);
  if (error) throw error;
}

// ─── NOTIFICATIONS API ──────────────────────────────────────────────────────
export async function getStudentNotifications() {
  const { data, error } = await supabase.from("notifications").select("*").eq("audience", "student").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(notifRowToObj);
}

export async function getAdminNotifications() {
  const { data, error } = await supabase.from("notifications").select("*").eq("audience", "admin").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(notifRowToObj);
}

async function addStudentNotification(notif, studentId) {
  const { error } = await supabase.from("notifications").insert({ audience: "student", student_id: studentId, title: notif.title, type: notif.type, read: false });
  if (error) throw error;
}

async function addAdminNotification(notif) {
  const { error } = await supabase.from("notifications").insert({ audience: "admin", student_id: null, title: notif.title, type: notif.type, read: false });
  if (error) throw error;
}

export async function markStudentNotifRead(id) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
}
export async function markAllStudentNotifRead() {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("audience", "student");
  if (error) throw error;
}
export async function markAdminNotifRead(id) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
}
export async function markAllAdminNotifRead() {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("audience", "admin");
  if (error) throw error;
}

// ─── STUDENT PROFILE API ────────────────────────────────────────────────────
export async function updateStudentProfile(studentId, updates) {
  const row = {};
  if (updates.age     !== undefined) row.age     = updates.age;
  if (updates.sex     !== undefined) row.sex     = updates.sex;
  if (updates.grade   !== undefined) row.grade   = updates.grade;
  if (updates.section !== undefined) row.section = updates.section;

  const { data, error } = await supabase.from("students").update(row).eq("id", studentId).select().single();
  if (error) return { success: false, error: error.message };

  if (updates.age     !== undefined) localStorage.setItem("studentAge",     String(updates.age));
  if (updates.sex     !== undefined) localStorage.setItem("studentSex",     updates.sex);
  if (updates.grade   !== undefined) localStorage.setItem("studentGrade",   updates.grade);
  if (updates.section !== undefined) localStorage.setItem("studentSection", updates.section);

  return { success: true, student: data };
}

// ─── CUSTOM LOCATIONS API (admin-managed places for Location Breakdown) ────
export async function getCustomLocations() {
  const { data, error } = await supabase.from("custom_locations").select("*");
  if (error) throw error;
  return (data || []).map(locationRowToObj);
}

export async function addCustomLocation({ name, icon, color, zone, keywords }) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return { success: false, error: "Place name is required." };
  const { data: existing, error: checkError } = await supabase.from("custom_locations").select("key").ilike("key", trimmedName);
  if (checkError) return { success: false, error: checkError.message };
  if (existing && existing.length > 0) return { success: false, error: "A place with this name already exists." };

  const row = {
    key:      trimmedName,
    icon:     icon || "📍",
    color:    color || "#64748b",
    zone:     zone === "outside" ? "outside" : "inside",
    keywords: (keywords || []).map((k) => k.trim()).filter(Boolean),
    custom:   true,
  };
  const { data, error } = await supabase.from("custom_locations").insert(row).select().single();
  if (error) return { success: false, error: error.message };
  return { success: true, location: locationRowToObj(data) };
}

export async function deleteCustomLocation(key) {
  const { error } = await supabase.from("custom_locations").delete().eq("key", key);
  if (error) throw error;
}

// ─── GRADE SECTIONS API (admin-managed sections per grade level) ───────────
export async function getGradeSections() {
  const { data, error } = await supabase.from("grade_sections").select("*").order("grade").order("section");
  if (error) throw error;
  return data || [];
}

export async function addGradeSection({ grade, section }) {
  const trimmed = (section || "").trim();
  if (!grade)   return { success: false, error: "Grade level is required." };
  if (!trimmed) return { success: false, error: "Section name is required." };
  const { data: existing, error: checkError } = await supabase
    .from("grade_sections").select("id").eq("grade", grade).ilike("section", trimmed);
  if (checkError) return { success: false, error: checkError.message };
  if (existing && existing.length > 0) return { success: false, error: `"${trimmed}" already exists under ${grade}.` };

  const { data, error } = await supabase.from("grade_sections").insert({ grade, section: trimmed }).select().single();
  if (error) return { success: false, error: error.message };
  return { success: true, section: data };
}

export async function updateGradeSection(id, section, grade) {
  const trimmed = (section || "").trim();
  if (!trimmed) return { success: false, error: "Section name is required." };
  const { data: existing, error: checkError } = await supabase
    .from("grade_sections").select("id").eq("grade", grade).ilike("section", trimmed).neq("id", id);
  if (checkError) return { success: false, error: checkError.message };
  if (existing && existing.length > 0) return { success: false, error: `"${trimmed}" already exists under ${grade}.` };

  const { data, error } = await supabase
    .from("grade_sections").update({ section: trimmed }).eq("id", id).select().single();
  if (error) return { success: false, error: error.message };
  return { success: true, section: data };
}

export async function deleteGradeSection(id) {
  const { error } = await supabase.from("grade_sections").delete().eq("id", id);
  if (error) throw error;
}

// ─── ACCOUNT CONFIRMATION API (admin approves new student registrations) ───
export async function getStudentAccounts() {
  const { data, error } = await supabase.from("students").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function approveStudentAccount(id) {
  // .select().single() forces a real check: if RLS silently blocks the
  // update (no matching admin policy, etc.), 0 rows come back and this
  // throws — instead of quietly "succeeding" while nothing was written.
  const { data, error } = await supabase.from("students").update({ approved: true }).eq("id", id).select().single();
  if (error) throw error;
  if (!data) throw new Error("Approval didn't save. Check that the \"students update admin\" RLS policy exists.");

  await supabase.from("notifications").insert({
    audience: "student", student_id: id,
    title: "🎉 Your account has been approved! Welcome to the CNHS Bullying Reporting System.",
    type: "success", read: false,
  });

  return data;
}

// Deletes the student's Auth account entirely (not just their students-table
// row), so a declined email/LRN is free to sign up again. See
// decline_student_signup() in schema.sql.
export async function declineStudentAccount(id) {
  const { error } = await supabase.rpc("decline_student_signup", { target_id: id });
  if (error) throw error;
}

// Sign-ups that haven't clicked their Gmail confirmation link yet. Throws on
// failure (e.g. the RPC/migration not applied yet, or the caller isn't
// recognized as an admin) — the caller is responsible for catching this
// separately from the rest of the dashboard's data, so one broken query here
// doesn't blank out everything else, and the admin can see *why* the list
// is empty instead of it looking like a real empty state.
export async function getUnconfirmedSignups() {
  const { data, error } = await supabase.rpc("get_unconfirmed_signups");
  if (error) throw error;
  return data || [];
}

export async function resendConfirmationEmail(email) {
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── ADMIN: FULL RESET (deletes all reports + notifications) ───────────────
export async function resetAllData() {
  const { error: notifError } = await supabase.from("notifications").delete().neq("id", -1);
  if (notifError) throw notifError;
  const { error: reportsError } = await supabase.from("reports").delete().neq("id", -1);
  if (reportsError) throw reportsError;
  window.location.reload();
}

// ─── ANALYTICS / EXPORT API ──────────────────────────────────────────────────
// These take the already-fetched `reports` array (the caller has it in state)
// instead of re-querying Supabase, since they're just derived formatting.

export function getAnalyticsData(reports) {
  const byType     = {};
  const byStatus   = {};
  const byPriority = {};
  const byMonth    = {};

  reports.forEach((r) => {
    byType[r.type]         = (byType[r.type]         || 0) + 1;
    byStatus[r.status]     = (byStatus[r.status]     || 0) + 1;
    byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;

    const month = r.date
      ? new Date(r.date).toLocaleString("default", { month: "short", year: "numeric" })
      : "Unknown";
    byMonth[month] = (byMonth[month] || 0) + 1;
  });

  return {
    generatedAt:       new Date().toISOString(),
    totalReports:      reports.length,
    resolvedReports:   reports.filter((r) => r.status === "Resolved").length,
    pendingReports:    reports.filter((r) => r.status === "Pending").length,
    inProgressReports: reports.filter((r) => r.status === "Under Investigation").length,
    byType,
    byStatus,
    byPriority,
    byMonth,
    reports: reports.map((r) => ({
      id:          r.id,
      date:        r.date,
      type:        r.type,
      description: r.description,
      location:    r.location,
      status:      r.status,
      priority:    r.priority,
      isAnonymous: !!r.isAnonymous,
      submittedBy: r.isAnonymous ? "Anonymous" : r.submittedBy,
      submittedId: r.isAnonymous ? "—" : r.submittedId,
      adminNotes:  r.adminNotes,
      submittedAt: r.submittedAt,
      updatedAt:   r.updatedAt || "",
    })),
  };
}

export function exportAsCSV(reports) {
  const data = getAnalyticsData(reports);
  const headers = [
    "ID","Date","Type","Description","Location",
    "Status","Priority","Submitted By","Student ID","Admin Notes","Submitted At","Updated At",
  ];
  const rows = data.reports.map((r) => [
    r.id, r.date, r.type,
    `"${(r.description || "").replace(/"/g, '""')}"`,
    r.location, r.status, r.priority, r.submittedBy,
    r.submittedId,
    `"${(r.adminNotes || "").replace(/"/g, '""')}"`,
    r.submittedAt, r.updatedAt,
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCSV(reports) {
  const csv = exportAsCSV(reports);
  downloadFile(`CNHS_Reports_${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv");
}

export function downloadJSON(reports) {
  const data = getAnalyticsData(reports);
  downloadFile(
    `CNHS_Analytics_${new Date().toISOString().slice(0,10)}.json`,
    JSON.stringify(data, null, 2),
    "application/json"
  );
}

export function downloadTextReport(reports) {
  const data = getAnalyticsData(reports);
  const lines = [
    "=== CNHS BULLYING & INCIDENT REPORTING SYSTEM ===",
    `Report Generated: ${new Date(data.generatedAt).toLocaleString()}`,
    "",
    "── SUMMARY ──────────────────────────────────────",
    `Total Reports     : ${data.totalReports}`,
    `Pending           : ${data.pendingReports}`,
    `In Progress       : ${data.inProgressReports}`,
    `Resolved          : ${data.resolvedReports}`,
    "",
    "── BY TYPE ──────────────────────────────────────",
    ...Object.entries(data.byType).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "── BY STATUS ────────────────────────────────────",
    ...Object.entries(data.byStatus).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "── BY PRIORITY ──────────────────────────────────",
    ...Object.entries(data.byPriority).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "── INDIVIDUAL REPORTS ───────────────────────────",
    ...data.reports.map((r) =>
      [
        `Report #${r.id}`,
        `  Date        : ${r.date}`,
        `  Type        : ${r.type}`,
        `  Status      : ${r.status}`,
        `  Priority    : ${r.priority}`,
        `  Location    : ${r.location}`,
        `  Submitted By: ${r.submittedBy} (${r.submittedId})`,
        `  Description : ${r.description}`,
        `  Admin Notes : ${r.adminNotes || "None"}`,
        `  Submitted At: ${r.submittedAt}`,
        "",
      ].join("\n")
    ),
  ];
  downloadFile(
    `CNHS_Report_${new Date().toISOString().slice(0,10)}.txt`,
    lines.join("\n"),
    "text/plain"
  );
}
