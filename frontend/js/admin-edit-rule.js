/* Customize -> "Edit orders": the master switch for editing an order after it was placed, and its limits. Sits right after
 * "Customer cancellation" (admin-customize.js leaves an empty #editRuleRoot there and announces "freshcutz:customize-built").
 * Nothing is read from the server until the card is opened.
 *   - the switch (off = no Edit button anywhere: not for the shop, not for customers);
 *   - which order statuses the SHOP may edit in (tick Packed too to take out an item that turns out to be missing while packing);
 *   - whether CUSTOMERS may edit their own order: in which statuses, for how long after placing it, and how many times;
 *   - Reasons: the list both sides pick from - add, edit, delete (emoji from the phone keyboard or the palette).
 * Talks to /api/admin/site/order-edit. The server checks the same rules again on every edit.
 * Who of the staff may edit orders at all is set in Settings -> Users ("Can edit orders"). */

window.AdminEditRule = (() => {
  const Kit = window.AdminNotifyKit;
  if (!Kit) return { refresh() {} };

  const URL = "/api/admin/site/order-edit";
  const PRESETS = [5, 10, 15, 30, 45, 60, 120, 180, 360, 720, 1440];
  const FRESH_MS = 10 * 60 * 1000;

  let server = null;  // { rule, statuses:[{key,label}], defaults, maxReasons, maxReason, maxEdits }
  let savedJson = "";
  let loadedAt = 0;
  let loading = false;
  let wasOpen = false;
  let lastField = null;

  const host = () => document.getElementById("editRuleRoot");
  const allowed = () => !window.AdminAccess || AdminAccess.can("customize");
  const $ = (sel) => host().querySelector(sel);
  const label = (m) => (m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);

  // ---- reading the form ---------------------------------------------------------------------------

  function read() {
    const h = host();
    const ticked = (attr) => [...h.querySelectorAll(`[${attr}]`)].filter((c) => c.checked).map((c) => c.getAttribute(attr));
    return {
      enabled: h.querySelector("[data-enabled]").checked,
      adminStatuses: ticked("data-admin-status"),
      customerEnabled: h.querySelector("[data-cust-on]").checked,
      customerStatuses: ticked("data-cust-status"),
      customerMinutes: parseInt(h.querySelector("[data-mins]").value, 10) || 0,
      customerMaxEdits: parseInt(h.querySelector("[data-max]").value, 10) || 1,
      reasons: [...h.querySelectorAll('[data-f="reason"]')].map((i) => i.value.replace(/\s+/g, " ").trim()).filter(Boolean),
      shopReasons: [...h.querySelectorAll('[data-f="shop-reason"]')].map((i) => i.value.replace(/\s+/g, " ").trim()).filter(Boolean),
    };
  }

  const isDirty = () => !!server && !!host() && !!host().querySelector("[data-enabled]") && JSON.stringify(read()) !== savedJson;

  function paintSave() {
    const dirty = isDirty();
    $("[data-save]").disabled = !dirty;
    if (dirty) $("[data-status]").textContent = "";
  }

  function paintOn() {
    const on = $("[data-enabled]").checked;
    $("[data-onlabel]").textContent = on ? "On" : "Off";
    $("[data-edit]").classList.toggle("nm-dim", !on);
    const c = $("[data-cust-on]").checked;
    $("[data-custlabel]").textContent = c ? "On" : "Off";
    $("[data-cust]").classList.toggle("nm-dim", !c);
  }

  // ---- drawing ------------------------------------------------------------------------------------

  const reasonRow = (text, field) =>
    `<div class="cc-rr" data-rr><input type="text" data-f="${field || "reason"}" maxlength="${server.maxReason}" autocomplete="off" value="${Kit.esc(text)}" />` +
    `<button type="button" class="nm-del" data-del-r aria-label="Delete this reason">🗑</button></div>`;

  // (two lists: what the customer picks from, and what the shop picks from - each has its own Add button)
  function paintAddReason() {
    host().querySelectorAll("[data-add-r]").forEach((b) => {
      const list = b.closest("details").querySelector("[data-rrs]");
      b.hidden = list.querySelectorAll("[data-rr]").length >= server.maxReasons;
    });
  }

  const chips = (attr, selected) => `<div class="cc-chips">${server.statuses.map((s) =>
    `<label class="cc-chip"><input type="checkbox" ${attr}="${Kit.esc(s.key)}" ${selected.includes(s.key) ? "checked" : ""} /><span>${Kit.esc(s.label)}</span></label>`).join("")}</div>`;

  function build() {
    const r = server.rule;
    const m = r.customerMinutes || 0;
    const mins = PRESETS.includes(m) || m === 0 ? PRESETS : PRESETS.concat(m).sort((a, b) => a - b);
    const maxes = Array.from({ length: server.maxEdits }, (_, i) => i + 1);
    host().innerHTML = `
      <details class="cz-card" ${wasOpen ? "open" : ""}>
        <summary><h3>Edit orders</h3></summary>
        <div class="cz-card-body">
          <p class="nm-hint">Change an order after it was placed: quantities, sizes, items, the address — or take out an item you can't supply (the order goes out without it, the customer is told and pays less). Every change is kept in the order's history.</p>
          <div class="nm-bhead">
            <span class="nm-bname">Editing orders</span>
            <label class="nm-on"><span data-onlabel>Off</span>
              <span class="switch"><input type="checkbox" data-enabled ${r.enabled ? "checked" : ""} /><span class="track"></span></span>
            </label>
          </div>
          <div data-edit>
            <div class="nm-field">You can edit while the order is
              ${chips("data-admin-status", r.adminStatuses)}
              <span class="nm-hint">Tick Packed too if you want to take out an item that turns out to be missing while packing.</span>
            </div>

            <div class="nm-bhead cc-dodge">
              <span class="nm-bname">Customers can edit their own order</span>
              <label class="nm-on"><span data-custlabel>Off</span>
                <span class="switch"><input type="checkbox" data-cust-on ${r.customerEnabled ? "checked" : ""} /><span class="track"></span></span>
              </label>
            </div>
            <div data-cust>
              <div class="nm-field">Customers can edit while the order is
                ${chips("data-cust-status", r.customerStatuses)}
              </div>
              <label class="nm-field">Time limit after placing the order
                <select data-mins class="cc-select">
                  <option value="0" ${m === 0 ? "selected" : ""}>No limit</option>
                  ${mins.map((v) => `<option value="${v}" ${v === m ? "selected" : ""}>${label(v)}</option>`).join("")}
                </select>
              </label>
              <label class="nm-field">How many times
                <select data-max class="cc-select">
                  ${maxes.map((v) => `<option value="${v}" ${v === r.customerMaxEdits ? "selected" : ""}>${v === 1 ? "Once" : v + " times"}</option>`).join("")}
                </select>
              </label>
            </div>

            <details class="nm-row cc-sub" data-sub="reasons">
              <summary><span class="nm-rname"><b>Reasons customers pick</b></span></summary>
              <div class="nm-rbody">
                <div class="cc-rrs" data-rrs>${r.reasons.map((t) => reasonRow(t, "reason")).join("")}</div>
                <div class="nk-tools nm-tools">
                  <button type="button" class="nm-chip nm-new" data-add-r="reason">＋ Add</button>
                  <button type="button" class="nm-chip" data-nk-emoji>😀 Emoji</button>
                  <button type="button" class="nm-chip nm-reset" data-reset="reason">↺ Reset</button>
                  ${Kit.paletteHtml()}
                </div>
              </div>
            </details>

            <details class="nm-row cc-sub" data-sub="shopreasons">
              <summary><span class="nm-rname"><b>Reasons when you edit</b></span></summary>
              <div class="nm-rbody">
                <div class="cc-rrs" data-rrs>${(r.shopReasons || server.defaults.shopReasons).map((t) => reasonRow(t, "shop-reason")).join("")}</div>
                <p class="nm-hint">"✏️ Other" (type your own reason) is always added at the end.</p>
                <div class="nk-tools nm-tools">
                  <button type="button" class="nm-chip nm-new" data-add-r="shop-reason">＋ Add</button>
                  <button type="button" class="nm-chip" data-nk-emoji>😀 Emoji</button>
                  <button type="button" class="nm-chip nm-reset" data-reset="shop-reason">↺ Reset</button>
                  ${Kit.paletteHtml()}
                </div>
              </div>
            </details>
            <p class="nm-hint">Who of your staff may edit orders is set in Settings → Users (“Can edit orders”). Delivered and cancelled orders can never be edited.</p>
          </div>
          <div class="nm-foot">
            <button type="button" class="btn btn-gold" data-save disabled>Save</button>
            <span class="nm-status" data-status aria-live="polite"></span>
          </div>
        </div>
      </details>`;
    Kit.wirePalettes(host(), (wrap) => {
      if (lastField && lastField.isConnected && wrap.closest("details").contains(lastField)) return lastField;
      return wrap.closest("details").querySelector("input[type=text]");
    });
    savedJson = JSON.stringify(read());
    paintOn();
    paintAddReason();
    paintSave();
  }

  // ---- events (the host is rebuilt whenever Customize is built, so listen once on the document) -------

  const inside = (e) => e.target.closest && e.target.closest("#editRuleRoot");

  document.addEventListener("focusin", (e) => {
    if (inside(e) && e.target.matches("input[type=text]")) lastField = e.target;
  });
  document.addEventListener("input", (e) => { if (inside(e)) paintSave(); });
  document.addEventListener("change", (e) => {
    if (!inside(e)) return;
    if (e.target.matches("[data-enabled], [data-cust-on]")) paintOn();
    paintSave();
  });
  document.addEventListener("toggle", (e) => {
    const t = e.target;
    if (!(t.matches && t.matches("#editRuleRoot > details.cz-card"))) return;
    wasOpen = t.open;
    if (t.hasAttribute("data-failed")) {
      if (!t.open) t.removeAttribute("data-failed");
      return;
    }
    if (t.open) load();
  }, true);

  document.addEventListener("click", async (e) => {
    if (!inside(e)) return;
    const del = e.target.closest("[data-del-r]");
    if (del) {
      del.closest("[data-rr]").remove();
      paintAddReason();
      paintSave();
      return;
    }
    const addBtn = e.target.closest("[data-add-r]");
    if (addBtn) {
      const field = addBtn.dataset.addR;
      addBtn.closest("details").querySelector("[data-rrs]").insertAdjacentHTML("beforeend", reasonRow("", field));
      const inputs = host().querySelectorAll(`[data-f="${field}"]`);
      inputs[inputs.length - 1].focus();
      paintAddReason();
      paintSave();
      return;
    }
    const resetBtn = e.target.closest("[data-reset]");
    if (resetBtn) {
      const field = resetBtn.dataset.reset;
      resetBtn.closest("details").querySelector("[data-rrs]").innerHTML = (field === "shop-reason" ? server.defaults.shopReasons : server.defaults.reasons).map((t) => reasonRow(t, field)).join("");
      paintAddReason();
      paintSave();
      return;
    }
    if (e.target.closest("[data-save]")) await save();
  });

  async function save() {
    const btn = $("[data-save]");
    const st = $("[data-status]");
    const rule = read();
    const bad = (t) => { st.className = "nm-status is-bad"; st.textContent = t; };
    if (rule.enabled && !rule.adminStatuses.length) return bad("Tick at least one status for yourself.");
    if (rule.enabled && rule.customerEnabled && !rule.customerStatuses.length) return bad("Tick at least one status for customers, or switch customer editing off.");
    if (rule.enabled && !rule.reasons.length) return bad("Add at least one reason for customers.");
    if (rule.enabled && !rule.shopReasons.length) return bad("Add at least one reason for when you edit.");
    btn.disabled = true;
    st.className = "nm-status";
    st.textContent = "Saving…";
    const openSubs = [...host().querySelectorAll("details.cc-sub[open]")].map((d) => d.dataset.sub);
    try {
      server = await Api.put(URL, rule);
      loadedAt = Date.now();
      build();
      openSubs.forEach((k) => { const d = host().querySelector(`details[data-sub="${k}"]`); if (d) d.open = true; });
      const s = $("[data-status]");
      s.className = "nm-status is-ok";
      s.textContent = "Saved ✓";
      window.dispatchEvent(new Event("freshcutz:orderedit-rule-saved")); // the Orders tab reads whether it may show Edit again
    } catch (err) {
      btn.disabled = false;
      st.className = "nm-status is-bad";
      st.textContent = err.message || "Couldn't save";
    }
  }

  // ---- loading: the closed card stands in until it is opened --------------------------------------

  function shell(body, open, failed) {
    const h = host();
    if (h) h.innerHTML = `<details class="cz-card" ${open ? "open" : ""} ${failed ? "data-failed" : ""}><summary><h3>Edit orders</h3></summary><div class="cz-card-body"><p class="nm-hint">${body}</p></div></details>`;
  }

  function draw() {
    const h = host();
    if (!h) return;
    if (!allowed()) { h.innerHTML = ""; return; }
    if (server) build();
    else shell("Loading…", wasOpen);
  }

  async function load() {
    const h = host();
    if (!h || !allowed() || loading) return;
    if (server && h.firstElementChild && (isDirty() || Date.now() - loadedAt < FRESH_MS)) return;
    loading = true;
    if (!server) shell("Loading…", true);
    try {
      const answer = await Api.get(URL);
      if (!host()) return;
      server = answer;
      loadedAt = Date.now();
      build();
    } catch (err) {
      if (host() && !server) shell(`Couldn't load (${Kit.esc(err.message || "error")}). Close this section and open it again to retry.`, true, true);
    } finally {
      loading = false;
    }
  }

  document.addEventListener("freshcutz:customize-built", draw);
  document.addEventListener("freshcutz:access", () => {
    const h = host();
    if (!h) return;
    if (!allowed()) h.innerHTML = "";
    else if (!h.firstElementChild) draw();
  });
  document.addEventListener("freshcutz:logout", () => {
    server = null; loadedAt = 0; wasOpen = false; lastField = null;
    const h = host();
    if (h) h.innerHTML = "";
  });

  return { refresh: () => { const h = host(); if (h && !h.firstElementChild) draw(); } };
})();
