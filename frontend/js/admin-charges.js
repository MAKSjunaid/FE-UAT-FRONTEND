/* Settings -> "Delivery & other charges".
 *
 *   - the master switch (off = no charge is added anywhere, the shop works as before);
 *   - Delivery charge: one base amount; optionally "charge more for longer distance" - automatic (base covers the first km, then
 *     so much per started km, with an optional cap) or the owner's own steps ("up to 2 km: 10"); free above a total; "show as free"
 *     (the customer pays 0 but sees the real amount struck through);
 *   - Minimum order amount;
 *   - Other charges: any number of named lines (GST, packing, transaction fee, surge ...) - fixed ₹ or % of the items, with a short
 *     information line, an optional time window, an on/off switch and "show as free";
 *   - a preview that asks the server what the form (saved or not) would charge - the very calculation orders use.
 * The shop's position is set once on a small map (or typed / taken from this phone); distances are counted from it.
 * Talks to /api/admin/charges. The server works the charges out again whenever an order is placed. */

window.AdminCharges = (() => {
  const root = document.getElementById("chargesRoot");
  if (!root) return { refresh() {} };

  const URL = "/api/admin/charges";
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const FRESH_MS = 5 * 60 * 1000;
  const ROADS = [[1, "Straight line"], [1.2, "Roads ≈ 20% longer"], [1.3, "Roads ≈ 30% longer"], [1.5, "Roads ≈ 50% longer"]];

  let server = null;     // { config, maxOthers, maxSlabs, maxLabel, maxNote }
  let m = null;          // the form's working copy of config
  let savedJson = "";
  let loadedAt = 0;
  let loading = false;
  let prev = { items: 300, km: 3, minute: "", outside: false };  // the preview's own inputs (not saved)
  let tiles = undefined; // the map file info (only to draw the pin picker); undefined = not asked yet

  const allowed = () => !window.AdminAccess || AdminAccess.can("charges"); // View is enough: the screen is read-only for View only (see admin-readonly.js)
  const $ = (s) => root.querySelector(s);
  const rs = (n) => "₹" + (Math.round(Number(n) * 100) / 100).toString();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isDirty = () => !!m && JSON.stringify(m) !== savedJson;
  /** The working copy as the server takes it: without the form's own marks (e.g. "timed"). */
  const wire = (extra) => ({ ...m, ...extra, others: m.others.map(({ timed, ...o }) => o) });

  // ---- drawing ----------------------------------------------------------------------------------

  const num = (path, v, extra) => `<input type="number" inputmode="decimal" min="0" step="any" data-p="${path}" value="${v}" ${extra || ""} />`;
  const check = (path, v, text, hint) =>
    `<label class="ch-check"><input type="checkbox" data-p="${path}" ${v ? "checked" : ""} /><span>${text}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
  const sw = (path, v, label) =>
    `<label class="mp-switch" aria-label="${label}"><input type="checkbox" data-p="${path}" ${v ? "checked" : ""} /><span></span></label>`;

  function slabRow(s, i) {
    return `<div class="ch-slab" data-si="${i}"><span>Up to</span>
      <input type="number" inputmode="decimal" min="0" step="any" data-sk="upToKm" value="${s.upToKm || ""}" placeholder="2" /><span>km</span>
      <span class="ch-arrow">→ ₹</span>
      <input type="number" inputmode="decimal" min="0" step="any" data-sk="amount" value="${s.amount}" />
      <button type="button" class="nm-del" data-del-s="${i}" aria-label="Delete this step">🗑</button></div>`;
  }

  // which sections are open (the form is drawn again after many taps; what the owner opened stays open)
  const open = new Set();
  const det = (key, head, sub, body, extra) =>
    `<details class="mp-card ch-det ${extra || ""}" data-sec="${key}" ${open.has(key) ? "open" : ""}>
      <summary><span class="ch-sum"><strong>${head}</strong><small>${sub}</small></span><span class="ch-chev" aria-hidden="true">›</span></summary>
      <div class="ch-det-body">${body}</div></details>`;

  const otherSub = (o) => `${o.type === "percent" ? o.value + "%" : rs(o.value)}${o.from && o.to ? ` · ${o.from}–${o.to}` : ""}${o.enabled ? "" : " · off"}`;

  function otherRow(o, i) {
    const timed = o.timed != null ? o.timed : !!(o.from || o.to);
    const body = `
      <div class="ch-o-head">
        <input type="text" data-ok="label" maxlength="${server.maxLabel}" placeholder="Name, e.g. GST, Packing, Surge" autocomplete="off" value="${esc(o.label)}" />
        <label class="mp-switch" aria-label="On or off"><input type="checkbox" data-ok="enabled" ${o.enabled ? "checked" : ""} /><span></span></label>
        <button type="button" class="nm-del" data-del-o="${i}" aria-label="Delete this charge">🗑</button>
      </div>
      <input type="text" data-ok="note" maxlength="${server.maxNote}" placeholder="Small line shown under it (optional), e.g. 5% on your items" autocomplete="off" value="${esc(o.note)}" />
      <div class="ch-o-row">
        <select data-ok="type" class="cc-select"><option value="fixed" ${o.type === "fixed" ? "selected" : ""}>Fixed ₹</option><option value="percent" ${o.type === "percent" ? "selected" : ""}>% of items</option></select>
        <input type="number" inputmode="decimal" min="0" step="any" data-ok="value" value="${o.value}" aria-label="Amount" />
      </div>
      <label class="ch-check"><input type="checkbox" data-ok="timed" ${timed ? "checked" : ""} /><span>Only at certain hours<small>For a surge or late-night charge (shop time)</small></span></label>
      ${timed ? `<div class="ch-o-row ch-times"><input type="time" data-ok="from" value="${esc(o.from)}" /><span>to</span><input type="time" data-ok="to" value="${esc(o.to)}" /></div>` : ""}
      <label class="ch-check"><input type="checkbox" data-ok="showFree" ${o.showFree ? "checked" : ""} /><span>Show as FREE<small>Customer pays ₹0 but sees the real amount struck through</small></span></label>`;
    return `<details class="ch-other ${o.enabled ? "" : "is-off"}" data-oi="${i}" data-sec="o${i}" ${open.has("o" + i) ? "open" : ""}>
      <summary><span class="ch-sum"><strong>${esc(o.label) || "New charge"}</strong><small>${otherSub(o)}</small></span><span class="ch-chev" aria-hidden="true">›</span></summary>
      <div class="ch-det-body">${body}</div></details>`;
  }

  function pinText() {
    return m.shopLat != null && m.shopLng != null
      ? `<strong class="ch-ok">✓ Shop pinned</strong><span>${m.shopLat.toFixed(5)}, ${m.shopLng.toFixed(5)}</span>`
      : `<strong class="ch-bad">Shop location not set</strong><span>Needed to count the distance to customers</span>`;
  }

  /** Whether being outside the delivery area you drew changes the charge at all (the same rule as ChargesService.areaMatters). */
  const areaMatters = (d) => d.freeAbove > 0 || (d.showFree && d.chargeOutside) || (d.byDistance && d.farFreeAbove > 0);

  function deliverySub() {
    const d = m.delivery;
    if (!d.enabled) return "Off";
    const bits = [d.showFree ? `${rs(d.base)} shown as FREE` : rs(d.base)];
    if (d.byDistance) bits.push(d.method === "slabs" ? "by distance (steps)" : "by distance");
    if (d.freeAbove > 0) bits.push(`free above ${rs(d.freeAbove)}`);
    if (d.byDistance && d.farFreeAbove > 0) bits.push(`far orders free above ${rs(d.farFreeAbove)}`);
    return bits.join(" · ");
  }

  function paint() {
    const d = m.delivery;
    const slabs = d.slabs;
    const autoOn = d.byDistance && d.method !== "slabs";
    const slabsOn = d.byDistance && d.method === "slabs";
    const scroll = window.scrollY;

    const deliveryBody = `
      <div class="mp-row">
        <div class="mp-row-text"><strong>Delivery charge on</strong><small>Added to every order</small></div>
        ${sw("delivery.enabled", d.enabled, "Delivery charge on or off")}
      </div>
      <div class="ch-sec ${d.enabled ? "" : "is-off"}">
        <label class="nm-field">Name on the bill<input type="text" data-p="delivery.label" maxlength="${server.maxLabel}" autocomplete="off" value="${esc(d.label)}" /></label>
        <label class="nm-field">Delivery charge (₹)${num("delivery.base", d.base)}</label>
        ${check("delivery.showFree", d.showFree, "Show as FREE", "Customer pays ₹0 but sees the real amount struck through, like <s>₹40</s> FREE")}
        ${d.showFree ? check("delivery.chargeOutside|i", !d.chargeOutside, "Also FREE outside my delivery area", "Off: customers whose pin is outside the area you drew pay the real charge" + (d.byDistance ? ", counted by distance" : "")) : ""}
        ${check("delivery.freeAbove|n", d.freeAbove > 0, "Free delivery above a total", "Orders that reach the amount are free (shown struck through); others are nudged: “Add ₹X more for free delivery”. Only for customers inside your delivery area: those outside it never get this")}
        ${d.freeAbove > 0 ? `<label class="nm-field">Free when the items come to (₹)${num("delivery.freeAbove", d.freeAbove)}</label>
        <label class="nm-field">Small line under it (optional)<input type="text" data-p="delivery.note" maxlength="${server.maxNote}" autocomplete="off" value="${esc(d.note)}" placeholder="e.g. Free delivery on orders above ₹499" /><small class="ch-hint">Shown under the delivery charge while it is charged; hidden once it is free</small></label>` : ""}

        <div class="ch-div"></div>
        <div class="mp-row">
          <div class="mp-row-text"><strong>Charge more for longer distance</strong><small>Only for customers outside the delivery area you drew (everyone, if you have not drawn one): those inside it always pay the one charge above, and so does a customer who has not pinned their place. Off = everyone pays that one charge, however far. When the distance makes it higher, the customer sees “Delivery charges (Long Distance)”.</small></div>
          ${sw("delivery.byDistance", d.byDistance, "Charge by distance on or off")}
        </div>
        ${d.byDistance ? `
        <div class="ch-sub">
          <div class="mp-tiles ${m.shopLat != null ? "is-set" : ""}" data-pin>${pinText()}</div>
          <div class="ch-btns"><button type="button" class="btn btn-ghost btn-sm" data-pick>📍 ${m.shopLat != null ? "Change" : "Set"} shop location</button></div>
          <label class="nm-field">How the distance is counted
            <select data-p="roadFactor|f" class="cc-select">${ROADS.map(([v, t]) => `<option value="${v}" ${Math.abs(m.roadFactor - v) < 0.001 ? "selected" : ""}>${t}</option>`).join("")}${ROADS.some(([v]) => Math.abs(m.roadFactor - v) < 0.001) ? "" : `<option value="${m.roadFactor}" selected>×${m.roadFactor}</option>`}</select>
          </label>
          <div class="mp-ed-seg ch-seg">
            <button type="button" class="${autoOn ? "on" : ""}" data-method="auto">Automatic</button>
            <button type="button" class="${slabsOn ? "on" : ""}" data-method="slabs">My own steps</button>
          </div>
          ${d.showFree && !d.chargeOutside ? "" : `
            ${check("delivery.farFreeAbove|n", d.farFreeAbove > 0, "Free delivery above a total for these far customers", "Off: a customer outside your delivery area always pays the charge by distance, however big the order. On: once their items reach the amount below, delivery is free (shown struck through); others are nudged: “Add ₹X more for free delivery”")}
            ${d.farFreeAbove > 0 ? `<label class="nm-field">Free when the items come to (₹)${num("delivery.farFreeAbove", d.farFreeAbove)}</label>
            <label class="nm-field">Small line under it (optional)<input type="text" data-p="delivery.farNote" maxlength="${server.maxNote}" autocomplete="off" value="${esc(d.farNote || "")}" placeholder="e.g. Free delivery on orders above ₹1999" /></label>` : ""}`}
          ${autoOn ? `
            <p class="mp-sub">The charge above covers the first few km, then it grows for every extra km (a started km counts as a whole km).</p>
            <div class="ch-grid">
              <label class="nm-field">Covers first (km)${num("delivery.freeKm", d.freeKm)}</label>
              <label class="nm-field">Then per km (₹)${num("delivery.perKm", d.perKm)}</label>
              <label class="nm-field">Never more than (₹)${num("delivery.maxCharge", d.maxCharge)}<small class="ch-hint">0 = no limit</small></label>
            </div>` : `
            <p class="mp-sub">Set your own price for each distance, e.g. near ₹10, a bit further ₹12.</p>
            <div class="ch-slabs">${slabs.map(slabRow).join("")}</div>
            ${slabs.length < server.maxSlabs ? `<button type="button" class="nm-chip nm-new" data-add-s>＋ Add a step</button>` : ""}
            <div class="ch-beyond"><span>Further than the last step</span>
              <div class="mp-ed-seg ch-seg">
                <button type="button" class="${d.beyond !== "block" ? "on" : ""}" data-beyond="charge">Charge</button>
                <button type="button" class="${d.beyond === "block" ? "on" : ""}" data-beyond="block">Don't deliver</button>
              </div>
              ${d.beyond !== "block" ? `<label class="nm-field">Charge (₹)${num("delivery.beyondAmount", d.beyondAmount)}</label>` : ""}
            </div>`}
        </div>` : ""}
      </div>`;

    const minBody = `<p class="mp-sub">Customers can't place an order below this (0 = no minimum). The cart tells them how much more to add.</p>
      <label class="nm-field">Items total at least (₹)${num("minOrder", m.minOrder)}</label>`;

    const othersBody = `<p class="mp-sub">GST, packing, transaction fee, surge… whatever you write is shown on the customer's bill with your small line under it.</p>
      <div class="ch-others">${m.others.map(otherRow).join("")}</div>
      ${m.others.length < server.maxOthers ? `<button type="button" class="btn btn-ghost btn-block" data-add-o>＋ Add a charge</button>` : ""}`;

    const prevBody = `<p class="mp-sub">What a customer would pay with the settings above (even before you save).</p>
      <div class="ch-grid">
        <label class="nm-field">Items (₹)<input type="number" inputmode="decimal" min="0" step="any" data-pv="items" value="${prev.items}" /></label>
        ${d.byDistance ? `<label class="nm-field">Distance (km)<input type="number" inputmode="decimal" min="0" step="any" data-pv="km" value="${prev.km}" /></label>` : ""}
        <label class="nm-field">Time (shop)<input type="time" data-pv="minute" value="${prev.minute}" /><small class="ch-hint">empty = now</small></label>
      </div>
      ${areaMatters(d) ? `<label class="ch-check"><input type="checkbox" data-pv="outside" ${prev.outside ? "checked" : ""} /><span>Customer is outside my delivery area<small>“Show as FREE” and “Free delivery above a total” do not reach them</small></span></label>` : ""}
      <div class="ch-prev" data-prev>…</div>`;

    root.innerHTML = `
    <div class="mp-wrap ch-wrap">
      <div class="mp-card">
        <div class="mp-row">
          <div class="mp-row-text"><strong>Charges</strong><small>Delivery charge, GST, packing, surge and more, added to the customer's total. Off = nothing is added anywhere, exactly as before.</small></div>
          ${sw("enabled", m.enabled, "Charges on or off")}
        </div>
      </div>

      <div class="ch-body ${m.enabled ? "" : "is-off"}">
        ${det("delivery", "Delivery charge", esc(deliverySub()), deliveryBody)}
        ${det("min", "Minimum order", m.minOrder > 0 ? rs(m.minOrder) : "No minimum", minBody)}
        ${det("others", "Other charges", m.others.length ? `${m.others.length} charge${m.others.length === 1 ? "" : "s"}` : "None yet", othersBody)}
        ${det("preview", "Preview", "See what a customer pays", prevBody)}
      </div>

      <div class="ch-foot"><button type="button" class="btn btn-gold" data-save disabled>Save</button><span class="nm-status" data-status aria-live="polite"></span></div>
    </div>`;
    window.scrollTo(0, scroll);
    paintSave();
    preview();
  }

  // what the owner opened stays open when the form is drawn again (<details> "toggle" does not bubble: caught on the way down)
  root.addEventListener("toggle", (e) => {
    const k = e.target.dataset && e.target.dataset.sec;
    if (!k) return;
    if (e.target.open) open.add(k); else open.delete(k);
  }, true);

  function paintSave() {
    const b = $("[data-save]");
    if (!b) return;
    b.disabled = !isDirty();
    if (!b.disabled) $("[data-status]").textContent = "";
  }

  // ---- editing the working copy ----------------------------------------------------------------

  const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  function setPath(path, val) {
    const parts = path.split(".");
    let o = m;
    while (parts.length > 1) o = o[parts.shift()];
    o[parts[0]] = val;
  }

  /** An input of the form changed: copy it into the working copy. Returns true when the form must be drawn again. */
  function onField(el) {
    if (el.dataset.p) {
      let [path, kind] = el.dataset.p.split("|");
      if (kind === "n") { // a "free above" tick (inside the area, or for the far customers): on = a default amount, off = 0
        const far = path === "delivery.farFreeAbove";
        const was = m.delivery[far ? "farFreeAbove" : "freeAbove"];
        m.delivery[far ? "farFreeAbove" : "freeAbove"] = el.checked ? (was || (far ? 999 : 499)) : 0;
        if (!far && el.checked && !m.delivery.chargeOutside) m.delivery.showFree = false; // (free for every order and free from an amount cancel each other, unless "show as free" stops at the area's edge)
        // switching the rule off: its own small line ("Free delivery on order above ₹200") would now say something untrue, so it goes too
        const nk = far ? "farNote" : "note", note = m.delivery[nk] || "";
        if (!el.checked && was > 0 && /free/i.test(note) && note.replace(/[,\s]/g, "").includes(String(was))) m.delivery[nk] = "";
        return true;
      }
      if (kind === "i") { setPath(path, !el.checked); if (el.checked) m.delivery.freeAbove = 0; return true; } // (free for everybody chosen: an amount to reach makes no sense) // (a tick that means the opposite of the stored flag)
      const v = el.type === "checkbox" ? el.checked : el.type === "number" ? toNum(el.value) : kind === "f" ? parseFloat(el.value) || 1 : el.value;
      setPath(path, v);
      if (path === "delivery.showFree" && v && !m.delivery.chargeOutside) m.delivery.freeAbove = 0; // (see above)
      return el.type === "checkbox" && /^(enabled|delivery\.enabled|delivery\.byDistance|delivery\.showFree)$/.test(path); // these switch whole parts of the form on / off
    }
    const orow = el.closest("[data-oi]");
    if (orow && el.dataset.ok) {
      const o = m.others[+orow.dataset.oi];
      const k = el.dataset.ok;
      if (k === "timed") {
        o.from = el.checked ? (o.from || "18:00") : "";
        o.to = el.checked ? (o.to || "22:00") : "";
        if (el.checked) o.timed = true; else delete o.timed;
        return true;
      }
      if (k === "enabled" || k === "showFree") o[k] = el.checked;
      else if (k === "value") o.value = toNum(el.value);
      else o[k] = el.value;
      if (k === "enabled") orow.classList.toggle("is-off", !el.checked);
      if (k === "label") { const t = orow.querySelector("summary strong"); if (t) t.textContent = o.label || "New charge"; }
      return false;
    }
    const srow = el.closest("[data-si]");
    if (srow && el.dataset.sk) { m.delivery.slabs[+srow.dataset.si][el.dataset.sk] = toNum(el.value); return false; }
    return false;
  }

  root.addEventListener("input", (e) => {
    if (e.target.dataset.pv) { onPreviewField(e.target); return; }
    onField(e.target);
    paintSave();
    previewSoon();
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.pv) { onPreviewField(e.target); return; }
    const redraw = onField(e.target);
    if (redraw) paint(); else { paintSave(); previewSoon(); }
  });

  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-save]")) return save();
    if (t.closest("[data-pick]")) return pickShop();
    const meth = t.closest("[data-method]");
    if (meth) { m.delivery.method = meth.dataset.method; if (m.delivery.method === "slabs" && !m.delivery.slabs.length) m.delivery.slabs = [{ upToKm: 2, amount: m.delivery.base }]; return paint(); }
    const bey = t.closest("[data-beyond]");
    if (bey) { m.delivery.beyond = bey.dataset.beyond; return paint(); }
    if (t.closest("[data-add-s]")) {
      const last = m.delivery.slabs[m.delivery.slabs.length - 1];
      m.delivery.slabs.push({ upToKm: last ? last.upToKm + 2 : 2, amount: last ? last.amount + 2 : m.delivery.base });
      return paint();
    }
    const ds = t.closest("[data-del-s]");
    if (ds) { m.delivery.slabs.splice(+ds.dataset.delS, 1); return paint(); }
    if (t.closest("[data-add-o]")) {
      m.others.push({ id: "", label: "", note: "", type: "fixed", value: 0, showFree: false, enabled: true, from: "", to: "" });
      open.add("o" + (m.others.length - 1));
      paint();
      const names = root.querySelectorAll('[data-ok="label"]');
      if (names.length) names[names.length - 1].focus();
      return;
    }
    const dof = t.closest("[data-del-o]");
    if (dof) { m.others.splice(+dof.dataset.delO, 1); return paint(); }
  });

  // ---- preview (the server's own calculation) ---------------------------------------------------

  let pvTimer = 0;
  let pvSeq = 0;
  const previewSoon = () => { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 350); };

  function onPreviewField(el) {
    const k = el.dataset.pv;
    prev[k] = k === "minute" ? el.value : k === "outside" ? el.checked : toNum(el.value);
    previewSoon();
  }

  async function preview() {
    const box = $("[data-prev]");
    if (!box || !m) return;
    const seq = ++pvSeq;
    let minute = null;
    if (/^\d\d:\d\d$/.test(prev.minute)) minute = +prev.minute.slice(0, 2) * 60 + +prev.minute.slice(3);
    try {
      const q = await Api.post(`${URL}/preview`, { config: wire({ enabled: true }), items: prev.items, km: m.delivery.byDistance ? prev.km : null, minute, outside: prev.outside && areaMatters(m.delivery) });
      if (seq !== pvSeq || !$("[data-prev]")) return;
      const lines = q.lines.map((l) => `<div class="ch-pl"><span>${esc(l.label)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</span>
        <b>${l.free ? `<s>${rs(l.amount)}</s> <i class="ch-free">FREE</i>` : rs(l.charged)}</b></div>`).join("");
      box.innerHTML = `<div class="ch-pl"><span>Items</span><b>${rs(q.itemsTotal)}</b></div>${lines}
        <div class="ch-pl ch-total"><span>Customer pays</span><b>${rs(q.grand)}</b></div>
        ${q.blocked ? `<p class="ch-block">⚠ ${esc(q.blocked)}</p>` : ""}${m.enabled ? "" : `<p class="mp-note">Charges are switched off at the top, so customers see none of this yet.</p>`}`;
    } catch (err) {
      if (seq === pvSeq && $("[data-prev]")) $("[data-prev]").textContent = err.message || "Could not work it out";
    }
  }

  // ---- saving -------------------------------------------------------------------------------------

  async function save() {
    const btn = $("[data-save]");
    const st = $("[data-status]");
    if (m.enabled && m.delivery.enabled && m.delivery.byDistance && m.shopLat == null) {
      st.className = "nm-status is-bad";
      st.textContent = "Set your shop location first (needed for the distance).";
      return;
    }
    const bad = m.others.find((o) => (o.timed || o.from || o.to) && (!o.from || !o.to || o.from === o.to));
    if (bad) {
      st.className = "nm-status is-bad";
      st.textContent = `Set a start and an end time for “${bad.label || "the new charge"}”, or untick “Only at certain hours”.`;
      return;
    }
    btn.disabled = true;
    st.className = "nm-status";
    st.textContent = "Saving…";
    try {
      server = await Api.put(URL, wire());
      loadedAt = Date.now();
      m = clone(server.config);
      savedJson = JSON.stringify(m);
      paint();
      const s = $("[data-status]");
      s.className = "nm-status is-ok";
      s.textContent = "Saved ✓";
    } catch (err) {
      btn.disabled = false;
      st.className = "nm-status is-bad";
      st.textContent = err.message || "Couldn't save";
    }
  }

  // ---- the shop's pin: a small full-screen map (the same map engine and file as the customer's map) ---------------------

  async function pickShop() {
    if (document.querySelector(".ch-picker")) return;
    const st = { lat: m.shopLat, lng: m.shopLng, map: null, marker: null, closed: false };
    const ov = document.createElement("div");
    ov.className = "mp-editor ch-picker";
    ov.innerHTML = `
      <div class="mp-ed-top"><button type="button" class="mp-ed-x" data-x aria-label="Close">✕</button><div class="mp-ed-title">Where is your shop?</div></div>
      <div class="mp-ed-map" data-map><div class="mp-ed-loading" data-load><span class="spinner"></span> Loading map…</div></div>
      <div class="mp-ed-bar">
        <div class="mp-ed-hint">Tap the map (or drag the pin) to mark your shop. Distances to customers are counted from here.</div>
        <input class="mp-ed-name" data-coords placeholder="Or paste coordinates / a Google Maps link" autocomplete="off" />
        <div class="mp-ed-btns">
          <button type="button" class="btn btn-ghost btn-sm" data-here>📍 Use my location</button>
          <button type="button" class="btn btn-gold btn-sm" data-ok disabled>Use this spot</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    document.documentElement.classList.add("mp-ed-open");
    const q = (s) => ov.querySelector(s);
    const close = () => {
      st.closed = true;
      if (st.map) { try { st.map.remove(); } catch (_) { /* ignore */ } }
      ov.remove();
      document.documentElement.classList.remove("mp-ed-open");
    };
    const setSpot = (lat, lng, fly) => {
      st.lat = lat; st.lng = lng;
      q("[data-ok]").disabled = false;
      if (!st.map) return;
      if (!st.marker) {
        const dot = document.createElement("div");
        dot.className = "om-pin-dot";
        st.marker = new maplibregl.Marker({ element: dot, draggable: true }).setLngLat([lng, lat]).addTo(st.map);
        st.marker.on("dragend", () => { const p = st.marker.getLngLat(); st.lat = p.lat; st.lng = p.lng; });
      } else st.marker.setLngLat([lng, lat]);
      if (fly) st.map.easeTo({ center: [lng, lat], zoom: Math.max(st.map.getZoom(), 15), duration: 500 });
    };
    q("[data-x]").addEventListener("click", close);
    q("[data-ok]").addEventListener("click", () => {
      m.shopLat = Math.round(st.lat * 1e6) / 1e6;
      m.shopLng = Math.round(st.lng * 1e6) / 1e6;
      close();
      const pin = $("[data-pin]");
      if (pin) { pin.innerHTML = pinText(); pin.classList.add("is-set"); }
      paintSave();
      previewSoon();
    });
    q("[data-here]").addEventListener("click", () => {
      if (!navigator.geolocation) { Toast.show("This device can't tell its location", "error"); return; }
      navigator.geolocation.getCurrentPosition((p) => setSpot(p.coords.latitude, p.coords.longitude, true),
        () => Toast.show("Couldn't get your location. Tap the map instead.", "error"), { enableHighAccuracy: true, timeout: 12000 });
    });
    q("[data-coords]").addEventListener("change", (e) => {
      // "17.3850, 78.4867", or a Google Maps link containing @17.3850,78.4867 or q=17.3850,78.4867
      const t = e.target.value;
      const hit = t.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
      if (!hit) { Toast.show("Couldn't find coordinates in that", "error"); return; }
      const lat = parseFloat(hit[1]), lng = parseFloat(hit[2]);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { Toast.show("Those coordinates are not valid", "error"); return; }
      setSpot(lat, lng, true);
    });
    try {
      if (tiles === undefined) {
        try { tiles = (await Api.get("/api/admin/map")).tiles || null; } catch (_) { tiles = null; } // (no access to the map settings: plain background)
      }
      await DeliveryMap.engine();
      if (st.closed) return;
      const centre = st.lat != null ? [st.lng, st.lat] : DeliveryMap.HYDERABAD;
      const map = new maplibregl.Map({
        container: q("[data-map]"), style: DeliveryMap.styleFor(tiles), center: centre, zoom: st.lat != null ? 15 : 11.5,
        minZoom: 6, maxZoom: 19, attributionControl: false, dragRotate: false, touchPitch: false, fadeDuration: 0,
      });
      st.map = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => { if (st.closed) return; q("[data-load]").remove(); if (st.lat != null) setSpot(st.lat, st.lng, false); });
      map.on("click", (e) => setSpot(e.lngLat.lat, e.lngLat.lng, false));
    } catch (err) {
      const l = q("[data-load]");
      if (l) l.textContent = (err && err.message) || "Could not open the map";
    }
  }

  // ---- loading -------------------------------------------------------------------------------------

  async function refresh() {
    if (loading || !allowed()) return;
    if (server && (isDirty() || Date.now() - loadedAt < FRESH_MS)) return;
    loading = true;
    if (!server) root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;
    try {
      server = await Api.get(URL);
      loadedAt = Date.now();
      m = clone(server.config);
      savedJson = JSON.stringify(m);
      paint();
    } catch (err) {
      if (!server) root.innerHTML = `<div class="empty-state"><p>${esc(err.message || "Couldn't load the charges")}</p></div>`;
    } finally {
      loading = false;
    }
  }

  document.addEventListener("freshcutz:logout", () => { server = null; m = null; loadedAt = 0; tiles = undefined; root.innerHTML = ""; });
  return { refresh };
})();
