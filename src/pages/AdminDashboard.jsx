import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Chart, BarController, BarElement, LineController, LineElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Filler,
} from "chart.js";
import "../styles/StudentDashboard.css";
import "../styles/AdminDashboard.css";

Chart.register(
  BarController, BarElement, LineController, LineElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Filler
);

import logo from "../assets/logo.png";
import bg   from "../assets/cnhs.jpg";
import { signOut } from "../lib/auth";

import {
  LayoutDashboard, Search, FileText, Image, Shield, BookOpen, User, X,
  Filter, Plus, Trash2, Edit, AlertTriangle, CheckCircle, FileBarChart,
  TrendingUp, Clock, Download, Calendar, Bell, ArrowUpRight,
  ChevronLeft, ChevronRight, MapPin, LogOut,
  Paperclip, ZoomIn, Upload, ChevronDown, GraduationCap, UserCheck, Menu, Eye,
  History, Send,
} from "lucide-react";

import {
  getReports, updateReportStatus, reviewConferenceRequest,
  updateConferenceSchedule, cancelConference,
  getAwarenessContent, addAwarenessContent, updateAwarenessContent, deleteAwarenessContent,
  getAdminNotifications, markAdminNotifRead, markAllAdminNotifRead,
  LOCATION_META, getCustomLocations, addCustomLocation, deleteCustomLocation,
  getGradeSections, addGradeSection, updateGradeSection, deleteGradeSection,
  GRADE_OPTIONS,
  getStudentAccounts, getPendingStudentAccounts, getPendingStudentAccountCount, approveStudentAccount, declineStudentAccount,
  getStudentOffenseRecords, downloadStudentOffenseRecords,
  getStudentIdImagesForAdmin, getReportDetails, getReportEvidence, getUnreadNotificationCount,
  saveReportConferenceFindings,
  getUnconfirmedSignups, resendConfirmationEmail,
  downloadCSV, downloadDOCX, downloadXLSX,
} from "../data/store";
import StudentOffenseRecords from "../components/admin/StudentOffenseRecords";
import ConferenceManagement from "../components/admin/ConferenceManagement";
import { INTERVENTION_PLAN_FIELDS, parseInterventionPlan } from "../lib/studentOffensePlan";
import { optimizeImageFile } from "../lib/imageOptimization";
import { getYouTubeThumbnail } from "../lib/videoUtils";

const DASHBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REPORT_PAGE_SIZE = 30;
const ACCOUNT_PAGE_SIZE = 25;
const ANALYTICS_LOCATION_COLORS = {
  inside: { bar: "#3977B8", text: "#285B91", soft: "#EEF5FD", border: "#C9DDF2" },
  outside: { bar: "#C84B59", text: "#A63846", soft: "#FFF1F2", border: "#F0CDD1" },
};

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function prepareAwarenessMedia(file) {
  if (!file.type.startsWith("image/")) {
    if (file.size > 800_000) {
      throw new Error("Documents must be 800 KB or smaller. Compress the file or choose a smaller one.");
    }
    const data = await fileToDataUrl(file);
    return { thumbnail: data, fullImage: data };
  }

  const full = await optimizeImageFile(file, {
    maxDimension: 1280,
    maxSizeBytes: 800_000,
    forceWebp: true,
  });
  if (full.size > 800_000) {
    throw new Error("The optimized image is still over 800 KB. Choose a smaller image.");
  }
  const thumbnail = await optimizeImageFile(full, {
    maxDimension: 320,
    maxSizeBytes: 100_000,
    forceWebp: true,
  });
  if (thumbnail.size > 100_000) {
    throw new Error("The image preview is still over 100 KB. Choose a smaller image.");
  }
  return {
    thumbnail: await fileToDataUrl(thumbnail),
    fullImage: await fileToDataUrl(full),
  };
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

/** Returns count of each type from the reports array */
function getTypeCounts(reports) {
  const counts = {};
  reports.forEach((r) => {
    const t = r.type || "Others";
    counts[t] = (counts[t] || 0) + 1;
  });
  return counts;
}

function formatReportNumber(id) {
  const numericId = Number(id);
  return Number.isInteger(numericId) && numericId >= 0
    ? `CNHS-${String(numericId).padStart(4, "0")}`
    : String(id ?? "—");
}

/** Returns last N months as { label, count } from reports */
function getMonthlyTrend(reports, n = 6) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString("default", { month: "short" }),
      year:  d.getFullYear(),
      month: d.getMonth(),
      count: 0,
    });
  }
  reports.forEach((r) => {
    if (!r.date) return;
    const d = new Date(r.date);
    const slot = months.find((m) => m.year === d.getFullYear() && m.month === d.getMonth());
    if (slot) slot.count++;
  });
  return months;
}

/** Recommendation text based on dominant type */
function getRecommendations(typeCounts, total) {
  if (total === 0) return ["No incidents on record yet. Keep monitoring.", "Promote the Awareness Hub resources.", "Encourage students to report anonymously."];
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const [topType, topCount] = sorted[0] || ["—", 0];
  const pct = Math.round((topCount / total) * 100);
  const recs = [];
  if (topType === "Physical") {
    recs.push(`Physical bullying is the #1 reported type (${pct}%). Increase supervision in key areas (cafeteria, hallways, playground).`);
    recs.push("Consider deploying peer mediators and conducting a school-wide assembly on physical boundaries.");
  } else if (topType === "Cyber") {
    recs.push(`Cyberbullying accounts for ${pct}% of reports. Conduct digital literacy and netiquette sessions.`);
    recs.push("Coordinate with ICT teachers to include online safety in the curriculum.");
  } else if (topType === "Verbal") {
    recs.push(`Verbal/emotional bullying is most common (${pct}%). Schedule guidance counseling group sessions.`);
    recs.push("Run empathy-building activities in advisory periods.");
  } else {
    recs.push(`${topType} incidents dominate at ${pct}%. Review school policies relevant to this category.`);
  }
  if (total >= 5) recs.push("High volume of reports — consider forming a dedicated Student Safety Committee.");
  recs.push("Update the Awareness Hub with targeted resources matching current incident trends.");
  return recs;
}

// ─── Time formatter: "17:00" → "5:00 PM" ─────────────────────────────────────
function to12Hour(timeStr) {
  if (!timeStr) return "—";
  const raw = String(timeStr).trim();
  if (/AM|PM/i.test(raw)) return raw;
  const [h, m] = raw.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return raw;
  const period = h >= 12 ? "PM" : "AM";
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}
function formatConferenceDate(dateValue) {
  if (!dateValue) return "—";
  const value = String(dateValue);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function formatGrade(grade) {
  return grade ? String(grade).replace(/^grade\s*/i, "").trim() : "";
}
function getAccountGradeClass(grade) {
  const gradeNumber = formatGrade(grade);
  return ["7", "8", "9", "10"].includes(gradeNumber) ? `grade-${gradeNumber}` : "other";
}
function cleanDisplayValue(value) {
  const cleaned = value == null ? "" : String(value).trim();
  return cleaned && cleaned.toLowerCase() !== "none" ? cleaned : "";
}
function hexToRgba(hex, alpha = 1) {
  const h = hex.replace("#", "");
  const r = parseInt(h.length === 3 ? h[0] + h[0] : h.substring(0, 2), 16);
  const g = parseInt(h.length === 3 ? h[1] + h[1] : h.substring(2, 4), 16);
  const b = parseInt(h.length === 3 ? h[2] + h[2] : h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Inline Donut / Progress bars ─────────────────────────────────────────────
const TYPE_COLORS = {
  Physical: "#C83F4B",
  Verbal:   "#C66A08",
  Cyber:    "#3F5FE0",
  Social:   "#078773",
  Property: "#9B6900",
  Others:   "#7950C4",
};

const EXPORT_INCIDENT_TYPES = ["Physical", "Verbal", "Cyber", "Social", "Property", "Others"];
const EXPORT_STATUSES = ["Pending", "Under Investigation", "Resolved"];
const EXPORT_OFFENSE_TYPES = ["Verbal", "Physical", "Social", "Cyber"];
const EXPORT_OFFENSE_LEVELS = [
  ["", "All offenses"],
  ["1", "First offense"],
  ["2", "Second offense"],
  ["3", "Third offense"],
  ["4+", "Subsequent offenses"],
];

function nextExportSelection(selected, value, options) {
  return selected === null
    ? options.filter((option) => option !== value)
    : selected.includes(value)
      ? selected.filter((option) => option !== value)
      : [...selected, value];
}

function ExportChecklist({ title, options, selected, setSelected, className = "" }) {
  return (
    <>
      <div className="analytics-export-filter-heading">
        <span>{title}</span>
        <div className="analytics-export-filter-actions">
          <button type="button" onClick={() => setSelected(null)}>All</button>
          <button type="button" onClick={() => setSelected([])}>Clear</button>
        </div>
      </div>
      {options.length > 0 ? (
        <div className={`analytics-export-checklist ${className}`}>
          {options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected === null || selected.includes(option)}
                onChange={() => setSelected((current) => nextExportSelection(current, option, options))}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="analytics-export-empty">No values available</p>
      )}
    </>
  );
}

function getLocationCounts(reports, customLocations = []) {
  const counts = {};
  reports.forEach((r) => {
    const loc = r.location || "Other";
    const lower = loc.toLowerCase();

    // Admin-defined places take priority: exact name match, or any of their keywords.
    const customMatch = customLocations.find((c) =>
      lower === c.key.toLowerCase() ||
      (c.keywords || []).some((kw) => kw && lower.includes(kw.toLowerCase()))
    );

    const normalized = customMatch ? customMatch.key :
      /caf[eé]|canteen/i.test(loc)                                      ? "Cafeteria/Canteen" :
      /hallway|corridor/i.test(loc)                                      ? "Hallway"           :
      /comfort|restroom|bathroom|toilet|\bcr\b/i.test(loc)              ? "Comfort Room"      :
      /gym/i.test(loc)                                                   ? "Gymnasium"         :
      /library/i.test(loc)                                               ? "Library"           :
      /stair/i.test(loc)                                                 ? "Staircase"         :
      /entrance|lobby/i.test(loc)                                        ? "School Entrance"   :
      /near.*gate|outside.*gate|gate.*outside/i.test(loc)                ? "Near School Gate"  :
      /street|road/i.test(loc)                                           ? "Street/Road"       :
      /online|cyber|internet|social|facebook|tiktok|discord/i.test(loc) ? "Online/Cyber"      :
      /classroom|room\s*\d/i.test(loc)                                   ? "Classroom"         :
      loc;
    counts[normalized] = (counts[normalized] || 0) + 1;
  });
  return counts;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const unseenReportsStorageKey = `adminUnseenReports:v3:${localStorage.getItem("studentId") || "unknown"}`;
  const savedReportViewState = (() => {
    try {
      const savedState = JSON.parse(localStorage.getItem(unseenReportsStorageKey) || "null");
      return savedState && Array.isArray(savedState.knownIds) && Array.isArray(savedState.unseenIds)
        ? savedState
        : null;
    } catch (error) {
      console.error("Could not load report view markers:", error);
      return null;
    }
  })();
  const [unseenReportIds, setUnseenReportIds] = useState(
    () => new Set(savedReportViewState?.unseenIds || [])
  );
  const unseenReportIdsRef = useRef(new Set(savedReportViewState?.unseenIds || []));
  const knownReportIdsRef = useRef(new Set(savedReportViewState?.knownIds || []));
  const hasLoadedInitialReportsRef = useRef(!!savedReportViewState);
  const reportRefreshRef = useRef({ refreshedAt: 0, completeList: false });
  const [activeTab,     setActiveTab]     = useState("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen,   setProfileOpen]   = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [notifLoading,  setNotifLoading]  = useState(false);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [caseFilter,    setCaseFilter]    = useState("Pending");

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    setIncidentsPage(0);
  };
  const handleCaseFilterChange = (value) => {
    setCaseFilter(value);
    setIncidentsPage(0);
  };
  const handleMultiFilterChange = (setter, value) => {
    setter(value);
    setRecordsPage(0);
  };
  const handleAdminTabSelect = (tab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  // Manage Incident modal
  const [showUpdateModal,      setShowUpdateModal]      = useState(false);
  const [selectedReport,       setSelectedReport]       = useState(null);
  const [newStatus,            setNewStatus]            = useState("");
  const [adminNotes,           setAdminNotes]           = useState("");
  const [additionalInfoRequest, setAdditionalInfoRequest] = useState("");
  const [additionalInfoSaving, setAdditionalInfoSaving] = useState(false);
  const [conferenceDate,       setConferenceDate]       = useState("");
  const [conferenceTime,       setConferenceTime]       = useState("");
  const [conferenceLocation,   setConferenceLocation]   = useState("");
  const [conferenceNotes,      setConferenceNotes]      = useState("");
  const [conferenceFindingsDraft, setConferenceFindingsDraft] = useState("");
  const [conferenceFindingsSaving, setConferenceFindingsSaving] = useState(false);
  const [manageFieldErrors,    setManageFieldErrors]    = useState({});
  const [conferenceEditing,    setConferenceEditing]    = useState(false);
  const [conferenceRescheduleReason, setConferenceRescheduleReason] = useState("");
  const [conferenceCanceling,  setConferenceCanceling]  = useState(false);
  const [conferenceCancelReason, setConferenceCancelReason] = useState("");
  const [toast,                setToast]                = useState(null);

  // Evidence lightbox
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [conferenceActionSaving, setConferenceActionSaving] = useState(false);

  // Keep the common incident types visible together while retaining paging for custom types.
  const TYPE_BREAKDOWN_PAGE_SIZE = 6;
  const [typeBreakdownPage, setTypeBreakdownPage] = useState(0);

  // Incidents tab pagination
  const INCIDENTS_PAGE_SIZE = 6;
  const [incidentsPage, setIncidentsPage] = useState(0);

  // Location Breakdown pagination
  const LOCATION_PAGE_SIZE = 7;
  const [locationPage, setLocationPage] = useState(0);

  // Incident Records table pagination (Analytics tab)
  const RECORDS_PAGE_SIZE = 10;
  const [recordsPage, setRecordsPage] = useState(0);
  const [recordsSearch, setRecordsSearch] = useState("");
  const [recordsStatus, setRecordsStatus] = useState("All");

  // Multi-filter state
  const [mfType,    setMfType]    = useState([]);
  const [mfGrade,   setMfGrade]   = useState("All");
  const [mfGender,  setMfGender]  = useState("All");
  const [mfSection, setMfSection] = useState("All");
  const [mfStatus,  setMfStatus]  = useState("All");
  const [mfMonth,   setMfMonth]   = useState("All");
  const [mfYear,    setMfYear]    = useState("All");
  const [exportTypes, setExportTypes] = useState(null);
  const [exportStatuses, setExportStatuses] = useState(null);
  const [exportGradeFilter, setExportGradeFilter] = useState(null);
  const [exportGenderFilter, setExportGenderFilter] = useState(null);
  const [exportSectionFilter, setExportSectionFilter] = useState(null);
  const [exportMonthFilter, setExportMonthFilter] = useState(null);
  const [exportYearFilter, setExportYearFilter] = useState(null);
  const [analyticsView, setAnalyticsView] = useState("overview");
  const [exportDataset, setExportDataset] = useState("incidents");
  const exportReportsSelected = exportDataset === "incidents";
  const exportOffensesSelected = exportDataset === "offenses";
  const [exportSearch, setExportSearch] = useState("");
  const [exportOffenseFilters, setExportOffenseFilters] = useState({
    search: "", grade: "", section: "", offenseNumber: "", type: "",
    dateFrom: "", dateTo: "", action: "", sort: "recent",
  });
  const [exportOffensePreview, setExportOffensePreview] = useState({
    records: [], total: 0, options: { grades: [], sections: [], actions: [] },
  });
  const [exportOffenseLoading, setExportOffenseLoading] = useState(false);
  const [exportOffenseError, setExportOffenseError] = useState("");
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [exportError, setExportError] = useState("");
  const [exportSelectedIds, setExportSelectedIds] = useState(() => new Set());
  const [previewOffenseDetail, setPreviewOffenseDetail] = useState(null);
  const exportOffenseRequestRef = useRef(0);
  const chartCanvasRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const trendCanvasRef = useRef(null);
  const trendChartInstanceRef = useRef(null);

  // Awareness modal
  const [showAwarenessModal, setShowAwarenessModal] = useState(false);
  const [editingAwareness,   setEditingAwareness]   = useState(null);
  const [aForm, setAForm] = useState({
    type: "infographic", title: "", desc: "", link: "#", videoUrl: "",
    thumbnailData: "", fullImageData: "", thumbnailPath: "", fullImagePath: "",
  });
  const [aFilePreview, setAFilePreview] = useState(null);

  // Location Breakdown customization panel
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locForm, setLocForm] = useState({ name: "", zone: "inside", keywords: "" });

  // Grade & Section management panel
  const [sectionMgmtGrade, setSectionMgmtGrade] = useState("Grade 7");
  const [newSectionName,   setNewSectionName]   = useState("");
  const [newSectionAdviser, setNewSectionAdviser] = useState("");
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingSectionName, setEditingSectionName] = useState("");
  const [editingSectionAdviser, setEditingSectionAdviser] = useState("");

  // Live data
  const [incidents,        setIncidents]        = useState([]);
  const [hasMoreIncidents, setHasMoreIncidents] = useState(false);
  const [loadingMoreIncidents, setLoadingMoreIncidents] = useState(false);
  const [awarenessList,    setAwarenessList]    = useState([]);
  const [notifications,    setNotifications]    = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingMoreNotifications, setLoadingMoreNotifications] = useState(false);
  const [customLocations,  setCustomLocations]  = useState([]);
  const [gradeSections,    setGradeSections]    = useState([]);
  const [studentAccounts,    setStudentAccounts]    = useState([]);
  const [pendingAccounts, setPendingAccounts] = useState([]);
  const [hasMoreStudentAccounts, setHasMoreStudentAccounts] = useState(false);
  const [hasMorePendingAccounts, setHasMorePendingAccounts] = useState(false);
  const [studentAccountPage, setStudentAccountPage] = useState(0);
  const [pendingAccountPage, setPendingAccountPage] = useState(0);
  const [studentAccountsLoading, setStudentAccountsLoading] = useState(true);
  const [studentAccountsError, setStudentAccountsError] = useState("");
  const [pendingAccountsError, setPendingAccountsError] = useState("");
  const [studentIdViewer, setStudentIdViewer] = useState(null);
  const [pendingAccountCount, setPendingAccountCount] = useState(0);
  const [unconfirmedSignups, setUnconfirmedSignups] = useState([]);
  const [unconfirmedError,   setUnconfirmedError]   = useState("");

  const profileRef = useRef(null);
  const notifRef   = useRef(null);
  const adminContentRef = useRef(null);

  useEffect(() => {
    if (!exportOffensesSelected) return undefined;
    const requestId = ++exportOffenseRequestRef.current;
    let active = true;
    setExportOffenseLoading(true);
    setExportOffenseError("");
    setExportOffensePreview((current) => ({ ...current, records: [], total: 0 }));
    const timer = window.setTimeout(() => {
      getStudentOffenseRecords({ ...exportOffenseFilters, limit: 10, offset: 0 })
        .then((result) => {
          if (!active || requestId !== exportOffenseRequestRef.current) return;
          setExportOffensePreview(result);
        })
        .catch((error) => {
          if (active && requestId === exportOffenseRequestRef.current) {
            setExportOffenseError(error.message || "Could not load student offense records.");
          }
        })
        .finally(() => {
          if (active && requestId === exportOffenseRequestRef.current) setExportOffenseLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [exportOffensesSelected, exportOffenseFilters]);

  useEffect(() => {
    setExportSelectedIds(new Set());
  }, [
    exportSearch,
    exportTypes,
    exportStatuses,
    exportGradeFilter,
    exportGenderFilter,
    exportSectionFilter,
    exportMonthFilter,
    exportYearFilter,
    exportOffenseFilters,
  ]);

  useEffect(() => {
    if (!previewOffenseDetail) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreviewOffenseDetail(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewOffenseDetail]);

  useEffect(() => {
    if (!exportOffensesSelected || analyticsView !== "export") setPreviewOffenseDetail(null);
  }, [exportOffensesSelected, analyticsView]);

  // Refresh only the data used by the active admin tab, without overlapping requests.
  useEffect(() => {
    const setIfChanged = (setter) => (next) =>
      setter((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const setIncidentsIfChanged       = setIfChanged(setIncidents);
    const setAwarenessListIfChanged   = setIfChanged(setAwarenessList);
    const setCustomLocationsIfChanged = setIfChanged(setCustomLocations);
    const setGradeSectionsIfChanged      = setIfChanged(setGradeSections);
    const setStudentAccountsIfChanged    = setIfChanged(setStudentAccounts);
    const setUnconfirmedSignupsIfChanged = setIfChanged(setUnconfirmedSignups);
    let cancelled = false;
    let refreshing = false;
    let timeoutId;

    async function refresh() {
      if (cancelled || document.hidden || refreshing) return;
      refreshing = true;
      try {
        try {
          const needsReports = ["dashboard", "incidents", "analytics"].includes(activeTab);
          const needsCompleteReportList = activeTab !== "incidents";
          const reportRefreshIsDue = Date.now() - reportRefreshRef.current.refreshedAt >= DASHBOARD_REFRESH_INTERVAL_MS;
          const shouldRefreshReports = needsReports &&
            (reportRefreshIsDue || (needsCompleteReportList && !reportRefreshRef.current.completeList));
          const [incidentsData, unreadNotifications] = await Promise.all([
            shouldRefreshReports
              ? getReports({
                  includeEvidence: false,
                  summaryOnly: true,
                  ...(activeTab === "incidents" ? { limit: REPORT_PAGE_SIZE } : {}),
                })
              : Promise.resolve(null),
            getUnreadNotificationCount(),
          ]);
          if (cancelled) return;
          if (incidentsData) {
            reportRefreshRef.current = {
              refreshedAt: Date.now(),
              completeList: needsCompleteReportList,
            };
            const fetchedReportIds = incidentsData.map((report) => report.id);
            const wasInitialized = hasLoadedInitialReportsRef.current;
            const nextKnownIds = new Set(knownReportIdsRef.current);
            const nextUnseenIds = new Set(unseenReportIdsRef.current);
            if (!wasInitialized) {
              hasLoadedInitialReportsRef.current = true;
            }
            fetchedReportIds.forEach((id) => {
              if (wasInitialized && !nextKnownIds.has(id)) {
                nextUnseenIds.add(id);
              }
              nextKnownIds.add(id);
            });
            const unseenChanged = nextUnseenIds.size !== unseenReportIdsRef.current.size ||
              [...nextUnseenIds].some((id) => !unseenReportIdsRef.current.has(id));
            const knownChanged = nextKnownIds.size !== knownReportIdsRef.current.size;
            knownReportIdsRef.current = nextKnownIds;
            unseenReportIdsRef.current = nextUnseenIds;
            if (unseenChanged) setUnseenReportIds(nextUnseenIds);
            if (knownChanged || unseenChanged || !wasInitialized) {
              try {
                localStorage.setItem(unseenReportsStorageKey, JSON.stringify({
                  knownIds: [...nextKnownIds].slice(-5000),
                  unseenIds: [...nextUnseenIds],
                }));
              } catch (error) {
                console.error("Could not save report view markers:", error);
              }
            }
            setIncidentsIfChanged(incidentsData);
            if (activeTab === "incidents") setHasMoreIncidents(incidentsData.length === REPORT_PAGE_SIZE);
          }
          setUnreadCount(unreadNotifications);
        } catch (err) {
          console.error("Dashboard refresh failed:", err);
        }

        if (["dashboard", "analytics"].includes(activeTab)) {
          try {
            const locationsData = await getCustomLocations();
            if (cancelled) return;
            setCustomLocationsIfChanged(locationsData);
          } catch (err) {
            console.error("getCustomLocations failed:", err);
          }
          if (activeTab === "analytics") {
            try {
              const gradeSectionsData = await getGradeSections();
              if (cancelled) return;
              setGradeSectionsIfChanged(gradeSectionsData);
            } catch (err) {
              console.error("getGradeSections failed:", err);
            }
          }
        } else if (activeTab === "awareness") {
          try {
            const awarenessData = await getAwarenessContent();
            if (cancelled) return;
            setAwarenessListIfChanged(awarenessData);
          } catch (err) {
            console.error("getAwarenessContent failed:", err);
          }
        } else if (activeTab === "sections") {
          try {
            const gradeSectionsData = await getGradeSections();
            if (cancelled) return;
            setGradeSectionsIfChanged(gradeSectionsData);
          } catch (err) {
            console.error("getGradeSections failed:", err);
          }
        } else if (activeTab === "confirmations") {
          try {
            const studentAccountsData = await getStudentAccounts(studentAccountPage, ACCOUNT_PAGE_SIZE);
            if (cancelled) return;
            setStudentAccountsIfChanged(studentAccountsData.accounts);
            setHasMoreStudentAccounts(studentAccountsData.hasMoreAccounts);
            setStudentAccountsError("");
          } catch (err) {
            if (cancelled) return;
            console.error("getStudentAccounts failed:", err.message);
            setStudentAccountsError(err.message);
          } finally {
            if (!cancelled) setStudentAccountsLoading(false);
          }
          try {
            const pendingAccountsData = await getPendingStudentAccounts(pendingAccountPage, ACCOUNT_PAGE_SIZE);
            if (cancelled) return;
            setPendingAccounts(pendingAccountsData.accounts);
            setHasMorePendingAccounts(pendingAccountsData.hasMore);
            setPendingAccountsError("");
          } catch (err) {
            if (cancelled) return;
            console.error("getPendingStudentAccounts failed:", err.message);
            setPendingAccountsError(err.message);
          }
          try {
            const unconfirmedData = await getUnconfirmedSignups();
            if (cancelled) return;
            setUnconfirmedSignupsIfChanged(unconfirmedData);
            setUnconfirmedError("");
          } catch (err) {
            if (cancelled) return;
            console.error("getUnconfirmedSignups failed:", err.message);
            setUnconfirmedError(err.message);
          }
        } else if (activeTab === "dashboard") {
          try {
            const count = await getPendingStudentAccountCount();
            if (cancelled) return;
            setPendingAccountCount(count);
          } catch (err) {
            console.error("getPendingStudentAccountCount failed:", err);
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
  }, [activeTab, unseenReportsStorageKey, studentAccountPage, pendingAccountPage]);

  const handleToggleNotifications = async () => {
    const opening = !notifOpen;
    setNotifOpen(opening);
    if (!opening || notifLoading) return;

    setNotifLoading(true);
    try {
      const currentNotifications = await getAdminNotifications();
      setNotifications(currentNotifications);
      setHasMoreNotifications(currentNotifications.length === 30);
    } catch (error) {
      showToast(`Could not load notifications: ${error.message}`, "error");
    } finally {
      setNotifLoading(false);
    }
  };

  useEffect(() => {
    const close = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current   && !notifRef.current.contains(e.target))   setNotifOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const pendingCases    = incidents.filter((c) => c.status === "Pending");
  const inProgressCases = incidents.filter((c) => c.status === "Under Investigation");
  const resolvedCases   = incidents.filter((c) => c.status === "Resolved");

  const selectedConference = selectedReport?.scheduledConference || {};
  const selectedConferenceStatus = selectedConference.status || (selectedConference.completed ? "Completed" : "Scheduled");
  const hasSelectedConference = !!(
    selectedConference.date || selectedConference.time || selectedConference.location
  );
  const selectedConferenceRequest = selectedConference.request;

  const typeCounts  = getTypeCounts(incidents);
  const monthlyData = useMemo(() => getMonthlyTrend(incidents, 6), [incidents]);
  const recs        = getRecommendations(typeCounts, incidents.length);
  const totalSorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  const locationCounts = getLocationCounts(incidents, customLocations);
  const allLocationMeta = [...LOCATION_META, ...customLocations];
  const locationSorted = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]);
  const topLocation    = locationSorted[0]?.[0] || null;

  // Multi-filter computed
  const allGrades   = GRADE_OPTIONS;
  const allGenders  = [...new Set(incidents.filter(r => !r.isAnonymous && r.reporterSex).map(r => r.reporterSex))].sort();
  const allSections = [...new Set([
    ...gradeSections.map(({ section }) => section),
    ...incidents.filter((r) => !r.isAnonymous && r.reporterSection).map((r) => r.reporterSection),
  ])].sort((a, b) => a.localeCompare(b));
  const exportSections = exportGradeFilter === null
    ? allSections
    : [...new Set([
      ...gradeSections
        .filter(({ grade }) => exportGradeFilter.includes(grade))
        .map(({ section }) => section),
      ...incidents
        .filter((report) => exportGradeFilter.includes(report.reporterGrade) && report.reporterSection)
        .map((report) => report.reporterSection),
    ])].sort((a, b) => a.localeCompare(b));
  const exportOffenseSections = [...new Set(exportOffensePreview.options.sections
    .filter((item) => !exportOffenseFilters.grade || item.grade === exportOffenseFilters.grade)
    .map((item) => item.section)
  )].sort((a, b) => a.localeCompare(b));
  const activeIncidentExportFilters = [
    exportSearch.trim(),
    exportTypes !== null,
    exportStatuses !== null,
    exportGradeFilter !== null,
    exportGenderFilter !== null,
    exportSectionFilter !== null,
    exportMonthFilter !== null,
    exportYearFilter !== null,
  ].filter(Boolean).length;
  const activeOffenseExportFilters = Object.entries(exportOffenseFilters)
    .filter(([key, value]) => key !== "sort" && Boolean(value)).length;
  const setExportGrades = (update) => {
    setExportGradeFilter(update);
    setExportSectionFilter(null);
  };
  const sectionsForSelectedGrade = mfGrade === "All"
    ? allSections
    : [...new Set(gradeSections
      .filter(({ grade }) => grade === mfGrade)
      .map(({ section }) => section))].sort((a, b) => a.localeCompare(b));
  const allYears    = [...new Set(incidents.filter(r=>r.date).map(r=>new Date(r.date).getFullYear()))].sort((a,b)=>b-a);
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const mfFiltered = incidents.filter(r => {
    const d = r.date ? new Date(r.date) : null;
    return (
      (mfType.length === 0 || mfType.includes(r.type)) &&
      (mfGrade   === "All" || r.reporterGrade   === mfGrade) &&
      (mfGender  === "All" || r.reporterSex     === mfGender) &&
      (mfSection === "All" || r.reporterSection === mfSection) &&
      (mfStatus  === "All" || r.status          === mfStatus) &&
      (mfMonth   === "All" || (d && MONTH_NAMES[d.getMonth()] === mfMonth)) &&
      (mfYear    === "All" || (d && d.getFullYear().toString() === mfYear))
    );
  });
  const recordsFiltered = mfFiltered.filter((report) => {
    const query = recordsSearch.trim().toLowerCase();
    const matchesSearch = !query || [
      report.id,
      report.type,
      report.isAnonymous ? "anonymous anon" : report.submittedBy,
      report.status,
      report.description,
      report.location,
      report.reporterGrade,
      report.reporterSection,
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
    return matchesSearch && (recordsStatus === "All" || report.status === recordsStatus);
  });

  const mfTypes = useMemo(() => ["Physical","Verbal","Cyber","Social","Property","Others"], []);
  const mfChartData = useMemo(
    () => mfTypes.map((t) => mfFiltered.filter((r) => r.type === t).length),
    [mfFiltered, mfTypes]
  );
  const mfChartColors = useMemo(() => ["#D6455D", "#E07824", "#5368D5", "#159985", "#C28A16", "#8562C8"], []);

  const mfTopIdx   = mfChartData.indexOf(Math.max(...mfChartData));
  const mfTopType  = mfTypes[mfTopIdx];
  const mfTopCount = mfChartData[mfTopIdx] || 0;
  const mfPct      = mfFiltered.length > 0 ? Math.round((mfTopCount/mfFiltered.length)*100) : 0;
  const mfCtx      = [
    mfGrade   !== "All" ? mfGrade   : "",
    mfSection !== "All" ? `Section ${mfSection}` : "",
    mfGender  !== "All" ? `${mfGender} students` : "",
  ].filter(Boolean).join(", ");
  const mfInsight = mfTopCount > 0
    ? `<strong>${mfTopType} bullying</strong> leads with <strong>${mfTopCount} case${mfTopCount!==1?"s":""}</strong>${mfCtx ? ` among ${mfCtx}` : ""} — ${mfPct}% of filtered incidents. Focused intervention is recommended.`
    : incidents.length === 0
      ? "No incidents have been reported yet. Once students start submitting reports, insights will appear here automatically."
      : "No incidents match the current filters. Try adjusting your selection.";

  // ── Chart.js modern vertical bar chart — capsule bars on tracks, glow + pill labels ─
  useEffect(() => {
    if (activeTab !== "analytics") return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null; }
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const mfTypeLabels = ["Physical","Verbal","Cyber","Social","Property","Others"];
    const maxVal = Math.max(...mfChartData, 1);

    // Gradient bar fills — vivid at the base, softened toward the top
    const makeGradient = (alphaTop) => (ctx) => {
      const { chart, dataIndex } = ctx;
      const { ctx: c, chartArea } = chart;
      const base = mfChartColors[dataIndex];
      if (!chartArea) return base;
      const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, hexToRgba(base, alphaTop));
      gradient.addColorStop(1, base);
      return gradient;
    };

    // Full-height rounded "track" behind every bar, like a modern stat-bar / Linear-style chart
    const barTrackPlugin = {
      id: "barTrack",
      beforeDatasetsDraw(chart) {
        const { ctx: c, chartArea } = chart;
        const meta = chart.getDatasetMeta(0);
        c.save();
        meta.data.forEach((bar, i) => {
          const base = mfChartColors[i];
          const width = bar.width * 0.86;
          const x = bar.x - width / 2;
          const top = chartArea.top + 4;
          const bottom = chartArea.bottom;
          const radius = width / 2;
          c.beginPath();
          c.roundRect(x, top, width, bottom - top, radius);
          c.fillStyle = hexToRgba(base, isDark ? 0.14 : 0.08);
          c.fill();
        });
        c.restore();
      },
    };

    // Draws the case count as a small pill badge above each non-zero bar
    const valueLabelsPlugin = {
      id: "valueLabels",
      afterDatasetsDraw(chart) {
        const { ctx: c } = chart;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const value = mfChartData[i];
          if (!value) return;
          const base = mfChartColors[i];
          const text = String(value);
          c.save();
          c.font = "800 12px Poppins, sans-serif";
          const textWidth = c.measureText(text).width;
          const padX = 8, pillH = 20;
          const pillW = Math.max(textWidth + padX * 2, pillH);
          const pillX = bar.x - pillW / 2;
          const pillY = bar.y - pillH - 10;

          c.shadowColor = hexToRgba(base, 0.25);
          c.shadowBlur = 6;
          c.shadowOffsetY = 2;
          c.beginPath();
          c.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
          c.fillStyle = isDark ? hexToRgba(base, 0.22) : hexToRgba(base, 0.12);
          c.fill();

          c.shadowColor = "transparent";
          c.fillStyle = base;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(text, bar.x, pillY + pillH / 2 + 1);
          c.restore();
        });
      },
    };

    chartInstanceRef.current = new Chart(canvas, {
      type: "bar",
      data: {
        labels: mfTypeLabels,
        datasets: [{
          data: mfChartData,
          backgroundColor: makeGradient(0.65),
          hoverBackgroundColor: makeGradient(0.9),
          borderRadius: 100,
          borderSkipped: false,
          barPercentage: 0.42,
          categoryPercentage: 0.7,
        }],
      },
      plugins: [barTrackPlugin, valueLabelsPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 34, bottom: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: isDark ? "#1f2937" : "#0f172a",
            titleColor: "#fff",
            bodyColor: "#e2e8f0",
            padding: 10,
            cornerRadius: 10,
            displayColors: false,
            caretSize: 6,
            titleFont: { size: 12, weight: "700", family: "Nunito" },
            bodyFont: { size: 12, family: "Nunito" },
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} incident${ctx.parsed.y !== 1 ? "s" : ""}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: (ctx) => mfChartColors[ctx.index],
              font: { size: 12.5, weight: "800" },
              autoSkip: false,
              padding: 14,
              callback: (val, idx) => `●  ${mfTypeLabels[idx]}`,
            },
          },
          y: {
            display: false,
            beginAtZero: true,
            suggestedMax: Math.ceil(maxVal * 1.35),
          },
        },
        animation: {
          duration: 700,
          easing: "easeOutQuart",
          delay: (ctx) => ctx.type === "data" ? ctx.dataIndex * 70 : 0,
        },
        onHover: (evt, elements) => {
          evt.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
      },
    });
    return () => { if (chartInstanceRef.current) { chartInstanceRef.current.destroy(); chartInstanceRef.current = null; } };
  }, [activeTab, mfType, mfGrade, mfGender, mfSection, mfStatus, incidents, mfChartColors, mfChartData]);

  // ── Chart.js modern area/line trend chart (Dashboard tab) ────────────────
  useEffect(() => {
    if (activeTab !== "dashboard") return;
    const canvas = trendCanvasRef.current;
    if (!canvas) return;
    if (trendChartInstanceRef.current) { trendChartInstanceRef.current.destroy(); trendChartInstanceRef.current = null; }
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.05)";
    const tickColor = isDark ? "#a1a1aa" : "#64748b";
    const accent = "#07864B";

    trendChartInstanceRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: monthlyData.map((m) => m.label),
        datasets: [{
          data: monthlyData.map((m) => m.count),
          borderColor: accent,
          borderWidth: 2.5,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: accent,
          pointBorderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: accent,
          pointHoverBorderColor: "#ffffff",
          tension: 0.4,
          fill: true,
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return "rgba(7,134,75,0.12)";
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(7,134,75,0.2)");
            gradient.addColorStop(1, "rgba(7,134,75,0)");
            return gradient;
          },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 16, right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: isDark ? "#1f2937" : "#0f172a",
            titleColor: "#fff",
            bodyColor: "#e2e8f0",
            padding: 10,
            cornerRadius: 10,
            displayColors: false,
            titleFont: { size: 12, weight: "700", family: "Nunito" },
            bodyFont: { size: 12, family: "Nunito" },
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} incident${ctx.parsed.y !== 1 ? "s" : ""}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: tickColor, font: { size: 12, weight: "600" } },
          },
          y: {
            grid: { color: gridColor, drawTicks: false },
            border: { display: false },
            ticks: { color: tickColor, font: { size: 11 }, precision: 0, maxTicksLimit: 5 },
            beginAtZero: true,
          },
        },
        animation: { duration: 500, easing: "easeOutQuart" },
      },
    });
    return () => { if (trendChartInstanceRef.current) { trendChartInstanceRef.current.destroy(); trendChartInstanceRef.current = null; } };
  }, [activeTab, incidents, monthlyData]);

  const mfActiveTags = [
    ...mfType.map((type) => ({
      label: type,
      clear: () => handleMultiFilterChange(setMfType, mfType.filter((selectedType) => selectedType !== type)),
    })),
    mfGrade   !== "All" ? { label: mfGrade,   clear: () => handleMultiFilterChange(setMfGrade, "All")   } : null,
    mfGender  !== "All" ? { label: mfGender,  clear: () => handleMultiFilterChange(setMfGender, "All")  } : null,
    mfSection !== "All" ? { label: `Section ${mfSection}`, clear: () => handleMultiFilterChange(setMfSection, "All") } : null,
    mfStatus  !== "All" ? { label: mfStatus,  clear: () => handleMultiFilterChange(setMfStatus, "All")  } : null,
    mfMonth   !== "All" ? { label: mfMonth,   clear: () => handleMultiFilterChange(setMfMonth, "All")   } : null,
    mfYear    !== "All" ? { label: mfYear,    clear: () => handleMultiFilterChange(setMfYear, "All")    } : null,
  ].filter(Boolean);

  const mfHasFilters = mfActiveTags.length > 0;

  const filteredIncidents = incidents.filter((item) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = item.id.toString().includes(q) ||
      item.type.toLowerCase().includes(q) ||
      item.status.toLowerCase().includes(q) ||
      (item.submittedBy || "").toLowerCase().includes(q) && !item.isAnonymous ||
      (item.isAnonymous && "anonymous".includes(q));
    const matchFilter = caseFilter === "All" || item.status === caseFilter;
    return matchSearch && matchFilter;
  });

  const adminName = localStorage.getItem("studentName") || "Administrator";

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const refreshConferenceReports = async () => {
    const refreshedReports = await getReports();
    setIncidents(refreshedReports);
    return refreshedReports;
  };

  const handleOpenManage = async (report) => {
    if (unseenReportIdsRef.current.has(report.id)) {
      const nextUnseenIds = new Set(unseenReportIdsRef.current);
      nextUnseenIds.delete(report.id);
      unseenReportIdsRef.current = nextUnseenIds;
      setUnseenReportIds(nextUnseenIds);
      try {
        localStorage.setItem(unseenReportsStorageKey, JSON.stringify({
          knownIds: [...knownReportIdsRef.current].slice(-5000),
          unseenIds: [...nextUnseenIds],
        }));
      } catch (error) {
        console.error("Could not save viewed report marker:", error);
        showToast("This report was opened, but its viewed status could not be saved.", "error");
      }
    }
    setSelectedReport({ ...report, evidence: [], evidenceLoaded: false, evidenceLoading: false, evidenceError: "" });
    // Skip the redundant "Pending" step — managing a pending report means it's
    // already being acted on, so jump straight to "Under Investigation".
    setNewStatus(report.status === "Pending" ? "Under Investigation" : report.status);
    setAdminNotes(report.adminNotes || "");
    setAdditionalInfoRequest("");
    setConferenceDate(report.scheduledConference?.date || "");
    setConferenceTime(report.scheduledConference?.time || "");
    setConferenceLocation(report.scheduledConference?.location || "");
    setConferenceNotes(report.scheduledConference?.notes || "");
    setConferenceFindingsDraft(report.conferenceFindings || "");
    setConferenceEditing(false);
    setConferenceRescheduleReason("");
    setConferenceCanceling(false);
    setConferenceCancelReason("");
    setManageFieldErrors({});
    setShowUpdateModal(true);
    try {
      const details = await getReportDetails(report.id);
      setConferenceFindingsDraft(details.conferenceFindings || "");
      setSelectedReport((current) => current?.id === report.id
        ? { ...details, evidence: [], evidenceLoaded: false, evidenceLoading: false, evidenceError: "" }
        : current);
    } catch (err) {
      showToast(`Could not load report details: ${err.message}`, "error");
    }
  };

  const loadManagedEvidence = async () => {
    if (!selectedReport || selectedReport.evidenceLoading || selectedReport.evidenceLoaded) return;
    const reportId = selectedReport.id;
    setSelectedReport((current) => current?.id === reportId
      ? { ...current, evidenceLoading: true, evidenceError: "" }
      : current);
    try {
      const evidence = await getReportEvidence(reportId);
      setSelectedReport((current) => current?.id === reportId
        ? { ...current, evidence, evidenceLoaded: true, evidenceLoading: false }
        : current);
    } catch (error) {
      setSelectedReport((current) => current?.id === reportId
        ? { ...current, evidenceLoading: false, evidenceError: error.message }
        : current);
    }
  };

  const refreshManagedIncident = async (updatedReport) => {
    const report = {
      ...updatedReport,
      evidence: selectedReport?.id === updatedReport.id ? selectedReport.evidence : [],
      evidenceLoaded: selectedReport?.id === updatedReport.id && !!selectedReport.evidenceLoaded,
    };
    setIncidents((current) => current.map((item) => item.id === report.id ? report : item));
    setSelectedReport(report);
    setConferenceFindingsDraft(report.conferenceFindings || "");
  };

  const handleSaveConferenceFindings = async () => {
    if (!selectedReport || conferenceFindingsSaving) return;
    setConferenceFindingsSaving(true);
    try {
      const result = await saveReportConferenceFindings(selectedReport.id, conferenceFindingsDraft);
      const updatedReport = { ...selectedReport, conferenceFindings: result.conferenceFindings };
      setSelectedReport(updatedReport);
      setIncidents((current) => current.map((item) => item.id === updatedReport.id ? updatedReport : item));
      showToast("Conference findings saved.");
    } catch (error) {
      showToast(`Could not save conference findings: ${error.message}`, "error");
    } finally {
      setConferenceFindingsSaving(false);
    }
  };

  const handleLoadMoreIncidents = async () => {
    if (loadingMoreIncidents || !hasMoreIncidents) return;
    setLoadingMoreIncidents(true);
    try {
      const next = await getReports({ summaryOnly: true, limit: REPORT_PAGE_SIZE, offset: incidents.length });
      next.forEach((report) => knownReportIdsRef.current.add(report.id));
      try {
        localStorage.setItem(unseenReportsStorageKey, JSON.stringify({
          knownIds: [...knownReportIdsRef.current].slice(-5000),
          unseenIds: [...unseenReportIdsRef.current],
        }));
      } catch (error) {
        console.error("Could not save loaded report markers:", error);
      }
      setIncidents((current) => [...current, ...next]);
      setHasMoreIncidents(next.length === REPORT_PAGE_SIZE);
    } catch (err) {
      showToast(`Could not load more incidents: ${err.message}`, "error");
    } finally {
      setLoadingMoreIncidents(false);
    }
  };

  const handleLoadMoreNotifications = async () => {
    if (loadingMoreNotifications || !hasMoreNotifications) return;
    setLoadingMoreNotifications(true);
    try {
      const next = await getAdminNotifications({ offset: notifications.length });
      setNotifications((current) => [...current, ...next]);
      setHasMoreNotifications(next.length === 30);
    } catch (err) {
      showToast(`Could not load more notifications: ${err.message}`, "error");
    } finally {
      setLoadingMoreNotifications(false);
    }
  };

  const handleSaveManagedConference = async () => {
    if (!selectedReport || conferenceActionSaving) return;
    if (!conferenceDate || !conferenceTime || !conferenceLocation.trim()) {
      showToast("Choose a date, time, and location for the conference.", "error");
      return;
    }
    if (hasSelectedConference && !conferenceRescheduleReason.trim()) {
      showToast("Enter a reason for changing the conference schedule.", "error");
      return;
    }

    setConferenceActionSaving(true);
    try {
      const updatedReport = await updateConferenceSchedule(selectedReport.id, {
        operation: hasSelectedConference ? "reschedule" : "schedule",
        date: conferenceDate,
        time: conferenceTime,
        location: conferenceLocation,
        notes: conferenceNotes,
        reason: conferenceRescheduleReason,
      });
      await refreshManagedIncident(updatedReport);
      setConferenceEditing(false);
      setConferenceRescheduleReason("");
      showToast(hasSelectedConference ? "Conference schedule updated." : "Conference scheduled.");
    } catch (err) {
      showToast(`Could not save conference schedule: ${err.message}`, "error");
    } finally {
      setConferenceActionSaving(false);
    }
  };

  const handleCancelManagedConference = async () => {
    if (!selectedReport || conferenceActionSaving) return;
    if (!conferenceCancelReason.trim()) {
      showToast("Enter a reason for cancelling the conference.", "error");
      return;
    }

    setConferenceActionSaving(true);
    try {
      const updatedReport = await cancelConference(selectedReport.id, conferenceCancelReason);
      await refreshManagedIncident(updatedReport);
      setConferenceCancelReason("");
      setConferenceCanceling(false);
      showToast("Conference cancelled.");
    } catch (err) {
      showToast(`Could not cancel conference: ${err.message}`, "error");
    } finally {
      setConferenceActionSaving(false);
    }
  };

  const handleReviewManagedConferenceRequest = async (decision) => {
    if (!selectedReport || conferenceActionSaving) return;
    const isReschedule = selectedConferenceRequest?.type === "reschedule";
    if (
      decision === "approve" &&
      isReschedule &&
      (!conferenceDate || !conferenceTime || !conferenceLocation.trim())
    ) {
      showToast("Choose the new date, time, and location before approving the reschedule.", "error");
      return;
    }

    setConferenceActionSaving(true);
    try {
      const updatedReport = await reviewConferenceRequest(
        selectedReport.id,
        decision,
        decision === "approve" && isReschedule
          ? {
              date: conferenceDate,
              time: conferenceTime,
              location: conferenceLocation,
              notes: conferenceNotes,
            }
          : undefined
      );
      await refreshManagedIncident(updatedReport);
      showToast(`Conference request ${decision === "approve" ? "approved" : "rejected"}.`);
    } catch (err) {
      showToast(`Could not review conference request: ${err.message}`, "error");
    } finally {
      setConferenceActionSaving(false);
    }
  };

  const handleConfirmUpdate = async () => {
    if (!selectedReport) return;

    const errors = { adminNotes: !adminNotes.trim() };
    if (Object.values(errors).some(Boolean)) {
      setManageFieldErrors(errors);
      showToast("Please add staff notes before updating the status.", "error");
      return;
    }
    setManageFieldErrors({});

    try {
      const updatedReport = await updateReportStatus(selectedReport.id, newStatus, adminNotes);
      setIncidents((current) => current.map((item) => item.id === updatedReport.id ? updatedReport : item));
    } catch (err) {
      showToast("Could not update incident: " + err.message, "error");
      return;
    }
    setIncidents(await getReports());
    const refreshedNotifications = await getAdminNotifications();
    setNotifications(refreshedNotifications);
    setHasMoreNotifications(refreshedNotifications.length === 30);
    setUnreadCount(await getUnreadNotificationCount());
    setShowUpdateModal(false);
    showToast("Incident updated successfully.");
  };

  const handleRequestMoreInfo = async () => {
    if (!selectedReport || additionalInfoSaving) return;
    const request = additionalInfoRequest.trim();
    if (!request) {
      showToast("Explain what proof or information the student should provide.", "error");
      return;
    }

    setAdditionalInfoSaving(true);
    try {
      const updatedReport = await updateReportStatus(selectedReport.id, "More Information Requested", request);
      setIncidents((current) => current.map((item) => item.id === updatedReport.id ? updatedReport : item));
      setSelectedReport((current) => current?.id === updatedReport.id ? updatedReport : current);
      setIncidents(await getReports());
      const refreshedNotifications = await getAdminNotifications();
      setNotifications(refreshedNotifications);
      setHasMoreNotifications(refreshedNotifications.length === 30);
      setUnreadCount(await getUnreadNotificationCount());
      setAdditionalInfoRequest("");
      setShowUpdateModal(false);
      showToast("Request sent. The student can now reply with information and proof.");
    } catch (error) {
      showToast(`Could not send request: ${error.message}`, "error");
    } finally {
      setAdditionalInfoSaving(false);
    }
  };

  const openNewAwareness = () => {
    setEditingAwareness(null);
    setAForm({
      type: "infographic", title: "", desc: "", link: "#", videoUrl: "",
      thumbnailData: "", fullImageData: "", thumbnailPath: "", fullImagePath: "",
    });
    setAFilePreview(null);
    setShowAwarenessModal(true);
  };

  const openEditAwareness = (item) => {
    setEditingAwareness(item.id);
    setAForm({
      type: item.type,
      title: item.title,
      desc: item.desc || "",
      link: item.link || "#",
      videoUrl: item.videoUrl || "",
      thumbnailPath: item.thumbnailPath || "",
      fullImagePath: item.fullImagePath || "",
    });
    setAFilePreview(item.thumbnail || null);
    setShowAwarenessModal(true);
  };

  const handleSaveAwareness = async () => {
    if (!aForm.title.trim()) return;
    try {
      if (editingAwareness !== null) await updateAwarenessContent(editingAwareness, aForm);
      else await addAwarenessContent(aForm);
    } catch (err) {
      showToast("Could not save content: " + err.message, "error");
      return;
    }
    setAwarenessList(await getAwarenessContent());
    setShowAwarenessModal(false);
  };

  const handleDeleteAwareness = async (id) => {
    if (!window.confirm("Delete this content?")) return;
    await deleteAwarenessContent(id);
    setAwarenessList(await getAwarenessContent());
  };

  const openAddLocation = () => {
    setLocForm({ name: "", zone: "inside", keywords: "" });
    setShowLocationModal(true);
  };

  const handleSaveLocation = async () => {
    const result = await addCustomLocation({
      name:     locForm.name,
      zone:     locForm.zone,
      keywords: locForm.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    });
    if (!result.success) { showToast(result.error, "error"); return; }
    setCustomLocations(await getCustomLocations());
    setShowLocationModal(false);
    showToast(`"${result.location.key}" added to Location Breakdown.`);
  };

  const handleDeleteLocation = async (key) => {
    if (!window.confirm(`Remove "${key}" from custom places?`)) return;
    await deleteCustomLocation(key);
    setCustomLocations(await getCustomLocations());
  };

  const handleAddSection = async () => {
    const result = await addGradeSection({
      grade: sectionMgmtGrade,
      section: newSectionName,
      adviser: newSectionAdviser,
    });
    if (!result.success) { showToast(result.error, "error"); return; }
    setGradeSections(await getGradeSections());
    setNewSectionName("");
    setNewSectionAdviser("");
    showToast(`"${result.section.section}" added to ${sectionMgmtGrade} with adviser ${result.section.adviser}.`);
  };

  const handleDeleteSection = async (id, name) => {
    if (!window.confirm(`Remove "${name}" from ${sectionMgmtGrade}?`)) return;
    await deleteGradeSection(id);
    setGradeSections(await getGradeSections());
  };

  const handleSaveSection = async (id, grade) => {
    const result = await updateGradeSection(id, editingSectionName, grade, editingSectionAdviser);
    if (!result.success) { showToast(result.error, "error"); return; }
    setGradeSections(await getGradeSections());
    setEditingSectionId(null);
    setEditingSectionName("");
    setEditingSectionAdviser("");
    showToast(`Section renamed to "${result.section.section}".`);
  };

  const refreshStudentAccountPages = async () => {
    const [accounts, pending] = await Promise.all([
      getStudentAccounts(studentAccountPage, ACCOUNT_PAGE_SIZE),
      getPendingStudentAccounts(pendingAccountPage, ACCOUNT_PAGE_SIZE),
    ]);
    setStudentAccounts(accounts.accounts);
    setHasMoreStudentAccounts(accounts.hasMoreAccounts);
    setPendingAccounts(pending.accounts);
    setHasMorePendingAccounts(pending.hasMore);
    setPendingAccountCount(await getPendingStudentAccountCount());
    setStudentAccountsError("");
    setPendingAccountsError("");
    setStudentAccountsLoading(false);
    if (studentAccountPage > 0 && accounts.accounts.length === 0) {
      setStudentAccountPage((page) => page - 1);
    }
    if (pendingAccountPage > 0 && pending.accounts.length === 0) {
      setPendingAccountPage((page) => page - 1);
    }
  };

  const handleApproveAccount = async (id, name) => {
    try {
      await approveStudentAccount(id);
      await refreshStudentAccountPages();
      showToast(`${name}'s account has been confirmed. They can now log in.`);
    } catch (err) {
      setStudentAccountsError(err.message);
      showToast(`Could not approve ${name}: ${err.message}`, "error");
    }
  };

  const handleViewStudentId = async (student) => {
    setStudentIdViewer({ id: student.id, name: student.name, loading: true, error: "", images: null });
    try {
      const images = await getStudentIdImagesForAdmin(student.id);
      setStudentIdViewer((current) => current?.id === student.id
        ? { ...current, loading: false, images }
        : current);
    } catch (err) {
      setStudentIdViewer((current) => current?.id === student.id
        ? { ...current, loading: false, error: err.message }
        : current);
    }
  };

  const handleDeclineAccount = async (id, name) => {
    if (!window.confirm(`Decline and remove "${name}"'s registration? This cannot be undone.`)) return;
    try {
      await declineStudentAccount(id);
      await refreshStudentAccountPages();
      showToast(`${name}'s registration was declined.`);
    } catch (error) {
      setStudentAccountsError(error.message);
      showToast(`Could not decline ${name}: ${error.message}`, "error");
    }
  };

  const handleResendConfirmation = async (email) => {
    const result = await resendConfirmationEmail(email);
    if (!result.success) { showToast(result.error, "error"); return; }
    showToast(`Verification code sent to ${email}.`);
  };

  /* Export helpers */
  const exportFilteredIncidents = incidents.filter((report) =>
    (!exportSearch.trim() || [
      report.id,
      report.type,
      report.description,
      report.location,
      report.isAnonymous ? "Anonymous" : report.submittedBy,
      report.status,
    ].some((value) => String(value || "").toLowerCase().includes(exportSearch.trim().toLowerCase()))) &&
    (exportTypes === null || exportTypes.includes(report.type || "Others")) &&
    (exportStatuses === null || exportStatuses.includes(report.status)) &&
    (exportGradeFilter === null || exportGradeFilter.includes(report.reporterGrade)) &&
    (exportGenderFilter === null || exportGenderFilter.includes(report.reporterSex)) &&
    (exportSectionFilter === null || exportSectionFilter.includes(report.reporterSection)) &&
    (exportMonthFilter === null || (report.date && exportMonthFilter.includes(MONTH_NAMES[new Date(report.date).getMonth()]))) &&
    (exportYearFilter === null || (report.date && exportYearFilter.includes(String(new Date(report.date).getFullYear()))))
  );
  const exportPreviewRecords = exportReportsSelected
    ? exportFilteredIncidents.slice(0, 10)
    : exportOffensePreview.records;
  const selectedExportPreviewRecords = exportPreviewRecords.filter((record) =>
    exportSelectedIds.has(String(record.id))
  );
  const previewOffensePlanItems = useMemo(
    () => parseInterventionPlan(previewOffenseDetail?.disciplinaryAction),
    [previewOffenseDetail]
  );
  const toggleExportRecordSelection = (recordId) => {
    const key = String(recordId);
    setExportSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setExportError("");
  };
  const handleExportPreviewRowKeyDown = (event, recordId) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    toggleExportRecordSelection(recordId);
  };

  const clearExportFilters = () => {
    setExportSearch("");
    setExportTypes(null);
    setExportStatuses(null);
    setExportGradeFilter(null);
    setExportGenderFilter(null);
    setExportSectionFilter(null);
    setExportMonthFilter(null);
    setExportYearFilter(null);
  };

  const clearExportOffenseFilters = () => {
    setExportOffenseFilters({
      search: "", grade: "", section: "", offenseNumber: "", type: "",
      dateFrom: "", dateTo: "", action: "", sort: "recent",
    });
  };

  const loadAllFilteredOffenses = async () => {
    const records = [];
    let total = 1;
    while (records.length < total) {
      const result = await getStudentOffenseRecords({
        ...exportOffenseFilters,
        limit: 100,
        offset: records.length,
      });
      total = result.total;
      const previousCount = records.length;
      records.push(...result.records);
      if (records.length >= total) break;
      if (records.length === previousCount || records.length >= 100000) {
        throw new Error("Could not retrieve all matching student offense records. Adjust the filters and try again.");
      }
    }
    return records;
  };

  const handleExport = async () => {
    if (exportOffensesSelected && exportOffenseError) return;
    if ((exportReportsSelected && exportFilteredIncidents.length === 0)
      || (exportOffensesSelected && exportOffensePreview.total === 0)) return;
    setExportError("");
    const selectedIds = new Set(selectedExportPreviewRecords.map((record) => String(record.id)));
    try {
      if (exportReportsSelected) {
        const reportsToExport = selectedIds.size
          ? exportFilteredIncidents.filter((report) => selectedIds.has(String(report.id)))
          : exportFilteredIncidents;
        if (exportFormat === "xlsx") await downloadXLSX(reportsToExport);
        else if (exportFormat === "docx") await downloadDOCX(reportsToExport);
        else downloadCSV(reportsToExport);
      } else {
        const matchingOffenses = await loadAllFilteredOffenses();
        const offenseRecords = selectedIds.size
          ? matchingOffenses.filter((record) => selectedIds.has(String(record.id)))
          : matchingOffenses;
        await downloadStudentOffenseRecords(offenseRecords, exportFormat);
      }
    } catch (error) {
      console.error("Failed to export selected data:", error);
      setExportError(error.message || "The export could not be created. Please try again.");
    }
  };

  const today = new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const involvedGroups = selectedReport ? [
    { label: "Victims", people: selectedReport.victims || [] },
    { label: "Reported students", people: selectedReport.offenders || [] },
    { label: "Witnesses", people: selectedReport.witnesses || [] },
  ].filter((group) => group.people.length > 0) : [];
  return (
    <div className="dashboard admin-theme" style={{ backgroundImage: `url(${bg})` }}>
      {/* ── SIDEBAR ── */}
      <div className={`sidebar${mobileNavOpen ? " sidebar-open" : ""}`}>
        <div className="brand">
          <img src={logo} alt="logo" />
          <div>
            <h2>CASINGLOT NHS</h2>
            <p>ADMIN PANEL</p>
          </div>
        </div>

        <nav className="menu">
          {[
            { tab: "dashboard",      icon: <LayoutDashboard size={16} />, label: "Dashboard" },
            { tab: "incidents",      icon: <FileText size={16} />,        label: "Incidents" },
            { tab: "confirmations",  icon: <UserCheck size={16} />,       label: "Confirmations" },
            { tab: "analytics",      icon: <FileBarChart size={16} />,    label: "Analytics" },
            { tab: "student-offenses", icon: <History size={16} />,       label: "Student Offense Records" },
          ].map(({ tab, icon, label }) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => handleAdminTabSelect(tab)}>
              {icon} {label}
              {tab === "confirmations" && pendingAccountCount > 0 && (
                <span style={{
                  marginLeft: "auto", background: "#ef4444", color: "#fff",
                  fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 10,
                }}>{pendingAccountCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sb-section-label">Management</div>
        <nav className="menu">
          {[
            { tab: "awareness", icon: <BookOpen size={16} />,      label: "Awareness Hub" },
            { tab: "sections",  icon: <GraduationCap size={16} />, label: "Grade & Sections" },
          ].map(({ tab, icon, label }) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => handleAdminTabSelect(tab)}>
              {icon} {label}
            </button>
          ))}
        </nav>
      </div>
      {mobileNavOpen && (
        <button
          type="button"
          className="admin-mobile-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* ── MAIN ── */}
      <div className="main">

        {/* TOP BAR */}
        <div className={`header${profileOpen ? " profile-menu-open" : ""}`}>
          <button
            type="button"
            className="admin-mobile-menu"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <Menu size={20} />
          </button>
          <div className="welcome">
            <h2><span className="welcome-dot" />System Overview</h2>
            <p>
              <Calendar size={13} /> {today} <span className="welcome-sep">•</span> <strong>Casinglot NHS</strong>
              <span className="welcome-sep">•</span> Academic Year 2025–26
            </p>
          </div>
          <div className="actions">

            {/* Notifications */}
            <div className="icon notif-icon" ref={notifRef}>
              <Bell size={18} onClick={handleToggleNotifications} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
              {notifOpen && (
                <div className="s-notif-dropdown" style={{ right: 0 }}>
                  <div className="s-notif-header">
                    <span>Notifications</span>
                    <button onClick={async () => {
                      await markAllAdminNotifRead();
                      setNotifications((current) => current.map((notification) => ({ ...notification, read: true })));
                      setUnreadCount(0);
                    }}>
                      Mark all read
                    </button>
                  </div>
                  {notifLoading ? (
                    <div style={{ padding: "14px 16px", fontSize: 13, color: "#94a3b8" }}>Loading notifications…</div>
                  ) : notifications.length === 0 ? (
                    <div style={{ padding: "14px 16px", fontSize: 13, color: "#94a3b8" }}>No notifications yet.</div>
                  ) : notifications.map((n) => (
                    <div key={n.id}
                      className={`s-notif-item ${!n.read ? "unread" : ""}`}
                      onClick={async () => {
                        await markAdminNotifRead(n.id);
                        setNotifications((current) => current.map((notification) =>
                          notification.id === n.id ? { ...notification, read: true } : notification
                        ));
                        if (!n.read) setUnreadCount((current) => Math.max(0, current - 1));
                        setNotifOpen(false);
                        if (n.type === "report") setActiveTab("incidents");
                        else if (n.type === "hub") setActiveTab("awareness");
                      }}>
                      <div className={`s-notif-dot ${n.type === "report" ? "green" : "blue"}`} />
                      <div><p>{n.title}</p><span>{n.time}</span></div>
                    </div>
                  ))}
                  {hasMoreNotifications && (
                    <button type="button" className="back-btn" onClick={handleLoadMoreNotifications} disabled={loadingMoreNotifications}>
                      {loadingMoreNotifications ? "Loading…" : "Load older notifications"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="admin-identity-pill" ref={profileRef}>
              <button
                type="button"
                className="admin-identity-btn"
                onClick={() => setProfileOpen(!profileOpen)}
                aria-haspopup="true"
                aria-expanded={profileOpen}
              >
                <div className="admin-ava">AD</div>
                <div className="admin-ava-info">
                  <span className="admin-ava-name">{adminName}</span>
                  <span className="admin-ava-role">Full access</span>
                </div>
                <ChevronDown size={14} className={`admin-identity-chevron ${profileOpen ? "open" : ""}`} />
              </button>
              {profileOpen && (
                <div className="dropdown small profile-dropdown">
                  <p className="dropdown-label">Signed in as {adminName}</p>
                  <button className="logout-btn" onClick={async () => {
                    try {
                      await signOut();
                    } finally {
                      navigate("/login?role=admin");
                    }
                  }}>
                    <LogOut size={15} /> Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══════════════════════════════
            DASHBOARD TAB
        ══════════════════════════════ */}
        {activeTab === "dashboard" && (
          <div className="admin-content" ref={adminContentRef}>
            <div className="admin-dashboard-layout">
              <div className="admin-dashboard-main">
                {/* Summary Cards */}
                <div className="summary-grid admin-summary dashboard-summary-grid">
                  {[
                    { label: "Total Reports",               val: incidents.length,       icon: <FileText size={18} />,      color: "m-green",  badge: "muted", sub: "all submissions" },
                    { label: "Pending",                     val: pendingCases.length,    icon: <AlertTriangle size={18} />, color: "m-amber",  badge: "warn",  sub: "needs review" },
                    { label: "Under Investigation",         val: inProgressCases.length, icon: <Clock size={18} />,         color: "m-blue",   badge: "info",  sub: "being handled" },
                    { label: "Resolved",                    val: resolvedCases.length,   icon: <CheckCircle size={18} />,   color: "m-green2", badge: "up",    sub: "closed cases" },
                  ].map(({ label, val, icon, color, badge, sub }) => (
                    <div className={`summary-card-modern ${color}`} key={label}>
                      <div className="summary-header">
                        <div className={`summary-icon ${color === "m-amber" ? "a" : color === "m-blue" ? "b" : "g"}`}>{icon}</div>
                        <span className={`trend-badge ${badge}`}>{sub}</span>
                      </div>
                      <div className="summary-body">
                        <p className="summary-value">{val}</p>
                        <h3 className="summary-label">{label}</h3>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Charts Row */}
                <div className="db-grid-chart">
                  {/* Monthly Trend */}
                  <div className="card-panel dashboard-chart-card">
                    <div className="panel-header-flex">
                      <div className="title-group">
                        <h3>Monthly Incident Trend</h3>
                        <p className="panel-subtitle">Reports submitted per month (last 6 months)</p>
                      </div>
                    </div>
                    <div className="chart-canvas-wrap" style={{ height: 180 }}>
                      <canvas ref={trendCanvasRef} role="img" aria-label="Line chart showing monthly incident trend" />
                    </div>
                    <div className="mini-stats-row dashboard-mini-stats">
                      <div className="mini-stat">
                        <span className="mini-stat-val">
                          {Math.max(...monthlyData.map((m) => m.count))}
                        </span>
                        <span className="mini-stat-label">Peak month</span>
                      </div>
                      <div className="mini-stat">
                        <span className="mini-stat-val">
                          {incidents.length}
                        </span>
                        <span className="mini-stat-label">Total reports</span>
                      </div>
                      <div className="mini-stat">
                        <span className="mini-stat-val">
                          {monthlyData[monthlyData.length - 1].count}
                        </span>
                        <span className="mini-stat-label">This month</span>
                      </div>
                    </div>
                  </div>

                  {/* Type Breakdown */}
                  <div className="card-panel dashboard-chart-card dashboard-breakdown-card">
                    <div className="title-group" style={{ marginBottom: 16 }}>
                      <h3>Incident Type Breakdown</h3>
                      <p className="panel-subtitle">Distribution of all reported cases</p>
                    </div>
                    {totalSorted.length === 0 ? (
                      <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
                        No incidents reported yet — this breakdown will fill in automatically as reports come in.
                      </p>
                    ) : (() => {
                      const typeTotalPages = Math.max(1, Math.ceil(totalSorted.length / TYPE_BREAKDOWN_PAGE_SIZE));
                      const typePage = Math.min(typeBreakdownPage, typeTotalPages - 1);
                      const typePageItems = totalSorted.slice(
                        typePage * TYPE_BREAKDOWN_PAGE_SIZE,
                        typePage * TYPE_BREAKDOWN_PAGE_SIZE + TYPE_BREAKDOWN_PAGE_SIZE
                      );
                      return (
                        <>
                          <div className="breakdown-list">
                            {typePageItems.map(([type, count]) => {
                              const pct = Math.round((count / incidents.length) * 100);
                              const color = TYPE_COLORS[type] || "#68736B";
                              return (
                                <div className="bk-row" key={type}>
                                  <div className="bk-top">
                                    <span className="bk-label"><span className="bk-dot" style={{ background: color }} />{type}</span>
                                    <span className="dashboard-breakdown-stats">
                                      <span className="bk-count">{count} incident{count !== 1 ? "s" : ""}</span>
                                      <span className="bk-pct" style={{ color }}>{pct}%</span>
                                    </span>
                                  </div>
                                  <div className="bk-track"><div className="bk-fill" style={{ width: `${pct}%`, background: color }} /></div>
                                </div>
                              );
                            })}
                          </div>
                          {typeTotalPages > 1 && (
                            <div className="dashboard-type-pagination">
                              <button
                                onClick={() => setTypeBreakdownPage((p) => Math.max(0, p - 1))}
                                disabled={typePage === 0}
                              ><ChevronLeft size={14} /> Prev</button>
                              <span>
                                Page {typePage + 1} of {typeTotalPages}
                              </span>
                              <button
                                onClick={() => setTypeBreakdownPage((p) => Math.min(typeTotalPages - 1, p + 1))}
                                disabled={typePage === typeTotalPages - 1}
                              >Next <ChevronRight size={14} /></button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Recent incidents table */}
                {incidents.length > 0 && (
                  <div className="db-grid-bottom">
                    <div className="card-panel">
                      <div className="panel-header-flex" style={{ marginBottom: 14 }}>
                        <div className="title-group">
                          <h3>Recent Submissions</h3>
                          <p className="panel-subtitle">Latest student-submitted reports</p>
                        </div>
                        <button className="read-btn small" onClick={() => setActiveTab("incidents")}>View all <ArrowUpRight size={11} /></button>
                      </div>
                      <div className="table-container">
                        <table className="cases-table compact">
                          <thead>
                            <tr><th>Case ID</th><th>Type</th><th>By</th><th>Date</th><th>Status</th><th></th></tr>
                          </thead>
                          <tbody>
                            {incidents.slice(0, 6).map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <b className="case-id-cell">#{r.id}</b>
                                  {unseenReportIds.has(r.id) && <span className="incident-new-badge">NEW</span>}
                                </td>
                                <td>{r.type}</td>
                                <td style={{ fontSize: 12 }}>{r.isAnonymous ? <span style={{ color: "#6b7280", fontStyle: "italic" }}>Anonymous</span> : r.submittedBy}</td>
                                <td className="date-cell">{r.date}</td>
                                <td><span className={`status-badge ${r.status.toLowerCase().replace(/\s/g,"-")}`}>{r.status}</span></td>
                                <td><button className="read-btn tiny" onClick={() => handleOpenManage(r)}>Manage</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <ConferenceManagement
                reports={incidents}
                onReportsUpdated={refreshConferenceReports}
                onToast={showToast}
              />
            </div>
          </div>
        )}

        {/* ══════════════════════════════
            INCIDENTS TAB
        ══════════════════════════════ */}
        {activeTab === "incidents" && (
          <div className="admin-content admin-incidents-page">
            <div className="incidents-toolbar">
              <div className="search-bar-wrap">
                <Search size={14} />
                <input type="text" placeholder="Search by ID, type, reporter, status…"
                  value={searchQuery} onChange={(e) => handleSearchChange(e.target.value)} />
              </div>
              <div className="filter-tabs">
                {["Pending","Under Investigation","Resolved","All"].map((f) => (
                  <button
                    key={f}
                    className={`filter-tab filter-tab-${f.toLowerCase().replace(/\s/g,"-")} ${caseFilter === f ? "active" : ""}`}
                    onClick={() => handleCaseFilterChange(f)}
                  >{f}</button>
                ))}
              </div>
            </div>

            {filteredIncidents.length === 0 ? (
              <>
                <div className="card-panel" style={{ textAlign: "center", padding: "60px 24px", color: "#94a3b8" }}>
                  <FileText size={48} color="#e2e8f0" style={{ margin: "0 auto 12px" }} />
                  <h3 style={{ color: "#64748b", fontWeight: 800, marginBottom: 8 }}>
                    {incidents.length === 0 ? "No incidents yet" : "No matching incidents loaded"}
                  </h3>
                  <p style={{ fontSize: 14 }}>
                    {incidents.length === 0 ? "Incidents submitted by students will appear here in real time." : "Load older incidents to search more records."}
                  </p>
                </div>
                {hasMoreIncidents && (
                  <div style={{ textAlign: "center", marginTop: 14 }}>
                    <button className="read-btn" onClick={handleLoadMoreIncidents} disabled={loadingMoreIncidents}>
                      {loadingMoreIncidents ? "Loading incidents…" : "Load older incidents"}
                    </button>
                  </div>
                )}
              </>
            ) : (() => {
              const incidentsTotalPages = Math.max(1, Math.ceil(filteredIncidents.length / INCIDENTS_PAGE_SIZE));
              const page = Math.min(incidentsPage, incidentsTotalPages - 1);
              const pageStart = page * INCIDENTS_PAGE_SIZE;
              const pageItems = filteredIncidents.slice(pageStart, pageStart + INCIDENTS_PAGE_SIZE);
              return (
                <>
                  <p className="incidents-result-count">
                    Showing {pageStart + 1}–{Math.min(pageStart + INCIDENTS_PAGE_SIZE, filteredIncidents.length)} of {filteredIncidents.length} incident{filteredIncidents.length !== 1 ? "s" : ""}
                  </p>
                  <div className="incidents-grid">
                    {pageItems.map((r) => (
                      <div
                        className={`card-panel incident-row${unseenReportIds.has(r.id) ? " incident-row-unseen" : ""}`}
                        key={r.id}
                      >
                        <div className="incident-top">
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <b className="case-id-cell" style={{ fontSize: 14 }}>#{r.id}</b>
                            {unseenReportIds.has(r.id) && <span className="incident-new-badge">NEW</span>}
                            <span className="type-chip">{r.type}</span>
                            {r.priority && (
                              <span className={`priority-badge ${r.priority}`}>{r.priority}</span>
                            )}
                            {r.evidenceCount > 0 && (
                              <span className="evidence-chip-small">
                                <Paperclip size={11} /> {r.evidenceCount} file{r.evidenceCount > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span className={`status-badge ${r.status.toLowerCase().replace(/\s/g,"-")}`}>{r.status}</span>
                            <button className="read-btn tiny" onClick={() => handleOpenManage(r)}>Manage</button>
                          </div>
                        </div>
                        <p className="incident-desc">
                          {r.description}
                        </p>
                        <div className="incident-meta">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Shield size={12} style={{ display: r.isAnonymous ? "inline" : "none" }} />
                            <User size={12} style={{ display: r.isAnonymous ? "none" : "inline" }} />
                            {r.isAnonymous ? "Anonymous" : r.submittedBy}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Calendar size={12} /> {r.date}{r.time ? ` at ${to12Hour(r.time)}` : ""}
                          </span>
                          {r.location && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <MapPin size={12} /> {r.location}
                            </span>
                          )}
                        </div>
                        {r.adminNotes && (
                          <div className="incident-admin-note">
                            <strong>Staff note</strong><span>{r.adminNotes}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {incidentsTotalPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
                      <button
                        onClick={() => setIncidentsPage((p) => Math.max(0, p - 1))}
                        disabled={page === 0}
                        style={{
                          display: "flex", alignItems: "center", gap: 4, padding: "7px 14px",
                          border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                          color: page === 0 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                          cursor: page === 0 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                        }}
                      ><ChevronLeft size={14} /> Prev</button>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                        Page {page + 1} of {incidentsTotalPages}
                      </span>
                      <button
                        onClick={() => setIncidentsPage((p) => Math.min(incidentsTotalPages - 1, p + 1))}
                        disabled={page === incidentsTotalPages - 1}
                        style={{
                          display: "flex", alignItems: "center", gap: 4, padding: "7px 14px",
                          border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                          color: page === incidentsTotalPages - 1 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                          cursor: page === incidentsTotalPages - 1 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                        }}
                      >Next <ChevronRight size={14} /></button>
                    </div>
                  )}
                  {hasMoreIncidents && (
                    <div style={{ textAlign: "center", marginTop: 14 }}>
                      <button className="read-btn" onClick={handleLoadMoreIncidents} disabled={loadingMoreIncidents}>
                        {loadingMoreIncidents ? "Loading incidents…" : "Load older incidents"}
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════
            ANALYTICS TAB
        ══════════════════════════════ */}
        {activeTab === "analytics" && (
          <div className={`admin-content${analyticsView === "overview" ? " analytics-overview" : ""}`}>
            <div className="analytics-page-nav" role="tablist" aria-label="Analytics pages">
              <button
                type="button"
                role="tab"
                aria-selected={analyticsView === "overview"}
                className={analyticsView === "overview" ? "active" : ""}
                onClick={() => setAnalyticsView("overview")}
              >
                <FileBarChart size={16} /> Overview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={analyticsView === "export"}
                className={analyticsView === "export" ? "active" : ""}
                onClick={() => setAnalyticsView("export")}
              >
                <Download size={16} /> Export
              </button>
            </div>
            {analyticsView === "export" ? (
              <div className="analytics-export-page">
                <div className="analytics-export-page-header">
                  <div>
                    <h2>Export data</h2>
                    <p>Prepare and download incident reports and student offense records.</p>
                  </div>
                </div>
                <section className="analytics-export-card">
                  <div className="analytics-export-section-heading">
                    <span className="analytics-export-step">1</span>
                    <div><h3>Choose a dataset</h3><p>Select the records you want to export.</p></div>
                  </div>
                  <div className="analytics-export-dataset-options" role="radiogroup" aria-label="Export dataset">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={exportReportsSelected}
                      className={`analytics-export-dataset${exportReportsSelected ? " selected" : ""}`}
                      onClick={() => {
                        setExportDataset("incidents");
                        setExportSelectedIds(new Set());
                        setExportError("");
                      }}
                    >
                      <span className="analytics-export-dataset-copy">
                        <strong>Incident reports</strong>
                        <small>Submitted reports, statuses, dates, and reporter details</small>
                      </span>
                      <span className="analytics-export-dataset-count">{incidents.length} records</span>
                      <span className="analytics-export-dataset-check" aria-hidden="true">
                        {exportReportsSelected && <CheckCircle size={14} />}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={exportOffensesSelected}
                      className={`analytics-export-dataset${exportOffensesSelected ? " selected" : ""}`}
                      onClick={() => {
                        setExportDataset("offenses");
                        setExportSelectedIds(new Set());
                        setExportError("");
                      }}
                    >
                      <span className="analytics-export-dataset-copy">
                        <strong>Student offense records</strong>
                        <small>Student details, offense history, actions, and follow-up</small>
                      </span>
                      <span className="analytics-export-dataset-count">
                        {exportOffenseLoading ? "Loading…" : `${exportOffensePreview.total} records`}
                      </span>
                      <span className="analytics-export-dataset-check" aria-hidden="true">
                        {exportOffensesSelected && <CheckCircle size={14} />}
                      </span>
                    </button>
                  </div>
                </section>

                <section className="analytics-export-card">
                  <div className="analytics-export-section-heading analytics-export-heading-row">
                    <span className="analytics-export-step">2</span>
                    <div>
                      <h3>Filters <span className="analytics-export-optional">(optional)</span></h3>
                      <p>Leave unchanged to include all available {exportReportsSelected ? "incident reports" : "student offense records"}.</p>
                    </div>
                  </div>
                  <details className="analytics-export-advanced-filters">
                    <summary>
                      <span>{exportReportsSelected ? "Incident report filters" : "Student offense filters"}</span>
                      <small>
                        {exportReportsSelected
                          ? activeIncidentExportFilters ? `${activeIncidentExportFilters} active` : "None active"
                          : activeOffenseExportFilters ? `${activeOffenseExportFilters} active` : "None active"}
                      </small>
                    </summary>
                    {exportReportsSelected ? (
                      <>
                  <div className="analytics-export-filter-toolbar">
                    <span>Refine your incident report results</span>
                    <button type="button" className="analytics-export-clear-btn" onClick={clearExportFilters}>Clear filters</button>
                  </div>
                  <label className="analytics-export-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={exportSearch}
                      onChange={(event) => setExportSearch(event.target.value)}
                      placeholder="Search by reporter name, report ID, type, status, location, or details"
                    />
                  </label>
                  <div className="analytics-export-filter-grid">
                    <div className="analytics-export-filter-box">
                      <ExportChecklist title="Incident type" options={EXPORT_INCIDENT_TYPES} selected={exportTypes} setSelected={setExportTypes} />
                    </div>
                    <div className="analytics-export-filter-box">
                      <ExportChecklist title="Status" options={EXPORT_STATUSES} selected={exportStatuses} setSelected={setExportStatuses} />
                    </div>
                    <details className="analytics-export-filter-group">
                      <summary>
                        <span>Student details</span>
                        <small>{[exportGradeFilter, exportGenderFilter, exportSectionFilter].filter((selection) => selection !== null).length
                          ? `${[exportGradeFilter, exportGenderFilter, exportSectionFilter].filter((selection) => selection !== null).length} active`
                          : "Any"}</small>
                      </summary>
                      <div className="analytics-export-filter-group-content">
                        <ExportChecklist title="Grade level" options={allGrades} selected={exportGradeFilter} setSelected={setExportGrades} />
                        <ExportChecklist title="Gender" options={allGenders} selected={exportGenderFilter} setSelected={setExportGenderFilter} />
                        <ExportChecklist title="Section" options={exportSections} selected={exportSectionFilter} setSelected={setExportSectionFilter} />
                      </div>
                    </details>
                    <details className="analytics-export-filter-group">
                      <summary>
                        <span>Report date</span>
                        <small>{[exportMonthFilter, exportYearFilter].filter((selection) => selection !== null).length
                          ? `${[exportMonthFilter, exportYearFilter].filter((selection) => selection !== null).length} active`
                          : "Any"}</small>
                      </summary>
                      <div className="analytics-export-filter-group-content">
                        <ExportChecklist title="Month" options={MONTH_NAMES} selected={exportMonthFilter} setSelected={setExportMonthFilter} className="analytics-export-month-checklist" />
                        <ExportChecklist title="Year" options={allYears.map(String)} selected={exportYearFilter} setSelected={setExportYearFilter} />
                      </div>
                    </details>
                  </div>
                  <div className="analytics-export-preview-count">
                    Showing <strong>{exportFilteredIncidents.length}</strong> of {incidents.length} incident reports
                  </div>
                      </>
                    ) : (
                    <div className="analytics-export-offense-filters">
                      <div className="analytics-export-section-heading analytics-export-heading-row">
                        <div>
                          <p>Filter by student, grade, offense type, action, or date.</p>
                        </div>
                        <button type="button" className="analytics-export-clear-btn" onClick={clearExportOffenseFilters}>
                          Clear filters
                        </button>
                      </div>
                      <label className="analytics-export-search">
                        <Search size={16} />
                        <input
                          type="search"
                          value={exportOffenseFilters.search}
                          onChange={(event) => setExportOffenseFilters((current) => ({ ...current, search: event.target.value }))}
                          placeholder="Search student name, student ID/LRN, or incident report ID"
                        />
                      </label>
                      <div className="analytics-export-offense-filter-grid">
                        <label>
                          Grade level
                          <select
                            value={exportOffenseFilters.grade}
                            onChange={(event) => setExportOffenseFilters((current) => ({
                              ...current, grade: event.target.value, section: "",
                            }))}
                          >
                            <option value="">All grades</option>
                            {exportOffensePreview.options.grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                          </select>
                        </label>
                        <label>
                          Section
                          <select
                            value={exportOffenseFilters.section}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, section: event.target.value }))}
                          >
                            <option value="">All sections</option>
                            {exportOffenseSections.map((section) => <option key={section} value={section}>{section}</option>)}
                          </select>
                        </label>
                        <label>
                          Offense number
                          <select
                            value={exportOffenseFilters.offenseNumber}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, offenseNumber: event.target.value }))}
                          >
                            {EXPORT_OFFENSE_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </label>
                        <label>
                          Bullying type
                          <select
                            value={exportOffenseFilters.type}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, type: event.target.value }))}
                          >
                            <option value="">All types</option>
                            {EXPORT_OFFENSE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <label>
                          Date recorded from
                          <input
                            type="date"
                            value={exportOffenseFilters.dateFrom}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                          />
                        </label>
                        <label>
                          Date recorded to
                          <input
                            type="date"
                            value={exportOffenseFilters.dateTo}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, dateTo: event.target.value }))}
                          />
                        </label>
                        <label>
                          Disciplinary action
                          <select
                            value={exportOffenseFilters.action}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, action: event.target.value }))}
                          >
                            <option value="">All actions</option>
                            {exportOffensePreview.options.actions.map((action) => (
                              <option key={action} value={action}>{action === "yes" ? "Intervention recorded" : action === "no" ? "No intervention recorded" : action}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Sort by
                          <select
                            value={exportOffenseFilters.sort}
                            onChange={(event) => setExportOffenseFilters((current) => ({ ...current, sort: event.target.value }))}
                          >
                            <option value="recent">Most recent offense</option>
                            <option value="oldest">Oldest offense</option>
                            <option value="name_asc">Student name (A–Z)</option>
                            <option value="name_desc">Student name (Z–A)</option>
                            <option value="most_offenses">Highest number of offenses</option>
                            <option value="least_offenses">Lowest number of offenses</option>
                          </select>
                        </label>
                      </div>
                      <div className="analytics-export-preview-count">
                        Showing <strong>{exportOffensePreview.records.length}</strong> of {exportOffensePreview.total} matching student offense records
                      </div>
                      {exportOffenseError && <p className="analytics-export-error" role="alert">{exportOffenseError}</p>}
                    </div>
                    )}
                  </details>
                </section>

                <section className="analytics-export-card analytics-export-records">
                  <div className="analytics-export-records-heading">
                    <div>
                      <h3>Preview</h3>
                      <p>Select preview rows to export only those records. Leave all unselected to export every match.</p>
                    </div>
                    <div className="analytics-export-preview-actions">
                      <span>{exportReportsSelected ? exportFilteredIncidents.length : exportOffensePreview.total} total</span>
                      {selectedExportPreviewRecords.length > 0 && (
                        <>
                          <span>{selectedExportPreviewRecords.length} selected</span>
                          <button type="button" onClick={() => setExportSelectedIds(new Set())}>Clear selection</button>
                        </>
                      )}
                    </div>
                  </div>
                  {exportReportsSelected && exportFilteredIncidents.length > 0 && (
                    <div className="analytics-export-table-wrap">
                      <table className="analytics-export-table">
                        <thead><tr><th>Report No.</th><th>Date</th><th>Type</th><th>Location</th><th>Status</th><th>Reporter</th><th>Reporter role</th></tr></thead>
                        <tbody>
                          {exportFilteredIncidents.slice(0, 10).map((report) => (
                            <tr
                              key={report.id}
                              className={exportSelectedIds.has(String(report.id)) ? "selected" : ""}
                              aria-selected={exportSelectedIds.has(String(report.id))}
                              tabIndex={0}
                              onClick={() => toggleExportRecordSelection(report.id)}
                              onKeyDown={(event) => handleExportPreviewRowKeyDown(event, report.id)}
                            >
                              <td>
                                <span className="analytics-export-row-select">
                                  <input
                                    type="checkbox"
                                    checked={exportSelectedIds.has(String(report.id))}
                                    onClick={(event) => event.stopPropagation()}
                                    onChange={() => toggleExportRecordSelection(report.id)}
                                    aria-label={`Select report ${formatReportNumber(report.id)} for export`}
                                  />
                                  {formatReportNumber(report.id)}
                                </span>
                              </td>
                              <td>{report.date || "—"}</td>
                              <td>{report.type || "—"}</td>
                              <td>{report.location || "—"}</td>
                              <td><span className={`status-badge ${(report.status || "").toLowerCase().replace(/\s/g, "-")}`}>{report.status || "—"}</span></td>
                              <td>{report.isAnonymous ? "Anonymous" : report.submittedBy || "—"}</td>
                              <td>{report.reporterType === "Friend" ? "Friend of victim" : report.reporterType || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {exportOffensesSelected && (
                    exportOffenseLoading ? (
                      <div className="analytics-export-empty">Loading matching student offense records…</div>
                    ) : exportOffenseError ? null : exportOffensePreview.records.length > 0 ? (
                      <div className="analytics-export-table-wrap">
                        <table className="analytics-export-table analytics-export-table--offenses">
                          <thead>
                            <tr><th>Student</th><th>Student ID/LRN</th><th>Grade/Section</th><th>Offense</th><th>Incident</th><th>Action</th><th>Follow-up</th><th>Date recorded</th></tr>
                          </thead>
                          <tbody>
                            {exportOffensePreview.records.map((record) => (
                              <tr
                                key={record.id}
                                className={exportSelectedIds.has(String(record.id)) ? "selected" : ""}
                                aria-selected={exportSelectedIds.has(String(record.id))}
                                tabIndex={0}
                                onClick={() => toggleExportRecordSelection(record.id)}
                                onKeyDown={(event) => handleExportPreviewRowKeyDown(event, record.id)}
                              >
                                <td>
                                  <span className="analytics-export-row-select">
                                    <input
                                      type="checkbox"
                                      checked={exportSelectedIds.has(String(record.id))}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={() => toggleExportRecordSelection(record.id)}
                                      aria-label={`Select offense record for ${record.studentName || "student"} for export`}
                                    />
                                    {record.studentName || "—"}
                                  </span>
                                </td>
                                <td>{record.lrn || "—"}</td>
                                <td>{[record.grade, record.section].filter(Boolean).join(" · ") || "—"}</td>
                                <td>#{record.offenseNumber}</td>
                                <td>
                                  {(record.incidentReportIds || [record.incidentReportId])
                                    .map((id) => formatReportNumber(id)).join(", ")}
                                  <br />{record.incidentType || "—"} · {formatConferenceDate(record.incidentDate)}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="analytics-export-action-button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPreviewOffenseDetail(record);
                                    }}
                                    aria-label={`View full intervention plan for ${record.studentName || "student"}`}
                                  >
                                    <Eye size={14} />
                                  Details
                                  </button>
                                </td>
                                <td>{record.followUpStatus || "—"}{record.followUpDate ? ` · ${formatConferenceDate(record.followUpDate)}` : ""}</td>
                                <td>{formatConferenceDate(record.reviewedAt || record.approvedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="analytics-export-empty">No student offense records match the selected filters.</div>
                    )
                  )}
                  {exportReportsSelected && exportFilteredIncidents.length === 0 && (
                    <div className="analytics-export-empty">No incident reports match these filters. Adjust or clear the filters.</div>
                  )}
                </section>

                <section className="analytics-export-card">
                  <div className="analytics-export-section-heading">
                    <span className="analytics-export-step">3</span>
                    <div><h3>Export records</h3><p>Download the selected {exportReportsSelected ? "incident reports" : "student offense records"} in your chosen format.</p></div>
                  </div>
                  <div className="analytics-export-format-options" role="radiogroup" aria-label="Export format">
                    {[
                      { value: "xlsx", label: "Excel spreadsheet (.xlsx)", detail: "Formatted, ready to print", extension: ".xlsx" },
                      { value: "csv", label: "CSV spreadsheet", detail: "Plain data for importing", extension: ".csv" },
                      { value: "docx", label: "Docs", detail: "Word and Google Docs", extension: ".docx" },
                    ].map((format) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={exportFormat === format.value}
                        className={`analytics-export-format${exportFormat === format.value ? " selected" : ""}`}
                        key={format.value}
                        onClick={() => {
                          setExportFormat(format.value);
                          setExportError("");
                        }}
                      >
                        <span className="analytics-export-format-radio" />
                        <span><strong>{format.label}</strong><small>{format.detail}</small></span>
                        <span className="analytics-export-format-extension">{format.extension}</span>
                      </button>
                    ))}
                  </div>
                  <div className="analytics-export-action-row">
                    <span>
                      {selectedExportPreviewRecords.length > 0
                        ? `${selectedExportPreviewRecords.length} selected records ready`
                        : `${exportReportsSelected ? exportFilteredIncidents.length : exportOffensePreview.total} records ready`}
                    </span>
                    <button
                      type="button"
                      className="analytics-export-download"
                      onClick={handleExport}
                      disabled={
                        exportOffenseLoading ||
                        (exportOffensesSelected && Boolean(exportOffenseError)) ||
                        (exportReportsSelected && exportFilteredIncidents.length === 0) ||
                        (exportOffensesSelected && exportOffensePreview.total === 0)
                      }
                    >
                      <Download size={16} /> Download {selectedExportPreviewRecords.length > 0 ? "selected" : "all"} {exportFormat === "xlsx" ? "Excel" : exportFormat === "docx" ? "DOCS" : "CSV"}
                    </button>
                  </div>
                  {exportError && <p className="analytics-export-error" role="alert">{exportError}</p>}
                </section>
                {previewOffenseDetail && (
                  <div
                    className="student-offense-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                      if (event.target === event.currentTarget) setPreviewOffenseDetail(null);
                    }}
                  >
                    <section
                      className="student-offense-modal student-offense-history-modal analytics-export-offense-modal"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="analytics-export-offense-title"
                    >
                      <div className="student-offense-modal-header student-offense-history-header">
                        <div>
                          <h3 id="analytics-export-offense-title">
                            {previewOffenseDetail.studentName || "Student offense details"}
                          </h3>
                          <p>Established offense record · Offense #{previewOffenseDetail.offenseNumber || "—"}</p>
                          <div className="student-offense-history-student-meta">
                            {previewOffenseDetail.lrn && <span>LRN {previewOffenseDetail.lrn}</span>}
                            {previewOffenseDetail.grade && <span>{previewOffenseDetail.grade}</span>}
                            {previewOffenseDetail.section && <span>{previewOffenseDetail.section}</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewOffenseDetail(null)}
                          aria-label="Close intervention plan details"
                        >
                          <X size={19} />
                        </button>
                      </div>
                      <div className="student-offense-modal-content">
                        <div className="analytics-export-offense-summary">
                          <span className="student-offense-number">
                            Offense #{previewOffenseDetail.offenseNumber || "—"}
                          </span>
                          <strong>{previewOffenseDetail.incidentType || "Incident"}</strong>
                          <span>{formatConferenceDate(previewOffenseDetail.incidentDate)}</span>
                          <span className={`student-offense-follow-up-status ${(previewOffenseDetail.followUpStatus || (previewOffenseDetail.followUpDate ? "Monitoring" : "Not scheduled")).toLowerCase().replace(/\s+/g, "-")}`}>
                            {previewOffenseDetail.followUpStatus || (previewOffenseDetail.followUpDate ? "Monitoring" : "Not scheduled")}
                          </span>
                        </div>
                        <section className="student-offense-history-section">
                          <h4>Related incident reports</h4>
                          <div className="student-offense-history-reports">
                            {(previewOffenseDetail.incidentReportIds || [previewOffenseDetail.incidentReportId])
                              .filter((id) => id !== null && id !== undefined)
                              .map((id) => (
                                <span className="student-offense-link" key={id}>{formatReportNumber(id)}</span>
                              ))}
                          </div>
                        </section>
                        <div className="student-offense-history-facts">
                          <div>
                            <span>Approved by</span>
                            <strong>{previewOffenseDetail.approvedBy || "Administrator"}</strong>
                          </div>
                          <div>
                            <span>Date reviewed</span>
                            <strong>{formatConferenceDate(previewOffenseDetail.reviewedAt || previewOffenseDetail.approvedAt)}</strong>
                          </div>
                          <div>
                            <span>Follow-up date</span>
                            <strong>{previewOffenseDetail.followUpDate ? formatConferenceDate(previewOffenseDetail.followUpDate) : "Not scheduled"}</strong>
                          </div>
                        </div>
                        <section className="student-offense-history-section">
                          <h4>Intervention plan</h4>
                          {previewOffensePlanItems.length > 0 ? (
                            <div className="student-offense-plan-history">
                              {previewOffensePlanItems.map((item, index) => {
                                const completedFields = INTERVENTION_PLAN_FIELDS
                                  .filter((field) => item[field.key].trim());
                                return (
                                  <section className="student-offense-plan-history-item" key={`plan-${index + 1}`}>
                                    <h5>Plan item {index + 1}</h5>
                                    <dl>
                                      {completedFields.map((field) => (
                                        <div key={field.key}>
                                          <dt>{field.label}</dt>
                                          <dd>{item[field.key]}</dd>
                                        </div>
                                      ))}
                                    </dl>
                                  </section>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="student-offense-history-text">
                              {previewOffenseDetail.disciplinaryAction || "No intervention plan was recorded."}
                            </p>
                          )}
                        </section>
                      </div>
                    </section>
                  </div>
                )}
              </div>
            ) : (
              <>
            {incidents.length === 0 && (
              <div className="card-panel analytics-empty-banner">
                <FileBarChart size={28} color="#16a34a" />
                <div>
                  <h3>No incidents reported yet</h3>
                  <p>This is what your analytics will look like — it fills in automatically as students submit reports.</p>
                </div>
              </div>
            )}
            {(
              <>
                {/* ── KPI Row ── */}
                <div className="summary-grid admin-summary" style={{ marginBottom: 18 }}>
                  {[
                    {
                      label: "Total Incidents", val: mfFiltered.length, color: "m-green", badge: "muted", icon: <FileText size={18} />,
                      sub: mfHasFilters ? `of ${incidents.length} total` : "all submissions",
                    },
                    {
                      label: "Pending", val: mfFiltered.filter(r=>r.status==="Pending").length, color: "m-amber", badge: "warn", icon: <AlertTriangle size={18} />,
                      sub: "needs review",
                    },
                    {
                      label: "Resolution Rate",
                      val: mfFiltered.length > 0 ? `${Math.round((mfFiltered.filter(r=>r.status==="Resolved").length/mfFiltered.length)*100)}%` : "—",
                      color: "m-blue", badge: "info", icon: <CheckCircle size={18} />,
                      sub: mfFiltered.length > 0 ? `${mfFiltered.filter(r=>r.status==="Resolved").length} of ${mfFiltered.length} resolved` : "no data yet",
                    },
                    {
                      label: "Top Category", val: mfTopCount > 0 ? mfTopType : "—", color: "m-purple", badge: "purple", icon: <TrendingUp size={18} />,
                      sub: mfTopCount > 0 ? `${mfPct}% of filtered cases` : "no data yet",
                    },
                  ].map(({ label, val, color, badge, icon, sub }) => (
                    <div className={`summary-card-modern ${color}`} key={label}>
                      <div className="summary-header">
                        <div className={`summary-icon ${color === "m-amber" ? "a" : color === "m-blue" ? "b" : color === "m-purple" ? "p" : "g"}`}>{icon}</div>
                        <span className={`trend-badge ${badge}`}>{sub}</span>
                      </div>
                      <div className="summary-body">
                        <p className="summary-value" style={{ fontSize: typeof val === "string" && val.length > 4 ? 22 : 32 }}>{val}</p>
                        <h3 className="summary-label">{label}</h3>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Multi-Filter Bar Chart + Location Breakdown side by side ── */}
                <div className="analytics-main-row">

                  {/* Incident Analytics card */}
                  <div className="card-panel" style={{ marginBottom: 0 }}>
                    <div className="analytics-chart-header">
                      <div className="title-group">
                        <h3>Incident Analytics</h3>
                        <p className="panel-subtitle">
                          {mfHasFilters ? `Showing ${mfFiltered.length} of ${incidents.length} incidents` : `All ${incidents.length} incidents · Real-time`}
                        </p>
                      </div>
                    </div>

                    {/* ── Filters ── */}
                    <div className="mf-filters-panel">
                      <div className="mf-filters-panel-header">
                        <Filter size={13} /> Filters
                        {mfHasFilters && <span className="mf-filters-panel-count">{mfActiveTags.length} active</span>}
                      </div>

                      {/* Row 1: Incident type chips */}
                      <div className="mf-filter-row">
                        <span className="mf-filter-label">Incident type</span>
                        <div className="mf-type-chips">
                          <button
                            className={`analytics-chip ${mfType.length === 0 ? "active" : ""}`}
                            onClick={() => handleMultiFilterChange(setMfType, [])}
                          >All</button>
                          {mfTypes.map((type) => (
                            <span className="analytics-chip-selection" key={type}>
                              <button
                                className={`analytics-chip ${mfType.includes(type) ? "active" : ""}`}
                                aria-pressed={mfType.includes(type)}
                                onClick={() => handleMultiFilterChange(
                                  setMfType,
                                  mfType.includes(type)
                                    ? mfType.filter((selectedType) => selectedType !== type)
                                    : [...mfType, type]
                                )}
                              >{type}</button>
                              {mfType.includes(type) && (
                                <button
                                  type="button"
                                  className="analytics-chip-remove"
                                  aria-label={`Remove ${type} filter`}
                                  onClick={() => handleMultiFilterChange(
                                    setMfType,
                                    mfType.filter((selectedType) => selectedType !== type)
                                  )}
                                ><X size={11} /></button>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Divider */}
                      <div style={{ borderTop: "1px solid #f1f5f9", margin: "0 -2px" }} />

                      {/* Row: Status chips */}
                      <div className="mf-filter-row">
                        <span className="mf-filter-label">Status</span>
                        <div className="mf-type-chips">
                          {["Pending","Under Investigation","Resolved","All"].map(s => (
                            <button
                              key={s}
                              className={`filter-tab filter-tab-${s.toLowerCase().replace(/\s/g,"-")} ${mfStatus === s ? "active" : ""}`}
                              onClick={() => handleMultiFilterChange(setMfStatus, s)}
                            >{s}</button>
                          ))}
                        </div>
                      </div>

                      {/* Divider */}
                      <div style={{ borderTop: "1px solid #f1f5f9", margin: "0 -2px" }} />

                      {/* Row 2: Dropdowns inline */}
                      <div className="mf-filter-row mf-dropdowns-inline">
                        <div className="mf-inline-field">
                          <span className="mf-filter-label">Grade level</span>
                          <select className="mf-select" value={mfGrade} onChange={e => {
                            const grade = e.target.value;
                            handleMultiFilterChange(setMfGrade, grade);
                            if (mfSection !== "All" && grade !== "All" &&
                              !gradeSections.some((item) => item.grade === grade && item.section === mfSection)) {
                              handleMultiFilterChange(setMfSection, "All");
                            }
                          }}>
                            <option value="All">All grades</option>
                            {["Grade 7","Grade 8","Grade 9","Grade 10"].map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div className="mf-inline-field">
                          <span className="mf-filter-label">Gender</span>
                          <select className="mf-select" value={mfGender} onChange={e => handleMultiFilterChange(setMfGender, e.target.value)}>
                            <option value="All">All genders</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </div>
                        <div className="mf-inline-field">
                          <span className="mf-filter-label">Section</span>
                          <select className="mf-select" value={mfSection} onChange={e => handleMultiFilterChange(setMfSection, e.target.value)}>
                            <option value="All">All sections</option>
                            {sectionsForSelectedGrade.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="mf-inline-field">
                          <span className="mf-filter-label">Month</span>
                          <select className="mf-select" value={mfMonth} onChange={e => handleMultiFilterChange(setMfMonth, e.target.value)}>
                            <option value="All">All months</option>
                            {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="mf-inline-field">
                          <span className="mf-filter-label">Year</span>
                          <select className="mf-select" value={mfYear} onChange={e => handleMultiFilterChange(setMfYear, e.target.value)}>
                            <option value="All">All years</option>
                            {allYears.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Row 3: Clear Filters */}
                      <div className="mf-filter-row mf-clear-row">
                        <button
                          className={`mf-clear-filters-btn${mfHasFilters ? " active" : ""}`}
                          onClick={() => {
                            handleMultiFilterChange(setMfType, []);
                            handleMultiFilterChange(setMfGrade, "All");
                            handleMultiFilterChange(setMfGender, "All");
                            handleMultiFilterChange(setMfSection, "All");
                            handleMultiFilterChange(setMfStatus, "All");
                            handleMultiFilterChange(setMfMonth, "All");
                            handleMultiFilterChange(setMfYear, "All");
                          }}
                          disabled={!mfHasFilters}
                        >
                          <X size={13} /> Clear Filters
                          {mfHasFilters && <span className="mf-clear-count">{mfActiveTags.length} active</span>}
                        </button>
                      </div>
                    </div>

                    {/* Active filter tags */}
                    {mfHasFilters && (
                      <div className="mf-active-tags">
                        {mfActiveTags.map((tag, i) => (
                          <span key={i} className="mf-tag">
                            {tag.label}
                            <button className="mf-tag-x" onClick={tag.clear} aria-label={`Remove ${tag.label} filter`}>×</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Chart */}
                    <div className="analytics-chart-canvas-wrap" style={{ position: "relative", width: "100%", height: 300, marginTop: 16 }}>
                      <canvas ref={chartCanvasRef} role="img" aria-label="Bar chart showing filtered incidents by type" />
                    </div>

                    {/* Auto insight */}
                    <div className="analytics-insight-box">
                      <div>
                        <p className="analytics-insight-label">Auto-Generated Insight</p>
                        <p className="analytics-insight-text" dangerouslySetInnerHTML={{ __html: mfInsight }} />
                      </div>
                    </div>
                  </div>

                  {/* Location Breakdown card */}
                  <div className="card-panel analytics-location-panel">
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                      <div className="title-group" style={{ marginBottom: 0 }}>
                        <h3>Location Breakdown</h3>
                        <p className="panel-subtitle">Where bullying is most reported</p>
                      </div>
                      <button
                        className="analytics-add-place-btn"
                        onClick={openAddLocation}
                      >Add Place</button>
                    </div>

                    {/* Zone legend */}
                    <div className="analytics-zone-legend">
                      <span className="analytics-zone-chip inside">Inside School</span>
                      <span className="analytics-zone-chip outside">Outside / Other</span>
                    </div>

                    {/* Custom places are grouped by their configured zone. */}
                    {customLocations.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 8 }}>
                        {["inside", "outside"].map((zone) => {
                          const zoneLocations = customLocations.filter((loc) =>
                            (loc.zone === "outside" ? "outside" : "inside") === zone
                          );
                          if (zoneLocations.length === 0) return null;
                          const colors = ANALYTICS_LOCATION_COLORS[zone];
                          return (
                            <div key={zone}>
                              <p style={{ color: colors.text, fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
                                Custom places — {zone === "outside" ? "Outside / Other" : "Inside School"}
                              </p>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {zoneLocations.map((loc) => (
                                  <span key={loc.key} style={{
                                    display: "inline-flex", alignItems: "center", gap: 5,
                                    fontSize: 10.5, fontWeight: 700, padding: "3px 6px 3px 9px", borderRadius: 20,
                                    background: colors.soft,
                                    color: colors.text,
                                    border: `1px solid ${colors.border}`,
                                  }}>
                                    {loc.key}
                                    <button
                                      onClick={() => handleDeleteLocation(loc.key)}
                                      aria-label={`Remove ${loc.key}`}
                                      style={{
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        width: 16, height: 16, borderRadius: "50%", border: "none",
                                        background: "rgba(0,0,0,0.08)", color: "inherit", cursor: "pointer", padding: 0,
                                      }}
                                    ><X size={10} /></button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {locationSorted.length === 0 ? (
                      <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
                        No location data yet. Students need to include a location when submitting a report.
                      </p>
                    ) : (() => {
                      const locationTotalPages = Math.max(1, Math.ceil(locationSorted.length / LOCATION_PAGE_SIZE));
                      const locPage = Math.min(locationPage, locationTotalPages - 1);
                      const locationPageItems = locationSorted.slice(
                        locPage * LOCATION_PAGE_SIZE,
                        locPage * LOCATION_PAGE_SIZE + LOCATION_PAGE_SIZE
                      );
                      return (
                        <>
                          <div className="breakdown-list">
                            {locationPageItems.map(([loc, count]) => {
                              const pct   = Math.round((count / incidents.length) * 100);
                              const meta  = allLocationMeta.find((m) => m.key === loc);
                              const zone  = meta?.zone  || "inside";
                              const colors = ANALYTICS_LOCATION_COLORS[zone === "outside" ? "outside" : "inside"];
                              return (
                                <div className="bk-row" key={loc}>
                                  <div className="bk-top">
                                    <span className="bk-label">
                                      {loc}
                                      {zone === "outside" && (
                                        <span style={{
                                          marginLeft: 6, fontSize: 10, fontWeight: 700,
                                          color: ANALYTICS_LOCATION_COLORS.outside.text,
                                          background: ANALYTICS_LOCATION_COLORS.outside.soft,
                                          padding: "1px 6px", borderRadius: 8,
                                        }}>Outside</span>
                                      )}
                                    </span>
                                    <span className="bk-stats">
                                      <span className="bk-count">{count} incident{count !== 1 ? "s" : ""}</span>
                                      <span className="bk-pct" style={{ color: colors.text }}>{pct}%</span>
                                    </span>
                                  </div>
                                  <div className="bk-track">
                                    <div className="bk-fill" style={{ width: `${pct}%`, background: colors.bar }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {locationTotalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
                              <button
                                onClick={() => setLocationPage((p) => Math.max(0, p - 1))}
                                disabled={locPage === 0}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                                  border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                                  color: locPage === 0 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                                  cursor: locPage === 0 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                                }}
                              ><ChevronLeft size={14} /> Prev</button>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                                Page {locPage + 1} of {locationTotalPages}
                              </span>
                              <button
                                onClick={() => setLocationPage((p) => Math.min(locationTotalPages - 1, p + 1))}
                                disabled={locPage === locationTotalPages - 1}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                                  border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                                  color: locPage === locationTotalPages - 1 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                                  cursor: locPage === locationTotalPages - 1 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                                }}
                              >Next <ChevronRight size={14} /></button>
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Prefect Hotspot Alert */}
                    {topLocation && (
                      <div style={{
                        marginTop: 10, padding: "9px 11px", borderRadius: 9,
                        background: ANALYTICS_LOCATION_COLORS.outside.soft,
                        border: `1px solid ${ANALYTICS_LOCATION_COLORS.outside.border}`,
                      }}>
                        <div>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: ANALYTICS_LOCATION_COLORS.outside.text }}>
                            Prefect Hotspot Alert
                          </p>
                          <p style={{ margin: "3px 0 0", fontSize: 12, color: "#70474A", lineHeight: 1.5 }}>
                            <strong>{topLocation}</strong> has the most reported incidents ({locationCounts[topLocation]}).
                            Deploy prefects or increase monitoring in this area.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                </div>

                {/* ── Incident Records ── */}
                <section className="card-panel analytics-incident-records" style={{ marginBottom: 18 }}>
                  <div className="title-group">
                    <h3>Incident Records</h3>
                    <p className="panel-subtitle">
                      {recordsFiltered.length} record{recordsFiltered.length !== 1 ? "s" : ""}
                      {mfHasFilters ? " matching analytics filters" : " total"}
                    </p>
                  </div>
                  <div className="analytics-records-toolbar">
                    <label className="analytics-records-search">
                      <Search size={15} aria-hidden="true" />
                      <input
                        type="search"
                        aria-label="Search incident records"
                        placeholder="Search by ID, type, reporter, status..."
                        value={recordsSearch}
                        onChange={(event) => {
                          setRecordsSearch(event.target.value);
                          setRecordsPage(0);
                        }}
                      />
                    </label>
                    <div className="analytics-records-status" role="group" aria-label="Filter records by status">
                      {["Pending", "Under Investigation", "Resolved", "All"].map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={`filter-tab filter-tab-${status.toLowerCase().replace(/\s/g, "-")}${recordsStatus === status ? " active" : ""}`}
                          aria-pressed={recordsStatus === status}
                          onClick={() => {
                            setRecordsStatus(status);
                            setRecordsPage(0);
                          }}
                        >{status}</button>
                      ))}
                    </div>
                  </div>
                  {recordsFiltered.length === 0 ? (
                    <div className="analytics-records-empty">
                      <FileText size={30} aria-hidden="true" />
                      <p>
                        {incidents.length === 0
                          ? "No incidents have been reported yet."
                          : "No records match your search and filters."}
                      </p>
                    </div>
                  ) : (() => {
                    const recordsTotalPages = Math.max(1, Math.ceil(recordsFiltered.length / RECORDS_PAGE_SIZE));
                    const recPage = Math.min(recordsPage, recordsTotalPages - 1);
                    const pageStart = recPage * RECORDS_PAGE_SIZE;
                    const recordsPageItems = recordsFiltered.slice(pageStart, pageStart + RECORDS_PAGE_SIZE);
                    return (
                      <>
                        <p className="analytics-records-count">
                          Showing {pageStart + 1}–{Math.min(pageStart + RECORDS_PAGE_SIZE, recordsFiltered.length)} of {recordsFiltered.length} incident{recordsFiltered.length !== 1 ? "s" : ""}
                        </p>
                        <div className="analytics-records-list">
                          {recordsPageItems.map((report) => (
                            <article
                              className={`analytics-record-card${unseenReportIds.has(report.id) ? " unseen" : ""}`}
                              key={report.id}
                            >
                              <div className="analytics-record-top">
                                <div className="analytics-record-badges">
                                  <b className="case-id-cell">#{report.id}</b>
                                  {unseenReportIds.has(report.id) && <span className="incident-new-badge">NEW</span>}
                                  <span className="type-chip">{report.type}</span>
                                  {report.priority && <span className={`priority-badge ${report.priority}`}>{report.priority}</span>}
                                </div>
                                <div className="analytics-record-actions">
                                  <span className={`status-badge ${(report.status || "").toLowerCase().replace(/\s/g, "-")}`}>{report.status}</span>
                                  <button className="read-btn tiny" onClick={() => handleOpenManage(report)}>Manage</button>
                                </div>
                              </div>
                              {report.description && <p className="analytics-record-description">{report.description}</p>}
                              <div className="analytics-record-meta">
                                <span>
                                  {report.isAnonymous ? <Shield size={12} aria-hidden="true" /> : <User size={12} aria-hidden="true" />}
                                  {report.isAnonymous ? "Anonymous" : report.submittedBy}
                                </span>
                                <span><Calendar size={12} aria-hidden="true" />{report.date}</span>
                                {report.location && <span><MapPin size={12} aria-hidden="true" />{report.location}</span>}
                              </div>
                            </article>
                          ))}
                        </div>
                        {recordsTotalPages > 1 && (
                          <div className="analytics-records-pagination">
                            <button type="button" onClick={() => setRecordsPage((page) => Math.max(0, page - 1))} disabled={recPage === 0}>
                              <ChevronLeft size={14} /> Prev
                            </button>
                            <span>Page {recPage + 1} of {recordsTotalPages}</span>
                            <button type="button" onClick={() => setRecordsPage((page) => Math.min(recordsTotalPages - 1, page + 1))} disabled={recPage === recordsTotalPages - 1}>
                              Next <ChevronRight size={14} />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </section>

                {/* Recommendations */}
                <div className="card-panel analytics-recommendations">
                  <div className="title-group">
                    <h3>Recommended next steps</h3>
                    <p className="panel-subtitle">Suggestions based on current incident data</p>
                  </div>
                  <ul>
                    {recs.map((rec, i) => (
                      <li key={i}>
                        <span>{i + 1}.</span>{rec}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            </>
            )}
          </div>
        )}
        {activeTab === "student-offenses" && <StudentOffenseRecords />}

        {/* ══════════════════════════════
            AWARENESS HUB TAB
        ══════════════════════════════ */}
        {activeTab === "awareness" && (
          <div className="admin-content awareness-admin-page">
            <div className="panel-header-flex awareness-admin-header" style={{ marginBottom: 18 }}>
              <div className="title-group">
                <h3>Awareness Content</h3>
                <p className="panel-subtitle">Manage content shown to students on the Awareness Hub</p>
              </div>
              <button className="add-content-btn" onClick={openNewAwareness}>
                <Plus size={14} /> Add Content
              </button>
            </div>
            <div className="awareness-admin-grid">
              {awarenessList.map((item) => (
                <div className="awareness-admin-card" key={item.id}>
                  <span className={`awareness-type-badge awareness-type-${item.type}`}>{item.type}</span>
                  {item.type === "video" ? (
                    getYouTubeThumbnail(item.videoUrl) ? (
                      <img src={getYouTubeThumbnail(item.videoUrl)} alt={`${item.title} video thumbnail`}
                        loading="lazy" decoding="async"
                        style={{ width: "100%", height: 120, borderRadius: 8, objectFit: "cover", marginTop: 10 }} />
                    ) : (
                      <div className="awareness-thumbnail-empty" style={{ minHeight: 80, marginTop: 10 }}>
                        Video thumbnail unavailable
                      </div>
                    )
                  ) : item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title}
                      loading="lazy" decoding="async"
                      style={{ width: "100%", maxHeight: 120, borderRadius: 8, objectFit: "cover", marginTop: 10 }} />
                  ) : (
                    <div className="awareness-resource-icon" style={{ width: 40, height: 40, marginTop: 10 }}>
                      {item.type === "infographic" && <Image size={18} />}
                      {item.type === "resource" && <BookOpen size={18} />}
                    </div>
                  )}
                  <h4>{item.title}</h4>
                  {item.desc && <p>{item.desc}</p>}
                  <div className="awareness-card-actions">
                    <button className="read-btn small" onClick={() => openEditAwareness(item)}><Edit size={12} /> Edit</button>
                    <button className="delete-btn small" onClick={() => handleDeleteAwareness(item.id)}><Trash2 size={12} /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════
            CONFIRMATIONS TAB
        ══════════════════════════════ */}
        {activeTab === "confirmations" && (
          <div className="admin-content admin-confirmations-page">
            <section className="card-panel account-section">
              <div className="title-group account-section-heading">
                <h3>Awaiting Email Confirmation</h3>
                <p className="panel-subtitle">
                  Signed up but haven't entered their Brevo verification code yet — they'll move to the queue below once verified.
                </p>
              </div>

              {unconfirmedError ? (
                <p className="account-alert account-alert-error">
                  Couldn't load this list: {unconfirmedError}
                </p>
              ) : unconfirmedSignups.length === 0 ? (
                <p className="account-empty-state">
                  No sign-ups waiting for email verification right now.
                </p>
              ) : (
                <div className="account-request-list">
                  {unconfirmedSignups.map((s) => (
                    <div key={s.id} className="account-request-row">
                      <div className="account-request-info">
                        <div className="account-request-title">
                          <strong>{s.name || "(name unavailable)"}</strong>
                          <span className="account-request-status verifying">Verifying email</span>
                        </div>
                        <div className="account-request-meta">
                          <span>{s.email}</span>
                          <span>LRN {s.lrn || "—"}</span>
                          <span>{s.grade || "—"} · {s.section || "—"}</span>
                          <span>Signed up {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="account-action-button resend"
                        onClick={() => handleResendConfirmation(s.email)}
                      >Resend Code</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card-panel account-section">
              <div className="title-group account-section-heading">
                <h3>Account Confirmations</h3>
                <p className="panel-subtitle">
                  Verified student sign-ups land here — approve or decline before they can log in.
                </p>
              </div>

              {studentAccountsError && (
                <p className="account-alert account-alert-error">
                  Couldn't load student accounts: {studentAccountsError}
                </p>
              )}
              {pendingAccountsError && (
                <p className="account-alert account-alert-error">
                  Couldn't load the approval queue: {pendingAccountsError}
                </p>
              )}
              {studentAccountsLoading && pendingAccounts.length === 0 ? (
                <p className="account-empty-state">Loading student accounts…</p>
              ) : !pendingAccountsError && pendingAccounts.length === 0 && !hasMorePendingAccounts ? (
                <p className="account-empty-state">
                  No accounts waiting for admin approval right now.
                </p>
              ) : pendingAccounts.length > 0 ? (
                <div className="account-request-list">
                  {pendingAccounts.map((s) => (
                    <div key={s.id} className="account-request-row">
                      <div className="account-request-info">
                        <div className="account-request-title">
                          <strong>{s.name}</strong>
                          <span className="account-request-status pending">Pending approval</span>
                        </div>
                        <div className="account-request-meta">
                          <span>{s.email}</span>
                          <span>LRN {s.lrn || "—"}</span>
                          <span>{s.grade || "—"} · {s.section || "—"}</span>
                          <span>Registered {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</span>
                        </div>
                      </div>
                      <div className="account-request-actions">
                        <button
                          type="button"
                          className="account-action-button view-id"
                          onClick={() => handleViewStudentId(s)}
                        ><Image size={14} /> View ID Photos</button>
                        <button
                          type="button"
                          className="account-action-button approve"
                          onClick={() => handleApproveAccount(s.id, s.name)}
                        ><UserCheck size={14} /> Approve</button>
                        <button
                          type="button"
                          className="account-action-button decline"
                          onClick={() => handleDeclineAccount(s.id, s.name)}
                        ><X size={14} /> Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {(pendingAccountPage > 0 || hasMorePendingAccounts) && (
                <div className="account-pagination">
                  <span>Pending approvals · Page {pendingAccountPage + 1}</span>
                  <div className="account-pagination-actions">
                    <button className="read-btn tiny" disabled={pendingAccountPage === 0} onClick={() => setPendingAccountPage((page) => page - 1)}>Previous</button>
                    <button className="read-btn tiny" disabled={!hasMorePendingAccounts} onClick={() => setPendingAccountPage((page) => page + 1)}>Next</button>
                  </div>
                </div>
              )}
            </section>

            <section className="card-panel account-section account-directory-section">
              <div className="title-group account-section-heading">
                <h3>All Student Accounts</h3>
                <p className="panel-subtitle">
                  Verified student profiles, including pending and approved accounts.
                </p>
              </div>
              {studentAccountsLoading && studentAccounts.length === 0 ? (
                <p className="account-empty-state">
                  Loading student accounts…
                </p>
              ) : studentAccountsError && studentAccounts.length === 0 ? (
                <p className="account-alert account-alert-error">
                  Student accounts could not be loaded. Check the error above and try again.
                </p>
              ) : studentAccounts.length === 0 ? (
                <p className="account-empty-state">
                  No verified student accounts yet. Sign-ups awaiting email verification are listed above.
                </p>
              ) : (
                <div className="table-container">
                  <table className="cases-table compact account-table">
                    <thead>
                      <tr><th>Name</th><th>Email</th><th>LRN</th><th>Grade</th><th>Section</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {studentAccounts.map((s) => (
                        <tr key={s.id}>
                          <td className="account-name-cell">{s.name}</td>
                          <td title={s.email}>{s.email}</td>
                          <td>{s.lrn || "—"}</td>
                          <td><span className={`account-grade-badge account-grade-badge--${getAccountGradeClass(s.grade)}`}>{s.grade || "—"}</span></td>
                          <td>{s.section || "—"}</td>
                          <td>
                            <span className={`status-badge ${s.approved ? "resolved" : "pending"}`}>
                              {s.approved ? "Approved" : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(studentAccountPage > 0 || hasMoreStudentAccounts) && (
                <div className="account-pagination">
                  <span>Student accounts · Page {studentAccountPage + 1}</span>
                  <div className="account-pagination-actions">
                    <button className="read-btn tiny" disabled={studentAccountPage === 0} onClick={() => setStudentAccountPage((page) => page - 1)}>Previous</button>
                    <button className="read-btn tiny" disabled={!hasMoreStudentAccounts} onClick={() => setStudentAccountPage((page) => page + 1)}>Next</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ══════════════════════════════
            GRADE & SECTIONS TAB
        ══════════════════════════════ */}
        {activeTab === "sections" && (
          <div className="admin-content">
            <div className="card-panel grade-management-panel">
              <div className="title-group grade-management-title">
                <h3>Grade & Section Management</h3>
                <p className="panel-subtitle">Manage sections and advisers for each grade level.</p>
              </div>

              {/* Grade selector */}
              <div className="mf-filter-row grade-management-grade-row">
                <span className="mf-filter-label">Grade level</span>
                <div className="mf-type-chips">
                  {["Grade 7", "Grade 8", "Grade 9", "Grade 10"].map((g) => (
                    <button
                      key={g}
                      className={`analytics-chip ${sectionMgmtGrade === g ? "active" : ""}`}
                      onClick={() => setSectionMgmtGrade(g)}
                    >{g}</button>
                  ))}
                </div>
              </div>

              {/* Add section */}
              <div className="grade-sections-add-row">
                <input
                  className="grade-sections-add-input"
                  placeholder={`e.g. Rizal — new section under ${sectionMgmtGrade}`}
                  aria-label="Section name"
                  maxLength={100}
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
                />
                <input
                  className="grade-sections-add-input"
                  placeholder="Adviser's name"
                  aria-label="Section adviser"
                  maxLength={100}
                  value={newSectionAdviser}
                  onChange={(e) => setNewSectionAdviser(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
                />
                <button
                  type="button"
                  className="grade-sections-add-button"
                  onClick={handleAddSection}
                >Add Section</button>
              </div>

              {/* Sections for the selected grade */}
              <h4 className="grade-sections-heading">
                Sections under {sectionMgmtGrade}
              </h4>

              {gradeSections.filter((s) => s.grade === sectionMgmtGrade).length === 0 ? (
                <div className="grade-sections-empty">No sections added yet.</div>
              ) : (
                <div className="grade-sections-table-wrap">
                  <table className="grade-sections-table">
                    <thead>
                      <tr>
                        <th scope="col">Section Name</th>
                        <th scope="col">Adviser</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradeSections.filter((s) => s.grade === sectionMgmtGrade).map((s) => (
                        <tr key={s.id}>
                          <td>
                            {editingSectionId === s.id ? (
                              <input
                                className="grade-section-edit-input"
                                aria-label={`New name for ${s.section}`}
                                value={editingSectionName}
                                onChange={(event) => setEditingSectionName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") handleSaveSection(s.id, s.grade);
                                  if (event.key === "Escape") {
                                    setEditingSectionId(null);
                                    setEditingSectionName("");
                                    setEditingSectionAdviser("");
                                  }
                                }}
                                autoFocus
                              />
                            ) : s.section}
                          </td>
                          <td>
                            {editingSectionId === s.id ? (
                              <input
                                className="grade-section-edit-input"
                                aria-label={`Adviser for ${s.section}`}
                                value={editingSectionAdviser}
                                onChange={(event) => setEditingSectionAdviser(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") handleSaveSection(s.id, s.grade);
                                  if (event.key === "Escape") {
                                    setEditingSectionId(null);
                                    setEditingSectionName("");
                                    setEditingSectionAdviser("");
                                  }
                                }}
                                maxLength={100}
                              />
                            ) : s.adviser || "Unassigned"}
                          </td>
                          <td>
                            <div className="grade-sections-actions">
                              {editingSectionId === s.id ? (
                                <>
                                  <button type="button" className="grade-section-action edit" aria-label={`Save ${s.section}`} title="Save" onClick={() => handleSaveSection(s.id, s.grade)}>
                                    <CheckCircle size={14} /> <span>Save</span>
                                  </button>
                                  <button type="button" className="grade-section-action cancel" aria-label={`Cancel editing ${s.section}`} title="Cancel" onClick={() => { setEditingSectionId(null); setEditingSectionName(""); setEditingSectionAdviser(""); }}>
                                    <X size={14} /> <span>Cancel</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className="grade-section-action edit" aria-label={`Edit ${s.section}`} title="Edit" onClick={() => { setEditingSectionId(s.id); setEditingSectionName(s.section); setEditingSectionAdviser(s.adviser || ""); }}>
                                    <Edit size={14} /> <span>Edit</span>
                                  </button>
                                  <button type="button" className="grade-section-action delete" aria-label={`Delete ${s.section}`} title="Delete" onClick={() => handleDeleteSection(s.id, s.section)}>
                                    <Trash2 size={14} /> <span>Delete</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Overview across all grades */}
              <div className="grade-management-overview">
                <h4 className="grade-management-overview-heading">
                  Overview — all grades
                </h4>
                <div className="grade-management-overview-grid">
                  {["Grade 7", "Grade 8", "Grade 9", "Grade 10"].map((g) => {
                    const count = gradeSections.filter((s) => s.grade === g).length;
                    return (
                      <div className="grade-management-overview-card" key={g}>
                        <p className="grade-management-overview-grade">{g}</p>
                        <p className="grade-management-overview-count">
                          {count} <span>section{count !== 1 ? "s" : ""}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ══════════════════════════════
          MANAGE INCIDENT MODAL
      ══════════════════════════════ */}
      {showUpdateModal && selectedReport && (
        <div className="admin-modal-overlay">
          <div className="admin-modal large admin-incident-modal">
            <div className="modal-header-admin">
              <div className="title-wrap">
                <FileText size={18} color="var(--accent-color)" />
                <h3>Manage Incident — Report #{selectedReport.id}</h3>
              </div>
              <X size={20} className="close-modal-btn" onClick={() => setShowUpdateModal(false)} />
            </div>

            <div className="admin-modal-content">
              <section className="incident-info-section" aria-labelledby="incident-overview-title">
                <h4 id="incident-overview-title">Incident overview</h4>
              <div className="modal-section-grid">
                <div className="detail-group">
                  <label>Type of Incident</label>
                  <div className="detail-value highlighted">{selectedReport.type}</div>
                </div>
                <div className="detail-group">
                  <label>Submitted By</label>
                  <div className="detail-value">
                    {selectedReport.isAnonymous
                      ? <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontStyle: "italic" }}>
                          🕵️ Anonymous <span style={{ fontSize: 11, background: "#f1f5f9", color: "#64748b", padding: "2px 7px", borderRadius: 10, fontStyle: "normal" }}>Identity Hidden</span>
                        </span>
                      : (selectedReport.submittedBy || "—")}
                  </div>
                </div>
                <div className="detail-group">
                  <label>Reporter role</label>
                  <div className="detail-value">
                    {selectedReport.reporterType === "Friend"
                      ? "Friend of victim"
                      : selectedReport.reporterType || "—"}
                  </div>
                </div>
                <div className="detail-group">
                  <label>Date of Incident</label>
                  <div className="detail-value">{formatConferenceDate(selectedReport.date)}</div>
                </div>
                <div className="detail-group">
                  <label>Approximate Time</label>
                  <div className="detail-value">{to12Hour(selectedReport.time)}</div>
                </div>
                <div className="detail-group">
                  <label>Location</label>
                  <div className="detail-value">{selectedReport.location || "—"}</div>
                </div>
                {!selectedReport.isAnonymous && selectedReport.reporterAge && (
                  <div className="detail-group">
                    <label>Reporter age</label>
                    <div className="detail-value">{selectedReport.reporterAge}</div>
                  </div>
                )}
                {!selectedReport.isAnonymous && selectedReport.reporterSex && (
                  <div className="detail-group">
                    <label>Reporter sex</label>
                    <div className="detail-value">{selectedReport.reporterSex}</div>
                  </div>
                )}
                {!selectedReport.isAnonymous && selectedReport.reporterGrade && (
                  <div className="detail-group">
                    <label>Reporter grade</label>
                    <div className="detail-value">{selectedReport.reporterGrade}</div>
                  </div>
                )}
                {!selectedReport.isAnonymous && selectedReport.reporterSection && (
                  <div className="detail-group">
                    <label>Reporter section</label>
                    <div className="detail-value">{selectedReport.reporterSection}</div>
                  </div>
                )}
              </div>
              </section>

              <section className="manage-conference-section">
                <div className="manage-conference-heading">
                  <div>
                    <Calendar size={17} />
                    <h4>Conference Schedule</h4>
                  </div>
                  {hasSelectedConference && <span className="admin-conference-case">Case #{selectedReport.id}</span>}
                </div>

                {!hasSelectedConference ? (
                  <div className="manage-conference-empty">
                    <strong>No Conference Scheduled</strong>
                    <p>Schedule a conference for this incident when needed.</p>
                    {!conferenceEditing && (
                      <button
                        type="button"
                        className="manage-conference-button primary"
                        onClick={() => setConferenceEditing(true)}
                      >
                        <Plus size={15} /> Schedule Conference
                      </button>
                    )}
                    {conferenceEditing && (
                      <div className="manage-conference-editor">
                        <div className="manage-conference-fields">
                          <label>Date<input type="date" value={conferenceDate} onChange={(event) => setConferenceDate(event.target.value)} /></label>
                          <label>Time<input type="time" value={conferenceTime} onChange={(event) => setConferenceTime(event.target.value)} /></label>
                          <label className="wide">Location<input type="text" value={conferenceLocation} onChange={(event) => setConferenceLocation(event.target.value)} placeholder="Prefect Office, Guidance Room, or virtual link" /></label>
                          <label className="wide">Agenda / Notes<textarea value={conferenceNotes} onChange={(event) => setConferenceNotes(event.target.value)} rows={2} placeholder="What the meeting will cover or who should attend" /></label>
                          {hasSelectedConference && (
                            <label className="wide">Reschedule reason *
                              <textarea value={conferenceRescheduleReason} onChange={(event) => setConferenceRescheduleReason(event.target.value)} rows={2} placeholder="Why is the meeting being rescheduled?" required />
                            </label>
                          )}
                        </div>
                        <div className="manage-conference-actions">
                          <button type="button" className="manage-conference-button" onClick={() => setConferenceEditing(false)} disabled={conferenceActionSaving}>Cancel</button>
                          <button type="button" className="manage-conference-button primary" onClick={handleSaveManagedConference} disabled={conferenceActionSaving}>
                            {conferenceActionSaving ? "Saving..." : "Schedule Conference"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={`manage-conference-card ${selectedConferenceStatus.toLowerCase().replace(/\s/g, "-")}`}>
                    <div className="manage-conference-card-heading">
                      <strong>Conference Schedule</strong>
                      <span className={`manage-conference-badge ${selectedConferenceStatus.toLowerCase().replace(/\s/g, "-")}`}>
                        {selectedConferenceStatus === "Completed" && <CheckCircle size={14} />}
                        {selectedConferenceStatus === "No-show" && <AlertTriangle size={14} />}
                        {selectedConferenceStatus}
                      </span>
                    </div>

                    {selectedConferenceStatus === "Cancelled" ? (
                      <>
                        <div className="manage-conference-details">
                          <div><span>Original Date</span><strong>{formatConferenceDate(selectedConference.cancellationSchedule?.date || selectedConference.date)}</strong></div>
                          <div><span>Original Time</span><strong>{to12Hour(selectedConference.cancellationSchedule?.time || selectedConference.time)}</strong></div>
                          <div><span>Location</span><strong>{selectedConference.cancellationSchedule?.location || selectedConference.location || "—"}</strong></div>
                        </div>
                        <p className="manage-conference-reason"><strong>Cancellation Reason:</strong> {selectedConference.cancellationReason || selectedConferenceRequest?.reason || "No reason provided."}</p>
                      </>
                    ) : (
                      <>
                        {selectedConferenceStatus === "Reschedule Requested" && (
                          <p className="manage-conference-current-schedule">
                            <strong>Current Schedule:</strong> {formatConferenceDate(selectedConference.date)} • {to12Hour(selectedConference.time)}
                          </p>
                        )}
                        <div className="manage-conference-details">
                          <div><span>Date</span><strong>{formatConferenceDate(selectedConference.date)}</strong></div>
                          <div><span>Time</span><strong>{to12Hour(selectedConference.time)}</strong></div>
                          <div><span>Location</span><strong>{selectedConference.location || "—"}</strong></div>
                          {selectedConferenceStatus !== "No-show" && (
                            <div className="manage-conference-notes"><span>Agenda / Notes</span><strong>{selectedConference.notes || "—"}</strong></div>
                          )}
                        </div>
                        {(selectedConference.rescheduledFrom || selectedConference.previousSchedule?.date) && (
                          <p className="manage-conference-current-schedule">
                            Rescheduled from {selectedConference.rescheduledFrom || selectedConference.previousSchedule.date}
                          </p>
                        )}
                        {selectedConferenceStatus === "Completed" && (
                          <>
                            <p className="manage-conference-completed-on">
                              <strong>Completed on:</strong> {formatConferenceDate(selectedConference.completedAt)}
                            </p>
                            <div className="manage-conference-findings">
                              <label htmlFor="conference-findings">Conference findings</label>
                              <textarea
                                id="conference-findings"
                                value={conferenceFindingsDraft}
                                onChange={(event) => setConferenceFindingsDraft(event.target.value)}
                                rows={4}
                                placeholder="Document the conference discussion and findings."
                              />
                              <p>Findings are saved separately from the schedule. Completing a conference does not create an offense record.</p>
                              <button type="button" className="manage-conference-button primary" onClick={handleSaveConferenceFindings} disabled={conferenceFindingsSaving || !conferenceFindingsDraft.trim()}>
                                {conferenceFindingsSaving ? "Saving findings…" : "Save Conference Findings"}
                              </button>
                            </div>
                          </>
                        )}
                        {selectedConferenceStatus === "Reschedule Requested" && (
                          <p className="manage-conference-reason">
                            <strong>Student's Reason:</strong> {selectedConferenceRequest?.reason || "No reason provided."}
                          </p>
                        )}
                        {selectedConferenceStatus === "Cancellation Requested" && (
                          <p className="manage-conference-reason">
                            <strong>Student's Reason:</strong> {selectedConferenceRequest?.reason || "No reason provided."}
                          </p>
                        )}
                      </>
                    )}

                    {conferenceEditing && (
                      <div className="manage-conference-editor">
                        <div className="manage-conference-fields">
                          <label>Date<input type="date" value={conferenceDate} onChange={(event) => setConferenceDate(event.target.value)} /></label>
                          <label>Time<input type="time" value={conferenceTime} onChange={(event) => setConferenceTime(event.target.value)} /></label>
                          <label className="wide">Location<input type="text" value={conferenceLocation} onChange={(event) => setConferenceLocation(event.target.value)} placeholder="Prefect Office, Guidance Room, or virtual link" /></label>
                          <label className="wide">Agenda / Notes<textarea value={conferenceNotes} onChange={(event) => setConferenceNotes(event.target.value)} rows={2} placeholder="What the meeting will cover or who should attend" /></label>
                          <label className="wide">Reschedule reason *
                            <textarea value={conferenceRescheduleReason} onChange={(event) => setConferenceRescheduleReason(event.target.value)} rows={2} placeholder="Why is the meeting being rescheduled?" required />
                          </label>
                        </div>
                        <div className="manage-conference-actions">
                          <button type="button" className="manage-conference-button" onClick={() => setConferenceEditing(false)} disabled={conferenceActionSaving}>Keep Current Schedule</button>
                          <button type="button" className="manage-conference-button primary" onClick={handleSaveManagedConference} disabled={conferenceActionSaving}>
                            {conferenceActionSaving ? "Saving..." : hasSelectedConference ? "Save Schedule" : "Schedule Conference"}
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedConferenceRequest?.state === "Pending" && selectedConferenceStatus === "Reschedule Requested" && (
                      <div className="manage-conference-editor">
                        <p className="manage-conference-request-title">Select the approved new schedule</p>
                        <div className="manage-conference-fields">
                          <label>New Date<input type="date" value={conferenceDate} onChange={(event) => setConferenceDate(event.target.value)} /></label>
                          <label>New Time<input type="time" value={conferenceTime} onChange={(event) => setConferenceTime(event.target.value)} /></label>
                          <label className="wide">New Location<input type="text" value={conferenceLocation} onChange={(event) => setConferenceLocation(event.target.value)} /></label>
                          <label className="wide">Agenda / Notes<textarea value={conferenceNotes} onChange={(event) => setConferenceNotes(event.target.value)} rows={2} /></label>
                        </div>
                      </div>
                    )}

                    {selectedConferenceStatus === "Cancellation Requested" && selectedConferenceRequest?.state === "Pending" && (
                      <div className="manage-conference-request-banner">
                        Student cancellation request awaiting Prefect review.
                      </div>
                    )}

                    {conferenceCanceling && ["Scheduled", "Rescheduled"].includes(selectedConferenceStatus) && (
                      <div className="manage-conference-cancel-form">
                        <label htmlFor="conference-cancel-reason">Cancellation reason</label>
                        <textarea
                          id="conference-cancel-reason"
                          rows={2}
                          value={conferenceCancelReason}
                          onChange={(event) => setConferenceCancelReason(event.target.value)}
                          placeholder="Explain why this conference is being cancelled"
                        />
                        <div className="manage-conference-actions">
                          <button type="button" className="manage-conference-button" onClick={() => setConferenceCanceling(false)} disabled={conferenceActionSaving}>Keep Conference</button>
                          <button type="button" className="manage-conference-button danger" onClick={handleCancelManagedConference} disabled={conferenceActionSaving}>
                            {conferenceActionSaving ? "Saving..." : "Confirm Cancellation"}
                          </button>
                        </div>
                      </div>
                    )}

                    {!conferenceEditing && selectedConferenceRequest?.state === "Pending" && (
                      <div className="manage-conference-actions">
                        <button
                          type="button"
                          className="manage-conference-button"
                          onClick={() => handleReviewManagedConferenceRequest("reject")}
                          disabled={conferenceActionSaving}
                        >
                          Reject Request
                        </button>
                        <button
                          type="button"
                          className="manage-conference-button primary"
                          onClick={() => handleReviewManagedConferenceRequest("approve")}
                          disabled={conferenceActionSaving}
                        >
                          {conferenceActionSaving ? "Saving..." : selectedConferenceStatus === "Reschedule Requested" ? "Approve & Reschedule" : "Approve Cancellation"}
                        </button>
                      </div>
                    )}

                    {!conferenceEditing && selectedConferenceRequest?.state !== "Pending" && ["Scheduled", "Rescheduled"].includes(selectedConferenceStatus) && (
                      <div className="manage-conference-actions">
                        <button type="button" className="manage-conference-button" onClick={() => setConferenceEditing(true)}>Edit Schedule</button>
                        {!conferenceCanceling && (
                          <button type="button" className="manage-conference-button danger" onClick={() => setConferenceCanceling(true)}>Cancel Conference</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="incident-info-section" aria-labelledby="incident-details-title">
                <h4 id="incident-details-title">Incident details</h4>
                <div className="incident-narrative-grid">
                  <div className="detail-group">
                    <label>What happened?</label>
                    <div className="description-display">{selectedReport.description || "No description provided."}</div>
                  </div>
                  <div className="detail-group">
                    <label>Events leading to the incident</label>
                    <div className="description-display">{selectedReport.descriptionLeadUp || "No prior events or context provided."}</div>
                  </div>
                  <div className="detail-group">
                    <label>Impact on the victim</label>
                    <div className="description-display">{selectedReport.descriptionImpact || "No impact details provided."}</div>
                  </div>
                </div>
              </section>

              <section className="incident-info-section" aria-labelledby="incident-people-title">
                <h4 id="incident-people-title">People involved</h4>
                <div className="involved-display">
                  {involvedGroups.length > 0 ? (
                    involvedGroups.map((group) => (
                      <div className="involved-group" key={group.label}>
                        <h5>{group.label}</h5>
                        <div className="involved-people-grid">
                          {group.people.map((person, index) => {
                            const grade = formatGrade(cleanDisplayValue(person.grade));
                            const details = [
                              cleanDisplayValue(person.age) && { label: "Age", value: cleanDisplayValue(person.age) },
                              grade && { label: "Grade", value: grade },
                              cleanDisplayValue(person.section) && { label: "Section", value: cleanDisplayValue(person.section) },
                            ].filter(Boolean);
                            const parentName = cleanDisplayValue(person.parentName);
                            const parentContact = cleanDisplayValue(person.parentContact);

                            return (
                              <article className="involved-person-card" key={`${group.label}-${index}`}>
                                <h6>{cleanDisplayValue(person.name) || "Name not provided"}</h6>
                                {details.length > 0 && (
                                  <div className="involved-person-details">
                                    {details.map((detail) => (
                                      <span key={detail.label}><b>{detail.label}</b>{detail.value}</span>
                                    ))}
                                  </div>
                                )}
                                {(parentName || parentContact) && (
                                  <div className="involved-guardian-details">
                                    <span className="involved-guardian-label">Parent / Guardian</span>
                                    {parentName && <span>{parentName}</span>}
                                    {parentContact && <span>{parentContact}</span>}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : cleanDisplayValue(selectedReport.involved) || "No people involved were specified."}
                </div>
              </section>

              {/* Evidence */}
              {selectedReport.evidenceCount > 0 && !selectedReport.evidenceLoaded && (
                <section className="incident-info-section incident-evidence-section">
                  <h4>Evidence ({selectedReport.evidenceCount} file{selectedReport.evidenceCount > 1 ? "s" : ""})</h4>
                  <button type="button" className="read-btn tiny" onClick={loadManagedEvidence} disabled={selectedReport.evidenceLoading}>
                    {selectedReport.evidenceLoading ? "Loading evidence…" : "View attached evidence"}
                  </button>
                  {selectedReport.evidenceError && <p role="alert" style={{ color: "#b91c1c", fontSize: 12, marginTop: 7 }}>{selectedReport.evidenceError}</p>}
                </section>
              )}
              {selectedReport.evidenceLoaded && selectedReport.evidence && selectedReport.evidence.length > 0 && (
                <section className="incident-info-section incident-evidence-section">
                  <h4>Evidence ({selectedReport.evidence.length} file{selectedReport.evidence.length > 1 ? "s" : ""})</h4>
                  <div className="s-evidence-row">
                    {selectedReport.evidence.map((ev, idx) =>
                      ev.type && ev.type.startsWith("image/") ? (
                        <div key={idx} style={{ position: "relative", cursor: "zoom-in" }} onClick={() => setLightboxSrc(ev.data)}>
                          <img src={ev.data} alt={ev.name} loading="lazy"
                            style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "2px solid #d1fae5" }} />
                          <ZoomIn size={14} style={{ position: "absolute", bottom: 4, right: 4, color: "white", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} />
                        </div>
                      ) : (
                        <div key={idx} className="s-file-chip">
                          <Paperclip size={11} /> {ev.name}
                        </div>
                      )
                    )}
                  </div>
                </section>
              )}

              <div className="admin-management-section incident-management">
                <div className="title-stack">
                  <h4>Update incident</h4>
                </div>
                <div className="form-group">
                  <label>Case status</label>
                  <select className="professional-select" style={{ width: "100%" }}
                    value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    <option value="Pending">Pending</option>
                    <option value="Under Investigation">Under Investigation</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label>Staff notes <span style={{ color: "#ef4444" }}>*</span> <span className="incident-student-visible">(visible to student)</span></label>
                  <textarea placeholder="Add investigation notes or next steps…"
                    className={manageFieldErrors.adminNotes ? "field-error" : ""}
                    style={{ minHeight: 90, fontSize: 13 }}
                    value={adminNotes} onChange={(e) => { setAdminNotes(e.target.value); setManageFieldErrors((p) => ({ ...p, adminNotes: false })); }} />
                  {manageFieldErrors.adminNotes && <span className="field-error-msg">Staff notes are required.</span>}
                </div>
                <details className="incident-more-info">
                  <summary>Request more information from the student</summary>
                  <section className="admin-proof-request" aria-label="Request more information">
                    <label htmlFor="admin-proof-request-message">What details or evidence are needed?</label>
                    <textarea
                      id="admin-proof-request-message"
                      placeholder="Explain what the student should provide."
                      maxLength={1000}
                      rows={3}
                      value={additionalInfoRequest}
                      onChange={(event) => setAdditionalInfoRequest(event.target.value)}
                    />
                    <div className="admin-proof-request-footer">
                      <span className="admin-proof-request-hint">The student will see this request.</span>
                      <span className="admin-proof-request-count">{additionalInfoRequest.length}/1000</span>
                    </div>
                    <button
                      type="button"
                      className="admin-proof-request-submit"
                      onClick={handleRequestMoreInfo}
                      disabled={additionalInfoSaving}
                    >
                      <Send size={15} />
                      {additionalInfoSaving ? "Sending…" : "Send request"}
                    </button>
                  </section>
                </details>
              </div>
            </div>

            <div className="modal-footer-bar">
              <button className="cancel-btn" onClick={() => setShowUpdateModal(false)}>Close</button>
              <button className="submit-btn" onClick={handleConfirmUpdate}>Update incident</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════
          AWARENESS MODAL
      ══════════════════════════════ */}
      {showAwarenessModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal" style={{ maxWidth: 560 }}>
            <div className="modal-header-admin">
              <div className="title-wrap">
                <BookOpen size={18} color="var(--accent-color)" />
                <h3>{editingAwareness !== null ? "Edit" : "New"} Awareness Content</h3>
              </div>
              <X size={20} className="close-modal-btn" onClick={() => setShowAwarenessModal(false)} />
            </div>
            <div className="admin-modal-content">
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Content Type</label>
                <select className="professional-select" style={{ width: "100%" }}
                  value={aForm.type} onChange={(e) => setAForm({ ...aForm, type: e.target.value })}>
                  <option value="infographic">Infographic</option>
                  <option value="video">Video</option>
                  <option value="resource">Resource</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Title *</label>
                <input style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, width: "100%" }}
                  placeholder="Enter content title"
                  value={aForm.title} onChange={(e) => setAForm({ ...aForm, title: e.target.value })} />
              </div>
              {aForm.type !== "video" && (
                <>
                  <div className="form-group" style={{ marginBottom: 14 }}>
                    <label>Description</label>
                    <textarea style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, minHeight: 80, width: "100%", resize: "vertical" }}
                      placeholder="Brief description…"
                      value={aForm.desc} onChange={(e) => setAForm({ ...aForm, desc: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 14 }}>
                    <label>Link (URL or leave blank)</label>
                    <input style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, width: "100%" }}
                      placeholder="https://example.com"
                      value={aForm.link === "#" ? "" : aForm.link}
                      onChange={(e) => setAForm({ ...aForm, link: e.target.value || "#" })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 14 }}>
                    <label>Upload Image / File <span style={{ fontWeight: 500, color: "#94a3b8", textTransform: "none" }}>(optional)</span></label>
                    <div style={{
                      border: "2px dashed #86efac", borderRadius: 10, padding: "18px", textAlign: "center",
                      background: "#dcfce7", cursor: "pointer", transition: "border-color 0.2s"
                    }}
                      onClick={() => document.getElementById("a-file-input").click()}>
                      {aFilePreview ? (
                        <img src={aFilePreview} alt="preview"
                          style={{ maxHeight: 140, maxWidth: "100%", borderRadius: 8, objectFit: "contain" }} />
                      ) : (
                        <>
                          <Upload size={22} color="#16a34a" style={{ marginBottom: 6 }} />
                          <p style={{ fontSize: 13, color: "#64748b", fontWeight: 600, margin: 0 }}>Click to upload image or file</p>
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>
                            Images are resized and compressed automatically. Images and documents must be 800 KB or smaller.
                          </span>
                        </>
                      )}
                      <input id="a-file-input" type="file" style={{ display: "none" }}
                        accept="image/*,.pdf,.doc,.docx"
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          try {
                            const media = await prepareAwarenessMedia(file);
                            setAFilePreview(media.thumbnail);
                            setAForm((form) => ({
                              ...form,
                              thumbnailData: media.thumbnail,
                              fullImageData: media.fullImage,
                              thumbnailPath: "",
                              fullImagePath: "",
                            }));
                          } catch (error) {
                            showToast(`Could not prepare the image: ${error.message}`, "error");
                          } finally {
                            e.target.value = "";
                          }
                        }} />
                    </div>
                    {aFilePreview && (
                      <button type="button" style={{ marginTop: 6, fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
                        onClick={() => {
                          setAFilePreview(null);
                          setAForm((f) => ({
                            ...f,
                            thumbnailData: "",
                            fullImageData: "",
                            thumbnailPath: "",
                            fullImagePath: "",
                          }));
                        }}>
                        Remove file
                      </button>
                    )}
                  </div>
                </>
              )}
              {aForm.type === "video" && (
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label>YouTube Embed URL or Video Link</label>
                  <input style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, width: "100%" }}
                    placeholder="https://www.youtube.com/embed/…"
                    value={aForm.videoUrl} onChange={(e) => setAForm({ ...aForm, videoUrl: e.target.value })} />
                  <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>
                    Tip: Use the embed URL from YouTube (Share → Embed → copy src)
                  </p>
                  {aForm.videoUrl && (
                    <div style={{ marginTop: 10 }}>
                      <a href={aForm.videoUrl} target="_blank" rel="noreferrer">
                        Open video preview in a new tab
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer-bar">
              <button className="cancel-btn" onClick={() => setShowAwarenessModal(false)}>Cancel</button>
              <button className="submit-btn" onClick={handleSaveAwareness}>
                {editingAwareness !== null ? "Save Changes" : "Publish Content"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Place (Location Breakdown customization) */}
      {showLocationModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal admin-custom-location-modal" style={{ maxWidth: 440 }}>
            <div className="modal-header-admin">
              <div className="title-wrap">
                <h3>Add Custom Place</h3>
              </div>
              <X size={20} className="close-modal-btn" onClick={() => setShowLocationModal(false)} />
            </div>
            <div className="admin-modal-content">
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Place Name *</label>
                <input style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, width: "100%" }}
                  placeholder="e.g. Science Laboratory"
                  value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Zone</label>
                <select className="professional-select" style={{ width: "100%" }}
                  value={locForm.zone} onChange={(e) => setLocForm({ ...locForm, zone: e.target.value })}>
                  <option value="inside">Inside School</option>
                  <option value="outside">Outside / Other</option>
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 4 }}>
                <label>Match Keywords <span style={{ fontWeight: 500, color: "#94a3b8", textTransform: "none" }}>(optional, comma-separated)</span></label>
                <input style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, width: "100%" }}
                  placeholder="e.g. lab, laboratory, science room"
                  value={locForm.keywords} onChange={(e) => setLocForm({ ...locForm, keywords: e.target.value })} />
                <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>
                  Reports whose location text contains any of these words will be grouped under this place.
                </p>
              </div>
            </div>
            <div className="modal-footer-bar">
              <button className="cancel-btn" onClick={() => setShowLocationModal(false)}>Cancel</button>
              <button className="submit-btn" onClick={handleSaveLocation}>Add Place</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxSrc && (
        <div onClick={() => setLightboxSrc(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          }}>
          <img src={lightboxSrc} alt="Evidence"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, boxShadow: "0 0 40px rgba(0,0,0,0.4)" }} />
          <X size={28} style={{ position: "absolute", top: 20, right: 24, color: "white", cursor: "pointer" }}
            onClick={() => setLightboxSrc(null)} />
        </div>
      )}

      {studentIdViewer && (
        <div className="admin-modal-overlay" onClick={() => setStudentIdViewer(null)}>
          <div className="admin-modal" style={{ maxWidth: 760 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header-admin">
              <div className="title-wrap">
                <Image size={18} color="var(--accent-color)" />
                <h3>Student ID Photos — {studentIdViewer.name}</h3>
              </div>
              <X size={20} className="close-modal-btn" onClick={() => setStudentIdViewer(null)} />
            </div>
            <div className="admin-modal-content">
              {studentIdViewer.loading ? (
                <p>Loading private ID photos…</p>
              ) : studentIdViewer.error ? (
                <p role="alert" style={{ color: "#b91c1c" }}>Could not load ID photos: {studentIdViewer.error}</p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
                  {[
                    { label: "Front", url: studentIdViewer.images?.front },
                    { label: "Back", url: studentIdViewer.images?.back },
                  ].map(({ label, url }) => (
                    <div key={label}>
                      <strong style={{ display: "block", marginBottom: 8 }}>{label} of Student ID</strong>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" aria-label={`Open full-size ${label.toLowerCase()} of student ID`}>
                          <img
                            src={url}
                            alt={`${label} of ${studentIdViewer.name}'s student ID`}
                            loading="lazy"
                            decoding="async"
                            style={{ width: "100%", maxHeight: "55vh", objectFit: "contain", border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc" }}
                          />
                          <span style={{ display: "block", marginTop: 6, color: "#2563eb", fontSize: 12 }}>Open full size</span>
                        </a>
                      ) : (
                        <p style={{ color: "#64748b" }}>No photo on file.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer-bar">
              <button className="cancel-btn" onClick={() => setStudentIdViewer(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`s-toast ${toast.type === "error" ? "error" : ""}`}>
          {toast.type === "error" ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          <span>{toast.msg}</span>
        </div>
      )}

    </div>
  );
}