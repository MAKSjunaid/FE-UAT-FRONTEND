/* Orders tab: "Navigate all" - tick several orders, get ONE delivery route and open it in Google Maps.
 *
 * Switched on/off by the owner (Settings -> Delivery map -> Navigate all); the switch and the number of stops per Google Maps trip
 * arrive with the Orders list (AdminNavAll.configure), so this file makes NO request of its own for the admin (a delivery boy only asks for his own route). While it is off it adds nothing
 * to the page. Everything else is worked out here on the phone:
 *   - orders whose pins are in the same building become ONE stop (same address and a few metres apart, or almost on top of each other);
 *   - the stops are put in the shortest visiting order (exact search for up to 12 stops, a quick good method above that),
 *     optionally starting nearest to where the admin is; Reverse and up / down arrows change it by hand;
 *   - optional ROUND TRIP (the owner switches the option on in Settings): the route starts at the place the admin is standing when
 *     planning (read from the phone's location, kept nowhere), visits every stop and comes back to that place;
 *   - the stops are cut into trips of N stops (the owner's setting; Google's own limit is about 9) and each trip opens in Google Maps
 *     with its stops in exactly that order. Google starts from wherever the person who opens the link is standing.
 * Delivery boys: "Save route" (on the route screen) gives the arranged route to one of the delivery-boy logins made in Settings -> Users
 * (server: RouteService). When he signs in, the top of his Orders tab shows "My route": his stops in that order, with Call, Open in
 * Google Maps and Delivered. "Routes" (next to "Plan a delivery route") lists the saved routes: edit or delete them.
 * "Couldn't deliver": on My Route a stop has a "↩ Couldn't deliver" button (a reason, and a few words for "Other"); the order stays open, the stop
 * moves to his finished stops, the shop's phones get an alert, and the order card shows a red "↩ Ravi couldn't deliver · reason · time" tag with Retry
 * and Unassign (also on the Assigned routes screen). Every failed attempt is kept for good: "Tried N times" on the card lists them.
 * Orders on a saved route carry an "On route: Ravi" tag (it arrives with the Orders list) and cannot be put on a second route.
 * Distances are straight lines (no traffic, no one-way streets): Google shows the real road route after it opens. */

window.AdminNavAll = (() => {
  const list = document.getElementById("ordersList");
  if (!list) return { configure() {} };

  const esc = (s) => (typeof Utils !== "undefined" ? Utils.escapeHtml(s == null ? "" : String(s)) : String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const MAX_PICK = 60;       // most orders in one route
  const SAME_SPOT_M = 20;    // pins this close are the same stop whatever the address says
  const SAME_BLDG_M = 75;    // pins this close are the same stop when the address (without the flat) is the same
  const EXACT_MAX = 12;      // up to this many stops the best order is found exactly

  let on = false;
  let perTrip = 5;
  let roundOk = false;       // the owner's setting: the Round trip switch is offered on the route screen
  const PREF = "fc_na_round"; // this phone remembers whether Round trip was last used
  let selecting = false;
  const picked = new Map();  // order id -> { id, code, name, flat, addr, lat, lng }
  let bar = null;            // the "Plan a delivery route" button row above the list
  let foot = null;           // the "N selected" bar at the bottom
  let sheet = null;          // the route screen
  let rsheet = null;         // the Routes screen (saved routes)
  const tagMap = new Map();  // order id -> name of the delivery boy whose saved route holds it
  const failMap = new Map(); // order id -> { tries, failed, hist:[{by,label,note,at}] }: "Couldn't deliver" reports, newest first (kept for good on the server)
  const histOpen = new Set(); // order ids whose list of failed attempts is open
  let ridersCache = null;    // the delivery boys, as last read for the Save dialog
  let observer = null;
  let visObs = null;         // watches whether the Orders list is on screen
  let raf = 0;
  let styled = false;

  // ---- "Sees only assigned orders": a line above his list saying why it is short ---------------
  let ownEl = null;
  function ownNote(on) {
    if (!on) { if (ownEl) { ownEl.remove(); ownEl = null; } return; }
    if (ownEl && ownEl.isConnected) return;
    injectStyle();
    ownEl = document.createElement("p");
    ownEl.className = "na-ownnote";
    ownEl.textContent = "Showing only the orders given to you. Your stops in order are in the My Route tab.";
    list.parentNode.insertBefore(ownEl, list);
  }

  // ---- settings ---------------------------------------------------------------
  function configure(cfg) {
    const nowOn = cfg && cfg.on !== undefined ? !!cfg.on : on; // a list copied from an older visit may not carry the setting: then leave things as they are
    const n = cfg && Number(cfg.stops);
    if (Number.isFinite(n) && n >= 1) perTrip = Math.floor(n);
    if (cfg && cfg.round !== undefined) roundOk = !!cfg.round;
    if (cfg && cfg.own !== undefined) ownNote(!!cfg.own);
    if (cfg && cfg.tags && typeof cfg.tags === "object") Object.keys(cfg.tags).forEach((k) => tagMap.set(String(k), cfg.tags[k]));
    if (cfg && cfg.fails && typeof cfg.fails === "object") Object.keys(cfg.fails).forEach((k) => failMap.set(String(k), cfg.fails[k]));
    if (!roundOk && route.round) { route.round = false; route.stops = sortStops(route.stops, route.from, false); }
    if (nowOn === on) { if (sheet) renderSheet(); if (on) refreshCards(); return; }
    on = nowOn;
    if (on) start(); else stop();
  }

  function start() {
    injectStyle();
    bar = document.createElement("div");
    bar.className = "na-top";
    bar.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" data-na="toggle">🧭 Plan a delivery route</button><button type="button" class="btn btn-ghost btn-sm" data-na="routes">🛵 Assigned routes</button><button type="button" class="na-link" data-na="all" hidden>Select all with a pin</button>`;
    list.parentNode.insertBefore(bar, list);
    bar.addEventListener("click", onBarClick);
    list.addEventListener("click", onListClick);
    observer = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refreshCards(); }); });
    observer.observe(list, { childList: true });
    // The "N selected" bar sits on top of the whole page, so leaving the Orders tab ends the ticking (and takes the bar away).
    if (typeof IntersectionObserver !== "undefined") {
      visObs = new IntersectionObserver(() => { if (selecting && !list.getClientRects().length) exitSelecting(); });
      visObs.observe(list);
    }
    refreshCards();
  }

  /** The cards on screen: the "On route" tags, and (while ticking) the tick buttons. */
  function refreshCards() {
    paintTags();
    if (selecting) decorate();
  }

  const finalCard = (card) => !!card.querySelector(".badge-delivered, .badge-cancelled");

  /** Time of a report: just the time when it was today, else the date too. */
  function stamp(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : when(iso);
    } catch (_) { return ""; }
  }
  const failWords = (h) => (h ? `${h.label || ""}${h.note ? `: ${h.note}` : ""}` : "");

  /** The tag on an order card: who it is on (with Change / Unassign), or, when the delivery boy could not deliver it, the red report with Retry / Unassign;
   * plus a "Tried N times" line that opens the history of failed attempts (kept even after the order was taken off the route). */
  function tagHtml(id, name, fe) {
    const h = fe && fe.hist && fe.hist[0];
    let row;
    if (fe && fe.failed && h) {
      row = `<span class="na-tagtxt">↩ ${esc(h.by || "The delivery boy")} couldn't deliver · ${esc(failWords(h))} · ${esc(stamp(h.at))}</span><span class="na-tagacts"><button type="button" class="na-tagbtn" data-na-retry>Retry</button><button type="button" class="na-tagbtn is-un" data-na-unassign>Unassign</button></span>`;
    } else if (name) {
      row = `<span class="na-tagtxt">🛵 On route: ${esc(name)}</span><span class="na-tagacts"><button type="button" class="na-tagbtn" data-na-change>Change</button><button type="button" class="na-tagbtn is-un" data-na-unassign>Unassign</button></span>`;
    } else {
      row = `<span class="na-tagtxt">↩ Could not be delivered · ${esc(failWords(h))} · ${esc(stamp(h && h.at))}</span>`;
    }
    let hist = "";
    if (fe && fe.tries > ((fe.failed || !name) ? 1 : 0)) {
      const open = histOpen.has(id);
      const lines = open ? `<div class="na-histlist">${(fe.hist || []).map((x) => `<div>${esc(stamp(x.at))} · ${esc(x.by || "")} · ${esc(failWords(x))}</div>`).join("")}${fe.tries > (fe.hist || []).length ? `<div>…</div>` : ""}</div>` : "";
      hist = `<div class="na-taghist"><button type="button" class="na-tagbtn" data-na-hist aria-expanded="${open}">${fe.tries === 1 ? "Tried once" : `Tried ${fe.tries} times`} ${open ? "▴" : "▾"}</button>${lines}</div>`;
    }
    return `<div class="na-tagrow">${row}</div>${hist}`;
  }

  function paintTags() {
    list.querySelectorAll(".order-card").forEach((card) => {
      const id = card.dataset.id;
      const name = tagMap.get(id);
      const fe = failMap.get(id);
      let t = card.querySelector(":scope > .na-tag");
      if ((name || (fe && fe.tries)) && !finalCard(card)) {
        const h0 = fe && fe.hist && fe.hist[0];
        const sig = [name || "", fe ? `${fe.tries}:${fe.failed ? 1 : 0}:${h0 ? h0.at : ""}:${histOpen.has(id) ? 1 : 0}` : ""].join("|");
        if (!t) { t = document.createElement("div"); card.prepend(t); }
        if (t.dataset.sig !== sig) { // the words are plain text; only the small buttons act (a tap anywhere else on a card expands its charges)
          t.dataset.sig = sig;
          t.className = "na-tag" + (fe && fe.failed ? " is-fail" : (!name ? " is-note" : ""));
          t.innerHTML = tagHtml(id, name, fe);
        }
      } else if (t) t.remove();
    });
  }

  function stop() {
    closeSheet();
    closeRoutes();
    exitSelecting();
    tagMap.clear();
    failMap.clear();
    histOpen.clear();
    ridersCache = null;
    list.querySelectorAll(".na-tag").forEach((n) => n.remove());
    if (observer) observer.disconnect();
    observer = null;
    if (visObs) visObs.disconnect();
    visObs = null;
    list.removeEventListener("click", onListClick);
    if (bar) bar.remove();
    bar = null;
  }

  // ---- ticking orders ---------------------------------------------------------
  function onBarClick(e) {
    const b = e.target.closest("[data-na]");
    if (!b) return;
    if (b.dataset.na === "toggle") { selecting ? exitSelecting() : enterSelecting(); }
    else if (b.dataset.na === "all") selectAllVisible();
    else if (b.dataset.na === "routes") openRoutes();
  }

  function enterSelecting() {
    selecting = true;
    list.classList.add("na-on");
    bar.querySelector('[data-na="toggle"]').textContent = "✕ Cancel";
    bar.querySelector('[data-na="all"]').hidden = false;
    makeFoot();
    decorate();
    paintFoot();
  }

  function exitSelecting() {
    selecting = false;
    picked.clear();
    list.classList.remove("na-on");
    list.querySelectorAll(".na-pick, .na-nopin").forEach((n) => n.remove());
    list.querySelectorAll(".na-sel").forEach((n) => n.classList.remove("na-sel"));
    if (bar) {
      bar.querySelector('[data-na="toggle"]').textContent = "🧭 Plan a delivery route";
      bar.querySelector('[data-na="all"]').hidden = true;
    }
    if (foot) foot.remove();
    foot = null;
  }

  /** What the order's card says, read from the page (no request). null when the order has no pin. */
  function readCard(card) {
    const pin = card.dataset.pin;
    if (!pin) return null;
    const [lat, lng] = pin.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const addr = ((card.querySelector(".oc-addr") || {}).textContent || "").replace(/^[^\w]*/, "").trim();
    const cut = addr.indexOf(",");
    return {
      id: card.dataset.id,
      code: ((card.querySelector(".order-code-lbl") || {}).textContent || "").trim(),
      name: ((card.querySelector(".order-customer strong") || {}).textContent || "").trim(),
      flat: cut > 0 ? addr.slice(0, cut).trim() : "",
      addr: cut > 0 ? addr.slice(cut + 1).trim() : addr,
      lat, lng,
    };
  }

  /** Puts a tick button on every order card on screen (and marks the ticked ones). An order with no pin, or already on a rider's route, gets a note instead. */
  function decorate() {
    list.querySelectorAll(".order-card").forEach((card) => {
      const id = card.dataset.id;
      const blocked = !card.dataset.pin ? "No map pin on this order, so it can't be added to a route"
        : tagMap.has(id) && !finalCard(card) ? `Already on ${tagMap.get(id)}'s route` : "";
      let btn = card.querySelector(":scope > .na-pick, :scope > .na-nopin");
      if (btn && ((blocked && btn.classList.contains("na-pick")) || (!blocked && btn.classList.contains("na-nopin")))) { btn.remove(); btn = null; }
      if (!btn) {
        if (blocked) {
          btn = document.createElement("div");
          btn.className = "na-nopin";
        } else {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = "na-pick";
        }
        card.prepend(btn);
      }
      if (blocked) {
        if (btn.textContent !== blocked) btn.textContent = blocked;
        picked.delete(id);
        card.classList.remove("na-sel");
        return;
      }
      const isOn = picked.has(id);
      card.classList.toggle("na-sel", isOn);
      btn.textContent = isOn ? "✓ In the route" : "＋ Add to the route";
      btn.setAttribute("aria-pressed", isOn ? "true" : "false");
    });
    paintFoot();
  }

  function onListClick(e) {
    const rt = e.target.closest("[data-na-retry]");
    if (rt) { // the same delivery boy tries again: the order goes back into his list (the history of attempts stays)
      const card = rt.closest(".order-card");
      const id = card && card.dataset.id;
      if (id && typeof Api !== "undefined") {
        rt.disabled = true;
        Api.post(`/api/admin/routes/orders/${id}/retry`).then(() => {
          const fe = failMap.get(String(id));
          if (fe) fe.failed = false;
          refreshCards();
          if (rsheet) loadRoutes();
          if (typeof Toast !== "undefined") Toast.show(`Back on ${tagMap.get(String(id)) || "the delivery boy"}'s list`, "success");
        }).catch((err) => { rt.disabled = false; toast(err.message || "Could not retry"); });
      }
      return;
    }
    const hb = e.target.closest("[data-na-hist]");
    if (hb) { // open / close the list of failed attempts
      const card = hb.closest(".order-card");
      const id = card && card.dataset.id;
      if (id) { if (histOpen.has(id)) histOpen.delete(id); else histOpen.add(id); refreshCards(); }
      return;
    }
    const un = e.target.closest("[data-na-unassign]");
    if (un) { // takes THIS order off its route; the order belongs to nobody afterwards (two taps)
      const card = un.closest(".order-card");
      const id = card && card.dataset.id;
      if (id && typeof Api !== "undefined") {
        armed(un, "Tap again to unassign", async () => {
          un.disabled = true;
          try {
            await Api.del(`/api/admin/routes/orders/${id}`);
            tagMap.delete(String(id));
            const fe = failMap.get(String(id));
            if (fe) fe.failed = false; // off the route: no longer waiting for a decision, but the attempts stay in the history
            refreshCards();
            if (rsheet) loadRoutes();
          } catch (err) { un.disabled = false; toast(err.message || "Could not unassign"); }
        }, { title: "Unassign this order?", message: "It will be taken off the route and belong to nobody.", confirmText: "Yes, unassign", cancelText: "Keep it", tone: "gold", icon: "↺" });
      }
      return;
    }
    if (e.target.closest("[data-na-change]")) { openRoutes(); return; } // the "Change" button on the "On route: NAME" tag opens the saved routes, to change or remove it
    if (!selecting) return;
    const btn = e.target.closest(".na-pick");
    if (!btn) return;
    const card = btn.closest(".order-card");
    const id = card.dataset.id;
    if (picked.has(id)) picked.delete(id);
    else {
      if (picked.size >= MAX_PICK) { toast(`You can add up to ${MAX_PICK} orders to one route`); return; }
      const o = readCard(card);
      if (o) picked.set(id, o);
    }
    decorate();
    paintFoot();
  }

  function selectAllVisible() {
    list.querySelectorAll(".order-card[data-pin]").forEach((card) => {
      if (picked.size >= MAX_PICK || picked.has(card.dataset.id) || (tagMap.has(card.dataset.id) && !finalCard(card))) return;
      const o = readCard(card);
      if (o) picked.set(o.id, o);
    });
    decorate();
    paintFoot();
  }

  function makeFoot() {
    foot = document.createElement("div");
    foot.className = "na-foot";
    foot.innerHTML = `<span class="na-count" data-na-count></span><button type="button" class="btn btn-ghost btn-sm" data-nf="clear">Clear</button><button type="button" class="btn btn-gold btn-sm" data-nf="go">Plan route</button>`;
    document.body.appendChild(foot);
    foot.addEventListener("click", (e) => {
      const b = e.target.closest("[data-nf]");
      if (!b) return;
      if (b.dataset.nf === "clear") { picked.clear(); decorate(); paintFoot(); }
      else if (b.dataset.nf === "go" && picked.size) openSheet();
    });
  }

  function paintFoot() {
    if (!foot) return;
    const n = picked.size;
    foot.querySelector("[data-na-count]").textContent = n ? `${n} order${n === 1 ? "" : "s"} selected` : "Tap “Add to the route” on the orders";
    foot.querySelector('[data-nf="go"]').disabled = !n;
    foot.querySelector('[data-nf="clear"]').disabled = !n;
  }

  function toast(msg) {
    if (typeof Toast !== "undefined") Toast.show(msg, "error");
  }

  // ---- stops, order, trips ----------------------------------------------------
  const rad = Math.PI / 180;
  /** Straight-line metres between two points. */
  function dist(aLat, aLng, bLat, bLng) {
    const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const bldgKey = (addr) => String(addr || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  /** Orders in the same building become one stop. */
  function buildStops(orders) {
    const stops = [];
    orders.forEach((o) => {
      const key = bldgKey(o.addr);
      let best = null, bestD = Infinity;
      for (const s of stops) {
        const d = dist(o.lat, o.lng, s.lat, s.lng);
        const same = d <= SAME_SPOT_M || (d <= SAME_BLDG_M && key && s.keys.has(key));
        if (same && d < bestD) { best = s; bestD = d; }
      }
      if (best) {
        best.orders.push(o);
        best.keys.add(key);
        const n = best.orders.length; // the stop sits at the middle of its pins
        best.lat += (o.lat - best.lat) / n;
        best.lng += (o.lng - best.lng) / n;
      } else {
        stops.push({ lat: o.lat, lng: o.lng, orders: [o], keys: new Set([key]) });
      }
    });
    return stops;
  }

  /** Shortest way through the stops, starting at `from` ({lat,lng}) or - when there is none - wherever is best.
   *  Up to EXACT_MAX stops: exact (Held-Karp). More: nearest neighbour, then 2-opt. Returns the stops in visiting order. */
  function sortStops(stops, from, closed) {
    const m = stops.length;
    if (m < 3 && !closed) return from && m === 2 && dist(from.lat, from.lng, stops[1].lat, stops[1].lng) < dist(from.lat, from.lng, stops[0].lat, stops[0].lng) ? [stops[1], stops[0]] : stops.slice();
    const n = m + 1; // node m = the start (a real point, or a dummy that is 0 from everywhere)
    const d = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) d[i][j] = d[j][i] = dist(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
      d[m][i] = d[i][m] = from ? dist(from.lat, from.lng, stops[i].lat, stops[i].lng) : 0;
    }
    const order = m <= EXACT_MAX ? heldKarp(d, m, !!closed) : heuristic(d, m, !!from, !!closed);
    const res = order.map((i) => stops[i]);
    // A round trip is planned as a loop; it is then opened at the admin's end, so the LAST stop is the one nearest to the admin.
    if (closed && from && res.length > 1 && dist(from.lat, from.lng, res[res.length - 1].lat, res[res.length - 1].lng) > dist(from.lat, from.lng, res[0].lat, res[0].lng)) res.reverse();
    return res;
  }

  /** Exact shortest path from node m through nodes 0..m-1 (when `closed`, one that also comes back to node m). */
  function heldKarp(d, m, closed) {
    const full = 1 << m;
    const dp = new Float64Array(full * m).fill(Infinity);
    const prev = new Int8Array(full * m).fill(-1);
    for (let i = 0; i < m; i++) dp[(1 << i) * m + i] = d[m][i];
    for (let mask = 1; mask < full; mask++) {
      for (let last = 0; last < m; last++) {
        const cur = dp[mask * m + last];
        if (cur === Infinity || !(mask & (1 << last))) continue;
        for (let nx = 0; nx < m; nx++) {
          if (mask & (1 << nx)) continue;
          const nm = mask | (1 << nx);
          const c = cur + d[last][nx];
          if (c < dp[nm * m + nx]) { dp[nm * m + nx] = c; prev[nm * m + nx] = last; }
        }
      }
    }
    let last = 0, best = Infinity;
    for (let i = 0; i < m; i++) {
      const c = dp[(full - 1) * m + i] + (closed ? d[i][m] : 0);
      if (c < best) { best = c; last = i; }
    }
    const out = [];
    let mask = full - 1;
    while (last !== -1) {
      out.push(last);
      const p = prev[mask * m + last];
      mask &= ~(1 << last);
      last = p;
    }
    return out.reverse();
  }

  /** Nearest neighbour then 2-opt, for many stops. Without a start point it begins at the stop farthest from the middle. */
  function heuristic(d, m, hasFrom, closed) {
    let first = 0;
    if (!hasFrom) {
      let far = -1;
      for (let i = 0; i < m; i++) {
        let s = 0;
        for (let j = 0; j < m; j++) s += d[i][j];
        if (s > far) { far = s; first = i; }
      }
    }
    const path = [m];
    const left = new Set();
    for (let i = 0; i < m; i++) left.add(i);
    let cur = m;
    if (!hasFrom) { path.push(first); left.delete(first); cur = first; }
    while (left.size) {
      let b = -1, bd = Infinity;
      left.forEach((i) => { if (d[cur][i] < bd) { bd = d[cur][i]; b = i; } });
      path.push(b); left.delete(b); cur = b;
    }
    const len = path.length;
    let improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 1; i < len - 1; i++) {
        for (let j = i + 1; j < len; j++) {
          const a = path[i - 1], b = path[i], c = path[j], e = j + 1 < len ? path[j + 1] : closed ? path[0] : -1;
          const delta = d[a][c] + (e >= 0 ? d[b][e] : 0) - d[a][b] - (e >= 0 ? d[c][e] : 0);
          if (delta < -1e-6) {
            for (let l = i, r = j; l < r; l++, r--) { const t = path[l]; path[l] = path[r]; path[r] = t; }
            improved = true;
          }
        }
      }
    }
    return path.slice(1);
  }

  /** Google Maps link for one trip: its stops in this exact order, the last one the destination. The start is left to Google (= where the
   *  phone is), except the first trip of a round trip, which starts at the point the route was planned from. */
  function tripUrl(trip, ti) {
    const pt = (s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    const loop = route.round && route.from;
    let url = "https://www.google.com/maps/dir/?api=1&travelmode=driving";
    if (loop && ti === 0) url += "&origin=" + encodeURIComponent(pt(route.from));
    url += "&destination=" + encodeURIComponent(pt(trip[trip.length - 1]));
    if (trip.length > 1) url += "&waypoints=" + encodeURIComponent(trip.slice(0, -1).map(pt).join("|"));
    return url;
  }

  // ---- the route screen -------------------------------------------------------
  const route = { stops: [], from: null, edited: false, locating: false, note: "", round: false, editId: null, riderId: null, riderName: "", origIds: [] };

  /** `saved` = a route from the server to change ({id, riderId, rider, stops}); without it, the orders ticked in the list. */
  function openSheet(saved) {
    if (sheet) return;
    route.from = null;
    route.edited = false;
    route.note = "";
    route.round = false;
    route.editId = saved ? saved.id : null;
    route.riderId = saved ? saved.riderId : null;
    route.riderName = saved ? saved.rider : "";
    route.origIds = saved ? saved.origIds : [];
    route.stops = saved ? saved.stops : sortStops(buildStops([...picked.values()]), null, false);
    document.documentElement.classList.add("na-lock");
    sheet = document.createElement("div");
    sheet.className = "na-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Delivery route");
    sheet.innerHTML = `<div class="na-main"></div><div class="na-over" hidden></div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener("click", onSheetClick);
    renderSheet();
    if (roundOk && !saved && remembered()) setRound(true); // last time this phone planned a round trip: ask for the location again
  }

  const remembered = () => { try { return localStorage.getItem(PREF) === "1"; } catch (_) { return false; } };
  const remember = (v) => { try { localStorage.setItem(PREF, v ? "1" : "0"); } catch (_) { /* private mode: not remembered */ } };

  function closeSheet() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    route.locating = false;
    unlockPage();
  }

  const unlockPage = () => { if (!sheet && !rsheet) document.documentElement.classList.remove("na-lock"); };

  const fmt = (m) => (m < 950 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km");

  function renderSheet() {
    if (!sheet) return;
    const stops = route.stops;
    const total = stops.reduce((n, s) => n + s.orders.length, 0);
    const trips = [];
    for (let i = 0; i < stops.length; i += perTrip) trips.push(stops.slice(i, i + perTrip));
    const loop = route.round && route.from;
    let km = loop && stops.length ? dist(route.from.lat, route.from.lng, stops[0].lat, stops[0].lng) : 0;
    let n = 0;
    const html = trips.map((trip, ti) => {
      const first = n + 1;
      const rows = trip.map((s, k) => {
        n++;
        const prevStop = n > 1 ? stops[n - 2] : null;
        const leg = prevStop ? dist(prevStop.lat, prevStop.lng, s.lat, s.lng) : loop ? dist(route.from.lat, route.from.lng, s.lat, s.lng) : 0;
        if (prevStop) km += leg;
        const legTxt = prevStop || (loop && n === 1) ? `<span class="na-leg">≈ ${leg < 950 ? Math.round(leg / 10) * 10 + " m" : (leg / 1000).toFixed(1) + " km"} from ${prevStop ? "the previous stop" : "your location"}</span>` : "";
        const idx = n - 1;
        return `<li class="na-stop">
          <span class="na-num">${n}</span>
          <div class="na-stop-body">
            <div class="na-stop-addr">${esc(s.orders[0].addr || "Pinned location")}</div>
            ${s.orders.map((o) => `<div class="na-ord"><b>${esc(o.flat || "-")}</b> · ${esc(o.name)} <span class="na-code">${esc(o.code)}</span></div>`).join("")}
            ${legTxt}
          </div>
          <div class="na-mv"><button type="button" data-mv="${idx}:-1" aria-label="Move up" ${idx === 0 ? "disabled" : ""}>▲</button><button type="button" data-mv="${idx}:1" aria-label="Move down" ${idx === stops.length - 1 ? "disabled" : ""}>▼</button></div>
        </li>`;
      }).join("");
      const last = n;
      const head = trips.length > 1 ? `Trip ${ti + 1} · stops ${first}–${last}` : `${stops.length} stop${stops.length === 1 ? "" : "s"}`;
      return `<section class="na-trip">
        <div class="na-trip-head"><h3>${head}</h3><a class="btn btn-gold btn-sm" href="${tripUrl(trip, ti)}" target="_blank" rel="noopener">Open in Google Maps</a></div>
        <ol class="na-stops">${rows}</ol>
      </section>`;
    }).join("");
    const merged = total - stops.length;
    sheet.querySelector(".na-main").innerHTML = `
      <div class="na-sheet-top"><button type="button" class="na-x" data-na="close" aria-label="Close">✕</button><span class="na-sheet-title">${route.editId ? `Edit route · ${esc(route.riderName)}` : "Delivery route"}</span></div>
      <div class="na-sheet-body">
        <p class="na-sum">${total} order${total === 1 ? "" : "s"} · ${stops.length} stop${stops.length === 1 ? "" : "s"}${merged > 0 ? ` (${merged} share a stop with another order)` : ""} · ≈ ${(km / 1000).toFixed(1)} km in a straight line${loop ? " (round trip)" : ""}${route.edited ? " · changed by you" : ""}</p>
        <div class="na-tools">
          <button type="button" class="btn btn-ghost btn-sm" data-na="best">↻ Best order</button>
          <button type="button" class="btn btn-ghost btn-sm" data-na="rev">⇅ Reverse</button>
          ${roundOk ? `<button type="button" class="btn btn-sm na-round${route.round ? " is-on" : ""}" data-na="round" aria-pressed="${route.round ? "true" : "false"}" ${route.locating ? "disabled" : ""}>${route.round ? "✓ Round trip" : "Round trip"}</button>` : ""}
          ${route.round
            ? `<button type="button" class="btn btn-ghost btn-sm" data-na="near" ${route.locating ? "disabled" : ""}>${route.locating ? "Finding you…" : "📍 Update my location"}</button>`
            : `<button type="button" class="btn btn-ghost btn-sm" data-na="near" ${route.locating ? "disabled" : ""}>${route.locating ? "Finding you…" : route.from ? "📍 Start near me ✓" : "📍 Start near me"}</button>`}
        </div>
        ${route.round && route.from && stops.length ? `<p class="na-note">Round trip: the route starts at your location right now, goes round all the stops and finishes at the stop nearest to you (≈ ${fmt(dist(route.from.lat, route.from.lng, stops[stops.length - 1].lat, stops[stops.length - 1].lng))} from you).</p>` : ""}
        ${route.note ? `<p class="na-note">${esc(route.note)}</p>` : ""}
        ${trips.length > 1 ? `<p class="na-note">Google Maps takes ${perTrip} stops at a time, so the route is in ${trips.length} trips. Open the next trip when the last stop of the one before is done.</p>` : ""}
        ${html}
        <p class="na-fine">Order is by straight-line distance. Google Maps then shows the real road route from wherever the person who opens it is.</p>
      </div>
      <div class="na-sheet-foot"><button type="button" class="btn btn-gold btn-block" data-na="save" ${stops.length ? "" : "disabled"}>${route.editId ? "Update this route" : "Save route for someone"}</button></div>`;
  }

  function onSheetClick(e) {
    const b = e.target.closest("[data-na], [data-mv]");
    if (!b || b.disabled) return;
    const stops = route.stops;
    if (b.dataset.mv) {
      const [i, dlt] = b.dataset.mv.split(":").map(Number);
      const j = i + dlt;
      if (j < 0 || j >= stops.length) return;
      [stops[i], stops[j]] = [stops[j], stops[i]];
      route.edited = true;
      renderSheet();
      return;
    }
    const a = b.dataset.na;
    if (a === "close") closeSheet();
    else if (a === "save") openSave();
    else if (a === "cancelsave") overlay(null);
    else if (a === "dosave") doSave();
    else if (a === "saved") { closeSheet(); exitSelecting(); refreshCards(); }
    else if (a === "rev") { stops.reverse(); route.edited = true; renderSheet(); }
    else if (a === "best") { route.stops = sortStops(stops, route.from, route.round); route.edited = false; route.note = ""; renderSheet(); }
    else if (a === "near") nearMe();
    else if (a === "round") setRound(!route.round);
  }

  /** Round trip on: read where the admin is (asked of the phone, never sent anywhere), then plan the loop from there. Off: the one-way order. */
  function setRound(want) {
    if (!sheet) return;
    if (!want) {
      route.round = false;
      remember(false);
      route.stops = sortStops(route.stops, route.from, false);
      route.edited = false;
      route.note = "";
      renderSheet();
      return;
    }
    if (!navigator.geolocation) { route.note = "This phone can't tell where it is, so a round trip can't be planned."; renderSheet(); return; }
    route.locating = true;
    route.note = "";
    renderSheet();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!sheet) return;
        route.locating = false;
        route.from = { lat: p.coords.latitude, lng: p.coords.longitude };
        route.round = true;
        remember(true);
        route.stops = sortStops(route.stops, route.from, true);
        route.edited = false;
        renderSheet();
      },
      () => {
        if (!sheet) return;
        route.locating = false;
        route.round = false;
        route.note = "Couldn't get your location, so Round trip stays off. Allow location for this site and try again.";
        renderSheet();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  /** Re-sorts starting from the admin's own position (asked of the phone, never sent anywhere). */
  function nearMe() {
    if (!navigator.geolocation) { route.note = "This phone can't tell where it is."; renderSheet(); return; }
    route.locating = true;
    route.note = "";
    renderSheet();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        route.locating = false;
        route.from = { lat: p.coords.latitude, lng: p.coords.longitude };
        route.stops = sortStops(route.stops, route.from, route.round);
        route.edited = false;
        renderSheet();
      },
      () => {
        route.locating = false;
        route.note = "Couldn't get your location. Allow location for this site, or use Reverse to flip the order.";
        renderSheet();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }


  // ---- save the route for a delivery boy ----------------------------------------
  /** The little dialog over the route screen (html = null closes it). */
  function overlay(html) {
    const o = sheet && sheet.querySelector(".na-over");
    if (!o) return;
    if (html == null) { o.hidden = true; o.innerHTML = ""; } else { o.innerHTML = html; o.hidden = false; }
  }

  async function openSave() {
    if (!sheet || !route.stops.length) return;
    overlay(`<div class="na-card"><p class="na-fine">Loading…</p></div>`);
    let riders = [];
    let failed = "";
    try {
      const res = await Api.get("/api/admin/routes/riders"); // only who can be given a route: no routes or orders are read
      riders = res.riders || [];
      ridersCache = riders;
    } catch (e) { failed = e.message || "Could not load the delivery boys"; }
    if (!sheet) return;
    const chips = riders.map((r) => `<label class="na-chip"><input type="radio" name="naRider" value="${r.id}" ${String(r.id) === String(route.riderId) ? "checked" : ""} /><span>${esc(r.name)}</span></label>`).join("");
    const usable = riders.length > 0;
    const orders = route.stops.reduce((n, st) => n + st.orders.length, 0);
    overlay(`<div class="na-card" role="dialog" aria-label="Choose who gets this route">
      <h3>${route.editId ? "Update this route" : "Who is this route for?"}</h3>
      ${chips ? `<div class="na-chips">${chips}</div>` : `<p class="na-note">${failed ? esc(failed) : "No other login exists yet. In Settings → Users tap “+ Add user”, then come back here."}</p>`}
      <p class="na-err" id="naErr"></p>
      <p class="na-fine">${orders} order${orders === 1 ? "" : "s"} · ${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}, in the order shown. They show in a “My Route” tab for that person when they sign in.</p>
      <div class="na-btns"><button type="button" class="btn btn-ghost btn-sm" data-na="cancelsave">Cancel</button><button type="button" class="btn btn-gold btn-sm" data-na="dosave" ${usable ? "" : "disabled"}>${route.editId ? "Update route" : "Save route"}</button></div>
    </div>`);
  }

  async function doSave() {
    if (!sheet) return;
    const err = sheet.querySelector("#naErr");
    const btn = sheet.querySelector('[data-na="dosave"]');
    const chosen = sheet.querySelector('input[name="naRider"]:checked');
    if (!chosen && !route.riderId) { err.textContent = "Pick who the route is for."; return; }
    const body = {
      riderId: chosen ? Number(chosen.value) : route.riderId,
      tripSize: perTrip,
      round: !!(route.round && route.from),
      startLat: route.from ? route.from.lat : null,
      startLng: route.from ? route.from.lng : null,
      stops: route.stops.map((st) => ({ lat: st.lat, lng: st.lng, orderIds: st.orders.map((o) => Number(o.id)) })),
    };
    btn.disabled = true;
    err.textContent = "";
    try {
      const res = route.editId ? await Api.put(`/api/admin/routes/${route.editId}`, body) : await Api.post("/api/admin/routes", body);
      ridersCache = null;
      const now = new Set((res.orderIds || []).map(String));
      route.origIds.forEach((id) => { if (!now.has(String(id))) tagMap.delete(String(id)); }); // taken off the route while editing
      now.forEach((id) => tagMap.set(id, res.rider));
      refreshCards();
      if (!sheet) return;
      const n = now.size;
      overlay(`<div class="na-card">
        <h3>✓ Saved for ${esc(res.rider)}</h3>
        <p class="na-fine">${n} order${n === 1 ? "" : "s"} are on ${esc(res.rider)}'s route, in this order. When ${esc(res.rider)} signs in, they are at the top of their Orders tab with Call, Open in Google Maps and Delivered.</p>
        <div class="na-btns na-col"><button type="button" class="btn btn-gold" data-na="saved">Done</button></div></div>`);
    } catch (e) {
      err.textContent = e.message || "Could not save the route";
      btn.disabled = false;
    }
  }

  // ---- the Routes screen: saved routes ------------------------------------------
  let rdata = null;

  async function openRoutes() {
    if (rsheet || typeof Api === "undefined") return;
    rsheet = document.createElement("div");
    rsheet.className = "na-sheet";
    rsheet.setAttribute("role", "dialog");
    rsheet.setAttribute("aria-label", "Saved routes");
    rsheet.innerHTML = `<div class="na-main"><div class="na-sheet-top"><button type="button" class="na-x" data-ra="close" aria-label="Close">✕</button><span class="na-sheet-title">Saved routes</span></div><div class="na-sheet-body" data-rbody><p class="na-fine">Loading…</p></div></div>`;
    document.body.appendChild(rsheet);
    document.documentElement.classList.add("na-lock");
    rsheet.addEventListener("click", onRoutesClick);
    await loadRoutes();
  }

  function closeRoutes() {
    if (!rsheet) return;
    rsheet.remove();
    rsheet = null;
    unlockPage();
  }

  async function loadRoutes() {
    try {
      rdata = await Api.get("/api/admin/routes");
      ridersCache = rdata.riders;
      paintRoutes();
    } catch (e) {
      const b = rsheet && rsheet.querySelector("[data-rbody]");
      if (b) b.innerHTML = `<p class="na-note">${esc(e.message || "Could not load the routes")}</p>`;
    }
  }

  const when = (iso) => { try { return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch (_) { return ""; } };

  function paintRoutes() {
    const body = rsheet && rsheet.querySelector("[data-rbody]");
    if (!body || !rdata) return;
    const routes = rdata.routes || [];
    body.innerHTML = `
      <section class="na-rsec">
        <p class="na-fine">The person you give a route to gets a “My Route” tab on their own, with the stops in order. You can give a route to any login from Settings → Users.</p>
        ${routes.length ? routes.map((r) => `<div class="na-route-row">
          <div class="na-rname"><div class="na-rline"><b>${esc(r.rider)}</b><span class="na-chip-s ${r.done ? "is-done" : "is-open"}">${r.done ? "Done" : "Open"}</span></div>
            <span class="na-fine">${r.orders} order${r.orders === 1 ? "" : "s"} · ${r.stops} stop${r.stops === 1 ? "" : "s"} · ${r.delivered} delivered${r.cancelled ? ` · ${r.cancelled} cancelled` : ""}${r.failed ? ` · <b class="na-failtxt">${r.failed} couldn't deliver</b>` : ""} · ${esc(when(r.createdAt))}</span>
            ${(r.fails || []).map((f) => `<div class="na-failrow"><span><b>${esc(f.flat ? f.flat + " · " : "")}${esc(f.name || "")}</b> ${esc(f.code || "")}<br>↩ ${esc(f.by || "")} couldn't deliver · ${esc(failWords(f))} · ${esc(stamp(f.at))}</span><span class="na-tagacts"><button type="button" class="na-tagbtn" data-ra="retry" data-id="${f.orderId}">Retry</button><button type="button" class="na-tagbtn is-un" data-ra="unassign" data-id="${f.orderId}">Unassign</button></span></div>`).join("")}</div>
          <div class="na-rbtns">
            ${r.done ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-ra="change" data-id="${r.id}">Change person</button><button type="button" class="btn btn-ghost btn-sm" data-ra="edit" data-id="${r.id}">Edit stops</button>`}
            <button type="button" class="btn btn-ghost btn-sm" data-ra="delroute" data-id="${r.id}">Remove route</button>
          </div>
          <div class="na-chg" data-chg="${r.id}" hidden></div></div>`).join("") : `<p class="na-fine">No saved routes yet. Plan a route and tap “Save route for someone”.</p>`}
      </section>`;
  }

  /** Two taps for anything that removes something: the first changes the button's words, the second does it. */
  function armed(btn, label, run, ask) {
    if (ask && window.AdminConfirm) { // the app's own confirmation box, when it is loaded
      window.AdminConfirm.ask(ask).then((yes) => { if (yes) run(); });
      return;
    }
    if (btn.dataset.armed) { clearTimeout(btn._t); delete btn.dataset.armed; run(); return; }
    btn.dataset.armed = "1";
    const was = btn.textContent;
    btn.textContent = label;
    btn._t = setTimeout(() => { delete btn.dataset.armed; btn.textContent = was; }, 3500);
  }

  const forget = (ids) => { (ids || []).forEach((i) => tagMap.delete(String(i))); refreshCards(); };

  async function onRoutesClick(e) {
    const b = e.target.closest("[data-ra]");
    if (!b || b.disabled) return;
    const a = b.dataset.ra;
    const id = b.dataset.id;
    try {
      if (a === "close") closeRoutes();
      else if (a === "change") {
        const box = rsheet.querySelector(`[data-chg="${id}"]`);
        if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
        const cur = (rdata.routes || []).find((x) => String(x.id) === String(id));
        const chips = (rdata.riders || []).map((r) => `<label class="na-chip"><input type="radio" name="naChg${id}" value="${r.id}" ${cur && String(cur.riderId) === String(r.id) ? "checked" : ""} /><span>${esc(r.name)}</span></label>`).join("");
        box.innerHTML = `<div class="na-chips">${chips}</div><p class="na-err" data-chgerr></p><div class="na-btns"><button type="button" class="btn btn-ghost btn-sm" data-ra="chgcancel" data-id="${id}">Cancel</button><button type="button" class="btn btn-gold btn-sm" data-ra="chgsave" data-id="${id}">Give to this person</button></div>`;
        box.hidden = false;
      } else if (a === "chgcancel") {
        const box = rsheet.querySelector(`[data-chg="${id}"]`); box.hidden = true; box.innerHTML = "";
      } else if (a === "chgsave") {
        const box = rsheet.querySelector(`[data-chg="${id}"]`);
        const pick = box.querySelector("input:checked");
        if (!pick) { box.querySelector("[data-chgerr]").textContent = "Pick who the route is for."; return; }
        b.disabled = true;
        try {
          const res = await Api.put(`/api/admin/routes/${id}/rider`, { riderId: Number(pick.value) });
          (res.orderIds || []).forEach((oid) => tagMap.set(String(oid), res.rider));
          refreshCards();
          await loadRoutes();
        } catch (err) { b.disabled = false; box.querySelector("[data-chgerr]").textContent = err.message || "Could not change"; }
      } else if (a === "retry") {
        b.disabled = true;
        await Api.post(`/api/admin/routes/orders/${id}/retry`);
        const fe = failMap.get(String(id));
        if (fe) fe.failed = false;
        refreshCards();
        await loadRoutes();
        if (typeof Toast !== "undefined") Toast.show("Back on the delivery boy's list", "success");
      } else if (a === "unassign") {
        armed(b, "Tap again to unassign", async () => {
          try {
            await Api.del(`/api/admin/routes/orders/${id}`);
            tagMap.delete(String(id));
            const fe = failMap.get(String(id));
            if (fe) fe.failed = false;
            refreshCards();
            await loadRoutes();
          } catch (err) { toast(err.message || "Could not unassign"); }
        }, { title: "Unassign this order?", message: "It will be taken off the route and belong to nobody.", confirmText: "Yes, unassign", cancelText: "Keep it", tone: "gold", icon: "↺" });
      } else if (a === "delroute") {
        const rr = (rdata.routes || []).find((x) => String(x.id) === String(id));
        armed(b, "Tap again to remove", async () => {
          try { const res = await Api.del(`/api/admin/routes/${id}`); forget(res && res.orderIds); await loadRoutes(); } catch (err) { toast(err.message || "Could not remove"); }
        }, { title: "Remove this route?", message: `${rr ? `${rr.rider}'s route (${rr.orders} order${rr.orders === 1 ? "" : "s"})` : "This route"} will be removed and its orders will belong to nobody.`, confirmText: "Yes, remove", cancelText: "Keep route", tone: "danger", icon: "⚠️" });
      } else if (a === "edit") {
        b.disabled = true;
        const d = await Api.get(`/api/admin/routes/${id}`);
        const open = (o) => o.status === "NEW" || o.status === "PACKED";
        const stops = (d.stops || []).map((st) => ({
          lat: st.lat, lng: st.lng,
          orders: (st.orders || []).filter(open).map((o) => ({ id: String(o.id), code: o.code, name: o.name, flat: o.flat, addr: o.addr, lat: st.lat, lng: st.lng })),
        })).filter((st) => st.orders.length);
        if (!stops.length) { toast("Nothing left to change: every order on it is delivered or cancelled."); b.disabled = false; return; }
        const origIds = [];
        (d.stops || []).forEach((st) => (st.orders || []).forEach((o) => origIds.push(String(o.id))));
        closeRoutes();
        openSheet({ id: d.id, riderId: d.riderId, rider: d.rider, stops, origIds });
      }
    } catch (err) {
      b.disabled = false;
      toast(err.message || "Something went wrong");
    }
  }

  // ---- the delivery boy's own tab: "My Route" ---------------------------------------------------
  // A tab of its own that appears by itself while a route is saved for this login (no Orders or admin access needed). Asked once after
  // sign-in, again when the tab is opened or the app comes back to the front (never more than every 20 seconds), and once a minute
  // while the app is on screen: a route given or taken away later shows up without a refresh. The owner has no routes: nothing is asked.
  const MINE_STALE = 20 * 1000;
  const MINE_POLL = 60 * 1000;
  let mineData = null;
  let mineAt = 0;
  let mineLoading = false;
  let mineTimer = 0;
  let mineOn = false;        // signed in with a login that can have a route
  let mineTouched = false;   // he has tapped a tab himself: do not jump to My Route for him
  let mineJumped = false;      // the first look after sign-in is done
  let mineHadRoute = false;
  let mineSig = null;        // which orders were on his routes at the last look
  let mineObs = null;
  let mineRaf = 0;
  let mineCard = null;
  const openSt = (st) => st === "NEW" || st === "PACKED";
  const isPend = (o) => openSt(o.status) && !o.fail; // still to deliver: open, and not reported "Couldn't deliver"
  const FAIL_CHOICES = [
    { value: "NOT_ANSWERING", label: "Customer not answering" },
    { value: "NOT_HOME", label: "Customer not at home" },
    { value: "BAD_ADDRESS", label: "Wrong or incomplete address" },
    { value: "REFUSED", label: "Customer refused" },
    { value: "PAYMENT", label: "Payment problem" },
    { value: "OTHER", label: "Other", note: "required" },
  ];
  const mineView = () => document.getElementById("view-myroute");
  const mineShown = () => { const v = mineView(); return !!v && v.classList.contains("active"); };
  const myTab = () => document.querySelector('.admin-tabs > .admin-tab[data-view="myroute"]');

  function mineStart() {
    const A = window.AdminAccess;
    const view = mineView();
    if (mineOn || !A || !view || A.isOwner()) return;
    injectStyle();
    mineOn = true;
    mineTouched = false;
    mineJumped = false;
    mineHadRoute = false;
    mineSig = null;
    mineCard = document.createElement("section");
    mineCard.className = "nm-card";
    view.appendChild(mineCard);
    mineCard.addEventListener("click", onMineClick);
    mineObs = new MutationObserver(() => { if (!mineRaf) mineRaf = requestAnimationFrame(() => { mineRaf = 0; syncMineFromList(); }); });
    mineObs.observe(list, { childList: true, subtree: true });
    mineTimer = setInterval(() => { if (!document.hidden) loadMine(false); }, MINE_POLL);
    renderMine();
    loadMine(true);
  }

  function mineStop() {
    if (!mineOn) return;
    mineOn = false;
    clearInterval(mineTimer);
    mineTimer = 0;
    if (mineObs) mineObs.disconnect();
    mineObs = null;
    if (mineCard) mineCard.remove();
    mineCard = null;
    mineData = null;
    mineAt = 0;
    paintTab();
  }

  async function loadMine(force) {
    if (!mineOn || mineLoading || typeof Api === "undefined") return;
    if (!force && Date.now() - mineAt < MINE_STALE) return;
    mineLoading = true;
    try {
      mineData = await Api.get("/api/admin/routes/mine");
      mineAt = Date.now();
    } catch (_) { /* keep what is shown */ }
    mineLoading = false;
    if (!mineOn) return;
    renderMine();
    const has = (((mineData && mineData.routes) || []).length > 0);
    paintTab();
    if (has && !mineHadRoute) {
      // He just got a route. On the first look after sign-in he lands straight on it; later he is only told.
      if (!mineJumped) { if (!mineTouched && !mineShown() && myTab()) myTab().click(); }
      else if (!mineShown() && typeof Toast !== "undefined") Toast.show("🛵 A route was given to you: see My Route", "success");
    }
    mineHadRoute = has;
    mineJumped = true;
    const sig = ((mineData && mineData.routes) || []).map((r) => (r.stops || []).map((st) => st.orders.map((o) => o.id).join("+")).join(",")).join("|");
    if (mineSig !== null && sig !== mineSig && window.AdminOrders) window.AdminOrders.markStale(); // an order was given or taken: his Orders list is read again when he opens it
    mineSig = sig;
  }

  /** The My Route tab (top and bottom menu) shows while there is a route, or while he is still looking at one he just finished. */
  function paintTab() {
    const A = window.AdminAccess;
    if (!A) return;
    const routes = (mineOn && mineData && mineData.routes) || [];
    let pending = 0;
    routes.forEach((r) => (r.stops || []).forEach((st) => st.orders.forEach((o) => { if (isPend(o)) pending += 1; })));
    A.setMyRoute(routes.length > 0 || (mineOn && mineShown()));
    const pill = document.getElementById("myRoutePill");
    const badge = document.getElementById("myRouteBadgeBottom");
    if (pill) { pill.textContent = String(pending); pill.hidden = !pending; }
    if (badge) { badge.textContent = pending > 99 ? "99+" : String(pending); badge.hidden = !pending; }
  }

  /** admin-main.js calls this when the tab is opened. */
  function showMine() {
    if (!mineOn) return;
    renderMine();
    loadMine(false);
  }

  /** An order he marked Delivered in the Orders list (or anywhere else) is ticked here too. */
  function syncMineFromList() {
    if (!mineData) return;
    let changed = false;
    list.querySelectorAll(".order-card[data-id]").forEach((card) => {
      if (!card.querySelector(".badge-delivered")) return;
      const id = Number(card.dataset.id);
      (mineData.routes || []).forEach((r) => r.stops.forEach((s) => s.orders.forEach((o) => { if (o.id === id && openSt(o.status)) { o.status = "DELIVERED"; changed = true; } })));
    });
    if (changed) { renderMine(); paintTab(); }
  }

  document.addEventListener("freshcutz:login", mineStart);
  document.addEventListener("freshcutz:logout", mineStop);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadMine(false); });
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest(".admin-tabs .admin-tab");
    if (!t || !mineOn) return;
    if (e.isTrusted) mineTouched = true;
    setTimeout(paintTab, 0); // leaving a finished route hides the tab
  });

  const nmPt = (s) => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`;
  function nmUrl(trip, origin) {
    let url = "https://www.google.com/maps/dir/?api=1&travelmode=driving";
    if (origin) url += "&origin=" + encodeURIComponent(origin);
    url += "&destination=" + encodeURIComponent(nmPt(trip[trip.length - 1]));
    if (trip.length > 1) url += "&waypoints=" + encodeURIComponent(trip.slice(0, -1).map(nmPt).join("|"));
    return url;
  }

  const rupee = (n) => { const v = Number(n); return Number.isFinite(v) ? "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : ""; };
  const openItems = new Set(); // order ids whose item list is open (kept when the card is drawn again)

  /** How the order is paid, in the shop's own words. COD = cash to collect. UPI follows the status the shop set on the payment
   * (Verified, Under Review, Rejected ...): only Verified counts as paid, anything else says what to do. [label, tone, hint] */
  const UPI_WORDS = {
    "": ["UPI · PENDING", "wait", "Shop has not confirmed it yet"],
    REVIEW: ["UPI · UNDER REVIEW", "wait", "Shop is checking this payment"],
    HOLD: ["UPI · ON HOLD", "wait", "Shop has put this payment on hold"],
    PARTIAL: ["UPI · PARTLY PAID", "wait", "Ask the shop how much to collect"],
    REJECTED: ["UPI · REJECTED", "bad", "Shop did not accept this payment"],
    FAILED: ["UPI · PAYMENT FAILED", "bad", "Ask the shop before you deliver"],
    SUSPICIOUS: ["UPI · SUSPICIOUS", "bad", "Ask the shop before you deliver"],
    DUPLICATE: ["UPI · DUPLICATE", "bad", "Ask the shop before you deliver"],
    FRAUD: ["UPI · FRAUD", "bad", "Do not deliver. Ask the shop"],
    REFUNDED: ["UPI · REFUNDED", "bad", "Ask the shop before you deliver"],
  };
  function nmPay(o) {
    const amt = rupee(o.total);
    if (o.pay === "COD") { // cash on delivery: what the shop marked decides what he must collect
      const total = Number(o.total) || 0;
      const due = o.due != null ? Number(o.due) : total;
      if (due <= 0) return `<div class="nm-pay is-paid"><small>CASH · PAID ✓</small><b>${amt}</b><em>Nothing to collect</em></div>`;
      if (due < total) return `<div class="nm-pay is-cod"><small>PART PAID · COLLECT</small><b>${rupee(due)}</b><em>${rupee(total - due)} already paid</em></div>`;
      return `<div class="nm-pay is-cod"><small>CASH ON DELIVERY</small><b>${amt}</b></div>`;
    }
    if (o.pay === "PAID") return `<div class="nm-pay is-paid"><small>UPI · PAID ✓</small><b>${amt || "Paid"}</b><em>Nothing to collect</em></div>`;
    if (o.pay === "UPI") {
      const c = String(o.check || "").toUpperCase();
      const w = UPI_WORDS[c === "NOT_RECEIVED" ? "REJECTED" : c] || UPI_WORDS[""];
      return `<div class="nm-pay is-${w[1]}"><small>${w[0]}</small><b>${amt}</b><em>${w[2]}</em></div>`;
    }
    return "";
  }

  function nmItems(o) {
    const items = o.items || [];
    if (!items.length) return "";
    const open = openItems.has(o.id);
    const lines = items.map((it) => `<div class="nm-line"><span>${esc(it.qty)} × ${esc(it.name)}${it.variant ? ` <em>${esc(it.variant)}</em>` : ""}</span><span>${rupee(it.amount)}</span></div>`).join("");
    const charges = Number(o.charges) > 0 ? `<div class="nm-line"><span>Delivery &amp; charges</span><span>${rupee(o.charges)}</span></div>` : "";
    const total = o.total != null ? `<div class="nm-line nm-tot"><span>Total</span><span>${rupee(o.total)}</span></div>` : "";
    return `<button type="button" class="nm-tg${open ? " is-open" : ""}" data-nm-items="${o.id}" aria-expanded="${open}"><span class="nm-car">▸</span> Items (${items.length})</button><div class="nm-items" ${open ? "" : "hidden"}>${lines}${charges}${total}</div>`;
  }

  function nmStop(st, pending) {
    const first = st.orders[0] || {};
    const rows = st.orders.map((o) => {
      const live = o.status !== "DELIVERED" && o.status !== "CANCELLED";
      const failed = live && !!o.fail; // he reported "Couldn't deliver": it waits for the shop's decision
      let acts;
      if (o.status === "DELIVERED") acts = `<div class="nm-state is-ok">✓ Delivered</div>`;
      else if (o.status === "CANCELLED") acts = `<div class="nm-state">Cancelled</div>`;
      else if (failed) acts = `<div class="nm-state is-fail">↩ Couldn't deliver · ${esc(o.fail.label || "")}${o.fail.note ? `: ${esc(o.fail.note)}` : ""} · ${esc(stamp(o.fail.at))}</div>`;
      else acts = `<div class="nm-acts"><a class="nm-call" href="tel:${esc(String(o.phone || "").replace(/[^\d+]/g, ""))}">📞 Call</a><button type="button" class="nm-dlv" data-nm-id="${o.id}">Delivered</button></div><button type="button" class="nm-fail" data-nm-fail="${o.id}">↩ Couldn't deliver</button>`;
      const full = live && !failed;
      return `<div class="nm-ord"><div class="nm-top"><div class="nm-who"><b>${esc(o.flat || "-")}</b> · ${esc(o.name)}${o.landmark ? `<small>📍 ${esc(o.landmark)}</small>` : ""}<small>${esc(o.code)}</small></div>${full ? nmPay(o) : ""}</div>${full ? nmItems(o) : ""}${o.notes ? `<div class="nm-note">📝 ${esc(o.notes)}</div>` : ""}${acts}</div>`;
    }).join("");
    return `<div class="nm-stop${pending ? "" : " is-done"}"><span class="nm-num">${st.no}</span><div class="nm-sbody"><div class="nm-addr">${esc(first.addr || "Pinned location")}</div>${rows}</div></div>`;
  }

  function renderMine() {
    if (!mineCard) return;
    const routes = (mineData && mineData.routes) || [];
    let html = `<div class="nm-head"><h2>🛵 My Route</h2><button type="button" class="nm-refresh" data-nm="refresh" aria-label="Refresh my route">↻</button></div>`;
    if (!mineData) html += `<p class="nm-empty">Loading…</p>`;
    else if (!routes.length) html += `<p class="nm-empty">All delivered. 🎉 When the shop gives you a new route it shows here.</p>`;
    else {
      html += routes.map((r, ri) => {
        const stops = r.stops || [];
        const all = stops.reduce((n, s) => n + s.orders.length, 0);
        const delivered = stops.reduce((n, s) => n + s.orders.filter((o) => o.status === "DELIVERED").length, 0);
        let cash = 0; // cash still to collect on this route
        stops.forEach((s) => s.orders.forEach((o) => { if (o.pay === "COD" && isPend(o)) cash += Number(o.due != null ? o.due : o.total) || 0; }));
        const pendingStops = stops.filter((s) => s.orders.some(isPend));
        const doneStops = stops.filter((s) => !s.orders.some(isPend)); // delivered, cancelled, or reported "Couldn't deliver"
        const failedN = stops.reduce((n, s) => n + s.orders.filter((o) => openSt(o.status) && o.fail).length, 0);
        const size = Math.max(1, Number(r.tripSize) || 5);
        const trips = [];
        for (let i = 0; i < pendingStops.length; i += size) trips.push(pendingStops.slice(i, i + size));
        // The first trip of a round trip starts where the shop planned it from, but only while nothing has been delivered yet.
        const origin = r.round && r.startLat != null && r.startLng != null && delivered === 0 ? `${Number(r.startLat).toFixed(6)},${Number(r.startLng).toFixed(6)}` : "";
        return `<div class="nm-route">
          ${routes.length > 1 ? `<div class="nm-rt">Route ${ri + 1} · ${esc(when(r.createdAt))}</div>` : ""}
          <div class="nm-prog"><i style="width:${all ? Math.round((delivered / all) * 100) : 0}%"></i></div>
          <p class="nm-sub">${delivered} of ${all} order${all === 1 ? "" : "s"} delivered${failedN ? ` · <b class="nm-failn">${failedN} couldn't deliver</b>` : ""}${cash > 0 ? ` · <b>${rupee(cash)} cash to collect</b>` : ""}</p>
          ${!pendingStops.length && failedN ? `<p class="nm-empty">No stops left to deliver. The shop will decide what to do about the ones you couldn't deliver.</p>` : ""}
          ${trips.map((trip, ti) => `<section class="nm-trip"><div class="nm-trip-head"><h3>${trips.length > 1 ? `Trip ${ti + 1} of ${trips.length} · ` : ""}${trip.length} stop${trip.length === 1 ? "" : "s"}</h3><a class="nm-go" href="${esc(nmUrl(trip, ti === 0 ? origin : ""))}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>${trip.map((s) => nmStop(s, true)).join("")}</section>`).join("")}
          ${doneStops.length ? `<details class="nm-done"${pendingStops.length ? "" : " open"}><summary>Finished stops (${doneStops.length})</summary>${doneStops.map((s) => nmStop(s, false)).join("")}</details>` : ""}
        </div>`;
      }).join("");
    }
    mineCard.innerHTML = html;
  }

  /** "↩ Couldn't deliver": he picks why (and writes a few words for "Other"); the order stays open and the shop's phones get an alert. */
  async function reportFail(fb) {
    if (fb.disabled || typeof Api === "undefined") return;
    const id = Number(fb.dataset.nmFail);
    if (!window.AdminConfirm) { toast("Please refresh the page and try again"); return; }
    let who = "";
    (mineData.routes || []).forEach((rt) => rt.stops.forEach((st) => st.orders.forEach((o) => { if (o.id === id) who = `${o.flat || ""} ${o.name || ""}`.trim() + (o.code ? ` · ${o.code}` : ""); })));
    const ans = await window.AdminConfirm.ask({
      title: "Couldn't deliver?",
      message: `${who ? who + ". " : ""}Why could it not be delivered? The order stays open and the shop is told.`,
      choices: FAIL_CHOICES,
      notePlaceholder: "What happened?",
      confirmText: "Report it",
      cancelText: "Back",
      tone: "gold",
      icon: "↩",
    });
    if (!ans) return;
    fb.disabled = true;
    fb.textContent = "Saving…";
    try {
      const res = await Api.patch(`/api/admin/routes/mine/orders/${id}/failed`, { reason: ans.value, note: ans.note });
      if (res && res.already) { await loadMine(true); return; } // it was already reported (a second tap): show what the shop has
      const label = (FAIL_CHOICES.find((c) => c.value === ans.value) || {}).label || "";
      (mineData.routes || []).forEach((rt) => rt.stops.forEach((s) => s.orders.forEach((o) => { if (o.id === id) o.fail = (res && res.fail) || { reason: ans.value, label, note: ans.note, at: new Date().toISOString() }; })));
      renderMine();
      paintTab();
      if (typeof Toast !== "undefined") Toast.show("Reported. The shop has been told.", "success");
    } catch (err) {
      fb.disabled = false;
      fb.textContent = "↩ Couldn't deliver";
      toast(err.message || "Could not save");
    }
  }

  async function onMineClick(e) {
    const r = e.target.closest("[data-nm]");
    if (r) { loadMine(true); return; }
    const tg = e.target.closest("[data-nm-items]");
    if (tg) { // open / close the items of one order
      const id = Number(tg.dataset.nmItems);
      const box = tg.nextElementSibling;
      const open = box.hidden;
      box.hidden = !open;
      tg.classList.toggle("is-open", open);
      tg.setAttribute("aria-expanded", String(open));
      if (open) openItems.add(id); else openItems.delete(id);
      return;
    }
    const fb = e.target.closest(".nm-fail");
    if (fb) { reportFail(fb); return; }
    const btn = e.target.closest(".nm-dlv");
    if (!btn || btn.disabled) return;
    if (window.AdminConfirm) { // the app's own confirmation box
      let who = "";
      let collect = 0; // cash he should have collected for this order
      (mineData.routes || []).forEach((rt) => rt.stops.forEach((st) => st.orders.forEach((o) => {
        if (o.id !== Number(btn.dataset.nmId)) return;
        who = `${o.flat || ""} ${o.name || ""}`.trim() + (o.code ? ` · ${o.code}` : "");
        if (o.pay === "COD") collect = Number(o.due != null ? o.due : o.total) || 0;
      })));
      const base = who ? `${who} will be marked as delivered.` : "This order will be marked as delivered.";
      const yes = await window.AdminConfirm.ask({ title: "Mark as delivered?", message: collect > 0 ? `${base} Collect ${rupee(collect)} in cash.` : base, confirmText: "Yes, delivered", tone: "ok", icon: "✓" });
      if (!yes) return;
    } else if (!btn.classList.contains("is-sure")) { // the first tap only asks "are you sure"
      btn.classList.add("is-sure");
      btn.textContent = "Tap again to confirm";
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.classList.remove("is-sure"); btn.textContent = "Delivered"; }, 3500);
      return;
    }
    clearTimeout(btn._t);
    btn.disabled = true;
    btn.textContent = "Saving…";
    const id = Number(btn.dataset.nmId);
    try {
      await Api.patch(`/api/admin/routes/mine/orders/${id}/delivered`); // only an order on his own route is accepted
      (mineData.routes || []).forEach((rt) => rt.stops.forEach((s) => s.orders.forEach((o) => { if (o.id === id) o.status = "DELIVERED"; })));
      renderMine();
      paintTab();
      if (typeof Toast !== "undefined") Toast.show("Marked delivered ✓", "success");
      if (!(mineData.routes || []).some((rt) => rt.stops.some((s) => s.orders.some(isPend)))) loadMine(true); // that was the last one
    } catch (err) {
      btn.disabled = false;
      btn.classList.remove("is-sure");
      btn.textContent = "Delivered";
      toast(err.message || "Could not save");
    }
  }

  // ---- look -------------------------------------------------------------------
  function injectStyle() {
    if (styled) return;
    styled = true;
    const css = `
.na-top{display:flex;align-items:center;gap:12px;margin:0 0 var(--sp-3,12px)}
.na-link{border:0;background:none;padding:0;font:inherit;font-size:13px;font-weight:700;color:var(--gold-dark,#9a7410);text-decoration:underline;cursor:pointer}
.na-link[hidden]{display:none}
#ordersList.na-on{padding-bottom:92px}
.order-card{position:relative}
.na-pick{display:block;width:100%;margin:0 0 10px;padding:10px 12px;border:1.5px dashed #d8c58a;border-radius:10px;background:#fffaf0;color:var(--gold-dark,#9a7410);font:inherit;font-size:14px;font-weight:700;text-align:center;cursor:pointer}
.na-sel{outline:2.5px solid var(--gold,#c9a13b);outline-offset:-1px}
.na-sel .na-pick{border-style:solid;background:var(--gold,#c9a13b);border-color:var(--gold,#c9a13b);color:#17140f}
.na-nopin{margin:0 0 10px;padding:7px 10px;border-radius:8px;background:#f3efe3;color:var(--text-muted,#7a7260);font-size:12.5px;text-align:center}
.na-foot{position:fixed;left:12px;right:12px;bottom:calc(var(--admin-nav-h,60px) + var(--safe-bottom,0px) + 10px);z-index:560;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:16px;background:#17140f;color:#fff;box-shadow:0 10px 28px rgba(23,20,15,.35)}
.na-count{flex:1 1 auto;font-size:14px;font-weight:700}
.na-foot .btn-ghost{background:rgba(255,255,255,.14);color:#fff;border-color:transparent}
.na-foot .btn:disabled{opacity:.45}
html.na-lock,html.na-lock body{overflow:hidden}
.na-sheet{position:fixed;inset:0;z-index:880;display:flex;flex-direction:column;background:var(--bg-page,#faf7f0)}
.na-sheet-top{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:calc(var(--safe-top,0px) + 8px) 12px 10px;background:#17140f;color:#fff}
.na-x{min-width:34px;height:34px;padding:0 8px;border:0;border-radius:17px;background:rgba(255,255,255,.12);color:#fff;font-size:15px;font-weight:700;cursor:pointer}
.na-sheet-title{font-family:var(--font-body,inherit);font-weight:800;font-size:16px;color:var(--gold-light,#e6c872)}
.na-sheet-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:14px 14px calc(var(--safe-bottom,0px) + 24px)}
.na-sum{margin:0 0 10px;font-size:13.5px;font-weight:700;color:var(--ink,#17140f);line-height:1.4}
.na-tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.na-note{margin:0 0 12px;padding:9px 11px;border-radius:9px;background:#fff6dd;color:#6b5516;font-size:12.5px;line-height:1.45}
.na-trip{margin:0 0 18px}
.na-trip-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px}
.na-trip-head h3{margin:0;font-family:var(--font-body,inherit);font-size:16px;color:var(--ink,#17140f)}
.na-stops{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.na-stop{display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--bg-card,#fff);border:1.5px solid #e6dcc0;border-radius:12px}
.na-num{flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:var(--gold,#c9a13b);color:#17140f;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center}
.na-stop-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.na-stop-addr{font-size:13.5px;font-weight:700;color:var(--ink,#17140f);line-height:1.35}
.na-ord{font-size:13px;color:var(--ink,#17140f);line-height:1.35}
.na-code{color:var(--text-muted,#7a7260);font-size:11.5px}
.na-leg{font-size:11.5px;color:var(--text-muted,#7a7260)}
.na-mv{flex:0 0 auto;display:flex;flex-direction:column;gap:4px}
.na-mv button{width:34px;height:30px;border:1.5px solid #e3d9bb;border-radius:8px;background:#fff;color:var(--ink,#17140f);font-size:12px;cursor:pointer}
.na-mv button:disabled{opacity:.3}
.na-round{border:1.5px solid #d8c58a;background:#fffaf0;color:var(--gold-dark,#9a7410);font-weight:700}
.na-round.is-on{background:var(--gold,#c9a13b);border-color:var(--gold,#c9a13b);color:#17140f}
.na-back{margin:8px 2px 0;font-size:13px;font-weight:700;color:var(--ink,#17140f)}

.na-tag{margin:0 0 8px;padding:6px 10px;border-radius:8px;background:#e9f3e6;color:#2f6b2a;font-size:13px;font-weight:700}
.na-tagrow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.na-tag.is-fail{background:#fdeceb;color:#9b2a22}
.na-tag.is-fail .na-tagbtn{color:#9b2a22}
.na-tag.is-fail .na-tagbtn.is-un{color:#6b1d17}
.na-tag.is-note{background:#f3efe3;color:#6b5516}
.na-tag.is-note .na-tagbtn{color:#6b5516}
.na-taghist{margin-top:2px}
.na-histlist{padding:4px 0 2px;font-size:12.5px;font-weight:600;line-height:1.5;opacity:.9}
.na-failtxt{color:#9b2a22}
.na-failrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding:6px 10px;border-radius:8px;background:#fdeceb;color:#9b2a22;font-size:13px;font-weight:600;line-height:1.4}
.na-failrow .na-tagbtn{color:#9b2a22}
.na-failrow .na-tagbtn.is-un{color:#6b1d17}
.na-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.na-sheet-foot{flex:0 0 auto;padding:10px 14px calc(var(--safe-bottom,0px) + 10px);background:#fff;box-shadow:0 -8px 24px rgba(23,20,15,.12)}
.na-sheet-foot .btn-block{width:100%}
.na-over{position:absolute;inset:0;z-index:5;display:flex;align-items:flex-end;justify-content:center;background:rgba(15,12,8,.55)}
.na-over[hidden]{display:none}
.na-card{width:100%;max-width:520px;max-height:92%;overflow-y:auto;background:#fff;border-radius:18px 18px 0 0;padding:16px 16px calc(var(--safe-bottom,0px) + 16px);display:flex;flex-direction:column;gap:10px}
.na-card h3{margin:0;font-family:var(--font-body,inherit);font-size:18px;color:var(--ink,#17140f)}
.na-chips{display:flex;flex-wrap:wrap;gap:8px}
.na-chip{position:relative}
.na-chip input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.na-chip span{display:inline-block;padding:9px 14px;border:1.5px solid #e3d9bb;border-radius:999px;background:#fff;font-weight:700;font-size:14px;color:var(--ink,#17140f)}
.na-tagacts{display:flex;align-items:center;gap:12px;flex:0 0 auto}
.na-tagbtn.is-un{color:#b3402a}
.na-tagbtn{flex:0 0 auto;min-height:32px;padding:0 4px;border:0;background:none;font:inherit;font-size:13px;font-weight:800;color:#2f6b2a;text-decoration:underline;cursor:pointer}
.na-chg{padding-top:8px;border-top:1px dashed #e6dcc0}
.na-chg[hidden]{display:none}
.na-chip.is-off span{opacity:.5;background:#f3efe3}
.na-chip input:checked+span{background:var(--gold,#c9a13b);border-color:var(--gold,#c9a13b)}
.na-in{width:100%;padding:11px 12px;border:1.5px solid #e3d9bb;border-radius:10px;font:inherit;font-size:16px;color:var(--ink,#17140f);background:#fff}
.na-err{margin:0;min-height:0;font-size:13px;font-weight:700;color:var(--danger,#c0392b)}
.na-err:empty{display:none}
.na-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.na-btns.na-col{flex-direction:column}
.na-btns.na-col .btn{width:100%}
.na-rsec{margin:0 0 20px;display:flex;flex-direction:column;gap:10px}
.na-rsec h3{margin:0;font-family:var(--font-body,inherit);font-size:17px;color:var(--ink,#17140f)}
.na-rider,.na-route-row{display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--bg-card,#fff);border:1.5px solid #e6dcc0;border-radius:12px}
.na-rname{display:flex;flex-direction:column;gap:2px;font-size:14.5px;color:var(--ink,#17140f)}
.na-rbtns{display:flex;flex-wrap:wrap;gap:6px}
.na-add{display:flex;gap:8px;align-items:center}
.na-rline{display:flex;align-items:center;gap:8px}
.na-chip-s{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:800;vertical-align:middle}
.na-chip-s.is-open{background:#fff0c9;color:#7a5b00}
.na-chip-s.is-done{background:#e9f3e6;color:#2f6b2a}

.nm-card{margin:0 0 var(--sp-3,12px);padding:12px;background:var(--bg-card,#fff);border:1.5px solid #e6dcc0;border-radius:14px}
.nm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 6px}
.nm-head h2{margin:0;font-family:var(--font-body,inherit);font-size:18px;color:var(--ink,#17140f)}
.nm-refresh{min-width:40px;height:40px;border:1.5px solid #e3d9bb;border-radius:20px;background:#fff;color:var(--ink,#17140f);font-size:18px;cursor:pointer}
.nm-empty{margin:4px 0 0;color:var(--text-muted,#7a7260);font-size:13.5px}
.nm-rt{margin:8px 0 4px;font-weight:800;font-size:14px;color:var(--ink,#17140f)}
.nm-prog{height:8px;border-radius:999px;background:#ece5cf;overflow:hidden}
.nm-prog i{display:block;height:100%;background:#2f7d32}
.nm-sub{margin:6px 0 10px;font-size:13px;color:var(--text-muted,#7a7260)}
.nm-sub b{color:#7a4b00}
.nm-trip{margin:0 0 14px}
.nm-trip-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px}
.nm-trip-head h3{margin:0;font-size:14.5px;color:var(--text-muted,#7a7260)}
.nm-go{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 14px;border-radius:12px;background:var(--gold,#c9a13b);color:#17140f;font-weight:800;font-size:14.5px;text-decoration:none;text-align:center}
.nm-stop{display:flex;gap:10px;margin:0 0 8px;padding:10px;background:#fffdf7;border:1.5px solid #e6dcc0;border-radius:12px}
.nm-stop.is-done{opacity:.65}
.nm-num{flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:var(--gold,#c9a13b);color:#17140f;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center}
.nm-sbody{flex:1 1 auto;min-width:0}
.nm-addr{margin:0 0 6px;font-weight:800;font-size:14px;color:var(--ink,#17140f)}
.nm-ord{padding:10px 0;border-top:1px dashed #e6dcc0}
.nm-ord:first-of-type{border-top:0;padding-top:0}
.nm-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.nm-who{min-width:0;font-size:14.5px;color:var(--ink,#17140f);overflow-wrap:anywhere}
.nm-who small{display:block;color:var(--text-muted,#7a7260);font-size:12.5px}
.nm-pay{flex:0 0 auto;max-width:48%;padding:6px 10px;border-radius:10px;text-align:right;line-height:1.2}
.nm-pay small{display:block;font-size:10.5px;font-weight:800;letter-spacing:.2px}
.nm-pay b{font-size:16px;font-weight:800}
.nm-pay.is-cod{background:#fff0c9;color:#7a4b00;border:1.5px solid #e9c46a}
.nm-pay.is-cod b{font-size:18px}
.nm-pay.is-paid{background:#e9f3e6;color:#2f6b2a}
.nm-pay em{display:block;margin-top:2px;font-size:11px;font-style:normal;font-weight:600;opacity:.85}
.nm-pay.is-wait{background:#f3efe3;color:#6b5516;border:1.5px dashed #d8c58a}
.nm-pay.is-bad{background:#fdeceb;color:#9b2a22;border:1.5px solid #e8b4af}
.nm-tg{display:flex;align-items:center;gap:6px;min-height:40px;margin-top:4px;padding:0;border:0;background:none;font:inherit;font-size:13.5px;font-weight:800;color:var(--gold-dark,#9a7410);cursor:pointer}
.nm-car{display:inline-block;transition:transform .15s}
.nm-tg.is-open .nm-car{transform:rotate(90deg)}
.nm-items{margin:2px 0 6px;padding:8px 10px;background:#f7f2e2;border-radius:10px;font-size:13.5px;color:var(--ink,#17140f)}
.nm-items[hidden]{display:none}
.nm-line{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
.nm-line em{font-style:normal;color:var(--text-muted,#7a7260);font-size:12.5px}
.nm-tot{margin-top:4px;padding-top:6px;border-top:1px dashed #d8c58a;font-weight:800}
.nm-note{margin-top:6px;font-size:13px;color:var(--text-muted,#7a7260);overflow-wrap:anywhere}
.nm-acts{display:flex;gap:8px;margin-top:10px}
.nm-call,.nm-dlv{flex:1 1 0;display:flex;align-items:center;justify-content:center;min-height:44px;padding:0 10px;border-radius:10px;font:inherit;font-size:14.5px;font-weight:800;cursor:pointer;text-decoration:none}
.nm-call{border:1.5px solid #e3d9bb;background:#fff;color:var(--ink,#17140f)}
.nm-dlv{border:0;background:#2f7d32;color:#fff}
.nm-dlv.is-sure{background:#e67e22}
.nm-dlv:disabled{opacity:.6}
.nm-state{margin-top:6px;font-size:13.5px;font-weight:800;color:var(--text-muted,#7a7260)}
.nm-state.is-ok{color:#2f7d32}
.nm-state.is-fail{padding:8px 10px;border-radius:10px;background:#fdeceb;color:#9b2a22;font-weight:700;line-height:1.4;overflow-wrap:anywhere}
.nm-fail{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin-top:8px;padding:0 10px;border:1.5px solid #e8b4af;border-radius:10px;background:#fff;color:#9b2a22;font:inherit;font-size:14.5px;font-weight:800;cursor:pointer}
.nm-fail:disabled{opacity:.6}
.nm-failn{color:#9b2a22}
.nm-done summary{cursor:pointer;padding:8px 2px;font-weight:800;color:var(--text-muted,#7a7260)}
.na-sheet,.na-sheet *,.na-top,.na-top *,.na-foot,.na-foot *,.na-tag,.na-tag *,.na-pick,.na-nopin,.nm-card,.nm-card *{font-family:var(--font-body,inherit)}
.na-ownnote{margin:0 0 var(--sp-3,12px);padding:8px 12px;border-radius:10px;background:#f7f2e2;color:var(--text-muted,#7a7260);font-size:13px}
.na-fine{margin:6px 0 0;font-size:12px;color:var(--text-muted,#7a7260);line-height:1.45}
`;
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }

  return { configure, showMine };
})();
