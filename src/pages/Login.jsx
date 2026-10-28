import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import cnhs from "../assets/cnhs.jpg";
import "../styles/Login.css";
import {
  signIn,
  signUpStudent,
} from "../lib/auth.js";
import { getGradeSections, GRADE_OPTIONS } from "../data/store.js";

function getPasswordStrength(password) {
  const checks = [
    password.length >= 8,
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const labels = ["", "Very weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["#cbd5e1", "#ef4444", "#f97316", "#eab308", "#3b82f6", "#16a34a"];
  return { checks, score, label: labels[score], color: colors[score] };
}

export default function Login() {
  const navigate = useNavigate();

  const [mode,     setMode]     = useState("login");   // "login" | "register"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);

  // Registration fields
  const [regName,    setRegName]    = useState("");
  const [regLRN,     setRegLRN]     = useState("");
  const [regEmail,   setRegEmail]   = useState("");
  const [regPass,    setRegPass]    = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regAge,     setRegAge]     = useState("");
  const [regSex,     setRegSex]     = useState("");
  const [regGrade,   setRegGrade]   = useState("");
  const [regSection, setRegSection] = useState("");
  const [showRegPass, setShowRegPass] = useState(false);
  const passwordStrength = getPasswordStrength(regPass);

  // All required fields filled? Drives the "Create Account" button + hint below it.
  const isRegisterFormComplete =
    regName.trim() && regLRN.length === 12 && regEmail.trim() && regAge &&
    regSex && regGrade && regSection && regPass && regConfirm;

  // Admin-managed sections per grade (Grade & Sections page)
  const [gradeSectionsList, setGradeSectionsList] = useState([]);
  useEffect(() => {
    if (mode !== "register") return;
    getGradeSections().then(setGradeSectionsList).catch(() => setGradeSectionsList([]));
  }, [mode]);
  const sectionsForGrade = gradeSectionsList.filter((s) => s.grade === regGrade);

  const resetForm = () => {
    setEmail(""); setPassword(""); setError(""); setSuccess("");
    setRegName(""); setRegLRN(""); setRegEmail(""); setRegPass(""); setRegConfirm("");
    setRegAge(""); setRegSex(""); setRegGrade(""); setRegSection("");
  };

  const switchMode = (m) => { setMode(m); resetForm(); };

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");

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
    navigate(result.role === "admin" ? "/admindashboard" : "/studentdashboard");
  };

  // ── REGISTER ──────────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");

    if (!regName.trim() || !regLRN || !regEmail.trim() || !regPass || !regConfirm ||
        !regAge || !regSex || !regGrade || !regSection.trim()) {
      setError("Please fill in all required fields.");
      return;
    }
    if (regLRN.length !== 12) {
      setError("LRN must be exactly 12 digits.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (isNaN(regAge) || Number(regAge) < 10 || Number(regAge) > 25) {
      setError("Please enter a valid age (10–25).");
      return;
    }
    if (passwordStrength.score < 5) {
      setError("Please choose a strong password using all the requirements shown.");
      return;
    }
    if (regPass !== regConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const result = await signUpStudent({
      name:     regName.trim(),
      lrn:      regLRN,
      email:    regEmail.trim(),
      password: regPass,
      age:      Number(regAge),
      sex:      regSex,
      grade:    regGrade,
      section:  regSection.trim(),
    });
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setSuccess(
      result.needsConfirmation
        ? "Account created! Check your email to confirm it, then log in — an admin will need to approve your account before you can access it."
        : "Account created! An admin needs to confirm your account before you can log in."
    );
    setTimeout(() => switchMode("login"), 1800);
  };

  return (
    <div className="login-page">

      {/* ── LEFT PANEL ── */}
      <div
        className="login-left-panel"
        style={{
          backgroundImage:    `url(${cnhs})`,
          backgroundSize:     "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="left-content">
          <div className="logo-box">
            <img src={logo} alt="CNHS Logo" />
          </div>
          <h2>CASINGLOT NATIONAL HIGH SCHOOL</h2>
          <h3>Bullying Reporting &amp; Management System  </h3>
          <p className="tagline">A safer school starts with speaking up.</p>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="login-right-panel">
        <div className="login-card">

          {/* SIGN IN / SIGN UP TOGGLE */}
          <div className="role-toggle">
            <button
              type="button"
              className={`role-btn ${mode === "login" ? "active" : ""}`}
              onClick={() => switchMode("login")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`role-btn ${mode === "register" ? "active" : ""}`}
              onClick={() => switchMode("register")}
            >
              Sign Up
            </button>
          </div>

          {mode === "register" ? (
            <>
              <h2>Let's get you set up!</h2>
              <p className="login-sub">Just a few details to create your student account</p>

              <form onSubmit={handleRegister} noValidate>
                <div className="input-group">
                  <label className="input-label">Full Name *</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Juan Dela Cruz"
                    value={regName}
                    onChange={(e) => { setRegName(e.target.value); setError(""); }}
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">LRN (Learner Reference Number) *</label>
                  <input
                    className={`input ${error && regLRN.length !== 12 ? "input-error" : ""}`}
                    type="text"
                    inputMode="numeric"
                    placeholder="12-digit LRN"
                    maxLength={12}
                    value={regLRN}
                    onChange={(e) => {
                      setRegLRN(e.target.value.replace(/\D/g, "").slice(0, 12));
                      setError("");
                    }}
                  />
                  <p style={{ fontSize: 11, color: regLRN.length === 12 ? "#16a34a" : "#94a3b8", marginTop: 5, fontWeight: 600 }}>
                    {regLRN.length}/12 digits
                  </p>
                </div>

                <div className="input-group">
                  <label className="input-label">Email Address *</label>
                  <input
                    className={`input ${error && !regEmail ? "input-error" : ""}`}
                    type="email"
                    placeholder="your@email.com"
                    value={regEmail}
                    onChange={(e) => { setRegEmail(e.target.value); setError(""); }}
                  />
                </div>

                {/* Age + Gender — side by side */}
                <div className="input-row" style={{ display: "flex", gap: 12 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label className="input-label">Age *</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="e.g. 14"
                      min="10" max="25"
                      value={regAge}
                      onChange={(e) => { setRegAge(e.target.value); setError(""); }}
                    />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label className="input-label">Gender *</label>
                    <select
                      className="input"
                      value={regSex}
                      onChange={(e) => { setRegSex(e.target.value); setError(""); }}
                    >
                      <option value="">Select gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </div>
                </div>

                {/* Grade + Section — side by side */}
                <div className="input-row" style={{ display: "flex", gap: 12 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label className="input-label">Grade Level *</label>
                    <select
                      className={`input ${!regGrade ? "placeholder-select" : ""}`}
                      value={regGrade}
                      onChange={(e) => { setRegGrade(e.target.value); setRegSection(""); setError(""); }}
                    >
                      <option value="" disabled hidden>Select grade</option>
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label className="input-label">Section *</label>
                    <select
                      className={`input ${!regSection ? "placeholder-select" : ""}`}
                      value={regSection}
                      onChange={(e) => { setRegSection(e.target.value); setError(""); }}
                      disabled={!regGrade}
                    >
                      <option value="" disabled hidden>
                        {!regGrade
                          ? "Select grade first"
                          : sectionsForGrade.length === 0
                          ? "No sections available"
                          : "Select section"}
                      </option>
                      {sectionsForGrade.map((s) => (
                        <option key={s.id} value={s.section}>{s.section}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="input-group">
                  <label className="input-label">Password * (strong password required)</label>
                  <div className="input-wrap">
                    <input
                      className={`input ${error && regPass.length < 6 && regPass ? "input-error" : ""}`}
                      type={showRegPass ? "text" : "password"}
                      placeholder="Choose a strong password"
                      value={regPass}
                      onChange={(e) => { setRegPass(e.target.value); setError(""); }}
                    />
                    <button
                      type="button"
                      className="show-pass-btn"
                      onClick={() => setShowRegPass(!showRegPass)}
                      tabIndex={-1}
                    >
                      {showRegPass ? "Hide" : "Show"}
                    </button>
                  </div>
                  {regPass && (
                    <div className="password-strength" aria-live="polite">
                      <div className="password-strength-header">
                        <span>Password strength</span>
                        <strong style={{ color: passwordStrength.color }}>{passwordStrength.label}</strong>
                      </div>
                      <div className="password-strength-bars">
                        {[1, 2, 3, 4, 5].map((bar) => (
                          <span key={bar} style={{ backgroundColor: bar <= passwordStrength.score ? passwordStrength.color : "#e2e8f0" }} />
                        ))}
                      </div>
                      <ul className="password-requirements">
                        <li className={passwordStrength.checks[0] ? "met" : ""}>8 or more characters</li>
                        <li className={passwordStrength.checks[1] ? "met" : ""}>Lowercase letter</li>
                        <li className={passwordStrength.checks[2] ? "met" : ""}>Uppercase letter</li>
                        <li className={passwordStrength.checks[3] ? "met" : ""}>Number</li>
                        <li className={passwordStrength.checks[4] ? "met" : ""}>Special character</li>
                      </ul>
                    </div>
                  )}
                </div>

                <div className="input-group">
                  <label className="input-label">Confirm Password *</label>
                  <div className="input-wrap">
                    <input
                      className={`input ${error && regPass !== regConfirm && regConfirm ? "input-error" : ""}`}
                      type={showRegPass ? "text" : "password"}
                      placeholder="Re-enter your password"
                      value={regConfirm}
                      onChange={(e) => { setRegConfirm(e.target.value); setError(""); }}
                    />
                  </div>
                </div>

                {error && (
                  <div className="login-error">
                    <span>⚠</span> {error}
                  </div>
                )}
                {success && (
                  <div className="login-success">
                    <span>✓</span> {success}
                  </div>
                )}

                <button
                  className={`login-btn ${loading ? "loading" : ""}`}
                  type="submit"
                  disabled={loading || !isRegisterFormComplete}
                >
                  {loading ? "Creating account…" : "Create Account"}
                </button>
                {!isRegisterFormComplete && (
                  <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", marginTop: -6, marginBottom: 12, fontWeight: 600 }}>
                    Fill in all required fields (*) to continue
                  </p>
                )}
              </form>

              <button className="back-btn" type="button" onClick={() => navigate("/")}>
                ← Back to Home
              </button>
            </>
          ) : (
            <>
              <h2>Welcome back!</h2>
              <p className="login-sub">Sign in to continue — we're glad you're here</p>

              <p className="login-reassurance">🔒 Your privacy is always protected here</p>

              <form onSubmit={handleLogin} noValidate>
                <div className="input-group">
                  <label className="input-label">Email Address</label>
                  <input
                    className={`input ${error ? "input-error" : ""}`}
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    autoComplete="username"
                  />
                </div>

                <div className="input-group">
                  <label className="input-label">Password</label>
                  <div className="input-wrap">
                    <input
                      className={`input ${error ? "input-error" : ""}`}
                      type={showPass ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="show-pass-btn"
                      onClick={() => setShowPass(!showPass)}
                      tabIndex={-1}
                    >
                      {showPass ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="login-error">
                    <span>⚠</span> {error}
                  </div>
                )}
                {success && (
                  <div className="login-success">
                    <span>✓</span> {success}
                  </div>
                )}

                <button
                  className={`login-btn ${loading ? "loading" : ""}`}
                  type="submit"
                  disabled={loading}
                >
                  {loading ? "Signing in…" : "Login"}
                </button>
              </form>

              <button className="back-btn" type="button" onClick={() => navigate("/")}>
                ← Back to Home
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}