import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Calendar, CheckCircle, ChevronRight, Clock, X,
} from "lucide-react";
import {
  reviewConferenceRequest,
  updateConferenceOutcome,
  updateConferenceSchedule,
} from "../../data/store";
import "../../styles/ConferenceManagement.css";

const FILTERS = [
  ["Needs action", "needs-action"],
  ["Today", "today"],
  ["Upcoming", "upcoming"],
  ["Completed", "completed"],
  ["All", "all"],
];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOffset(date, today = localDateKey()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(target) ? Math.round((target - current) / 86_400_000) : null;
}

function getConferenceStatus(conference, today, outcomeNotes = "") {
  const savedStatus = conference.status || (conference.completed ? "Completed" : "Scheduled");
  if (savedStatus === "Completed" && (outcomeNotes || conference.outcomeNotes || "").trim()) return savedStatus;
  if (["No-show", "Cancelled"].includes(savedStatus)) return savedStatus;
  const offset = dateOffset(conference.date, today);
  if (offset === null) return "Scheduled";
  if (offset < 0) return "Overdue";
  if (offset === 0) return "Today";
  return "Scheduled";
}

function formatStatusClass(status) {
  return status.toLowerCase().replace(/\s/g, "-");
}

function conferenceFromReport(report, today) {
  const conference = report.scheduledConference || {};
  if (!conference.date && !conference.time && !conference.location) return null;
  return {
    id: report.id,
    type: report.type || "Incident",
    status: getConferenceStatus(conference, today, report.conferenceFindings || ""),
    date: conference.date || "",
    time: conference.time || "",
    location: conference.location || "",
    notes: conference.notes || "",
    request: conference.request || null,
    history: Array.isArray(conference.history) ? conference.history : [],
    previousSchedule: conference.previousSchedule || null,
    rescheduledFrom: conference.rescheduledFrom || null,
    noShow: conference.noShow || null,
    intervention: conference.intervention || "",
    outcomeNotes: report.conferenceFindings || conference.outcomeNotes || "",
    reporterName: report.isAnonymous ? "Anonymous" : report.submittedBy || "Unknown reporter",
  };
}

function getUrgency(conference, today) {
  const offset = dateOffset(conference.date, today);
  if (conference.status === "Overdue") return [0, offset ?? 0];
  if (conference.status === "Today") return [1, 0];
  if (conference.status === "No-show") return [2, 0];
  if (conference.request?.state === "Pending") return [3, offset ?? 0];
  if (conference.status === "Scheduled") return [4, offset ?? Number.MAX_SAFE_INTEGER];
  if (conference.status === "Completed") return [5, offset ?? 0];
  return [6, offset ?? 0];
}

function formatDaysAgo(date, today) {
  const offset = dateOffset(date, today);
  const days = Math.abs(offset || 0);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatHistoryTimestamp(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Time not recorded";
}

function ConferenceModal({ children, onClose, title, icon = true }) {
  return (
    <div className="conference-manager-overlay" onClick={onClose}>
      <section
        className="conference-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="conference-manager-modal-header">
          <div className="conference-manager-modal-title">
            {icon && <Calendar size={18} />}
            <h2>{title}</h2>
          </div>
          <button type="button" className="conference-manager-close" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function ConferenceManagement({ reports, onReportsUpdated, onToast }) {
  const [filter, setFilter] = useState("upcoming");
  const [selectedId, setSelectedId] = useState(null);
  const [actionMode, setActionMode] = useState("");
  const [actionSaving, setActionSaving] = useState(false);
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [intervention, setIntervention] = useState("");
  const [missedBy, setMissedBy] = useState([]);
  const [noShowReason, setNoShowReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [requestDate, setRequestDate] = useState("");
  const [requestTime, setRequestTime] = useState("");
  const [requestLocation, setRequestLocation] = useState("");

  const [today, setToday] = useState(localDateKey);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDateKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const conferences = useMemo(() => reports
    .map((report) => conferenceFromReport(report, today))
    .filter(Boolean)
    .sort((a, b) => {
      const [aRank, aDate] = getUrgency(a, today);
      const [bRank, bDate] = getUrgency(b, today);
      return aRank - bRank || aDate - bDate || Number(a.id) - Number(b.id);
    }), [reports, today]);

  const needsAction = conferences.filter((conference) =>
    ["Overdue", "Today", "No-show"].includes(conference.status) ||
    conference.request?.state === "Pending"
  );
  const todayConferences = conferences.filter((conference) => conference.status === "Today");
  const upcoming = conferences.filter((conference) => conference.status === "Scheduled");
  const completed = conferences.filter((conference) => conference.status === "Completed");
  const counts = {
    "needs-action": needsAction.length,
    today: todayConferences.length,
    upcoming: upcoming.length,
    completed: completed.length,
    all: conferences.length,
  };
  const visibleConferences = {
    "needs-action": needsAction,
    today: todayConferences,
    upcoming,
    completed,
    all: conferences,
  }[filter];
  const active = selectedId === null
    ? null
    : conferences.find((conference) => conference.id === selectedId) || null;
  const canActOnSchedule = active && ["Scheduled", "Overdue", "Today", "Rescheduled"].includes(active.status);
  const canReschedule = canActOnSchedule || active?.status === "No-show";

  const closeDetails = () => {
    setSelectedId(null);
    setActionMode("");
  };

  const openDetails = (conference) => {
    setSelectedId(conference.id);
    setActionMode("");
    setOutcomeNotes("");
    setIntervention("");
    setMissedBy([]);
    setNoShowReason("");
    setNewDate(conference.date);
    setNewTime(conference.time);
    setNewLocation(conference.location);
    setRescheduleReason("");
    setRequestDate(conference.date);
    setRequestTime(conference.time);
    setRequestLocation(conference.location);
  };

  const notifyUpdated = async (message) => {
    try {
      await onReportsUpdated();
      onToast(message);
      setActionMode("");
    } catch (error) {
      onToast(`${message} The dashboard could not refresh: ${error.message}`, "error");
    }
  };

  const handleOutcome = async (status) => {
    if (!active || actionSaving) return;
    if (status === "Completed" && !outcomeNotes.trim()) {
      onToast("Record the conference outcome before marking it completed.", "error");
      return;
    }
    if (status === "No-show" && missedBy.length === 0) {
      onToast("Choose who did not attend.", "error");
      return;
    }
    setActionSaving(true);
    try {
      await updateConferenceOutcome(active.id, status, status === "Completed"
        ? { outcomeNotes, intervention }
        : { missedBy, reason: noShowReason });
      await notifyUpdated(status === "Completed"
        ? "Conference completed. Case sent to the offense-review workflow."
        : "No-show recorded. The case remains open.");
    } catch (error) {
      onToast(`Could not update conference: ${error.message}`, "error");
    } finally {
      setActionSaving(false);
    }
  };

  const handleReschedule = async (event) => {
    event.preventDefault();
    if (!active || actionSaving) return;
    if (!newDate || !newTime || !rescheduleReason.trim()) {
      onToast("Choose a new date and time, and enter a reschedule reason.", "error");
      return;
    }
    setActionSaving(true);
    try {
      await updateConferenceSchedule(active.id, {
        operation: "reschedule",
        date: newDate,
        time: newTime,
        location: newLocation || active.location,
        notes: active.notes,
        reason: rescheduleReason,
      });
      await notifyUpdated("Conference rescheduled.");
    } catch (error) {
      onToast(`Could not reschedule conference: ${error.message}`, "error");
    } finally {
      setActionSaving(false);
    }
  };

  const handleReviewRequest = async (decision) => {
    if (!active || actionSaving) return;
    const isReschedule = active.request?.type === "reschedule";
    if (decision === "approve" && isReschedule &&
      (!requestDate || !requestTime || !requestLocation.trim())) {
      onToast("Choose the approved date, time, and location.", "error");
      return;
    }
    setActionSaving(true);
    try {
      await reviewConferenceRequest(active.id, decision, decision === "approve" && isReschedule
        ? { date: requestDate, time: requestTime, location: requestLocation, notes: active.notes }
        : undefined);
      await notifyUpdated(`Conference request ${decision === "approve" ? "approved" : "rejected"}.`);
    } catch (error) {
      onToast(`Could not review conference request: ${error.message}`, "error");
    } finally {
      setActionSaving(false);
    }
  };

  return (
    <>
      <aside className="conference-manager-panel" aria-label="Conference Management">
        <header className="conference-manager-panel-header">
          <div className="conference-manager-panel-title">
            <Calendar size={17} />
            <div>
              <h2>Conference Management</h2>
              <span className="conference-manager-action-count">
                {needsAction.length} need action
              </span>
            </div>
          </div>
        </header>

        <div className="conference-manager-filters" aria-label="Filter conferences">
          {FILTERS.map(([label, value]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}<span>{counts[value]}</span>
            </button>
          ))}
        </div>

        {visibleConferences.length === 0 ? (
          <div className="conference-manager-empty">
            {filter === "needs-action"
              ? "No conferences need action."
              : "No conferences match this filter."}
          </div>
        ) : (
          <div className="conference-manager-list">
            {visibleConferences.map((conference) => {
              return (
                <button
                  type="button"
                  className={`conference-manager-card ${conference.status === "Overdue" ? "overdue" : ""} ${conference.status === "Today" ? "today" : ""}`}
                  key={conference.id}
                  onClick={() => openDetails(conference)}
                  aria-label={`View conference details for case ${conference.id}, ${conference.status}`}
                >
                  <span className="conference-manager-card-top">
                    <strong>Case #{conference.id}</strong>
                    <span className={`conference-manager-status ${formatStatusClass(conference.status)}`}>
                      {conference.status}
                    </span>
                  </span>
                  <span className="conference-manager-type">{conference.type}</span>
                  <span className="conference-manager-date">
                    <Calendar size={13} /> {conference.date || "Date TBD"}
                    {conference.time && <><span aria-hidden="true">·</span><Clock size={13} /> {conference.time}</>}
                  </span>
                  {conference.status === "Overdue" && (
                    <span className="conference-manager-days-ago">{formatDaysAgo(conference.date, today)}</span>
                  )}
                  {conference.status === "Today" && (
                    <span className="conference-manager-today-note">Scheduled for today</span>
                  )}
                  {conference.previousSchedule?.date && (
                    <span className="conference-manager-rescheduled">
                      Rescheduled from {conference.previousSchedule.date}
                    </span>
                  )}
                  {conference.request?.state === "Pending" && (
                    <span className="conference-manager-request-note">
                      {conference.request.type === "reschedule" ? "Reschedule" : "Cancellation"} request pending
                    </span>
                  )}
                  <ChevronRight className="conference-manager-chevron" size={15} />
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {active && (
        <ConferenceModal title="Conference Details" onClose={closeDetails}>
          <div className="conference-manager-content">
            <div className={`conference-manager-banner ${active.status === "Overdue" ? "overdue" : ""}`}>
              <div className="conference-manager-banner-heading">
                <strong>Case #{active.id}</strong>
                <span className={`conference-manager-status ${formatStatusClass(active.status)}`}>{active.status}</span>
              </div>
              <p>Conference details, schedule, and recorded outcome.</p>
            </div>

            {active.status === "Overdue" && (
              <div className="conference-manager-overdue-alert" role="status">
                <AlertTriangle size={17} />
                <span>This conference was {formatDaysAgo(active.date, today)}. Record the outcome.</span>
              </div>
            )}
            {active.status === "No-show" && active.noShow?.missedBy?.includes("reporter") && (
              <div className="conference-manager-follow-up" role="status">
                The reporter did not attend. This case remains open. Reschedule the conference or arrange counselor follow-up.
              </div>
            )}

            <div className="conference-manager-details">
              <div><label>Case</label><span>#{active.id}</span></div>
              <div><label>Status</label><span className={`conference-manager-status ${formatStatusClass(active.status)}`}>{active.status}</span></div>
              <div><label>Type</label><span>{active.type}</span></div>
              <div><label>Reporter</label><span>{active.reporterName}</span></div>
              <div><label>Date</label><span>{active.date || "Date TBD"}</span></div>
              <div><label>Time</label><span>{active.time || "Time TBD"}</span></div>
              <div className="wide"><label>Location</label><span>{active.location || "Location TBD"}</span></div>
              <div className="wide"><label>Agenda / Notes</label><span>{active.notes || "—"}</span></div>
            </div>

            {(active.rescheduledFrom || active.previousSchedule?.date) && (
              <p className="conference-manager-rescheduled">
                Rescheduled from {active.rescheduledFrom || active.previousSchedule.date}
              </p>
            )}

            {active.status === "Completed" && (
              <section className="conference-manager-recorded-outcome">
                <h3><CheckCircle size={16} /> Recorded outcome</h3>
                <p>{active.outcomeNotes || "No outcome notes available."}</p>
                {active.intervention && <p><strong>Sanction / intervention:</strong> {active.intervention}</p>}
              </section>
            )}

            {active.status === "No-show" && (
              <section className="conference-manager-recorded-outcome">
                <h3>No-show recorded</h3>
                <p><strong>Did not attend:</strong> {(active.noShow?.missedBy || []).map((person) =>
                  person === "reporter" ? "Reporter" : "Reported student"
                ).join(" and ") || "Not recorded"}</p>
                {active.noShow?.reason && <p><strong>Reason:</strong> {active.noShow.reason}</p>}
              </section>
            )}

            {active.history.length > 0 && (
              <details className="conference-manager-history">
                <summary>Conference history ({active.history.length})</summary>
                <ol>
                  {[...active.history].reverse().map((entry, index) => (
                    <li key={`${entry.at || entry.changedAt || "history"}-${index}`}>
                      <strong>{entry.actionLabel || entry.action}</strong>
                      <span>{formatHistoryTimestamp(entry.at || entry.changedAt)}</span>
                      <span>By {entry.actorName || entry.actorEmail || entry.actorId || "Administrator"}</span>
                      {entry.reason && <span>Reason: {entry.reason}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {active.request?.state === "Pending" ? (
              <section className="conference-manager-action-form">
                <h3>{active.request.type === "reschedule" ? "Reschedule request" : "Cancellation request"}</h3>
                {active.request.reason && <p>Student's reason: {active.request.reason}</p>}
                {active.request.type === "reschedule" && (
                  <div className="conference-manager-fields">
                    <label>New date<input type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></label>
                    <label>New time<input type="time" value={requestTime} onChange={(event) => setRequestTime(event.target.value)} /></label>
                    <label className="wide">Location<input type="text" value={requestLocation} onChange={(event) => setRequestLocation(event.target.value)} /></label>
                  </div>
                )}
                <div className="conference-manager-actions">
                  <button type="button" className="secondary" onClick={() => handleReviewRequest("reject")} disabled={actionSaving}>
                    Reject request
                  </button>
                  <button type="button" onClick={() => handleReviewRequest("approve")} disabled={actionSaving}>
                    {actionSaving ? "Saving…" : active.request.type === "reschedule" ? "Approve reschedule" : "Approve cancellation"}
                  </button>
                </div>
              </section>
            ) : (canActOnSchedule || active.status === "No-show") && (
              <section className="conference-manager-actions-block">
                <div className="conference-manager-actions">
                  {canActOnSchedule && (
                    <>
                      <button type="button" onClick={() => setActionMode("completed")}>
                        <CheckCircle size={15} /> Mark as Completed
                      </button>
                      <button type="button" className="secondary" onClick={() => {
                        setMissedBy([]);
                        setNoShowReason("");
                        setActionMode("no-show");
                      }}>
                        Mark as No-show
                      </button>
                    </>
                  )}
                  {canReschedule && (
                    <button type="button" className="secondary" onClick={() => setActionMode("reschedule")}>
                      <Calendar size={15} /> Reschedule
                    </button>
                  )}
                </div>
              </section>
            )}

            {actionMode === "completed" && (
              <section className="conference-manager-action-form">
                <h3>Record conference outcome</h3>
                <label>Outcome notes <span aria-hidden="true">*</span>
                  <textarea rows={4} value={outcomeNotes} onChange={(event) => setOutcomeNotes(event.target.value)} required />
                </label>
                <label>Sanction or intervention (optional)
                  <textarea rows={2} value={intervention} onChange={(event) => setIntervention(event.target.value)} />
                </label>
                <div className="conference-manager-actions">
                  <button type="button" className="secondary" onClick={() => setActionMode("")}>Cancel</button>
                  <button type="button" onClick={() => handleOutcome("Completed")} disabled={actionSaving}>
                    {actionSaving ? "Saving…" : "Save outcome"}
                  </button>
                </div>
              </section>
            )}

            {actionMode === "no-show" && (
              <section className="conference-manager-action-form">
                <h3>Record who did not attend</h3>
                <div className="conference-manager-checkboxes">
                  {[
                    ["reporter", "Reporter"],
                    ["reported_student", "Reported student"],
                  ].map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        checked={missedBy.includes(value)}
                        onChange={(event) => setMissedBy((current) => event.target.checked
                          ? [...current, value]
                          : current.filter((item) => item !== value))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label>Reason (optional)
                  <textarea rows={2} value={noShowReason} onChange={(event) => setNoShowReason(event.target.value)} />
                </label>
                <div className="conference-manager-actions">
                  <button type="button" className="secondary" onClick={() => setActionMode("")}>Cancel</button>
                  <button type="button" onClick={() => handleOutcome("No-show")} disabled={actionSaving}>
                    {actionSaving ? "Saving…" : "Save no-show"}
                  </button>
                </div>
              </section>
            )}

            {actionMode === "reschedule" && (
              <form className="conference-manager-action-form" onSubmit={handleReschedule}>
                <h3>Reschedule conference</h3>
                <div className="conference-manager-fields">
                  <label>New date <span aria-hidden="true">*</span><input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} required /></label>
                  <label>New time <span aria-hidden="true">*</span><input type="time" value={newTime} onChange={(event) => setNewTime(event.target.value)} required /></label>
                  <label className="wide">Location<input type="text" value={newLocation} onChange={(event) => setNewLocation(event.target.value)} /></label>
                </div>
                <label>Reason <span aria-hidden="true">*</span>
                  <textarea rows={3} value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} required />
                </label>
                <div className="conference-manager-actions">
                  <button type="button" className="secondary" onClick={() => setActionMode("")}>Cancel</button>
                  <button type="submit" disabled={actionSaving}>{actionSaving ? "Saving…" : "Save new schedule"}</button>
                </div>
              </form>
            )}
          </div>
        </ConferenceModal>
      )}

    </>
  );
}
