import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import cnhs from "../assets/cnhs.jpg";
import "../styles/Login.css";
import {
  signIn,
  signUpStudent,
  verifyStudentEmail,
  resendConfirmationEmail,
  sendPasswordResetEmail,
  updatePassword,
  signOut as signOutUser,
} from "../lib/auth.js";
import { getGradeSections, GRADE_OPTIONS } from "../data/store.js";
import { optimizeImageFile } from "../lib/imageOptimization.js";

const MAX_STUDENT_ID_IMAGE_SIZE = 350_000;

async function prepareStudentIdImage(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }

  const optimizedFile = await optimizeImageFile(file, {
    maxDimension: 1200,
    maxSizeBytes: MAX_STUDENT_ID_IMAGE_SIZE,
    forceWebp: true,
    backgroundColor: "#ffffff",
    qualitySteps: [0.68, 0.56, 0.46, 0.36],
  });
  if (optimizedFile.size > MAX_STUDENT_ID_IMAGE_SIZE) {
    throw new Error("Each ID photo must be under 350 KB after compression. Please take a closer, clearer photo with less background.");
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image. Please try again."));
    reader.readAsDataURL(optimizedFile);
  });
  return { dataUrl, name: optimizedFile.name };
}

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

  const [mode,     setMode]     = useState(() => {
    const requestedMode = new URLSearchParams(window.location.search).get("mode");
    return ["reset", "verify"].includes(requestedMode) ? requestedMode : "login";
  });
  const [email,    setEmail]    = useState(() => new URLSearchParams(window.location.search).get("email") || "");
  const [verifyCode, setVerifyCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmNewPass, setShowConfirmNewPass] = useState(false);

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
  const [regStudentIdImages, setRegStudentIdImages] = useState({ front: null, back: null });
  const [processingIdImage, setProcessingIdImage] = useState(false);
  const [showRegPass, setShowRegPass] = useState(false);
  const passwordStrength = getPasswordStrength(regPass);
  const resetPasswordStrength = getPasswordStrength(newPassword);

  // Used for the registration guidance below the submit button.
  const isRegisterFormComplete =
    regName.trim() && regLRN.length === 12 && regEmail.trim() && regAge &&
    regSex && regGrade && regSection && regPass && regConfirm &&
    regStudentIdImages.front && regStudentIdImages.back;

  // Admin-managed sections per grade (Grade & Sections page)
  const [gradeSectionsList, setGradeSectionsList] = useState([]);
  useEffect(() => {
    if (mode !== "register") return;
    getGradeSections().then(setGradeSectionsList).catch(() => setGradeSectionsList([]));
  }, [mode]);
  const sectionsForGrade = gradeSectionsList.filter((s) => s.grade === regGrade);

  const resetForm = () => {
    setEmail(""); setPassword(""); setError(""); setSuccess("");
    setVerifyCode(""); setResetCode("");
    setNewPassword(""); setConfirmNewPassword("");
    setRegName(""); setRegLRN(""); setRegEmail(""); setRegPass(""); setRegConfirm("");
    setRegAge(""); setRegSex(""); setRegGrade(""); setRegSection("");
    setRegStudentIdImages({ front: null, back: null });
    setProcessingIdImage(false);
  };

  const switchMode = (m) => {
    setMode(m);
    resetForm();
    window.history.replaceState({}, document.title, window.location.pathname);
  };

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

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter the email address you used to register.");
      return;
    }

    setLoading(true);
    try {
      const result = await sendPasswordResetEmail(email.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMode("reset");
      setSuccess("If an account exists for this email, a 6-digit password reset code has been sent. Check your inbox and spam folder.");
      window.history.replaceState({}, document.title, `${window.location.pathname}?mode=reset&email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError(`Could not send the reset email: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (resetPasswordStrength.score < 5) {
      setError("Choose a strong password that meets all the requirements.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const result = await updatePassword(email.trim(), resetCode.trim(), newPassword);
      if (!result.success) {
        setError(result.error);
        return;
      }
      await signOutUser();
      setNewPassword("");
      setConfirmNewPassword("");
      setPassword("");
      setResetCode("");
      setSuccess("Your password has been reset. You can now sign in with your new password.");
      setMode("login");
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (err) {
      setError(`Could not update your password: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailVerification = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!/^\d{6}$/.test(verifyCode.trim())) {
      setError("Enter the 6-digit code sent to your email.");
      return;
    }

    setLoading(true);
    const result = await verifyStudentEmail(email.trim(), verifyCode.trim());
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setMode("login");
    setPassword("");
    setVerifyCode("");
    setSuccess("Email verified. An admin still needs to approve your account before you can sign in.");
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  const handleResendSignupCode = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    const result = await resendConfirmationEmail(email.trim());
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSuccess("A new verification code has been sent to your email.");
  };

  const handleStudentIdImage = async (side, file) => {
    if (!file) return;
    setError("");
    setProcessingIdImage(true);
    try {
      const image = await prepareStudentIdImage(file);
      setRegStudentIdImages((current) => ({ ...current, [side]: image }));
    } catch (imageError) {
      setError(imageError.message);
    } finally {
      setProcessingIdImage(false);
    }
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
    if (!regStudentIdImages.front || !regStudentIdImages.back) {
      setError("Upload both the front and back photos of your student ID.");
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
      studentIdFront: regStudentIdImages.front.dataUrl,
      studentIdBack: regStudentIdImages.back.dataUrl,
    });
    setLoading(false);

    if (!result.success) {
      setError(result.error)
      return;
    }

    setEmail(regEmail.trim());
    setVerifyCode("");
    setMode("verify");
    setSuccess("A 6-digit verification code was sent to your email. Enter it below to finish creating your account.");
    window.history.replaceState({}, document.title, `${window.location.pathname}?mode=verify&email=${encodeURIComponent(regEmail.trim())}`);
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
          {["login", "register"].includes(mode) && (
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
          )}

          {mode === "verify" ? (
            <>
              <h2>Verify your email</h2>
              <p className="login-sub">Enter the 6-digit code sent to {email}. You can request another code after 10 minutes.</p>
              <form onSubmit={handleEmailVerification} noValidate>
                <div className="input-group">
                  <label className="input-label">Verification Code</label>
                  <input
                    className={`input ${error ? "input-error" : ""}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={verifyCode}
                    onChange={(event) => { setVerifyCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                  />
                </div>
                {error && <div className="login-error"><span>⚠</span> {error}</div>}
                {success && <div className="login-success"><span>✓</span> {success}</div>}
                <button className={`login-btn ${loading ? "loading" : ""}`} type="submit" disabled={loading}>
                  {loading ? "Verifying…" : "Verify Email"}
                </button>
              </form>
              <button className="back-btn" type="button" onClick={handleResendSignupCode} disabled={loading}>
                {loading ? "Sending…" : "Resend code"}
              </button>
              <button className="back-btn" type="button" onClick={() => switchMode("login")}>← Back to Sign In</button>
            </>
          ) : mode === "reset" ? (
            <>
              <h2>Set a new password</h2>
              <p className="login-sub">Enter the code sent to {email} and choose a new password. You have 2 attempts to enter the code.</p>
              <form onSubmit={handlePasswordUpdate} noValidate>
                <div className="input-group">
                  <label className="input-label">6-digit Reset Code</label>
                  <input
                    className={`input ${error ? "input-error" : ""}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={resetCode}
                    onChange={(event) => { setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">New Password</label>
                  <div className="input-wrap">
                    <input
                      className={`input ${error ? "input-error" : ""}`}
                      type={showNewPass ? "text" : "password"}
                      placeholder="Choose a strong password"
                      value={newPassword}
                      onChange={(event) => { setNewPassword(event.target.value); setError(""); }}
                      autoComplete="new-password"
                    />
                    <button type="button" className="show-pass-btn" onClick={() => setShowNewPass((show) => !show)}>
                      {showNewPass ? "Hide" : "Show"}
                    </button>
                  </div>
                  {newPassword && (
                    <div className="password-strength" aria-live="polite">
                      <div className="password-strength-header">
                        <span>Password strength</span>
                        <strong style={{ color: resetPasswordStrength.color }}>{resetPasswordStrength.label}</strong>
                      </div>
                      <div className="password-strength-bars">
                        {[1, 2, 3, 4, 5].map((bar) => (
                          <span key={bar} style={{ backgroundColor: bar <= resetPasswordStrength.score ? resetPasswordStrength.color : "#e2e8f0" }} />
                        ))}
                      </div>
                      <ul className="password-requirements">
                        <li className={resetPasswordStrength.checks[0] ? "met" : ""}>8 or more characters</li>
                        <li className={resetPasswordStrength.checks[1] ? "met" : ""}>Lowercase letter</li>
                        <li className={resetPasswordStrength.checks[2] ? "met" : ""}>Uppercase letter</li>
                        <li className={resetPasswordStrength.checks[3] ? "met" : ""}>Number</li>
                        <li className={resetPasswordStrength.checks[4] ? "met" : ""}>Special character</li>
                      </ul>
                    </div>
                  )}
                </div>
                <div className="input-group">
                  <label className="input-label">Confirm New Password</label>
                  <div className="input-wrap">
                    <input
                      className={`input ${error && confirmNewPassword ? "input-error" : ""}`}
                      type={showConfirmNewPass ? "text" : "password"}
                      placeholder="Re-enter your new password"
                      value={confirmNewPassword}
                      onChange={(event) => { setConfirmNewPassword(event.target.value); setError(""); }}
                      autoComplete="new-password"
                    />
                    <button type="button" className="show-pass-btn" onClick={() => setShowConfirmNewPass((show) => !show)}>
                      {showConfirmNewPass ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                {error && <div className="login-error"><span>⚠</span> {error}</div>}
                {success && <div className="login-success"><span>✓</span> {success}</div>}
                <button className={`login-btn ${loading ? "loading" : ""}`} type="submit" disabled={loading}>
                  {loading ? "Updating password…" : "Reset Password"}
                </button>
              </form>
              <button className="back-btn" type="button" onClick={() => switchMode("login")}>← Back to Sign In</button>
            </>
          ) : mode === "forgot" ? (
            <>
              <h2>Forgot your password?</h2>
              <p className="login-sub">Enter the email address linked to your account. We’ll send you a 6-digit password reset code.</p>
              <form onSubmit={handlePasswordResetRequest} noValidate>
                <div className="input-group">
                  <label className="input-label">Email Address</label>
                  <input
                    className={`input ${error ? "input-error" : ""}`}
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setError(""); setSuccess(""); }}
                    autoComplete="email"
                    required
                  />
                </div>
                {error && <div className="login-error"><span>⚠</span> {error}</div>}
                {success && <div className="login-success"><span>✓</span> {success}</div>}
                <button className={`login-btn ${loading ? "loading" : ""}`} type="submit" disabled={loading}>
                  {loading ? "Sending code…" : "Send Reset Code"}
                </button>
              </form>
              <button className="back-btn" type="button" onClick={() => setMode("login")}>← Back to Sign In</button>
            </>
          ) : mode === "register" ? (
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
                  <label className="input-label">Student ID Photos * (front and back required)</label>
                  <p className="student-id-upload-help">
                    Take a clear photo of both sides. Photos are kept private and shown only to an administrator for account validation.
                  </p>
                  <div className="student-id-upload-grid">
                    {[
                      { side: "front", label: "Front of Student ID" },
                      { side: "back", label: "Back of Student ID" },
                    ].map(({ side, label }) => {
                      const image = regStudentIdImages[side];
                      return (
                        <label className={`student-id-upload ${image ? "has-image" : ""}`} key={side}>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            disabled={processingIdImage || loading}
                            onChange={(event) => {
                              handleStudentIdImage(side, event.target.files?.[0]);
                              event.target.value = "";
                            }}
                          />
                          {image ? (
                            <>
                              <img src={image.dataUrl} alt={`${label} preview`} />
                              <span>{label} — ready</span>
                              <small>Tap to retake or choose another photo</small>
                            </>
                          ) : (
                            <>
                              <span className="student-id-upload-icon">+</span>
                              <span>{label}</span>
                              <small>Take a photo or choose an image</small>
                            </>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  {processingIdImage && <p className="student-id-upload-help">Preparing photo…</p>}
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
                  disabled={loading || processingIdImage || !regStudentIdImages.front || !regStudentIdImages.back}
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

                <div className="login-forgot-row">
                  <button type="button" onClick={() => { setError(""); setSuccess(""); setMode("forgot"); }}>
                    Forgot password?
                  </button>
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