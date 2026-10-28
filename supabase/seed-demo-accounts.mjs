// One-time script: creates demo accounts as real Supabase Auth users, plus
// their profile rows. Run with: node supabase/seed-demo-accounts.mjs
// Requires: schema.sql already run, and "Confirm email" turned off in
// Authentication > Sign In / Up. Admin profiles must be added in the
// Supabase SQL Editor because the public client is not allowed to write them.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => l.split("="))
);
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function seedAdmin() {
  const { data, error } = await supabase.auth.signUp({ email: "admin@cnhs.edu.ph", password: "admin123" });
  if (error) { console.error("Admin signUp failed:", error.message); return; }
  if (!data.session) {
    console.error("Admin signup returned no session. Confirm email may be enabled, or this account may already exist. Check Authentication > Users; if it exists, use its user ID in the admin profile SQL below.");
    return;
  }
  console.log("Admin auth account created. Run this in Supabase SQL Editor to allow admin access:");
  console.log(`insert into public.admins (id, email, name) values ('${data.user.id}', 'admin@cnhs.edu.ph', 'Administrator') on conflict (id) do update set email = excluded.email, name = excluded.name;`);
  await supabase.auth.signOut();
}

async function seedStudent() {
  const { data, error } = await supabase.auth.signUp({ email: "student@cnhs.edu.ph", password: "student123" });
  if (error) { console.error("Student signUp failed:", error.message); return; }
  if (!data.session) {
    console.error("No session after signUp — 'Confirm email' is probably still ON. Turn it off in Authentication > Sign In / Up, then re-run this script.");
    return;
  }
  const { error: insertError } = await supabase.from("students").insert({
    id: data.user.id, name: "Sample Student", email: "student@cnhs.edu.ph",
    age: 14, sex: "", grade: "Grade 8", section: "Rizal", approved: true,
  });
  if (insertError) console.error("Student profile insert failed:", insertError.message);
  else console.log("Student account ready:", data.user.id);
  await supabase.auth.signOut();
}

async function seedTemporaryStudent() {
  const email = "temp.student@cnhs.edu.ph";
  const { data, error } = await supabase.auth.signUp({
    email,
    password: "TempStudent123!",
  });
  if (error) {
    console.error("Temporary student signUp failed:", error.message);
    return;
  }
  if (!data.session) {
    console.error("No session after temporary student signUp — 'Confirm email' is probably still ON. Turn it off in Authentication > Sign In / Up, then re-run this script.");
    return;
  }

  const { error: insertError } = await supabase.from("students").insert({
    id: data.user.id,
    name: "Temporary Demo Student",
    email,
    age: 14,
    sex: "",
    grade: "Grade 8",
    section: "Rizal",
    approved: true,
  });
  if (insertError) console.error("Temporary student profile insert failed:", insertError.message);
  else console.log("Temporary student account ready:", email);
  await supabase.auth.signOut();
}

await seedAdmin();
await seedStudent();
await seedTemporaryStudent();
