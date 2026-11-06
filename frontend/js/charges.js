/* Delivery & other charges on the customer website.
 *
 * ONE place for every screen that shows a total (the cart, the Final Step, the delivery form, the order-success screen, My Orders):
 *   Charges.mount(el, {label, form, only})   draws "items + charges + total" into el and keeps it right (cart changes, the admin changes
 *                                      the charges, the pin moves, a timed charge starts / ends)
 *   Charges.html(items, pin, label)    the same as a string (for screens built from strings)
 *   Charges.orderRows(order)           the saved charges of an order that was placed (they never change after that)
 *   Charges.blocked()                  why the order cannot be placed now (minimum order / too far), or ""
 *   Charges.settle(form)               before placing: makes sure the charges and the distance are up to date; returns the total
 *                                      the customer is looking at (sent with the order so a change in between is caught)
 *
 * This file only REPEATS the server's rules (server/ChargesCalculator.java) to show the charges while the cart is open: money in
 * paise and distance in tenths of a km, so the page and the server always agree to the paisa. The server works them out again when
 * the order is placed, and what it says is what counts. The shop's own position never reaches this page: the distance of the
 * customer's pin comes from the server (one small, cached request per pin). */

window.Charges = (() => {
  const KEY = "fc_charges_v1";
  const CONFIRM_MS = 8 * 1000; // how long the live connection is given to confirm the held charges (see "live" below)
  const FRESH_MS = 30 * 1000; // (a page that is open hears changes at once from the live stream; this is for one that was closed or reloaded: it asks again if what it holds is older than this)
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const money = (paise) => Utils.formatMoney(paise / 100);
  const paise = (rupees) => Math.round(Number(rupees || 0) * 100);

  let data = null;       // { config, zone, v, hasPin, at }
  let loading = null;
  const kmCache = new Map();  // "lat,lng" -> { km (number | null = cannot tell), outside }
  const kmFlying = new Map(); // "lat,lng" -> promise
  let kmBust = "";            // after the server said "changed": distances are asked past the browser's 30 second copy
  const mounts = new Set();   // { el, label, form }
  let tick = 0;

  try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { data = null; }
  if (data && !(data.config && typeof data.config === "object")) data = null;

  // ---- the settings --------------------------------------------------------------------------------

  function apply(d, fromServer) {
    if (!d || !d.config) return;
    if (data && data.v && data.v === d.v) { data.at = Date.now(); return; }
    data = { config: d.config, zone: d.zone, v: d.v, hasPin: d.hasPin, at: fromServer === false ? 0 : Date.now() };
    kmCache.clear(); // (the shop's pin or the road factor may have changed)
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* private mode: kept in memory only */ }
    renderAll();
    notify();
  }

  /** Reads the charges from the server - unless forced, only when they cannot be trusted to be current: while the live connection is
   * open and has confirmed them (live), nothing is asked; otherwise at most every 30 seconds. */
  function ensure(force) {
    if (loading) return loading;
    if (!force && data && (live || Date.now() - since < CONFIRM_MS || Date.now() - (data.at || 0) < FRESH_MS)) return Promise.resolve();
    loading = Api.get("/api/store/charges" + (force ? "?_=" + Date.now() : "")) // (forced: not from the browser's 10 second copy)
      .then((d) => apply(d))
      .catch(() => { /* offline: what is held stays */ })
      .finally(() => { loading = null; });
    return loading;
  }

  // The live connection keeps this page right without asking: each time it opens, the server is told which version is held and answers
  // with the new charges, or "same" (freshcutz:chsame); a change the admin saves afterwards is pushed (freshcutz:charges). Once it has
  // answered, nothing is requested. An older server never answers: then (live stays off) the page asks, at most every FRESH_MS.
  // (a connection that has just opened - or a page that has just loaded - is given CONFIRM_MS to answer before the page asks itself)
  let live = false;
  let since = Date.now();
  window.addEventListener("freshcutz:stream", () => { live = false; since = Date.now(); }); // (opened again: wait for its answer)
  window.addEventListener("freshcutz:chsame", () => { live = true; });
  window.addEventListener("freshcutz:charges", (e) => { live = true; if (e.detail) apply(e.detail); });

  const refresh = () => { if (data && !live) ensure(false); };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  const on = () => !!(data && data.config && data.config.enabled);

  // ---- the pin and its distance --------------------------------------------------------------------

  function storedPin() {
    try {
      const v = JSON.parse(localStorage.getItem("freshcutz_map_pin") || "null");
      return v && isFinite(v.lat) && isFinite(v.lng) ? { lat: +v.lat, lng: +v.lng } : null;
    } catch (_) { return null; }
  }

  /** The pin this order will carry: the form's (an address being typed / the Final Step's), else the one saved on this phone. */
  function pinOf(form) {
    if (!window.DeliveryMap || !DeliveryMap.isEnabled()) return null; // (the server ignores the pin while the map is off)
    if (form) {
      const lat = parseFloat((form.querySelector('[name="deliveryLat"]') || {}).value);
      const lng = parseFloat((form.querySelector('[name="deliveryLng"]') || {}).value);
      return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
    }
    return storedPin();
  }

  const pinKey = (p) => p.lat + "," + p.lng;

  /** What the server says about a pin: {km, outside} (km null = cannot tell; outside = outside the delivery areas the admin drew),
   * null = nothing to ask, undefined = still asking. Asked only when it matters: the charge follows the distance, or "show as free"
   * does not reach customers outside the delivery areas, or "free above" (which never reaches them) is on. */
  function infoOf(pin) {
    const c = data && data.config;
    const d = c && c.delivery;
    if (!pin || !c || !c.enabled || !d || !d.enabled || !(d.byDistance || d.freeAbove > 0 || (d.showFree && d.chargeOutside))) return null;
    const k = pinKey(pin);
    if (kmCache.has(k)) return kmCache.get(k);
    if (!kmFlying.has(k)) {
      kmFlying.set(k, Api.get(`/api/store/charges/km?lat=${encodeURIComponent(pin.lat)}&lng=${encodeURIComponent(pin.lng)}${kmBust}`)
        .then((r) => { kmCache.set(k, { km: r && typeof r.km === "number" ? r.km : null, outside: !!(r && r.outside) }); })
        .catch(() => { kmCache.set(k, { km: null, outside: false }); })
        .finally(() => { kmFlying.delete(k); renderAll(); notify(); }));
    }
    return undefined;
  }

  // ---- the calculation (a copy of ChargesCalculator.java, for showing only) --------------------------------

  function minuteNow() {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: data.zone || "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
      const h = +parts.find((p) => p.type === "hour").value, m = +parts.find((p) => p.type === "minute").value;
      return h * 60 + m;
    } catch (_) {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  function inWindow(from, to, minute) {
    if (!from || !to) return true;
    const a = +from.slice(0, 2) * 60 + +from.slice(3), b = +to.slice(0, 2) * 60 + +to.slice(3);
    if (a === b) return true;
    return a < b ? minute >= a && minute < b : minute >= a || minute < b;
  }

  /** {lines:[{label,note,amount,charged,free}] (paise), items, charges, grand, blocked, need (paise more for free delivery), pending} */
  function quote(itemsRupees, pin) {
    const items = paise(itemsRupees);
    const c = data && data.config;
    const out = { lines: [], items, charges: 0, grand: items, blocked: "", need: 0, pending: false };
    if (!c || !c.enabled) return out;
    if (c.minOrder > 0 && items < paise(c.minOrder)) {
      out.blocked = `The minimum order is ₹${plain(c.minOrder)}. Please add ₹${plain((paise(c.minOrder) - items) / 100)} more.`;
    }
    const d = c.delivery;
    if (d && d.enabled) {
      let amount = paise(d.base);
      let far = false; // the distance made the charge higher than the usual one (the base charge; with steps: the nearest step)
      let usual = paise(d.base);
      const info = infoOf(pin);
      if (info === undefined) out.pending = true;
      const outside = !!(info && info.outside);
      if (d.byDistance) {
        const km = info ? info.km : null;
        if (km !== null) {
          const t = Math.round(km * 10);
          if (d.method === "slabs") {
            if ((d.slabs || []).length) usual = paise(d.slabs[0].amount);
            const hit = (d.slabs || []).find((s) => t <= Math.round(s.upToKm * 10));
            if (hit) amount = paise(hit.amount);
            else if (d.beyond === "block") { if (!out.blocked) out.blocked = "Sorry, we don't deliver that far."; }
            else amount = paise(d.beyondAmount);
          } else {
            const over = t - Math.round(d.freeKm * 10);
            if (over > 0) amount += Math.floor((over + 9) / 10) * paise(d.perKm);
            if (d.maxCharge > 0) amount = Math.min(amount, paise(d.maxCharge));
          }
          far = amount > usual;
        }
      }
      // "free above": one amount inside the delivery area, its own (with distance on) outside it; 0 = off
      const limit = outside ? (d.byDistance ? d.farFreeAbove : 0) : d.freeAbove;
      const above = limit > 0 && items >= paise(limit);
      const showAll = d.showFree && (d.chargeOutside || !(d.freeAbove > 0)); // ("show as free" for everyone and "free above" cancel each other: see ChargesConfig.normalized)
      const offer = showAll && !(outside && d.chargeOutside);
      const waived = offer || above;
      // delivery is free: its small line ("Free above ₹499") has nothing left to say, so it is left out
      const own = limit > 0 ? (outside ? d.farNote : d.note) : ""; // the admin's small line belongs to "free delivery above a total": shown only while that is on
      // charged more because of the distance: the name says so ("Delivery charges (Long Distance)"); nothing to say when it is free
      out.lines.push(line(far && !waived ? `${d.label} (Long Distance)` : d.label, waived ? "" : own, amount, waived && amount > 0, "delivery"));
      if (!waived && limit > 0 && amount > 0) out.need = paise(limit) - items;
    }
    const minute = (c.others || []).some((o) => o.from && o.to) ? minuteNow() : 0;
    for (const o of c.others || []) {
      if (!o.enabled || !inWindow(o.from, o.to, minute)) continue;
      const amount = o.type === "percent" ? Math.round(items * o.value / 100) : paise(o.value);
      out.lines.push(line(o.label, o.note, amount, o.showFree && amount > 0));
    }
    out.charges = out.lines.reduce((s, l) => s + l.charged, 0);
    out.grand = items + out.charges;
    return out;
  }

  const line = (label, note, amount, free, key) => ({ key: key || "", label, note: note || "", amount, charged: free ? 0 : amount, free });
  const plain = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)); // 40 -> "40", 12.5 -> "12.5"

  // ---- drawing ----------------------------------------------------------------------------------------

  /** One charge, as a row: its name, the small line under it, and its amount (a waived one: the real amount struck through + FREE). */
  function rowHtml(l) {
    const amt = l.free
      ? `<s class="chg-strike">${money(l.amount)}</s> <b class="chg-free">FREE</b>`
      : money(l.charged);
    // the small line is behind a round "i": tap it to show / hide the line (what was opened stays open while the screen redraws)
    // (the delivery charge's line is always shown right under it; the other charges' lines are behind the "i")
    const inline = l.key === "delivery";
    const open = inline || openNotes.has(l.label);
    const info = l.note && !inline
      ? `<button type="button" class="chg-i" data-chg-i="${esc(l.label)}" aria-label="More about ${esc(l.label)}" aria-expanded="${open}">i</button>`
      : "";
    return `<div class="summary-row chg-row"><span>${esc(l.label)}${info}${l.note ? `<small class="chg-note"${open ? "" : " hidden"}>${esc(l.note)}</small>` : ""}</span><span>${amt}</span></div>`;
  }

  const openNotes = new Set();
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-chg-i]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const note = b.parentElement.querySelector(".chg-note");
    if (!note) return;
    const show = note.hidden;
    note.hidden = !show;
    b.setAttribute("aria-expanded", String(show));
    const name = b.dataset.chgI;
    if (show) openNotes.add(name); else openNotes.delete(name);
  });

  // a dashed line, then "Items total" and the charges: they never run into the list of items above them
  const itemsRow = (p) => `<div class="chg-sep" aria-hidden="true"></div><div class="summary-row chg-items"><span>Items total</span><span>${money(p)}</span></div>`;

  /** The green / blue tip under the charges: how much more for free delivery, or which charges are free on this order
   * (the cart page only gets the first: "which are free" is said on the Final Step). */
  function tipHtml(q, nudgeOnly) {
    if (q.need > 0) return `<div class="chg-nudge">🛵 Add <b>${money(q.need)}</b> more for <b>free delivery</b></div>`;
    if (nudgeOnly) return "";
    const lines = q.lines.filter((l) => l.free);
    const free = lines.map((l) => esc(l.label));
    if (!free.length) return "";
    const names = free.length > 1 ? free.slice(0, -1).join(", ") + " and " + free[free.length - 1] : free[0];
    // "Delivery charges are free on this order." / "Packing is free on this order." (a name that ends in "s" reads as a plural)
    const plural = free.length > 1 || /[^s]s$/i.test(String(lines[0].label).trim());
    return `<div class="chg-nudge">🎉 <b>${names}</b> ${plural ? "are" : "is"} free on this order.</div>`;
  }

  const blockedHtml = (q) => (q.blocked ? `<div class="chg-blocked" role="alert">${esc(q.blocked)}</div>` : "");

  /** The total area of one screen, by mode:
   *   false   the list of items' panel: items total, each charge, the tip, the total (never the minimum-order message: it sits by the button)
   *   true    the bar above Place Order: the total and the minimum-order message
   *   "cart"  the cart page: the items total, the "add ₹X more" tip and the minimum-order message (the charges themselves are shown on the Final Step)
   * With no charges it is only the ordinary total row, exactly as before charges existed. */
  const html = (itemsRupees, pin, labelHtml, mode) => draw(quote(itemsRupees, pin), labelHtml, mode);

  function draw(q, labelHtml, mode) {
    const total = `<div class="summary-row total"><span>${labelHtml}</span><span>${money(mode === "cart" ? q.items : q.grand)}</span></div>`;
    if (mode === true) return total + blockedHtml(q);
    if (mode === "cart") return tipHtml(q, true) + total + blockedHtml(q);
    if (!q.lines.length) return total;
    return itemsRow(q.items) + q.lines.map(rowHtml).join("") + tipHtml(q) + total;
  }

  /** A few words for the small cart bar on the home page: only when the admin set "free delivery above ..." (else ""). */
  function barTip(itemsRupees) {
    if (!on()) return "";
    const q = quote(itemsRupees, storedPinIfOn());
    return q.need > 0 ? `Add ${money(q.need)} more for free delivery` : "";
  }
  const storedPinIfOn = () => (window.DeliveryMap && DeliveryMap.isEnabled() ? storedPin() : null);

  const subs = new Set();
  /** fn() is called whenever what the charges say may have changed (new settings, a distance arrived). */
  function onChange(fn) { subs.add(fn); }
  function notify() { subs.forEach((fn) => { try { fn(); } catch (_) { /* a listener's own problem */ } }); }

  /** The charges an order was placed with (saved with it): items row + one row per charge, or "" when it had none. */
  function orderRows(order) {
    const ls = order && Array.isArray(order.charges) ? order.charges : [];
    if (!ls.length) return "";
    const items = order.itemsTotal != null ? paise(order.itemsTotal) : paise(order.totalAmount) - ls.reduce((s, l) => s + paise(l.charged), 0);
    return itemsRow(items) + ls.map((l) => rowHtml({ key: l.key, label: l.label, note: l.note, amount: paise(l.amount), charged: paise(l.charged), free: !!l.free })).join("");
  }

  function paint(m) {
    const q = quote(Cart.getTotal(), pinOf(m.form && m.form.isConnected ? m.form : null)); // (worked out once for both the drawing and the button)
    m.el.innerHTML = draw(q, typeof m.label === "function" ? m.label() : m.label, m.only);
    const btn = m.el.closest(".sheet-footer") && m.el.closest(".sheet-footer").querySelector("button.btn-gold");
    if (btn) btn.classList.toggle("is-blocked", !!(on() && q.blocked));
  }

  function renderAll() {
    for (const m of mounts) {
      if (!m.el.isConnected) { mounts.delete(m); continue; }
      paint(m);
    }
    if (!mounts.size) stopTick();
  }

  /** Draws the total area into el now, and keeps it right while el is on screen. */
  function mount(el, opts) {
    if (!el) return;
    const o = opts || {};
    const m = { el, label: o.label || "", form: o.form || null, only: o.only || false };
    for (const x of mounts) if (x.el === el) mounts.delete(x);
    mounts.add(m);
    paint(m);
    ensure(false).then(() => {});
    if (on() && (data.config.others || []).some((x) => x.from && x.to)) startTick();
  }

  // a charge that only applies at certain hours starts / stops while the cart is open: looked at once a minute, only then
  function startTick() {
    if (tick) return;
    tick = setInterval(() => { if (!document.hidden) renderAll(); }, 60000);
  }
  function stopTick() {
    if (tick) { clearInterval(tick); tick = 0; }
  }

  Cart.onChange(() => { if (mounts.size) renderAll(); });
  document.addEventListener("freshcutz:pin", () => { if (mounts.size) renderAll(); notify(); });
  document.addEventListener("freshcutz:pinmoved", () => { if (mounts.size) renderAll(); });
  document.addEventListener("freshcutz:map", () => { if (mounts.size) renderAll(); notify(); });

  // ---- placing the order -----------------------------------------------------------------------------------

  /** Why the order cannot be placed right now ("" = it can). */
  function blocked(form) {
    if (!on()) return "";
    return quote(Cart.getTotal(), pinOf(form && form.isConnected ? form : null)).blocked;
  }

  /** Before placing the order: the charges and the distance are brought up to date (a moment, only when something is missing) and the
   * total the customer is looking at is returned ({total, blocked}); total is undefined when the charges could not be read at all. */
  async function settle(form) {
    await ensure(false);
    const pin = pinOf(form);
    if (pin && on()) {
      const t0 = Date.now();
      while (quote(Cart.getTotal(), pin).pending && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 120));
    }
    const q = quote(Cart.getTotal(), pin);
    return { total: data ? Math.round(q.grand) / 100 : undefined, blocked: on() ? q.blocked : "" };
  }

  /** The server refused because what the page showed is out of date: read everything again so the screen shows the right total. */
  function stale() {
    kmCache.clear();
    kmBust = "&_=" + Date.now();
    return ensure(true).then(renderAll);
  }

  const version = () => (data && data.v) || "";

  return { version, mount, html, orderRows, blocked, settle, stale, ensure, on, rowHtml, quote, barTip, onChange };
})();
