/* Customize -> "Customer notifications": the notification a customer gets on their phone when an order changes
 * status. Sits right after "Cart & checkout" (admin-customize.js leaves an empty #orderMsgRoot there and
 * announces "freshcutz:customize-built"). Each status is one tap-to-expand row "Order status: Delivered" with its
 * own On/Off switch, wording and a 🗑 delete; "＋ New" adds back a status that is not in the list.
 * {name} = customer's first name, {code} = order number (both optional).
 * Talks to /api/admin/site/notification-messages. */

window.AdminOrderMessages = (() => {
  const Kit = window.AdminNotifyKit;
  if (!Kit) return { refresh() {} };
  const SAMPLE_NAME = "Kalam";
  const SAMPLE_CODE = "FC-20261025-007";

  // last answer: {types:[{key,label,ico,enabled,title,body,defaultTitle,defaultBody}], catalog:[{key,label,...,active}], maxTitle, maxBody}
  let server = null;
  let loadedAt = 0;
  let loading = false;
  let wasOpen = false;
  const lastField = {};  // per status: the field (title / message) that was touched last

  const host = () => document.getElementById("orderMsgRoot");
  const allowed = () => !window.AdminAccess || AdminAccess.can("customize", "EDIT");
  const rowsBox = () => host().querySelector("[data-rows]");
  const row = (key) => rowsBox().querySelector(`[data-group="${key}"]`);
  const shownKeys = () => [...rowsBox().querySelectorAll("[data-group]")].map((r) => r.dataset.group);
  const catalogItem = (key) => server.catalog.find((c) => c.key === key);

  function values(key) {
    const r = row(key);
    return {
      enabled: r.querySelector("[data-enabled]").checked,
      title: r.querySelector('[data-f="title"]').value,
      body: r.querySelector('[data-f="body"]').value,
    };
  }

  function isDirty() {
    if (!server || !host() || !host().querySelector("[data-rows]")) return false;
    const shown = shownKeys();
    const saved = server.types.map((t) => t.key);
    if (shown.length !== saved.length || shown.some((k) => !saved.includes(k))) return true;
    return server.types.some((t) => {
      const v = values(t.key);
      return v.enabled !== t.enabled || v.title.trim() !== t.title || v.body.trim() !== t.body;
    });
  }

  function rowHtml(c, open) {
    return `
      <details class="nm-row" data-group="${Kit.esc(c.key)}" ${open ? "open" : ""}>
        <summary>
          <span class="nm-rname">Order status: <b>${Kit.esc(c.label)}</b></span>
          <span class="nm-offtag" data-offtag hidden>Off</span>
          <button type="button" class="nm-del" data-del aria-label="Delete ${Kit.esc(c.label)} notification">🗑</button>
        </summary>
        <div class="nm-rbody">
          <div class="nm-bhead">
            <span class="nm-bname">Send this notification</span>
            <label class="nm-on"><span data-onlabel>On</span>
              <span class="switch"><input type="checkbox" data-enabled /><span class="track"></span></span>
            </label>
          </div>
          <div data-edit>
            <label class="nm-field">Title
              <input type="text" data-f="title" maxlength="${server.maxTitle}" autocomplete="off" />
            </label>
            <label class="nm-field">Message
              <textarea data-f="body" rows="2" maxlength="${server.maxBody}"></textarea>
            </label>
            <div class="nk-tools nm-tools">
              <button type="button" class="nm-chip" data-nk-emoji>😀 Emoji</button>
              <button type="button" class="nm-chip" data-ins="{name}">＋ Name</button>
              <button type="button" class="nm-chip" data-ins="{code}">＋ Order ID</button>
              <button type="button" class="nm-chip nm-reset" data-reset>↺ Reset</button>
              ${Kit.paletteHtml()}
            </div>
            <div class="nm-preview" data-preview></div>
          </div>
        </div>
      </details>`;
  }

  /** put one status's values into its row (v = {enabled,title,body}) */
  function fillRow(key, v) {
    const r = row(key);
    r.querySelector("[data-enabled]").checked = v.enabled;
    r.querySelector('[data-f="title"]').value = v.title;
    r.querySelector('[data-f="body"]').value = v.body;
    lastField[key] = null;
    paintRow(key);
  }

  /** (re)draw all rows from the server's answer; keeps rows open that were open */
  function renderRows(openKeys) {
    rowsBox().innerHTML = server.types.map((t) => rowHtml(t, openKeys.includes(t.key))).join("");
    server.types.forEach((t) => fillRow(t.key, t));
    paintAdd();
    paintSave();
  }

  function build() {
    const h = host();
    h.innerHTML = `
      <details class="cz-card" ${wasOpen ? "open" : ""}>
        <summary><h3>Customer notifications</h3></summary>
        <div class="cz-card-body">
          <div class="nm-rows" data-rows></div>
          <div class="nm-add">
            <button type="button" class="nm-chip nm-new" data-add aria-expanded="false">＋ New</button>
            <div class="nm-picker" data-picker hidden></div>
          </div>
          <div class="nm-foot">
            <button type="button" class="btn btn-gold" data-save disabled>Save</button>
            <span class="nm-status" data-status aria-live="polite"></span>
          </div>
        </div>
      </details>`;
    Kit.wirePalettes(h, (wrap) => {
      const key = wrap.closest("[data-group]").dataset.group;
      return lastField[key] || row(key).querySelector('[data-f="body"]');
    });
    renderRows([]);
  }

  function paintRow(key) {
    const r = row(key);
    const on = r.querySelector("[data-enabled]").checked;
    r.querySelector("[data-onlabel]").textContent = on ? "On" : "Off";
    r.querySelector("[data-offtag]").hidden = on;
    r.querySelector("[data-edit]").classList.toggle("nm-dim", !on);
    const t = r.querySelector('[data-f="title"]').value;
    const m = r.querySelector('[data-f="body"]').value;
    r.querySelector("[data-preview]").innerHTML =
      Kit.previewHtml(Kit.fill(t, SAMPLE_NAME, SAMPLE_CODE), Kit.fill(m, SAMPLE_NAME, SAMPLE_CODE));
  }

  function paintSave() {
    const dirty = isDirty();
    host().querySelector("[data-save]").disabled = !dirty;
    if (dirty) host().querySelector("[data-status]").textContent = "";
  }

  /** the "＋ New" list: every order status that is not in the list right now */
  function paintAdd() {
    const shown = shownKeys();
    const left = server.catalog.filter((c) => !shown.includes(c.key));
    const picker = host().querySelector("[data-picker]");
    picker.innerHTML = left.length
      ? `<div class="nm-ptitle">Pick an order status</div>` + left.map((c) =>
          `<button type="button" class="nm-pick" data-pick="${Kit.esc(c.key)}">${Kit.esc(c.label)}</button>`).join("")
      : `<div class="nm-ptitle">All order statuses are already in the list.</div>`;
  }

  function addRow(key) {
    const c = catalogItem(key);
    if (!c || row(key)) return;
    const was = server.types.find((t) => t.key === key); // deleted in this session before saving: bring its wording back
    rowsBox().insertAdjacentHTML("beforeend", rowHtml(c, true));
    fillRow(key, was || { enabled: true, title: c.defaultTitle, body: c.defaultBody });
    const r = row(key);
    r.scrollIntoView({ block: "nearest", behavior: "smooth" });
    paintAdd();
    paintSave();
  }

  // The host is rebuilt whenever Customize is built, so listen once on the document.
  const inside = (e) => e.target.closest && e.target.closest("#orderMsgRoot");

  document.addEventListener("focusin", (e) => {
    if (!inside(e)) return;
    const f = e.target.closest("[data-f]");
    const r = e.target.closest("[data-group]");
    if (f && r) lastField[r.dataset.group] = f;
  });
  document.addEventListener("input", (e) => {
    if (!inside(e)) return;
    const r = e.target.closest("[data-group]");
    if (!r || !e.target.closest("[data-f]")) return;
    paintRow(r.dataset.group);
    paintSave();
  });
  document.addEventListener("change", (e) => {
    if (!inside(e)) return;
    const r = e.target.closest("[data-group]");
    if (r && e.target.matches("[data-enabled]")) { paintRow(r.dataset.group); paintSave(); }
  });
  // <details> "toggle" doesn't bubble: capture it, only to remember whether the whole card was open
  document.addEventListener("toggle", (e) => {
    const t = e.target;
    if (!(t.matches && t.matches("#orderMsgRoot > details.cz-card"))) return;
    wasOpen = t.open;
    if (t.hasAttribute("data-failed")) {      // the error note was opened by the page itself: only a fresh tap retries
      if (!t.open) t.removeAttribute("data-failed");
      return;
    }
    if (t.open) load();                       // the only thing that reads the messages from the server
  }, true);
  document.addEventListener("click", async (e) => {
    if (!inside(e)) return;
    const r = e.target.closest("[data-group]");

    const del = e.target.closest("[data-del]");
    if (del && r) {
      e.preventDefault();          // the 🗑 sits in the row's header: don't also open / close the row
      e.stopPropagation();
      r.remove();
      paintAdd();
      paintSave();
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      const picker = host().querySelector("[data-picker]");
      picker.hidden = !picker.hidden;
      add.setAttribute("aria-expanded", String(!picker.hidden));
      return;
    }
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      host().querySelector("[data-picker]").hidden = true;
      host().querySelector("[data-add]").setAttribute("aria-expanded", "false");
      addRow(pick.dataset.pick);
      return;
    }
    const ins = e.target.closest("[data-ins]");
    if (ins && r) {
      Kit.insertAtCursor(lastField[r.dataset.group] || r.querySelector('[data-f="body"]'), ins.dataset.ins);
      return;
    }
    if (e.target.closest("[data-reset]") && r) {
      const c = catalogItem(r.dataset.group);
      r.querySelector('[data-f="title"]').value = c.defaultTitle;
      r.querySelector('[data-f="body"]').value = c.defaultBody;
      paintRow(c.key);
      paintSave();
      return;
    }
    if (e.target.closest("[data-save]")) await save();
  });

  async function save() {
    const btn = host().querySelector("[data-save]");
    const st = host().querySelector("[data-status]");
    const types = {};
    for (const key of shownKeys()) {
      const v = values(key);
      if (!v.title.trim() || !v.body.trim()) {
        st.className = "nm-status is-bad";
        st.textContent = `${catalogItem(key).label}: fill in the title and message (or tap Reset).`;
        row(key).open = true;
        return;
      }
      types[key] = { enabled: v.enabled, title: v.title.trim(), body: v.body.trim() };
    }
    const removed = server.types.map((t) => t.key).filter((k) => !types[k]);
    const openKeys = shownKeys().filter((k) => row(k).open);
    btn.disabled = true;
    st.className = "nm-status";
    st.textContent = "Saving…";
    try {
      server = await Api.put("/api/admin/site/notification-messages", { types, removed });
      loadedAt = Date.now();
      renderRows(openKeys);
      st.className = "nm-status is-ok";
      st.textContent = "Saved ✓";
    } catch (err) {
      btn.disabled = false;
      st.className = "nm-status is-bad";
      st.textContent = err.message || "Couldn't save";
    }
  }

  /** The closed card that stands in until it is opened: nothing is requested from the server before that. */
  function shell(body, open, failed) {
    const h = host();
    if (h) h.innerHTML = `<details class="cz-card" ${open ? "open" : ""} ${failed ? "data-failed" : ""}><summary><h3>Customer notifications</h3></summary><div class="cz-card-body"><p class="nm-hint">${body}</p></div></details>`;
  }

  /** Draws the card (built from the last answer when there is one, else the closed stand-in). No request. */
  function draw() {
    const h = host();
    if (!h) return;                       // Customize is not built yet: it announces itself when it is
    if (!allowed()) { h.innerHTML = ""; return; }
    if (server) build();
    else shell("Loading…", wasOpen);
  }

  // Reads the messages - only when the card is opened (never when the Customize tab is).
  async function load() {
    const h = host();
    if (!h || !allowed() || loading) return;
    if (server && h.firstElementChild && (isDirty() || Date.now() - loadedAt < 10 * 60 * 1000)) return;
    loading = true;
    if (!server) shell("Loading…", true);
    try {
      const answer = await Api.get("/api/admin/site/notification-messages");
      if (!host()) return;
      server = answer;
      loadedAt = Date.now();
      build();
    } catch (e) {
      if (host() && !server) shell(`Couldn't load customer notifications (${Kit.esc(e.message || "error")}). Close this section and open it again to retry.`, true, true);
    } finally {
      loading = false;
    }
  }

  // Customize was (re)built: its spot for this card is empty again
  document.addEventListener("freshcutz:customize-built", draw);
  document.addEventListener("freshcutz:access", () => {
    const h = host();
    if (!h) return;
    if (!allowed()) h.innerHTML = "";
    else if (!h.firstElementChild) draw();
  });
  // A different person signing in must never see the previous login's screen.
  document.addEventListener("freshcutz:logout", () => {
    server = null; loadedAt = 0; wasOpen = false;
    const h = host();
    if (h) h.innerHTML = "";
  });

  return { refresh: () => { const h = host(); if (h && !h.firstElementChild) draw(); } }; // (opening the Customize tab only draws the closed card)
})();
