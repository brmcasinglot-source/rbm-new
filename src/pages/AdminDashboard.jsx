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
  TrendingUp, Clock, Download, Calendar, Bell, Settings, ArrowUpRight,
  ChevronLeft, ChevronRight, MapPin, LogOut, Building2, DoorOpen, Sparkles,
  Paperclip, ZoomIn, Upload, FileDown, ChevronDown, GraduationCap, UserCheck,
} from "lucide-react";

import {
  getReports, updateReportStatus, deleteReport,
  getAwarenessContent, addAwarenessContent, updateAwarenessContent, deleteAwarenessContent,
  getAdminNotifications, markAdminNotifRead, markAllAdminNotifRead,
  LOCATION_META, getCustomLocations, addCustomLocation, deleteCustomLocation,
  getGradeSections, addGradeSection, updateGradeSection, deleteGradeSection,
  getStudentAccounts, approveStudentAccount, declineStudentAccount,
  getUnconfirmedSignups, resendConfirmationEmail,
  downloadCSV, downloadTextReport, getAnalyticsData,
} from "../data/store";

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
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const period = h >= 12 ? "PM" : "AM";
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
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
  Physical: "#ef4444",
  Verbal:   "#f97316",
  Cyber:    "#8b5cf6",
  Social:   "#3b82f6",
  Property: "#f59e0b",
  Others:   "#64748b",
};

const PRIORITY_ACCENT = { High: "#ef4444", Medium: "#f59e0b", Low: "#16a34a" };
const EXPORT_INCIDENT_TYPES = ["Physical", "Verbal", "Cyber", "Social", "Property", "Others"];
const EXPORT_STATUSES = ["Pending", "Under Investigation", "Resolved"];

function nextExportSelection(selected, value, options) {
  const next = selected.length === 0
    ? options.filter((option) => option !== value)
    : selected.includes(value)
      ? selected.filter((option) => option !== value)
      : [...selected, value];
  return next.length === options.length ? [] : next;
}

function ExportChecklist({ title, options, selected, setSelected, className = "" }) {
  return (
    <>
      <div className="analytics-export-filter-heading">
        <span>{title}</span>
        <button type="button" onClick={() => setSelected([])}>All</button>
      </div>
      {options.length > 0 ? (
        <div className={`analytics-export-checklist ${className}`}>
          {options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected.length === 0 || selected.includes(option)}
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
  const [activeTab,     setActiveTab]     = useState("dashboard");
  const [profileOpen,   setProfileOpen]   = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
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

  // Manage Incident modal
  const [showUpdateModal,      setShowUpdateModal]      = useState(false);
  const [selectedReport,       setSelectedReport]       = useState(null);
  const [newStatus,            setNewStatus]            = useState("");
  const [adminNotes,           setAdminNotes]           = useState("");
  const [conferenceDate,       setConferenceDate]       = useState("");
  const [conferenceTime,       setConferenceTime]       = useState("");
  const [conferenceLocation,   setConferenceLocation]   = useState("");
  const [conferenceNotes,      setConferenceNotes]      = useState("");
  const [manageFieldErrors,    setManageFieldErrors]    = useState({});
  const [toast,                setToast]                = useState(null);

  // Evidence lightbox
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [conferenceViewItem, setConferenceViewItem] = useState(null);
  const [conferencePanelHidden, setConferencePanelHidden] = useState(false);
  const [conferencePanelPinned, setConferencePanelPinned] = useState(false);

  // Incident Type Breakdown pagination
  const TYPE_BREAKDOWN_PAGE_SIZE = 4;
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

  // Multi-filter state
  const [mfType,    setMfType]    = useState("All");
  const [mfGrade,   setMfGrade]   = useState("All");
  const [mfGender,  setMfGender]  = useState("All");
  const [mfSection, setMfSection] = useState("All");
  const [mfStatus,  setMfStatus]  = useState("All");
  const [mfMonth,   setMfMonth]   = useState("All");
  const [mfYear,    setMfYear]    = useState("All");
  const [exportTypes, setExportTypes] = useState(EXPORT_INCIDENT_TYPES);
  const [exportStatuses, setExportStatuses] = useState(EXPORT_STATUSES);
  const [exportGradeFilter, setExportGradeFilter] = useState([]);
  const [exportGenderFilter, setExportGenderFilter] = useState([]);
  const [exportSectionFilter, setExportSectionFilter] = useState([]);
  const [exportMonthFilter, setExportMonthFilter] = useState([]);
  const [exportYearFilter, setExportYearFilter] = useState([]);
  const [exportMenuOpen,       setExportMenuOpen]        = useState(false);
  const exportMenuRef = useRef(null);
  const chartCanvasRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const trendCanvasRef = useRef(null);
  const trendChartInstanceRef = useRef(null);

  // Awareness modal
  const [showAwarenessModal, setShowAwarenessModal] = useState(false);
  const [editingAwareness,   setEditingAwareness]   = useState(null);
  const [aForm, setAForm] = useState({ type: "article", title: "", desc: "", link: "#", videoUrl: "", thumbnail: "" });
  const [aFilePreview, setAFilePreview] = useState(null);

  // Location Breakdown customization panel
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locForm, setLocForm] = useState({ name: "", icon: "📍", color: "#16a34a", zone: "inside", keywords: "" });

  // Grade & Section management panel
  const [sectionMgmtGrade, setSectionMgmtGrade] = useState("Grade 7");
  const [newSectionName,   setNewSectionName]   = useState("");
  const [editingSectionId, setEditingSectionId] = useState(null);
  const [editingSectionName, setEditingSectionName] = useState("");

  // Live data
  const [incidents,        setIncidents]        = useState([]);
  const [awarenessList,    setAwarenessList]    = useState([]);
  const [notifications,    setNotifications]    = useState([]);
  const [customLocations,  setCustomLocations]  = useState([]);
  const [gradeSections,    setGradeSections]    = useState([]);
  const [studentAccounts,    setStudentAccounts]    = useState([]);
  const [unconfirmedSignups, setUnconfirmedSignups] = useState([]);
  const [unconfirmedError,   setUnconfirmedError]   = useState("");
  const pendingAccounts = studentAccounts.filter((s) => !s.approved);

  const profileRef = useRef(null);
  const notifRef   = useRef(null);
  const adminContentRef = useRef(null);

  useEffect(() => {
    if (activeTab !== "dashboard" || conferencePanelPinned) return undefined;

    const scrollContainer = adminContentRef.current;
    if (!scrollContainer) return undefined;

    let previousScrollTop = scrollContainer.scrollTop;
    const handleScroll = () => {
      const currentScrollTop = scrollContainer.scrollTop;
      if (window.innerWidth <= 1100) {
        setConferencePanelHidden(false);
      } else if (currentScrollTop <= 80) {
        setConferencePanelHidden(false);
      } else if (Math.abs(currentScrollTop - previousScrollTop) > 5) {
        setConferencePanelHidden(currentScrollTop > previousScrollTop);
      }
      previousScrollTop = currentScrollTop;
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [activeTab, conferencePanelPinned]);

  // Poll every 2 s — only update state (and trigger a re-render) when the
  // underlying data actually changed, so charts don't reset/re-animate every tick.
  useEffect(() => {
    const setIfChanged = (setter) => (next) =>
      setter((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const setIncidentsIfChanged       = setIfChanged(setIncidents);
    const setAwarenessListIfChanged   = setIfChanged(setAwarenessList);
    const setNotificationsIfChanged   = setIfChanged(setNotifications);
    const setCustomLocationsIfChanged = setIfChanged(setCustomLocations);
    const setGradeSectionsIfChanged      = setIfChanged(setGradeSections);
    const setStudentAccountsIfChanged    = setIfChanged(setStudentAccounts);
    const setUnconfirmedSignupsIfChanged = setIfChanged(setUnconfirmedSignups);
    let cancelled = false;

    async function refresh() {
      try {
        const [incidentsData, locationsData, awarenessData, notifData, gradeSectionsData, studentAccountsData] = await Promise.all([
          getReports(), getCustomLocations(), getAwarenessContent(), getAdminNotifications(), getGradeSections(), getStudentAccounts(),
        ]);
        if (cancelled) return;
        setIncidentsIfChanged(incidentsData);
        setCustomLocationsIfChanged(locationsData);
        setAwarenessListIfChanged(awarenessData);
        setNotificationsIfChanged(notifData);
        setGradeSectionsIfChanged(gradeSectionsData);
        setStudentAccountsIfChanged(studentAccountsData);
      } catch (err) {
        console.error("Dashboard refresh failed:", err);
      }

      // Fetched separately: a broken/missing RPC here shouldn't blank out
      // the rest of the dashboard, but its failure must stay visible rather
      // than silently rendering as "no sign-ups waiting".
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
    }
    refresh();
    const id = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

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
  const unreadCount     = notifications.filter((n) => !n.read).length;

  const scheduledConferenceList = incidents
    .filter((r) => r.scheduledConference && (r.scheduledConference.date || r.scheduledConference.time || r.scheduledConference.location))
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      date: r.scheduledConference.date || "Date TBD",
      time: r.scheduledConference.time || "Time TBD",
      location: r.scheduledConference.location || "Location TBD",
      notes: r.scheduledConference.notes || "",
      reporterName: r.isAnonymous ? "Anonymous" : (r.submittedBy || "Unknown reporter"),
    }))
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  const typeCounts  = getTypeCounts(incidents);
  const monthlyData = useMemo(() => getMonthlyTrend(incidents, 6), [incidents]);
  const recs        = getRecommendations(typeCounts, incidents.length);
  const totalSorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  const locationCounts = getLocationCounts(incidents, customLocations);
  const allLocationMeta = [...LOCATION_META, ...customLocations];
  const locationSorted = Object.entries(locationCounts).sort((a, b) => b[1] - a[1]);
  const topLocation    = locationSorted[0]?.[0] || null;

  // Multi-filter computed
  const allGrades   = [...new Set(incidents.filter(r => !r.isAnonymous && r.reporterGrade).map(r => r.reporterGrade))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const allGenders  = [...new Set(incidents.filter(r => !r.isAnonymous && r.reporterSex).map(r => r.reporterSex))].sort();
  const allSections = [...new Set(incidents.filter(r=>!r.isAnonymous && r.reporterSection).map(r=>r.reporterSection))].sort();
  const allYears    = [...new Set(incidents.filter(r=>r.date).map(r=>new Date(r.date).getFullYear()))].sort((a,b)=>b-a);
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const mfFiltered = incidents.filter(r => {
    const d = r.date ? new Date(r.date) : null;
    return (
      (mfType    === "All" || r.type === mfType) &&
      (mfGrade   === "All" || r.reporterGrade   === mfGrade) &&
      (mfGender  === "All" || r.reporterSex     === mfGender) &&
      (mfSection === "All" || r.reporterSection === mfSection) &&
      (mfStatus  === "All" || r.status          === mfStatus) &&
      (mfMonth   === "All" || (d && MONTH_NAMES[d.getMonth()] === mfMonth)) &&
      (mfYear    === "All" || (d && d.getFullYear().toString() === mfYear))
    );
  });

  const mfTypes = useMemo(() => ["Physical","Verbal","Cyber","Social","Property","Others"], []);
  const mfChartData = useMemo(
    () => mfTypes.map((t) => mfFiltered.filter((r) => r.type === t).length),
    [mfFiltered, mfTypes]
  );
  const mfChartColors = useMemo(() => ["#16a34a", "#3b82f6", "#f59e0b", "#8b5cf6", "#f97316", "#64748b"], []);

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
    const accent = "#16a34a";

    trendChartInstanceRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels: monthlyData.map((m) => m.label),
        datasets: [{
          data: monthlyData.map((m) => m.count),
          borderColor: accent,
          borderWidth: 3,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: accent,
          pointBorderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: accent,
          pointHoverBorderColor: "#ffffff",
          tension: 0.4,
          fill: true,
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return "rgba(22,163,74,0.15)";
            const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(22,163,74,0.28)");
            gradient.addColorStop(1, "rgba(22,163,74,0)");
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
    mfType    !== "All" ? { label: mfType,    clear: () => handleMultiFilterChange(setMfType, "All")    } : null,
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
  const handleOpenManage = (report) => {
    setSelectedReport(report);
    // Skip the redundant "Pending" step — managing a pending report means it's
    // already being acted on, so jump straight to "Under Investigation".
    setNewStatus(report.status === "Pending" ? "Under Investigation" : report.status);
    setAdminNotes(report.adminNotes || "");
    setConferenceDate(report.scheduledConference?.date || "");
    setConferenceTime(report.scheduledConference?.time || "");
    setConferenceLocation(report.scheduledConference?.location || "");
    setConferenceNotes(report.scheduledConference?.notes || "");
    setManageFieldErrors({});
    setShowUpdateModal(true);
  };

  const handleConfirmUpdate = async () => {
    if (!selectedReport) return;

    const errors = {
      adminNotes:         !adminNotes.trim(),
      conferenceDate:     !conferenceDate.trim(),
      conferenceTime:     !conferenceTime.trim(),
      conferenceLocation: !conferenceLocation.trim(),
      conferenceNotes:    !conferenceNotes.trim(),
    };
    if (Object.values(errors).some(Boolean)) {
      setManageFieldErrors(errors);
      showToast("Please fill in all fields before updating the status.", "error");
      return;
    }
    setManageFieldErrors({});

    const conference = { date: conferenceDate, time: conferenceTime, location: conferenceLocation, notes: conferenceNotes };

    try {
      await updateReportStatus(selectedReport.id, newStatus, adminNotes, conference);
    } catch (err) {
      showToast("Could not update incident: " + err.message, "error");
      return;
    }
    setIncidents(await getReports());
    setNotifications(await getAdminNotifications());
    setShowUpdateModal(false);
    showToast("Incident updated successfully.");
  };

  const handleDeleteReport = async (id) => {
    if (!window.confirm("Delete this report? This cannot be undone.")) return;
    await deleteReport(id);
    setIncidents(await getReports());
  };

  const openNewAwareness = () => {
    setEditingAwareness(null);
    setAForm({ type: "article", title: "", desc: "", link: "#", videoUrl: "", thumbnail: "" });
    setAFilePreview(null);
    setShowAwarenessModal(true);
  };

  const openEditAwareness = (item) => {
    setEditingAwareness(item.id);
    setAForm({ type: item.type, title: item.title, desc: item.desc || "", link: item.link || "#", videoUrl: item.videoUrl || "", thumbnail: item.thumbnail || "" });
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
    setLocForm({ name: "", icon: "📍", color: "#16a34a", zone: "inside", keywords: "" });
    setShowLocationModal(true);
  };

  const handleSaveLocation = async () => {
    const result = await addCustomLocation({
      name:     locForm.name,
      icon:     locForm.icon,
      color:    locForm.color,
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
    const result = await addGradeSection({ grade: sectionMgmtGrade, section: newSectionName });
    if (!result.success) { showToast(result.error, "error"); return; }
    setGradeSections(await getGradeSections());
    setNewSectionName("");
    showToast(`"${result.section.section}" added to ${sectionMgmtGrade}.`);
  };

  const handleEditSection = (id, name) => {
    setEditingSectionId(id);
    setEditingSectionName(name);
  };

  const handleSaveSection = async () => {
    const result = await updateGradeSection(editingSectionId, editingSectionName, sectionMgmtGrade);
    if (!result.success) { showToast(result.error, "error"); return; }
    setGradeSections(await getGradeSections());
    setEditingSectionId(null);
    setEditingSectionName("");
    showToast(`Section renamed to "${result.section.section}".`);
  };

  const handleCancelSectionEdit = () => {
    setEditingSectionId(null);
    setEditingSectionName("");
  };

  const handleDeleteSection = async (id, name) => {
    if (!window.confirm(`Remove "${name}" from ${sectionMgmtGrade}?`)) return;
    await deleteGradeSection(id);
    setGradeSections(await getGradeSections());
  };

  const handleApproveAccount = async (id, name) => {
    try {
      await approveStudentAccount(id);
      setStudentAccounts(await getStudentAccounts());
      showToast(`${name}'s account has been confirmed. They can now log in.`);
    } catch (err) {
      showToast(`Could not approve ${name}: ${err.message}`, "error");
    }
  };

  const handleDeclineAccount = async (id, name) => {
    if (!window.confirm(`Decline and remove "${name}"'s registration? This cannot be undone.`)) return;
    await declineStudentAccount(id);
    setStudentAccounts(await getStudentAccounts());
    showToast(`${name}'s registration was declined.`);
  };

  const handleResendConfirmation = async (email) => {
    const result = await resendConfirmationEmail(email);
    if (!result.success) { showToast(result.error, "error"); return; }
    showToast(`Confirmation email resent to ${email}.`);
  };

  /* Export helpers */
  const exportFilteredIncidents = incidents.filter((report) =>
    exportTypes.includes(report.type || "Others") &&
    exportStatuses.includes(report.status) &&
    (exportGradeFilter.length === 0 || exportGradeFilter.includes(report.reporterGrade)) &&
    (exportGenderFilter.length === 0 || exportGenderFilter.includes(report.reporterSex)) &&
    (exportSectionFilter.length === 0 || exportSectionFilter.includes(report.reporterSection)) &&
    (exportMonthFilter.length === 0 || (report.date && exportMonthFilter.includes(MONTH_NAMES[new Date(report.date).getMonth()]))) &&
    (exportYearFilter.length === 0 || (report.date && exportYearFilter.includes(String(new Date(report.date).getFullYear()))))
  );

  const handleExportCSV = () => {
    downloadCSV(exportFilteredIncidents);
    setExportMenuOpen(false);
  };

  const handleExportText = () => {
    downloadTextReport(exportFilteredIncidents);
    setExportMenuOpen(false);
  };

  const handleExportPDF = () => {
    const data = getAnalyticsData(exportFilteredIncidents);
    const win = window.open("", "_blank");
    const rows = data.reports.map((r) => `
      <tr>
        <td>#${r.id}</td><td>${r.date || "—"}</td><td>${r.type}</td>
        <td>${r.isAnonymous ? "🕵️ Anonymous" : r.submittedBy}</td><td>${r.location || "—"}</td>
        <td>${r.status}</td>
        <td style="max-width:260px;font-size:11px;">${(r.description || "").slice(0, 120)}${r.description && r.description.length > 120 ? "…" : ""}</td>
      </tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head><title>CNHS Incident Report</title>
      <style>
        body{font-family:Arial,sans-serif;padding:32px;color:#1e293b;font-size:13px;}
        h1{color:#15803d;font-size:22px;margin-bottom:4px;}
        .sub{color:#64748b;font-size:13px;margin-bottom:24px;}
        .kpi-row{display:flex;gap:20px;margin-bottom:24px;}
        .kpi{background:#dcfce7;border:1.5px solid #86efac;border-radius:10px;padding:14px 20px;text-align:center;}
        .kpi-val{font-size:26px;font-weight:900;color:#15803d;}
        .kpi-label{font-size:11px;color:#475569;font-weight:700;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th{background:#15803d;color:white;padding:8px 10px;text-align:left;}
        td{padding:7px 10px;border-bottom:1px solid #e2e8f0;}
        tr:nth-child(even) td{background:#f8fafc;}
        @media print{button{display:none}}
      </style></head><body>
      <h1>CNHS Bullying &amp; Incident Report</h1>
      <div class="sub">Generated: ${new Date().toLocaleString("en-PH")} — Casinglot National High School</div>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-val">${data.totalReports}</div><div class="kpi-label">Total Reports</div></div>
        <div class="kpi"><div class="kpi-val">${data.pendingReports}</div><div class="kpi-label">Pending</div></div>
        <div class="kpi"><div class="kpi-val">${data.resolvedReports}</div><div class="kpi-label">Resolved</div></div>
        <div class="kpi"><div class="kpi-val">${data.totalStudents}</div><div class="kpi-label">Students</div></div>
      </div>
      <table><thead><tr><th>ID</th><th>Date</th><th>Type</th><th>By</th><th>Location</th><th>Status</th><th>Description</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <script>window.print();</script></body></html>`);
    win.document.close();
    setExportMenuOpen(false);
  };

  const today = new Date().toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="dashboard admin-theme" style={{ backgroundImage: `url(${bg})` }}>

      {/* ── SIDEBAR ── */}
      <div className="sidebar">
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
          ].map(({ tab, icon, label }) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
              {icon} {label}
              {tab === "confirmations" && pendingAccounts.length > 0 && (
                <span style={{
                  marginLeft: "auto", background: "#ef4444", color: "#fff",
                  fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 10,
                }}>{pendingAccounts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sb-section-label">Management</div>
        <nav className="menu">
          {[
            { tab: "awareness", icon: <BookOpen size={16} />,      label: "Awareness Hub" },
            { tab: "sections",  icon: <GraduationCap size={16} />, label: "Grade & Sections" },
            { tab: "settings",  icon: <Settings size={16} />,      label: "Settings" },
          ].map(({ tab, icon, label }) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
              {icon} {label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── MAIN ── */}
      <div className="main">

        {/* TOP BAR */}
        <div className={`header${profileOpen ? " profile-menu-open" : ""}`}>
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
              <Bell size={18} onClick={() => setNotifOpen(!notifOpen)} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
              {notifOpen && (
                <div className="s-notif-dropdown" style={{ right: 0 }}>
                  <div className="s-notif-header">
                    <span>Notifications</span>
                    <button onClick={async () => { await markAllAdminNotifRead(); setNotifications(await getAdminNotifications()); }}>
                      Mark all read
                    </button>
                  </div>
                  {notifications.length === 0 && (
                    <div style={{ padding: "14px 16px", fontSize: 13, color: "#94a3b8" }}>No notifications yet.</div>
                  )}
                  {notifications.map((n) => (
                    <div key={n.id}
                      className={`s-notif-item ${!n.read ? "unread" : ""}`}
                      onClick={async () => {
                        await markAdminNotifRead(n.id);
                        setNotifications(await getAdminNotifications());
                        setNotifOpen(false);
                        if (n.type === "report") setActiveTab("incidents");
                        else if (n.type === "hub") setActiveTab("awareness");
                      }}>
                      <div className={`s-notif-dot ${n.type === "report" ? "green" : "blue"}`} />
                      <div><p>{n.title}</p><span>{n.time}</span></div>
                    </div>
                  ))}
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
                  <button className="logout-btn" onClick={async () => { await signOut(); navigate("/login?role=admin"); }}>
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
                <div className="summary-grid admin-summary">
                  {[
                    { label: "Total Reports",         val: incidents.length,       icon: <FileText size={18} />,      color: "m-green",  badge: "muted", sub: "all submissions" },
                    { label: "Pending",               val: pendingCases.length,    icon: <AlertTriangle size={18} />, color: "m-amber",  badge: "warn",  sub: "needs review" },
                    { label: "Under Investigation",   val: inProgressCases.length, icon: <Clock size={18} />,         color: "m-blue",   badge: "info",  sub: "being handled" },
                    { label: "Resolved",              val: resolvedCases.length,   icon: <CheckCircle size={18} />,   color: "m-green2", badge: "up",    sub: "closed cases" },
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
                  <div className="card-panel">
                    <div className="panel-header-flex">
                      <div className="title-group">
                        <h3>Monthly Incident Trend</h3>
                        <p className="panel-subtitle">Reports submitted per month (last 6 months)</p>
                      </div>
                    </div>
                    <div className="chart-canvas-wrap" style={{ height: 180 }}>
                      <canvas ref={trendCanvasRef} role="img" aria-label="Line chart showing monthly incident trend" />
                    </div>
                    <div className="mini-stats-row" style={{ marginTop: 26 }}>
                      <div className="mini-stat">
                        <span className="mini-stat-val" style={{ color: "#ef4444" }}>
                          {Math.max(...monthlyData.map((m) => m.count))}
                        </span>
                        <span className="mini-stat-label">Peak month</span>
                      </div>
                      <div className="mini-stat">
                        <span className="mini-stat-val" style={{ color: "#22c55e" }}>
                          {incidents.length}
                        </span>
                        <span className="mini-stat-label">Total reports</span>
                      </div>
                      <div className="mini-stat">
                        <span className="mini-stat-val" style={{ color: "#f59e0b" }}>
                          {monthlyData[monthlyData.length - 1].count}
                        </span>
                        <span className="mini-stat-label">This month</span>
                      </div>
                    </div>
                  </div>

                  {/* Type Breakdown */}
                  <div className="card-panel">
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
                      const typePlaceholderCount = TYPE_BREAKDOWN_PAGE_SIZE - typePageItems.length;
                      return (
                        <>
                          <div className="breakdown-list">
                            {typePageItems.map(([type, count]) => {
                              const pct = Math.round((count / incidents.length) * 100);
                              const color = TYPE_COLORS[type] || "#64748b";
                              return (
                                <div className="bk-row" key={type}>
                                  <div className="bk-top">
                                    <span className="bk-label"><span className="bk-dot" style={{ background: color }} />{type}</span>
                                    <span className="bk-pct" style={{ color }}>{pct}%</span>
                                  </div>
                                  <div className="bk-track"><div className="bk-fill" style={{ width: `${pct}%`, background: color }} /></div>
                                  <span className="bk-count">{count} incident{count !== 1 ? "s" : ""}</span>
                                </div>
                              );
                            })}
                            {/* Invisible filler rows keep every page the same height, so the
                                pagination bar below never shifts position between pages. */}
                            {Array.from({ length: typePlaceholderCount }).map((_, i) => (
                              <div className="bk-row" key={`filler-${i}`} aria-hidden="true" style={{ visibility: "hidden" }}>
                                <div className="bk-top">
                                  <span className="bk-label"><span className="bk-dot" />placeholder</span>
                                  <span className="bk-pct">0%</span>
                                </div>
                                <div className="bk-track"><div className="bk-fill" style={{ width: "0%" }} /></div>
                                <span className="bk-count">0 incidents</span>
                              </div>
                            ))}
                          </div>
                          {typeTotalPages > 1 && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
                              <button
                                onClick={() => setTypeBreakdownPage((p) => Math.max(0, p - 1))}
                                disabled={typePage === 0}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                                  border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                                  color: typePage === 0 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                                  cursor: typePage === 0 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                                }}
                              ><ChevronLeft size={14} /> Prev</button>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                                Page {typePage + 1} of {typeTotalPages}
                              </span>
                              <button
                                onClick={() => setTypeBreakdownPage((p) => Math.min(typeTotalPages - 1, p + 1))}
                                disabled={typePage === typeTotalPages - 1}
                                style={{
                                  display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                                  border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                                  color: typePage === typeTotalPages - 1 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                                  cursor: typePage === typeTotalPages - 1 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                                }}
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
                                <td><b className="case-id-cell">#{r.id}</b></td>
                                <td>{r.type}</td>
                                <td style={{ fontSize: 12 }}>{r.isAnonymous ? <span style={{ color: "#6b7280", fontStyle: "italic" }}>🕵️ Anonymous</span> : r.submittedBy}</td>
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

              <aside className={`admin-conference-panel${conferencePanelHidden ? " is-scrolled-away" : ""}${conferencePanelPinned ? " is-pinned" : ""}`}>
                <div
                  className="admin-conference-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={conferencePanelPinned}
                  aria-label={conferencePanelPinned ? "Close scheduled conferences panel" : "Keep scheduled conferences panel open"}
                  onClick={() => setConferencePanelPinned((pinned) => !pinned)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setConferencePanelPinned((pinned) => !pinned);
                    }
                  }}
                >
                  <Calendar size={16} />
                  <span>Scheduled Conferences</span>
                </div>

                {scheduledConferenceList.length === 0 ? (
                  <div className="admin-conference-empty">
                    No scheduled conference yet.
                  </div>
                ) : (
                  <div className="admin-conference-list">
                    {scheduledConferenceList.map((conf) => (
                      <div
                        className="admin-conference-item"
                        key={conf.id}
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
                      >
                        <div className="admin-conference-top">
                          <span className="admin-conference-case">Case #{conf.id}</span>
                          <span className="admin-conference-status">{conf.status}</span>
                        </div>
                        <div className="admin-conference-type-row">
                          <span className="admin-conference-type">
                            <span className="admin-conference-type-dot" style={{ background: TYPE_COLORS[conf.type] || "#64748b" }} />
                            {conf.type}
                          </span>
                          <ChevronRight size={14} className="admin-conference-chevron" />
                        </div>
                        <div className="admin-conference-datetime">
                          <Calendar size={11} /> {conf.date}
                          <span className="admin-conference-dt-sep">•</span>
                          <Clock size={11} /> {conf.time}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}

        {/* ══════════════════════════════
            INCIDENTS TAB
        ══════════════════════════════ */}
        {activeTab === "incidents" && (
          <div className="admin-content">
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
              <div className="card-panel" style={{ textAlign: "center", padding: "60px 24px", color: "#94a3b8" }}>
                <FileText size={48} color="#e2e8f0" style={{ margin: "0 auto 12px" }} />
                <h3 style={{ color: "#64748b", fontWeight: 800, marginBottom: 8 }}>No incidents yet</h3>
                <p style={{ fontSize: 14 }}>Incidents submitted by students will appear here in real time.</p>
              </div>
            ) : (() => {
              const incidentsTotalPages = Math.max(1, Math.ceil(filteredIncidents.length / INCIDENTS_PAGE_SIZE));
              const page = Math.min(incidentsPage, incidentsTotalPages - 1);
              const pageStart = page * INCIDENTS_PAGE_SIZE;
              const pageItems = filteredIncidents.slice(pageStart, pageStart + INCIDENTS_PAGE_SIZE);
              return (
                <>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: "#94a3b8", margin: "0 0 12px" }}>
                    Showing {pageStart + 1}–{Math.min(pageStart + INCIDENTS_PAGE_SIZE, filteredIncidents.length)} of {filteredIncidents.length} incident{filteredIncidents.length !== 1 ? "s" : ""}
                  </p>
                  <div className="incidents-grid">
                    {pageItems.map((r) => (
                      <div
                        className="card-panel incident-row"
                        key={r.id}
                        style={{ borderLeft: `4px solid ${PRIORITY_ACCENT[r.priority] || "#e5e7eb"}` }}
                      >
                        <div className="incident-top">
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <b className="case-id-cell" style={{ fontSize: 14 }}>#{r.id}</b>
                            <span className="type-chip">{r.type}</span>
                            {r.priority && (
                              <span className={`priority-badge ${r.priority}`}>{r.priority}</span>
                            )}
                            {r.evidence && r.evidence.length > 0 && (
                              <span className="evidence-chip-small">
                                <Paperclip size={11} /> {r.evidence.length} file{r.evidence.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span className={`status-badge ${r.status.toLowerCase().replace(/\s/g,"-")}`}>{r.status}</span>
                            <button className="read-btn tiny" onClick={() => handleOpenManage(r)}>Manage</button>
                            <button className="delete-btn tiny" onClick={() => handleDeleteReport(r.id)}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <p className="incident-desc" style={{ fontSize: 12.5, color: "#475569", margin: "4px 0 6px", lineHeight: 1.4 }}>
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
                        {/* Evidence thumbnails */}
                        {r.evidence && r.evidence.length > 0 && (
                          <div className="s-evidence-row" style={{ marginTop: 6 }}>
                            {r.evidence.map((ev, idx) =>
                              ev.type && ev.type.startsWith("image/") ? (
                                <img key={idx} src={ev.data} alt={ev.name}
                                  style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 7, border: "2px solid #d1fae5", cursor: "zoom-in" }}
                                  onClick={() => setLightboxSrc(ev.data)} />
                              ) : (
                                <div key={idx} className="s-file-chip">
                                  <Paperclip size={11} /> {ev.name}
                                </div>
                              )
                            )}
                          </div>
                        )}
                        {r.adminNotes && (
                          <div style={{ marginTop: 6, fontSize: 11.5, background: "#dcfce7", border: "1.5px solid #86efac",
                            borderRadius: 7, padding: "6px 10px", color: "#16a34a" }}>
                            <strong>Admin Note:</strong> {r.adminNotes}
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
                </>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════
            ANALYTICS TAB
        ══════════════════════════════ */}
        {activeTab === "analytics" && (
          <div className="admin-content">
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
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div style={{ position: "relative" }} ref={exportMenuRef}>
                          <button className="analytics-export-btn" onClick={() => setExportMenuOpen(!exportMenuOpen)}>
                            <Download size={14} /> Export <ChevronDown size={13} />
                          </button>
                          {exportMenuOpen && (
                            <div className="analytics-export-menu">
                              <div className="analytics-export-filter-section">
                                <ExportChecklist title="Incident type" options={EXPORT_INCIDENT_TYPES} selected={exportTypes} setSelected={setExportTypes} />
                                <ExportChecklist title="Status" options={EXPORT_STATUSES} selected={exportStatuses} setSelected={setExportStatuses} />
                                <details className="analytics-export-filter-group">
                                  <summary>
                                    <span>Student details</span>
                                    <small>{[exportGradeFilter, exportGenderFilter, exportSectionFilter].filter((selection) => selection.length > 0).length
                                      ? `${[exportGradeFilter, exportGenderFilter, exportSectionFilter].filter((selection) => selection.length > 0).length} active`
                                      : "Any"}</small>
                                  </summary>
                                  <div className="analytics-export-filter-group-content">
                                    <ExportChecklist title="Grade level" options={allGrades} selected={exportGradeFilter} setSelected={setExportGradeFilter} />
                                    <ExportChecklist title="Gender" options={allGenders} selected={exportGenderFilter} setSelected={setExportGenderFilter} />
                                    <ExportChecklist title="Section" options={allSections} selected={exportSectionFilter} setSelected={setExportSectionFilter} />
                                  </div>
                                </details>
                                <details className="analytics-export-filter-group">
                                  <summary>
                                    <span>Report date</span>
                                    <small>{[exportMonthFilter, exportYearFilter].filter((selection) => selection.length > 0).length
                                      ? `${[exportMonthFilter, exportYearFilter].filter((selection) => selection.length > 0).length} active`
                                      : "Any"}</small>
                                  </summary>
                                  <div className="analytics-export-filter-group-content">
                                    <ExportChecklist title="Month" options={MONTH_NAMES} selected={exportMonthFilter} setSelected={setExportMonthFilter} className="analytics-export-month-checklist" />
                                    <ExportChecklist title="Year" options={allYears.map(String)} selected={exportYearFilter} setSelected={setExportYearFilter} />
                                  </div>
                                </details>
                                <p className="analytics-export-result-count">
                                  {exportFilteredIncidents.length} of {incidents.length} incidents selected
                                </p>
                              </div>
                              <p className="analytics-export-label">Choose Format</p>
                              <button onClick={handleExportPDF}><FileBarChart size={14} color="#ef4444" /><span><strong>PDF Report</strong><small>Formatted printable report</small></span></button>
                              <button onClick={handleExportCSV}><FileDown size={14} color="#22c55e" /><span><strong>CSV Spreadsheet</strong><small>Excel / Google Sheets compatible</small></span></button>
                              <button onClick={handleExportText}><FileText size={14} color="#3b82f6" /><span><strong>Text / DOCX</strong><small>Plain text for Word import</small></span></button>
                            </div>
                          )}
                        </div>
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
                          {["All","Physical","Verbal","Cyber","Social","Property","Others"].map(t => (
                            <button key={t} className={`analytics-chip ${mfType === t ? "active" : ""}`}
                              onClick={() => handleMultiFilterChange(setMfType, t)}>{t}</button>
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
                          <select className="mf-select" value={mfGrade} onChange={e => handleMultiFilterChange(setMfGrade, e.target.value)}>
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
                            {allSections.map(s => <option key={s} value={s}>{s}</option>)}
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
                            handleMultiFilterChange(setMfType, "All");
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
                      <span className="analytics-insight-icon"><Sparkles size={15} /></span>
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
                        onClick={openAddLocation}
                        style={{
                          display: "flex", alignItems: "center", gap: 5, padding: "7px 12px",
                          background: "#dcfce7", border: "1.5px solid #86efac", borderRadius: 8,
                          color: "#15803d", fontSize: 12, fontWeight: 800, cursor: "pointer",
                          fontFamily: "Nunito, sans-serif", flexShrink: 0, whiteSpace: "nowrap",
                        }}
                      ><Plus size={13} /> Add Place</button>
                    </div>

                    {/* Custom places the admin has added */}
                    {customLocations.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                        {customLocations.map((loc) => (
                          <span key={loc.key} style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            fontSize: 11, fontWeight: 700, padding: "4px 6px 4px 10px", borderRadius: 20,
                            background: hexToRgba(loc.color, 0.12), color: loc.color,
                            border: `1.5px solid ${hexToRgba(loc.color, 0.4)}`,
                          }}>
                            {loc.icon} {loc.key}
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
                    )}

                    {/* Zone legend */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20,
                        background: "#dbeafe", color: "#1d4ed8", border: "1.5px solid #93c5fd",
                      }}><Building2 size={12} /> Inside School</span>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20,
                        background: "#fee2e2", color: "#dc2626", border: "1.5px solid #fca5a5",
                      }}><DoorOpen size={12} /> Outside / Other</span>
                    </div>

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
                              const color = meta?.color || "#94a3b8";
                              const icon  = meta?.icon  || "📍";
                              const zone  = meta?.zone  || "inside";
                              return (
                                <div className="bk-row" key={loc}>
                                  <div className="bk-top">
                                    <span className="bk-label">
                                      <span className="bk-dot" style={{ background: color }} />
                                      <span style={{ marginRight: 2 }}>{icon}</span>
                                      {loc}
                                      {zone === "outside" && (
                                        <span style={{
                                          marginLeft: 6, fontSize: 10, fontWeight: 700,
                                          color: "#ef4444", background: "#fee2e2",
                                          padding: "1px 6px", borderRadius: 8,
                                        }}>Outside</span>
                                      )}
                                    </span>
                                    <span className="bk-pct" style={{ color }}>{pct}%</span>
                                  </div>
                                  <div className="bk-track">
                                    <div className="bk-fill" style={{ width: `${pct}%`, background: color }} />
                                  </div>
                                  <span className="bk-count">{count} incident{count !== 1 ? "s" : ""}</span>
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
                        marginTop: "auto", padding: "12px 14px", borderRadius: 10,
                        background: "linear-gradient(135deg, #fef3c7, #fde68a)",
                        border: "1.5px solid #fcd34d",
                        display: "flex", alignItems: "flex-start", gap: 10,
                      }}>
                        <span style={{
                          width: 26, height: 26, borderRadius: "50%", background: "#ffffff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#d97706", flexShrink: 0,
                        }}><AlertTriangle size={14} /></span>
                        <div>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#92400e" }}>
                            Prefect Hotspot Alert
                          </p>
                          <p style={{ margin: "3px 0 0", fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
                            <strong>{topLocation}</strong> has the most reported incidents ({locationCounts[topLocation]}).
                            Deploy prefects or increase monitoring in this area.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                </div>

                {/* ── Filtered Records Table ── */}
                <div className="card-panel" style={{ marginBottom: 18 }}>
                  <div className="title-group" style={{ marginBottom: 12 }}>
                    <h3>Incident Records</h3>
                    <p className="panel-subtitle">{mfFiltered.length} record{mfFiltered.length !== 1 ? "s" : ""} {mfHasFilters ? "matching filters" : "total"}</p>
                  </div>
                  {mfFiltered.length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
                      {incidents.length === 0 ? "No incidents have been reported yet." : "No records match the selected filters."}
                    </p>
                  ) : (() => {
                    const recordsTotalPages = Math.max(1, Math.ceil(mfFiltered.length / RECORDS_PAGE_SIZE));
                    const recPage = Math.min(recordsPage, recordsTotalPages - 1);
                    const recordsPageItems = mfFiltered.slice(
                      recPage * RECORDS_PAGE_SIZE,
                      recPage * RECORDS_PAGE_SIZE + RECORDS_PAGE_SIZE
                    );
                    return (
                      <>
                        <div className="table-container">
                          <table className="cases-table compact">
                            <thead>
                              <tr><th>Case ID</th><th>Type</th><th>Reporter</th><th>Grade</th><th>Gender</th><th>Section</th><th>Date</th><th>Status</th><th></th></tr>
                            </thead>
                            <tbody>
                              {recordsPageItems.map((r) => (
                                <tr key={r.id}>
                                  <td><b className="case-id-cell">#{r.id}</b></td>
                                  <td><span className="type-chip">{r.type}</span></td>
                                  <td style={{ fontSize: 12 }}>{r.isAnonymous ? <span style={{ color: "#6b7280", fontStyle: "italic" }}>🕵️ Anon</span> : r.submittedBy}</td>
                                  <td style={{ fontSize: 12 }}>{r.reporterGrade || "—"}</td>
                                  <td style={{ fontSize: 12 }}>{r.isAnonymous ? "—" : (r.reporterSex || "—")}</td>
                                  <td style={{ fontSize: 12 }}>{r.isAnonymous ? "—" : (r.reporterSection || "—")}</td>
                                  <td className="date-cell">{r.date}</td>
                                  <td><span className={`status-badge ${r.status.toLowerCase().replace(/\s/g,"-")}`}>{r.status}</span></td>
                                  <td><button className="read-btn tiny" onClick={() => handleOpenManage(r)}>Manage</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {recordsTotalPages > 1 && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
                            <button
                              onClick={() => setRecordsPage((p) => Math.max(0, p - 1))}
                              disabled={recPage === 0}
                              style={{
                                display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                                border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                                color: recPage === 0 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                                cursor: recPage === 0 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                              }}
                            ><ChevronLeft size={14} /> Prev</button>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                              Page {recPage + 1} of {recordsTotalPages}
                            </span>
                            <button
                              onClick={() => setRecordsPage((p) => Math.min(recordsTotalPages - 1, p + 1))}
                              disabled={recPage === recordsTotalPages - 1}
                              style={{
                                display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                                border: "1.5px solid #e5e7eb", borderRadius: 8, background: "#fff",
                                color: recPage === recordsTotalPages - 1 ? "#cbd5e1" : "#334155", fontSize: 12, fontWeight: 700,
                                cursor: recPage === recordsTotalPages - 1 ? "not-allowed" : "pointer", fontFamily: "Nunito, sans-serif",
                              }}
                            >Next <ChevronRight size={14} /></button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Recommendations */}
                <div className="card-panel" style={{ marginTop: 4, border: "2px solid #fde68a", background: "#fef3c7" }}>
                  <div className="title-group" style={{ marginBottom: 14 }}>
                    <h3 style={{ color: "#92400e" }}>⚡ Recommended Next Steps</h3>
                    <p className="panel-subtitle" style={{ color: "#a16207" }}>Based on current incident data — for the Prefect of Discipline</p>
                  </div>
                  <ul style={{ paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                    {recs.map((rec, i) => (
                      <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "white", border: "1.5px solid #fde68a", borderRadius: 12, padding: "12px 16px", fontSize: 14, color: "#78350f", lineHeight: 1.55, fontWeight: 500 }}>
                        <span style={{ fontWeight: 800, color: "#d97706", flexShrink: 0 }}>{i + 1}.</span>{rec}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
        {/* ══════════════════════════════
            AWARENESS HUB TAB
        ══════════════════════════════ */}
        {activeTab === "awareness" && (
          <div className="admin-content">
            <div className="panel-header-flex" style={{ marginBottom: 18 }}>
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
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase",
                    background: "#dcfce7", color: "#16a34a", border: "1.5px solid #86efac",
                  }}>{item.type}</span>
                  {item.type === "video" ? (
                    <div style={{ marginTop: 10, borderRadius: 8, overflow: "hidden" }}>
                      <iframe src={item.videoUrl} title={item.title} width="100%" height="120" frameBorder="0" style={{ display: "block" }} />
                    </div>
                  ) : item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.title}
                      style={{ width: "100%", maxHeight: 120, borderRadius: 8, objectFit: "cover", marginTop: 10 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, background: "#dcfce7", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 10, color: "#16a34a" }}>
                      {item.type === "article" && <FileText size={18} />}
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
          <div className="admin-content">
            <div className="card-panel" style={{ marginBottom: 18 }}>
              <div className="title-group" style={{ marginBottom: 20 }}>
                <h3>Awaiting Email Confirmation</h3>
                <p className="panel-subtitle">
                  Signed up but haven't clicked the confirmation link in their Gmail yet — they'll move to the queue below once they do.
                </p>
              </div>

              {unconfirmedError ? (
                <p style={{ color: "#b91c1c", background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: 8, fontSize: 12.5, padding: "10px 12px", fontWeight: 600 }}>
                  Couldn't load this list: {unconfirmedError}
                </p>
              ) : unconfirmedSignups.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0 4px" }}>
                  No sign-ups waiting on email confirmation right now.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {unconfirmedSignups.map((s) => (
                    <div key={s.id} style={{
                      border: "1.5px solid #bfdbfe", background: "#eff6ff", borderRadius: 12,
                      padding: "16px 18px", display: "flex", alignItems: "flex-start",
                      justifyContent: "space-between", gap: 16, flexWrap: "wrap",
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <strong style={{ fontSize: 15, color: "#111827" }}>{s.name || "(name unavailable)"}</strong>
                          <span style={{
                            fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                            color: "#1d4ed8", background: "#dbeafe", border: "1px solid #bfdbfe",
                            padding: "2px 8px", borderRadius: 10,
                          }}>Confirming Email</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12.5, color: "#57534e" }}>
                          <span>{s.email}</span>
                          <span>LRN {s.lrn || "—"}</span>
                          <span>{s.grade || "—"} · {s.section || "—"}</span>
                          <span>Signed up {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleResendConfirmation(s.email)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                          background: "#fff", border: "1.5px solid #93c5fd", borderRadius: 8,
                          color: "#1d4ed8", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                          fontFamily: "Nunito, sans-serif", whiteSpace: "nowrap", flexShrink: 0,
                        }}
                      >Resend Email</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-panel" style={{ marginBottom: 18 }}>
              <div className="title-group" style={{ marginBottom: 20 }}>
                <h3>Account Confirmations</h3>
                <p className="panel-subtitle">
                  New student sign-ups land here after they confirm their email — approve or decline before they can log in.
                </p>
              </div>

              {pendingAccounts.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13, padding: "8px 0 4px" }}>
                  No accounts waiting for confirmation right now.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {pendingAccounts.map((s) => (
                    <div key={s.id} style={{
                      border: "1.5px solid #fde68a", background: "#fffbeb", borderRadius: 12,
                      padding: "16px 18px", display: "flex", alignItems: "flex-start",
                      justifyContent: "space-between", gap: 16, flexWrap: "wrap",
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <strong style={{ fontSize: 15, color: "#111827" }}>{s.name}</strong>
                          <span style={{
                            fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                            color: "#a16207", background: "#fef3c7", border: "1px solid #fde68a",
                            padding: "2px 8px", borderRadius: 10,
                          }}>Pending</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12.5, color: "#57534e" }}>
                          <span>{s.email}</span>
                          <span>LRN {s.lrn || "—"}</span>
                          <span>{s.grade || "—"} · {s.section || "—"}</span>
                          <span>{s.age || "—"} yrs old{s.sex ? ` · ${s.sex}` : ""}</span>
                          <span>Registered {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => handleApproveAccount(s.id, s.name)}
                          style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                            background: "#16a34a", border: "1.5px solid #16a34a", borderRadius: 8,
                            color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                            fontFamily: "Nunito, sans-serif", whiteSpace: "nowrap",
                          }}
                        ><UserCheck size={14} /> Approve</button>
                        <button
                          onClick={() => handleDeclineAccount(s.id, s.name)}
                          style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                            background: "#fff", border: "1.5px solid #fca5a5", borderRadius: 8,
                            color: "#dc2626", fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                            fontFamily: "Nunito, sans-serif", whiteSpace: "nowrap",
                          }}
                        ><X size={14} /> Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card-panel">
              <div className="title-group" style={{ marginBottom: 12 }}>
                <h3>All Student Accounts</h3>
                <p className="panel-subtitle">{studentAccounts.length} account{studentAccounts.length !== 1 ? "s" : ""} total</p>
              </div>
              {studentAccounts.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: "24px 0" }}>
                  No student accounts yet.
                </p>
              ) : (
                <div className="table-container">
                  <table className="cases-table compact">
                    <thead>
                      <tr><th>Name</th><th>Email</th><th>LRN</th><th>Grade</th><th>Section</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {studentAccounts.map((s) => (
                        <tr key={s.id}>
                          <td style={{ fontSize: 12, fontWeight: 700 }}>{s.name}</td>
                          <td style={{ fontSize: 12 }}>{s.email}</td>
                          <td style={{ fontSize: 12 }}>{s.lrn || "—"}</td>
                          <td style={{ fontSize: 12 }}>{s.grade || "—"}</td>
                          <td style={{ fontSize: 12 }}>{s.section || "—"}</td>
                          <td>
                            <span className={`status-badge ${s.approved ? "resolved" : "pending"}`}>
                              {s.approved ? "Approved" : "Pending"}
                            </span>
                          </td>
                          <td>
                            {!s.approved && (
                              <button className="read-btn tiny" onClick={() => handleApproveAccount(s.id, s.name)}>Approve</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════
            GRADE & SECTIONS TAB
        ══════════════════════════════ */}
        {activeTab === "sections" && (
          <div className="admin-content">
            <div className="card-panel">
              <div className="title-group" style={{ marginBottom: 20 }}>
                <h3>Grade & Section Management</h3>
                <p className="panel-subtitle">Choose a grade level, then add or remove its sections — keeps Analytics filters and records consistent.</p>
              </div>

              {/* Grade selector */}
              <div className="mf-filter-row" style={{ marginBottom: 20 }}>
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
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <input
                  style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14 }}
                  placeholder={`e.g. Rizal — new section under ${sectionMgmtGrade}`}
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
                />
                <button
                  onClick={handleAddSection}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "10px 18px",
                    background: "#dcfce7", border: "1.5px solid #86efac", borderRadius: 8,
                    color: "#15803d", fontSize: 13, fontWeight: 800, cursor: "pointer",
                    fontFamily: "Nunito, sans-serif", whiteSpace: "nowrap",
                  }}
                ><Plus size={14} /> Add Section</button>
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
                                aria-label={`Edit section ${s.section}`}
                                value={editingSectionName}
                                onChange={(e) => setEditingSectionName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveSection();
                                  if (e.key === "Escape") handleCancelSectionEdit();
                                }}
                                autoFocus
                              />
                            ) : s.section}
                          </td>
                          <td>
                            {editingSectionId === s.id ? (
                              <div className="grade-sections-actions">
                                <button type="button" className="grade-section-action edit" aria-label="Save section" title="Save" onClick={handleSaveSection}>
                                  <CheckCircle size={14} /> <span>Save</span>
                                </button>
                                <button type="button" className="grade-section-action cancel" aria-label="Cancel section edit" title="Cancel" onClick={handleCancelSectionEdit}>
                                  <X size={14} /> <span>Cancel</span>
                                </button>
                              </div>
                            ) : (
                              <div className="grade-sections-actions">
                                <button type="button" className="grade-section-action edit" aria-label={`Edit ${s.section}`} title="Edit" onClick={() => handleEditSection(s.id, s.section)}>
                                  <Edit size={14} /> <span>Edit</span>
                                </button>
                                <button type="button" className="grade-section-action delete" aria-label={`Delete ${s.section}`} title="Delete" onClick={() => handleDeleteSection(s.id, s.section)}>
                                  <Trash2 size={14} /> <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Overview across all grades */}
              <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #f1f5f9" }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Overview — all grades
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  {["Grade 7", "Grade 8", "Grade 9", "Grade 10"].map((g) => {
                    const count = gradeSections.filter((s) => s.grade === g).length;
                    return (
                      <div key={g} style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "12px 14px" }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#64748b" }}>{g}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#15803d" }}>
                          {count} <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>section{count !== 1 ? "s" : ""}</span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════
            SETTINGS TAB
        ══════════════════════════════ */}
        {activeTab === "settings" && (
          <div className="admin-content">
            <div className="card-panel">
              <div className="title-group" style={{ marginBottom: 20 }}>
                <h3>System Settings</h3>
                <p className="panel-subtitle">Administrative configuration</p>
              </div>
              <div className="settings-section">
                <h3>Data Management</h3>
                <div className="settings-grid">
                  <div className="settings-item">
                    <div className="settings-item-info">
                      <h4>Reset All Data</h4>
                      <p>Clear all reports and reseed the system (dev use only)</p>
                    </div>
                    <button className="delete-btn small" style={{ padding: "8px 16px" }}
                      onClick={() => {
                        if (window.confirm("This will delete ALL reports and reset the system. Continue?")) {
                          import("../data/store").then((m) => m.resetAllData()).catch((err) => showToast("Reset failed: " + err.message, "error"));
                        }
                      }}>Reset</button>
                  </div>
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
          <div className="admin-modal large">
            <div className="modal-header-admin">
              <div className="title-wrap">
                <FileText size={18} color="var(--accent-color)" />
                <h3>Manage Incident — Report #{selectedReport.id}</h3>
              </div>
              <X size={20} className="close-modal-btn" onClick={() => setShowUpdateModal(false)} />
            </div>

            <div className="admin-modal-content">
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
                  <label>Date of Incident</label>
                  <div className="detail-value">{selectedReport.date || "—"}</div>
                </div>
                <div className="detail-group">
                  <label>Approximate Time</label>
                  <div className="detail-value">{to12Hour(selectedReport.time)}</div>
                </div>
                <div className="detail-group">
                  <label>Location</label>
                  <div className="detail-value">{selectedReport.location || "—"}</div>
                </div>
              </div>

              {/* Reporter Profile */}
              {!selectedReport.isAnonymous && (selectedReport.reporterAge || selectedReport.reporterGrade || selectedReport.reporterSex) && (
                <div style={{ background: "#dcfce7", border: "1.5px solid #86efac", borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Reporter Profile</p>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    {selectedReport.reporterAge && (
                      <div>
                        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 2px" }}>Age</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: 0 }}>{selectedReport.reporterAge}</p>
                      </div>
                    )}
                    {selectedReport.reporterSex && (
                      <div>
                        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 2px" }}>Sex</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: 0 }}>{selectedReport.reporterSex}</p>
                      </div>
                    )}
                    {selectedReport.reporterGrade && (
                      <div>
                        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 2px" }}>Grade Level</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: 0 }}>{selectedReport.reporterGrade}</p>
                      </div>
                    )}
                    {selectedReport.reporterSection && (
                      <div>
                        <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 2px" }}>Section</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: 0 }}>{selectedReport.reporterSection}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="detail-group full-width" style={{ marginBottom: 14 }}>
                <label>Description</label>
                <div className="description-display">{selectedReport.description || "No description provided."}</div>
              </div>

              <div className="detail-group full-width" style={{ marginBottom: 14 }}>
                <label>People Involved</label>
                <div className="involved-display">{selectedReport.involved || "Not specified."}</div>
              </div>

              {/* Evidence */}
              {selectedReport.evidence && selectedReport.evidence.length > 0 && (
                <div className="detail-group full-width" style={{ marginBottom: 14 }}>
                  <label>Evidence Attached ({selectedReport.evidence.length} file{selectedReport.evidence.length > 1 ? "s" : ""})</label>
                  <div className="s-evidence-row">
                    {selectedReport.evidence.map((ev, idx) =>
                      ev.type && ev.type.startsWith("image/") ? (
                        <div key={idx} style={{ position: "relative", cursor: "zoom-in" }} onClick={() => setLightboxSrc(ev.data)}>
                          <img src={ev.data} alt={ev.name}
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
                </div>
              )}

              <div className="admin-management-section">
                <div className="title-stack">
                  <h4>Administrative Oversight</h4>
                  <p>Update status and document notes. All fields below are required before the status can be updated.</p>
                </div>
                <div className="form-group">
                  <label>Update Case Status</label>
                  <select className="professional-select" style={{ width: "100%" }}
                    value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                    <option value="Pending">Pending</option>
                    <option value="Under Investigation">Under Investigation</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label>Staff Notes <span style={{ color: "#ef4444" }}>*</span> <span style={{ opacity: 0.5, textTransform: "none" }}>(visible to student)</span></label>
                  <textarea placeholder="Document investigation steps or decisions…"
                    className={manageFieldErrors.adminNotes ? "field-error" : ""}
                    style={{ minHeight: 90, fontSize: 13 }}
                    value={adminNotes} onChange={(e) => { setAdminNotes(e.target.value); setManageFieldErrors((p) => ({ ...p, adminNotes: false })); }} />
                  {manageFieldErrors.adminNotes && <span className="field-error-msg">Staff notes are required.</span>}
                </div>

                <div className="form-group" style={{ marginTop: 14 }}>
                  <label>Scheduled Conference Date <span style={{ color: "#ef4444" }}>*</span></label>
                  <input type="date" value={conferenceDate}
                    className={manageFieldErrors.conferenceDate ? "field-error" : ""}
                    onChange={(e) => { setConferenceDate(e.target.value); setManageFieldErrors((p) => ({ ...p, conferenceDate: false })); }}
                    style={{ width: "100%" }} />
                  {manageFieldErrors.conferenceDate && <span className="field-error-msg">Conference date is required.</span>}
                </div>
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label>Conference Time <span style={{ color: "#ef4444" }}>*</span></label>
                  <input type="time" value={conferenceTime}
                    className={manageFieldErrors.conferenceTime ? "field-error" : ""}
                    onChange={(e) => { setConferenceTime(e.target.value); setManageFieldErrors((p) => ({ ...p, conferenceTime: false })); }}
                    style={{ width: "100%" }} />
                  {manageFieldErrors.conferenceTime && <span className="field-error-msg">Conference time is required.</span>}
                </div>
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label>Conference Location <span style={{ color: "#ef4444" }}>*</span></label>
                  <input type="text" placeholder="Prefect Office, Guidance Room, or virtual link" value={conferenceLocation}
                    className={manageFieldErrors.conferenceLocation ? "field-error" : ""}
                    onChange={(e) => { setConferenceLocation(e.target.value); setManageFieldErrors((p) => ({ ...p, conferenceLocation: false })); }}
                    style={{ width: "100%" }} />
                  {manageFieldErrors.conferenceLocation && <span className="field-error-msg">Conference location is required.</span>}
                </div>
                <div className="form-group" style={{ marginTop: 14 }}>
                  <label>Conference Agenda / Notes <span style={{ color: "#ef4444" }}>*</span></label>
                  <textarea placeholder="Explain what the meeting will cover or who should attend…"
                    className={manageFieldErrors.conferenceNotes ? "field-error" : ""}
                    style={{ minHeight: 80, fontSize: 13 }} value={conferenceNotes}
                    onChange={(e) => { setConferenceNotes(e.target.value); setManageFieldErrors((p) => ({ ...p, conferenceNotes: false })); }} />
                  {manageFieldErrors.conferenceNotes && <span className="field-error-msg">Conference agenda/notes are required.</span>}
                </div>
              </div>
            </div>

            <div className="modal-footer-bar">
              <button className="cancel-btn" onClick={() => setShowUpdateModal(false)}>Discard</button>
              <button className="submit-btn" onClick={handleConfirmUpdate}>Update Status</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SCHEDULED CONFERENCE VIEW MODAL ── */}
      {conferenceViewItem && (
        <div className="admin-modal-overlay" onClick={() => setConferenceViewItem(null)}>
          <div className="admin-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-admin">
              <div className="title-wrap">
                <Calendar size={18} color="var(--accent-color)" />
                <h3>Conference Details</h3>
              </div>
              <X size={20} className="close-modal-btn" onClick={() => setConferenceViewItem(null)} />
            </div>
            <div className="admin-modal-content">
              <div className="admin-conference-view-banner">
                <span className="admin-conference-case">Case #{conferenceViewItem.id}</span>
                <p>Scheduled conference details for this report.</p>
              </div>

              <div className="admin-case-detail-box" style={{ marginTop: 16 }}>
                <div className="admin-details-grid">
                  <div><label>Case</label><span>#{conferenceViewItem.id}</span></div>
                  <div><label>Status</label><span>{conferenceViewItem.status}</span></div>
                  <div><label>Type</label><span>{conferenceViewItem.type}</span></div>
                  <div><label>Reporter</label><span>{conferenceViewItem.reporterName}</span></div>
                  <div><label>Date</label><span>{conferenceViewItem.date || "Date TBD"}</span></div>
                  <div><label>Time</label><span>{conferenceViewItem.time || "Time TBD"}</span></div>
                  <div style={{ gridColumn: "1 / -1" }}><label>Location</label><span>{conferenceViewItem.location || "Location TBD"}</span></div>
                </div>
                {conferenceViewItem.notes && (
                  <div style={{ marginTop: 14 }}>
                    <label className="admin-case-detail-label">Agenda / Notes</label>
                    <p className="admin-case-detail-text">{conferenceViewItem.notes}</p>
                  </div>
                )}
              </div>
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
                  <option value="article">Article</option>
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
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>JPG, PNG, PDF, DOCX accepted</span>
                        </>
                      )}
                      <input id="a-file-input" type="file" style={{ display: "none" }}
                        accept="image/*,.pdf,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            setAFilePreview(ev.target.result);
                            setAForm((f) => ({ ...f, thumbnail: ev.target.result }));
                          };
                          reader.readAsDataURL(file);
                        }} />
                    </div>
                    {aFilePreview && (
                      <button type="button" style={{ marginTop: 6, fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
                        onClick={() => { setAFilePreview(null); setAForm((f) => ({ ...f, thumbnail: "" })); }}>
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
                    <div style={{ marginTop: 10, borderRadius: 8, overflow: "hidden" }}>
                      <iframe src={aForm.videoUrl} title="preview" width="100%" height="160" frameBorder="0" />
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
          <div className="admin-modal" style={{ maxWidth: 440 }}>
            <div className="modal-header-admin">
              <div className="title-wrap">
                <MapPin size={18} color="var(--accent-color)" />
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
              <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Icon</label>
                  <input style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 16, width: "100%", textAlign: "center" }}
                    maxLength={2}
                    value={locForm.icon} onChange={(e) => setLocForm({ ...locForm, icon: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Color</label>
                  <input type="color" style={{ padding: 4, borderRadius: 8, border: "1.5px solid #e2e8f0", width: "100%", height: 40, cursor: "pointer" }}
                    value={locForm.color} onChange={(e) => setLocForm({ ...locForm, color: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1.4 }}>
                  <label>Zone</label>
                  <select className="professional-select" style={{ width: "100%" }}
                    value={locForm.zone} onChange={(e) => setLocForm({ ...locForm, zone: e.target.value })}>
                    <option value="inside">Inside School</option>
                    <option value="outside">Outside / Other</option>
                  </select>
                </div>
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

      {toast && (
        <div className={`s-toast ${toast.type === "error" ? "error" : ""}`}>
          {toast.type === "error" ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
          <span>{toast.msg}</span>
        </div>
      )}

    </div>
  );
}