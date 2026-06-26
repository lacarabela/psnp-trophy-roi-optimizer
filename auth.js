let supabaseClient = null;

window.addEventListener("DOMContentLoaded", initAuth);

async function initAuth() {
  initializeSupabase();
  if (!supabaseClient) {
    document.getElementById("setupWarning").hidden = false;
    return;
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showAuthMode("newPassword");
      return;
    }
    if (session?.user && !isResetUrl()) {
      window.location.href = "index.html";
    }
  });

  const { data } = await supabaseClient.auth.getSession();
  if (isResetUrl()) {
    showAuthMode("newPassword");
  } else if (data.session?.user) {
    window.location.href = "index.html";
  }
}

function initializeSupabase() {
  const url = window.TROPHY_ROI_SUPABASE_URL;
  const key = window.TROPHY_ROI_SUPABASE_ANON_KEY;
  const missing = !url || !key || url.includes("PASTE_") || key.includes("PASTE_");
  if (missing || !window.supabase) return;
  supabaseClient = window.supabase.createClient(url, key);
}

function showAuthMode(mode) {
  const forms = ["loginForm", "signupForm", "forgotForm", "newPasswordForm"];
  forms.forEach(id => document.getElementById(id).hidden = true);
  document.getElementById("loginTab").classList.toggle("active", mode === "login");
  document.getElementById("signupTab").classList.toggle("active", mode === "signup");
  document.getElementById("authMessage").hidden = true;

  if (mode === "signup") document.getElementById("signupForm").hidden = false;
  else if (mode === "forgot") document.getElementById("forgotForm").hidden = false;
  else if (mode === "newPassword") document.getElementById("newPasswordForm").hidden = false;
  else document.getElementById("loginForm").hidden = false;
}

async function signIn() {
  if (!supabaseClient) return showMessage("Add your Supabase URL/key first.");
  const email = raw("loginEmail").trim();
  const password = raw("loginPassword");
  if (!email || !password) return showMessage("Enter your email and password.");

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return showMessage(error.message);
  window.location.href = "index.html";
}

async function signUp() {
  if (!supabaseClient) return showMessage("Add your Supabase URL/key first.");
  const username = cleanUsername(raw("signupUsername"));
  const email = raw("signupEmail").trim();
  const password = raw("signupPassword");

  if (!username || !email || !password) return showMessage("Enter a username, email, and password.");
  if (!isValidUsername(username)) return showMessage("Username must be 3–24 characters and can use letters, numbers, underscores, hyphens, and periods.");
  if (password.length < 6) return showMessage("Password should be at least 6 characters.");

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: siteUrl("index.html"),
      data: { username }
    }
  });

  if (error) return showMessage(error.message);

  if (data.user && data.session) {
    await upsertProfile(data.user.id, username);
    window.location.href = "index.html";
  } else {
    showMessage("Account created. Check your email if confirmation is enabled, then sign in.");
  }
}

async function sendResetEmail() {
  if (!supabaseClient) return showMessage("Add your Supabase URL/key first.");
  const email = raw("resetEmail").trim();
  if (!email) return showMessage("Enter your email first.");

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: siteUrl("login.html?reset-password=true")
  });

  if (error) return showMessage(error.message);
  showMessage("Password reset email sent. Check your inbox.");
}

async function updatePassword() {
  if (!supabaseClient) return showMessage("Add your Supabase URL/key first.");
  const password = raw("newPassword");
  const confirm = raw("confirmPassword");
  if (!password || !confirm) return showMessage("Enter and confirm your new password.");
  if (password !== confirm) return showMessage("Passwords do not match.");
  if (password.length < 6) return showMessage("Password should be at least 6 characters.");

  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) return showMessage(error.message);
  showMessage("Password updated. Redirecting to the app...");
  setTimeout(() => { window.location.href = "index.html"; }, 900);
}

async function upsertProfile(userId, username) {
  const { error } = await supabaseClient.from("profiles").upsert({ id: userId, username }, { onConflict: "id" });
  if (error) showMessage(error.message);
}

function raw(id) { return document.getElementById(id).value; }
function cleanUsername(username) { return String(username || "").trim(); }
function isValidUsername(username) { return /^[A-Za-z0-9_.-]{3,24}$/.test(username); }
function isResetUrl() { return window.location.search.includes("reset-password=true") || window.location.hash.includes("access_token"); }
function siteUrl(path) { return new URL(path, window.location.href).toString(); }
function showMessage(message) { const el = document.getElementById("authMessage"); el.textContent = message; el.hidden = false; }
