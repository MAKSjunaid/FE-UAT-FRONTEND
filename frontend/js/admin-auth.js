/* Admin login/logout + gate that shows either the login screen or the app. */

const AdminAuth = (() => {
  const TOKEN_KEY = "freshcutz_admin_token";

  const loginScreen = document.getElementById("loginScreen");
  const adminApp = document.getElementById("adminApp");
  const loginForm = document.getElementById("loginForm");
  const loginBtn = document.getElementById("loginBtn");
  const loginError = document.getElementById("loginError");

  function hasToken() {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  function showLogin() {
    loginScreen.style.display = "flex";
    adminApp.hidden = true;
  }

  function showApp() {
    loginScreen.style.display = "none";
    adminApp.hidden = false;
  }

  let loggingOut = false;

  function logout(silent) {
    const token = localStorage.getItem(TOKEN_KEY);
    loggingOut = true;
    setTimeout(() => { loggingOut = false; }, 4000);
    localStorage.removeItem(TOKEN_KEY);
    if (window.AdminAccess) AdminAccess.clear();
    showLogin();
    if (token) {
      // Sent straight to the server WITH the token we just took out of storage.
      // (Going through Api.post here sent it without the token, the server
      // turned it down, and that failure looked like "could not reach the
      // server" and triggered a second sign-out message.) Fire-and-forget:
      // the admin is already signed out on this device either way.
      fetch(`${window.FRESHCUTZ_API_BASE || ""}/api/admin/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    document.dispatchEvent(new CustomEvent("freshcutz:logout"));
    if (!silent) {
      Toast.show("Logged out", "success");
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    loginError.textContent = "";
    const data = new FormData(loginForm);
    const username = data.get("username")?.trim();
    const password = data.get("password");

    loginBtn.disabled = true;
    loginBtn.innerHTML = `<span class="spinner"></span> Signing in...`;
    try {
      const res = await Api.post("/api/admin/auth/login", { username, password });
      localStorage.setItem(TOKEN_KEY, res.token);
      if (localStorage.getItem(TOKEN_KEY) !== res.token) {
        // this browser did not keep the sign-in (storage blocked or full): say so instead of failing later
        throw new Error("This browser could not keep your sign-in (its storage is blocked or full). Close the app completely and try again.");
      }
      if (window.AdminAccess) AdminAccess.set(res);   // tabs this login may open
      showApp();
      document.dispatchEvent(new CustomEvent("freshcutz:login"));
    } catch (err) {
      loginError.textContent = err.message || "Sign in failed";
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
    }
  }

  /** A small line under the sign-in form that says whether this phone keeps what the page saves from one launch to the next
   * (so a surprise sign-out can be told apart: the phone forgetting everything, or the page signing out). */
  function diagLine() {
    const el = document.getElementById("loginDiag");
    if (!el) return;
    let lsBoots = "n/a", cookieBoots = "n/a", ls = "blocked";
    try {
      const n = Number(window.localStorage.getItem("fc_boots") || 0) + 1;
      window.localStorage.setItem("fc_boots", String(n));
      lsBoots = n; ls = "ok";
    } catch (_) { /* blocked */ }
    try {
      const m = document.cookie.match(/(?:^|; )fc_boots_c=(\d+)/);
      const n = (m ? Number(m[1]) : 0) + 1;
      document.cookie = `fc_boots_c=${n}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      cookieBoots = n;
    } catch (_) { /* no cookies */ }
    const app = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    const base = `Check: opened ${lsBoots}x (cookie ${cookieBoots}x) · storage ${ls} · ${app ? "app" : "browser"} · signed-in copy ${hasToken() ? "found" : "none"}`;
    el.textContent = base;
    try {
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then((p) => { el.textContent = base + ` · kept-by-phone ${p ? "yes" : "no"}`; }).catch(() => {});
      }
    } catch (_) { /* not supported */ }
  }

  function init() {
    diagLine();
    loginForm.addEventListener("submit", handleLogin);
    document.getElementById("logoutBtn").addEventListener("click", () => logout(false));
    // Api.js dispatches this for ANY failed /api/admin request - a real
    // 401 (token expired/invalid - the backend's token store is
    // in-memory, see TokenStore.java, so a backend restart forgets
    // every session instantly) or the backend being flat-out
    // unreachable. Either way the admin app is not usable right now,
    // so both drop straight back to the login screen - same as
    // clearing the browser's stored data would - rather than leaving
    // a half-working screen full of raw error toasts.
    window.addEventListener("freshcutz:unauthorized", (ev) => {
      // already signed out (or signing out right now): nothing more to say
      if (loggingOut || adminApp.hidden) return;
      // which request the server turned down (so a surprise sign-out can be traced)
      const d = (ev && ev.detail) || {};
      const where = d.path ? ` [${d.method || "GET"} ${String(d.path).split("?")[0]}${d.hadToken === false ? ", sent without a login" : ""}]` : "";
      Toast.show("Your session expired — please sign in again" + where, "error", 9000);
      logout(true);
    });

    // A request went out without any login while the admin screen is showing and nothing is stored: show the sign-in screen again,
    // quietly (nobody was "signed out": there was nothing to sign out of). If a login IS stored, nothing happens.
    window.addEventListener("freshcutz:notsignedin", () => {
      if (loggingOut || adminApp.hidden || hasToken()) return;
      logout(true);
      if (loginError) loginError.textContent = "This phone lost your sign-in, so please sign in again.";
    });

    // The server could not be reached (and is not just rejecting us): stay
    // signed in, say so once in a while, and let the next request retry.
    let lastOfflineToast = 0;
    window.addEventListener("freshcutz:offline", () => {
      if (loggingOut || adminApp.hidden) return;
      const now = Date.now();
      if (now - lastOfflineToast < 30000) return;
      lastOfflineToast = now;
      Toast.show("Can't reach the server right now — you're still signed in, it will reconnect", "error");
    });

    if (hasToken()) {
      showApp();
      document.dispatchEvent(new CustomEvent("freshcutz:login"));
      // Re-read what this login may open (the owner may have changed it since).
      // Only staff logins need it, and only when their saved copy is over 10
      // minutes old (admins always have full access), so most page loads
      // make no extra request.
      if (window.AdminAccess && AdminAccess.needsRecheck()) {
        Api.get("/api/admin/auth/me").then((me) => AdminAccess.set(me)).catch(() => {});
      }
    } else {
      showLogin();
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  return { logout };
})();
