/* Thin fetch wrapper: builds URLs against FRESHCUTZ_API_BASE, attaches the
 * admin token when present, and turns non-2xx responses into thrown errors
 * with the server's message. */

/* The phone's own storage can lose what it was given (seen on an iPhone home-screen app: signed in, then "logged out" a moment later,
 * the name still showing but the menus asking to sign in). The few items that ARE the sign-in - the admin login, the customer's saved
 * number and name - are therefore also kept in a small cookie of this site, and read back from it whenever the storage has lost them.
 * Removing one removes both, so signing out still signs out. */
(() => {
  const KEYS = ["freshcutz_admin_token", "freshcutz_admin_me", "freshcutz_profile_phone", "freshcutz_profile_name"];
  let ls;
  try { ls = window.localStorage; } catch (_) { return; }
  if (!ls || typeof Storage === "undefined") return;
  const proto = Storage.prototype;
  const rawGet = proto.getItem, rawSet = proto.setItem, rawRemove = proto.removeItem;
  const cookieName = (k) => "fc_" + k.replace(/^freshcutz_/, "");
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const writeCookie = (k, v) => { try { document.cookie = `${cookieName(k)}=${encodeURIComponent(v)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`; } catch (_) { /* no cookies */ } };
  const dropCookie = (k) => { try { document.cookie = `${cookieName(k)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`; } catch (_) { /* no cookies */ } };
  const readCookie = (k) => {
    try {
      const m = document.cookie.split("; ").find((c) => c.indexOf(cookieName(k) + "=") === 0);
      return m ? decodeURIComponent(m.slice(cookieName(k).length + 1)) : null;
    } catch (_) { return null; }
  };
  const mine = (self, k) => self === ls && KEYS.indexOf(k) >= 0;
  proto.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (mine(this, k)) writeCookie(k, String(v));
  };
  proto.removeItem = function (k) {
    rawRemove.call(this, k);
    if (mine(this, k)) dropCookie(k);
  };
  proto.getItem = function (k) {
    const v = rawGet.call(this, k);
    if (v == null && mine(this, k)) {
      const c = readCookie(k);
      if (c != null) {
        try { rawSet.call(this, k, c); } catch (_) { /* storage full / blocked: the cookie value is still returned */ }
        return c;
      }
    }
    return v;
  };
  // an item the storage still has but the cookie lacks (set before this ran): copied once
  KEYS.forEach((k) => { const v = rawGet.call(ls, k); if (v != null && readCookie(k) == null) writeCookie(k, v); });
})();

/* Ask the phone to treat this site's saved data as "keep" (persistent storage): without it an iPhone may erase what a home-screen app
 * saved (the sign-in) when it is short of space or after the app has been closed for a while. Nothing is shown to the user. */
try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
} catch (_) { /* not supported: nothing to do */ }

const Api = (() => {
  function base() {
    return window.FRESHCUTZ_API_BASE || "";
  }

  function adminToken() {
    return localStorage.getItem("freshcutz_admin_token");
  }

  // True once the page is being refreshed / closed. Requests still in flight
  // are cancelled by the browser at that moment and fail like a network error —
  // that must never be mistaken for "the server is unreachable".
  let unloading = false;
  window.addEventListener("pagehide", () => { unloading = true; });
  window.addEventListener("beforeunload", () => { unloading = true; });
  window.addEventListener("pageshow", () => { unloading = false; });

  // One shared, short "is the server up?" check, used when an admin request
  // fails without any HTTP answer. Any HTTP reply at all (even an error) means
  // the server is up.
  let probe = null;
  function backendReachable() {
    if (!probe) {
      probe = (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        try {
          await fetch(`${base()}/api/store/status`, { cache: "no-store", signal: ctrl.signal });
          return true;
        } catch (_) {
          return false;
        } finally {
          clearTimeout(timer);
        }
      })();
      probe.finally(() => setTimeout(() => { probe = null; }, 2000));
    }
    return probe;
  }

  /** fetch(); a reading request that fails with no answer at all is tried once more after a moment (right after the app was
   * minimized and reopened the connection is often not back yet). Saving requests are never repeated. */
  async function fetchWithRetry(url, init, canRetry) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (!canRetry || unloading) throw err;
      await new Promise((r) => setTimeout(r, 900));
      if (unloading) throw err;
      return fetch(url, init);
    }
  }

  async function request(method, path, body, isMultipart = false) {
    const headers = {};
    const token = adminToken();
    if (path.startsWith("/api/admin") && token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let payload;
    if (isMultipart) {
      payload = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const isAdminPath = path.startsWith("/api/admin");
    const isLoginPath = path.endsWith("/auth/login");

    let response;
    try {
      response = await fetchWithRetry(`${base()}${path}`, { method, headers, body: payload }, method === "GET");
    } catch (networkErr) {
      // No HTTP answer at all. That is NOT a rejected login: the page was refreshed (the browser cancels what is in flight),
      // the phone paused the page while the app was minimized and the connection is still coming back, the server is waking up or
      // being redeployed, or the network dropped for a moment. None of these may sign the admin out - only the server saying
      // "401, not signed in" does (handled below, the server's 401 carries CORS headers, so the page can read it).
      if (unloading) {
        throw new Error("Request cancelled");
      }
      if (isAdminPath && !isLoginPath) {
        if (!(await backendReachable())) {
          if (!unloading) window.dispatchEvent(new CustomEvent("freshcutz:offline"));
          throw new Error("Could not reach the FreshCutz server. Check your internet connection or that the backend is running.");
        }
        // the server is there, this one request just got cut off: keep the login, nothing to report but a retry
        throw new Error("The connection was interrupted for a moment — please try again.");
      }
      throw new Error(
        "Could not reach the FreshCutz server. Check your internet connection or that the backend is running."
      );
    }

    if (response.status === 401 && isAdminPath) {
      // A late "401" for a request that was sent BEFORE the latest sign-in (with an old or no token) says nothing about the new
      // login: it must not take the fresh token away and sign the admin straight back out (seen on a home-screen app that still
      // held an old token: "session expired" right after Sign In).
      // ... and a "401" for a request that carried NO login at all says nothing about the session either (it was simply not
      // signed in): it never signs anybody out.
      const stale = !isLoginPath && (!token || adminToken() !== token);
      if (stale && !isLoginPath && !token) {
        // not signed in right now: if the admin screen is showing anyway, the page puts the sign-in screen back (quietly)
        window.dispatchEvent(new CustomEvent("freshcutz:notsignedin"));
      }
      if (!stale) {
        localStorage.removeItem("freshcutz_admin_token");
        if (!isLoginPath) {
          window.dispatchEvent(new CustomEvent("freshcutz:unauthorized", { detail: { reason: "expired", path, method, hadToken: !!token } }));
        }
      }
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;

    if (!response.ok) {
      const message = (data && (data.message || (data.details || []).join(", "))) || "Something went wrong";
      throw new Error(message);
    }
    return data;
  }

  /** Downloads a file response (e.g. the orders .xlsx export) as a Blob,
   * carrying the admin token the same way `request` does — a plain <a>
   * link can't attach an Authorization header, so this uses fetch instead. */
  async function downloadBlob(path) {
    const headers = {};
    const token = adminToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${base()}${path}`, { headers });
    if (!response.ok) {
      let message = "Could not download the file";
      try {
        const data = await response.json();
        message = data.message || message;
      } catch (_) {
        /* response wasn't JSON — keep the default message */
      }
      throw new Error(message);
    }
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: await response.blob(), filename: match ? match[1] : "download.xlsx" };
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    patch: (path, body) => request("PATCH", path, body ?? {}),
    del: (path) => request("DELETE", path),
    upload: (path, formData) => request("POST", path, formData, true),
    downloadBlob,
    // For building an EventSource URL (EventSource has no fetch-style
    // wrapper of its own to go through request() above) against the same
    // FRESHCUTZ_API_BASE every other call uses.
    streamUrl: (path) => `${base()}${path}`,
  };
})();
