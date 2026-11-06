import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import process from "node:process";
import {
  createHmac,
  randomInt,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESET_OTP_MAX_ATTEMPTS = 2;
const SIGNUP_OTP_RESEND_COOLDOWN_MINUTES = 10;
const STUDENT_ID_BUCKET = "student-ids";
const REPORT_EVIDENCE_BUCKET = "report-evidence";
const AWARENESS_MEDIA_BUCKET = "awareness-media";
const MAX_REPORT_EVIDENCE_BYTES = 2_000_000;
const MAX_STUDENT_ID_IMAGE_BYTES = 350_000;

let database;
function getEnvironmentVariable(name) {
  return globalThis.Deno?.env.get(name) ?? process.env[name];
}

function getDatabase() {
  const url = getEnvironmentVariable("SUPABASE_URL") || getEnvironmentVariable("VITE_SUPABASE_URL");
  const key = getEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) {
    throw Object.assign(new Error("Set SUPABASE_URL in the server environment."), { status: 503 });
  }
  if (!key) {
    throw Object.assign(new Error("Set SUPABASE_SERVICE_ROLE_KEY in the server environment. Keep it private; do not use a VITE_ variable."), { status: 503 });
  }
  if (!database) {
    database = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return database;
}

function getSessionSecret() {
  const secret = getEnvironmentVariable("AUTH_SESSION_SECRET");
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error("Set AUTH_SESSION_SECRET to a random value of at least 32 characters in the server environment."), { status: 503 });
  }
  return secret;
}

function getEmailLogoUrl(origin = "") {
  const allowedOrigins = (getEnvironmentVariable("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = [origin, ...allowedOrigins].filter(Boolean);
  const publicOrigin = candidates.find((candidate) => {
    try {
      const url = new URL(candidate);
      return ["http:", "https:"].includes(url.protocol) &&
        !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  });
  const fallbackOrigin = publicOrigin || candidates.find((candidate) => {
    try {
      return ["http:", "https:"].includes(new URL(candidate).protocol);
    } catch {
      return false;
    }
  });
  return fallbackOrigin ? new URL("/logo.png", fallbackOrigin).href : "";
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
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
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
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
    if (raw.length > 3_000_000) throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function decodeStudentIdImage(dataUrl, label) {
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || "");
  if (!match) {
    throw Object.assign(new Error(`Upload a valid WebP image for the ${label} of the student ID.`), { status: 400 });
  }
  const bytes = Buffer.from(match[1], "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_STUDENT_ID_IMAGE_BYTES ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw Object.assign(new Error(`The ${label} photo is invalid or exceeds the 350 KB limit. Please take another photo.`), { status: 400 });
  }
  return bytes;
}

async function removeStudentIdImages(paths) {
  const existingPaths = paths.filter(Boolean);
  if (!existingPaths.length) return;
  const { error } = await getDatabase().storage.from(STUDENT_ID_BUCKET).remove(existingPaths);
  if (error) throw error;
}

function decodeMediaDataUrl(dataUrl) {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl || "");
  if (!match) throw Object.assign(new Error("The uploaded file is invalid."), { status: 400 });
  return { contentType: match[1].toLowerCase(), bytes: Buffer.from(match[2], "base64") };
}

async function uploadMedia(bucket, path, dataUrl) {
  const { contentType, bytes } = decodeMediaDataUrl(dataUrl);
  const { error } = await getDatabase().storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
}

async function removeMedia(bucket, paths) {
  const objects = paths.filter((path) =>
    typeof path === "string" && path && !path.startsWith("data:") && !/^https?:\/\//i.test(path)
  );
  if (!objects.length) return;
  const { error } = await getDatabase().storage.from(bucket).remove(objects);
  if (error) throw error;
}

async function uploadReportEvidence(userId, evidence) {
  if (!Array.isArray(evidence)) {
    throw Object.assign(new Error("Evidence must be a list of files."), { status: 400 });
  }
  let totalBytes = 0;
  const uploaded = [];
  try {
    const stored = [];
    for (const file of evidence) {
      if (!file?.data || !String(file.data).startsWith("data:")) {
        throw Object.assign(new Error("Evidence must be uploaded from the report form."), { status: 400 });
      }
      const { contentType, bytes } = decodeMediaDataUrl(file.data);
      totalBytes += bytes.length;
      if (!bytes.length || totalBytes > MAX_REPORT_EVIDENCE_BYTES) {
        throw Object.assign(new Error("Evidence files must total no more than 2 MB. Remove a file or upload smaller images."), { status: 413 });
      }
      const path = `${userId}/${randomUUID()}`;
      const { error } = await getDatabase().storage.from(REPORT_EVIDENCE_BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      if (error) throw error;
      uploaded.push(path);
      stored.push({ name: String(file.name || "Evidence file").slice(0, 180), type: contentType, path });
    }
    return { stored, uploaded };
  } catch (error) {
    try {
      await removeMedia(REPORT_EVIDENCE_BUCKET, uploaded);
    } catch (cleanupError) {
      console.error("Could not clean up incomplete report evidence upload:", cleanupError.message);
    }
    throw error;
  }
}

async function uploadStudentIdImages(studentId, frontDataUrl, backDataUrl) {
  const images = [
    { path: `${studentId}/front.webp`, bytes: decodeStudentIdImage(frontDataUrl, "front") },
    { path: `${studentId}/back.webp`, bytes: decodeStudentIdImage(backDataUrl, "back") },
  ];
  const uploadedPaths = [];
  try {
    for (const image of images) {
      const { error } = await getDatabase().storage.from(STUDENT_ID_BUCKET).upload(image.path, image.bytes, {
        contentType: "image/webp",
        upsert: false,
      });
      if (error) {
        throw Object.assign(
          new Error(`Could not securely save the student ID photos. Run supabase/student_id_images.sql and deploy the API again. (${error.message})`),
          { status: 503 },
        );
      }
      uploadedPaths.push(image.path);
    }
    return { frontPath: images[0].path, backPath: images[1].path };
  } catch (error) {
    try {
      await removeStudentIdImages(uploadedPaths);
    } catch (cleanupError) {
      console.error("Could not clean up incomplete student ID uploads:", cleanupError.message);
    }
    throw error;
  }
}

function hashOtp(email, purpose, code) {
  return createHmac("sha256", getSessionSecret())
    .update(`${email}:${purpose}:${code}`)
    .digest("hex");
}

async function sendOtp(email, purpose, payload = null, origin = "") {
  const brevoKey = getEnvironmentVariable("BREVO_API_KEY");
  const senderEmail = getEnvironmentVariable("BREVO_SENDER_EMAIL");
  if (!brevoKey || !senderEmail) {
    throw Object.assign(new Error("Set BREVO_API_KEY and BREVO_SENDER_EMAIL in the server environment."), { status: 503 });
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const { data: expiredSignups, error: expiredSignupsError } = await db.from("auth_otps")
    .select("email,payload").eq("purpose", "signup").lt("expires_at", now);
  if (expiredSignupsError) throw expiredSignupsError;
  const expiredImagePaths = (expiredSignups || []).flatMap(({ payload: expiredPayload }) => [
    expiredPayload?.frontPath,
    expiredPayload?.backPath,
  ]);
  await removeStudentIdImages(expiredImagePaths);
  const { error: expiredOtpError } = await db.from("auth_otps")
    .delete().lt("expires_at", now);
  if (expiredOtpError) throw expiredOtpError;

  const { data: existing, error: existingError } = await db
    .from("auth_otps")
    .select("created_at")
    .eq("email", email)
    .eq("purpose", purpose)
    .maybeSingle();
  if (existingError) throw existingError;
  const resendCooldownMs = purpose === "signup"
    ? SIGNUP_OTP_RESEND_COOLDOWN_MINUTES * 60_000
    : 60_000;
  if (existing && Date.now() - new Date(existing.created_at).getTime() < resendCooldownMs) {
    const waitMessage = purpose === "signup"
      ? "Please wait up to 10 minutes before requesting another verification code."
      : "Please wait one minute before requesting another code.";
    throw Object.assign(new Error(waitMessage), { status: 429 });
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

  const logoUrl = getEmailLogoUrl(origin);
  const message = {
    sender: {
      name: getEnvironmentVariable("BREVO_SENDER_NAME") || "CNHS Bullying Reporting System",
      email: senderEmail,
    },
    to: [{ email }],
    subject: purpose === "signup" ? "Verify your CNHS account" : "Reset your CNHS password",
    textContent: `${purpose === "signup" ? "Verify your account" : "Reset your password"}\n\nUse this verification code: ${code}\n\nThis code expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
    htmlContent: `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="color-scheme" content="light">
          <title>${purpose === "signup" ? "Verify your account" : "Reset your password"}</title>
        </head>
        <body style="margin:0;padding:0;background-color:#f4f7f5;font-family:Arial,Helvetica,sans-serif;color:#1e2430;">
          <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">Your CNHS verification code expires in ${OTP_TTL_MINUTES} minutes.</span>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f7f5;">
            <tr>
              <td align="center" style="padding:40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
                  <tr>
                    <td align="center" style="padding:28px 24px;background-color:#15803d;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td align="center" valign="middle" width="72" height="72">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="72" height="72" alt="School logo" style="display:block;width:72px;height:72px;object-fit:contain;border-radius:12px;background-color:#ffffff;">` : ""}</td>
                          <td style="padding-left:16px;color:#ffffff;font-size:15px;font-weight:700;line-height:21px;text-align:left;">Bullying Reporting<br>&amp; Management System</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:36px 32px 32px;">
                      <p style="margin:0 0 8px;color:#15803d;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Account security</p>
                      <h1 style="margin:0 0 12px;color:#1e2430;font-size:24px;line-height:32px;font-weight:700;">${purpose === "signup" ? "Verify your account" : "Reset your password"}</h1>
                      <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:24px;">${purpose === "signup" ? "Enter this one-time code to finish creating your account." : "Use this one-time code to securely reset your password."}</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f0fdf4;border:1px solid #dcfce7;border-radius:12px;">
                        <tr>
                          <td align="center" style="padding:20px 12px;">
                            <p style="margin:0 0 8px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Your verification code</p>
                            <p style="margin:0;color:#166534;font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;">${code}</p>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:20px 0 0;color:#475569;font-size:14px;line-height:22px;">This code expires in <strong style="color:#1e2430;">${OTP_TTL_MINUTES} minutes</strong>. For your security, do not share it with anyone.</p>
                      <hr style="height:1px;margin:24px 0;border:0;background-color:#e5e7eb;">
                      <p style="margin:0;color:#64748b;font-size:13px;line-height:21px;">If you did not request this code, you can safely ignore this email. Your account will remain unchanged.</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:18px 0 0;color:#94a3b8;font-size:12px;line-height:18px;">CNHS Bullying Reporting &amp; Management System</p>
              </td>
            </tr>
          </table>
        </body>
      </html>`,
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
    if (
      response.status === 401 &&
      responseText.toLowerCase().includes("unrecognised ip address")
    ) {
      throw Object.assign(
        new Error("Brevo rejected the Supabase server IP. Add the Supabase Edge Function IP to Brevo's authorized IPs, or remove the Brevo API IP restriction."),
        { status: 503 },
      );
    }
    throw new Error(`Brevo could not send the verification email (${response.status}): ${responseText.slice(0, 300)}`);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function notifyAdminsOfPendingSignup(registration, origin = "") {
  const brevoKey = getEnvironmentVariable("BREVO_API_KEY");
  const senderEmail = getEnvironmentVariable("BREVO_SENDER_EMAIL");
  if (!brevoKey || !senderEmail) {
    throw new Error("Brevo notification email settings are missing.");
  }

  const { data: admins, error: adminsError } = await getDatabase()
    .from("admins")
    .select("email")
    .order("email", { ascending: true });
  if (adminsError) throw adminsError;
  const recipients = [...new Set((admins || []).map((admin) => admin.email).filter(Boolean))];
  if (!recipients.length) throw new Error("No administrator email addresses are configured.");

  const adminUrl = origin ? new URL("/admindashboard", origin).href : "";
  const logoUrl = getEmailLogoUrl(origin);
  const name = String(registration.name || "New student");
  const studentEmail = String(registration.email || "");
  const grade = String(registration.grade || "");
  const section = String(registration.section || "");
  const message = {
    sender: {
      name: getEnvironmentVariable("BREVO_SENDER_NAME") || "CNHS Bullying Reporting System",
      email: senderEmail,
    },
    to: [{ email: recipients[0] }],
    ...(recipients.length > 1 ? { bcc: recipients.slice(1).map((email) => ({ email })) } : {}),
    subject: "Student account awaiting CNHS admin approval",
    textContent: [
      "A student has verified their email and is waiting for administrator approval.",
      "",
      `Name: ${name}`,
      `Email: ${studentEmail}`,
      `Grade and section: ${grade} - ${section}`,
      "",
      adminUrl ? `Review pending accounts: ${adminUrl}` : "Sign in to the CNHS Bullying Reporting System to review pending accounts.",
    ].join("\n"),
    htmlContent: `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta name="color-scheme" content="light">
          <title>Student account awaiting approval</title>
        </head>
        <body style="margin:0;padding:0;background-color:#f4f7f5;font-family:Arial,Helvetica,sans-serif;color:#1e2430;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f7f5;">
            <tr>
              <td align="center" style="padding:40px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
                  <tr>
                    <td align="center" style="padding:24px;background-color:#15803d;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td align="center" valign="middle" width="72" height="72">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="72" height="72" alt="School logo" style="display:block;width:72px;height:72px;object-fit:contain;border-radius:12px;background-color:#ffffff;">` : ""}</td>
                          <td style="padding-left:16px;color:#ffffff;font-size:15px;font-weight:700;line-height:21px;text-align:left;">Bullying Reporting<br>&amp; Management System</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px;">
                      <p style="margin:0 0 8px;color:#15803d;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Admin action required</p>
                      <h1 style="margin:0 0 12px;color:#1e2430;font-size:24px;line-height:32px;">Student account awaiting approval</h1>
                      <p style="margin:0 0 20px;color:#64748b;font-size:15px;line-height:24px;">A student has verified their email and is waiting for an administrator to review the registration.</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e5e7eb;border-radius:12px;">
                        <tr><td style="padding:12px 16px;color:#64748b;font-size:14px;">Name</td><td style="padding:12px 16px;color:#1e2430;font-size:14px;font-weight:700;">${escapeHtml(name)}</td></tr>
                        <tr><td style="padding:12px 16px;border-top:1px solid #e5e7eb;color:#64748b;font-size:14px;">Email</td><td style="padding:12px 16px;border-top:1px solid #e5e7eb;color:#1e2430;font-size:14px;">${escapeHtml(studentEmail)}</td></tr>
                        <tr><td style="padding:12px 16px;border-top:1px solid #e5e7eb;color:#64748b;font-size:14px;">Grade / Section</td><td style="padding:12px 16px;border-top:1px solid #e5e7eb;color:#1e2430;font-size:14px;">${escapeHtml(grade)} - ${escapeHtml(section)}</td></tr>
                      </table>
                      ${adminUrl ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background-color:#16a34a;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Review account</a></p>` : ""}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>`,
  };
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Brevo could not send the admin notification (${response.status}): ${responseText.slice(0, 300)}`);
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

async function createSession(account) {
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
  return { success: true, role: account.role, profile, token };
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
  const maxAttempts = purpose === "reset" ? RESET_OTP_MAX_ATTEMPTS : OTP_MAX_ATTEMPTS;
  if (challenge.attempts >= maxAttempts) {
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

async function handleAuth(action, body, req) {
  const db = getDatabase();
  const email = String(body.email || "").trim().toLowerCase();

  if (action === "report-details") {
    const session = await getSession(req);
    const reportId = Number(body.reportId);
    if (!Number.isSafeInteger(reportId) || reportId < 1) {
      throw Object.assign(new Error("Invalid report."), { status: 400 });
    }
    const detailColumns = [
      "id", "type", "date", "time", "location", "description", "description_lead_up",
      "description_impact", "description_actions", "reporter_type", "victims", "offenders",
      "witnesses", "status", "priority", "submitted_by", "submitted_id", "reporter_age",
      "reporter_sex", "reporter_grade", "reporter_section", "is_anonymous", "admin_notes",
      "evidence_count", "scheduled_conference", "conference_findings",
      "conference_findings_updated_by", "conference_findings_updated_at", "submitted_at", "updated_at",
    ].join(",");
    const { data: report, error } = await db.from("reports")
      .select(detailColumns).eq("id", reportId).maybeSingle();
    if (error) throw error;
    if (!report) throw Object.assign(new Error("Report not found."), { status: 404 });
    if (session.role !== "admin" && report.submitted_id !== session.id) {
      throw Object.assign(new Error("You are not authorized to view this report."), { status: 403 });
    }
    return report;
  }

  if (action === "report-evidence") {
    const session = await getSession(req);
    const reportId = Number(body.reportId);
    if (!Number.isSafeInteger(reportId) || reportId < 1) {
      throw Object.assign(new Error("Invalid report."), { status: 400 });
    }
    const { data: report, error } = await db.from("reports")
      .select("submitted_id,evidence").eq("id", reportId).maybeSingle();
    if (error) throw error;
    if (!report) throw Object.assign(new Error("Report not found."), { status: 404 });
    if (session.role !== "admin" && report.submitted_id !== session.id) {
      throw Object.assign(new Error("You are not authorized to view this evidence."), { status: 403 });
    }
    const evidence = await Promise.all((report.evidence || []).map(async (item) => {
      if (!item.path) return item;
      const { data, error: signedUrlError } = await db.storage
        .from(REPORT_EVIDENCE_BUCKET).createSignedUrl(item.path, 60 * 60);
      if (signedUrlError) throw signedUrlError;
      return { name: item.name, type: item.type, data: data.signedUrl };
    }));
    return { evidence };
  }

  if (action === "notification-unread-count") {
    const session = await getSession(req);
    let query = db.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("audience", session.role === "admin" ? "admin" : "student")
      .eq("read", false);
    if (session.role === "student") query = query.or(`student_id.eq.${session.id},student_id.is.null`);
    const { count, error } = await query;
    if (error) throw error;
    return { count: count || 0 };
  }

  if (action === "awareness-image") {
    await getSession(req);
    if (!Number.isSafeInteger(Number(body.id))) {
      throw Object.assign(new Error("Invalid awareness content."), { status: 400 });
    }
    const { data: item, error } = await db.from("awareness_content")
      .select("full_image_path").eq("id", Number(body.id)).maybeSingle();
    if (error) throw error;
    if (!item) throw Object.assign(new Error("Awareness content not found."), { status: 404 });
    if (!item.full_image_path) {
      const { data: legacy, error: legacyError } = await db.from("awareness_content")
        .select("thumbnail").eq("id", Number(body.id)).single();
      if (legacyError) throw legacyError;
      return { url: legacy.thumbnail?.startsWith("data:") ? legacy.thumbnail : null };
    }
    const { data, error: signedUrlError } = await db.storage
      .from(AWARENESS_MEDIA_BUCKET).createSignedUrl(item.full_image_path, 60 * 60);
    if (signedUrlError) throw signedUrlError;
    return { url: data.signedUrl };
  }

  if (action === "signup") {
    const { name, password, lrn, age, sex, grade, section, studentIdFront, studentIdBack } = body;
    if (!studentIdFront || !studentIdBack) {
      throw Object.assign(new Error("Upload both the front and back photos of your student ID before signing up."), { status: 400 });
    }
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

    const id = randomUUID();
    const imagePaths = await uploadStudentIdImages(id, studentIdFront, studentIdBack);
    const payload = {
      id,
      name: name.trim(),
      email,
      lrn: String(lrn),
      age: Number(age),
      sex,
      grade,
      section: section.trim(),
      ...imagePaths,
      password_hash: await hashPassword(password),
    };
    try {
      await sendOtp(email, "signup", payload, req.headers.origin);
    } catch (error) {
      try {
        await removeStudentIdImages(Object.values(imagePaths));
      } catch (cleanupError) {
        console.error("Could not clean up student ID photos after signup failed:", cleanupError.message);
      }
      throw error;
    }
    return { success: true, needsConfirmation: true };
  }

  if (action === "student-id-images") {
    const session = await getSession(req);
    requireRole(session, "admin");
    const studentId = String(body.studentId || "");
    if (!/^[\da-f-]{36}$/i.test(studentId)) {
      throw Object.assign(new Error("Invalid student account."), { status: 400 });
    }
    const { data: student, error } = await db.from("students")
      .select("student_id_front_path, student_id_back_path").eq("id", studentId).maybeSingle();
    if (error) throw error;
    if (!student) throw Object.assign(new Error("Student account not found."), { status: 404 });

    const createSignedUrl = async (path) => {
      if (!path) return null;
      const { data, error: signedUrlError } = await db.storage
        .from(STUDENT_ID_BUCKET).createSignedUrl(path, 10 * 60);
      if (signedUrlError) throw signedUrlError;
      return data.signedUrl;
    };
    const [front, back] = await Promise.all([
      createSignedUrl(student.student_id_front_path),
      createSignedUrl(student.student_id_back_path),
    ]);
    return { front, back };
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
      student_id_front_path: registration.frontPath,
      student_id_back_path: registration.backPath,
    });
    if (profileError) {
      const { error: cleanupError } = await db.from("auth_credentials").delete().eq("id", registration.id);
      if (cleanupError) throw cleanupError;
      throw profileError;
    }
    const { error: removeError } = await db.from("auth_otps").delete().eq("email", email).eq("purpose", "signup");
    if (removeError) throw removeError;
    try {
      await notifyAdminsOfPendingSignup(registration, req.headers.origin);
    } catch (error) {
      console.error("Admin signup notification failed:", error.message);
    }
    return { success: true };
  }

  if (action === "signin") {
    const credential = await getExistingAccount(email);
    if (!credential?.password_hash) {
      throw Object.assign(new Error("Invalid email or password. If this is an existing account, use Forgot Password to set a new password."), { status: 401 });
    }
    if (credential.password_hash.startsWith("scrypt$")) {
      throw Object.assign(new Error("This account needs a one-time password reset. Use Forgot Password to set a new password."), { status: 401 });
    }
    if (!await verifyPassword(String(body.password || ""), credential.password_hash)) {
      throw Object.assign(new Error("Invalid email or password."), { status: 401 });
    }
    if (!credential.email_verified) {
      throw Object.assign(new Error("Please verify your email before signing in."), { status: 403 });
    }
    if (credential.role === "student") {
      const { data: student, error } = await db.from("students")
        .select("id,name,email,lrn,age,sex,grade,section,approved,created_at")
        .eq("id", credential.id).single();
      if (error) throw error;
      if (!student.approved) {
        throw Object.assign(new Error("Your account is waiting for admin confirmation. You'll be able to log in once an administrator approves your registration."), { status: 403 });
      }
    }
    return createSession(credential);
  }

  if (action === "request-password-reset") {
    if (email) {
      const account = await getExistingAccount(email);
      if (account) {
        const payload = { id: account.id, role: account.role };
        try {
          await sendOtp(email, "reset", payload, req.headers.origin);
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
    return { success: true };
  }

  if (action === "session") {
    const session = await getSession(req, { optional: true });
    if (!session) return { success: true, user: null };
    const table = session.role === "admin" ? "admins" : "students";
    const profileColumns = session.role === "student"
      ? "id,name,email,lrn,age,sex,grade,section,approved,created_at"
      : "*";
    const { data: profile, error } = await db.from(table).select(profileColumns).eq("id", session.id).maybeSingle();
    if (error) throw error;
    if (!profile || (session.role === "student" && !profile.approved)) {
      return { success: true, user: null };
    }
    return { success: true, role: session.role, profile };
  }

  if (action === "resend-signup") {
    if (email) {
      const { data: challenge, error } = await db.from("auth_otps")
        .select("payload").eq("email", email).eq("purpose", "signup").maybeSingle();
      if (error) throw error;
      if (challenge) await sendOtp(email, "signup", challenge.payload, req.headers.origin);
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
    if (!["eq", "neq", "gte", "lt", "ilike", "is"].includes(filter.operator)) {
      throw Object.assign(new Error("Unsupported query filter."), { status: 400 });
    }
    query = query[filter.operator](filter.column, filter.value);
  }
  return query;
}

async function runQuery(body, req) {
  const { table, operation, columns, filters, orders, values: requestValues, returning, single, limit, offset } = body.query || {};
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
  const uploadedPaths = [];
  let oldAwarenessPaths = [];
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
      const { stored, uploaded } = await uploadReportEvidence(session.id, values.evidence || []);
      values.evidence = stored;
      uploadedPaths.push(...uploaded);
    }
    if (table === "awareness_content") {
      values = { ...(values || {}) };
      const sharedMedia = values.thumbnailData && values.thumbnailData === values.fullImageData;
      for (const [source, destination] of [["thumbnailData", "thumbnail_path"], ["fullImageData", "full_image_path"]]) {
        if (source === "fullImageData" && sharedMedia && values.thumbnail_path) {
          values.full_image_path = values.thumbnail_path;
          delete values[source];
          continue;
        }
        if (typeof values[source] === "string" && values[source].startsWith("data:")) {
          const path = `${session.id}/${randomUUID()}`;
          try {
            await uploadMedia(AWARENESS_MEDIA_BUCKET, path, values[source]);
          } catch (error) {
            await removeMedia(AWARENESS_MEDIA_BUCKET, uploadedPaths);
            throw error;
          }
          uploadedPaths.push(path);
          values[destination] = path;
        }
        delete values[source];
      }
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
    if (table === "awareness_content") {
      const { data: existingRows, error: existingError } = await applyFilters(
        getDatabase().from(table).select("thumbnail_path,full_image_path"),
        filters,
      );
      if (existingError) throw existingError;
      oldAwarenessPaths = (existingRows || []).flatMap((item) => [item.thumbnail_path, item.full_image_path]);
      values = { ...(values || {}) };
      if (existingRows?.length) {
        if (!Object.hasOwn(values, "thumbnail_path")) values.thumbnail_path = existingRows[0].thumbnail_path;
        if (!Object.hasOwn(values, "full_image_path")) values.full_image_path = existingRows[0].full_image_path;
      }
      const sharedMedia = values.thumbnailData && values.thumbnailData === values.fullImageData;
      for (const [source, destination] of [["thumbnailData", "thumbnail_path"], ["fullImageData", "full_image_path"]]) {
        if (source === "fullImageData" && sharedMedia && values.thumbnail_path) {
          values.full_image_path = values.thumbnail_path;
          delete values[source];
          continue;
        }
        if (typeof values[source] === "string" && values[source].startsWith("data:")) {
          const path = `${session.id}/${randomUUID()}`;
          try {
            await uploadMedia(AWARENESS_MEDIA_BUCKET, path, values[source]);
          } catch (error) {
            await removeMedia(AWARENESS_MEDIA_BUCKET, uploadedPaths);
            throw error;
          }
          uploadedPaths.push(path);
          values[destination] = path;
        }
        delete values[source];
      }
    }
    query = query.update(values);
    if (returning) query = query.select(columns || "*");
  } else if (operation === "delete") {
    if (table === "awareness_content") {
      const { data: existingRows, error: existingError } = await applyFilters(
        getDatabase().from(table).select("thumbnail_path,full_image_path"),
        filters,
      );
      if (existingError) throw existingError;
      oldAwarenessPaths = (existingRows || []).flatMap((item) => [item.thumbnail_path, item.full_image_path]);
    }
    if (table === "reports") {
      const { data: existingRows, error: existingError } = await applyFilters(
        getDatabase().from(table).select("evidence"),
        filters,
      );
      if (existingError) throw existingError;
      oldAwarenessPaths = (existingRows || []).flatMap((item) =>
        (item.evidence || []).map((evidence) => evidence.path)
      );
    }
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
  if (Number.isInteger(offset) && offset > 0) query = query.range(offset, offset + Math.max(1, limit || 1) - 1);
  else if (Number.isInteger(limit) && limit >= 0) query = query.limit(limit);

  let result = await query;
  if (result.error) {
    await removeMedia(table === "awareness_content" ? AWARENESS_MEDIA_BUCKET : REPORT_EVIDENCE_BUCKET, uploadedPaths);
    if (table === "reports" && operation === "delete" && result.error.code === "23503") {
      throw Object.assign(new Error("This report has an offense decision or approved offense record and cannot be deleted."), { status: 409 });
    }
    throw result.error;
  }
  if (oldAwarenessPaths.length) {
    try {
      const retainedPaths = table === "awareness_content"
        ? [values?.thumbnail_path, values?.full_image_path]
        : [];
      await removeMedia(
        table === "awareness_content" ? AWARENESS_MEDIA_BUCKET : REPORT_EVIDENCE_BUCKET,
        oldAwarenessPaths.filter((path) => !retainedPaths.includes(path)),
      );
    } catch (cleanupError) {
      console.error(`Could not clean up replaced ${table} media:`, cleanupError.message);
    }
  }
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
    if (functionName === "search_offense_reports") {
      const session = await getSession(req);
      requireRole(session, "admin");
      const term = String(args.search_term || "").trim();
      const pageSize = Math.max(1, Math.min(Number(args.page_size) || 20, 50));
      const columns = "id,type,date,time,location,description,victims,offenders,witnesses,status,submitted_by,is_anonymous,evidence_count,scheduled_conference,submitted_at";
      let query = db.from("reports").select(columns);
      if (term) {
        const idMatch = /^(?:report\s*)?#?(\d+)$/i.exec(term);
        if (idMatch) {
          query = query.eq("id", Number(idMatch[1]));
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(term)) {
          const start = new Date(`${term}T00:00:00.000Z`);
          const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
          query = query.or(`date.eq.${term},and(submitted_at.gte.${start.toISOString()},submitted_at.lt.${end.toISOString()})`);
        } else {
          const safeTerm = term.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim().slice(0, 100);
          if (!safeTerm) return [];
          const pattern = `*${safeTerm}*`;
          query = query.or(`type.ilike.${pattern},description.ilike.${pattern},and(is_anonymous.eq.false,submitted_by.ilike.${pattern})`);
        }
      }
      const { data, error } = await query
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(pageSize);
      if (error) throw error;
      return (data || []).map((report) => ({
        ...report,
        reporter_name: report.is_anonymous ? "Anonymous" : report.submitted_by,
        submitted_by: report.is_anonymous ? null : report.submitted_by,
      }));
    }
    const offenseFunctions = new Set([
      "search_offense_students",
      "get_student_offense_records",
      "get_student_offense_history",
      "get_report_student_links",
      "link_report_student",
      "save_offense_decision",
      "create_student_offense_record",
      "save_report_conference_findings",
    ]);
    if (offenseFunctions.has(functionName)) {
      const session = await getSession(req);
      requireRole(session, "admin");
      const { data, error } = await db.rpc(functionName, { ...args, actor_id: session.id });
      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          throw Object.assign(new Error("Student Offense Records is not installed yet. Apply supabase/student_offense_records.sql."), { status: 503 });
        }
        if (error.code === "23505") {
          throw Object.assign(new Error("This incident is already recorded for this student."), { status: 409 });
        }
        if (error.code === "P0001" || error.code === "23514") {
          throw Object.assign(new Error(error.message), { status: 400 });
        }
        throw error;
      }
      return data;
    }
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
        .select("email,student_id_front_path,student_id_back_path").eq("id", id).maybeSingle();
      if (fetchError) throw fetchError;
      if (!student) throw Object.assign(new Error("Student account not found."), { status: 404 });
      const { error: deleteStudentError } = await db.from("students").delete().eq("id", id);
      if (deleteStudentError?.code === "23503") {
        throw Object.assign(new Error("This student has linked incident or offense history and cannot be removed."), { status: 409 });
      }
      if (deleteStudentError) throw deleteStudentError;
      const { error: deleteCredentialError } = await db.from("auth_credentials").delete().eq("id", id);
      if (deleteCredentialError) throw deleteCredentialError;
      const { error: deleteOtpError } = await db.from("auth_otps").delete().eq("email", student.email);
      if (deleteOtpError) throw deleteOtpError;
      await removeStudentIdImages([student.student_id_front_path, student.student_id_back_path]);
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
    const body = await readJson(req);
    const result = body.action === "rpc"
      ? await runRpc(body.functionName, body.args || {}, req)
      : await handleAuth(body.action, body, req);
    return send(res, 200, result);
  } catch (error) {
    const status = Number(error.status) || (error.code === "23505" ? 409 : 500);
    if (status >= 500) console.error("API request failed:", error.message);
    return send(res, status, { error: status === 500 ? "The request could not be completed. Please try again later." : error.message });
  }
}
