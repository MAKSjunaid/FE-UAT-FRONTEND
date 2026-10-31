/* Customize -> "Customer cancellation": lets customers cancel their own order, within the limits set here, and words what they see.
 * Sits right after "Customer notifications" (admin-customize.js leaves an empty #cancelMsgRoot there and announces
 * "freshcutz:customize-built"). Nothing is read from the server until the card is opened.
 *   - the switch (off = no cancel button anywhere on the customer website);
 *   - which order statuses allow it: one tick per OPEN status the server lists, so a status added later shows up by itself;
 *   - how long after the order was placed (or no limit);
 *   - Reasons: the list the customer picks from - add, edit, delete (emoji from the phone keyboard or the palette);
 *   - Wording: the "Are you sure?" page and the two pop-ups.
 * Talks to /api/admin/site/cancel-rule. The server checks the same rules again on every cancel. */

window.AdminCancel = (() => {
  const Kit = window.AdminNotifyKit;
  if (!Kit) return { refresh() {} };

  const URL = "/api/admin/site/cancel-rule";
  const PRESETS = [5, 10, 15, 30, 45, 60, 120, 180, 360, 720, 1440];
  const TEXTS = [
    ["sureTitle", "Title", 120],
    ["sureText", "Message", 200],
    ["keepText", "Keep button", 30],
    ["yesText", "Cancel button", 30],
    ["cancelledToast", "Pop-up after cancelling", 120],
    ["keptToast", "Pop-up after keeping", 120],
  ];
  const FRESH_MS = 10 * 60 * 1000;

  let server = null;  // { rule, statuses:[{key,label}], defaults, maxReasons, maxReason }
  let savedJson = ""; // the rule as last saved, in the shape read() returns (to know when something changed)
  let loadedAt = 0;
  let loading = false;
  let wasOpen = false;
  let lastField = null; // the text field touched last (the emoji palette inserts there)

  const host = () => document.getElementById("cancelMsgRoot");
  const allowed = () => !window.AdminAccess || AdminAccess.can("customize", "EDIT");
  const $ = (sel) => host().querySelector(sel);
  const label = (m) => (m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);

  // ---- reading the form ---------------------------------------------------------------------------

  function read() {
    const h = host();
    const out = {
      enabled: h.querySelector("[data-enabled]").checked,
      statuses: [...h.querySelectorAll("[data-status-key]")].filter((c) => c.checked).map((c) => c.dataset.statusKey),
      minutes: parseInt(h.querySelector("[data-mins]").value, 10) || 0,
      dodge: h.querySelector("[data-dodge]").checked,
      reasons: [...h.querySelectorAll('[data-f="reason"]')].map((i) => i.value.replace(/\s+/g, " ").trim()).filter(Boolean),
    };
    TEXTS.forEach(([k]) => { out[k] = h.querySelector(`[data-f="${k}"]`).value.replace(/\s+/g, " ").trim(); });
    return out;
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
  }

  // ---- drawing ------------------------------------------------------------------------------------

  const reasonRow = (text) =>
    `<div class="cc-rr" data-rr><input type="text" data-f="reason" maxlength="${server.maxReason}" autocomplete="off" value="${Kit.esc(text)}" />` +
    `<button type="button" class="nm-del" data-del-r aria-label="Delete this reason">🗑</button></div>`;

  function paintAddReason() {
    $("[data-add-r]").hidden = host().querySelectorAll("[data-rr]").length >= server.maxReasons;
  }

  function build() {
    const r = server.rule;
    const m = r.minutes || 0;
    const mins = PRESETS.includes(m) || m === 0 ? PRESETS : PRESETS.concat(m).sort((a, b) => a - b);
    host().innerHTML = `
      <details class="cz-card" ${wasOpen ? "open" : ""}>
        <summary><h3>Customer cancellation</h3></summary>
        <div class="cz-card-body">
          <div class="nm-bhead">
            <span class="nm-bname">Customers can cancel</span>
            <label class="nm-on"><span data-onlabel>On</span>
              <span class="switch"><input type="checkbox" data-enabled ${r.enabled ? "checked" : ""} /><span class="track"></span></span>
            </label>
          </div>
          <div data-edit>
            <div class="nm-field">Allow while the order is
              <div class="cc-chips">${server.statuses.map((s) =>
                `<label class="cc-chip"><input type="checkbox" data-status-key="${Kit.esc(s.key)}" ${r.statuses.includes(s.key) ? "checked" : ""} /><span>${Kit.esc(s.label)}</span></label>`).join("")}</div>
            </div>
            <label class="nm-field">Time limit
              <select data-mins class="cc-select">
                <option value="0" ${m === 0 ? "selected" : ""}>No limit</option>
                ${mins.map((v) => `<option value="${v}" ${v === m ? "selected" : ""}>${label(v)}</option>`).join("")}
              </select>
            </label>

            <details class="nm-row cc-sub" data-sub="reasons">
              <summary><span class="nm-rname"><b>Reasons</b></span></summary>
              <div class="nm-rbody">
                <div class="cc-rrs" data-rrs>${r.reasons.map(reasonRow).join("")}</div>
                <div class="nk-tools nm-tools">
                  <button type="button" class="nm-chip nm-new" data-add-r>＋ Add</button>
                  <button type="button" class="nm-chip" data-nk-emoji>😀 Emoji</button>
                  <button type="button" class="nm-chip nm-reset" data-reset="reasons">↺ Reset</button>
                  ${Kit.paletteHtml()}
                </div>
              </div>
            </details>

            <div class="nm-bhead cc-dodge">
              <span class="nm-bname">Moving “Yes” button</span>
              <label class="nm-on"><span data-dodgelabel>${r.dodge ? "On" : "Off"}</span>
                <span class="switch"><input type="checkbox" data-dodge ${r.dodge ? "checked" : ""} /><span class="track"></span></span>
              </label>
            </div>

            <details class="nm-row cc-sub" data-sub="texts">
              <summary><span class="nm-rname"><b>Wording</b></span></summary>
              <div class="nm-rbody">
                ${TEXTS.map(([k, name, max]) =>
                  `<label class="nm-field">${name}<input type="text" data-f="${k}" maxlength="${max}" autocomplete="off" value="${Kit.esc(r[k])}" /></label>`).join("")}
                <div class="nk-tools nm-tools">
                  <button type="button" class="nm-chip" data-nk-emoji>😀 Emoji</button>
                  <button type="button" class="nm-chip nm-reset" data-reset="texts">↺ Reset</button>
                  ${Kit.paletteHtml()}
                </div>
              </div>
            </details>
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

  const inside = (e) => e.target.closest && e.target.closest("#cancelMsgRoot");

  document.addEventListener("focusin", (e) => {
    if (inside(e) && e.target.matches("input[type=text]")) lastField = e.target;
  });
  document.addEventListener("input", (e) => { if (inside(e)) paintSave(); });
  document.addEventListener("change", (e) => {
    if (!inside(e)) return;
    if (e.target.matches("[data-enabled]")) paintOn();
    if (e.target.matches("[data-dodge]")) $("[data-dodgelabel]").textContent = e.target.checked ? "On" : "Off";
    paintSave();
  });
  // <details> "toggle" doesn't bubble: capture it, only to remember whether the whole card was open
  document.addEventListener("toggle", (e) => {
    const t = e.target;
    if (!(t.matches && t.matches("#cancelMsgRoot > details.cz-card"))) return;
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
    if (e.target.closest("[data-add-r]")) {
      $("[data-rrs]").insertAdjacentHTML("beforeend", reasonRow(""));
      const inputs = host().querySelectorAll('[data-f="reason"]');
      inputs[inputs.length - 1].focus();
      paintAddReason();
      paintSave();
      return;
    }
    const reset = e.target.closest("[data-reset]");
    if (reset) {
      const d = server.defaults;
      if (reset.dataset.reset === "reasons") {
        $("[data-rrs]").innerHTML = d.reasons.map(reasonRow).join("");
      } else {
        TEXTS.forEach(([k]) => { host().querySelector(`[data-f="${k}"]`).value = d[k]; });
      }
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
    if (rule.enabled && !rule.statuses.length) {
      st.className = "nm-status is-bad";
      st.textContent = "Tick at least one status.";
      return;
    }
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
    } catch (err) {
      btn.disabled = false;
      st.className = "nm-status is-bad";
      st.textContent = err.message || "Couldn't save";
    }
  }

  // ---- loading: the closed card stands in until it is opened --------------------------------------

  function shell(body, open, failed) {
    const h = host();
    if (h) h.innerHTML = `<details class="cz-card" ${open ? "open" : ""} ${failed ? "data-failed" : ""}><summary><h3>Customer cancellation</h3></summary><div class="cz-card-body"><p class="nm-hint">${body}</p></div></details>`;
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
