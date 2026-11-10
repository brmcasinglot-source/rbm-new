/**
 * store.js — Supabase-backed data layer.
 * Both StudentDashboard and AdminDashboard import from here.
 *
 * All CRUD functions are async — callers must `await` them. Login,
 * registration, and session management live in src/lib/auth.js.
 */
import { authRequest, supabase } from "../lib/apiClient";
import { getStudentIdImages, resendConfirmationEmail as resendOtp } from "../lib/auth";

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

export const LOCATION_ZONE_COLORS = {
  inside: "#2563eb",
  outside: "#dc2626",
};

// ─── BUILT-IN LOCATIONS (shared by Student report form + Admin analytics) ─
export const LOCATION_META = [
  { key: "Classroom",          color: LOCATION_ZONE_COLORS.inside, icon: "🏫", zone: "inside"  },
  { key: "Hallway",            color: LOCATION_ZONE_COLORS.inside, icon: "🚶", zone: "inside"  },
  { key: "Cafeteria/Canteen",  color: LOCATION_ZONE_COLORS.inside, icon: "🍽️", zone: "inside"  },
  { key: "Comfort Room",       color: LOCATION_ZONE_COLORS.inside, icon: "🚻", zone: "inside"  },
  { key: "Gymnasium",          color: LOCATION_ZONE_COLORS.inside, icon: "🏀", zone: "inside"  },
  { key: "Library",            color: LOCATION_ZONE_COLORS.inside, icon: "📚", zone: "inside"  },
  { key: "Staircase",          color: LOCATION_ZONE_COLORS.inside, icon: "🪜", zone: "inside"  },
  { key: "School Entrance",    color: LOCATION_ZONE_COLORS.inside, icon: "🚪", zone: "inside"  },
  { key: "Near School Gate",   color: LOCATION_ZONE_COLORS.outside, icon: "🛑", zone: "outside" },
  { key: "Street/Road",        color: LOCATION_ZONE_COLORS.outside, icon: "🛣️",  zone: "outside" },
  { key: "Online/Cyber",       color: LOCATION_ZONE_COLORS.outside, icon: "💻", zone: "outside" },
  { key: "Other",              color: LOCATION_ZONE_COLORS.outside, icon: "📍", zone: "outside" },
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
    evidenceCount:      row.evidence_count ?? (row.evidence || []).length,
    evidence:           row.evidence || [],
    scheduledConference: row.scheduled_conference || null,
    conferenceFindings: row.conference_findings || "",
    conferenceFindingsUpdatedBy: row.conference_findings_updated_by || null,
    conferenceFindingsUpdatedAt: row.conference_findings_updated_at || null,
    submittedAt:        row.submitted_at,
    updatedAt:           row.updated_at,
  };
}

function awarenessRowToObj(row) {
  const mediaUrl = (value) => {
    if (!value || value.startsWith("data:") || /^https?:\/\//i.test(value)) return value || "";
    const projectUrl = import.meta.env.VITE_SUPABASE_URL;
    return projectUrl
      ? `${projectUrl.replace(/\/$/, "")}/storage/v1/object/public/awareness-media/${value.split("/").map(encodeURIComponent).join("/")}`
      : "";
  };
  const thumbnail = mediaUrl(row.thumbnail_path);
  const fullImage = mediaUrl(row.full_image_path);
  return {
    id: row.id, type: row.type, title: row.title, desc: row.desc,
    link: row.link, thumbnail, thumbnailPath: row.thumbnail_path,
    fullImage, fullImagePath: row.full_image_path, fileData: "", videoUrl: row.video_url,
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
  const zone = row.zone === "outside" ? "outside" : "inside";
  return {
    key: row.key,
    icon: row.icon,
    color: LOCATION_ZONE_COLORS[zone],
    zone,
    keywords: row.keywords || [],
    custom: !!row.custom,
  };
}

// ─── REPORTS API ────────────────────────────────────────────────────────────
const REPORT_COLUMNS_WITHOUT_EVIDENCE = [
  "id", "type", "date", "time", "location", "description", "description_lead_up",
  "description_impact", "description_actions", "reporter_type", "victims", "offenders",
  "witnesses", "status", "priority", "submitted_by", "submitted_id", "reporter_age",
  "reporter_sex", "reporter_grade", "reporter_section", "is_anonymous", "admin_notes",
  "evidence_count", "scheduled_conference", "conference_findings",
  "conference_findings_updated_by", "conference_findings_updated_at", "submitted_at", "updated_at",
].join(",");

const REPORT_LIST_COLUMNS = [
  "id", "type", "date", "time", "location", "description", "reporter_type", "status", "priority",
  "submitted_by", "submitted_id", "reporter_age", "reporter_sex", "reporter_grade",
  "reporter_section", "is_anonymous", "admin_notes", "evidence_count",
  "scheduled_conference", "submitted_at", "updated_at",
].join(",");

export async function getReports({ includeEvidence = false, summaryOnly = true, limit, offset = 0 } = {}) {
  const baseColumns = summaryOnly ? REPORT_LIST_COLUMNS : REPORT_COLUMNS_WITHOUT_EVIDENCE;
  const columns = includeEvidence ? `${REPORT_COLUMNS_WITHOUT_EVIDENCE},evidence` : baseColumns;
  let query = supabase.from("reports").select(columns)
    .order("submitted_at", { ascending: false }).order("id", { ascending: false });
  if (Number.isInteger(limit)) query = query.range(offset, offset + limit - 1);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(reportRowToObj);
}

async function offenseRpc(functionName, args = {}) {
  const { data, error } = await supabase.rpc(functionName, args);
  if (error) {
    if (error.message === "Unknown database function.") {
      throw new Error("Student Offense Records is not installed on Supabase yet. Apply supabase/student_offense_records.sql and deploy the updated api Edge Function.");
    }
    throw error;
  }
  return data;
}

let gradeSectionsCache = null;
let gradeSectionsRequest = null;

export async function searchOffenseStudents(searchTerm = "", { grade = null, section = null, limit = 20 } = {}) {
  const rows = await offenseRpc("search_offense_students", {
    search_term: searchTerm,
    grade_filter: grade,
    section_filter: section,
    page_size: limit,
  });
  return (rows || []).map((student) => ({
    id: student.id,
    name: student.name,
    lrn: student.lrn,
    grade: student.grade,
    section: student.section,
    establishedOffenses: Number(student.established_offenses || 0),
  }));
}

export async function searchOffenseReports(searchTerm = "", limit = 20, offset = 0) {
  const rows = await offenseRpc("search_offense_reports", {
    search_term: String(searchTerm || "").trim(),
    page_size: limit + 1,
    page_offset: offset,
  });
  return (rows || []).map((report) => ({
    id: report.id,
    type: report.type,
    date: report.date,
    time: report.time,
    status: report.status,
    location: report.location,
    description: report.description,
    victims: report.victims || [],
    offenders: report.offenders || [],
    witnesses: report.witnesses || [],
    reporterName: report.is_anonymous ? "Anonymous" : report.submitted_by || "—",
    evidenceCount: report.evidence_count || 0,
    scheduledConference: report.scheduled_conference || null,
    conferenceFindings: "",
    submittedAt: report.submitted_at,
    isAnonymous: !!report.is_anonymous,
    submittedBy: report.is_anonymous ? null : report.submitted_by,
    linkedToStudent: false,
  }));
}

export async function getStudentOffenseRecords(filters = {}) {
  const result = await offenseRpc("get_student_offense_records", {
    search_term: filters.search || "",
    grade_filter: filters.grade || null,
    section_filter: filters.section || null,
    offense_filter: filters.offenseNumber || null,
    bullying_type_filter: filters.type || null,
    date_from: filters.dateFrom || null,
    date_to: filters.dateTo || null,
    action_filter: filters.action || null,
    sort_by: filters.sort || "recent",
    page_size: filters.limit || 25,
    page_offset: filters.offset || 0,
  });
  return {
    total: Number(result?.total || 0),
    options: {
      grades: result?.options?.grades || [],
      sections: result?.options?.sections || [],
      actions: result?.options?.actions || [],
    },
    stats: {
      students: Number(result?.stats?.students || 0),
      offenses: Number(result?.stats?.offenses || 0),
      firstOffenses: Number(result?.stats?.firstOffenses || 0),
      repeatOffenses: Number(result?.stats?.repeatOffenses || 0),
    },
    records: (result?.records || []).map((record) => ({
      id: record.id,
      studentId: record.student_id,
      personKey: record.person_key,
      studentName: record.student_name,
      lrn: record.lrn,
      grade: record.grade,
      section: record.section,
      incidentReportId: record.incident_report_id,
      incidentReportIds: record.incident_report_ids || [record.incident_report_id],
      offenseNumber: record.offense_number,
      conferenceFindings: record.conference_findings || "",
      disciplinaryAction: record.disciplinary_action,
      approvedAt: record.approved_at,
      reviewedAt: record.reviewed_at,
      followUpDate: record.follow_up_date,
      followUpStatus: record.follow_up_status,
      incidentType: record.incident_type,
      incidentDate: record.incident_date,
      approvedBy: record.approved_by_name || "Administrator",
      decisionFindings: record.decision_findings || "",
      studentOffenseCount: Number(record.student_offense_count || 0),
    })),
  };
}

export async function getStudentOffenseHistory(personKey) {
  return offenseRpc("get_student_offense_history", { target_person_key: personKey });
}

export async function getReportStudentLinks(reportId) {
  return offenseRpc("get_report_student_links", { target_report_id: reportId });
}

export async function linkReportedStudent(reportId, studentId) {
  return offenseRpc("link_report_student", {
    target_report_id: reportId,
    target_student_id: studentId,
  });
}

export async function saveOffenseDecision(reportId, student, outcome, findings, review) {
  return offenseRpc("save_offense_decision", {
    target_report_id: reportId,
    attached_report_ids: review.attachedReportIds || [reportId],
    student_name: student.name,
    student_lrn: student.lrn || null,
    student_grade: student.grade,
    student_section: student.section || null,
    decision_outcome: outcome,
    decision_findings: findings,
    conference_findings: review.conferenceFindings || null,
    admin_remarks: review.adminRemarks || null,
    action_text: review.disciplinaryAction || null,
    follow_up_date: review.followUpDate || null,
    reviewed_at: review.reviewedAt,
  });
}

export async function createStudentOffenseRecord(reportId, student, reportIds = [reportId]) {
  return offenseRpc("create_student_offense_record", {
    target_report_id: reportId,
    student_name: student.name,
    student_lrn: student.lrn || null,
    student_grade: student.grade,
    student_section: student.section || null,
    attached_report_ids: reportIds,
  });
}

export async function prepareReportForOffenseApproval(reportId) {
  const { data: updatedReport, error: updateError } = await supabase.from("reports")
    .update({ status: "Under Investigation", updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", "Pending")
    .select("id,status,submitted_id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (updatedReport) {
    await addStudentNotification({
      title: `Case #${reportId} status updated to 'Under Investigation'`,
      type: "status",
    }, updatedReport.submitted_id);
    return { status: updatedReport.status, changed: true };
  }

  const { data: currentReport, error: fetchError } = await supabase.from("reports")
    .select("id,status")
    .eq("id", reportId)
    .single();
  if (fetchError) throw fetchError;
  if (!["Under Investigation", "Resolved"].includes(currentReport.status)) {
    throw new Error("The incident must be Under Investigation or Resolved before approval.");
  }
  return { status: currentReport.status, changed: false };
}

export async function saveReportConferenceFindings(reportId, findings) {
  return offenseRpc("save_report_conference_findings", {
    target_report_id: reportId,
    findings_text: findings,
  });
}

async function getReportPriorityContext() {
  const { data, error } = await supabase.from("reports")
    .select("id,type,date,status,submitted_by");
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    type: row.type,
    date: row.date,
    status: row.status,
    submittedBy: row.submitted_by,
  }));
}

export async function getReportDetails(reportId) {
  const row = await authRequest("report-details", { reportId });
  return reportRowToObj(row);
}

export async function getReportEvidence(reportId) {
  const result = await authRequest("report-evidence", { reportId });
  return result.evidence || [];
}

export async function getUnreadNotificationCount() {
  const result = await authRequest("notification-unread-count");
  return result.count || 0;
}

export async function getAwarenessImage(id) {
  const result = await authRequest("awareness-image", { id });
  return result.url || "";
}

export async function submitReport(reportData, evidenceFiles = []) {
  const existingReports = await getReportPriorityContext();
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

  const { data, error } = await supabase.from("reports").insert(row).select(REPORT_COLUMNS_WITHOUT_EVIDENCE).single();
  if (error) throw error;

  return reportRowToObj(data);
}

export async function updateReportStatus(reportId, newStatus, adminNotes = "") {
  const { data: currentRow, error: fetchError } = await supabase.from("reports").select(REPORT_COLUMNS_WITHOUT_EVIDENCE).eq("id", reportId).single();
  if (fetchError) throw fetchError;

  const updates = { status: newStatus, updated_at: new Date().toISOString() };
  if (adminNotes !== undefined) updates.admin_notes = adminNotes;

  const allReports = (await getReportPriorityContext()).filter((r) => r.id !== reportId);
  updates.priority = computePriority(reportRowToObj({ ...currentRow, ...updates }), allReports);

  const { data, error } = await supabase.from("reports").update(updates).eq("id", reportId).select(REPORT_COLUMNS_WITHOUT_EVIDENCE).single();
  if (error) throw error;

  const conference = data.scheduled_conference;
  const conferenceStatus = conference?.status || (conference?.completed ? "Completed" : "Scheduled");
  const conferenceText = conference
    ? ` • Conference status: ${conferenceStatus}${conference.date ? ` (${conference.date}${conference.time ? ` at ${conference.time}` : ""})` : ""}`
    : "";

  await addStudentNotification(
    { title: `Case #${reportId} status updated to '${newStatus}'${conferenceText}`, type: "status" },
    data.submitted_id
  );

  return reportRowToObj(data);
}

export async function updateConferenceSchedule(reportId, schedule) {
  if (!schedule?.date || !schedule?.time || !schedule?.location?.trim()) {
    throw new Error("A conference date, time, and location are required.");
  }

  const { data: currentRow, error: fetchError } = await supabase.from("reports").select(REPORT_COLUMNS_WITHOUT_EVIDENCE).eq("id", reportId).single();
  if (fetchError) throw fetchError;

  const existingConference = currentRow.scheduled_conference && typeof currentRow.scheduled_conference === "object"
    ? currentRow.scheduled_conference
    : {};
  const currentStatus = existingConference.status || (existingConference.completed ? "Completed" : "Scheduled");
  const hasExistingSchedule = !!(existingConference.date || existingConference.time || existingConference.location);

  if (["Reschedule Requested", "Cancellation Requested"].includes(currentStatus)) {
    throw new Error("Review the pending conference request before changing its schedule.");
  }
  if (
    (hasExistingSchedule && !["Scheduled", "Rescheduled"].includes(currentStatus)) ||
    (!hasExistingSchedule && existingConference.status && existingConference.status !== "Scheduled")
  ) {
    throw new Error("This conference schedule cannot be edited in its current status.");
  }

  const now = new Date().toISOString();
  const scheduleChanged = hasExistingSchedule && (
    schedule.date !== existingConference.date ||
    schedule.time !== existingConference.time ||
    schedule.location.trim() !== existingConference.location ||
    (schedule.notes || "") !== (existingConference.notes || "")
  );
  const scheduleSnapshot = {
    date: existingConference.date || "",
    time: existingConference.time || "",
    location: existingConference.location || "",
    notes: existingConference.notes || "",
  };
  const updatedConference = {
    ...existingConference,
    date: schedule.date,
    time: schedule.time,
    location: schedule.location.trim(),
    notes: (schedule.notes || "").trim(),
    createdAt: existingConference.createdAt || now,
    status: hasExistingSchedule && scheduleChanged ? "Rescheduled" : currentStatus,
    originalSchedule: existingConference.originalSchedule || (hasExistingSchedule ? scheduleSnapshot : {
      date: schedule.date,
      time: schedule.time,
      location: schedule.location.trim(),
      notes: (schedule.notes || "").trim(),
    }),
    previousSchedule: scheduleChanged ? scheduleSnapshot : existingConference.previousSchedule || null,
    completed: false,
  };

  const { data, error } = await supabase.from("reports")
    .update({ scheduled_conference: updatedConference, updated_at: now })
    .eq("id", reportId)
    .select(REPORT_COLUMNS_WITHOUT_EVIDENCE)
    .single();
  if (error) throw error;

  await addStudentNotification({
    title: `A conference for Case #${reportId} is scheduled for ${updatedConference.date} at ${updatedConference.time}.`,
    type: "status",
  }, data.submitted_id);
  return reportRowToObj(data);
}

export async function cancelConference(reportId, reason) {
  if (!reason?.trim()) {
    throw new Error("A cancellation reason is required.");
  }

  const { data: currentRow, error: fetchError } = await supabase.from("reports").select(REPORT_COLUMNS_WITHOUT_EVIDENCE).eq("id", reportId).single();
  if (fetchError) throw fetchError;

  const existingConference = currentRow.scheduled_conference && typeof currentRow.scheduled_conference === "object"
    ? currentRow.scheduled_conference
    : {};
  const currentStatus = existingConference.status || (existingConference.completed ? "Completed" : "Scheduled");
  if (!existingConference.date && !existingConference.time && !existingConference.location) {
    throw new Error("No scheduled conference exists for this report.");
  }
  if (!["Scheduled", "Rescheduled"].includes(currentStatus)) {
    throw new Error("This conference cannot be cancelled in its current status.");
  }

  const now = new Date().toISOString();
  const updatedConference = {
    ...existingConference,
    status: "Cancelled",
    completed: false,
    cancellationReason: reason.trim(),
    cancelledAt: now,
    cancellationSchedule: {
      date: existingConference.date || "",
      time: existingConference.time || "",
      location: existingConference.location || "",
    },
  };
  const { data, error } = await supabase.from("reports")
    .update({ scheduled_conference: updatedConference, updated_at: now })
    .eq("id", reportId)
    .select(REPORT_COLUMNS_WITHOUT_EVIDENCE)
    .single();
  if (error) throw error;

  await addStudentNotification({
    title: `The conference for Case #${reportId} was cancelled.`,
    type: "status",
  }, data.submitted_id);
  return reportRowToObj(data);
}

export async function requestConferenceChange(reportId, requestType, reason = "") {
  if (!["reschedule", "cancellation"].includes(requestType)) {
    throw new Error("Invalid conference request.");
  }
  const { error } = await supabase.rpc("request_conference_change", {
    target_report_id: reportId,
    request_type: requestType,
    request_reason: typeof reason === "string" ? reason.trim() : "",
  });
  if (error?.code === "PGRST202") {
    throw new Error(
      "Conference requests are not enabled in this database. Ask the project administrator to run supabase/conference_management.sql in the Supabase SQL Editor."
    );
  }
  if (error) throw error;

  const { data, error: fetchError } = await supabase.from("reports").select(REPORT_COLUMNS_WITHOUT_EVIDENCE).eq("id", reportId).single();
  if (fetchError) throw fetchError;
  return reportRowToObj(data);
}

export async function reviewConferenceRequest(reportId, decision, reschedule = undefined) {
  const { data: currentRow, error: fetchError } = await supabase.from("reports").select(REPORT_COLUMNS_WITHOUT_EVIDENCE).eq("id", reportId).single();
  if (fetchError) throw fetchError;

  const existingConference = currentRow.scheduled_conference && typeof currentRow.scheduled_conference === "object"
    ? currentRow.scheduled_conference
    : {};
  const request = existingConference.request;
  if (!request || request.state !== "Pending") {
    throw new Error("There is no pending conference request to review.");
  }
  if (!["reschedule", "cancellation"].includes(request.type)) {
    throw new Error("The conference request type is invalid.");
  }
  if (!["approve", "reject"].includes(decision)) {
    throw new Error("Invalid conference request decision.");
  }

  const approved = decision === "approve";
  const requestIsReschedule = request.type === "reschedule";
  if (approved && requestIsReschedule && (!reschedule?.date || !reschedule?.time || !reschedule?.location?.trim())) {
    throw new Error("A new date, time, and location are required to approve a reschedule.");
  }

  const now = new Date().toISOString();
  const updatedConference = {
    ...existingConference,
    status: approved
      ? requestIsReschedule ? "Rescheduled" : "Cancelled"
      : request.previousStatus || "Scheduled",
    request: { ...request, state: approved ? "Approved" : "Rejected", reviewedAt: now },
    completed: false,
  };
  if (approved && requestIsReschedule) {
    updatedConference.previousSchedule = {
      date: existingConference.date,
      time: existingConference.time,
      location: existingConference.location || "",
      notes: existingConference.notes || "",
    };
    updatedConference.date = reschedule.date;
    updatedConference.time = reschedule.time;
    updatedConference.location = reschedule.location.trim();
    updatedConference.notes = (reschedule.notes || "").trim();
  } else if (approved) {
    updatedConference.cancellationReason = request.reason || "";
    updatedConference.cancelledAt = now;
    updatedConference.cancellationSchedule = {
      date: existingConference.date || "",
      time: existingConference.time || "",
      location: existingConference.location || "",
    };
  }

  const { data, error } = await supabase.from("reports")
    .update({ scheduled_conference: updatedConference, updated_at: now })
    .eq("id", reportId)
    .select(REPORT_COLUMNS_WITHOUT_EVIDENCE)
    .single();
  if (error) throw error;

  const decisionText = approved ? "approved" : "rejected";
  const requestLabel = requestIsReschedule ? "reschedule" : "cancellation";
  const scheduleText = approved && requestIsReschedule
    ? ` The new conference is scheduled for ${updatedConference.date} at ${updatedConference.time}.`
    : "";
  await addStudentNotification({
    title: `Your conference ${requestLabel} request for Case #${reportId} was ${decisionText}.${scheduleText}`,
    type: "status",
  }, data.submitted_id);

  return reportRowToObj(data);
}

export async function updateConferenceOutcome(reportId, status) {
  if (!["Completed", "No-show"].includes(status)) {
    throw new Error("Invalid conference outcome.");
  }

  const { data: currentRow, error: fetchError } = await supabase.from("reports").select(REPORT_COLUMNS_WITHOUT_EVIDENCE).eq("id", reportId).single();
  if (fetchError) throw fetchError;

  const existingConference = currentRow.scheduled_conference && typeof currentRow.scheduled_conference === "object"
    ? currentRow.scheduled_conference
    : {};
  if (!existingConference.date && !existingConference.time && !existingConference.location) {
    throw new Error("No scheduled conference exists for this report.");
  }
  const currentStatus = existingConference.status || (existingConference.completed ? "Completed" : "Scheduled");
  if (!["Scheduled", "Rescheduled"].includes(currentStatus)) {
    throw new Error("This conference cannot be given an outcome in its current status.");
  }

  const now = new Date().toISOString();
  const updatedConference = {
    ...existingConference,
    status,
    completed: status === "Completed",
    completedAt: status === "Completed" ? now : existingConference.completedAt || null,
    noShowAt: status === "No-show" ? now : existingConference.noShowAt || null,
  };

  const { data, error } = await supabase.from("reports")
    .update({ scheduled_conference: updatedConference, updated_at: now })
    .eq("id", reportId)
    .select(REPORT_COLUMNS_WITHOUT_EVIDENCE)
    .single();

  if (error) throw error;

  await addStudentNotification({
    title: `Conference for Case #${reportId} was marked as ${status}.`,
    type: "status",
  }, data.submitted_id);

  return reportRowToObj(data);
}

export async function deleteReport(reportId) {
  const { error } = await supabase.from("reports").delete().eq("id", reportId);
  if (error) throw error;
}

// ─── AWARENESS API ──────────────────────────────────────────────────────────
const AWARENESS_CONTENT_CACHE_KEY = "cnhsAwarenessContent";
const AWARENESS_CONTENT_CACHE_TTL_MS = 5 * 60 * 1000;

function clearAwarenessContentCache() {
  sessionStorage.removeItem(AWARENESS_CONTENT_CACHE_KEY);
}

export async function getAwarenessContent() {
  const cachedValue = sessionStorage.getItem(AWARENESS_CONTENT_CACHE_KEY);
  if (cachedValue) {
    let cached;
    try {
      cached = JSON.parse(cachedValue);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }

    if (
      Array.isArray(cached?.data) &&
      Number.isFinite(cached.cachedAt) &&
      Date.now() >= cached.cachedAt &&
      Date.now() - cached.cachedAt < AWARENESS_CONTENT_CACHE_TTL_MS
    ) {
      return cached.data;
    }
    clearAwarenessContentCache();
  }

  const { data, error } = await supabase.from("awareness_content")
    .select("id,type,title,desc,link,thumbnail_path,full_image_path,video_url").order("id", { ascending: false });
  if (error) throw error;
  const content = (data || []).map(awarenessRowToObj);
  sessionStorage.setItem(AWARENESS_CONTENT_CACHE_KEY, JSON.stringify({
    cachedAt: Date.now(),
    data: content,
  }));
  return content;
}

export async function addAwarenessContent(item) {
  const row = {
    type: item.type, title: item.title, desc: item.desc, link: item.link,
    thumbnailData: item.thumbnailData,
    fullImageData: item.fullImageData,
    thumbnail_path: item.thumbnailPath || null,
    full_image_path: item.fullImagePath || null,
    video_url: item.videoUrl,
  };
  const { data, error } = await supabase.from("awareness_content").insert(row).select().single();
  if (error) throw error;

  clearAwarenessContentCache();
  await addStudentNotification({ title: `New Awareness Content: '${item.title}'`, type: "hub" }, null);
  return awarenessRowToObj(data);
}

export async function updateAwarenessContent(id, updates) {
  const row = {};
  if (updates.type      !== undefined) row.type      = updates.type;
  if (updates.title     !== undefined) row.title     = updates.title;
  if (updates.desc      !== undefined) row.desc      = updates.desc;
  if (updates.link      !== undefined) row.link      = updates.link;
  if (updates.thumbnailData !== undefined) row.thumbnailData = updates.thumbnailData;
  if (updates.fullImageData !== undefined) row.fullImageData = updates.fullImageData;
  if (updates.thumbnailPath !== undefined) row.thumbnail_path = updates.thumbnailPath;
  if (updates.fullImagePath !== undefined) row.full_image_path = updates.fullImagePath;
  if (updates.videoUrl  !== undefined) row.video_url = updates.videoUrl;

  const { error } = await supabase.from("awareness_content").update(row).eq("id", id);
  if (error) throw error;
  clearAwarenessContentCache();
}

export async function deleteAwarenessContent(id) {
  const { error } = await supabase.from("awareness_content").delete().eq("id", id);
  if (error) throw error;
  clearAwarenessContentCache();
}

// ─── NOTIFICATIONS API ──────────────────────────────────────────────────────
export async function getStudentNotifications({ limit = 30, offset = 0 } = {}) {
  const { data, error } = await supabase.from("notifications")
    .select("id,title,type,read,created_at").eq("audience", "student")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data || []).map(notifRowToObj);
}

export async function getAdminNotifications({ limit = 30, offset = 0 } = {}) {
  const { data, error } = await supabase.from("notifications")
    .select("id,title,type,read,created_at").eq("audience", "admin")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data || []).map(notifRowToObj);
}

async function addStudentNotification(notif, studentId) {
  const { error } = await supabase.from("notifications").insert({ audience: "student", student_id: studentId, title: notif.title, type: notif.type, read: false });
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

// ─── CUSTOM LOCATIONS API (admin-managed places for Location Breakdown) ────
export async function getCustomLocations() {
  const { data, error } = await supabase.from("custom_locations").select("*");
  if (error) throw error;
  return (data || []).map(locationRowToObj);
}

export async function addCustomLocation({ name, icon, zone, keywords }) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return { success: false, error: "Place name is required." };
  const { data: existing, error: checkError } = await supabase.from("custom_locations").select("key").ilike("key", trimmedName);
  if (checkError) return { success: false, error: checkError.message };
  if (existing && existing.length > 0) return { success: false, error: "A place with this name already exists." };

  const normalizedZone = zone === "outside" ? "outside" : "inside";
  const row = {
    key:      trimmedName,
    icon:     icon || "📍",
    color:    LOCATION_ZONE_COLORS[normalizedZone],
    zone:     normalizedZone,
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
  if (gradeSectionsCache) return gradeSectionsCache;
  if (!gradeSectionsRequest) {
    gradeSectionsRequest = supabase.from("grade_sections").select("id,grade,section").order("grade").order("section")
      .then(({ data, error }) => {
        if (error) throw error;
        gradeSectionsCache = data || [];
        return gradeSectionsCache;
      })
      .finally(() => { gradeSectionsRequest = null; });
  }
  return gradeSectionsRequest;
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
  gradeSectionsCache = null;
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
    .from("grade_sections").update({ section: trimmed }).eq("id", id).select().maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) {
    return {
      success: false,
      error: "No section was updated. Confirm the grade_sections update policy is installed and that your signed-in account is configured as an Admin in Supabase.",
    };
  }
  gradeSectionsCache = null;
  return { success: true, section: data };
}

export async function deleteGradeSection(id) {
  const { error } = await supabase.from("grade_sections").delete().eq("id", id);
  if (error) throw error;
  gradeSectionsCache = null;
}

// ─── ACCOUNT CONFIRMATION API (admin approves new student registrations) ───
export async function getStudentAccounts(page = 0, pageSize = 25) {
  const accountColumns = "id,name,email,lrn,grade,section,approved,created_at";
  const { data, error } = await supabase.from("students")
    .select(accountColumns)
    .order("created_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize);
  if (error) throw error;
  const accountRows = data || [];
  return {
    accounts: accountRows.slice(0, pageSize).map((student) => ({
      id: student.id,
      name: student.name,
      email: student.email,
      lrn: student.lrn,
      grade: student.grade,
      section: student.section,
      approved: student.approved,
    })),
    hasMoreAccounts: accountRows.length > pageSize,
  };
}

export async function getPendingStudentAccounts(page = 0, pageSize = 25) {
  const pendingColumns = "id,name,email,lrn,grade,section,approved,created_at";
  const { data, error } = await supabase.from("students")
    .select(pendingColumns)
    .eq("approved", false)
    .order("created_at", { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize);
  if (error) throw error;
  const pendingRows = data || [];
  return {
    accounts: pendingRows.slice(0, pageSize).map((student) => ({
      id: student.id,
      name: student.name,
      email: student.email,
      lrn: student.lrn,
      grade: student.grade,
      section: student.section,
      approved: student.approved,
      created_at: student.created_at,
    })),
    hasMore: pendingRows.length > pageSize,
  };
}

export async function getPendingStudentAccountCount() {
  const { data, error } = await supabase.from("students").select("id").eq("approved", false);
  if (error) throw error;
  return (data || []).length;
}

export async function getStudentIdImagesForAdmin(studentId) {
  return getStudentIdImages(studentId);
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

// Removes a declined student profile and its custom credentials, freeing
// the email and LRN for registration again.
export async function declineStudentAccount(id) {
  const { error } = await supabase.rpc("decline_student_signup", { target_id: id });
  if (error) throw error;
}

// Sign-ups that haven't entered their email verification code yet. Throws on
// failure (e.g. the auth migration is not applied or the caller isn't
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
  return resendOtp(email);
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

export async function downloadXLSX(reports) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Incident Report Log", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const reportDate = (value) => {
    if (!value) return "—";
    const dateText = String(value);
    const date = new Date(dateText);
    return Number.isNaN(date.getTime())
      ? dateText
      : date.toLocaleString("en-PH", dateText.includes("T")
        ? { dateStyle: "medium", timeStyle: "short" }
        : { dateStyle: "medium" });
  };
  const counts = {
    pending: reports.filter((report) => report.status === "Pending").length,
    investigating: reports.filter((report) => report.status === "Under Investigation").length,
    resolved: reports.filter((report) => report.status === "Resolved").length,
    victims: reports.filter((report) => report.reporterType === "Victim").length,
    friends: reports.filter((report) => ["Friend", "Friend of Victim"].includes(report.reporterType)).length,
  };
  const columns = [
    { header: "Report No.", key: "id", width: 16 },
    { header: "Date filed", key: "dateFiled", width: 23 },
    { header: "Incident date", key: "incidentDate", width: 17 },
    { header: "Type", key: "type", width: 18 },
    { header: "Location", key: "location", width: 22 },
    { header: "Status", key: "status", width: 23 },
    { header: "Reporter", key: "reporter", width: 24 },
    { header: "Reporter role", key: "reporterRole", width: 20 },
    { header: "Description", key: "description", width: 54 },
  ];
  const reportNumber = (id) => {
    const numericId = Number(id);
    return Number.isInteger(numericId) && numericId >= 0
      ? `CNHS-${String(numericId).padStart(4, "0")}`
      : String(id ?? "—");
  };
  const reporterRole = (value) => {
    if (value === "Friend") return "Friend of victim";
    return value || "—";
  };
  worksheet.columns = columns;
  worksheet.mergeCells("A1:I1");
  worksheet.getCell("A1").value = "CNHS Incident Report Log";
  worksheet.getCell("A1").font = { name: "Arial", size: 18, bold: true, color: { argb: "FF373085" } };
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells("A2:I2");
  worksheet.getCell("A2").value = `Generated ${new Date().toLocaleString("en-PH")}  |  Filtered reports  |  Prepared by: Admin`;
  worksheet.getCell("A2").font = { name: "Arial", size: 10, color: { argb: "FF475569" } };
  worksheet.getRow(2).height = 20;

  worksheet.mergeCells("A3:I3");
  worksheet.getCell("A3").value = `Total: ${reports.length}  |  Pending: ${counts.pending}  |  Under investigation: ${counts.investigating}  |  Resolved: ${counts.resolved}  |  Victim: ${counts.victims}  |  Friend of victim: ${counts.friends}`;
  worksheet.getCell("A3").font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1E293B" } };
  worksheet.getRow(3).height = 22;
  worksheet.getRow(4).height = 8;

  const headerRow = worksheet.addRow(columns.map((column) => column.header));
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF373085" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  reports.forEach((report, index) => {
    const row = worksheet.addRow([
      reportNumber(report.id),
      reportDate(report.submittedAt),
      reportDate(report.date),
      report.type || "—",
      report.location || "—",
      report.status || "—",
      report.isAnonymous ? "Anonymous" : report.submittedBy || "—",
      reporterRole(report.reporterType),
      report.description || "—",
    ]);
    row.height = 34;
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
      if (index % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
    });
    const statusCell = row.getCell(6);
    if (report.status === "Pending") {
      statusCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF92400E" } };
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    } else if (report.status === "Under Investigation") {
      statusCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1D4ED8" } };
    } else if (report.status === "Resolved") {
      statusCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF15803D" } };
    }
  });

  worksheet.autoFilter = `A5:I${Math.max(5, worksheet.rowCount)}`;
  worksheet.views = [{ state: "frozen", ySplit: 5 }];
  worksheet.pageSetup.printTitlesRow = "1:5";
  worksheet.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  workbook.creator = "CNHS Bullying & Incident Reporting System";

  const buffer = await workbook.xlsx.writeBuffer();
  downloadFile(
    `CNHS_Incident_Report_Log_${new Date().toISOString().slice(0, 10)}.xlsx`,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export async function downloadDOCX(reports) {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const data = getAnalyticsData(reports);
  const value = (item) => item == null || item === "" ? "—" : String(item);
  const detail = (label, item) => new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun(value(item)),
    ],
  });
  const children = [
    new Paragraph({ text: "CNHS Bullying & Incident Reporting System", heading: HeadingLevel.TITLE }),
    detail("Report generated", new Date(data.generatedAt).toLocaleString()),
    new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
    detail("Total reports", data.totalReports),
    detail("Pending", data.pendingReports),
    detail("In progress", data.inProgressReports),
    detail("Resolved", data.resolvedReports),
    new Paragraph({ text: "Individual reports", heading: HeadingLevel.HEADING_1 }),
  ];

  data.reports.forEach((report) => {
    children.push(
      new Paragraph({ text: `Report #${report.id}`, heading: HeadingLevel.HEADING_2 }),
      detail("Date", report.date),
      detail("Type", report.type),
      detail("Status", report.status),
      detail("Priority", report.priority),
      detail("Location", report.location),
      detail("Submitted by", `${report.submittedBy} (${report.submittedId})`),
      detail("Description", report.description),
      detail("Admin notes", report.adminNotes),
      detail("Submitted at", report.submittedAt),
    );
  });

  const document = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(document);
  downloadFile(
    `CNHS_Reports_${new Date().toISOString().slice(0,10)}.docx`,
    blob,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export async function downloadStudentOffenseRecords(records, format) {
  const actionDisplay = (value) => {
    const action = String(value || "").trim();
    if (/^(yes|true)$/i.test(action)) return "Intervention recorded";
    if (/^(no|false)$/i.test(action)) return "No intervention recorded";
    return action;
  };
  const headers = [
    "Student Name", "Student ID/LRN", "Grade", "Section", "Offense Number",
    "Incident Report IDs", "Bullying Type", "Incident Date", "Date Recorded",
    "Disciplinary Action", "Follow-up Date", "Follow-up Status", "Approved By",
  ];
  const rows = records.map((record) => [
    record.studentName,
    record.lrn,
    record.grade,
    record.section,
    record.offenseNumber,
    (record.incidentReportIds || [record.incidentReportId]).map((id) => `CNHS-${String(id).padStart(4, "0")}`).join(", "),
    record.incidentType,
    record.incidentDate,
    record.reviewedAt || record.approvedAt,
    actionDisplay(record.disciplinaryAction),
    record.followUpDate,
    record.followUpStatus,
    record.approvedBy,
  ].map((value) => value == null || value === "" ? "—" : String(value)));
  const filename = `CNHS_Student_Offense_Records_${new Date().toISOString().slice(0, 10)}`;

  if (format === "csv") {
    const escapeCell = (value) => {
      const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replace(/"/g, '""')}"`;
    };
    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
    downloadFile(`${filename}.csv`, csv, "text/csv;charset=utf-8");
    return;
  }

  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Student Offenses", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    worksheet.columns = headers.map((header) => ({ header, key: header, width: header === "Disciplinary Action" ? 48 : 20 }));
    worksheet.addRows(rows);
    worksheet.getRow(1).height = 28;
    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF373085" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, color: { argb: "FF1E293B" } };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });
    worksheet.autoFilter = `A1:M${Math.max(1, worksheet.rowCount)}`;
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    workbook.creator = "CNHS Bullying & Incident Reporting System";
    const buffer = await workbook.xlsx.writeBuffer();
    downloadFile(
      `${filename}.xlsx`,
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    return;
  }

  if (format === "docx") {
    const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
    const children = [
      new Paragraph({ text: "CNHS Student Offense Records", heading: HeadingLevel.TITLE }),
      new Paragraph(`Generated ${new Date().toLocaleString("en-PH")} | ${records.length} matching records`),
    ];
    records.forEach((record, index) => {
      const values = rows[index];
      children.push(new Paragraph({
        text: `${values[0]} — Offense #${values[4]}`,
        heading: HeadingLevel.HEADING_2,
      }));
      headers.forEach((header, valueIndex) => {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${header}: `, bold: true }),
            new TextRun(values[valueIndex]),
          ],
        }));
      });
    });
    const document = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(document);
    downloadFile(
      `${filename}.docx`,
      blob,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return;
  }

  throw new Error(`Unsupported student offense export format: ${format}`);
}
