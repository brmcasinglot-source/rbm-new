import { supabase } from "./supabaseClient";

if (localStorage.getItem("cnhsDemoMode") === "true") {
  ["studentName", "studentId", "studentAge", "studentSex", "studentGrade", "studentSection", "userRole"]
    .forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem("cnhsDemoData");
  localStorage.removeItem("cnhsDemoMode");
}

// Creates the students-table profile row from the registration details
// stashed in user_metadata at signUp() time (see signUpStudent). Used both
// right after email confirmation (finalizeEmailConfirmation, below) and as
// a fallback on first login in case that step was ever skipped. No-ops if
// there's no metadata to build a row from; tolerates the row already
// existing (e.g. the confirmation link was opened twice).
async function ensureStudentProfile(user) {
  const meta = user.user_metadata || {};
  if (!meta.name) return null;

  const { data: created, error } = await supabase.from("students").insert({
    id: user.id, name: meta.name, email: user.email,
    lrn: meta.lrn, age: meta.age, sex: meta.sex, grade: meta.grade, section: meta.section,
  }).select().single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const { data: existing } = await supabase.from("students").select("*").eq("id", user.id).single();
      return existing || null;
    }
    return null;
  }
  return created;
}

/**
 * Called right after a student clicks the Gmail confirmation link, once
 * EmailConfirmed.jsx has confirmed (via the SIGNED_IN auth event — see that
 * file for why it can't just call getUser() on mount) that supabase-js has
 * turned the link into a live session for `user`. While that session is
 * active this satisfies RLS to create their `students` profile row
 * immediately, so the account shows up in the admin's Account Confirmations
 * queue right away instead of waiting for their first login attempt.
 * Always signs the raw session back out afterward regardless of outcome.
 */
export async function finalizeEmailConfirmation(user) {
  if (!supabase) return;
  if (user) {
    await ensureStudentProfile(user);
  }
  await supabase.auth.signOut();
}

function cacheStudentSession(profile) {
  localStorage.setItem("studentName",    profile.name    || "");
  localStorage.setItem("studentId",      profile.id      || "");
  localStorage.setItem("studentLRN",     profile.lrn     || "");
  localStorage.setItem("studentAge",     profile.age     ?? "");
  localStorage.setItem("studentSex",     profile.sex     || "");
  localStorage.setItem("studentGrade",   profile.grade   || "");
  localStorage.setItem("studentSection", profile.section || "");
  localStorage.setItem("email",          profile.email   || "");
  localStorage.setItem("userRole",       "student");
}

/**
 * Register a new student account: creates the Supabase Auth user, then the
 * matching row in `students` (id = auth user's uuid, required by RLS).
 * Returns { success, error, needsConfirmation }.
 */
export async function signUpStudent({ name, email, password, lrn, age, sex, grade, section }) {
  if (!supabase) {
    return {
      success: false,
      error: "Supabase is not configured. Student registration requires a Supabase connection.",
    };
  }

  const { data: lrnTaken } = await supabase.rpc("is_lrn_taken", { check_lrn: lrn });
  if (lrnTaken) {
    return { success: false, error: "This LRN is already registered to another account." };
  }

  // Stash the registration details as Supabase Auth user metadata — when
  // "Confirm email" is on, no session exists yet so we can't insert into
  // `students` (RLS needs auth.uid()). This metadata survives the email
  // confirmation step and is picked up by signIn() on their first login to
  // finally create the profile row.
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { name, lrn, age, sex, grade, section },
      // Without this, Supabase sends the user back to the Site URL ("/")
      // after they click the Gmail confirmation link, with no indication
      // anything happened. Landing on /email-confirmed instead shows a
      // dedicated "you're confirmed!" screen — see src/pages/EmailConfirmed.jsx.
      // Must also be listed under Authentication > URL Configuration >
      // Redirect URLs in the Supabase dashboard, or Supabase silently
      // ignores it and falls back to the Site URL.
      emailRedirectTo: `${window.location.origin}/email-confirmed`,
    },
  });
  if (error) {
    if (/already registered|already exists|already in use/i.test(error.message)) {
      return { success: false, error: "This email is already registered. Please sign in instead." };
    }
    return { success: false, error: error.message };
  }
  if (!data.user) return { success: false, error: "Sign up failed. Please try again." };

  // Supabase quirk: with "Confirm email" on, signUp() doesn't error for a
  // duplicate email — it returns a fake user with an empty `identities`
  // array instead (to avoid leaking which emails are registered).
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { success: false, error: "This email is already registered. Please sign in instead." };
  }

  // No session yet means "Confirm email" is on in Supabase Auth settings —
  // the students-table insert needs auth.uid() (RLS), which only exists
  // once the user actually has a session, i.e. after they confirm + log in.
  if (!data.session) {
    return { success: true, needsConfirmation: true };
  }

  const { error: profileError } = await supabase.from("students").insert({
    id: data.user.id, name, email, lrn, age, sex, grade, section,
  });
  if (profileError) {
    const message = /unique|duplicate/i.test(profileError.message)
      ? "This LRN is already registered to another account."
      : profileError.message;
    return { success: false, error: message };
  }

  return { success: true, needsConfirmation: false };
}

/**
 * Single sign-in for both roles — there's no role picker in the UI, so this
 * signs the user in once, then checks which table they belong to and routes
 * accordingly. An account can be a student OR an admin, never both.
 * Returns { success, error, role: "admin" | "student" }.
 */
export async function signIn(email, password) {
  if (!supabase) {
    return {
      success: false,
      error: "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to sign in.",
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: "Invalid email or password." };

  const { data: admin } = await supabase.from("admins").select("*").eq("id", data.user.id).single();
  if (admin) {
    localStorage.setItem("studentName", admin.name || "Administrator");
    localStorage.setItem("userRole",    "admin");
    return { success: true, role: "admin", admin };
  }

  let { data: profile } = await supabase.from("students").select("*").eq("id", data.user.id).single();

  // Fallback in case finalizeEmailConfirmation() was ever skipped (e.g. an
  // older signup, or the confirmation page didn't run) — the profile row
  // was deferred at signUp() time (no session existed yet), so create it
  // now from the metadata we stashed back then. Falls straight into the
  // pending-approval check below, since a brand-new row starts unapproved.
  if (!profile) {
    profile = await ensureStudentProfile(data.user);
  }

  if (profile) {
    if (!profile.approved) {
      await supabase.auth.signOut();
      return {
        success: false,
        pending: true,
        error: "Your account is waiting for admin confirmation. You'll be able to log in once an administrator approves your registration.",
      };
    }
    cacheStudentSession(profile);
    return { success: true, role: "student", student: profile };
  }

  await supabase.auth.signOut();
  return { success: false, error: "No account profile found for this login. Please contact the administrator." };
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  ["studentName", "studentId", "studentLRN", "studentAge", "studentSex", "studentGrade", "studentSection", "email", "userRole"]
    .forEach((k) => localStorage.removeItem(k));
}

export async function getCurrentUserId() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id || null;
}
