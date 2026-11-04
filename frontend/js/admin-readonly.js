/* "View only" screens (Settings -> Users & access).
 *
 * When a login has View (but not View & edit) on Banners, Customize, E-mail backup or Delivery map, its screen still
 * opens, but nothing on it can be changed: fields are greyed out and the buttons that change something are hidden
 * (css/admin-users.css) or ignored here. Hiding is only for looks - the server refuses every change from a View-only
 * login anyway (AdminAccessPolicy).
 *
 * Costs nothing for the owner / admins: nothing is watched and every listener returns at once. Only a login that really
 * has a read-only screen is watched, and then only the parts of the screen that are (re)built are looked at.
 *
 * To undo: remove this file, its <script> line in admin.html and the "view only screens" block in css/admin-users.css. */

(() => {
  // The three screens, and which access key rules each. The E-mail backup card inside Customize follows "backup".
  const SCREENS = [
    { key: "customize", id: "view-customize" },
    { key: "banners", id: "view-banners" },
    { key: "map", id: "view-map" },
  ];
  // Things that only look or move around stay usable on a read-only screen.
  const KEEP = [
    "summary", "a", ".settings-back", ".cz-tpl-tab", ".nm-pick",
    '[data-action="live-size"]', '[data-action="splash-play"]', '[data-action="msg-show"]',
    '[data-action="retry-load"]', '[data-action="reload-design"]', '[data-action="tpl-pick"]',
    '[data-action^="goto-"]', '[data-action="mel-toggle"]',
    '[data-bn="retry"]', '[data-bn="reload"]', '[data-asp="retry"]', '[data-aro="retry"]',
  ].join(",");
  const CONTROLS = "button, .btn, label.file-btn, [role='button'], [data-action], [data-bn], [data-asp], [data-aro], [data-a]";
  const FIELDS = "input, select, textarea";

  const AA = () => window.AdminAccess;
  const isRO = (key) => document.body.classList.contains("ro-" + key) || document.body.classList.contains("no-" + key);

  let on = false;        // does this login have any read-only screen? (false for the owner / admins -> nothing below runs)
  let touched = false;   // did we grey out anything that must be freed again?
  const locked = {};     // key -> true while that key is read-only

  const mount = () => document.getElementById("czBackupMount");
  /** The access key that rules a field / button: the backup card inside Customize follows "backup". */
  const keyFor = (el, screenKey) => {
    if (screenKey === "customize") { const m = mount(); if (m && m.contains(el)) return "backup"; }
    return screenKey;
  };

  /** Greys out (or frees again) the fields inside `node` (a whole screen, or just a part that was built). */
  function lockFields(node, screenKey) {
    const fields = node.matches && node.matches(FIELDS) ? [node] : node.querySelectorAll ? node.querySelectorAll(FIELDS) : [];
    for (const f of fields) {
      if (locked[keyFor(f, screenKey)]) {
        if (!f.disabled) { f.disabled = true; f.dataset.roDis = "1"; touched = true; }
      } else if (f.dataset.roDis) {
        f.disabled = false;
        delete f.dataset.roDis;
      }
    }
  }

  /** Sets data-ro (the CSS hooks) on the screens and on the backup card. */
  function mark() {
    SCREENS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      if (locked[s.key]) el.dataset.ro = s.key; else delete el.dataset.ro;
    });
    const m = mount();
    if (m) { if (locked.backup) m.dataset.ro = "backup"; else delete m.dataset.ro; }
  }

  // ---- watching what gets (re)built, only while something is read-only ---------------------
  let pending = new Set();
  let queued = false;
  const flush = () => {
    queued = false;
    const todo = pending; pending = new Set();
    if (!on && !touched) return;
    mark();
    todo.forEach((n) => {
      if (!n.isConnected) return;
      const s = SCREENS.find((x) => document.getElementById(x.id)?.contains(n));
      if (s) lockFields(n, s.key);
    });
  };
  const watcher = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") pending.add(r.target);            // a script switched a field back on
      else r.addedNodes.forEach((n) => { if (n.nodeType === 1) pending.add(n); });
    }
    if (!queued && pending.size) { queued = true; requestAnimationFrame(flush); }
  });
  const watch = (yes) => {
    watcher.disconnect();
    if (!yes) return;
    SCREENS.forEach((s) => { const el = document.getElementById(s.id); if (el) watcher.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] }); });
  };

  // ---- a button that would change something does nothing here, even if it is somehow reachable -----
  function stop(e) {
    if (!on) return;
    const c = e.target.closest && e.target.closest(CONTROLS);
    if (!c) return;
    const s = SCREENS.find((x) => document.getElementById(x.id)?.contains(c));
    if (!s || !locked[keyFor(c, s.key)] || c.matches(KEEP) || c.closest(KEEP)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  function listen() {
    SCREENS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      ["click", "dblclick", "submit", "pointerdown", "keydown"].forEach((t) => el.addEventListener(t, (e) => {
        if (t === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        stop(e);
      }, true));
    });
  }

  /** Access changed (sign-in, sign-out, the owner changed this login): decide again what is read-only. */
  function refresh() {
    const A = AA();
    const staff = !!A && !A.isAdmin();
    ["customize", "banners", "map", "backup"].forEach((k) => { locked[k] = staff && isRO(k); });
    on = Object.values(locked).some(Boolean);
    if (!on && !touched) { watch(false); return; }   // owner / admin: nothing to do at all
    watch(on);
    mark();
    SCREENS.forEach((s) => { const el = document.getElementById(s.id); if (el) lockFields(el, s.key); });
    if (!on) touched = false;                          // everything was freed again
  }

  listen();
  document.addEventListener("freshcutz:access", refresh);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh); else refresh();
})();
