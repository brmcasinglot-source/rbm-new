import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/StudentDashboard.css";

import logo from "../assets/logo.png";
import bg   from "../assets/cnhs.jpg";

import {
  LayoutDashboard, FileText, Shield, BookOpen, User, Image,
  ExternalLink, Upload, HelpCircle, Lock, Camera, Trash2, Bell,
  CheckCircle, Clock, AlertTriangle, ArrowUpRight, X, Paperclip,
  Eye, EyeOff, Play, AlertCircle, Calendar,
  Menu, ChevronDown, LogOut,
} from "lucide-react";

import {
  getReports, submitReport,
  getAwarenessContent,
  getStudentNotifications, markStudentNotifRead, markAllStudentNotifRead,
  updateStudentProfile,
  LOCATION_META, getCustomLocations,
  GRADE_OPTIONS, getGradeSections,
} from "../data/store";

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusIcon(status) {
  if (status === "Resolved")           return <CheckCircle size={13} />;
  if (status === "Under Review" || status === "Under Investigation") return <Clock size={13} />;
  return <AlertTriangle size={13} />;
}
function readFile(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = (e) => res({ name: file.name, type: file.type, data: e.target.result });
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

export default function StudentDashboard() {
  const navigate = useNavigate();

  const studentName = localStorage.getItem("studentName") || "";
  const [profileEditing,    setProfileEditing]    = useState(false);
  const [profileGrade,      setProfileGrade]      = useState(() => localStorage.getItem("studentGrade")   || "");
  const [profileSection,    setProfileSection]    = useState(() => localStorage.getItem("studentSection") || "");
  const [profileAge,        setProfileAge]        = useState(() => localStorage.getItem("studentAge")     || "");
  const [profileGender,     setProfileGender]     = useState(() => localStorage.getItem("studentSex")     || "");
  const [profileGradeEdit,  setProfileGradeEdit]  = useState(() => localStorage.getItem("studentGrade")   || "");
  const [profileSectionEdit,setProfileSectionEdit]= useState(() => localStorage.getItem("studentSection") || "");
  const [profileAgeEdit,    setProfileAgeEdit]    = useState(() => localStorage.getItem("studentAge")     || "");
  const [profileGenderEdit, setProfileGenderEdit] = useState(() => localStorage.getItem("studentSex")     || "");
  const [activeTab,   setActiveTab]   = useState("dashboard");
  const [hubSearchQuery, setHubSearchQuery] = useState("");
  const [hubFilter,   setHubFilter]   = useState("all");
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen,   setNotifOpen]   = useState(false);
  const [profilePic,  setProfilePic]  = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Password visibility
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass,      setShowNewPass]      = useState(false);
  const [showConfirmPass,  setShowConfirmPass]  = useState(false);

  // Toast notification
  const [toast, setToast] = useState(null); // { msg, type }

  // Forgot password modal
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent,  setForgotSent]  = useState(false);

  // Hub content viewer modal
  const [hubViewItem, setHubViewItem] = useState(null);
  const [caseViewItem, setCaseViewItem] = useState(null);
  const [conferenceViewItem, setConferenceViewItem] = useState(null);

  // Live data
  const [reports,          setReports]          = useState([]);
  const [awarenessContent, setAwarenessContent] = useState([]);
  const [notifications,    setNotifications]    = useState([]);
  const [customLocations,  setCustomLocations]  = useState([]);

  // Report form
  const [reportForm, setReportForm] = useState({
    type: "", date: "", time: "", location: "", description: "",
    descriptionLeadUp: "", descriptionImpact: "", descriptionActions: "",
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

  // Admin-managed sections per grade (Grade & Sections page) — same source
  // the Sign Up form uses, so Victim/Offender/Witness grade+section pickers
  // in the report form stay in sync with what admins actually manage.
  const [gradeSectionsList, setGradeSectionsList] = useState([]);
  useEffect(() => {
    getGradeSections().then(setGradeSectionsList).catch(() => setGradeSectionsList([]));
  }, []);

  const profileRef = useRef();
  const notifRef   = useRef();

  // ── Poll Supabase every 2 s — only update state when data actually changed ─
  useEffect(() => {
    const setIfChanged = (setter) => (next) =>
      setter((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const setReportsIfChanged          = setIfChanged(setReports);
    const setAwarenessContentIfChanged = setIfChanged(setAwarenessContent);
    const setNotificationsIfChanged    = setIfChanged(setNotifications);
    const setCustomLocationsIfChanged  = setIfChanged(setCustomLocations);
    let cancelled = false;

    async function refresh() {
      try {
        const [reportsData, awarenessData, notifData] = await Promise.all([
          getReports(), getAwarenessContent(), getStudentNotifications(),
        ]);
        if (cancelled) return;
        setReportsIfChanged(reportsData);
        setAwarenessContentIfChanged(awarenessData);
        setNotificationsIfChanged(notifData);
      } catch (err) {
        console.error("Dashboard refresh failed:", err);
      }

      // Fetched separately: a failure in any of the calls above (or here)
      // shouldn't be able to block the other from refreshing — previously
      // one broken query silently stalled everything, including locations.
      try {
        const locationsData = await getCustomLocations();
        if (cancelled) return;
        setCustomLocationsIfChanged(locationsData);
      } catch (err) {
        console.error("getCustomLocations failed:", err);
      }
    }
    refresh();
    const id = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // One-time check on load: if admin just approved this account, there's an
  // unread "success" notification waiting — surface it as a toast (not just
  // buried in the bell), then mark it read so it doesn't repeat next login.
  useEffect(() => {
    (async () => {
      try {
        const notifs = await getStudentNotifications();
        const welcomeNotif = notifs.find((n) => n.type === "success" && !n.read);
        if (welcomeNotif) {
          showToast(welcomeNotif.title);
          await markStudentNotifRead(welcomeNotif.id);
          setNotifications(await getStudentNotifications());
        }
      } catch (err) {
        console.error("Welcome notification check failed:", err);
      }
    })();
  }, []);

  useEffect(() => {
    const close = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current   && !notifRef.current.contains(e.target))   setNotifOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const handleProfilePicChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setProfilePic(ev.target.result);
    reader.readAsDataURL(file);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ── Evidence file handler ─────────────────────────────────────────────────
  const handleEvidencePick = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    try {
      const converted = await Promise.all(files.map(readFile));
      setEvidenceFiles((prev) => [...prev, ...converted]);
    } catch {
      setFormError("Could not read one or more files. Please try again.");
    }
  };

  const removeEvidence = (idx) =>
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));

  // ── Report submission ─────────────────────────────────────────────────────
  // ── Person list helpers ──────────────────────────────────────────────────
  const updatePerson = (setter, idx, field, val) =>
    setter(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  const addPerson    = (setter) => setter(prev => [...prev, emptyPerson()]);
  const removePerson = (setter, idx) => setter(prev => prev.filter((_, i) => i !== idx));

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
    setReports(await getReports());
    setNotifications(await getStudentNotifications());
    setReportForm({ type: "", date: "", time: "", location: "", description: "", descriptionLeadUp: "", descriptionImpact: "", descriptionActions: "", involved: "" });
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
  const scheduledConferenceList = [...myReports]
    .filter((r) => r.scheduledConference && (r.scheduledConference.date || r.scheduledConference.time || r.scheduledConference.location))
    .map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      date: r.scheduledConference.date || "Date TBD",
      time: r.scheduledConference.time || "Time TBD",
      location: r.scheduledConference.location || "Location TBD",
      notes: r.scheduledConference.notes || "",
    }))
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

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
    dashboard: { title: `👋 Welcome, ${studentName || "Student"}!`, sub: "A safer school starts with speaking up." },
  }[activeTab] || { title: "Dashboard", sub: "" });

  const { title, sub } = getTabHeader();

  return (
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
                    <button onClick={async () => { await markAllStudentNotifRead(); setNotifications(await getStudentNotifications()); }}>
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
                        setNotifications(await getStudentNotifications());
                        setNotifOpen(false);
                        if (n.type === "status") setActiveTab("cases");
                        else if (n.type === "hub") setActiveTab("dashboard");
                        else if (n.type === "report") setActiveTab("cases");
                      }}>
                      <div className={`s-notif-dot ${n.type === "status" ? "green" : n.type === "success" ? "blue" : "purple"}`} />
                      <div><p>{n.title}</p><span>{n.time}</span></div>
                    </div>
                  ))}
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
                  {profilePic
                    ? <img src={profilePic} alt="avatar" />
                    : <span>{(studentName || "S")[0].toUpperCase()}</span>}
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
                  <button className="s-logout-btn" onClick={() => navigate("/login?role=student")}>
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
                  <p className="s-hub-subtitle">{filteredHub.length} resource{filteredHub.length !== 1 ? "s" : ""} available</p>
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
                    { key: "article",     label: "Articles",     emoji: "📄" },
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
                    let ytThumb = null;
                    if (item.type === "video" && item.videoUrl) {
                      const match = item.videoUrl.match(/(?:embed\/|v=|vi=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
                      if (match) ytThumb = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
                    }
                    const thumbSrc = item.thumbnail || ytThumb || null;
                    return (
                      <div className="s-hub-card s-hub-card-clickable" key={item.id}
                        onClick={() => setHubViewItem(item)}>
                        <div className="s-hub-thumb-container">
                          {item.type === "video" ? (
                            <>
                              {thumbSrc
                                ? <img src={thumbSrc} alt={item.title} className="s-hub-img" />
                                : <div className="s-hub-placeholder"><Play size={36} /></div>
                              }
                              <div className="s-hub-play-overlay">
                                <div className="s-hub-play-btn">
                                  <Play size={20} color="#fff" fill="#fff" />
                                </div>
                              </div>
                            </>
                          ) : item.fileData ? (
                            <img src={item.fileData} alt={item.title} className="s-hub-img" />
                          ) : thumbSrc ? (
                            <img src={thumbSrc} alt={item.title} className="s-hub-img" />
                          ) : (
                            <div className="s-hub-placeholder">
                              {item.type === "article"     && <FileText size={32} />}
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
                            <span className="s-conference-status">{conf.status}</span>
                          </div>
                          <div className="s-conference-meta"><strong>{conf.type}</strong></div>
                          <div className="s-conference-meta">📅 {conf.date}</div>
                          <div className="s-conference-meta">🕒 {conf.time}</div>
                          <div className="s-conference-meta">📍 {conf.location}</div>
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
          <div className="s-content">
            {myReports.length === 0 ? (
              <div className="s-panel s-empty-state">
                <Shield size={48} color="#d1fae5" />
                <h3>No cases to monitor</h3>
                <p>Submit an incident report and its status will be tracked here in real time.</p>
                <button className="s-submit-btn" onClick={() => setActiveTab("report")}>Submit a Report</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {myReports.map((r) => (
                  <div className="s-panel s-case-card s-case-card-clickable" key={r.id} onClick={() => setCaseViewItem(r)}>
                    <div className="s-case-top">
                      <div>
                        <span className="s-case-id">Case #{r.id}</span>
                        <span className="s-case-type">{r.type}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`s-status-badge ${r.status.toLowerCase().replace(/\s/g, "-")}`}>
                          {statusIcon(r.status)} {r.status}
                        </span>
                        <ArrowUpRight size={15} color="#9ca3af" />
                      </div>
                    </div>
                    <p className="s-case-desc">{r.description}</p>
                    <div className="s-case-meta">
                      <span>📅 {r.date}{r.time ? ` at ${r.time}` : ""}</span>
                      {r.location && <span>📍 {r.location}</span>}
                      {r.evidence && r.evidence.length > 0 && (
                        <span><Paperclip size={12} /> {r.evidence.length} evidence file{r.evidence.length > 1 ? "s" : ""}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
                    <strong>Before you submit:</strong> Thank you for speaking up — please make sure everything you share here is accurate and truthful, since fabricated reports can hurt real victims and lead to disciplinary action.
                  </div>
                </div>

                <form onSubmit={handleReportSubmit}>

                  {/* ── Reporter Information ── */}
                  <div className="s-form-section-title">Reporter Information</div>
                  <div className="s-form-row">
                    <div className="s-form-group">
                      <label>Reporter Role *</label>
                      <select value={reporterType} required
                        onChange={(e) => { setReporterType(e.target.value); setHasWitnesses(false); }}>
                        <option value="">Select role…</option>
                        <option value="Victim">Victim</option>
                        <option value="Witness">Witness</option>
                        <option value="Friend">Friend of Victim</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <div className="s-form-row">
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
                  <div className="s-form-row">
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
                      <div className="s-form-group"><label>Age</label>
                        <input type="number" min="5" max="25" placeholder="e.g. 14" value={v.age} onChange={e => updatePerson(setVictims, idx, "age", e.target.value)} /></div>
                      <div className="s-form-row">
                        <div className="s-form-group"><label>Grade</label>
                          <select value={v.grade} onChange={e => { updatePerson(setVictims, idx, "grade", e.target.value); updatePerson(setVictims, idx, "section", ""); }}>
                            <option value="">Select grade</option>
                            {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select></div>
                        <div className="s-form-group"><label>Section</label>
                          <select value={v.section} disabled={!v.grade} onChange={e => updatePerson(setVictims, idx, "section", e.target.value)}>
                            <option value="">{!v.grade ? "Select grade first" : "Select section"}</option>
                            {gradeSectionsList.filter((s) => s.grade === v.grade).map((s) => (
                              <option key={s.id} value={s.section}>{s.section}</option>
                            ))}
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
                  <div className="s-form-section-title" style={{ marginTop: 20 }}>Alleged Offender Information</div>
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
                      <div className="s-form-group"><label>Age</label>
                        <input type="number" min="5" max="25" placeholder="e.g. 15" value={o.age} onChange={e => updatePerson(setOffenders, idx, "age", e.target.value)} /></div>
                      <div className="s-form-row">
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
                        <select value={hasWitnesses ? "yes" : "no"} onChange={(e) => setHasWitnesses(e.target.value === "yes")}>
                          <option value="no">No witnesses</option>
                          <option value="yes">Yes, add witness information</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {(reporterType === "Witness" || (reporterType === "Victim" && hasWitnesses)) && (
                    <>
                      <div className="s-form-section-title" style={{ marginTop: 20 }}>Witness Information</div>
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
                  <div className="s-form-section-title" style={{ marginTop: 20 }}>Incident Description</div>
                  <div className="s-form-group">
                    <label>What happened? *</label>
                    <textarea placeholder="Describe the incident in detail…" required
                      value={reportForm.description}
                      onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })} />
                  </div>
                  <div className="s-form-group">
                    <label>Events leading to the incident</label>
                    <textarea placeholder="What happened before the incident? Any prior conflicts or context…" style={{ minHeight: 80 }}
                      value={reportForm.descriptionLeadUp}
                      onChange={(e) => setReportForm({ ...reportForm, descriptionLeadUp: e.target.value })} />
                  </div>
                  <div className="s-form-group">
                    <label>Impact on the victim</label>
                    <textarea placeholder="How was the victim affected? Physically, emotionally, socially…" style={{ minHeight: 80 }}
                      value={reportForm.descriptionImpact}
                      onChange={(e) => setReportForm({ ...reportForm, descriptionImpact: e.target.value })} />
                  </div>
                  <div className="s-form-group">
                    <label>Immediate actions taken</label>
                    <textarea placeholder="Was anyone notified? Did anyone intervene? What happened after…" style={{ minHeight: 80 }}
                      value={reportForm.descriptionActions}
                      onChange={(e) => setReportForm({ ...reportForm, descriptionActions: e.target.value })} />
                  </div>

                  {/* Evidence Upload */}
                  <div className="s-form-group">
                    <label>Evidence (Photos / Files)</label>
                    <div className="s-file-upload"
                      onClick={() => document.getElementById("s-file-input").click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={async (e) => {
                        e.preventDefault();
                        const files = Array.from(e.dataTransfer.files);
                        const converted = await Promise.all(files.map(readFile));
                        setEvidenceFiles((prev) => [...prev, ...converted]);
                      }}>
                      <Upload size={22} color="var(--s-accent)" style={{ marginBottom: 8 }} />
                      <p>Click or drag &amp; drop files here</p>
                      <span>Photos, screenshots, documents accepted</span>
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
                  <div className="s-avatar-wrap">
                    <div className="s-avatar" onClick={() => document.getElementById("s-profile-upload").click()} title="Click to change">
                      {profilePic ? <img src={profilePic} alt="Profile" /> : <User size={36} />}
                    </div>
                    <div className="s-camera-badge" onClick={() => document.getElementById("s-profile-upload").click()}>
                      <Camera size={12} />
                    </div>
                    <input id="s-profile-upload" type="file" hidden accept="image/*" onChange={handleProfilePicChange} />
                  </div>
                  <div className="s-profile-meta">
                    <h3>{studentName || "Student Name"}</h3>
                    <p>Email Address: {localStorage.getItem("email") || "mariacruz@gmail.com"}</p>
                    {profilePic && (
                      <button className="s-remove-photo" onClick={() => setProfilePic(null)}>
                        <Trash2 size={11} /> Remove Photo
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Personal Info ── */}
                <div className="s-profile-info-box">
                  <div className="s-profile-info-header">
                    <span className="s-profile-info-title">Personal Information</span>
                    {!profileEditing
                      ? <button className="s-edit-btn" onClick={() => setProfileEditing(true)}>✏️ Edit</button>
                      : <div style={{ display: "flex", gap: 8 }}>
                          <button className="s-cancel-btn" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => {
                            setProfileEditing(false);
                            setProfileAgeEdit(profileAge);
                            setProfileGenderEdit(profileGender);
                            setProfileGradeEdit(profileGrade);
                            setProfileSectionEdit(profileSection);
                          }}>Cancel</button>
                          <button className="s-submit-btn" style={{ fontSize: 12, padding: "4px 14px" }} onClick={async () => {
                            const id = localStorage.getItem("studentId");
                            const result = await updateStudentProfile(id, {
                              age:     profileAgeEdit,
                              sex:     profileGenderEdit,
                              grade:   profileGradeEdit,
                              section: profileSectionEdit,
                            });
                            if (!result.success) { showToast("Could not update profile: " + result.error, "error"); return; }
                            setProfileAge(profileAgeEdit);
                            setProfileGender(profileGenderEdit);
                            setProfileGrade(profileGradeEdit);
                            setProfileSection(profileSectionEdit);
                            setProfileEditing(false);
                            showToast("Profile updated successfully!");
                          }}>Save</button>
                        </div>
                    }
                  </div>
                  <div className="s-profile-fields">
                    <div className="s-profile-field"><label>Full Name</label><span>{studentName || "—"}</span></div>
                    <div className="s-profile-field"><label>Age</label>
                      {profileEditing
                        ? <input className="s-profile-select" type="number" min="10" max="25" placeholder="e.g. 14" value={profileAgeEdit} onChange={e => setProfileAgeEdit(e.target.value)} style={{ width: 80 }} />
                        : <span>{profileAge || "—"}</span>}
                    </div>
                    <div className="s-profile-field"><label>Gender</label>
                      {profileEditing
                        ? <select className="s-profile-select" value={profileGenderEdit} onChange={e => setProfileGenderEdit(e.target.value)}>
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        : <span>{profileGender || "—"}</span>}
                    </div>
                    <div className="s-profile-field">
                      <label>Grade Level</label>
                      {profileEditing
                        ? <select className="s-profile-select" value={profileGradeEdit} onChange={e => setProfileGradeEdit(e.target.value)}>
                            <option value="">Select grade</option>
                            {["Grade 7","Grade 8","Grade 9","Grade 10"].map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        : <span>{profileGrade || "—"}</span>}
                    </div>
                    <div className="s-profile-field">
                      <label>Section</label>
                      {profileEditing
                        ? <input className="s-profile-select" type="text" placeholder="e.g. Rizal" value={profileSectionEdit} onChange={e => setProfileSectionEdit(e.target.value)} />
                        : <span>{profileSection || "—"}</span>}
                    </div>
                    <div className="s-profile-field"><label>Total Reports Filed</label><span style={{ color: "#16a34a", fontWeight: 700 }}>{myReports.length}</span></div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="s-panel s-security-card">
                  <div className="s-help-header" style={{ marginBottom: 20 }}>
                    <Lock size={16} color="var(--s-accent)" />
                    <h3 style={{ margin: 0 }}>Security &amp; Privacy</h3>
                  </div>
                  <div className="s-privacy-banner">
                    <Shield size={14} color="#16a34a" />
                    <span>Your reports and personal information are kept strictly confidential. Only authorized school personnel can view your submissions.</span>
                  </div>
                  <form onSubmit={(e) => { e.preventDefault(); showToast("Password updated successfully!"); }} style={{ marginTop: 18 }}>
                    <div className="s-security-section-label">Change Password</div>
                    <div className="s-form-group">
                      <label>Current Password</label>
                      <div className="s-pass-wrap">
                        <input type={showCurrentPass ? "text" : "password"} placeholder="••••••••" className="s-pass-input" />
                        <button type="button" className="s-eye-btn" onClick={() => setShowCurrentPass(!showCurrentPass)}>
                          {showCurrentPass ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>
                    <div className="s-form-row">
                      <div className="s-form-group">
                        <label>New Password</label>
                        <div className="s-pass-wrap">
                          <input type={showNewPass ? "text" : "password"} placeholder="Min. 8 characters" className="s-pass-input" />
                          <button type="button" className="s-eye-btn" onClick={() => setShowNewPass(!showNewPass)}>
                            {showNewPass ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                      <div className="s-form-group">
                        <label>Confirm New Password</label>
                        <div className="s-pass-wrap">
                          <input type={showConfirmPass ? "text" : "password"} placeholder="Re-type new password" className="s-pass-input" />
                          <button type="button" className="s-eye-btn" onClick={() => setShowConfirmPass(!showConfirmPass)}>
                            {showConfirmPass ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button type="submit" className="s-submit-btn">Update Password</button>
                    </div>
                  </form>
                </div>
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
          {
            key: "review",
            title: "Final Review",
            desc: r.adminNotes
              ? "The Prefect of Discipline has added notes — see below."
              : "Reviewing actions and documentation.",
            state: status === "Resolved" ? "completed" : (r.adminNotes ? "active" : "waiting"),
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
          "Resolved": "This case has been resolved. Thank you for speaking up.",
        };
        return (
          <div className="s-modal-overlay" onClick={() => setCaseViewItem(null)}>
            <div className="s-modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="s-modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                            {step.state === "completed" ? "COMPLETED"
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
                  <div className="s-admin-note" style={{ marginTop: 16 }}>
                    <Lock size={12} color="var(--s-accent)" />
                    <div><strong>Note from the Prefect:</strong> {r.adminNotes}</div>
                  </div>
                )}

                {r.scheduledConference && (
                  <div className="s-admin-note" style={{ marginTop: 16, background: "#dbeafe", borderColor: "#93c5fd" }}>
                    <Calendar size={12} color="#2563eb" />
                    <div>
                      <strong>Scheduled Conference:</strong> {r.scheduledConference.date || "Date TBD"}
                      {r.scheduledConference.time ? ` at ${r.scheduledConference.time}` : ""}
                      {r.scheduledConference.location ? ` • ${r.scheduledConference.location}` : ""}
                      {r.scheduledConference.notes ? ` • ${r.scheduledConference.notes}` : ""}
                    </div>
                  </div>
                )}

                {/* Report Details */}
                <div className="s-case-details-box">
                  <h4 className="s-case-tracker-title" style={{ marginBottom: 10 }}><FileText size={14} color="var(--s-accent)" /> Report Details</h4>
                  <div className="s-case-detail-grid">
                    <div><label>Date</label><span>{r.date || "—"}</span></div>
                    <div><label>Time</label><span>{r.time || "—"}</span></div>
                    <div><label>Location</label><span>{r.location || "—"}</span></div>
                    <div><label>Submitted</label><span>{r.isAnonymous ? "🕵️ Anonymously" : "With my name"}</span></div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label className="s-case-detail-label">Description</label>
                    <p className="s-case-detail-text">{r.description || "No description provided."}</p>
                  </div>
                  {r.involved && (
                    <div style={{ marginTop: 12 }}>
                      <label className="s-case-detail-label">People Involved</label>
                      <p className="s-case-detail-text">{r.involved}</p>
                    </div>
                  )}
                  {r.evidence && r.evidence.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <label className="s-case-detail-label">Evidence</label>
                      <div className="s-evidence-row" style={{ marginTop: 6 }}>
                        {r.evidence.map((ev, idx) => (
                          ev.type && ev.type.startsWith("image/") ? (
                            <img key={idx} src={ev.data} alt={ev.name}
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
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── SCHEDULED CONFERENCE VIEW MODAL ── */}
      {conferenceViewItem && (
        <div className="s-modal-overlay" onClick={() => setConferenceViewItem(null)}>
          <div className="s-modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="s-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="s-hub-type-badge" style={{ position: "static" }}>{conferenceViewItem.type}</span>
                <h3>Conference Details</h3>
              </div>
              <button className="s-modal-close" onClick={() => setConferenceViewItem(null)}><X size={18} /></button>
            </div>
            <div className="s-modal-body">
              <div className="s-case-status-banner" style={{ background: "#dbeafe", borderColor: "#93c5fd" }}>
                <span className="s-status-badge" style={{ background: "#dbeafe", color: "#1d4ed8" }}>
                  <Calendar size={12} /> Case #{conferenceViewItem.id}
                </span>
                <p style={{ color: "#1e3a8a", margin: 0 }}>Your scheduled conference for this case is shown below.</p>
              </div>

              <div className="s-case-details-box" style={{ marginTop: 16 }}>
                <div className="s-case-detail-grid">
                  <div><label>Case</label><span>#{conferenceViewItem.id}</span></div>
                  <div><label>Status</label><span>{conferenceViewItem.status}</span></div>
                  <div><label>Date</label><span>{conferenceViewItem.date || "Date TBD"}</span></div>
                  <div><label>Time</label><span>{conferenceViewItem.time || "Time TBD"}</span></div>
                  <div style={{ gridColumn: "1 / -1" }}><label>Location</label><span>{conferenceViewItem.location || "Location TBD"}</span></div>
                </div>
                {conferenceViewItem.notes && (
                  <div style={{ marginTop: 12 }}>
                    <label className="s-case-detail-label">Agenda / Notes</label>
                    <p className="s-case-detail-text">{conferenceViewItem.notes}</p>
                  </div>
                )}
              </div>
            </div>
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
                  <iframe src={hubViewItem.videoUrl} title={hubViewItem.title} frameBorder="0" allowFullScreen
                    style={{ width: "100%", height: "360px", borderRadius: 10 }} />
                </div>
              )}
              {hubViewItem.fileData && (
                <img src={hubViewItem.fileData} alt={hubViewItem.title}
                  style={{ width: "100%", borderRadius: 10, marginBottom: 14, objectFit: "contain", maxHeight: 360 }} />
              )}
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
  );
}