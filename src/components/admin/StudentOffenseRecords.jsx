import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, ClipboardList,
  FileText, History, LoaderCircle, Search, ShieldCheck, UserRound, X,
} from "lucide-react";
import {
  createStudentOffenseRecord,
  getReportDetails,
  getReportEvidence,
  getStudentOffenseHistory,
  getStudentOffenseRecords,
  getGradeSections,
  prepareReportForOffenseApproval,
  saveOffenseDecision,
  searchOffenseReports,
} from "../../data/store";
import "../../styles/StudentOffenseRecords.css";

const PAGE_SIZE = 25;
const GRADE_LEVELS = ["Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
const OFFENSE_LEVELS = [
  { value: "1", label: "First Offense" },
  { value: "2", label: "Second Offense" },
  { value: "3", label: "Third Offense" },
  { value: "4+", label: "Subsequent Offenses" },
];
const BULLYING_TYPES = [
  { value: "Verbal", label: "Verbal Bullying" },
  { value: "Physical", label: "Physical Bullying" },
  { value: "Social", label: "Social Bullying" },
  { value: "Cyber", label: "Cyberbullying" },
];
const SORT_OPTIONS = [
  ["recent", "Most Recent Offense"],
  ["oldest", "Oldest Offense"],
  ["name_asc", "Student Name (A–Z)"],
  ["name_desc", "Student Name (Z–A)"],
  ["most_offenses", "Highest Number of Offenses"],
  ["least_offenses", "Lowest Number of Offenses"],
];
const DECISION_OPTIONS = [
  "Established",
  "Needs Further Investigation",
  "Not Established",
  "Resolved Through Mediation",
];
const INITIAL_FILTERS = {
  search: "", grade: "", section: "", offenseNumber: "", type: "",
  dateFrom: "", dateTo: "", action: "", sort: "recent",
};

function formatDate(value) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function currentDateInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function formatPeople(items = []) {
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    return item.name || item.full_name || item.student_name || item.person || "";
  }).filter(Boolean).join(", ");
}

function StudentOffenseRecords() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [filterOptions, setFilterOptions] = useState({ grades: [], sections: [], actions: [] });
  const [result, setResult] = useState({ records: [], total: 0, stats: { students: 0, offenses: 0, firstOffenses: 0, repeatOffenses: 0 } });
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reportDetails, setReportDetails] = useState(null);
  const [reportEvidence, setReportEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [studentForm, setStudentForm] = useState({ name: "", lrn: "", grade: "", section: "" });
  const [gradeSections, setGradeSections] = useState([]);
  const [sectionChoice, setSectionChoice] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportMatches, setReportMatches] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportReview, setReportReview] = useState(null);
  const [decision, setDecision] = useState("");
  const [decisionFindings, setDecisionFindings] = useState("");
  const [conferenceFindings, setConferenceFindings] = useState("");
  const [adminRemarks, setAdminRemarks] = useState("");
  const [reviewedAt, setReviewedAt] = useState(currentDateInput);
  const [savedDecision, setSavedDecision] = useState("");
  const [disciplinaryAction, setDisciplinaryAction] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const availableGrades = useMemo(() => [...new Set([...GRADE_LEVELS, ...filterOptions.grades])].sort((a, b) => {
    const numberA = Number(a.match(/\d+/)?.[0] || 0);
    const numberB = Number(b.match(/\d+/)?.[0] || 0);
    return numberA - numberB;
  }), [filterOptions.grades]);
  const availableSections = useMemo(() => [...new Set(filterOptions.sections
    .filter((item) => !filters.grade || item.grade === filters.grade)
    .map((item) => item.section)
  )].sort((a, b) => a.localeCompare(b)), [filterOptions.sections, filters.grade]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const loadRecords = useCallback(async (nextFilters, nextPage = 0) => {
    setLoading(true);
    setError("");
    try {
      const nextResult = await getStudentOffenseRecords({
        ...nextFilters,
        offset: nextPage * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      setResult(nextResult);
      setFilterOptions(nextResult.options);
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getStudentOffenseRecords({ limit: PAGE_SIZE })
      .then((records) => {
        if (!active) return;
        setFilterOptions(records.options);
        setResult(records);
      })
      .catch((loadError) => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!formOpen || gradeSections.length) return;
    let active = true;
    getGradeSections()
      .then((sections) => { if (active) setGradeSections(sections); })
      .catch((sectionsError) => { if (active) setFormError(`Could not load Grade & Sections options: ${sectionsError.message}`); });
    return () => { active = false; };
  }, [formOpen, gradeSections.length]);

  const sectionsForStudentGrade = useMemo(
    () => gradeSections.filter((item) => item.grade === studentForm.grade)
      .map((item) => item.section)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [gradeSections, studentForm.grade]
  );

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === "grade" ? { section: "" } : {}) }));
  };

  const applyFilters = async (event) => {
    event.preventDefault();
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      setError("Start date must be on or before end date.");
      return;
    }
    await loadRecords(filters);
    setFiltersOpen(false);
  };

  const clearFilters = async () => {
    setFilters(INITIAL_FILTERS);
    await loadRecords(INITIAL_FILTERS);
  };

  const openHistory = async (personKey) => {
    setHistoryLoading(true);
    setHistory({ loading: true });
    try {
      setHistory(await getStudentOffenseHistory(personKey));
    } catch (historyError) {
      setHistory({ error: historyError.message });
    } finally {
      setHistoryLoading(false);
    }
  };

  const resetForm = () => {
    setFormOpen(false);
    setStudentForm({ name: "", lrn: "", grade: "", section: "" });
    setSectionChoice("");
    setReportSearch("");
    setReportMatches([]);
    setSelectedReport(null);
    setReportReview(null);
    setDecision("");
    setDecisionFindings("");
    setConferenceFindings("");
    setAdminRemarks("");
    setReviewedAt(currentDateInput());
    setSavedDecision("");
    setDisciplinaryAction("");
    setFormError("");
  };

  const handleReportSearch = async (event) => {
    event.preventDefault();
    setFormLoading(true);
    setFormError("");
    try {
      setReportMatches(await searchOffenseReports(reportSearch, 20));
    } catch (searchError) {
      setFormError(searchError.message);
    } finally {
      setFormLoading(false);
    }
  };

  const chooseReport = (report) => {
    setSelectedReport(report);
    setReportReview(report);
    setReportEvidence(null);
    setSavedDecision("");
    setDecision("");
    setDecisionFindings("");
    setConferenceFindings(report.conferenceFindings || "");
    setAdminRemarks("");
    setFormError("");
  };

  const loadEvidence = async () => {
    if (!selectedReport || evidenceLoading) return;
    setEvidenceLoading(true);
    setFormError("");
    try {
      setReportEvidence(await getReportEvidence(selectedReport.id));
    } catch (evidenceError) {
      setFormError(`Could not load report evidence: ${evidenceError.message}`);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const submitDecision = async (event) => {
    event.preventDefault();
    if (!studentForm.name.trim() || !studentForm.grade || !selectedReport || !decision || !reviewedAt) {
      setFormError("Complete the student information, selected report, decision, and review date.");
      return;
    }
    if (decision === "Established" && !decisionFindings.trim()) {
      setFormError("Record the decision findings before establishing an offense.");
      return;
    }
    setFormLoading(true);
    setFormError("");
    try {
      await saveOffenseDecision(selectedReport.id, {
        ...studentForm,
        name: studentForm.name.trim(),
        lrn: studentForm.lrn.trim(),
        section: studentForm.section.trim(),
      }, decision, decisionFindings.trim(), {
        conferenceFindings: conferenceFindings.trim(),
        adminRemarks: adminRemarks.trim(),
        disciplinaryAction: disciplinaryAction.trim(),
        reviewedAt,
      });
      setSavedDecision(decision);
      setNotice(`Decision saved for Report #${selectedReport.id}.`);
    } catch (saveError) {
      setFormError(saveError.message);
    } finally {
      setFormLoading(false);
    }
  };

  const approveOffense = async () => {
    if (!studentForm.name.trim() || !selectedReport || savedDecision !== "Established") return;
    if (!disciplinaryAction.trim()) {
      setFormError("Enter the approved disciplinary action.");
      return;
    }
    const pendingStatusNotice = selectedReport.status === "Pending"
      ? " The pending report will also move to Under Investigation."
      : "";
    if (!window.confirm(`Approve an established offense record for ${studentForm.name.trim()} linked to Report #${selectedReport.id}?${pendingStatusNotice}`)) return;
    setFormLoading(true);
    setFormError("");
    try {
      const reportStatus = await prepareReportForOffenseApproval(selectedReport.id);
      const created = await createStudentOffenseRecord(
        selectedReport.id,
        { ...studentForm, name: studentForm.name.trim(), lrn: studentForm.lrn.trim(), section: studentForm.section.trim() }
      );
      setNotice(`Approved as Offense #${created.offenseNumber}.${reportStatus.changed ? " Report moved to Under Investigation." : ""}`);
      resetForm();
      await loadRecords(filters);
    } catch (approvalError) {
      setFormError(approvalError.message);
    } finally {
      setFormLoading(false);
    }
  };

  const openReport = async (reportId) => {
    setReportDetails({ loading: true });
    setReportEvidence(null);
    try {
      const details = await getReportDetails(reportId);
      setReportDetails(details);
    } catch (detailsError) {
      setReportDetails({ error: detailsError.message });
    }
  };

  const loadHistoryReportEvidence = async (reportId) => {
    setEvidenceLoading(true);
    setFormError("");
    try {
      setReportEvidence(await getReportEvidence(reportId));
    } catch (evidenceError) {
      setFormError(evidenceError.message);
    } finally {
      setEvidenceLoading(false);
    }
  };

  return (
    <div className="admin-content student-offense-page">
      <div className="student-offense-header">
        <div>
          <div className="student-offense-title"><ShieldCheck size={23} /><h2>Student Offense Records</h2></div>
          <p>Confidential records for offenses that were reviewed, established, and explicitly approved.</p>
        </div>
        <button type="button" className="student-offense-primary" onClick={() => { setFormError(""); setFormOpen(true); }}>
          <ClipboardList size={16} /> Add Offense Record
        </button>
      </div>

      <div className="student-offense-stats">
        {[
          ["Students with established offenses", result.stats.students, <UserRound size={18} />],
          ["Established offenses", result.stats.offenses, <ShieldCheck size={18} />],
          ["First offenses", result.stats.firstOffenses, <FileText size={18} />],
          ["Repeat offenses", result.stats.repeatOffenses, <History size={18} />],
        ].map(([label, value, icon]) => (
          <div className="student-offense-stat" key={label}>
            <span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div>
          </div>
        ))}
      </div>

      {notice && <div className="student-offense-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}

      <section className="student-offense-panel">
        <form className="student-offense-search" onSubmit={applyFilters}>
          <Search size={17} />
          <input
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Search student name, student ID/LRN, or incident report ID"
            aria-label="Search offense records"
          />
          <button type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</button>
        </form>

        <details className="student-offense-filter-panel" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
          <summary><span><ClipboardList size={15} /> Filters and sorting</span><small>{result.total} matching records</small></summary>
          <form onSubmit={applyFilters}>
            <div className="student-offense-filter-grid">
              <label>Grade level
                <select value={filters.grade} onChange={(event) => updateFilter("grade", event.target.value)}>
                  <option value="">All grades</option>
                  {availableGrades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                </select>
              </label>
              <label>Section
                <select value={filters.section} onChange={(event) => updateFilter("section", event.target.value)} disabled={!availableSections.length}>
                  <option value="">All sections</option>
                  {availableSections.map((section) => <option key={section} value={section}>{section}</option>)}
                </select>
              </label>
              <label>Offense number
                <select value={filters.offenseNumber} onChange={(event) => updateFilter("offenseNumber", event.target.value)}>
                  <option value="">All offenses</option>
                  {OFFENSE_LEVELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>Bullying type
                <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
                  <option value="">All types</option>
                  {BULLYING_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>Date recorded from<input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} /></label>
              <label>Date recorded to<input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} /></label>
              <label>Disciplinary action
                <select value={filters.action} onChange={(event) => updateFilter("action", event.target.value)}>
                  <option value="">All actions</option>
                  {filterOptions.actions.map((action) => <option key={action} value={action}>{action}</option>)}
                </select>
              </label>
              <label>Sort by
                <select value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
                  {SORT_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
            </div>
            {error && <p className="student-offense-error" role="alert">{error}</p>}
            <div className="student-offense-filter-actions">
              <button type="button" className="student-offense-secondary" onClick={clearFilters} disabled={loading}>Clear all filters</button>
              <button type="submit" className="student-offense-primary" disabled={loading}>{loading ? "Applying…" : "Apply filters"}</button>
            </div>
          </form>
        </details>

        <div className="student-offense-table-wrap">
          {loading ? (
            <div className="student-offense-state"><LoaderCircle className="student-offense-spinner" size={23} />Loading approved offense records…</div>
          ) : error ? (
            <div className="student-offense-state student-offense-state-error"><AlertTriangle size={20} /><span>{error}<small>Confirm the Student Offense Records SQL migration has been applied to Supabase.</small></span></div>
          ) : result.records.length === 0 ? (
            <div className="student-offense-state"><ShieldCheck size={24} /><span>No established offense records match these filters.<small>Submitted reports and completed conferences are not offense records.</small></span></div>
          ) : (
            <table className="student-offense-table">
              <thead><tr><th>Student</th><th>Offense</th><th>Incident</th><th>Action</th><th>Approved by</th><th>Date recorded</th><th>History</th></tr></thead>
              <tbody>
                {result.records.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.studentName}</strong><small>{[record.lrn, record.grade, record.section].filter(Boolean).join(" · ") || "Student details unavailable"}</small></td>
                    <td><span className="student-offense-number">#{record.offenseNumber}</span><small>{record.studentOffenseCount > 1 ? `${record.studentOffenseCount} total` : "First offense"}</small></td>
                    <td><button type="button" className="student-offense-link" onClick={() => openReport(record.incidentReportId)}>Report #{record.incidentReportId}</button><small>{record.incidentType} · {formatDate(record.incidentDate)}</small></td>
                    <td>{record.disciplinaryAction}</td>
                    <td>{record.approvedBy}</td>
                    <td>{formatDate(record.reviewedAt)}</td>
                    <td><button type="button" className="student-offense-history-btn" onClick={() => openHistory(record.personKey)} aria-label={`View ${record.studentName}'s offense history`}><History size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="student-offense-pagination">
          <span>{result.total ? `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, result.total)} of ${result.total}` : "0 matching records"}</span>
          <div>
            <button type="button" onClick={() => loadRecords(filters, page - 1)} disabled={loading || page === 0}><ChevronLeft size={15} /> Previous</button>
            <span>Page {page + 1} of {totalPages}</span>
            <button type="button" onClick={() => loadRecords(filters, page + 1)} disabled={loading || page + 1 >= totalPages}>Next <ChevronRight size={15} /></button>
          </div>
        </div>
      </section>

      {formOpen && (
        <div className="student-offense-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !formLoading) resetForm(); }}>
          <section className="student-offense-modal" role="dialog" aria-modal="true" aria-labelledby="student-offense-form-title">
            <div className="student-offense-modal-header"><div><h3 id="student-offense-form-title">Add Offense Record</h3><p>Records are created only after an explicit established decision and approval.</p></div><button type="button" onClick={resetForm} aria-label="Close form"><X size={19} /></button></div>
            <div className="student-offense-modal-content">
              <section className="student-offense-form-step">
                <h4>1. Student information</h4>
                <div className="student-offense-student-fields">
                  <label className="student-offense-field">Student full name
                    <input value={studentForm.name} onChange={(event) => { setStudentForm((current) => ({ ...current, name: event.target.value })); setSavedDecision(""); }} required autoComplete="off" />
                  </label>
                  <label className="student-offense-field">Student ID / LRN
                    <input value={studentForm.lrn} onChange={(event) => { setStudentForm((current) => ({ ...current, lrn: event.target.value })); setSavedDecision(""); }} autoComplete="off" />
                  </label>
                  <label className="student-offense-field">Grade level
                    <select value={studentForm.grade} onChange={(event) => { setStudentForm((current) => ({ ...current, grade: event.target.value, section: "" })); setSectionChoice(""); setSavedDecision(""); }} required>
                      <option value="">Select grade</option>
                      {GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                    </select>
                  </label>
                  <label className="student-offense-field">Section
                    <select value={sectionChoice} onChange={(event) => { const value = event.target.value; setSectionChoice(value); if (value !== "__manual__") setStudentForm((current) => ({ ...current, section: value })); else setStudentForm((current) => ({ ...current, section: "" })); setSavedDecision(""); }} required>
                      <option value="">{studentForm.grade ? (sectionsForStudentGrade.length ? "Select section" : "No sections configured") : "Select grade first"}</option>
                      {sectionsForStudentGrade.map((section) => <option key={section} value={section}>{section}</option>)}
                      <option value="__manual__">Enter section manually</option>
                    </select>
                    {sectionChoice === "__manual__" && <input value={studentForm.section} onChange={(event) => { setStudentForm((current) => ({ ...current, section: event.target.value })); setSavedDecision(""); }} placeholder="Enter section" autoComplete="off" required />}
                  </label>
                </div>
                <p className="student-offense-help">Sections update from the Grade & Sections module when you choose a grade. No student account is created or required.</p>
              </section>
              <section className="student-offense-form-step">
                <h4>2. Select submitted incident report</h4>
                <form className="student-offense-search" onSubmit={handleReportSearch}>
                  <Search size={16} /><input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search report ID, reporter, incident type, or submission date" />
                  <button type="submit" disabled={formLoading}>{formLoading ? "Searching…" : "Search"}</button>
                </form>
                <p className="student-offense-help">Reports are searchable independently of student profile links. Anonymous reporter information remains protected.</p>
                {reportMatches.length > 0 && (
                  <ul className="student-offense-select-list">
                    {reportMatches.map((report) => (
                      <li key={report.id}><span><strong>Report #{report.id} · {report.type}</strong><small>{formatDate(report.date)} · Submitted {formatDate(report.submittedAt)} · {report.reporterName || "Anonymous"} · {report.status}</small></span><button type="button" onClick={() => chooseReport(report)}>Review</button></li>
                    ))}
                  </ul>
                )}
                {selectedReport && reportReview && (
                  <div className="student-offense-report-review">
                    <div className="student-offense-report-review-header"><strong>Report #{reportReview.id} · {reportReview.type}</strong><span>{formatDate(reportReview.date)}{reportReview.time ? ` · ${reportReview.time}` : ""}</span></div>
                    <p><strong>Location:</strong> {reportReview.location || "—"}</p>
                    <p><strong>Submitted:</strong> {formatDate(reportReview.submittedAt)} · <strong>Reporter:</strong> {reportReview.isAnonymous ? "Anonymous" : reportReview.submittedBy || "—"} · <strong>Status:</strong> {reportReview.status}</p>
                    <p><strong>Description:</strong> {reportReview.description || "No description provided."}</p>
                    <p><strong>Victims:</strong> {formatPeople(reportReview.victims) || "—"}</p>
                    <p><strong>Reported individuals:</strong> {formatPeople(reportReview.offenders) || "—"}</p>
                    <p><strong>Witnesses:</strong> {formatPeople(reportReview.witnesses) || "—"}</p>
                    <p><strong>Evidence:</strong> {reportReview.evidenceCount || 0} file(s) attached</p>
                    {reportReview.scheduledConference && <p><strong>Conference:</strong> {reportReview.scheduledConference.status || (reportReview.scheduledConference.completed ? "Completed" : "Scheduled")} · {reportReview.scheduledConference.date || "Date not set"}</p>}
                    {reportReview.conferenceFindings && <p className="student-offense-findings"><strong>Existing conference findings:</strong> {reportReview.conferenceFindings}</p>}
                    <button type="button" className="student-offense-secondary" onClick={loadEvidence} disabled={evidenceLoading || !reportReview.evidenceCount}>
                      {evidenceLoading ? "Loading evidence…" : reportEvidence ? "Evidence loaded" : "Review attached evidence"}
                    </button>
                    {reportEvidence?.length > 0 && <ul className="student-offense-evidence-list">{reportEvidence.map((item, index) => <li key={`${item.name}-${index}`}><a href={item.data} target="_blank" rel="noreferrer">{item.name || `Evidence ${index + 1}`}</a></li>)}</ul>}
                  </div>
                )}
              </section>
              {selectedReport && reportReview && (
                <form className="student-offense-form-step" onSubmit={submitDecision}>
                  <h4>3. Conference findings and review</h4>
                  <label className="student-offense-field">Conference findings
                    <textarea value={conferenceFindings} onChange={(event) => { setConferenceFindings(event.target.value); setSavedDecision(""); }} rows={3} placeholder="Summarize the conference findings, if applicable." />
                  </label>
                  <label className="student-offense-field">Admin/Prefect remarks
                    <textarea value={adminRemarks} onChange={(event) => { setAdminRemarks(event.target.value); setSavedDecision(""); }} rows={2} placeholder="Add review notes or remarks." />
                  </label>
                  <label className="student-offense-field">Date of review
                    <input type="date" value={reviewedAt} onChange={(event) => { setReviewedAt(event.target.value); setSavedDecision(""); }} required />
                  </label>
                  <h4>4. Final decision and disciplinary action</h4>
                  <p className="student-offense-help">Conference completion alone does not establish an offense. Only an Established decision followed by explicit approval is counted.</p>
                  <p className="student-offense-help">If the report is Pending, approval moves it to Under Investigation automatically.</p>
                  <label className="student-offense-field">Final decision
                    <select value={decision} onChange={(event) => { setDecision(event.target.value); setSavedDecision(""); }} required>
                      <option value="">Select an outcome</option>
                      {DECISION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="student-offense-field">Decision findings
                    <textarea value={decisionFindings} onChange={(event) => { setDecisionFindings(event.target.value); setSavedDecision(""); }} rows={3} placeholder="Document the decision and its basis." required={decision === "Established"} />
                  </label>
                  <label className="student-offense-field">Recommended or approved disciplinary action
                    <textarea value={disciplinaryAction} onChange={(event) => { setDisciplinaryAction(event.target.value); setSavedDecision(""); }} rows={2} placeholder="Enter the recommended or approved action." />
                  </label>
                  <button type="submit" className="student-offense-secondary" disabled={formLoading || !decision}>
                    {formLoading ? "Saving review…" : "Save review decision"}
                  </button>
                  {savedDecision && <p className="student-offense-saved-decision">Saved outcome: <strong>{savedDecision}</strong></p>}
                  {savedDecision === "Established" && (
                    <div className="student-offense-approval">
                      <p className="student-offense-help">This creates an official offense record and assigns the next offense number.</p>
                      <button type="button" className="student-offense-primary" onClick={approveOffense} disabled={formLoading || !disciplinaryAction.trim()}>
                        {formLoading ? "Approving…" : "Approve and create offense record"}
                      </button>
                    </div>
                  )}
                </form>
              )}
              {formError && <p className="student-offense-error" role="alert">{formError}</p>}
            </div>
          </section>
        </div>
      )}

      {history && (
        <div className="student-offense-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistory(null); }}>
          <section className="student-offense-modal student-offense-history-modal" role="dialog" aria-modal="true" aria-labelledby="student-offense-history-title">
            <div className="student-offense-modal-header"><div><h3 id="student-offense-history-title">{history.student?.name || "Student"} — Offense History</h3><p>{[history.student?.lrn, history.student?.grade, history.student?.section].filter(Boolean).join(" · ")}</p></div><button type="button" onClick={() => setHistory(null)} aria-label="Close history"><X size={19} /></button></div>
            <div className="student-offense-modal-content">
              {historyLoading || history.loading ? <div className="student-offense-state"><LoaderCircle className="student-offense-spinner" size={22} />Loading history…</div>
                : history.error ? <p className="student-offense-error">{history.error}</p>
                  : history.records.length === 0 ? <p className="student-offense-empty">No established offenses for this student.</p> : (
                    <ol className="student-offense-timeline">
                      {history.records.map((record) => (
                        <li key={record.id}>
                          <span className="student-offense-timeline-dot" />
                          <div className="student-offense-timeline-card">
                            <div className="student-offense-timeline-heading"><strong>Offense #{record.offenseNumber}</strong><span>{formatDate(record.approvedAt)}</span></div>
                            <p><strong>{record.incidentType}</strong> · {formatDate(record.incidentDate)} · <button type="button" className="student-offense-link" onClick={() => openReport(record.incidentReportId)}>Report #{record.incidentReportId}</button></p>
                            <p><strong>Student ID/LRN:</strong> {history.student?.lrn || "—"} · <strong>Grade/Section:</strong> {[history.student?.grade, history.student?.section].filter(Boolean).join(" / ") || "—"}</p>
                            {record.conferenceFindings && <p><strong>Conference findings:</strong> {record.conferenceFindings}</p>}
                            {record.adminRemarks && <p><strong>Admin/Prefect remarks:</strong> {record.adminRemarks}</p>}
                            <p><strong>Decision findings:</strong> {history.decisions.find((decisionItem) => decisionItem.reportId === record.incidentReportId)?.findings || "—"}</p>
                            <p><strong>Disciplinary action:</strong> {record.disciplinaryAction}</p>
                            <p><strong>Approved by:</strong> {record.approvedBy || "Administrator"}</p>
                            <p><strong>Date reviewed:</strong> {formatDate(record.reviewedAt)}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
              {history.decisions?.length > 0 && (
                <section className="student-offense-decision-history">
                  <h4>Other recorded decisions</h4>
                  {history.decisions.filter((decisionItem) => decisionItem.outcome !== "Established" || !history.records.some((record) => record.incidentReportId === decisionItem.reportId)).map((decisionItem) => (
                    <div key={decisionItem.id}><strong>{decisionItem.outcome}</strong><span>Report #{decisionItem.reportId} · {formatDate(decisionItem.decidedAt)}</span><p>{decisionItem.findings}</p></div>
                  ))}
                </section>
              )}
            </div>
          </section>
        </div>
      )}

      {reportDetails && (
        <div className="student-offense-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setReportDetails(null); setReportEvidence(null); } }}>
          <section className="student-offense-modal student-offense-report-modal" role="dialog" aria-modal="true" aria-labelledby="student-offense-report-title">
            <div className="student-offense-modal-header"><div><h3 id="student-offense-report-title">Incident Report #{reportDetails.id || ""}</h3><p>Original report details</p></div><button type="button" onClick={() => { setReportDetails(null); setReportEvidence(null); }} aria-label="Close report"><X size={19} /></button></div>
            <div className="student-offense-modal-content">
              {reportDetails.loading ? <div className="student-offense-state"><LoaderCircle className="student-offense-spinner" size={22} />Loading report…</div>
                : reportDetails.error ? <p className="student-offense-error">{reportDetails.error}</p> : (
                  <>
                    <div className="student-offense-report-meta"><span><strong>Type</strong>{reportDetails.type}</span><span><strong>Incident date</strong>{formatDate(reportDetails.date)}</span><span><strong>Status</strong>{reportDetails.status}</span><span><strong>Location</strong>{reportDetails.location || "—"}</span></div>
                    <p className="student-offense-report-description">{reportDetails.description || "No description provided."}</p>
                    <p><strong>Reporter:</strong> {reportDetails.isAnonymous ? "Anonymous" : reportDetails.submittedBy || "—"}</p>
                    {reportDetails.conferenceFindings && <p className="student-offense-findings"><strong>Conference findings:</strong> {reportDetails.conferenceFindings}</p>}
                    <button type="button" className="student-offense-secondary" onClick={() => loadHistoryReportEvidence(reportDetails.id)} disabled={evidenceLoading || !reportDetails.evidenceCount}>
                      {evidenceLoading ? "Loading evidence…" : `Review attached evidence (${reportDetails.evidenceCount || 0})`}
                    </button>
                    {reportEvidence?.length > 0 && <ul className="student-offense-evidence-list">{reportEvidence.map((item, index) => <li key={`${item.name}-${index}`}><a href={item.data} target="_blank" rel="noreferrer">{item.name || `Evidence ${index + 1}`}</a></li>)}</ul>}
                  </>
                )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default StudentOffenseRecords;
