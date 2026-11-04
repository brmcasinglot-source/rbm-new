import { createClient } from "@supabase/supabase-js";
import {
  createHmac,
  randomInt,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_COOKIE = "cnhs_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

let database;
function getDatabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server database configuration is missing.");
  if (!database) {
    database = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return database;
}

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function getCookie(req, name) {
  const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

function signToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", getSessionSecret()).update(encoded).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  return payload.exp > Date.now() ? payload : null;
}

async function getSession(req, { optional = false } = {}) {
  const token = getCookie(req, SESSION_COOKIE);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    if (optional) return null;
    throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
  }

  const { data: account, error } = await getDatabase()
    .from("auth_credentials")
    .select("id, email, role, email_verified, session_version")
    .eq("id", payload.sub)
    .maybeSingle();
  if (error) throw error;
  if (
    !account ||
    !account.email_verified ||
    account.role !== payload.role ||
    account.session_version !== payload.ver
  ) {
    if (optional) return null;
    throw Object.assign(new Error("Your session has expired. Please sign in again."), { status: 401 });
  }
  return { id: account.id, email: account.email, role: account.role };
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function hashOtp(email, purpose, code) {
  return createHmac("sha256", getSessionSecret())
    .update(`${email}:${purpose}:${code}`)
    .digest("hex");
}

async function sendOtp(email, purpose, payload = null, req) {
  const brevoKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  if (!brevoKey || !senderEmail) {
    throw new Error("Brevo email configuration is missing.");
  }

  const db = getDatabase();
  const { error: expiredOtpError } = await db.from("auth_otps")
    .delete().lt("expires_at", new Date().toISOString());
  if (expiredOtpError) throw expiredOtpError;

  const forwardedIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();
  const ip = forwardedIp || req.socket?.remoteAddress || "unknown";
  const ipHash = createHmac("sha256", getSessionSecret()).update(ip).digest("hex");
  const { data: rateLimit, error: rateLimitError } = await db
    .from("auth_rate_limits")
    .select("window_started_at, request_count")
    .eq("ip_hash", ipHash)
    .maybeSingle();
  if (rateLimitError) throw rateLimitError;
  const withinWindow = rateLimit &&
    Date.now() - new Date(rateLimit.window_started_at).getTime() < 60 * 60_000;
  if (withinWindow && rateLimit.request_count >= 5) {
    throw Object.assign(new Error("Too many email-code requests. Please try again in an hour."), { status: 429 });
  }
  const { error: rateWriteError } = await db.from("auth_rate_limits").upsert({
    ip_hash: ipHash,
    window_started_at: withinWindow ? rateLimit.window_started_at : new Date().toISOString(),
    request_count: withinWindow ? rateLimit.request_count + 1 : 1,
  }, { onConflict: "ip_hash" });
  if (rateWriteError) throw rateWriteError;

  const { data: existing, error: existingError } = await db
    .from("auth_otps")
    .select("created_at")
    .eq("email", email)
    .eq("purpose", purpose)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && Date.now() - new Date(existing.created_at).getTime() < 60_000) {
    throw Object.assign(new Error("Please wait one minute before requesting another code."), { status: 429 });
  }

  const code = String(randomInt(100000, 1000000));
  const challenge = {
    email,
    purpose,
    code_hash: hashOtp(email, purpose, code),
    payload,
    attempts: 0,
    expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };
  const { error: saveError } = await db.from("auth_otps").upsert(challenge, { onConflict: "email,purpose" });
  if (saveError) throw saveError;

  const message = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || "CNHS Bullying Reporting System",
      email: senderEmail,
    },
    to: [{ email }],
    subject: purpose === "signup" ? "Verify your CNHS account" : "Reset your CNHS password",
    textContent: `Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
    htmlContent: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.</p>`,
  };
  let response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    const { error: cleanupError } = await db.from("auth_otps").delete()
      .eq("email", email).eq("purpose", purpose).eq("code_hash", challenge.code_hash);
    if (cleanupError) throw cleanupError;
    throw new Error(`Brevo email request failed: ${error.message}`, { cause: error });
  }
  if (!response.ok) {
    const responseText = await response.text();
    const { error: cleanupError } = await db.from("auth_otps").delete()
      .eq("email", email).eq("purpose", purpose).eq("code_hash", challenge.code_hash);
    if (cleanupError) throw cleanupError;
    throw new Error(`Brevo could not send the verification email (${response.status}): ${responseText.slice(0, 300)}`);
  }
}

async function getExistingAccount(email) {
  const db = getDatabase();
  const { data: credential, error } = await db
    .from("auth_credentials")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  if (credential) return credential;

  const { data: student, error: studentError } = await db
    .from("students")
    .select("id, email, name")
    .ilike("email", email)
    .maybeSingle();
  if (studentError) throw studentError;
  if (student) return { id: student.id, email: student.email, role: "student", legacy: true, profile: student };

  const { data: admin, error: adminError } = await db
    .from("admins")
    .select("id, email, name")
    .ilike("email", email)
    .maybeSingle();
  if (adminError) throw adminError;
  return admin ? { id: admin.id, email: admin.email, role: "admin", legacy: true, profile: admin } : null;
}

async function createSession(res, account) {
  let profile;
  if (account.role === "admin") {
    const { data, error } = await getDatabase().from("admins").select("*").eq("id", account.id).single();
    if (error) throw error;
    profile = data;
  } else {
    const { data, error } = await getDatabase().from("students").select("*").eq("id", account.id).single();
    if (error) throw error;
    profile = data;
  }
  const token = signToken({
    sub: account.id,
    role: account.role,
    ver: account.session_version || 0,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  });
  setSessionCookie(res, token);
  return { success: true, role: account.role, profile };
}

async function verifyOtp(email, purpose, code) {
  const db = getDatabase();
  const { data: challenge, error } = await db
    .from("auth_otps")
    .select("*")
    .eq("email", email)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) throw error;
  if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error("This code is invalid or expired. Request a new code."), { status: 400 });
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    throw Object.assign(new Error("Too many incorrect attempts. Request a new code."), { status: 429 });
  }
  const provided = hashOtp(email, purpose, String(code || ""));
  const expected = Buffer.from(challenge.code_hash, "hex");
  const actual = Buffer.from(provided, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const { error: attemptError } = await db
      .from("auth_otps")
      .update({ attempts: challenge.attempts + 1 })
      .eq("email", email)
      .eq("purpose", purpose);
    if (attemptError) throw attemptError;
    throw Object.assign(new Error("The verification code is incorrect."), { status: 400 });
  }
  return challenge;
}

function requireRole(session, role) {
  if (!session) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
  if (session.role !== role) throw Object.assign(new Error("You are not authorized to perform this action."), { status: 403 });
}

async function handleAuth(action, body, req, res) {
  const db = getDatabase();
  const email = String(body.email || "").trim().toLowerCase();

  if (action === "signup") {
    const { name, password, lrn, age, sex, grade, section } = body;
    const strongPassword = typeof password === "string" && password.length >= 8 &&
      /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) &&
      /[^A-Za-z0-9]/.test(password);
    if (!name?.trim() || name.trim().length > 120 || !/^\d{12}$/.test(String(lrn || "")) ||
        !email || email.length > 254 || !strongPassword || Number(age) < 10 || Number(age) > 25 ||
        !["Male", "Female"].includes(sex) ||
        !["Grade 7", "Grade 8", "Grade 9", "Grade 10"].includes(grade) || !section?.trim()) {
      throw Object.assign(new Error("Please provide valid registration details and a strong password."), { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("Please enter a valid email address."), { status: 400 });
    }
    const existing = await getExistingAccount(email);
    if (existing) throw Object.assign(new Error("This email is already registered. Please sign in instead."), { status: 409 });
    const { data: lrnRows, error: lrnError } = await db.from("students").select("id").eq("lrn", lrn).limit(1);
    if (lrnError) throw lrnError;
    if (lrnRows.length) throw Object.assign(new Error("This LRN is already registered to another account."), { status: 409 });
    const { data: pendingSignups, error: pendingError } = await db.from("auth_otps")
      .select("payload").eq("purpose", "signup").gt("expires_at", new Date().toISOString());
    if (pendingError) throw pendingError;
    if (pendingSignups.some((signup) => signup.payload?.lrn === String(lrn))) {
      throw Object.assign(new Error("This LRN is already registered to another account."), { status: 409 });
    }

    const payload = {
      id: randomUUID(),
      name: name.trim(),
      email,
      lrn: String(lrn),
      age: Number(age),
      sex,
      grade,
      section: section.trim(),
      password_hash: await hashPassword(password),
    };
    await sendOtp(email, "signup", payload, req);
    return { success: true, needsConfirmation: true };
  }

  if (action === "verify-signup") {
    const challenge = await verifyOtp(email, "signup", body.code);
    const registration = challenge.payload;
    if (!registration?.id || registration.email !== email) {
      throw new Error("The pending registration is invalid. Please register again.");
    }
    const { data: existingCredential, error: existingCredentialError } = await db.from("auth_credentials")
      .select("id").eq("id", registration.id).maybeSingle();
    if (existingCredentialError) throw existingCredentialError;
    if (existingCredential) {
      const { error: removeError } = await db.from("auth_otps").delete().eq("email", email).eq("purpose", "signup");
      if (removeError) throw removeError;
      return { success: true };
    }
    const { error: credentialError } = await db.from("auth_credentials").insert({
      id: registration.id,
      email,
      password_hash: registration.password_hash,
      role: "student",
      email_verified: true,
    });
    if (credentialError) throw credentialError;
    const { error: profileError } = await db.from("students").insert({
      id: registration.id,
      name: registration.name,
      email,
      lrn: registration.lrn,
      age: registration.age,
      sex: registration.sex,
      grade: registration.grade,
      section: registration.section,
    });
    if (profileError) {
      const { error: cleanupError } = await db.from("auth_credentials").delete().eq("id", registration.id);
      if (cleanupError) throw cleanupError;
      throw profileError;
    }
    const { error: removeError } = await db.from("auth_otps").delete().eq("email", email).eq("purpose", "signup");
    if (removeError) throw removeError;
    return { success: true };
  }

  if (action === "signin") {
    const credential = await getExistingAccount(email);
    if (!credential?.password_hash) {
      throw Object.assign(new Error("Invalid email or password. If this is an existing account, use Forgot Password to set a new password."), { status: 401 });
    }
    if (!await verifyPassword(String(body.password || ""), credential.password_hash)) {
      throw Object.assign(new Error("Invalid email or password."), { status: 401 });
    }
    if (!credential.email_verified) {
      throw Object.assign(new Error("Please verify your email before signing in."), { status: 403 });
    }
    if (credential.role === "student") {
      const { data: student, error } = await db.from("students").select("*").eq("id", credential.id).single();
      if (error) throw error;
      if (!student.approved) {
        throw Object.assign(new Error("Your account is waiting for admin confirmation. You'll be able to log in once an administrator approves your registration."), { status: 403 });
      }
    }
    return createSession(res, credential);
  }

  if (action === "request-password-reset") {
    if (email) {
      const account = await getExistingAccount(email);
      if (account) {
        const payload = { id: account.id, role: account.role };
        try {
          await sendOtp(email, "reset", payload, req);
        } catch (error) {
          if (error.status !== 429) throw error;
        }
      }
    }
    return { success: true };
  }

  if (action === "update-password") {
    const password = body.password;
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      throw Object.assign(new Error("Choose a strong password that meets all the requirements."), { status: 400 });
    }
    const challenge = await verifyOtp(email, "reset", body.code);
    const resetData = challenge.payload;
    if (!resetData?.id || !["student", "admin"].includes(resetData.role)) {
      throw new Error("The password reset request is invalid. Request a new code.");
    }
    const profileTable = resetData.role === "admin" ? "admins" : "students";
    const { data: profile, error: profileError } = await db.from(profileTable)
      .select("id").eq("id", resetData.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      throw Object.assign(new Error("This account is no longer available. Contact an administrator."), { status: 404 });
    }
    const passwordHash = await hashPassword(password);
    const existing = await getExistingAccount(email);
    const credential = {
      id: resetData.id,
      email,
      role: resetData.role,
      password_hash: passwordHash,
      email_verified: true,
      session_version: (existing?.session_version || 0) + 1,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("auth_credentials").upsert(credential, { onConflict: "id" });
    if (error) throw error;
    const { error: removeError } = await db.from("auth_otps").delete().eq("email", email).eq("purpose", "reset");
    if (removeError) throw removeError;
    return { success: true };
  }

  if (action === "signout") {
    clearSessionCookie(res);
    return { success: true };
  }

  if (action === "session") {
    const session = await getSession(req, { optional: true });
    if (!session) return { success: true, user: null };
    const table = session.role === "admin" ? "admins" : "students";
    const { data: profile, error } = await db.from(table).select("*").eq("id", session.id).maybeSingle();
    if (error) throw error;
    if (!profile || (session.role === "student" && !profile.approved)) {
      clearSessionCookie(res);
      return { success: true, user: null };
    }
    return { success: true, role: session.role, profile };
  }

  if (action === "resend-signup") {
    if (email) {
      const { data: challenge, error } = await db.from("auth_otps")
        .select("payload").eq("email", email).eq("purpose", "signup").maybeSingle();
      if (error) throw error;
      if (challenge) await sendOtp(email, "signup", challenge.payload, req);
    }
    return { success: true };
  }

  if (action === "query") return runQuery(body, req);
  throw Object.assign(new Error("Unknown API action."), { status: 404 });
}

const TABLES = new Set([
  "reports",
  "awareness_content",
  "notifications",
  "custom_locations",
  "grade_sections",
  "students",
  "admins",
]);

function applyFilters(query, filters = []) {
  for (const filter of filters) {
    if (!["eq", "neq", "ilike", "is"].includes(filter.operator)) {
      throw Object.assign(new Error("Unsupported query filter."), { status: 400 });
    }
    query = query[filter.operator](filter.column, filter.value);
  }
  return query;
}

async function runQuery(body, req) {
  const { table, operation, columns, filters, orders, values: requestValues, returning, single, limit } = body.query || {};
  let values = requestValues;
  if (!TABLES.has(table)) throw Object.assign(new Error("Unsupported database table."), { status: 400 });

  const publicGradeSections = table === "grade_sections" && operation === "select";
  const session = await getSession(req, { optional: publicGradeSections });
  if (!session && !publicGradeSections) {
    throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
  }
  const role = session?.role || "anonymous";
  const adminOnly = ["students", "admins"].includes(table);

  if (
    adminOnly &&
    !publicGradeSections &&
    !(table === "students" && role === "student" && operation === "select")
  ) requireRole(session, "admin");
  if (table === "admins" && role !== "admin") requireRole(session, "admin");
  if (table === "admins" && operation !== "select") {
    throw Object.assign(new Error("Admin accounts must be provisioned through the admin setup command."), { status: 403 });
  }
  if (table === "students" && !["select", "update", "delete"].includes(operation)) {
    throw Object.assign(new Error("Student accounts must be created through email verification."), { status: 403 });
  }
  if (table === "reports" && operation !== "select" && role !== "admin") {
    if (operation !== "insert") requireRole(session, "admin");
  }
  if (table === "awareness_content" && operation !== "select") requireRole(session, "admin");
  if (["custom_locations", "grade_sections"].includes(table) && operation !== "select") requireRole(session, "admin");
  if (table === "students" && role !== "admin" &&
      !(role === "student" && operation === "select")) requireRole(session, "admin");
  if (table === "notifications" && !["select", "insert", "update"].includes(operation)) {
    requireRole(session, "admin");
  }

  let query = getDatabase().from(table);
  if (operation === "select") query = query.select(columns || "*");
  else if (operation === "insert") {
    if (table === "reports" && role === "student") {
      const allowedFields = new Set([
        "type", "date", "time", "location", "description", "description_lead_up",
        "description_impact", "description_actions", "reporter_type", "victims",
        "offenders", "witnesses", "priority", "is_anonymous", "evidence",
      ]);
      values = Object.fromEntries(Object.entries(values || {}).filter(([key]) => allowedFields.has(key)));
      values.submitted_id = session.id;
      const { data: profile, error } = await getDatabase().from("students")
        .select("name, age, sex, grade, section").eq("id", session.id).single();
      if (error) throw error;
      values.submitted_by = profile.name;
      values.reporter_age = profile.age;
      values.reporter_sex = profile.sex;
      values.reporter_grade = profile.grade;
      values.reporter_section = profile.section;
      values.status = "Pending";
      values.admin_notes = "";
    }
    if (table === "notifications" && role === "student") {
      throw Object.assign(new Error("Student notifications are generated by the server."), { status: 403 });
    }
    query = query.insert(values);
    if (returning || (table === "reports" && role === "student")) query = query.select(columns || "*");
  } else if (operation === "update") {
    if (table === "students" && Object.keys(values || {}).some((key) => key !== "approved")) {
      throw Object.assign(new Error("Student profile fields cannot be changed here."), { status: 403 });
    }
    if (table === "notifications" && Object.keys(values || {}).some((key) => key !== "read")) {
      throw Object.assign(new Error("Only notification read status can be changed."), { status: 403 });
    }
    query = query.update(values);
    if (returning) query = query.select(columns || "*");
  } else if (operation === "delete") {
    query = query.delete();
  } else {
    throw Object.assign(new Error("Unsupported database operation."), { status: 400 });
  }

  let enforcedFilters = [...(filters || [])];
  if (table === "reports" && role === "student") {
    if (operation !== "select" && operation !== "insert") requireRole(session, "admin");
    if (operation === "select") enforcedFilters.push({ column: "submitted_id", operator: "eq", value: session.id });
  }
  if (table === "students" && role === "student") {
    enforcedFilters.push({ column: "id", operator: "eq", value: session.id });
  }
  if (table === "notifications") {
    if (role === "student") {
      if (operation === "select") {
        enforcedFilters.push({ column: "audience", operator: "eq", value: "student" });
        query = applyFilters(query, enforcedFilters);
        query = query.or(`student_id.eq.${session.id},student_id.is.null`);
      } else {
        enforcedFilters.push({ column: "audience", operator: "eq", value: "student" });
        query = applyFilters(query, enforcedFilters);
        query = query.or(`student_id.eq.${session.id},student_id.is.null`);
        enforcedFilters = [];
      }
    } else {
      enforcedFilters.push({ column: "audience", operator: "eq", value: "admin" });
    }
  }
  if (table === "admins" && role === "admin") {
    enforcedFilters.push({ column: "id", operator: "eq", value: session.id });
  }
  if (enforcedFilters.length) query = applyFilters(query, enforcedFilters);
  for (const order of orders || []) query = query.order(order.column, { ascending: order.ascending !== false });
  if (Number.isInteger(limit) && limit >= 0) query = query.limit(limit);

  let result = await query;
  if (result.error) throw result.error;
  if (table === "reports" && operation === "insert" && role === "student") {
    const report = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!report) throw new Error("Report was saved but its notification could not be generated.");
    const { error: notificationError } = await getDatabase().from("notifications").insert({
      audience: "admin",
      student_id: null,
      title: `New report #${report.id} submitted — ${report.type} by ${report.is_anonymous ? "Anonymous" : report.submitted_by}`,
      type: "report",
      read: false,
    });
    if (notificationError) throw notificationError;
  }
  if (single) {
    const list = Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data];
    if (single === "maybe" && list.length === 0) result.data = null;
    else if (list.length !== 1) throw Object.assign(new Error("Expected one matching database row."), { status: 404 });
    else result.data = list[0];
  }
  return result.data;
}

async function runRpc(functionName, args, req) {
    const db = getDatabase();
    if (functionName === "is_lrn_taken") {
      const lrn = String(args.check_lrn || "");
      const { data: students, error } = await db.from("students").select("id").eq("lrn", lrn).limit(1);
      if (error) throw error;
      if (students.length) return true;
      const { data: signups, error: signupError } = await db.from("auth_otps").select("payload")
        .eq("purpose", "signup").gt("expires_at", new Date().toISOString());
      if (signupError) throw signupError;
      return signups.some((signup) => signup.payload?.lrn === lrn);
    }
    if (functionName === "get_unconfirmed_signups") {
      const session = await getSession(req);
      requireRole(session, "admin");
      const { data, error } = await db.from("auth_otps").select("email, payload, created_at")
        .eq("purpose", "signup").gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map(({ email, payload, created_at }) => ({
        id: payload?.id,
        email,
        name: payload?.name,
        lrn: payload?.lrn,
        grade: payload?.grade,
        section: payload?.section,
        created_at,
      }));
    }
    if (functionName === "decline_student_signup") {
      const session = await getSession(req);
      requireRole(session, "admin");
      const id = args.target_id;
      const { data: student, error: fetchError } = await db.from("students")
        .select("email").eq("id", id).maybeSingle();
      if (fetchError) throw fetchError;
      if (!student) throw Object.assign(new Error("Student account not found."), { status: 404 });
      const { error: deleteStudentError } = await db.from("students").delete().eq("id", id);
      if (deleteStudentError) throw deleteStudentError;
      const { error: deleteCredentialError } = await db.from("auth_credentials").delete().eq("id", id);
      if (deleteCredentialError) throw deleteCredentialError;
      const { error: deleteOtpError } = await db.from("auth_otps").delete().eq("email", student.email);
      if (deleteOtpError) throw deleteOtpError;
      return null;
    }
    if (functionName === "request_conference_change") {
      const session = await getSession(req);
      if (session.role !== "student") requireRole(session, "student");
      const { target_report_id: reportId, request_type: type, request_reason: reason = "" } = args;
      if (!["reschedule", "cancellation"].includes(type)) {
        throw Object.assign(new Error("Invalid conference request."), { status: 400 });
      }
      const { data: report, error: fetchError } = await db.from("reports").select("*").eq("id", reportId).single();
      if (fetchError) throw fetchError;
      if (report.submitted_id !== session.id) {
        throw Object.assign(new Error("Conference not found."), { status: 404 });
      }
      const conference = report.scheduled_conference || {};
      if (!conference.date && !conference.time && !conference.location) {
        throw Object.assign(new Error("No scheduled conference exists for this report."), { status: 400 });
      }
      const status = conference.status || (conference.completed ? "Completed" : "Scheduled");
      if (!["Scheduled", "Rescheduled"].includes(status)) {
        throw Object.assign(new Error("This conference cannot accept a new request in its current status."), { status: 400 });
      }
      const updatedConference = {
        ...conference,
        status: type === "reschedule" ? "Reschedule Requested" : "Cancellation Requested",
        completed: false,
        request: {
          type,
          reason: String(reason).trim(),
          requestedAt: new Date().toISOString(),
          previousStatus: status,
          state: "Pending",
        },
      };
      const { error: updateError } = await db.from("reports").update({
        scheduled_conference: updatedConference,
        updated_at: new Date().toISOString(),
      }).eq("id", reportId);
      if (updateError) throw updateError;
      const { error: notificationError } = await db.from("notifications").insert({
        audience: "admin",
        title: `Case #${reportId} conference ${type} requested by ${report.is_anonymous ? "a student" : report.submitted_by}.`,
        type: "status",
        read: false,
      });
      if (notificationError) throw notificationError;
      return updatedConference;
    }
    throw Object.assign(new Error("Unknown database function."), { status: 404 });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, 405, { error: "Method not allowed." });
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && new URL(origin).host !== host) {
      return send(res, 403, { error: "Cross-origin requests are not allowed." });
    }
    const body = await readJson(req);
    const result = body.action === "rpc"
      ? await runRpc(body.functionName, body.args || {}, req)
      : await handleAuth(body.action, body, req, res);
    return send(res, 200, result);
  } catch (error) {
    const status = Number(error.status) || (error.code === "23505" ? 409 : 500);
    if (status >= 500) console.error("API request failed:", error.message);
    return send(res, status, { error: status === 500 ? "The request could not be completed. Please try again later." : error.message });
  }
}
