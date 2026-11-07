import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const DECISION_CHOICES = [
  { value: "Established", label: "Established", description: "The available information supports the allegation." },
  { value: "Not Established", label: "Not established", description: "The available information does not support the allegation." },
  { value: "Needs Further Investigation", label: "Needs more evidence", description: "More information is needed before a decision." },
  { value: "Resolved Through Mediation", label: "Resolved through mediation", description: "The matter was resolved through mediation." },
];
const INTERVENTION_OPTIONS = [
  { label: "Student conference", detail: "Review the incident and expectations with the student." },
  { label: "Parent conference", detail: "Discuss the incident and next steps with a parent." },
  { label: "Behavior plan", detail: "Set expectations and agree on follow-up steps." },
  { label: "Detention", detail: "Assign an appropriate school-supervised consequence." },
];
const RECOMMENDATION_OPTIONS = [
  { label: "Guidance counseling referral", detail: "For the victim and offender" },
  { label: "Restorative talk", detail: "Only if both parties agree" },
  { label: "Written apology or reflection", detail: "Reviewed by the Prefect of Discipline" },
  { label: "School-based community service", detail: "Supervised, in school" },
  { label: "Referral to School Head", detail: "For serious or repeated cases" },
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

function formatActionDisplay(value) {
  const action = String(value || "").trim();
  if (/^(yes|true)$/i.test(action)) return "Intervention recorded";
  if (/^(no|false)$/i.test(action)) return "No intervention recorded";
  return action || "—";
}

function formatReportNumber(id) {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId >= 0
    ? `CNHS-${String(numericId).padStart(4, "0")}`
    : String(id ?? "—");
}

function formatReporterRole(role) {
  return role === "Friend" ? "Friend of victim" : role || "—";
}

function formatDisciplinaryAction(interventions, recommendations, otherSelected, otherAction) {
  const sections = [];
  const selectedInterventions = [...interventions];
  if (otherSelected) selectedInterventions.push(`Other: ${otherAction.trim() || "[specify]"}`);
  if (selectedInterventions.length) {
    sections.push(`School intervention plan:\n${selectedInterventions.map((item) => `- ${item}`).join("\n")}`);
  }
  if (recommendations.length) {
    sections.push(`Recommended additions:\n${recommendations.map((item) => `- ${item}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

function currentDateInput() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function getFollowUpStatus(date) {
  return date < currentDateInput() ? "Overdue" : "Monitoring";
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
  const [reportSearchLoading, setReportSearchLoading] = useState(false);
  const [reportSearchHasMore, setReportSearchHasMore] = useState(false);
  const reportSearchRequestRef = useRef(0);
  const reportReviewRequestRef = useRef(0);
  const decisionFormRef = useRef(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportReview, setReportReview] = useState(null);
  const [reportConfirmed, setReportConfirmed] = useState(false);
  const [attachedReports, setAttachedReports] = useState([]);
  const [addingMoreReports, setAddingMoreReports] = useState(false);
  const [reviewingAttachedReport, setReviewingAttachedReport] = useState(false);
  const [approvedStudents, setApprovedStudents] = useState([]);
  const [addingAnotherStudent, setAddingAnotherStudent] = useState(true);
  const [scrollToDecision, setScrollToDecision] = useState(false);
  const [decision, setDecision] = useState("");
  const [schoolInterventions, setSchoolInterventions] = useState([]);
  const [recommendedAdditions, setRecommendedAdditions] = useState([]);
  const [otherInterventionSelected, setOtherInterventionSelected] = useState(false);
  const [otherIntervention, setOtherIntervention] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [savedDecision, setSavedDecision] = useState("");
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
  const disciplinaryAction = formatDisciplinaryAction(
    schoolInterventions,
    recommendedAdditions,
    otherInterventionSelected,
    otherIntervention
  );
  const showReportPicker = attachedReports.length === 0
    || addingMoreReports
    || reviewingAttachedReport
    || Boolean(selectedReport && !reportConfirmed);
  const selectableReportMatches = reviewingAttachedReport && selectedReport
    ? [selectedReport]
    : reportMatches.filter((report) => (
      report.id === selectedReport?.id
      || !attachedReports.some((attached) => attached.id === report.id)
    ));

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

  const loadReportMatches = useCallback(async (searchTerm, offset = 0) => {
    const requestId = ++reportSearchRequestRef.current;
    setReportSearchLoading(true);
    setFormError("");
    try {
      const reports = await searchOffenseReports(searchTerm, 20, offset);
      if (requestId !== reportSearchRequestRef.current) return;
      const pageReports = reports.slice(0, 20);
      setReportMatches((current) => offset ? [...current, ...pageReports] : pageReports);
      setReportSearchHasMore(reports.length > 20);
    } catch (searchError) {
      if (requestId === reportSearchRequestRef.current) setFormError(searchError.message);
    } finally {
      if (requestId === reportSearchRequestRef.current) setReportSearchLoading(false);
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

  useEffect(() => {
    if (!scrollToDecision) return undefined;
    const frameId = requestAnimationFrame(() => {
      decisionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToDecision(false);
    });
    return () => cancelAnimationFrame(frameId);
  }, [scrollToDecision]);

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
    reportSearchRequestRef.current += 1;
    reportReviewRequestRef.current += 1;
    setReportSearchLoading(false);
    setFormOpen(false);
    setStudentForm({ name: "", lrn: "", grade: "", section: "" });
    setSectionChoice("");
    setReportSearch("");
    setReportMatches([]);
    setReportSearchHasMore(false);
    setSelectedReport(null);
    setReportReview(null);
    setReportConfirmed(false);
    setAttachedReports([]);
    setAddingMoreReports(false);
    setReviewingAttachedReport(false);
    setApprovedStudents([]);
    setAddingAnotherStudent(true);
    setDecision("");
    setSchoolInterventions([]);
    setRecommendedAdditions([]);
    setOtherInterventionSelected(false);
    setOtherIntervention("");
    setFollowUpDate("");
    setSavedDecision("");
    setScrollToDecision(false);
    setFormError("");
  };

  const handleReportSearch = async (event) => {
    event.preventDefault();
    await loadReportMatches(reportSearch);
  };

  const chooseReport = async (report) => {
    if (selectedReport?.id === report.id) {
      reportReviewRequestRef.current += 1;
      setSelectedReport(null);
      setReportReview(null);
      setReportConfirmed(false);
      if (!addingMoreReports) {
        setAttachedReports([]);
        setApprovedStudents([]);
        setAddingAnotherStudent(true);
      }
      setReportEvidence(null);
      if (!addingMoreReports) {
        setDecision("");
        setSchoolInterventions([]);
        setRecommendedAdditions([]);
        setOtherInterventionSelected(false);
        setOtherIntervention("");
        setFollowUpDate("");
        setSavedDecision("");
      }
      setFormError("");
      return;
    }
    const requestId = ++reportReviewRequestRef.current;
    setSelectedReport(report);
    setReportReview({ ...report, loading: true });
    setReportConfirmed(false);
    if (!addingMoreReports) {
      setAttachedReports([]);
      setApprovedStudents([]);
      setAddingAnotherStudent(true);
    }
    setReportEvidence(null);
    setSavedDecision("");
    setDecision("");
    setSchoolInterventions([]);
    setRecommendedAdditions([]);
    setOtherInterventionSelected(false);
    setOtherIntervention("");
    setFollowUpDate("");
    setFormError("");
    try {
      const details = await getReportDetails(report.id);
      if (requestId !== reportReviewRequestRef.current) return;
      setSelectedReport(details);
      setReportReview(details);
    } catch (reviewError) {
      if (requestId !== reportReviewRequestRef.current) return;
      setReportReview({ ...report, error: reviewError.message });
    }
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

  const startAnotherStudent = () => {
    setStudentForm({ name: "", lrn: "", grade: "", section: "" });
    setSectionChoice("");
    setDecision("");
    setSchoolInterventions([]);
    setRecommendedAdditions([]);
    setOtherInterventionSelected(false);
    setOtherIntervention("");
    setFollowUpDate("");
    setSavedDecision("");
    setFormError("");
    setAddingAnotherStudent(true);
  };

  const confirmSelectedReport = () => {
    if (!selectedReport) return;
    if (addingMoreReports) {
      setAttachedReports((current) => current.some((report) => report.id === selectedReport.id)
        ? current
        : [...current, selectedReport]);
      setSelectedReport(null);
      setReportReview(null);
      setReportConfirmed(false);
      setAddingMoreReports(false);
      setReportEvidence(null);
      setScrollToDecision(true);
      return;
    }
    setAttachedReports([selectedReport]);
    setReportConfirmed(true);
    setScrollToDecision(true);
    setFormError("");
  };

  const startAddingReport = () => {
    reportReviewRequestRef.current += 1;
    setReviewingAttachedReport(false);
    setSelectedReport(null);
    setReportReview(null);
    setReportConfirmed(false);
    setAddingMoreReports(true);
    setReportEvidence(null);
    setFormError("");
    loadReportMatches(reportSearch);
  };

  const reviewAttachedReportAgain = async (report) => {
    const requestId = ++reportReviewRequestRef.current;
    setSelectedReport(report);
    setReportReview({ ...report, loading: true });
    setReportConfirmed(false);
    setAddingMoreReports(false);
    setReviewingAttachedReport(true);
    setReportEvidence(null);
    setFormError("");
    try {
      const details = await getReportDetails(report.id);
      if (requestId !== reportReviewRequestRef.current) return;
      setSelectedReport(details);
      setReportReview(details);
    } catch (reviewError) {
      if (requestId !== reportReviewRequestRef.current) return;
      setReportReview({ ...report, error: reviewError.message });
    }
  };

  const finishReviewingAttachedReport = () => {
    reportReviewRequestRef.current += 1;
    setSelectedReport(null);
    setReportReview(null);
    setReportConfirmed(false);
    setReviewingAttachedReport(false);
    setReportEvidence(null);
    setFormError("");
  };

  const removeAttachedReport = (reportId) => {
    if (attachedReports[0]?.id === reportId) return;
    setAttachedReports((current) => current.filter((report) => report.id !== reportId));
  };

  const changeSelectedReport = () => {
    reportReviewRequestRef.current += 1;
    setReviewingAttachedReport(false);
    setSelectedReport(null);
    setReportReview(null);
    setReportConfirmed(false);
    setAttachedReports([]);
    setAddingMoreReports(false);
    setReportEvidence(null);
    setApprovedStudents([]);
    setAddingAnotherStudent(true);
    setStudentForm({ name: "", lrn: "", grade: "", section: "" });
    setSectionChoice("");
    setDecision("");
    setSchoolInterventions([]);
    setRecommendedAdditions([]);
    setOtherInterventionSelected(false);
    setOtherIntervention("");
    setFollowUpDate("");
    setSavedDecision("");
    setFormError("");
    loadReportMatches(reportSearch);
  };

  const submitDecision = async (event) => {
    event.preventDefault();
    const primaryReport = attachedReports[0];
    if (!studentForm.name.trim() || !studentForm.grade || !primaryReport || !decision) {
      setFormError("Complete the student information, choose a report, and select a decision.");
      return;
    }
    if (decision === "Established" && !followUpDate) {
      setFormError("Choose a follow-up date for an established decision.");
      return;
    }
    if (decision === "Established" && otherInterventionSelected && !otherIntervention.trim()) {
      setFormError("Specify the other school intervention, or uncheck that option.");
      return;
    }
    setFormLoading(true);
    setFormError("");
    try {
      await saveOffenseDecision(primaryReport.id, {
        ...studentForm,
        name: studentForm.name.trim(),
        lrn: studentForm.lrn.trim(),
        section: studentForm.section.trim(),
      }, decision, "", {
        attachedReportIds: attachedReports.map((report) => report.id),
        conferenceFindings: primaryReport.conferenceFindings || "",
        adminRemarks: "",
        disciplinaryAction: decision === "Established" ? disciplinaryAction.trim() : "",
        followUpDate: decision === "Established" ? followUpDate : null,
        reviewedAt: currentDateInput(),
      });
      setSavedDecision(decision);
      if (decision === "Resolved Through Mediation") {
        const resolvedReports = attachedReports.map((report) => ({ ...report, status: "Resolved" }));
        setAttachedReports(resolvedReports);
        setSelectedReport((current) => current ? { ...current, status: "Resolved" } : current);
        setReportReview((current) => current ? { ...current, status: "Resolved" } : current);
        setNotice(`Report${resolvedReports.length === 1 ? "" : "s"} ${resolvedReports.map((report) => `#${report.id}`).join(", ")} resolved through mediation. No offense record was created.`);
      } else {
        setNotice(`Decision saved for Report #${primaryReport.id}.`);
      }
    } catch (saveError) {
      setFormError(saveError.message);
    } finally {
      setFormLoading(false);
    }
  };

  const approveOffense = async () => {
    const primaryReport = attachedReports[0];
    if (!studentForm.name.trim() || !primaryReport || savedDecision !== "Established") return;
    if (otherInterventionSelected && !otherIntervention.trim()) {
      setFormError("Specify the other school intervention, or uncheck that option.");
      return;
    }
    if (!disciplinaryAction.trim()) {
      setFormError("Select at least one school intervention or recommended addition before approval.");
      return;
    }
    const pendingStatusNotice = attachedReports.some((report) => report.status === "Pending")
      ? " The pending report will also move to Under Investigation."
      : "";
    const reportNumbers = attachedReports.map((report) => `#${report.id}`).join(", ");
    if (!window.confirm(`Approve one established offense record for ${studentForm.name.trim()} linked to reports ${reportNumbers}?${pendingStatusNotice}`)) return;
    setFormLoading(true);
    setFormError("");
    try {
      const reportStatuses = await Promise.all(attachedReports.map((report) => prepareReportForOffenseApproval(report.id)));
      const created = await createStudentOffenseRecord(
        primaryReport.id,
        { ...studentForm, name: studentForm.name.trim(), lrn: studentForm.lrn.trim(), section: studentForm.section.trim() },
        attachedReports.map((report) => report.id)
      );
      setApprovedStudents((current) => [...current, {
        name: studentForm.name.trim(),
        offenseNumber: created.offenseNumber,
        reportIds: attachedReports.map((report) => report.id),
      }]);
      setAddingAnotherStudent(false);
      setStudentForm({ name: "", lrn: "", grade: "", section: "" });
      setSectionChoice("");
      setDecision("");
      setSchoolInterventions([]);
      setRecommendedAdditions([]);
      setOtherInterventionSelected(false);
      setOtherIntervention("");
      setFollowUpDate("");
      setSavedDecision("");
      const refreshedReports = attachedReports.map((report, index) => ({
        ...report,
        status: reportStatuses[index].status,
      }));
      setAttachedReports(refreshedReports);
      const refreshedPrimary = refreshedReports[0];
      if (selectedReport?.id === refreshedPrimary.id) {
        setSelectedReport(refreshedPrimary);
        setReportReview(refreshedPrimary);
      }
      setNotice(`Approved as Offense #${created.offenseNumber} and linked to ${attachedReports.length} report${attachedReports.length === 1 ? "" : "s"}.${reportStatuses.some((status) => status.changed) ? " Pending reports moved to Under Investigation." : ""}`);
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
        <button type="button" className="student-offense-primary" onClick={() => { setFormError(""); setFormOpen(true); loadReportMatches(""); }}>
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
              <thead><tr><th>Student</th><th>Offense</th><th>Incident</th><th>Action</th><th>Follow-up</th><th>Approved by</th><th>Date recorded</th><th>History</th></tr></thead>
              <tbody>
                {result.records.map((record) => (
                  <tr key={record.id}>
                    <td><strong>{record.studentName}</strong><small>{[record.lrn, record.grade, record.section].filter(Boolean).join(" · ") || "Student details unavailable"}</small></td>
                    <td><span className="student-offense-number">#{record.offenseNumber}</span><small>{record.studentOffenseCount > 1 ? `${record.studentOffenseCount} total` : "First offense"}</small></td>
                    <td>
                      {(record.incidentReportIds || [record.incidentReportId]).map((reportId) => (
                        <button key={reportId} type="button" className="student-offense-link student-offense-linked-report" onClick={() => openReport(reportId)}>Report #{reportId}</button>
                      ))}
                      <small>{record.incidentType} · {formatDate(record.incidentDate)}</small>
                    </td>
                    <td className="student-offense-action-cell">{formatActionDisplay(record.disciplinaryAction)}</td>
                    <td>
                      {record.followUpDate ? (
                        <>
                          <span className={`student-offense-follow-up-status ${(record.followUpStatus || "Monitoring").toLowerCase()}`}>
                            {record.followUpStatus || "Monitoring"}
                          </span>
                          <small>{formatDate(record.followUpDate)}</small>
                        </>
                      ) : <span className="student-offense-follow-up-status not-scheduled">Not scheduled</span>}
                    </td>
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
                {approvedStudents.length > 0 && (
                  <div className="student-offense-added-students">
                    <strong>Offense records already created in this form</strong>
                    <ul>{approvedStudents.map((student, index) => (
                      <li key={`${student.offenseNumber}-${index}`}>{student.name}<span>Offense #{student.offenseNumber} · Reports {student.reportIds.map((id) => `#${id}`).join(", ")}</span></li>
                    ))}</ul>
                  </div>
                )}
                {addingAnotherStudent ? (
                  <>
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
                    <p className="student-offense-help">Each student gets an individual review and offense number. Sections update from the Grade & Sections module. No student account is required.</p>
                  </>
                ) : (
                  <div className="student-offense-report-confirmed" role="status">
                    <strong>Student offense approved and linked to {attachedReports.length} report{attachedReports.length === 1 ? "" : "s"}.</strong>
                    <button type="button" className="student-offense-primary" onClick={startAnotherStudent}>Add another student to these reports</button>
                  </div>
                )}
              </section>
              <section className="student-offense-form-step">
                <h4>2. Select submitted incident report</h4>
                {attachedReports.length > 0 && (
                  <div className="student-offense-attached-reports">
                    <strong>Reports attached to this offense record</strong>
                    <p className="student-offense-help">One review decision and offense number will apply to all attached reports.</p>
                    <ul>{attachedReports.map((report, index) => (
                      <li key={report.id}>
                        <span><strong>Report #{report.id} · {report.type}</strong><small>{formatDate(report.date)} · {report.status}{index === 0 ? " · Primary report" : ""}</small></span>
                        <div className="student-offense-attached-report-actions">
                          <button type="button" className="student-offense-secondary" onClick={() => reviewAttachedReportAgain(report)}>Review again</button>
                          {index > 0 && <button type="button" className="student-offense-secondary" onClick={() => removeAttachedReport(report.id)}>Remove</button>}
                        </div>
                      </li>
                    ))}</ul>
                    {!addingMoreReports && (!selectedReport || reportConfirmed) && addingAnotherStudent && (
                      <>
                        <button type="button" className="student-offense-secondary" onClick={startAddingReport}>Add another report</button>
                        {attachedReports.length === 1 && <button type="button" className="student-offense-secondary" onClick={changeSelectedReport}>Choose a different report</button>}
                      </>
                    )}
                    {reviewingAttachedReport && <button type="button" className="student-offense-secondary" onClick={finishReviewingAttachedReport}>Done reviewing</button>}
                  </div>
                )}
                {showReportPicker && !reviewingAttachedReport && (
                  <>
                    <form className="student-offense-search" onSubmit={handleReportSearch}>
                      <Search size={16} /><input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Filter by report ID, reporter, incident type, or submission date" />
                      <button type="submit" disabled={reportSearchLoading}>{reportSearchLoading ? "Searching…" : "Search"}</button>
                    </form>
                    <p className="student-offense-help">{addingMoreReports ? "Choose another unresolved report to attach to this offense record." : "Unresolved reports are shown automatically. Use the search to filter them."} Anonymous reporter information remains protected.</p>
                  </>
                )}
                {showReportPicker && !reviewingAttachedReport && reportSearchLoading && reportMatches.length === 0 && <p className="student-offense-help">Loading unresolved reports…</p>}
                {showReportPicker && !reviewingAttachedReport && !reportSearchLoading && reportMatches.length === 0 && !formError && <p className="student-offense-help">No unresolved reports found.</p>}
                {showReportPicker && selectableReportMatches.length > 0 && (
                  <ul className="student-offense-select-list">
                    {selectableReportMatches.map((report) => (
                      <li key={report.id} className={selectedReport?.id === report.id ? "selected" : ""}>
                        <span><strong>Report #{report.id} · {report.type}</strong><small>{formatDate(report.date)} · Submitted {formatDate(report.submittedAt)} · {report.reporterName || "Anonymous"} · {report.status}</small></span>
                        <button type="button" onClick={() => chooseReport(report)}>{selectedReport?.id === report.id ? "Unselect" : "Review"}</button>
                        {selectedReport?.id === report.id && reportReview && (
                          reportReview.loading ? (
                            <div className="student-offense-report-review"><p>Loading full incident details…</p></div>
                          ) : reportReview.error ? (
                            <div className="student-offense-report-review"><p className="student-offense-error">{reportReview.error}</p></div>
                          ) : (
                            <div className="student-offense-report-review">
                              <header className="student-offense-report-banner">
                                <div className="student-offense-report-number">
                                  <small>REPORT ID</small>
                                  <strong>{formatReportNumber(reportReview.id)}</strong>
                                </div>
                                <div className="student-offense-report-tags">
                                  <span><small>TYPE</small><strong>{reportReview.type || "—"}</strong></span>
                                  <span><small>STATUS</small><strong className={`student-offense-report-status ${(reportReview.status || "").toLowerCase().replace(/\s/g, "-")}`}>{reportReview.status || "—"}</strong></span>
                                </div>
                              </header>

                              <section className="student-offense-report-section">
                                <h5>Case summary</h5>
                                <div className="student-offense-report-grid">
                                  <div><small>Incident date</small><strong>{formatDate(reportReview.date)}</strong></div>
                                  <div><small>Incident time</small><strong>{reportReview.time || "—"}</strong></div>
                                  <div><small>Location</small><strong>{reportReview.location || "—"}</strong></div>
                                  <div><small>Date filed</small><strong>{formatDate(reportReview.submittedAt)}</strong></div>
                                  <div><small>Reporter</small><strong>{reportReview.isAnonymous ? "Anonymous" : reportReview.submittedBy || "—"}</strong></div>
                                  <div><small>Reporter role</small><strong>{formatReporterRole(reportReview.reporterType)}</strong></div>
                                </div>
                              </section>

                              <section className="student-offense-report-section">
                                <h5>People involved</h5>
                                <div className="student-offense-report-grid student-offense-report-people">
                                  <div><small>Victims</small><strong>{formatPeople(reportReview.victims) || "None listed"}</strong></div>
                                  <div><small>Reported individuals</small><strong>{formatPeople(reportReview.offenders) || "None listed"}</strong></div>
                                  <div><small>Witnesses</small><strong>{formatPeople(reportReview.witnesses) || "None listed"}</strong></div>
                                </div>
                              </section>

                              <section className="student-offense-report-narrative">
                                <h5>Incident description</h5>
                                <div><small>What happened?</small><p>{reportReview.description || "No incident description provided."}</p></div>
                                <div><small>Events leading up to the incident</small><p>{reportReview.descriptionLeadUp || "No prior events or context provided."}</p></div>
                                <div><small>Impact on the victim</small><p>{reportReview.descriptionImpact || "No impact details provided."}</p></div>
                                <div><small>Actions taken</small><p>{reportReview.descriptionActions || "No actions taken were provided."}</p></div>
                              </section>

                              <section className="student-offense-report-section student-offense-report-followup">
                                <h5>Evidence and follow-up</h5>
                                <div className="student-offense-report-grid">
                                  <div><small>Evidence attached</small><strong>{reportReview.evidenceCount || 0} file(s)</strong></div>
                                  <div><small>Conference</small><strong>{reportReview.scheduledConference?.status || (reportReview.scheduledConference?.completed ? "Completed" : reportReview.scheduledConference ? "Scheduled" : "Not scheduled")}</strong></div>
                                  <div><small>Conference date</small><strong>{reportReview.scheduledConference?.date ? formatDate(reportReview.scheduledConference.date) : "—"}</strong></div>
                                </div>
                                {reportReview.conferenceFindings && <p className="student-offense-findings"><strong>Conference findings:</strong> {reportReview.conferenceFindings}</p>}
                                <button type="button" className="student-offense-secondary" onClick={loadEvidence} disabled={evidenceLoading || !reportReview.evidenceCount}>
                                  {evidenceLoading ? "Loading evidence…" : reportEvidence ? "Evidence loaded" : `Review attached evidence (${reportReview.evidenceCount || 0})`}
                                </button>
                                {reportEvidence?.length > 0 && <ul className="student-offense-evidence-list">{reportEvidence.map((item, index) => <li key={`${item.name}-${index}`}><a href={item.data} target="_blank" rel="noreferrer">{item.name || `Evidence ${index + 1}`}</a></li>)}</ul>}
                              </section>
                              {reviewingAttachedReport ? null : reportConfirmed ? (
                                <div className="student-offense-report-confirmed" role="status">
                                  <strong>Report {formatReportNumber(reportReview.id)} chosen for offense review.</strong>
                                </div>
                              ) : (
                                <button type="button" className="student-offense-primary student-offense-choose-report" onClick={confirmSelectedReport}>
                                  Choose this report
                                </button>
                              )}
                            </div>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {showReportPicker && !reviewingAttachedReport && reportSearchHasMore && <button type="button" className="student-offense-secondary" onClick={() => loadReportMatches(reportSearch, reportMatches.length)} disabled={reportSearchLoading}>{reportSearchLoading ? "Loading…" : "Load more unresolved reports"}</button>}
              </section>
                {attachedReports.length > 0 && !addingMoreReports && (!selectedReport || reportConfirmed) && addingAnotherStudent && (
                <form ref={decisionFormRef} className="student-offense-form-step student-offense-decision-form" onSubmit={submitDecision}>
                  <h4>3. Final decision and intervention</h4>
                  <section className="student-offense-final-decision" aria-labelledby="student-offense-final-decision-title">
                    <div className="student-offense-final-decision-heading">
                      <span id="student-offense-final-decision-title">FINAL DECISION</span>
                      <p>Review the available information and select one outcome.</p>
                    </div>
                    <fieldset className="student-offense-decision-options">
                      <legend className="student-offense-visually-hidden">Final decision</legend>
                      {DECISION_CHOICES.map((option) => (
                        <label key={option.value} className={`student-offense-decision-choice${decision === option.value ? " selected" : ""}`}>
                          <input type="radio" name="student-offense-final-decision" value={option.value} checked={decision === option.value} onChange={() => {
                            setDecision(option.value);
                            setSavedDecision("");
                            setFormError("");
                            if (option.value !== "Established") {
                              setSchoolInterventions([]);
                              setRecommendedAdditions([]);
                              setOtherInterventionSelected(false);
                              setOtherIntervention("");
                              setFollowUpDate("");
                            }
                          }} required />
                          <span><strong>{option.label}</strong><small>{option.description}</small></span>
                        </label>
                      ))}
                    </fieldset>
                  </section>

                  {decision === "Established" && <section className="student-offense-intervention-plan" aria-labelledby="student-offense-intervention-title">
                    <div className="student-offense-final-decision-heading">
                      <span id="student-offense-intervention-title">SCHOOL INTERVENTION PLAN</span>
                      <p>Select the actions agreed upon or recommended for this case.</p>
                    </div>
                    <label className="student-offense-field student-offense-follow-up-field">
                      Follow-up date
                      <input type="date" value={followUpDate} onChange={(event) => { setFollowUpDate(event.target.value); setSavedDecision(""); setFormError(""); }} required />
                      <small>Choose when the intervention should be reviewed.</small>
                    </label>
                    <fieldset className="student-offense-action-options">
                      <legend className="student-offense-visually-hidden">School intervention plan</legend>
                      {INTERVENTION_OPTIONS.map((option) => (
                        <label key={option.label} className={`student-offense-action-choice${schoolInterventions.includes(option.label) ? " selected" : ""}`}>
                          <input type="checkbox" checked={schoolInterventions.includes(option.label)} onChange={() => {
                            setSchoolInterventions((current) => current.includes(option.label)
                              ? current.filter((item) => item !== option.label)
                              : [...current, option.label]);
                            setSavedDecision("");
                          }} />
                          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                        </label>
                      ))}
                      <label className={`student-offense-action-choice student-offense-other-choice${otherInterventionSelected ? " selected" : ""}`}>
                        <input type="checkbox" checked={otherInterventionSelected} onChange={(event) => {
                          setOtherInterventionSelected(event.target.checked);
                          if (!event.target.checked) setOtherIntervention("");
                          setSavedDecision("");
                        }} />
                        <span><strong>Other (specify)</strong><small>Add another suitable intervention.</small></span>
                        {otherInterventionSelected && <input className="student-offense-other-input" value={otherIntervention} onChange={(event) => { setOtherIntervention(event.target.value); setSavedDecision(""); setFormError(""); }} placeholder="Specify school intervention" aria-label="Specify other school intervention" required />}
                      </label>
                    </fieldset>

                    <div className="student-offense-final-decision-heading student-offense-recommendations-heading">
                      <span>RECOMMENDED ADDITIONS</span>
                      <p>Optional supports may be selected in addition to the school intervention plan.</p>
                    </div>
                    <fieldset className="student-offense-action-options student-offense-recommendation-options">
                      <legend className="student-offense-visually-hidden">Recommended additions</legend>
                      {RECOMMENDATION_OPTIONS.map((option) => (
                        <label key={option.label} className="student-offense-action-choice">
                          <input type="checkbox" checked={recommendedAdditions.includes(option.label)} onChange={() => {
                            setRecommendedAdditions((current) => current.includes(option.label)
                              ? current.filter((item) => item !== option.label)
                              : [...current, option.label]);
                            setSavedDecision("");
                          }} />
                          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                        </label>
                      ))}
                    </fieldset>
                    <p className="student-offense-help">If the report is Pending, approval moves it to Under Investigation automatically.</p>
                  </section>}
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
                            <p><strong>{record.incidentType}</strong> · {formatDate(record.incidentDate)} · { (record.incidentReportIds || [record.incidentReportId]).map((reportId) => <button key={reportId} type="button" className="student-offense-link student-offense-linked-report" onClick={() => openReport(reportId)}>Report #{reportId}</button>)}</p>
                            <p><strong>Student ID/LRN:</strong> {history.student?.lrn || "—"} · <strong>Grade/Section:</strong> {[history.student?.grade, history.student?.section].filter(Boolean).join(" / ") || "—"}</p>
                            {record.conferenceFindings && <p><strong>Conference findings:</strong> {record.conferenceFindings}</p>}
                            {record.adminRemarks && <p><strong>Admin/Prefect remarks:</strong> {record.adminRemarks}</p>}
                            <p><strong>Decision findings:</strong> {history.decisions.find((decisionItem) => decisionItem.reportId === record.incidentReportId)?.findings || "—"}</p>
                            <p className="student-offense-action-cell"><strong>Disciplinary action:</strong> {record.disciplinaryAction}</p>
                            <p><strong>Approved by:</strong> {record.approvedBy || "Administrator"}</p>
                            <p><strong>Date reviewed:</strong> {formatDate(record.reviewedAt)}</p>
                            <p><strong>Follow-up:</strong> {record.followUpDate ? `${formatDate(record.followUpDate)} · ${getFollowUpStatus(record.followUpDate)}` : "Not scheduled"}</p>
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
