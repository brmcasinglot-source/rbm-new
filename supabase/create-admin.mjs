import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hashPassword } from "./functions/_shared/password.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv("production", projectRoot, "");
const {
  SUPABASE_URL: configuredUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  ADMIN_EMAIL: emailValue,
  ADMIN_PASSWORD: password,
  ADMIN_NAME: name,
} = env;
const url = configuredUrl;
const email = emailValue?.trim().toLowerCase();

if (!url || !serviceKey || !email || !password || !name) {
  throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME in .env.");
}
if (password.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: student, error: studentError } = await supabase
  .from("students").select("id").ilike("email", email).maybeSingle();
if (studentError) throw new Error(`Could not check student accounts: ${studentError.message}`);
if (student) throw new Error("This email already belongs to a student account. Use a different email for the admin.");

const { data: existingAdmin, error: adminError } = await supabase
  .from("admins").select("id, email").ilike("email", email).maybeSingle();
if (adminError) throw new Error(`Could not check existing admins: ${adminError.message}`);

const { data: existingCredential, error: credentialError } = await supabase
  .from("auth_credentials").select("id, role, password_hash, session_version")
  .ilike("email", email).maybeSingle();
if (credentialError) throw new Error(`Could not check existing credentials: ${credentialError.message}`);
if (existingCredential && existingCredential.role !== "admin") {
  throw new Error("This email is already linked to a non-admin account.");
}

const id = existingCredential?.id || existingAdmin?.id || randomUUID();
const passwordHash = existingCredential?.password_hash?.startsWith("pbkdf2-sha256$")
  ? existingCredential.password_hash
  : await hashPassword(password);
const { error: profileWriteError } = await supabase.from("admins").upsert(
  { id, email, name },
  { onConflict: "id" },
);
if (profileWriteError) throw new Error(`Could not create the admin profile: ${profileWriteError.message}`);

const { error: credentialWriteError } = await supabase.from("auth_credentials").upsert(
  {
    id,
    email,
    password_hash: passwordHash,
    role: "admin",
    email_verified: true,
    session_version: existingCredential?.session_version || 0,
    updated_at: new Date().toISOString(),
  },
  { onConflict: "id" },
);
if (credentialWriteError) {
  throw new Error(`Admin profile exists, but custom credentials could not be created: ${credentialWriteError.message}`);
}

console.log(`Admin access is ready for ${email}.`);
console.log(existingCredential?.password_hash?.startsWith("pbkdf2-sha256$")
  ? "The existing custom password was preserved."
  : "Sign in with ADMIN_EMAIL and ADMIN_PASSWORD. Any previous scrypt password was replaced.");
