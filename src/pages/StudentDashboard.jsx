import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/StudentDashboard.css";

import logo from "../assets/logo.png";
import bg   from "../assets/cnhs.jpg";

import {
  LayoutDashboard, FileText, Shield, BookOpen, User, Image,
  ExternalLink, Upload, HelpCircle, Lock, Bell,
  CheckCircle, Clock, AlertTriangle, ArrowUpRight, X, Paperclip,
  Eye, Play, AlertCircle, Calendar, Send,
  Menu, ChevronDown, LogOut, MapPin,
} from "lucide-react";

import {
  getReports, submitReport, addReportEvidence,
  getAwarenessContent,
  getStudentNotifications, markStudentNotifRead, markAllStudentNotifRead,
  requestConferenceChange,
  LOCATION_META, getCustomLocations,   getReportDetails, getReportEvidence, getCaseOffenseRecord, getAwarenessImage, getUnreadNotificationCount,
  GRADE_OPTIONS, getGradeSections,
} from "../data/store";import { translateStudentUI } from "../lib/studentLocale";
import { signOut } from "../lib/auth";
import { optimizeImageFile } from "../lib/imageOptimization";
import { getYouTubeThumbnail } from "../lib/videoUtils";

const DASHBOARD_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const REPORT_PAGE_SIZE = 30;
const MAX_EVIDENCE_FILE_BYTES = 1_000_000;
const MAX_EVIDENCE_TOTAL_BYTES = 1_800_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusIcon(status) {
  if (status === "Resolved")           return <CheckCircle size={13} />;
  if (status === "More Information Requested") return <Upload size={13} />;
  if (status === "Under Review" || status === "Under Investigation") return <Clock size={13} />;
  return <AlertTriangle size={13} />;
}
function formatConferenceTime(timeStr) {
  if (!timeStr) return "Time TBD";
  const raw = String(timeStr).trim();
  if (/AM|PM/i.test(raw)) return raw;
  const [h, m] = raw.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return raw;
  const period = h >= 12 ? "PM" : "AM";
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}
function formatConferenceDate(dateStr, language = "en") {
  if (!dateStr || dateStr === "Date TBD") return dateStr || "Date TBD";
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateStr
    : new Intl.DateTimeFormat(language === "fil" ? "fil-PH" : "en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(date);
}
function getConferenceStatus(conference) {
  const status = conference.status || (conference.completed ? "Completed" : "Scheduled");
  if (!["Scheduled", "Rescheduled"].includes(status)) return status;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(conference.date || "")) return status;
  const [year, month, day] = conference.date.split("-").map(Number);
  const scheduledDate = new Date(year, month - 1, day);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const offset = scheduledDate.getTime() - currentDate.getTime();
  if (offset < 0) return "Overdue";
  if (offset === 0) return "Today";
  return "Scheduled";
}
const CONFERENCE_TYPE_COLORS = {
  Physical: "#ef4444",
  Verbal: "#f97316",
  Cyber: "#8b5cf6",
  Social: "#3b82f6",
  Property: "#f59e0b",
};
function readBlobAsDataUrl(blob) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = (e) => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(blob);
  });
}
async function readFile(file) {
  const optimizedFile = file.type.startsWith("image/")
    ? await optimizeImageFile(file, { maxDimension: 1280, maxSizeBytes: 500_000, forceWebp: true })
    : file;
  if (optimizedFile.size > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error("Each evidence file must be no larger than 1 MB.");
  }

  return {
    name: optimizedFile.name,
    type: optimizedFile.type,
    data: await readBlobAsDataUrl(optimizedFile),
  };
}

export default function StudentDashboard() {
  const navigate = useNavigate();

  const studentName = localStorage.getItem("studentName") || "";
  const languagePreferenceKey = `studentLanguage:${localStorage.getItem("studentId") || "default"}`;
  const profileGrade = localStorage.getItem("studentGrade") || "";
  const profileSection = localStorage.getItem("studentSection") || "";
  const profileAge = localStorage.getItem("studentAge") || "";
  const profileGender = localStorage.getItem("studentSex") || "";
  const profileLrn = localStorage.getItem("studentLRN") || "";
  const [activeTab,   setActiveTab]   = useState("dashboard");
  const [language, setLanguage] = useState(() => localStorage.getItem(languagePreferenceKey) || "en");
  const [hubSearchQuery, setHubSearchQuery] = useState("");
  const [hubFilter,   setHubFilter]   = useState("all");
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen,   setNotifOpen]   = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Toast notification
  const [toast, setToast] = useState(null); // { msg, type }

  // Forgot password modal
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent,  setForgotSent]  = useState(false);

  // Hub content viewer modal
  const [hubViewItem, setHubViewItem] = useState(null);
  const [caseViewItem, setCaseViewItem] = useState(null);
  const [followUpEvidenceFiles, setFollowUpEvidenceFiles] = useState([]);
  const [followUpResponse, setFollowUpResponse] = useState("");
  const [followUpError, setFollowUpError] = useState("");
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [conferenceViewItem, setConferenceViewItem] = useState(null);
  const [conferenceRequestType, setConferenceRequestType] = useState(null);
  const [conferenceRequestReason, setConferenceRequestReason] = useState("");
  const [conferenceRequestSaving, setConferenceRequestSaving] = useState(false);

  // Live data
  const [reports,          setReports]          = useState([]);
  const [hasMoreReports, setHasMoreReports] = useState(false);
  const [loadingMoreReports, setLoadingMoreReports] = useState(false);
  const [awarenessContent, setAwarenessContent] = useState([]);
  const [notifications,    setNotifications]    = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingMoreNotifications, setLoadingMoreNotifications] = useState(false);
  const [customLocations,  setCustomLocations]  = useState([]);

  // Report form
  const [reportForm, setReportForm] = useState({
    type: "", date: "", time: "", location: "", description: "",
    descriptionLeadUp: "", descriptionImpact: "",
    involved: "",
  });
  const [locationChoice, setLocationChoice] = useState("");
  const [reporterType, setReporterType] = useState("");
  const emptyPerson = () => ({ name: "", lrn: "", age: "", grade: "", section: "", adviser: "", parentName: "", parentContact: "" });
  const [victims,   setVictims]   = useState([emptyPerson()]);
  const [offenders, setOffenders] = useState([emptyPerson()]);
  const [witnesses, setWitnesses] = useState([emptyPerson()]);
  const [hasWitnesses, setHasWitnesses] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [evidenceFiles,  setEvidenceFiles]  = useState([]); // { name, type, data }[]
  const [submitSuccess,  setSubmitSuccess]  = useState(false);
  const [formError,      setFormError]      = useState("");

  // Load report-form options only when the student opens that form.
  const [gradeSectionsList, setGradeSectionsList] = useState([]);
  useEffect(() => {
    if (activeTab !== "report") return undefined;
    let cancelled = false;
    getGradeSections()
      .then((sections) => { if (!cancelled) setGradeSectionsList(sections); })
      .catch(() => { if (!cancelled) setGradeSectionsList([]); });
    return () => { cancelled = true; };
  }, [activeTab]);

  useEffect(() => {
    if (gradeSectionsList.length === 0) return;
    setVictims((current) => current.map((victim) => {
      if (victim.adviser || !victim.grade || !victim.section) return victim;
      const assignedSection = gradeSectionsList.find((item) =>
        item.grade === victim.grade && item.section === victim.section
      );
      return assignedSection?.adviser ? { ...victim, adviser: assignedSection.adviser } : victim;
    }));
  }, [gradeSectionsList]);

  const profileRef = useRef();
  const notifRef   = useRef();
  const welcomeNotificationChecked = useRef(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const openCaseDetails = async (report) => {
    setFollowUpEvidenceFiles([]);
    setFollowUpResponse("");
    setFollowUpError("");
    setCaseViewItem({ ...report, evidence: [], evidenceLoaded: false, evidenceLoading: false });
    try {
      const [details, offenseResult] = await Promise.all([
        getReportDetails(report.id),
        getCaseOffenseRecord(report.id),
      ]);
      setCaseViewItem((current) => current?.id === report.id
        ? {
          ...details,
          evidence: [],
          evidenceLoaded: false,
          offenseRecord: offenseResult.offenseRecord || null,
          hasCaseFollowUp: !!offenseResult.hasCaseFollowUp,
        }
        : current);
    } catch (error) {
      setCaseViewItem((current) => current?.id === report.id
        ? { ...current, evidenceLoading: false, evidenceError: error.message }
        : current);
    }
  };

  const loadCaseEvidence = async () => {
    if (!caseViewItem || caseViewItem.evidenceLoading || caseViewItem.evidenceLoaded) return;
    const reportId = caseViewItem.id;
    setCaseViewItem((current) => current?.id === reportId ? { ...current, evidenceLoading: true, evidenceError: "" } : current);
    try {
      const evidence = await getReportEvidence(reportId);
      setCaseViewItem((current) => current?.id === reportId
        ? { ...current, evidence, evidenceLoaded: true, evidenceLoading: false }
        : current);
    } catch (error) {
      setCaseViewItem((current) => current?.id === reportId
        ? { ...current, evidenceLoading: false, evidenceError: error.message }
        : current);
    }
  };

  const openHubItem = async (item) => {
    setHubViewItem({ ...item, imageLoading: true });
    try {
      const fileData = item.fullImagePath ? item.fullImage : await getAwarenessImage(item.id);
      setHubViewItem((current) => current?.id === item.id
        ? { ...current, fileData, imageLoading: false }
        : current);
    } catch (error) {
      setHubViewItem((current) => current?.id === item.id
        ? { ...current, imageLoading: false, imageError: error.message }
        : current);
    }
  };

  const loadMoreReports = async () => {
    if (loadingMoreReports || !hasMoreReports) return;
    setLoadingMoreReports(true);
    try {
      const next = await getReports({ summaryOnly: true, limit: REPORT_PAGE_SIZE, offset: reports.length });
      setReports((current) => [...current, ...next]);
      setHasMoreReports(next.length === REPORT_PAGE_SIZE);
    } catch (error) {
      showToast(`Could not load more cases: ${error.message}`, "error");
    } finally {
      setLoadingMoreReports(false);
    }
  };

  const loadMoreNotifications = async () => {
    if (loadingMoreNotifications || !hasMoreNotifications) return;
    setLoadingMoreNotifications(true);
    try {
      const next = await getStudentNotifications({ offset: notifications.length });
      setNotifications((current) => [...current, ...next]);
      setHasMoreNotifications(next.length === 30);
    } catch (error) {
      showToast(`Could not load more notifications: ${error.message}`, "error");
    } finally {
      setLoadingMoreNotifications(false);
    }
  };

  // ── Refresh visible dashboard data without overlapping requests ────────────
  useEffect(() => {
    const setIfChanged = (setter) => (next) =>
      setter((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const setReportsIfChanged          = setIfChanged(setReports);
    const setAwarenessContentIfChanged = setIfChanged(setAwarenessContent);
    const setNotificationsIfChanged    = setIfChanged(setNotifications);
    const setCustomLocationsIfChanged  = setIfChanged(setCustomLocations);
    let cancelled = false;
    let refreshing = false;
    let timeoutId;

    async function refresh() {
      if (cancelled || document.hidden || refreshing) return;
      refreshing = true;
      try {
        try {
          const [reportsData, awarenessData, notifData, unreadNotifications] = await Promise.all([
            activeTab === "profile"
              ? Promise.resolve(null)
              : getReports({
                  includeEvidence: false,
                  ...(activeTab === "cases" ? { summaryOnly: true, limit: REPORT_PAGE_SIZE } : {}),
                }),
            activeTab === "dashboard" ? getAwarenessContent() : Promise.resolve(null),
            getStudentNotifications(),
            getUnreadNotificationCount(),
          ]);
          if (cancelled) return;
          if (reportsData) {
            setReportsIfChanged(reportsData);
            if (activeTab === "cases") setHasMoreReports(reportsData.length === REPORT_PAGE_SIZE);
          }
          if (awarenessData) setAwarenessContentIfChanged(awarenessData);
          setHasMoreNotifications(notifData.length === 30);

          let nextNotifications = notifData;
          let currentUnreadCount = unreadNotifications;
          if (!welcomeNotificationChecked.current) {
            welcomeNotificationChecked.current = true;
            const welcomeNotif = notifData.find((n) => n.type === "success" && !n.read);
            if (welcomeNotif) {
              showToast(welcomeNotif.title);
              try {
                await markStudentNotifRead(welcomeNotif.id);
                currentUnreadCount = Math.max(0, currentUnreadCount - 1);
                nextNotifications = notifData.map((notification) =>
                  notification.id === welcomeNotif.id ? { ...notification, read: true } : notification
                );
              } catch (err) {
                console.error("Welcome notification could not be marked as read:", err);
              }
            }
          }
          setNotificationsIfChanged(nextNotifications);
          setUnreadCount(currentUnreadCount);
        } catch (err) {
          console.error("Dashboard refresh failed:", err);
        }

        if (activeTab === "report") {
          try {
            const locationsData = await getCustomLocations();
            if (cancelled) return;
            setCustomLocationsIfChanged(locationsData);
          } catch (err) {
            console.error("getCustomLocations failed:", err);
          }
        }
      } finally {
        refreshing = false;
        if (!cancelled && !document.hidden) {
          timeoutId = setTimeout(refresh, DASHBOARD_REFRESH_INTERVAL_MS);
        }
      }
    }

    const handleVisibilityChange = () => {
      clearTimeout(timeoutId);
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) refresh();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeTab]);

  useEffect(() => {
    const close = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current   && !notifRef.current.contains(e.target))   setNotifOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);


  // ── Evidence file handler ─────────────────────────────────────────────────
  const addEvidenceFiles = async (files) => {
    if (!files.length) return;
    try {
      const converted = await Promise.all(files.map(readFile));
      const currentBytes = [...evidenceFiles, ...converted].reduce((total, item) => {
        const base64 = item.data.split(",")[1] || "";
        return total + Math.floor(base64.length * 3 / 4);
      }, 0);
      if (currentBytes > MAX_EVIDENCE_TOTAL_BYTES) {
        setFormError("Evidence files must total no more than 1.8 MB. Remove a file or upload smaller images.");
        return;
      }
      setEvidenceFiles((prev) => [...prev, ...converted]);
    } catch (error) {
      setFormError(error.message || "Could not read or optimize one or more files. Please try again.");
    }
  };

  const handleEvidencePick = (e) => addEvidenceFiles(Array.from(e.target.files));

  const removeEvidence = (idx) =>
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleFollowUpEvidencePick = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    try {
      const converted = await Promise.all(files.map(readFile));
      const currentBytes = [...followUpEvidenceFiles, ...converted].reduce((total, item) => {
        const base64 = item.data.split(",")[1] || "";
        return total + Math.floor(base64.length * 3 / 4);
      }, 0);
      if (currentBytes > MAX_EVIDENCE_TOTAL_BYTES) {
        setFollowUpError("Additional proof must total no more than 1.8 MB.");
        return;
      }
      setFollowUpEvidenceFiles((current) => [...current, ...converted]);
      setFollowUpError("");
    } catch (error) {
      setFollowUpError(error.message || "Could not read the selected files.");
    }
  };

  const submitFollowUpResponse = async () => {
    if (!caseViewItem || followUpSaving) return;
    if (!followUpResponse.trim() && followUpEvidenceFiles.length === 0) {
      setFollowUpError("Write a response or attach at least one photo or file.");
      return;
    }

    setFollowUpSaving(true);
    setFollowUpError("");
    try {
      const result = await addReportEvidence(
        caseViewItem.id,
        followUpEvidenceFiles,
        followUpResponse.trim()
      );
      const updatedReport = {
        ...caseViewItem,
        status: result.status,
        evidenceCount: result.evidenceCount,
        adminNotes: [
          caseViewItem.adminNotes || "",
          followUpResponse.trim() ? `Student response: ${followUpResponse.trim()}` : "Student submitted additional proof.",
        ].filter(Boolean).join("\n\n"),
      };
      setReports((current) => current.map((report) =>
        report.id === updatedReport.id
          ? { ...report, status: updatedReport.status, evidenceCount: updatedReport.evidenceCount, adminNotes: updatedReport.adminNotes }
          : report
      ));
      setCaseViewItem(updatedReport);
      setFollowUpEvidenceFiles([]);
      setFollowUpResponse("");
      showToast(result.notificationWarning || "Your response and proof have been sent. The case is back under review.", result.notificationWarning ? "error" : "success");
    } catch (error) {
      setFollowUpError(error.message || "Could not submit your response.");
    } finally {
      setFollowUpSaving(false);
    }
  };

  // ── Report submission ─────────────────────────────────────────────────────
  // ── Person list helpers ──────────────────────────────────────────────────
  const updatePerson = (setter, idx, field, val) =>
    setter(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  const handleVictimGradeChange = (idx, grade) => {
    setVictims((current) => current.map((victim, i) =>
      i === idx ? { ...victim, grade, section: "", adviser: "" } : victim
    ));
  };
  const handleVictimSectionChange = (idx, sectionName) => {
    const assignedSection = gradeSectionsList.find((item) =>
      item.grade === victims[idx]?.grade && item.section === sectionName
    );
    setVictims((current) => current.map((victim, i) =>
      i === idx
        ? { ...victim, section: sectionName, adviser: assignedSection?.adviser || "" }
        : victim
    ));
  };
  const addPerson    = (setter) => setter(prev => [...prev, emptyPerson()]);
  const removePerson = (setter, idx) => setter(prev => prev.filter((_, i) => i !== idx));
  const handleReporterTypeChange = (nextType) => {
    const normalizedGrade = GRADE_OPTIONS.find(
      (grade) => grade.trim().toLowerCase() === profileGrade.trim().toLowerCase()
    ) || profileGrade.trim();
    const availableSections = gradeSectionsList.filter((section) => section.grade === normalizedGrade);
    const matchingSection = availableSections.find(
      (section) => section.section.trim().toLowerCase() === profileSection.trim().toLowerCase()
    );
    const profileVictim = {
      name: studentName,
      lrn: profileLrn,
      age: profileAge,
      grade: normalizedGrade,
      section: matchingSection?.section || profileSection.trim(),
      adviser: matchingSection?.adviser || "",
    };

    setReporterType(nextType);
    setHasWitnesses(false);
    setVictims((current) => {
      const firstVictim = current[0] || emptyPerson();
      if (nextType === "Victim") {
        return [{ ...firstVictim, ...profileVictim }, ...current.slice(1)];
      }
      if (reporterType !== "Victim") return current;

      const clearedVictim = { ...firstVictim };
      Object.entries(profileVictim).forEach(([field, value]) => {
        if (clearedVictim[field] === value) clearedVictim[field] = "";
      });
      return [clearedVictim, ...current.slice(1)];
    });
  };

  const handleReportSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!reportForm.type || !reportForm.date || !reportForm.description) {
      setFormError("Please fill in Type, Date, and Description.");
      return;
    }
    if (reportForm.date > new Date().toISOString().slice(0, 10)) {
      setFormError("Date of Incident cannot be in the future.");
      return;
    }
    if (
      reportForm.time &&
      reportForm.date === new Date().toISOString().slice(0, 10) &&
      reportForm.time > new Date().toTimeString().slice(0, 5)
    ) {
      setFormError("Approximate Time cannot be in the future.");
      return;
    }
    try {
      await submitReport({
        ...reportForm,
        reporterType,
        victims,
        offenders,
        witnesses: reporterType === "Witness" || (reporterType === "Victim" && hasWitnesses) ? witnesses : [],
        isAnonymous,
      }, evidenceFiles);
    } catch (err) {
      setFormError("Could not submit report: " + err.message);
      return;
    }
    const refreshedReports = await getReports({ summaryOnly: true, limit: REPORT_PAGE_SIZE });
    setReports(refreshedReports);
    setHasMoreReports(refreshedReports.length === REPORT_PAGE_SIZE);
    const refreshedNotifications = await getStudentNotifications();
    setNotifications(refreshedNotifications);
    setHasMoreNotifications(refreshedNotifications.length === 30);
    setUnreadCount(await getUnreadNotificationCount());
    setReportForm({ type: "", date: "", time: "", location: "", description: "", descriptionLeadUp: "", descriptionImpact: "", involved: "" });
    setLocationChoice("");
    setReporterType("");
    setVictims([emptyPerson()]);
    setOffenders([emptyPerson()]);
    setWitnesses([emptyPerson()]);
    setHasWitnesses(false);
    setIsAnonymous(false);
    setEvidenceFiles([]);
    setSubmitSuccess(true);
    showToast("Report submitted successfully! Redirecting to Case Monitoring…");
    setTimeout(() => { setSubmitSuccess(false); setActiveTab("cases"); }, 2500);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const myReports  = reports.filter((r) => r.submittedBy === studentName);
  const conferenceList = [...myReports]
    .filter((r) => r.scheduledConference && (r.scheduledConference.date || r.scheduledConference.time || r.scheduledConference.location))
    .map((r) => {
      const conference = r.scheduledConference;
      return {
        id: r.id,
        type: r.type,
        status: getConferenceStatus({
          ...conference,
          outcomeNotes: r.conferenceFindings || conference.outcomeNotes || "",
        }),
        date: conference.date || "Date TBD",
        time: formatConferenceTime(conference.time),
        location: conference.location || "Location TBD",
        notes: conference.notes || "",
        request: conference.request || null,
        previousSchedule: conference.previousSchedule || null,
        rescheduledFrom: conference.rescheduledFrom || null,
      };
    })
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const scheduledConferenceStatuses = ["Scheduled", "Today", "Overdue", "Rescheduled", "Reschedule Requested", "Cancellation Requested"];
  const scheduledConferenceList = conferenceList.filter((conference) => scheduledConferenceStatuses.includes(conference.status));
  const activeConferenceViewItem = conferenceViewItem
    ? conferenceList.find((conference) => conference.id === conferenceViewItem.id) || conferenceViewItem
    : null;

  const handleSubmitConferenceRequest = async (event) => {
    event.preventDefault();
    if (!activeConferenceViewItem || !conferenceRequestType || conferenceRequestSaving) return;

    setConferenceRequestSaving(true);
    try {
      const updatedReport = await requestConferenceChange(
        activeConferenceViewItem.id,
        conferenceRequestType,
        conferenceRequestReason
      );
      setReports((current) => current.map((report) => report.id === updatedReport.id ? updatedReport : report));
      setConferenceRequestType(null);
      setConferenceRequestReason("");
      showToast(conferenceRequestType === "reschedule"
        ? "Reschedule request sent to the Prefect."
        : "Cancellation request sent to the Prefect.");
    } catch (error) {
      showToast(`Could not submit conference request: ${error.message}`, "error");
    } finally {
      setConferenceRequestSaving(false);
    }
  };

  const filteredHub = awarenessContent.filter((item) => {
    const q = hubSearchQuery.toLowerCase();
    const matchSearch = item.title.toLowerCase().includes(q) || (item.desc && item.desc.toLowerCase().includes(q));
    const matchFilter = hubFilter === "all" || item.type === hubFilter;
    return matchSearch && matchFilter;
  });

  // "Other" is the breakdown chart's catch-all bucket, not a pickable place —
  // the form has its own explicit "Others" option that reveals a free-text field.
  const allPlaces        = [...LOCATION_META.filter((p) => p.key !== "Other"), ...customLocations];
  const insidePlaces     = allPlaces.filter((p) => p.zone !== "outside");
  const outsidePlaces    = allPlaces.filter((p) => p.zone === "outside");

  const getTabHeader = () => ({
    report:    { title: "Submit an Incident Report",  sub: "Your report is handled with confidentiality. You are not alone." },
    profile:   { title: "My Profile",                 sub: "Manage your account settings and privacy preferences." },
    cases:     { title: "My Case Monitoring",         sub: "Track the status of your submitted reports in real-time." },
    dashboard: {
      title: language === "fil"
        ? `👋 Maligayang pagdating, ${studentName || "Mag-aaral"}!`
        : `👋 Welcome, ${studentName || "Student"}!`,
      sub: "A safer school starts with speaking up.",
    },
  }[activeTab] || { title: "Dashboard", sub: "" });

  const { title, sub } = getTabHeader();

  return translateStudentUI((
    <div className="s-dashboard" style={{ backgroundImage: `url(${bg})` }}>

      {/* ── MOBILE NAV BACKDROP ── */}
      {mobileNavOpen && (
        <div className="s-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* ── SIDEBAR ── */}
      <div className={`s-sidebar ${mobileNavOpen ? "s-sidebar-open" : ""}`}>
        <div className="s-brand">
          <img src={logo} alt="logo" />
          <div>
            <h2>CASINGLOT NHS</h2>
            <p>BULLYING REPORT SYSTEM</p>
          </div>
          <button className="s-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="s-sb-label">Navigation</div>
        <nav className="s-menu">
          {[
            { tab: "dashboard", icon: <LayoutDashboard size={16} />, label: "Dashboard" },
            { tab: "report",    icon: <FileText size={16} />,        label: "Submit Report" },
            { tab: "cases",     icon: <Shield size={16} />,          label: "Case Monitoring" },
            { tab: "profile",   icon: <User size={16} />,            label: "My Profile" },
          ].map(({ tab, icon, label }) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => { setActiveTab(tab); setMobileNavOpen(false); }}>
              {icon} {label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── MAIN ── */}
      <div className="s-main">

        {/* TOP BAR */}
        <div className="s-header">
          <button className="s-hamburger-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="s-welcome">
            <h2>{title}</h2>
            <p>{sub}</p>
          </div>
          <div className="s-header-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Notifications */}
            <div style={{ position: "relative" }} ref={notifRef}>
              <button className="s-icon-btn-round" onClick={() => setNotifOpen(!notifOpen)}>
                <Bell size={18} />
                {unreadCount > 0 && <span className="s-notif-badge">{unreadCount}</span>}
              </button>
              {notifOpen && (
                <div className="s-notif-dropdown">
                  <div className="s-notif-header">
                    <span>Notifications</span>
                    <button onClick={async () => {
                      await markAllStudentNotifRead();
                      const refreshed = await getStudentNotifications();
                      setNotifications(refreshed);
                      setHasMoreNotifications(refreshed.length === 30);
                      setUnreadCount(0);
                    }}>
                      Mark all read
                    </button>
                  </div>
                  {notifications.length === 0 && (
                    <div style={{ padding: "14px 16px", fontSize: 13, color: "#94a3b8" }}>No notifications yet.</div>
                  )}
                  {notifications.map((n) => (
                    <div key={n.id} className={`s-notif-item ${!n.read ? "unread" : ""}`}
                      onClick={async () => {
                        await markStudentNotifRead(n.id);
                        const refreshed = await getStudentNotifications();
                        setNotifications(refreshed);
                        setHasMoreNotifications(refreshed.length === 30);
                        setUnreadCount(await getUnreadNotificationCount());
                        setNotifOpen(false);
                        if (n.type === "status") setActiveTab("cases");
                        else if (n.type === "hub") setActiveTab("dashboard");
                        else if (n.type === "report") setActiveTab("cases");
                      }}>
                      <div className={`s-notif-dot ${n.type === "status" ? "green" : n.type === "success" ? "blue" : "purple"}`} />
                      <div><p>{n.title}</p><span>{n.time}</span></div>
                    </div>
                  ))}
                  {hasMoreNotifications && (
                    <button type="button" className="back-btn" onClick={loadMoreNotifications} disabled={loadingMoreNotifications}>
                      {loadingMoreNotifications ? "Loading…" : "Load older notifications"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Identity pill */}
            <div className="s-identity-pill" ref={profileRef}>
              <button
                type="button"
                className="s-identity-btn"
                onClick={() => setProfileOpen(!profileOpen)}
                aria-haspopup="true"
                aria-expanded={profileOpen}
              >
                <div className="s-ava" style={{ width: 32, height: 32, fontSize: 11 }}>
                  <span>{(studentName || "S")[0].toUpperCase()}</span>
                </div>
                <div className="s-ava-info">
                  <span className="s-ava-name">{studentName || "Student"}</span>
                  <span className="s-ava-role">Student Account</span>
                </div>
                <ChevronDown size={14} className={`s-identity-chevron ${profileOpen ? "open" : ""}`} />
              </button>
              {profileOpen && (
                <div className="s-dropdown">
                  <p className="s-drop-label">Signed in as {studentName || "Student"}</p>
                  <button className="s-logout-btn" onClick={async () => {
                    try {
                      await signOut();
                    } finally {
                      navigate("/login?role=student");
                    }
                  }}>
                    <LogOut size={15} /> Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══════════════════════
            DASHBOARD TAB
        ══════════════════════ */}
        {activeTab === "dashboard" && (
          <div className="s-content">
            <div className="s-dashboard-grid">
              <div className="s-dashboard-main-column">
                {/* ── HERO REPORT BANNER ── */}
                <div className="s-hero-banner">
                  <div className="s-hero-text">
                    <div className="s-hero-badge">
                      <Shield size={13} /> Safe & Confidential
                    </div>
                    <h2>Experienced or witnessed bullying?</h2>
                    <p>You are not alone. Report it now — your identity is protected and every report is taken seriously.</p>
                    <button className="s-hero-btn" onClick={() => setActiveTab("report")}>
                      <FileText size={16} />
                      Submit a Report Now
                    </button>
                  </div>
                  <div className="s-hero-icon-wrap" aria-hidden="true">
                    <Shield size={80} strokeWidth={1.2} />
                  </div>
                </div>
                {/* ── AWARENESS HUB (moved into dashboard) ── */}
                <div className="s-dashboard-hub">
              <div className="s-hub-header-bar">
                <div>
                  <h3 className="s-hub-title">Awareness Hub</h3>
                  <p className="s-hub-subtitle">
                    {language === "fil"
                      ? `${filteredHub.length} sanggunian ang magagamit`
                      : `${filteredHub.length} resource${filteredHub.length !== 1 ? "s" : ""} available`}
                  </p>
                </div>
              </div>

              {/* Search + Filters */}
              <div className="s-hub-controls">
                <div className="s-search-box">
                  <span className="s-search-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                  </span>
                  <input
                    type="text"
                    placeholder="Search resources, topics…"
                    value={hubSearchQuery}
                    onChange={(e) => setHubSearchQuery(e.target.value)}
                  />
                  {hubSearchQuery && (
                    <span className="s-clear-icon" onClick={() => setHubSearchQuery("")}><X size={14} /></span>
                  )}
                </div>
                <div className="s-filter-chips">
                  {[
                    { key: "all",         label: "All",          emoji: "📚" },
                    { key: "infographic", label: "Infographics", emoji: "🖼️" },
                    { key: "video",       label: "Videos",       emoji: "▶️" },
                    { key: "resource",    label: "Resources",    emoji: "🔗" },
                  ].map(({ key, label, emoji }) => (
                    <button key={key} className={`s-filter-chip ${hubFilter === key ? "active" : ""}`}
                      onClick={() => setHubFilter(key)}>
                      <span>{emoji}</span> {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredHub.length === 0 ? (
                <div className="s-panel s-empty-state">
                  <BookOpen size={40} color="#d1fae5" />
                  <h3>No content found</h3>
                  <p>Try a different search or filter.</p>
                </div>
              ) : (
                <div className="s-hub-grid">
                  {filteredHub.map((item) => {
                    const thumbSrc = item.thumbnail || (item.type === "video" ? getYouTubeThumbnail(item.videoUrl) : "") || null;
                    return (
                      <div className="s-hub-card s-hub-card-clickable" key={item.id}
                        onClick={() => openHubItem(item)}>
                        <div className="s-hub-thumb-container">
                          {item.type === "video" ? (
                            <>
                              {thumbSrc
                                ? <img src={thumbSrc} alt={item.title} className="s-hub-img" loading="lazy" decoding="async" />
                                : <div className="s-hub-placeholder"><Play size={36} /></div>
                              }
                              <div className="s-hub-play-overlay">
                                <div className="s-hub-play-btn">
                                  <Play size={20} color="#fff" fill="#fff" />
                                </div>
                              </div>
                            </>
                          ) : item.fileData ? (
                            <img src={item.fileData} alt={item.title} className="s-hub-img" loading="lazy" decoding="async" />
                          ) : thumbSrc ? (
                            <img src={thumbSrc} alt={item.title} className="s-hub-img" loading="lazy" decoding="async" />
                          ) : (
                            <div className="s-hub-placeholder">
                              {item.type === "infographic" && <Image size={32} />}
                              {item.type === "resource"    && <BookOpen size={32} />}
                            </div>
                          )}
                          <span className={`s-hub-type-badge s-hub-badge-${item.type}`}>{item.type}</span>
                        </div>
                        <div className="s-hub-body">
                          <h4>{item.title}</h4>
                          {item.desc && <p className="s-hub-desc-text">{item.desc}</p>}
                          <div className="s-hub-view-btn">
                            <Eye size={13} /> View Content
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
              </div>

              <aside className="s-dashboard-side-panel">
                <div className="s-conference-card">
                  <div className="s-conference-header">
                    <Calendar size={12} />
                    <span>Scheduled Conferences</span>
                  </div>

                  {scheduledConferenceList.length === 0 ? (
                    <div className="s-conference-empty">
                      No scheduled conference yet. Once the school sets a meeting, it will appear here.
                    </div>
                  ) : (
                    <div className="s-conference-list">
                      {scheduledConferenceList.map((conf) => (
                        <div
                          className="s-conference-item"
                          key={`${conf.id}-${conf.date}`}
                          onClick={() => setConferenceViewItem(conf)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setConferenceViewItem(conf);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`View conference details for case ${conf.id}`}
                          style={{ cursor: "pointer" }}
                        >
                          <div className="s-conference-top">
                            <span className="s-conference-badge">Case #{conf.id}</span>
                            <span className={`s-conference-status ${conf.status.toLowerCase().replace(/\s/g, "-")}`}>
                              {conf.status}
                            </span>
                          </div>
                          <div className="s-conference-meta s-conference-type">
                            <span className="s-conference-type-dot" style={{ background: CONFERENCE_TYPE_COLORS[conf.type] || "#64748b" }} />
                            <strong>{conf.type}</strong>
                          </div>
                          <div className="s-conference-meta">📅 {formatConferenceDate(conf.date, language)}</div>
                          <div className="s-conference-meta">🕒 {conf.time}</div>
                          <div className="s-conference-meta">📍 {conf.location}</div>
                          {(conf.rescheduledFrom || conf.previousSchedule?.date) && (
                            <div className="s-conference-previous">
                              Rescheduled from {conf.rescheduledFrom || conf.previousSchedule.date}
                            </div>
                          )}
                          {conf.notes && <div className="s-conference-note">{conf.notes}</div>}
                          <div className="s-conference-footer">
                            <span>View details</span>
                            <ArrowUpRight size={12} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* ══════════════════════
            CASE MONITORING TAB
        ══════════════════════ */}
        {activeTab === "cases" && (
          <div className="s-content s-case-monitoring">
            {myReports.length === 0 ? (
              <div className="s-panel s-empty-state">
                <Shield size={48} color="#d1fae5" />
                <h3>No cases to monitor</h3>
                <p>Submit an incident report and its status will be tracked here in real time.</p>
                <button className="s-submit-btn" onClick={() => setActiveTab("report")}>Submit a Report</button>
              </div>
            ) : (
              <div className="s-case-list">
                {myReports.map((r) => (
                  <button
                    type="button"
                    className="s-panel s-case-card s-case-card-clickable"
                    key={r.id}
                    onClick={() => openCaseDetails(r)}
                    aria-label={`View details for case ${r.id}, ${r.status}`}
                  >
                    <div className="s-case-top">
                      <div>
                        <span className="s-case-id">Case #{r.id}</span>
                        <span className="s-case-type">{r.type}</span>
                      </div>
                      <div className="s-case-status">
                        <span className={`s-status-badge ${r.status.toLowerCase().replace(/\s/g, "-")}`}>
                          {statusIcon(r.status)} {r.status}
                        </span>
                      </div>
                    </div>
                    <p className="s-case-desc">{r.description}</p>
                    <div className="s-case-meta">
                      <span><Calendar size={13} aria-hidden="true" /> {r.date}{r.time ? ` at ${r.time}` : ""}</span>
                      {r.location && <span><MapPin size={13} aria-hidden="true" /> {r.location}</span>}
                      {r.evidenceCount > 0 && (
                        <span><Paperclip size={12} aria-hidden="true" /> {r.evidenceCount} evidence file{r.evidenceCount > 1 ? "s" : ""}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {hasMoreReports && (
              <button type="button" className="s-submit-btn" onClick={loadMoreReports} disabled={loadingMoreReports} style={{ marginTop: 16 }}>
                {loadingMoreReports ? "Loading cases…" : "Load older cases"}
              </button>
            )}
          </div>
        )}

        {/* ══════════════════════
            SUBMIT REPORT TAB
        ══════════════════════ */}
        {activeTab === "report" && (
          <div className="s-content">
            {submitSuccess && (
              <div className="s-success-banner">
                <CheckCircle size={18} /> Report submitted successfully! Redirecting to Case Monitoring…
              </div>
            )}
            <div className="s-report-layout">
              <div className="s-panel s-form-panel">
                <h3 className="s-form-title">Incident Details</h3>

                {/* Fake report warning */}
                <div className="s-fake-report-warning">
                  <AlertCircle size={15} />
                  <div>
                    <strong>Before You Submit:</strong> Thank you for speaking up! Siguroa nga tinood ug accurate ang imong report. Ang paghimo ug false report mahimong makadaot sa mga tinuod nga biktima ug mahimong hinungdan sa disciplinary action. Ayaw kabalaka, ampingan ang imong identity ug report details. Ang authorized school personnel ra ang makakita ani. <strong>Speak up honestly, safe imong privacy!</strong>
                  </div>
                </div>

                <form onSubmit={handleReportSubmit}>

                  {/* ── Reporter Information ── */}
                  <div className="s-form-section-title s-reporter-section-title">Reporter Information</div>
                  <div className="s-form-row s-reporter-role-row">
                    <div className="s-form-group">
                      <label>Reporter Role *</label>
                      <select value={reporterType} required
                        onChange={(e) => handleReporterTypeChange(e.target.value)}>
                        <option value="">Select role…</option>
                        <option value="Victim">Victim</option>
                        <option value="Witness">Witness</option>
                        <option value="Friend">Friend of Victim</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <div className="s-form-row s-reporter-detail-row">
                    <div className="s-form-group">
                      <label>Type of Bullying *</label>
                      <select value={reportForm.type} required
                        onChange={(e) => setReportForm({ ...reportForm, type: e.target.value })}>
                        <option value="">Select type…</option>
                        <option value="Physical">Physical Bullying</option>
                        <option value="Verbal">Verbal / Emotional</option>
                        <option value="Cyber">Cyberbullying</option>
                        <option value="Social">Social / Relational</option>
                        <option value="Property">Property Damage / Theft</option>
                        <option value="Others">Others</option>
                      </select>
                    </div>
                    <div className="s-form-group">
                      <label>Date of Incident *</label>
                      <input type="date" required value={reportForm.date}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setReportForm({ ...reportForm, date: e.target.value })} />
                    </div>
                  </div>
                  <div className="s-form-row s-reporter-detail-row">
                    <div className="s-form-group">
                      <label>Approximate Time</label>
                      <input type="time" value={reportForm.time}
                        max={reportForm.date === new Date().toISOString().slice(0, 10)
                          ? new Date().toTimeString().slice(0, 5) : undefined}
                        onChange={(e) => setReportForm({ ...reportForm, time: e.target.value })} />
                    </div>
                    <div className="s-form-group">
                      <label>Location of Incident</label>
                      <select
                        value={locationChoice}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLocationChoice(val);
                          setReportForm({ ...reportForm, location: val === "Others" ? "" : val });
                        }}
                      >
                        <option value="">Select a place…</option>
                        <optgroup label="Inside School">
                          {insidePlaces.map((p) => (
                            <option key={p.key} value={p.key}>{p.icon} {p.key}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Outside / Other">
                          {outsidePlaces.map((p) => (
                            <option key={p.key} value={p.key}>{p.icon} {p.key}</option>
                          ))}
                        </optgroup>
                        <option value="Others">📍 Others (please specify)</option>
                      </select>
                      {locationChoice === "Others" && (
                        <input type="text" style={{ marginTop: 8 }} placeholder="Please specify the location…"
                          value={reportForm.location}
                          onChange={(e) => setReportForm({ ...reportForm, location: e.target.value })} />
                      )}
                    </div>
                  </div>
                  {/* ── Victim Information ── */}
                  <div className="s-form-section-title">Victim Information</div>
                  {victims.map((v, idx) => (
                    <div key={idx} className="s-person-card">
                      {victims.length > 1 && (
                        <div className="s-person-card-header">
                          <span>Victim {idx + 1}</span>
                          <button type="button" className="s-remove-person-btn" onClick={() => removePerson(setVictims, idx)}><X size={13} /> Remove</button>
                        </div>
                      )}
                      <div className="s-form-row">
                        <div className="s-form-group"><label>Full Name</label>
                          <input type="text" placeholder="Last, First Middle" value={v.name} onChange={e => updatePerson(setVictims, idx, "name", e.target.value)} /></div>
                        <div className="s-form-group"><label>LRN</label>
                          <input type="text" inputMode="numeric" placeholder="12-digit LRN" maxLength={12} value={v.lrn}
                            onChange={e => updatePerson(setVictims, idx, "lrn", e.target.value.replace(/\D/g, "").slice(0, 12))} /></div>
                      </div>
                      <div className="s-form-row s-person-details-row">
                        <div className="s-form-group"><label>Age</label>
                          <input type="number" min="5" max="25" placeholder="e.g. 14" value={v.age} onChange={e => updatePerson(setVictims, idx, "age", e.target.value)} /></div>
                        <div className="s-form-group"><label>Grade</label>
                          <select value={v.grade} onChange={e => handleVictimGradeChange(idx, e.target.value)}>
                            <option value="">Select grade</option>
                            {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select></div>
                        <div className="s-form-group"><label>Section</label>
                          <select value={v.section} disabled={!v.grade} onChange={e => handleVictimSectionChange(idx, e.target.value)}>
                            <option value="">{!v.grade ? "Select grade first" : "Select section"}</option>
                            {gradeSectionsList.filter((s) => s.grade === v.grade).map((s) => (
                              <option key={s.id} value={s.section}>{s.section}</option>
                            ))}
                            {v.section && !gradeSectionsList.some(
                              (section) => section.grade === v.grade &&
                                section.section.trim().toLowerCase() === v.section.trim().toLowerCase()
                            ) && <option value={v.section}>{v.section}</option>}
                          </select></div>
                      </div>
                      <div className="s-form-row">
                        <div className="s-form-group"><label>Adviser</label>
                          <input type="text" placeholder="Adviser's name" value={v.adviser} onChange={e => updatePerson(setVictims, idx, "adviser", e.target.value)} /></div>
                        <div className="s-form-group"><label>Parent / Guardian Name</label>
                          <input type="text" placeholder="Parent or guardian" value={v.parentName} onChange={e => updatePerson(setVictims, idx, "parentName", e.target.value)} /></div>
                      </div>
                      <div className="s-form-group"><label>Parent / Guardian Contact</label>
                        <input type="text" placeholder="Phone number or email" value={v.parentContact} onChange={e => updatePerson(setVictims, idx, "parentContact", e.target.value)} /></div>
                    </div>
                  ))}
                  <button type="button" className="s-add-person-btn" onClick={() => addPerson(setVictims)}>+ Add Another Victim</button>

                  {/* ── Alleged Offender Information ── */}
                  <div className="s-form-section-title s-offender-section-title">Alleged Offender Information</div>
                  {offenders.map((o, idx) => (
                    <div key={idx} className="s-person-card s-person-card-offender">
                      {offenders.length > 1 && (
                        <div className="s-person-card-header">
                          <span>Alleged Offender {idx + 1}</span>
                          <button type="button" className="s-remove-person-btn" onClick={() => removePerson(setOffenders, idx)}><X size={13} /> Remove</button>
                        </div>
                      )}
                      <div className="s-form-group"><label>Full Name (if known)</label>
                        <input type="text" placeholder="Last, First Middle" value={o.name} onChange={e => updatePerson(setOffenders, idx, "name", e.target.value)} /></div>
                      <div className="s-form-row s-person-details-row">
                        <div className="s-form-group"><label>Age</label>
                          <input type="number" min="5" max="25" placeholder="e.g. 15" value={o.age} onChange={e => updatePerson(setOffenders, idx, "age", e.target.value)} /></div>
                        <div className="s-form-group"><label>Grade (if known)</label>
                          <select value={o.grade} onChange={e => { updatePerson(setOffenders, idx, "grade", e.target.value); updatePerson(setOffenders, idx, "section", ""); }}>
                            <option value="">Select grade</option>
                            {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select></div>
                        <div className="s-form-group"><label>Section (if known)</label>
                          <select value={o.section} disabled={!o.grade} onChange={e => updatePerson(setOffenders, idx, "section", e.target.value)}>
                            <option value="">{!o.grade ? "Select grade first" : "Select section"}</option>
                            {gradeSectionsList.filter((s) => s.grade === o.grade).map((s) => (
                              <option key={s.id} value={s.section}>{s.section}</option>
                            ))}
                          </select></div>
                      </div>
                      <div className="s-form-row">
                        <div className="s-form-group"><label>Adviser</label>
                          <input type="text" placeholder="Adviser's name" value={o.adviser} onChange={e => updatePerson(setOffenders, idx, "adviser", e.target.value)} /></div>
                        <div className="s-form-group"><label>Parent / Guardian Name</label>
                          <input type="text" placeholder="Parent or guardian" value={o.parentName} onChange={e => updatePerson(setOffenders, idx, "parentName", e.target.value)} /></div>
                      </div>
                      <div className="s-form-group"><label>Parent / Guardian Contact</label>
                        <input type="text" placeholder="Phone number or email" value={o.parentContact} onChange={e => updatePerson(setOffenders, idx, "parentContact", e.target.value)} /></div>
                    </div>
                  ))}
                  <button type="button" className="s-add-person-btn s-add-person-btn-offender" onClick={() => addPerson(setOffenders)}>+ Add Another Offender</button>

                  {/* ── Witness Information (Optional) ── */}
                  {reporterType === "Victim" && (
                    <div className="s-form-row">
                      <div className="s-form-group">
                        <label>Does the victim have witnesses?</label>
                        <select value={hasWitnesses ? "yes" : "no"} onChange={(e) => {
                          const wantsWitnesses = e.target.value === "yes";
                          setHasWitnesses(wantsWitnesses);
                          if (!wantsWitnesses) setWitnesses([emptyPerson()]);
                        }}>
                          <option value="no">No witnesses</option>
                          <option value="yes">Yes, add witness information</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {(reporterType === "Witness" || (reporterType === "Victim" && hasWitnesses)) && (
                    <>
                      <div className="s-person-card-header" style={{ marginTop: 20 }}>
                        <span className="s-form-section-title" style={{ margin: 0 }}>Witness Information</span>
                        {reporterType === "Victim" && (
                          <button
                            type="button"
                            className="s-remove-person-btn"
                            onClick={() => {
                              setHasWitnesses(false);
                              setWitnesses([emptyPerson()]);
                            }}
                            aria-label="Remove witness information"
                            title="Remove witness information"
                          >
                            <X size={13} /> Remove
                          </button>
                        )}
                      </div>
                      {witnesses.map((w, idx) => (
                        <div key={idx} className="s-person-card s-person-card-witness">
                          {witnesses.length > 1 && (
                            <div className="s-person-card-header">
                              <span>Witness {idx + 1}</span>
                              <button type="button" className="s-remove-person-btn" onClick={() => removePerson(setWitnesses, idx)}><X size={13} /> Remove</button>
                            </div>
                          )}
                          <div className="s-form-group"><label>Full Name</label>
                            <input type="text" placeholder="Last, First Middle" value={w.name} onChange={e => updatePerson(setWitnesses, idx, "name", e.target.value)} /></div>
                          <div className="s-form-row">
                            <div className="s-form-group"><label>Grade</label>
                              <select value={w.grade} onChange={e => { updatePerson(setWitnesses, idx, "grade", e.target.value); updatePerson(setWitnesses, idx, "section", ""); }}>
                                <option value="">Select grade</option>
                                {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                              </select></div>
                            <div className="s-form-group"><label>Section</label>
                              <select value={w.section} disabled={!w.grade} onChange={e => updatePerson(setWitnesses, idx, "section", e.target.value)}>
                                <option value="">{!w.grade ? "Select grade first" : "Select section"}</option>
                                {gradeSectionsList.filter((s) => s.grade === w.grade).map((s) => (
                                  <option key={s.id} value={s.section}>{s.section}</option>
                                ))}
                              </select></div>
                          </div>
                          <div className="s-form-group"><label>Contact (if any)</label>
                            <input type="text" placeholder="Phone or email" value={w.parentContact} onChange={e => updatePerson(setWitnesses, idx, "parentContact", e.target.value)} /></div>
                        </div>
                      ))}
                      <button type="button" className="s-add-person-btn s-add-person-btn-witness" onClick={() => addPerson(setWitnesses)}>+ Add Another Witness</button>
                    </>
                  )}

                  {/* ── Incident Description (split) ── */}
                  <div className="s-form-section-title">Incident Description</div>
                  <div className="s-form-group">
                    <label>What happened? *</label>
                    <textarea placeholder="I-describe ang nahitabo nga insidente sa detalye..." required
                      value={reportForm.description}
                      onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })} />
                  </div>
                  <div className="s-form-group">
                    <label>Events leading to the incident</label>
                    <textarea placeholder="Unsa ang nahitabo sa wala pa ang insidente? Aduna bay previous conflicts o rason nga nakaingon ani?" style={{ minHeight: 80 }}
                      value={reportForm.descriptionLeadUp}
                      onChange={(e) => setReportForm({ ...reportForm, descriptionLeadUp: e.target.value })} />
                  </div>
                  <div className="s-form-group">
                    <label>Impact on the victim</label>
                    <textarea placeholder="Unsa ang epekto ani sa biktima? Naunsa siya physically, emotionally," style={{ minHeight: 80 }}
                      value={reportForm.descriptionImpact}
                      onChange={(e) => setReportForm({ ...reportForm, descriptionImpact: e.target.value })} />
                  </div>

                  {/* Evidence Upload */}
                  <div className="s-form-group">
                    <label>Evidence (Photos / Files)</label>
                    <div className="s-file-upload"
                      onClick={() => document.getElementById("s-file-input").click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async (e) => {
                        e.preventDefault();
                        await addEvidenceFiles(Array.from(e.dataTransfer.files));
                      }}>
                      <Upload size={22} color="var(--s-accent)" style={{ marginBottom: 8 }} />
                      <p>Click or drag &amp; drop files here</p>
                      <span>Photos and screenshots are compressed automatically; documents are accepted too.</span>
                      <input id="s-file-input" type="file" multiple style={{ display: "none" }}
                        accept="image/*,.pdf,.doc,.docx,.txt"
                        onChange={handleEvidencePick} />
                    </div>
                    {/* Preview */}
                    {evidenceFiles.length > 0 && (
                      <div className="s-evidence-preview">
                        {evidenceFiles.map((f, idx) => (
                          <div key={idx} className="s-evidence-chip">
                            {f.type && f.type.startsWith("image/")
                              ? <img src={f.data} alt={f.name} />
                              : <Paperclip size={13} />}
                            <span>{f.name}</span>
                            <button type="button" onClick={() => removeEvidence(idx)}><X size={11} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="s-form-error">⚠ {formError}</div>
                  )}

                  {/* Anonymous Toggle */}
                  <div className="s-anonymous-toggle">
                    <button
                      type="button"
                      className={`s-anon-btn ${isAnonymous ? "s-anon-active" : ""}`}
                      onClick={() => setIsAnonymous((v) => !v)}
                      aria-pressed={isAnonymous}
                    >
                      <span className="s-anon-icon">{isAnonymous ? "🕵️" : "👤"}</span>
                      <span className="s-anon-label">
                        {isAnonymous ? "Submitting Anonymously" : "Submit with My Name"}
                      </span>
                      <span className="s-anon-pill">{isAnonymous ? "ON" : "OFF"}</span>
                    </button>
                    <p className="s-anon-hint">
                      {isAnonymous
                        ? "Your name will be hidden from the admin. All other report details remain visible."
                        : "Your name will be visible to the admin as the reporter."}
                    </p>
                  </div>

                  <div className="s-form-actions">
                    <button type="button" className="s-cancel-btn" onClick={() => setActiveTab("dashboard")}>Discard</button>
                    <button type="submit" className="s-submit-btn">Submit Report</button>
                  </div>
                </form>
              </div>

              {/* Help Panel */}
              <div className="s-panel s-help-panel">
                <div className="s-help-header">
                  <HelpCircle size={18} color="var(--s-accent)" />
                  <h3>How to Report</h3>
                </div>
                <ul className="s-help-steps">
                  {[
                    ["01", "Identify the Type",           "Choose the category that best describes the incident."],
                    ["02", "Be Specific",                  "Provide exact location and time to help admin investigate faster."],
                    ["03", "Detailed Description",         "Explain what happened before, during, and after."],
                    ["04", "Attach Evidence",              "Upload photos or screenshots — this greatly strengthens the case."],
                    ["05", "Confidentiality Guaranteed",   "Your identity is protected. Only authorized personnel will see this report."],
                  ].map(([num, strong, p]) => (
                    <li key={num}>
                      <span className="s-step-num">{num}</span>
                      <div><strong>{strong}</strong><p>{p}</p></div>
                    </li>
                  ))}
                </ul>
                <div className="s-privacy-note">
                  <Lock size={13} color="var(--s-accent)" />
                  <span>Your report is fully confidential.</span>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* ══════════════════════
            PROFILE TAB
        ══════════════════════ */}
        {activeTab === "profile" && (
          <div className="s-content">
            <div className="s-profile-layout">
              <div className="s-panel s-profile-card">
                <div className="s-profile-hero">
                  <div className="s-profile-user-icon" aria-hidden="true">
                    <User size={26} />
                  </div>
                  <div className="s-profile-meta">
                    <h3>{studentName || "Student Name"}</h3>
                    <p>Email Address: {localStorage.getItem("email") || "mariacruz@gmail.com"}</p>
                  </div>
                </div>

                {/* ── Personal Info ── */}
                <div className="s-profile-info-box">
                  <div className="s-profile-info-header">
                    <span className="s-profile-info-title">Personal Information</span>
                  </div>
                  <div className="s-profile-fields">
                    <div className="s-profile-field"><label>Full Name</label><span>{studentName || "—"}</span></div>
                    <div className="s-profile-field"><label>Age</label><span>{profileAge || "—"}</span></div>
                    <div className="s-profile-field"><label>Gender</label><span>{profileGender || "—"}</span></div>
                    <div className="s-profile-field"><label>Grade Level</label><span>{profileGrade || "—"}</span></div>
                    <div className="s-profile-field"><label>Section</label><span>{profileSection || "—"}</span></div>
                    <div className="s-profile-field"><label>Total Reports Filed</label><span style={{ color: "#16a34a", fontWeight: 700 }}>{myReports.length}</span></div>
                  </div>
                </div>
              </div>

            </div>
            <div className="s-panel" style={{ maxWidth: 720, padding: 24, marginTop: 16 }}>
              <div className="s-help-header">
                <h3>Language Preference</h3>
              </div>
              <p style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6 }}>
                Choose the language used across your student dashboard. This preference is saved for your account on this device.
              </p>
              <div className="s-form-group" style={{ marginTop: 18, maxWidth: 360 }}>
                <label htmlFor="student-language">Dashboard Language</label>
                <select
                  id="student-language"
                  value={language}
                  onChange={(event) => {
                    const selectedLanguage = event.target.value;
                    localStorage.setItem(languagePreferenceKey, selectedLanguage);
                    setLanguage(selectedLanguage);
                  }}
                >
                  <option value="en">English</option>
                  <option value="fil">Filipino</option>
                </select>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── TOAST ── */}
      {toast && (
        <div className={`s-toast ${toast.type}`}>
          <CheckCircle size={16} />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* ── CASE DETAIL MODAL ── */}
      {caseViewItem && (() => {
        const r = caseViewItem;
        const status = r.status;
        const conference = r.scheduledConference;
        const hasConferenceSchedule = conference && (
          conference.date || conference.time || conference.location
        );
        const conferenceStatus = hasConferenceSchedule ? getConferenceStatus(conference) : null;
        const steps = [
          {
            key: "received",
            title: "Report Received",
            desc: "System successfully logged your report.",
            state: "completed",
          },
          {
            key: "investigation",
            title: "Investigation Started",
            desc: status === "Pending"
              ? "Waiting for a counselor to be assigned to the case."
              : "A counselor has been assigned and is reviewing the case.",
            state: status === "Pending" ? "pending" : "completed",
          },
          ...(hasConferenceSchedule ? [{
            key: "conference",
            title: conferenceStatus === "Rescheduled" ? "Conference Rescheduled" : "Conference Scheduled",
            desc: [
              conference.date && formatConferenceDate(conference.date, language),
              conference.time && formatConferenceTime(conference.time),
              conference.location,
              conference.notes,
            ].filter(Boolean).join(" • "),
            state: conferenceStatus === "Completed" || conferenceStatus === "Cancelled" || conferenceStatus === "No-show"
              ? "completed"
              : conferenceStatus === "Reschedule Requested" || conferenceStatus === "Cancellation Requested"
                ? "waiting"
                : "active",
            conferenceStatus,
          }] : []),
          {
            key: "review",
            title: status === "More Information Requested" ? "More Proof or Information Needed" : "Final Review",
            desc: status === "More Information Requested"
              ? "Please review the request below and send a reply with the requested proof."
              : r.adminNotes
                ? "The Prefect of Discipline has added notes — see below."
              : "Reviewing actions and documentation.",
            state: status === "Resolved" ? "completed" : (status === "More Information Requested" || r.adminNotes ? "active" : "waiting"),
          },
          {
            key: "resolved",
            title: "Resolved",
            desc: status === "Resolved"
              ? "Resolution complete and case closed."
              : "Case will be marked resolved once action is finalized.",
            state: status === "Resolved" ? "completed" : "upcoming",
          },
        ];
        const statusDescriptions = {
          "Pending": "Your report has been received and is in queue for review by the Prefect of Discipline.",
          "Under Investigation": "Your report is currently being investigated by the Prefect of Discipline.",
          "More Information Requested": "The Prefect requested more proof or information. Please reply to the request below.",
          "Resolved": "This case has been resolved. Thank you for speaking up.",
        };
        return (
          <div className="s-modal-overlay" onClick={() => setCaseViewItem(null)}>
            <div className="s-modal-box s-case-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="s-modal-header">
                <div className="s-case-modal-heading">
                  <span className="s-hub-type-badge" style={{ position: "static" }}>{r.type}</span>
                  <h3>Case #{r.id}</h3>
                </div>
                <button className="s-modal-close" onClick={() => setCaseViewItem(null)}><X size={18} /></button>
              </div>
              <div className="s-modal-body">

                {/* Status banner */}
                <div className={`s-case-status-banner ${status.toLowerCase().replace(/\s/g, "-")}`}>
                  <span className={`s-status-badge ${status.toLowerCase().replace(/\s/g, "-")}`}>
                    {statusIcon(status)} {status}
                  </span>
                  <p>{statusDescriptions[status] || ""}</p>
                </div>

                {/* Progress Tracker */}
                <div className="s-case-tracker">
                  <h4 className="s-case-tracker-title"><Shield size={14} color="var(--s-accent)" /> Case Progress</h4>
                  <div className="s-tracker-list">
                    {steps.map((step, i) => (
                      <div className={`s-tracker-step ${step.state}`} key={step.key}>
                        <div className="s-tracker-line-wrap">
                          <div className="s-tracker-dot">
                            {step.state === "completed" ? <CheckCircle size={14} /> : <span className="s-tracker-dot-inner" />}
                          </div>
                          {i < steps.length - 1 && <div className="s-tracker-line" />}
                        </div>
                        <div className="s-tracker-content">
                          <p className="s-tracker-step-title">{step.title}</p>
                          <p className="s-tracker-step-desc">{step.desc}</p>
                          <span className="s-tracker-step-tag">
                            {step.conferenceStatus ? step.conferenceStatus.toUpperCase()
                              : step.state === "completed" ? "COMPLETED"
                              : step.state === "active" ? "IN PROGRESS"
                              : step.state === "pending" ? "PENDING"
                              : step.state === "waiting" ? "WAITING"
                              : "UPCOMING"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Admin Note */}
                {r.adminNotes && (
                  <div className="s-admin-note s-case-modal-note" style={{ marginTop: 16 }}>
                    <Lock size={12} color="var(--s-accent)" />
                    <div>
                      <strong>{status === "More Information Requested" ? "Request from the Prefect:" : "Note from the Prefect:"}</strong>
                      <div style={{ marginTop: 5, whiteSpace: "pre-wrap" }}>{r.adminNotes}</div>
                    </div>
                  </div>
                )}

                {r.offenseRecord && (
                  <div className="s-admin-note s-case-modal-note s-case-modal-note-offense" style={{ marginTop: 16 }}>
                    <Shield size={12} style={{ color: "#b45309" }} />
                    <div>
                      <strong>Official Offense Record</strong>
                      <div style={{ marginTop: 8 }} className="s-case-detail-grid">
                        <div><label>Offense #</label><span>#{r.offenseRecord.offense_number || r.offenseRecord.id}</span></div>
                        <div><label>Reviewed</label><span>{r.offenseRecord.reviewed_at || "—"}</span></div>
                        <div><label>Disciplinary Action</label><span>{r.offenseRecord.disciplinary_action || "—"}</span></div>
                        <div><label>Follow-up</label><span>{r.offenseRecord.follow_up_date || "Not scheduled"}</span></div>
                        <div style={{ gridColumn: "1 / -1" }}><label>Findings</label><span>{r.offenseRecord.conference_findings || r.offenseRecord.admin_remarks || "No findings recorded."}</span></div>
                      </div>
                    </div>
                  </div>
                )}
                {!r.offenseRecord && r.hasCaseFollowUp && (
                  <div className="s-admin-note s-case-modal-note" style={{ marginTop: 16 }}>
                    <Lock size={12} color="var(--s-accent)" />
                    <div>
                      <strong>Case Review Update</strong>
                      <div style={{ marginTop: 6 }}>
                        The school has reviewed this case and recorded follow-up. Individual student offense-record details are kept private.
                      </div>
                    </div>
                  </div>
                )}

                {/* Report Details */}
                <div className="s-case-details-box">
                  <h4 className="s-case-tracker-title" style={{ marginBottom: 10 }}><FileText size={14} color="var(--s-accent)" /> Report Details</h4>
                  <div className="s-case-detail-grid">
                    <div><label>Incident Type</label><span>{r.type || "—"}</span></div>
                    <div><label>Date</label><span>{r.date || "—"}</span></div>
                    <div><label>Time</label><span>{r.time || "—"}</span></div>
                    <div><label>Location</label><span>{r.location || "—"}</span></div>
                    <div><label>Reporter Role</label><span>{r.reporterType || "—"}</span></div>
                    <div><label>Submitted</label><span>{r.isAnonymous ? "🕵️ Anonymously" : "With my name"}</span></div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label className="s-case-detail-label">What Happened?</label>
                    <p className="s-case-detail-text">{r.description || "No description provided."}</p>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label className="s-case-detail-label">Events Leading to the Incident</label>
                    <p className="s-case-detail-text">{r.descriptionLeadUp || "No prior events or context provided."}</p>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label className="s-case-detail-label">Impact on the Victim</label>
                    <p className="s-case-detail-text">{r.descriptionImpact || "No impact details provided."}</p>
                  </div>
                  {[
                    ["Victim Information", r.victims],
                    ["Alleged Offender Information", r.offenders],
                    ["Witness Information", r.witnesses],
                  ].map(([groupLabel, people]) => {
                    const providedPeople = (Array.isArray(people) ? people : []).filter((person) =>
                      person && Object.values(person).some((value) => String(value || "").trim())
                    );
                    if (providedPeople.length === 0) return null;
                    return (
                      <div className="s-case-people-group" key={groupLabel}>
                        <label className="s-case-detail-label">{groupLabel}</label>
                        <div className="s-case-person-list">
                          {providedPeople.map((person, index) => {
                            const details = [
                              person.age && { label: "Age", value: person.age },
                              person.grade && { label: "Grade", value: person.grade },
                              person.section && { label: "Section", value: person.section },
                              person.adviser && { label: "Adviser", value: person.adviser },
                              person.parentName && { label: "Parent / Guardian", value: person.parentName },
                              person.parentContact && { label: "Guardian Contact", value: person.parentContact },
                            ].filter(Boolean);
                            return (
                              <div className="s-case-person-card" key={`${groupLabel}-${index}`}>
                                <strong>{person.name || "Name not provided"}</strong>
                                {details.length > 0 && (
                                  <div className="s-case-person-meta">
                                    {details.map((detail) => (
                                      <span key={detail.label}><b>{detail.label}:</b> {detail.value}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {r.evidenceCount > 0 && !r.evidenceLoaded && !r.evidenceLoading && (
                    <button type="button" className="s-submit-btn" onClick={loadCaseEvidence} style={{ width: "auto", marginTop: 12 }}>
                      <Eye size={14} /> View {r.evidenceCount} attached file{r.evidenceCount === 1 ? "" : "s"}
                    </button>
                  )}
                  {r.evidenceLoading && <p className="s-case-detail-text">Loading attached evidence…</p>}
                  {r.evidenceError && <p className="s-case-detail-text" role="alert">Could not load evidence: {r.evidenceError}</p>}
                  {r.evidenceLoaded && r.evidence && r.evidence.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <label className="s-case-detail-label">Evidence</label>
                      <div className="s-evidence-row" style={{ marginTop: 6 }}>
                        {r.evidence.map((ev, idx) => (
                          ev.type && ev.type.startsWith("image/") ? (
                            <img key={idx} src={ev.data} alt={ev.name} loading="lazy"
                              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "2px solid #d1fae5" }} />
                          ) : (
                            <div key={idx} className="s-file-chip">
                              <Paperclip size={11} /> {ev.name}
                            </div>
                          )
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {status === "More Information Requested" && (
                  <section className="s-case-details-box s-followup-box" aria-labelledby="case-follow-up-title">
                    <div className="s-followup-heading">
                      <div className="s-followup-heading-icon"><Upload size={17} /></div>
                      <div>
                        <h4 id="case-follow-up-title">Additional information requested</h4>
                        <p>Review the request and reply with details or supporting proof.</p>
                      </div>
                    </div>
                    <div className="s-followup-request">
                      <span className="s-followup-request-label">Message from the Prefect</span>
                      <p>
                        {r.adminNotes?.trim() || "The Prefect requested more information but did not include a message. Please contact the school for clarification."}
                      </p>
                    </div>
                    <div className="s-followup-form">
                      <div className="s-followup-field-heading">
                        <label htmlFor="case-follow-up-response">Your response <span>(optional if attaching proof)</span></label>
                        <span>{followUpResponse.length}/2000</span>
                      </div>
                    <textarea
                      id="case-follow-up-response"
                      rows={3}
                      maxLength={2000}
                      value={followUpResponse}
                      onChange={(event) => setFollowUpResponse(event.target.value)}
                      placeholder="Write the information the Prefect requested…"
                    />
                    <div className="s-followup-attachments">
                      <label htmlFor="case-follow-up-files" className="s-followup-attach-btn">
                        <Paperclip size={15} /> Attach photos or files
                        <input id="case-follow-up-files" type="file" accept="image/*,.pdf,.doc,.docx,.txt" multiple onChange={handleFollowUpEvidencePick} />
                      </label>
                      <span className="s-followup-file-help">Up to 1 MB per file · 1.8 MB total</span>
                    </div>
                    {followUpEvidenceFiles.length > 0 && (
                      <div className="s-evidence-row s-followup-files" aria-label="Files ready to send">
                        {followUpEvidenceFiles.map((file, index) => (
                          <span className="s-file-chip" key={`${file.name}-${index}`}>
                            <Paperclip size={11} /> <span className="s-followup-file-name">{file.name}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              onClick={() => setFollowUpEvidenceFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                              style={{ border: 0, background: "transparent", color: "#64748b", cursor: "pointer", padding: 0, display: "inline-flex" }}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {followUpError && <p className="s-followup-error" role="alert">{followUpError}</p>}
                    <div className="s-followup-actions">
                      <p>Your reply and attachments will be added to this case for review.</p>
                    <button
                      type="button"
                      className="s-submit-btn s-followup-send-btn"
                      disabled={followUpSaving}
                      onClick={submitFollowUpResponse}
                    >
                      {followUpSaving ? "Sending reply…" : <><Send size={15} /> Send reply</>}
                    </button>
                    </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── SCHEDULED CONFERENCE VIEW MODAL ── */}
      {activeConferenceViewItem && (
        <div className="s-modal-overlay" onClick={() => setConferenceViewItem(null)}>
          <div className="s-modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="s-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="s-hub-type-badge" style={{ position: "static" }}>{activeConferenceViewItem.type}</span>
                <h3>Conference Details</h3>
              </div>
              <button className="s-modal-close" onClick={() => setConferenceViewItem(null)}><X size={18} /></button>
            </div>
            <div className="s-modal-body">
              <div className="s-case-status-banner" style={{ background: "#dbeafe", borderColor: "#93c5fd" }}>
                <span className="s-status-badge" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
                  <Calendar size={12} /> Case #{activeConferenceViewItem.id}
                </span>
                <p style={{ color: "#1e3a8a", margin: 0 }}>Your scheduled conference for this case is shown below.</p>
              </div>

              <div className="s-case-details-box" style={{ marginTop: 16 }}>
                <div className="s-case-detail-grid">
                  <div><label>Case</label><span>#{activeConferenceViewItem.id}</span></div>
                  <div><label>Status</label><span className={`s-conference-status ${activeConferenceViewItem.status.toLowerCase().replace(/\s/g, "-")}`}>
                    {activeConferenceViewItem.status === "Completed" ? "✓ Completed" : activeConferenceViewItem.status === "Cancelled" ? "✕ Cancelled" : activeConferenceViewItem.status === "No-show" ? "⚠ No-show" : activeConferenceViewItem.status}
                  </span></div>
                  <div><label>Date</label><span>{formatConferenceDate(activeConferenceViewItem.date, language)}</span></div>
                  <div><label>Time</label><span>{formatConferenceTime(activeConferenceViewItem.time) || "Time TBD"}</span></div>
                  <div style={{ gridColumn: "1 / -1" }}><label>Location</label><span>{activeConferenceViewItem.location || "Location TBD"}</span></div>
                </div>
                {(activeConferenceViewItem.rescheduledFrom || activeConferenceViewItem.previousSchedule?.date) && (
                  <p className="s-conference-previous">
                    Rescheduled from {activeConferenceViewItem.rescheduledFrom || activeConferenceViewItem.previousSchedule.date}
                  </p>
                )}
                {activeConferenceViewItem.notes && (
                  <div style={{ marginTop: 12 }}>
                    <label className="s-case-detail-label">Agenda / Notes</label>
                    <p className="s-case-detail-text">{activeConferenceViewItem.notes}</p>
                  </div>
                )}
                {activeConferenceViewItem.status === "Reschedule Requested" && (
                  <p className="s-conference-info">Your reschedule request has been sent to the Prefect. Please wait for confirmation.</p>
                )}
                {activeConferenceViewItem.status === "Cancellation Requested" && (
                  <p className="s-conference-info">Your cancellation request has been sent to the Prefect for review.</p>
                )}
                {["Scheduled", "Today", "Overdue", "Rescheduled"].includes(activeConferenceViewItem.status) && (
                  <>
                    <p className="s-conference-info">
                      {activeConferenceViewItem.status === "Overdue"
                        ? "This conference date has passed. Contact the Prefect if you need assistance."
                        : "Please attend the conference at the scheduled date and time."}
                    </p>
                    <div className="s-conference-actions">
                      <button type="button" onClick={() => { setConferenceRequestType("reschedule"); setConferenceRequestReason(""); }}>
                        Request Reschedule
                      </button>
                      <button type="button" className="secondary" onClick={() => { setConferenceRequestType("cancellation"); setConferenceRequestReason(""); }}>
                        Request Cancellation
                      </button>
                    </div>
                  </>
                )}
                {activeConferenceViewItem.status === "Completed" && <p className="s-conference-info completed">This conference has been completed.</p>}
                {activeConferenceViewItem.status === "Cancelled" && <p className="s-conference-info">This conference was cancelled by the Prefect.</p>}
                {activeConferenceViewItem.status === "No-show" && <p className="s-conference-info">This conference was marked as no-show by the Prefect.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
      {conferenceRequestType && activeConferenceViewItem && (
        <div className="s-modal-overlay s-conference-request-overlay" onClick={() => setConferenceRequestType(null)}>
          <div className="s-modal-box s-conference-request-modal" onClick={(event) => event.stopPropagation()}>
            <div className="s-modal-header">
              <div>
                <h3>{conferenceRequestType === "reschedule" ? "Request Reschedule" : "Cancel Conference?"}</h3>
                <p>Case #{activeConferenceViewItem.id}</p>
              </div>
              <button className="s-modal-close" onClick={() => setConferenceRequestType(null)} aria-label="Close request">
                <X size={18} />
              </button>
            </div>
            <form className="s-modal-body" onSubmit={handleSubmitConferenceRequest}>
              {conferenceRequestType === "reschedule" ? (
                <>
                  <p className="s-conference-confirm-text">Why do you need to reschedule?</p>
                  <label className="s-conference-request-label" htmlFor="conference-request-reason">Message (optional)</label>
                  <textarea
                    id="conference-request-reason"
                    value={conferenceRequestReason}
                    onChange={(event) => setConferenceRequestReason(event.target.value)}
                    placeholder="Please provide a reason for your request."
                    rows={4}
                  />
                </>
              ) : (
                <>
                  <p className="s-conference-confirm-text">Are you sure you want to request cancellation of this conference?</p>
                  <label className="s-conference-request-label" htmlFor="conference-cancellation-reason">Reason (optional)</label>
                  <textarea
                    id="conference-cancellation-reason"
                    value={conferenceRequestReason}
                    onChange={(event) => setConferenceRequestReason(event.target.value)}
                    placeholder="Please provide a reason for your request."
                    rows={3}
                  />
                </>
              )}
              <div className="s-conference-request-actions">
                <button type="button" className="s-cancel-btn" onClick={() => setConferenceRequestType(null)}>
                  {conferenceRequestType === "reschedule" ? "Cancel" : "Keep Conference"}
                </button>
                <button type="submit" className="s-submit-btn" disabled={conferenceRequestSaving}>
                  {conferenceRequestSaving
                    ? "Submitting..."
                    : conferenceRequestType === "reschedule" ? "Submit Reschedule Request" : "Submit Cancellation Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── HUB VIEWER MODAL ── */}
      {hubViewItem && (
        <div className="s-modal-overlay" onClick={() => setHubViewItem(null)}>
          <div className="s-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="s-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="s-hub-type-badge" style={{ position: "static" }}>{hubViewItem.type}</span>
                <h3>{hubViewItem.title}</h3>
              </div>
              <button className="s-modal-close" onClick={() => setHubViewItem(null)}><X size={18} /></button>
            </div>
            <div className="s-modal-body">
              {hubViewItem.type === "video" && hubViewItem.videoUrl && (
                <div className="s-modal-video">
                  <iframe src={hubViewItem.videoUrl} title={hubViewItem.title} frameBorder="0" allowFullScreen loading="lazy"
                    style={{ width: "100%", height: "360px", borderRadius: 10 }} />
                </div>
              )}
              {hubViewItem.fileData && (
                <img src={hubViewItem.fileData} alt={hubViewItem.title}
                  decoding="async"
                  style={{ width: "100%", borderRadius: 10, marginBottom: 14, objectFit: "contain", maxHeight: 360 }} />
              )}
              {hubViewItem.imageLoading && <p>Loading image…</p>}
              {hubViewItem.imageError && <p role="alert">Could not load image: {hubViewItem.imageError}</p>}
              {hubViewItem.desc && <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.7 }}>{hubViewItem.desc}</p>}
              {hubViewItem.link && hubViewItem.link !== "#" && (
                <a href={hubViewItem.link} target="_blank" rel="noreferrer" className="s-hub-link" style={{ display: "inline-flex", marginTop: 14 }}>
                  Open Link <ExternalLink size={13} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FORGOT PASSWORD MODAL ── */}
      {forgotOpen && (
        <div className="s-modal-overlay" onClick={() => { setForgotOpen(false); setForgotSent(false); setForgotEmail(""); }}>
          <div className="s-modal-box" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="s-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Lock size={18} color="var(--s-accent)" />
                <h3>Reset Password</h3>
              </div>
              <button className="s-modal-close" onClick={() => { setForgotOpen(false); setForgotSent(false); setForgotEmail(""); }}>
                <X size={18} />
              </button>
            </div>
            <div className="s-modal-body">
              {forgotSent ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <CheckCircle size={48} color="#22c55e" style={{ marginBottom: 12 }} />
                  <h4 style={{ color: "#16a34a", marginBottom: 8, fontSize: 17, fontWeight: 800 }}>Request Sent!</h4>
                  <p style={{ color: "#64748b", fontSize: 14 }}>
                    A password reset request has been sent to your school guidance counselor. Please visit the office or wait for an email response.
                  </p>
                </div>
              ) : (
                <>
                  <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
                    Since this is a school system, password resets are handled by the school admin. Enter your email and we'll forward a reset request.
                  </p>
                  <div className="s-form-group">
                    <label>Your School Email</label>
                    <input type="email" className="s-pass-input" placeholder="student@gmail.com"
                      value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                      style={{ width: "100%" }} />
                  </div>
                  <button className="s-submit-btn" style={{ marginTop: 14, width: "100%" }}
                    onClick={() => { if (forgotEmail.trim()) setForgotSent(true); }}>
                    Send Reset Request
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FLOATING ACTION BUTTON ── */}
      {activeTab !== "report" && (
        <button
          className="s-fab"
          onClick={() => setActiveTab("report")}
          title="Report an Incident"
          aria-label="Report an Incident"
        >
          <FileText size={22} />
          <span className="s-fab-label">Report Incident</span>
        </button>
      )}

    </div>
  ), language);
}