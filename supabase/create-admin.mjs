import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv("production", projectRoot, "");
const { VITE_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey, ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: name } = env;

if (!url || !serviceKey || !email || !password || !name) {
  throw new Error("Set VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME in .env.");
}
if (password.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not check existing Auth users: ${error.message}`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

let user = await findAuthUserByEmail(email);
const created = !user;
if (user) {
  const { data: student, error } = await supabase.from("students").select("id").eq("id", user.id).maybeSingle();
  if (error) throw new Error(`Could not check student profile: ${error.message}`);
  if (student) {
    throw new Error("This email already belongs to a student account. Use a different email for the admin.");
  }
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw new Error(`Could not create Auth user: ${error.message}`);
  user = data.user;
}

const { error } = await supabase.from("admins").upsert(
  { id: user.id, email: user.email, name },
  { onConflict: "id" },
);
if (error) throw new Error(`Auth user exists, but admin access could not be granted: ${error.message}`);

console.log(`Admin access is ready for ${user.email}.`);
console.log(created
  ? "Sign in with ADMIN_EMAIL and ADMIN_PASSWORD."
  : "This Auth user already existed, so its password was not changed. Sign in with its existing password.");
