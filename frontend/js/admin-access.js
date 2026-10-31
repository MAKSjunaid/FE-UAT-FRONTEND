/* Who is signed  in and what they may open.
 *
 * The owner sees everything. A staff login (made in Settings -> Users) only
 * sees the tabs / buttons the owner ticked. This file only HIDES things so the
 * screen matches the permissions — the server checks every request again, so
 * hiding is a convenience, never the lock itself.
 *
 * To undo the whole Users feature: restore the previous admin.html, admin-main.js,
 * admin-auth.js, admin-backup.js, admin-push.js, delete this file, admin-users.js
 * and css/admin-users.css. */

window.AdminAccess = (() => {
  const KEY = "freshcutz_admin_me";
  const KEYS = ["orders", "products", "banners", "sales", "customers", "customize", "store", "backup", "promotions", "payments"];
  const RANK = { NONE: 0, VIEW: 1, EDIT: 2 };

  function full() {
    const p = {};
    KEYS.forEach((k) => { p[k] = "EDIT"; });
    return { role: "ADMIN", owner: true, username: "", displayName: "Admin", permissions: p, dataDays: 0, at: 0 };
  }

  // Until we know better (an owner who signed in before this feature existed)
  // show everything; a staff login always has its saved copy below.
  let me = full();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.permissions) me = saved;
  } catch (e) { /* private mode etc. — keep the default */ }

  const level = (key) => RANK[(me.permissions || {})[key] || "NONE"] || 0;
  const isAdmin = () => me.role === "ADMIN";
  /** The one login from the server settings (can add other admins). */
  const isOwner = () => me.role === "ADMIN" && me.owner !== false;
  const can = (key, need) => isAdmin() || level(key) >= RANK[need || "VIEW"];

  /** Whether a screen may be opened at all. */
  function canOpen(view) {
    switch (view) {
      case "orders": return can("orders");
      case "products": return can("products");
      case "banners": return can("banners");
      case "stats": return can("sales");
      case "customers": return can("customers");
      case "customize": return can("customize") || can("backup");
      case "promotions": return can("promotions");
      case "users": return isAdmin();
      case "settings": return canOpen("customers") || canOpen("customize") || canOpen("promotions") || canOpen("users");
      default: return isAdmin();
    }
  }

  function firstView() {
    return ["orders", "products", "banners", "stats", "settings"].find(canOpen) || "orders";
  }

  function set(res) {
    if (!res || !res.permissions) return;
    me = {
      role: res.role || "STAFF",
      owner: !!res.owner,
      username: res.username || "",
      displayName: res.displayName || res.username || "",
      permissions: res.permissions,
      dataDays: res.dataDays || 0,
      soundOn: typeof res.soundOn === "boolean" ? res.soundOn : undefined, // the new-order sound switch saved for this login
      at: Date.now(),
    };
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* ignore */ }
    apply();
  }

  /** Remembers this login's new-order sound switch with the rest of "who is signed in" (admin-sound.js saves it on the server too). */
  function setSoundOn(on) {
    me.soundOn = !!on;
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (e) { /* ignore */ }
  }

  function clear() {
    me = full();
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    apply();
  }

  /** Hides the tabs/buttons this person can't use. */
  function apply() {
    document.querySelectorAll(".admin-tab[data-view]").forEach((t) => {
      t.classList.toggle("is-locked", !canOpen(t.dataset.view));
    });
    document.querySelectorAll(".settings-row[data-open-view]").forEach((r) => {
      r.classList.toggle("is-locked", !canOpen(r.dataset.openView));
    });
    KEYS.forEach((k) => {
      document.body.classList.toggle("no-" + k, !can(k, "VIEW"));
      document.body.classList.toggle("ro-" + k, can(k, "VIEW") && !can(k, "EDIT"));
    });
    document.body.classList.toggle("is-staff", !isAdmin());
    document.dispatchEvent(new CustomEvent("freshcutz:access"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }

  /** A staff login re-reads what it may open at most every 10 minutes (the server
   * enforces it on every request anyway, so this only keeps the screen tidy). */
  const needsRecheck = () => !isAdmin() && Date.now() - (me.at || 0) > 10 * 60 * 1000;

  return { set, setSoundOn, clear, can, canOpen, isAdmin, isOwner, needsRecheck, firstView, get: () => me };
})();
