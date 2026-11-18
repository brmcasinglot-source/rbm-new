import { authRequest, supabase } from "./apiClient.js";

if (localStorage.getItem("cnhsDemoMode") === "true") {
  ["studentName", "studentId", "studentAge", "studentSex", "studentGrade", "studentSection", "userRole"]
    .forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem("cnhsDemoData");
  localStorage.removeItem("cnhsDemoMode");
}

function cacheStudentSession(profile) {
  localStorage.setItem("studentName", profile.name || "");
  localStorage.setItem("studentId", profile.id || "");
  localStorage.setItem("studentLRN", profile.lrn || "");
  localStorage.setItem("studentAge", profile.age ?? "");
  localStorage.setItem("studentSex", profile.sex || "");
  localStorage.setItem("studentGrade", profile.grade || "");
  localStorage.setItem("studentSection", profile.section || "");
  localStorage.setItem("email", profile.email || "");
  localStorage.setItem("userRole", "student");
}

function cacheAdminSession(profile) {
  ["studentLRN", "studentAge", "studentSex", "studentGrade", "studentSection"]
    .forEach((key) => localStorage.removeItem(key));
  localStorage.setItem("studentName", profile.name || "Administrator");
  localStorage.setItem("studentId", profile.id || "");
  localStorage.setItem("email", profile.email || "");
  localStorage.setItem("userRole", "admin");
}

function clearCachedSession() {
  localStorage.removeItem("cnhsSessionToken");
  ["studentName", "studentId", "studentLRN", "studentAge", "studentSex", "studentGrade", "studentSection", "email", "userRole"]
    .forEach((key) => localStorage.removeItem(key));
}

export async function signUpStudent(details) {
  try {
    const result = await authRequest("signup", details);
    return { success: true, needsConfirmation: result.needsConfirmation };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function isStudentLrnTaken(lrn) {
  const { data, error } = await supabase.rpc("is_lrn_taken", { check_lrn: String(lrn) });
  if (error) throw new Error(error.message || "Could not verify this LRN.");
  if (typeof data !== "boolean") {
    throw new Error("The LRN verification service returned an invalid response.");
  }
  return data;
}

export async function getStudentIdImages(studentId) {
  return authRequest("student-id-images", { studentId });
}

export async function verifyStudentEmail(email, code) {
  try {
    await authRequest("verify-signup", { email, code });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function signIn(email, password) {
  try {
    const result = await authRequest("signin", { email, password });
    if (result.needsLoginOtp) return { success: true, needsLoginOtp: true };
    if (typeof result.token !== "string" || !result.token) {
      throw new Error("The server did not create a session. Check the Supabase Edge Function deployment.");
    }
    localStorage.setItem("cnhsSessionToken", result.token);
    if (result.role === "admin") cacheAdminSession(result.profile);
    else cacheStudentSession(result.profile);
    return { success: true, role: result.role, [result.role]: result.profile };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function verifyLoginOtp(email, code) {
  try {
    const result = await authRequest("verify-login", { email, code });
    if (typeof result.token !== "string" || !result.token) {
      throw new Error("The server did not create a session.");
    }
    localStorage.setItem("cnhsSessionToken", result.token);
    if (result.role === "admin") cacheAdminSession(result.profile);
    else cacheStudentSession(result.profile);
    return { success: true, role: result.role };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function resendLoginOtp(email) {
  try {
    await authRequest("resend-login", { email });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getCurrentSession() {
  if (!localStorage.getItem("cnhsSessionToken")) return null;

  const result = await authRequest("session");
  if (!result.user && !result.profile) {
    clearCachedSession();
    return null;
  }
  if (!["admin", "student"].includes(result.role) || !result.profile) {
    throw new Error("The server returned an invalid account session.");
  }

  if (result.role === "admin") cacheAdminSession(result.profile);
  else cacheStudentSession(result.profile);
  return { role: result.role, profile: result.profile };
}

export async function sendPasswordResetEmail(email) {
  try {
    await authRequest("request-password-reset", { email });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updatePassword(email, code, password) {
  try {
    await authRequest("update-password", { email, code, password });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function signOut() {
  clearCachedSession();
}

export async function resendConfirmationEmail(email) {
  try {
    await authRequest("resend-signup", { email });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
