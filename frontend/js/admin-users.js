/* Settings -> Users: the owner creates logins for other people (e.g. a delivery
 * boy) and chooses what each one can open, whether they can change things or
 * only look, and how many days of orders/sales they can see.
 * Everything here talks to /api/admin/users (owner only, enforced by the server). */

window.AdminUsers = (() => {
  const root = document.getElementById("usersRoot");
  const sheetRoot = document.getElementById("sheetRoot");
  if (!root) return { refresh() {} };

  // What can be granted. `levels` are the choices shown for that item.
  const ITEMS = [
    { key: "orders", ico: "📦", label: "Orders", levels: ["NONE", "VIEW", "EDIT"],
      note: "View & edit = can mark Delivered / Cancelled / Reopen" },
    { key: "payments", ico: "💳", label: "UPI payments", levels: ["VIEW", "EDIT"], def: "VIEW",
      note: "View = sees the payment screenshot and its status · View & edit = can also change the status (Verified, Rejected …)" },
    { key: "products", ico: "🍗", label: "Products", levels: ["NONE", "VIEW", "EDIT"] },
    { key: "banners", ico: "🖼️", label: "Banners", levels: ["NONE", "EDIT"] },
    { key: "sales", ico: "📊", label: "Sales", levels: ["NONE", "VIEW"] },
    { key: "customers", ico: "👥", label: "Customers", levels: ["NONE", "VIEW"],
      note: "Shows all-time data, so it needs “All time” below" },
    { key: "customize", ico: "🎨", label: "Customize", levels: ["NONE", "EDIT"] },
    { key: "store", ico: "🏪", label: "Store open / closed", levels: ["NONE", "VIEW", "EDIT"],
      note: "View & edit = can switch the store on/off and set hours" },
    { key: "backup", ico: "📧", label: "E-mail backup", levels: ["NONE", "EDIT"] },
    { key: "promotions", ico: "📣", label: "Push notifications", levels: ["NONE", "VIEW", "EDIT"],
      note: "View = sees the page and history · View & edit = can write and send to customers" },
  ];
  const LEVEL_TEXT = { NONE: "No access", VIEW: "View only", EDIT: "View & edit" };
  // On items that only have one "yes", say it plainly.
  const YES_TEXT = { banners: "Allowed", sales: "Allowed", customers: "Allowed", customize: "Allowed", backup: "Allowed" };
  const DAY_CHOICES = [[0, "All time"], [1, "Today only"], [3, "Last 3 days"], [7, "Last 7 days"],
    [15, "Last 15 days"], [30, "Last 30 days"], [90, "Last 90 days"]];

  const PRESETS = {
    delivery: { name: "Delivery boy", days: 7, perms: { orders: "EDIT", payments: "VIEW" } },
    manager: { name: "Manager", days: 0, perms: { orders: "EDIT", payments: "EDIT", products: "EDIT", banners: "EDIT", sales: "VIEW", customers: "VIEW", store: "EDIT" } },
  };

  let users = null;
  let loadedAt = 0;
  let loading = false;
  const STALE_MS = 10 * 60 * 1000;   // the list is re-read at most this often when you reopen the page

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));

  const levelText = (key, lvl) => (lvl === "EDIT" || lvl === "VIEW") && YES_TEXT[key] ? YES_TEXT[key] : LEVEL_TEXT[lvl];
  const daysText = (d) => (DAY_CHOICES.find((c) => c[0] === d) || [0, d + " days"])[1];

  // ---- list -------------------------------------------------------------
  async function refresh(force) {
    if (loading) return;
    if (users && !force && Date.now() - loadedAt < STALE_MS) { paint(); return; }
    loading = true;
    if (!users) root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;
    try {
      users = await Api.get("/api/admin/users");
    } catch (e) {
      root.innerHTML = `<div class="empty-state"><p>${esc(e.message || "Couldn't load users")}</p></div>`;
      loading = false;
      return;
    }
    loading = false;
    loadedAt = Date.now();
    paint();
  }

  const isOwner = () => !!(window.AdminAccess && AdminAccess.isOwner());
  const myUsername = () => (window.AdminAccess && AdminAccess.get().username) || "";

  function paint() {
    const head = `
      <div class="us-head">
        <div>
          <h2 class="us-title">Users &amp; access</h2>
          <p class="us-sub">Give someone their own login and choose what they can open.</p>
        </div>
        <button type="button" class="btn btn-gold btn-sm" data-act="add">+ Add user</button>
      </div>`;
    if (!users || users.length === 0) {
      root.innerHTML = head + `<div class="empty-state"><p>No users yet. Tap “+ Add user” to create a login, for example for a delivery boy.</p></div>`;
      return;
    }
    root.innerHTML = head + users.map(card).join("");
  }

  function card(u) {
    const isAdminUser = u.role === "ADMIN";
    const me = u.username === myUsername();
    const chips = isAdminUser
      ? `<span class="us-chip us-chip-admin">👑 Admin · full access, can manage staff</span>`
      : Object.entries(u.permissions || {})
      .filter(([k, lvl]) => lvl !== "NONE" && (k !== "payments" || lvl === "EDIT"))
      .map(([k, lvl]) => {
        const item = ITEMS.find((i) => i.key === k);
        return item ? `<span class="us-chip">${item.ico} ${esc(item.label)}${lvl === "VIEW" && item.levels.includes("EDIT") ? " · view" : ""}</span>` : "";
      }).join("") || `<span class="us-chip us-chip-none">No access yet</span>`;
    // Only the owner can change an admin; nobody can switch off / delete their own login.
    const canAct = !me && (!isAdminUser || isOwner());
    const actions = !canAct ? "" : `
        <div class="us-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="edit">✏️ Access</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="password">🔑 Password</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${u.enabled ? "⏸ Switch off" : "▶ Switch on"}</button>
          <button type="button" class="btn btn-ghost btn-sm us-danger" data-act="delete">🗑 Delete</button>
        </div>`;
    const last = u.lastLoginAt ? "Last login: " + Utils.formatDateTime(u.lastLoginAt) : "Never signed in";
    return `
      <div class="us-card ${u.enabled ? "" : "is-off"}" data-id="${u.id}">
        <div class="us-card-top">
          <div class="us-who">
            <strong>${esc(u.displayName)}</strong>
            <span class="us-user">@${esc(u.username)}${me ? " · you" : ""}</span>
          </div>
          <span class="us-badge ${u.enabled ? "on" : "off"}">${u.enabled ? "Active" : "Switched off"}</span>
        </div>
        <div class="us-chips">${chips}</div>
        <div class="us-meta">${isAdminUser ? "" : `Sees: <strong>${esc(daysText(u.dataDays))}</strong> of orders &amp; sales · `}${esc(last)}</div>${actions}
      </div>`;
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "add") { openForm(null); return; }
    const id = Number(btn.closest(".us-card")?.dataset.id);
    const u = (users || []).find((x) => x.id === id);
    if (!u) return;
    if (act === "edit") openForm(u);
    else if (act === "password") openPassword(u);
    else if (act === "toggle") toggleEnabled(u, btn);
    else if (act === "delete") openDelete(u);
  });

  // ---- add / edit form ------------------------------------------------------
  function radioGroup(item, current) {
    const opts = item.levels.map((lvl) => `
      <label class="us-opt">
        <input type="radio" name="perm-${item.key}" value="${lvl}" ${current === lvl ? "checked" : ""} />
        <span>${esc(levelText(item.key, lvl))}</span>
      </label>`).join("");
    return `
      <div class="us-perm" data-key="${item.key}">
        <div class="us-perm-label"><span aria-hidden="true">${item.ico}</span> ${esc(item.label)}
          ${item.note ? `<small>${esc(item.note)}</small>` : ""}</div>
        <div class="us-seg">${opts}</div>
      </div>`;
  }

  function openForm(u) {
    const isNew = !u;
    const perms = (u && u.permissions) || {};
    const wasAdmin = !!u && u.role === "ADMIN";
    const days = u && u.dataDays != null ? u.dataDays : 7;
    sheetRoot.innerHTML = `
      <div class="us-overlay" data-role="us-overlay">
        <div class="us-sheet" role="dialog" aria-modal="true" aria-label="${isNew ? "Add user" : "Edit access"}">
          <div class="us-sheet-head">
            <h3>${isNew ? "Add user" : "Access for " + esc(u.displayName)}</h3>
            <button type="button" class="us-x" data-role="us-close" aria-label="Close">✕</button>
          </div>
          <form id="usForm" autocomplete="off" novalidate>
            <div class="us-sheet-body">
              ${isOwner() ? `
              <div class="us-perm us-type">
                <div class="us-perm-label">Account type
                  <small>Staff = only what you tick below. Admin = full access and can add staff logins.${wasAdmin ? " Choose Staff to reduce this admin's access." : ""}</small></div>
                <div class="us-seg">
                  <label class="us-opt"><input type="radio" name="role" value="STAFF" ${wasAdmin ? "" : "checked"} /><span>Staff</span></label>
                  <label class="us-opt"><input type="radio" name="role" value="ADMIN" ${wasAdmin ? "checked" : ""} /><span>Admin</span></label>
                </div>
              </div>` : ""}
              ${isNew ? `
              <div class="us-presets us-staff-only">
                <span>Quick start:</span>
                <button type="button" class="us-preset" data-preset="delivery">🛵 Delivery boy</button>
                <button type="button" class="us-preset" data-preset="manager">🧑‍💼 Manager</button>
              </div>` : ""}
              <label class="us-field">Name
                <input type="text" name="displayName" maxlength="80" placeholder="e.g. Kalam" value="${esc(u ? u.displayName : "")}" />
              </label>
              ${isNew ? `
              <label class="us-field">Username
                <input type="text" name="username" maxlength="30" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. kalam" />
                <small>3–30 letters, numbers, dot, dash or underscore. They sign in with this.</small>
              </label>
              <label class="us-field">Password
                <span class="us-pw">
                  <input type="text" name="password" maxlength="100" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder="at least 6 characters" />
                  <button type="button" class="btn btn-ghost btn-sm" data-role="us-suggest">Suggest</button>
                </span>
              </label>` : `<div class="us-fixed">Username: <strong>@${esc(u.username)}</strong></div>`}

              <div class="us-staff-only" ${wasAdmin ? "hidden" : ""}>
              <h4 class="us-h">What can they open?</h4>
              ${ITEMS.map((i) => radioGroup(i, levelOf(i, perms[i.key]))).join("")}

              <h4 class="us-h">How much data can they see?</h4>
              <label class="us-field">
                <select name="dataDays">
                  ${DAY_CHOICES.map(([d, t]) => `<option value="${d}" ${d === days ? "selected" : ""}>${esc(t)}</option>`).join("")}
                </select>
                <small>Applies to Orders and Sales. Older orders are hidden from them completely.</small>
              </label>
              </div>
              <p class="us-error" id="usError" hidden></p>
            </div>
            <div class="us-sheet-foot">
              <button type="button" class="btn btn-ghost" data-role="us-close">Cancel</button>
              <button type="submit" class="btn btn-gold" id="usSave">${isNew ? "Create user" : "Save changes"}</button>
            </div>
          </form>
        </div>
      </div>`;
    const form = document.getElementById("usForm");
    syncCustomers(form);

    form.addEventListener("change", () => {
      syncCustomers(form);
      const adminPicked = form.querySelector('input[name="role"]:checked')?.value === "ADMIN";
      form.querySelectorAll(".us-staff-only").forEach((el) => { el.hidden = adminPicked; });
      const nameBox = form.elements.displayName;
      if (nameBox) nameBox.placeholder = adminPicked ? "e.g. Kalam (admin)" : "e.g. Kalam"; // the hint follows the account type
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); submitForm(form, u); });
    sheetRoot.querySelector('[data-role="us-suggest"]')?.addEventListener("click", () => {
      form.elements.password.value = suggestPassword();
    });
    sheetRoot.querySelectorAll("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => applyPreset(form, PRESETS[b.dataset.preset])));
    focusFirst(form);
  }

  /** "Customers" shows everyone ever, so it can't be combined with a day limit. */
  function syncCustomers(form) {
    const limited = Number(form.elements.dataDays.value) > 0;
    const group = form.querySelector('.us-perm[data-key="customers"]');
    if (!group) return;
    group.classList.toggle("is-disabled", limited);
    group.querySelectorAll("input").forEach((i) => { i.disabled = limited; });
    if (limited) {
      const none = group.querySelector('input[value="NONE"]');
      if (none) none.checked = true;
    }
  }

  function applyPreset(form, preset) {
    if (!preset) return;
    if (!form.elements.displayName.value.trim()) form.elements.displayName.value = preset.name;
    ITEMS.forEach((i) => {
      const lvl = preset.perms[i.key] || i.def || "NONE";
      const r = form.querySelector(`input[name="perm-${i.key}"][value="${lvl}"]`);
      if (r) r.checked = true;
    });
    form.elements.dataDays.value = String(preset.days);
    syncCustomers(form);
  }

  /** A saved level as the form shows it: an item with a default (UPI payments) is never "No access". */
  const levelOf = (item, stored) => (stored && stored !== "NONE" ? stored : item.def || "NONE");

  /** Whether any real access is ticked ("UPI payments" is always at least View, so it says nothing by itself). */
  const hasAnyAccess = (perms) => Object.entries(perms).some(([k, v]) => k !== "payments" && v !== "NONE");

  function readPerms(form) {
    const perms = {};
    ITEMS.forEach((i) => {
      const r = form.querySelector(`input[name="perm-${i.key}"]:checked`);
      perms[i.key] = r ? r.value : i.def || "NONE";
    });
    return perms;
  }

  function showError(msg) {
    const el = document.getElementById("usError");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function submitForm(form, u) {
    showError("");
    const name = form.elements.displayName.value.trim();
    const days = Number(form.elements.dataDays.value);
    const perms = readPerms(form);
    const role = form.querySelector('input[name="role"]:checked')?.value === "ADMIN" ? "ADMIN" : "STAFF";

    if (!u) {
      // ---- create: the whole thing is needed, and the answer carries the new id/dates ----
      const body = { displayName: name, username: form.elements.username.value.trim(), password: form.elements.password.value, role };
      if (!body.username) return showError("Enter a username");
      if (!body.password || body.password.length < 6) return showError("Password must be at least 6 characters");
      if (role === "STAFF") {
        body.permissions = perms;
        body.dataDays = days;
        if (!hasAnyAccess(perms) && !confirmNoAccess()) return;
      }
      return send(null, () => Api.post("/api/admin/users", body), (created) => { users = users || []; users.push(created); });
    }

    // ---- edit: send ONLY what changed ----
    const patch = {};
    if (name && name !== u.displayName) patch.displayName = name;
    const wasAdmin = u.role === "ADMIN";
    const radio = form.querySelector('input[name="role"]:checked');   // only the owner sees this
    const newRole = radio ? radio.value : u.role;
    if (newRole !== u.role) patch.role = newRole;
    if (newRole === "STAFF") {                   // an admin has no ticked access / day limit to send
      const have = u.permissions || {};
      const changedPerms = {};
      ITEMS.forEach((i) => { if (levelOf(i, have[i.key]) !== perms[i.key]) changedPerms[i.key] = perms[i.key]; });
      if (Object.keys(changedPerms).length) patch.permissions = changedPerms;
      if (days !== u.dataDays) patch.dataDays = days;
      if ((patch.permissions || wasAdmin) && !hasAnyAccess(perms) && !confirmNoAccess()) return;
    } else if (!wasAdmin && !window.confirm(`Make ${u.displayName} an admin? They will get full access and can create staff logins.`)) {
      return;
    }
    if (!Object.keys(patch).length) {            // nothing changed -> no request at all
      closeSheet();
      Toast.show("No changes", "success");
      return;
    }
    return send(u, () => Api.patch(`/api/admin/users/${u.id}`, patch), (changed) => applyChange(u, changed));
  }

  /** Runs one save, shows the busy state, and patches our own copy from the (small) reply. */
  async function send(u, call, apply) {
    const save = document.getElementById("usSave");
    save.disabled = true;
    save.innerHTML = `<span class="spinner"></span> Saving...`;
    try {
      apply(await call());
      closeSheet();
      Toast.show(u ? "Saved" : "User created", "success");
      paint();                                     // redraw from what we already hold — no list re-read
    } catch (err) {
      showError(err.message || "Couldn't save");
      save.disabled = false;
      save.textContent = u ? "Save changes" : "Create user";
    }
  }

  /** Merges the fields the server confirmed (id + only what we changed) into the user we hold. */
  function applyChange(u, changed) {
    if (!changed) return;
    Object.keys(changed).forEach((k) => {
      if (k === "id") return;
      if (k === "permissions") u.permissions = Object.assign({}, u.permissions, changed.permissions);
      else u[k] = changed[k];
    });
    if (u.role === "ADMIN") { delete u.permissions; delete u.dataDays; }   // an admin has neither
  }

  function confirmNoAccess() {
    return window.confirm("No access is ticked, so this person won't be able to open anything. Save anyway?");
  }

  // ---- other actions ----------------------------------------------------------
  function openPassword(u) {
    sheetRoot.innerHTML = `
      <div class="us-overlay" data-role="us-overlay">
        <div class="us-sheet us-sheet-small" role="dialog" aria-modal="true" aria-label="Reset password">
          <div class="us-sheet-head">
            <h3>New password for ${esc(u.displayName)}</h3>
            <button type="button" class="us-x" data-role="us-close" aria-label="Close">✕</button>
          </div>
          <form id="usPwForm" autocomplete="off" novalidate>
            <div class="us-sheet-body">
              <label class="us-field">New password
                <span class="us-pw">
                  <input type="text" name="password" maxlength="100" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder="at least 6 characters" />
                  <button type="button" class="btn btn-ghost btn-sm" data-role="us-suggest">Suggest</button>
                </span>
                <small>They will be signed out on every device and must sign in with this.</small>
              </label>
              <p class="us-error" id="usError" hidden></p>
            </div>
            <div class="us-sheet-foot">
              <button type="button" class="btn btn-ghost" data-role="us-close">Cancel</button>
              <button type="submit" class="btn btn-gold" id="usSave">Set password</button>
            </div>
          </form>
        </div>
      </div>`;
    const form = document.getElementById("usPwForm");
    sheetRoot.querySelector('[data-role="us-suggest"]').addEventListener("click", () => {
      form.elements.password.value = suggestPassword();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("");
      const pw = form.elements.password.value;
      if (!pw || pw.length < 6) return showError("Password must be at least 6 characters");
      const save = document.getElementById("usSave");
      save.disabled = true;
      try {
        await Api.post(`/api/admin/users/${u.id}/password`, { password: pw });
        closeSheet();
        Toast.show("Password changed", "success");
      } catch (err) {
        showError(err.message || "Couldn't change the password");
        save.disabled = false;
      }
    });
    focusFirst(form);
  }

  async function toggleEnabled(u, btn) {
    btn.disabled = true;
    try {
      const wasOn = u.enabled;
      applyChange(u, await Api.patch(`/api/admin/users/${u.id}`, { enabled: !u.enabled }));   // sends 1 field, gets 2 back
      Toast.show(wasOn ? "Switched off — signed out everywhere" : "Switched on", "success");
      paint();
    } catch (err) {
      Toast.show(err.message, "error");
      btn.disabled = false;
    }
  }

  function openDelete(u) {
    sheetRoot.innerHTML = `
      <div class="us-overlay" data-role="us-overlay">
        <div class="us-sheet us-sheet-small" role="dialog" aria-modal="true" aria-label="Delete user">
          <div class="us-sheet-head">
            <h3>Delete ${esc(u.displayName)}?</h3>
            <button type="button" class="us-x" data-role="us-close" aria-label="Close">✕</button>
          </div>
          <div class="us-sheet-body">
            <p>@${esc(u.username)} will be removed and signed out. This can't be undone. (Tip: “Switch off” keeps the login but blocks it.)</p>
          </div>
          <div class="us-sheet-foot">
            <button type="button" class="btn btn-ghost" data-role="us-close">Cancel</button>
            <button type="button" class="btn btn-danger" id="usDeleteGo">Delete</button>
          </div>
        </div>
      </div>`;
    document.getElementById("usDeleteGo").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        await Api.del(`/api/admin/users/${u.id}`);
        users = (users || []).filter((x) => x.id !== u.id);
        closeSheet();
        Toast.show("User deleted", "success");
        paint();
      } catch (err) {
        Toast.show(err.message, "error");
        e.target.disabled = false;
      }
    });
  }

  // ---- small helpers ------------------------------------------------------------
  function suggestPassword() {
    const letters = "abcdefghjkmnpqrstuvwxyz";   // no look-alikes (i, l, o)
    const digits = "23456789";
    const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
    let out = "";
    for (let i = 0; i < 5; i++) out += pick(letters);
    for (let i = 0; i < 3; i++) out += pick(digits);
    return out;
  }

  function focusFirst(form) {
    const el = form.querySelector("input[type=text]:not([disabled])");
    if (el) setTimeout(() => el.focus({ preventScroll: true }), 50);
  }

  function closeSheet() {
    if (sheetRoot.querySelector(".us-overlay")) sheetRoot.innerHTML = "";
  }

  sheetRoot.addEventListener("click", (e) => {
    if (!sheetRoot.querySelector(".us-overlay")) return;
    if (e.target.closest('[data-role="us-close"]') || e.target.dataset.role === "us-overlay") closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
  });

  // A different person signing in must never see the previous list.
  document.addEventListener("freshcutz:logout", () => {
    users = null;
    loadedAt = 0;
    root.innerHTML = "";
    closeSheet();
  });

  return { refresh };
})();
