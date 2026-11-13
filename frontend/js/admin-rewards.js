/* More -> Rewards & offers: limited offers customers claim (budget, number of orders, time window, "N left" counter), automatic offers,
 * code offers, gift vouchers and a loyalty rule (a voucher after every N delivered orders), a block list.
 *
 * Built for a phone first. Light on the server by design:
 *   - the list reads one small query (only what a card shows); an offer's full details are read only when it is opened for editing;
 *   - editing sends ONLY the fields that changed (a PATCH); the counters are never sent - the server moves them atomically;
 *   - the offers, the claims of an offer and the vouchers are all read TEN at a time (the newest first) with a "Load more" button, so a long
 *     history never makes a heavy request; the totals ("N live", "given in total") are counted by the database, not worked out from the rows;
 *   - what was read (every page loaded so far) is kept: going back to a list shows it at once and asks again only when it is old;
 *   - "Load more" / a refresh redraws only the list area (the voucher form and the search box are never touched);
 *   - the numbers refresh every 20 seconds while this screen is open and a live offer exists (one small query), and not at all while the
 *     tab is in the background; the item / category choices come from the products screen's own cached index.
 * Who may open it / change it: the "Push notifications" permission (View = look, View & edit = change). The server checks every request again.
 * Talks to /api/admin/rewards. */

window.AdminRewards = (() => {
  const root = document.getElementById("rewardsRoot");
  if (!root) return { refresh() {} };

  const URL = "/api/admin/rewards";
  const URL_ = window.URL; // (the browser's own URL tools: "URL" above is the rewards address)
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const canEdit = () => !window.AdminAccess || AdminAccess.can("promotions", "EDIT");
  const canView = () => !window.AdminAccess || AdminAccess.can("promotions", "VIEW");
  const rs = (n) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n || 0));
  const POLL_MS = 20 * 1000;
  // Going back and forth between screens costs no requests: what was read is kept for a while and shown again; it is read again only when it is
  // older than this, or after this screen itself changed something (every change clears what was kept).
  const FRESH_MS = 60 * 1000;
  const LIST_FRESH_MS = 45 * 1000;
  const PAGE = 10; // rows per request (offers, claims, vouchers)
  /** The golden spinner (the same one the Orders and Customers lists use) with a few words. */
  const spinRow = (t) => `<div class="rwa-spinrow"><span class="spinner spinner-dark" aria-hidden="true"></span><span>${esc(t || "Loading…")}</span></div>`;
  /** "Load more": a golden-ring spinner replaces the label while the next ten are on their way. */
  const moreBtn = (a, loading) => `<div class="rwa-morewrap"><button type="button" class="btn btn-ghost btn-sm rwa-more${loading ? " is-busy" : ""}" data-a="${a}" ${loading ? "disabled" : ""}>${loading ? `<span class="spinner spinner-dark" aria-hidden="true"></span><span>Loading…</span>` : "Load more"}</button></div>`;
  const detailCache = new Map();  // offer id -> {d, at}
  const claimsCache = new Map();  // offer id -> {c, at}
  const vCache = new Map();       // search number ("" = everybody) -> the vouchers read so far {rows, more, phone, at}
  let settingsAt = 0;
  /** An offer or the lists changed: forget what was kept about them. */
  function dropAll() { lists = { live: null, ended: null }; detailCache.clear(); claimsCache.clear(); }

  // ---- state ------------------------------------------------------------------------------------------------------
  let page = "list";         // list | edit | detail | vouchers | settings
  let tab = "live";          // live | ended
  let lists = { live: null, ended: null }; // {offers, given, live, now, at}; a name search on the Ended tab is kept under "ended|<letters>"
  let featureOff = null;     // the master switch: true = everything is hidden from customers (null = not known yet)
  let endedRaw = "";         // what is typed in the Ended tab's search box
  let endedQ = "";           // what is being searched: the typed words (lower case) once one of them has 3 letters, else "" (nothing is asked)
  const OQ_MIN = 3;          // same rule as the Products search: at least one word of 3 letters
  const OQ_DELAY = 800;      // ms after the last key, so typing "monsoon" asks the server once, not seven times
  const longEnough = (t) => String(t || "").trim().split(/\s+/).some((x) => x.length >= OQ_MIN);
  /** Which list is on screen: the tab, or the Ended tab's search result. */
  const curKey = () => (tab === "ended" && endedQ ? "ended|" + endedQ : tab);
  /** The address of one page of a list (a search result is read from the server by name; nothing is filtered here). */
  const listUrl = (key, size, before) => `${URL}?ended=${key.startsWith("ended")}&size=${size}${key.includes("|") ? "&q=" + encodeURIComponent(key.slice(key.indexOf("|") + 1)) : ""}${before != null ? "&before=" + before : ""}`;
  let skew = 0;              // server clock - this clock
  let detail = null;         // the offer open on the detail page (full)
  let claims = null;         // {rows, more, loading}
  let w = null, orig = null; // the editor's working copy and the copy it started from
  let editId = null;         // null = a new offer
  let busy = false;
  let picBusy = false; // a banner picture is being made small / uploaded
  let vouchers = null;       // {rows, more, phone}
  let settings = null;
  let settingsOrig = null;
  let index = null;          // [{id, n, c}] products (for choosing items), loaded only when needed
  let indexFail = "";
  let pollTimer = 0;
  let topUp = false;
  let rulesOpen = false;     // the "Rules" box of the detail page (kept open while the page redraws)

  const now = () => Date.now() + skew;

  // ---- small helpers ----------------------------------------------------------------------------------------------------
  function ago(ms) {
    const s = Math.max(0, Math.floor((ms - now()) / 1000));
    if (s >= 172800) return Math.floor(s / 86400) + " days";
    if (s >= 86400) return "1 day " + Math.floor((s % 86400) / 3600) + "h";
    if (s >= 3600) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    if (s >= 60) return Math.floor(s / 60) + " min";
    return s + "s";
  }
  const fmtDT = (ms) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const pad = (n) => String(n).padStart(2, "0");
  const toInput = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromInput = (v) => { if (!v) return null; const t = new Date(v).getTime(); return isFinite(t) ? t : null; };
  const numOrNull = (v) => (v === "" || v == null || !isFinite(Number(v)) ? null : Number(v));

  const KIND = { FLAT: "₹ off", PERCENT: "% off", FREE_DELIVERY: "Free delivery" };
  const MODE = { AUTO: "Automatic", CLAIM: "Claim button", CODE: "Code" };
  const AUD = { ALL: "Everyone", NEW: "New customers", RETURNING: "Returning customers", PHONES: "Chosen numbers" };

  function valueText(o) {
    const v = o.kind === "FLAT" ? `₹${o.value} off` : o.kind === "PERCENT" ? `${o.value}% off` : "Free delivery";
    const ks = o.keys;
    const sc = o.scope === "CATEGORY" ? ` · ${ks ? ks.slice(0, 3).join(", ") : "categories"}` : o.scope === "ITEMS" ? ` · ${ks ? ks.length + " item" + (ks.length === 1 ? "" : "s") : "chosen items"}` : "";
    return v + sc;
  }

  /** Live / Scheduled / Paused / Draft / Ended / Fully claimed, from the row. */
  function stateOf(o) {
    const t = now();
    if (o.status === "ENDED") return ["Ended", "end"];
    if (o.status === "DRAFT") return ["Draft", "draft"];
    if (o.status === "PAUSED") return ["Paused", "pause"];
    if (o.starts && o.starts > t) return ["Scheduled", "sched"];
    if (o.ends && o.ends <= t) return ["Ended", "end"];
    if ((o.maxOrders != null && o.usedCount + o.heldCount >= o.maxOrders) || (o.budget != null && o.perClaim > 0 && o.usedAmount + o.heldAmount + o.perClaim > o.budget)) return ["Fully claimed", "full"];
    return ["Live", "live"];
  }

  const chip = (st) => `<span class="rwa-chip is-${st[1]}">${st[0]}</span>`;

  function progress(o) {
    const parts = [];
    let pct = 0;
    if (o.maxOrders != null) { parts.push(`${o.usedCount}${o.heldCount ? "+" + o.heldCount : ""} of ${o.maxOrders} orders`); pct = Math.max(pct, (o.usedCount + o.heldCount) / o.maxOrders); }
    if (o.budget != null) { parts.push(`${rs(o.usedAmount)} of ${rs(o.budget)}`); pct = Math.max(pct, (o.usedAmount + o.heldAmount) / o.budget); }
    if (!parts.length) parts.push(`${o.usedCount} used · ${rs(o.usedAmount)} given`);
    return { text: parts.join(" · "), pct: Math.min(1, pct), limited: o.maxOrders != null || o.budget != null };
  }

  const toastErr = (e) => Toast.show((e && e.message) || "Something went wrong", "error");

  // ---- the item / category chooser (one read of the products index, kept) ------------------------------------------------
  async function loadIndex() {
    if (index || indexFail) return;
    try {
      const rows = await Api.get("/api/admin/products/index");
      index = rows.map((r) => ({ id: r.id, n: r.n, c: r.c || "" }));
    } catch (e) {
      indexFail = "You need access to Items to choose items here.";
    }
  }
  const catNames = () => [...new Set((index || []).map((r) => r.c).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const itemName = (id) => { const r = (index || []).find((x) => String(x.id) === String(id)); return r ? r.n : "Item " + id; };

  /** The chooser: chosen ones as chips, a search box for items, tick boxes for categories. `keysOf` = the array being edited. */
  function chooserHtml(scope, keys, term) {
    const chips = keys.map((k) => `<span class="rwa-pick">${esc(scope === "ITEMS" ? itemName(k) : k)}<button type="button" data-a="unpick" data-k="${esc(k)}" aria-label="Remove">✕</button></span>`).join("");
    let body = "";
    if (indexFail) body = `<p class="rwa-hint">${esc(indexFail)}</p>`;
    else if (!index) body = `<p class="rwa-hint">Loading…</p>`;
    else if (scope === "CATEGORY") {
      body = `<div class="rwa-cats">${catNames().map((c) => `<label class="rwa-cat"><input type="checkbox" data-a="cat" data-k="${esc(c)}" ${keys.includes(c) ? "checked" : ""} /><span>${esc(c)}</span></label>`).join("")}</div>`;
    } else {
      const q = (term || "").trim().toLowerCase();
      const hits = q.length >= 2 ? index.filter((r) => (r.n + " " + r.c).toLowerCase().includes(q) && !keys.includes(String(r.id))).slice(0, 8) : [];
      body = `<input type="search" class="rwa-in" data-a="itemq" value="${esc(term || "")}" placeholder="Search an item to add…" autocomplete="off" />
        <div class="rwa-hits">${hits.map((r) => `<button type="button" class="rwa-hit" data-a="pickitem" data-k="${r.id}"><b>${esc(r.n)}</b><small>${esc(r.c)}</small></button>`).join("")}</div>`;
    }
    return `<div class="rwa-picks">${chips || `<span class="rwa-hint">${scope === "ITEMS" ? "No items chosen yet" : "No categories chosen yet"}</span>`}</div>${body}`;
  }

  // ---- reading ----------------------------------------------------------------------------------------------------------------
  async function loadList(which, force) {
    const key = which || tab;
    if (!canView()) return;
    const have = lists[key];
    if (!force && have && Date.now() - have.at < LIST_FRESH_MS) return;
    if (have && (have.refreshing || have.loading)) return; // (one request at a time per list)
    if (have) have.refreshing = true;
    try {
      // a refresh re-reads exactly what is on screen (all the pages loaded so far, at most 50) in one request
      const k = have ? Math.min(50, Math.max(PAGE, have.offers.length)) : PAGE;
      const d = await Api.get(listUrl(key, k));
      skew = (d.now || Date.now()) - Date.now();
      if (typeof d.off === "boolean") featureOff = d.off;
      if (have && lists[key] === have) {
        const last = d.offers.length ? d.offers[d.offers.length - 1].id : null;
        const tail = d.more && last != null ? have.offers.filter((o) => o.id < last) : []; // (older pages already loaded stay)
        Object.assign(have, { offers: d.offers.concat(tail), more: d.more ? (tail.length ? have.more : true) : false, given: d.given, live: d.live, total: d.total, at: Date.now() });
      } else if (!lists[key]) lists[key] = { offers: d.offers, more: d.more, given: d.given, live: d.live, total: d.total, loading: false, refreshing: false, at: Date.now() };
    } catch (e) { if (!have) toastErr(e); }
    if (have) have.refreshing = false;
    if (page === "list" && curKey() === key) paintList();
  }

  /** The next ten of a list ("Load more"): appended to what is there, nothing already on screen is read again. */
  async function loadMoreList(key) {
    const have = lists[key];
    if (!have || !have.more || have.loading || have.refreshing || !have.offers.length) return;
    have.loading = true;
    paintList();
    try {
      const d = await Api.get(listUrl(key, PAGE, have.offers[have.offers.length - 1].id));
      if (lists[key] === have) { // (an edit in the meantime forgot the lists: then this page is not added to a stale one)
        const seen = new Set(have.offers.map((o) => o.id));
        have.offers = have.offers.concat(d.offers.filter((o) => !seen.has(o.id)));
        have.more = d.more;
        have.at = Date.now();
      }
    } catch (e) { toastErr(e); }
    have.loading = false;
    if (page === "list" && curKey() === key) paintList();
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      if (document.hidden || !root.isConnected || !root.closest(".admin-view.active")) return;
      if (page === "list" && tab === "live" && lists.live && lists.live.live > 0) loadList("live", true);
      else if (page === "detail" && detail && detail.status === "ACTIVE") reloadDetail(true);
    }, POLL_MS);
  }
  const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; } };

  async function openDetail(id) {
    page = "detail";
    topUp = false;
    rulesOpen = false;
    claims = null;
    window.scrollTo(0, 0);
    const kept = detailCache.get(id), keptC = claimsCache.get(id);
    if (kept && Date.now() - kept.at < FRESH_MS) { // seen a moment ago: shown again, nothing is asked
      detail = kept.d;
      claims = keptC && Date.now() - keptC.at < FRESH_MS ? keptC.c : null;
      render();
      if (!claims) loadClaims(false);
      return;
    }
    detail = Object.values(lists).filter(Boolean).flatMap((l) => l.offers).find((o) => o.id === id) || { id, name: "…", status: "DRAFT", keys: [] };
    render();
    await reloadDetail(false);
    loadClaims(false);
  }

  async function reloadDetail(quiet) {
    try {
      const d = await Api.get(`${URL}/${detail.id}`);
      skew = (d.now || Date.now()) - Date.now();
      detail = d;
      detailCache.set(d.id, { d, at: Date.now() });
      if (page === "detail") render();
    } catch (e) { if (!quiet) toastErr(e); }
  }

  async function loadClaims(more) {
    if (claims && claims.loading) return;
    const forId = detail && detail.id;
    claims = { rows: more && claims ? claims.rows : [], more: !!(more && claims && claims.more), loading: true, first: !more };
    paintClaims();
    try {
      const before = more && claims.rows.length ? claims.rows[claims.rows.length - 1].id : "";
      const d = await Api.get(`${URL}/${forId}/claims?size=${PAGE}${before ? "&before=" + before : ""}`);
      if (!detail || detail.id !== forId) return; // (another offer was opened meanwhile)
      claims = { rows: claims.rows.concat(d.claims), more: d.more, loading: false };
      claimsCache.set(forId, { c: claims, at: Date.now() });
    } catch (e) { if (claims) claims = { rows: claims.rows, more: !!more, loading: false }; toastErr(e); }
    if (page === "detail") paintClaims();
  }

  /** Redraws only one area of the page (the page itself, the typed boxes and the scroll position stay as they are). */
  function paintArea(sel, html) {
    const el = root.querySelector(sel);
    if (!el) { render(); return; }
    el.innerHTML = html;
  }
  const paintList = () => { if (page === "list") { paintArea("#rwaListBody", listBodyHtml()); paintArea("#rwaGate", gateHtml()); } };
  const paintClaims = () => { if (page === "detail") paintArea("#rwaClaims", claimsHtml()); };
  const paintVouchers = () => { if (page === "vouchers") paintArea("#rwaVList", vlistHtml()); };

  // ---- drawing: list ----------------------------------------------------------------------------------------------------------
  /** The master switch: one tap hides every offer and voucher from customers (and brings them back); nothing is deleted. Drawn above the tabs. */
  function gateHtml() {
    const edit = canEdit();
    return featureOff == null ? "" : `<div class="rwa-switchrow rwa-gate${featureOff ? " is-off" : ""}"><span><b>Rewards &amp; offers are ${featureOff ? "OFF" : "ON"}</b><small>${featureOff
      ? "Customers see no offers or vouchers, and nothing can be claimed or used."
      : "Turn off to hide everything from customers at once. Nothing is deleted."}</small></span>
      <label class="mp-switch" aria-label="Rewards and offers on or off"><input type="checkbox" data-a="gate" ${featureOff ? "" : "checked"} ${edit ? "" : "disabled"} /><span></span></label></div>`;
  }

  function listHtml() {
    const edit = canEdit();
    const head = `<div class="us-head"><div><h2 class="us-title">Rewards &amp; offers</h2>
      <p class="us-sub">Limited offers, codes and vouchers that bring customers back.</p></div></div>
      <div id="rwaGate">${gateHtml()}</div>
      <div class="rwa-top">
        ${edit ? `<button type="button" class="btn btn-gold rwa-new" data-a="new">＋ New offer</button>` : ""}
        <button type="button" class="btn btn-ghost" data-a="vouchers">🎟️ Vouchers</button>
        ${edit ? `<button type="button" class="btn btn-ghost" data-a="loyalty">🏆 Loyalty</button><button type="button" class="btn btn-ghost" data-a="settings">⚙️ Settings</button>` : ""}
      </div>
      <div class="rwa-seg" role="tablist"><button type="button" data-a="tab" data-t="live" class="${tab === "live" ? "is-on" : ""}">Active</button><button type="button" data-a="tab" data-t="ended" class="${tab === "ended" ? "is-on" : ""}">Ended</button></div>
      ${tab === "ended" ? `<div class="rwa-search"><input class="rwa-in" data-a="oq" type="search" maxlength="60" placeholder="Search ended offers by name" value="${esc(endedRaw)}" autocomplete="off" /></div>
      <p class="rwa-hint rwa-oqhint" id="rwaOqHint"${endedRaw.trim() && !longEnough(endedRaw) ? "" : " hidden"}>Type at least 3 letters to search</p>` : ""}`;
    return head + `<div id="rwaListBody">${listBodyHtml()}</div>`;
  }

  /** The offers of the open tab: the totals, the cards loaded so far, and "Load more". (Redrawn on its own, without the buttons above it.) */
  function listBodyHtml() {
    const data = lists[curKey()];
    const edit = canEdit();
    if (!data) return spinRow(endedQ ? "Searching…" : "Loading…");
    const sum = (tab === "live" ? `<div class="rwa-sum"><b>${data.live}</b> live · <b>${rs(data.given)}</b> given in total</div>`
      : data.total ? `<div class="rwa-sum"><b>${data.total}</b> ${endedQ ? "found" : "ended"} · <b>${rs(data.given)}</b> given in total</div>` : "");
    const cards = data.offers.map((o) => {
      const st = stateOf(o), pr = progress(o);
      const bits = [valueText(o), MODE[o.mode] || ""];
      const timing = o.status === "ACTIVE" && o.starts && o.starts > now() ? `starts in ${ago(o.starts)}` : o.ends ? (o.ends > now() ? `ends in ${ago(o.ends)}` : `ended ${fmtDT(o.ends)}`) : o.status === "DRAFT" ? "not started" : "no end date";
      const toggle = !edit ? "" : o.status === "ACTIVE" ? `<button type="button" class="btn btn-ghost btn-sm" data-a="pause" data-id="${o.id}">⏸ Pause</button>`
        : o.status === "PAUSED" ? `<button type="button" class="btn btn-gold btn-sm" data-a="resume" data-id="${o.id}">▶ Resume</button>`
        : o.status === "DRAFT" ? `<button type="button" class="btn btn-gold btn-sm" data-a="start" data-id="${o.id}">▶ Start</button>` : "";
      return `<article class="rwa-card" data-id="${o.id}">
        <div class="rwa-top2"><b class="rwa-name">${esc(o.name)}</b>${chip(st)}</div>
        <div class="rwa-sub">${esc(bits.filter(Boolean).join(" · "))}</div>
        ${pr.limited ? `<div class="rwa-bar"><i style="width:${Math.round(pr.pct * 100)}%"></i></div>` : ""}
        <div class="rwa-meta"><span>${esc(pr.text)}</span><span>${esc(timing)}</span></div>
        <div class="rwa-actions"><button type="button" class="btn btn-ghost btn-sm" data-a="open" data-id="${o.id}">Open</button>${toggle}</div>
      </article>`;
    }).join("");
    return sum + (cards || `<p class="rwa-hint">${tab === "live" ? "No offers yet. Tap “New offer” to create your first one." : endedQ ? "No ended offer has that in its name." : "No ended offers."}</p>`) + (data.more ? moreBtn("moreoffers", data.loading) : "");
  }

  // ---- drawing: detail ----------------------------------------------------------------------------------------------------------
  /** The claims read so far (ten at a time) + "Load more". */
  function claimsHtml() {
    const amtText = (c) => c.status === "HELD" ? `${rs(c.amount)} held` : c.status === "RETURNED" ? `${rs(c.amount)} returned` : rs(c.amount);
    if (!claims || (claims.loading && claims.first)) return spinRow("Loading…");
    const rows = claims.rows.map((c) => `<div class="rwa-row rwa-crow"><span class="rwa-ph">${esc(c.phone)}</span><span class="rwa-chip is-${c.status.toLowerCase()}">${esc(c.status === "HELD" ? "Holding" : c.status === "USED" ? "Used" : c.status === "RETURNED" ? "Returned" : c.status === "EXPIRED" ? "Hold ran out" : "Released")}</span><b class="rwa-amt">${esc(amtText(c))}</b><span class="rwa-dim">${esc(c.order ? "Order " + c.order : c.status === "HELD" ? "Not ordered yet" : "No order")} · ${esc(fmtDT(c.at))}</span></div>`).join("");
    return (rows || `<p class="rwa-hint">Nobody has claimed this yet.</p>`) + (claims.more ? moreBtn("moreclaims", claims.loading) : "");
  }

  function detailHtml() {
    const o = detail, edit = canEdit();
    const st = stateOf(o), pr = progress(o);
    const leftOrders = o.maxOrders != null ? Math.max(0, o.maxOrders - o.usedCount - o.heldCount) : null;
    const leftBudget = o.budget != null ? Math.max(0, o.budget - o.usedAmount - o.heldAmount) : null;
    const stats = `<div class="rwa-stats">
      <div><small>Used</small><b>${o.usedCount || 0}${o.maxOrders != null ? ` / ${o.maxOrders}` : ""}</b></div>
      <div><small>Given</small><b>${rs(o.usedAmount)}${o.budget != null ? ` / ${rs(o.budget)}` : ""}</b></div>
      <div><small>Held right now</small><b>${o.heldCount || 0}</b></div>
      <div><small>Left</small><b>${leftOrders != null ? leftOrders + " orders" : leftBudget != null ? rs(leftBudget) : "No limit"}</b></div>
    </div>`;
    const acts = !edit ? "" : `<div class="rwa-actions rwa-wrapact">
      ${o.status === "ACTIVE" ? `<button type="button" class="btn btn-ghost btn-sm" data-a="pause" data-id="${o.id}">⏸ Pause</button>` : ""}
      ${o.status === "PAUSED" || o.status === "DRAFT" ? `<button type="button" class="btn btn-gold btn-sm" data-a="${o.status === "DRAFT" ? "start" : "resume"}" data-id="${o.id}">▶ ${o.status === "DRAFT" ? "Start" : "Resume"}</button>` : ""}
      ${o.status !== "ENDED" ? `<button type="button" class="btn btn-ghost btn-sm" data-a="edit">✏️ Edit</button>` : ""}
      ${o.status !== "ENDED" && (o.budget != null || o.maxOrders != null) ? `<button type="button" class="btn btn-ghost btn-sm" data-a="topup">➕ Top up</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-a="dup">⧉ Duplicate</button>
      ${o.status !== "ENDED" && o.status !== "DRAFT" ? `<button type="button" class="btn btn-ghost btn-sm rwa-danger" data-a="end">⏹ End</button>` : ""}
      ${(o.usedCount || 0) === 0 && (o.heldCount || 0) === 0 ? `<button type="button" class="btn btn-ghost btn-sm rwa-danger" data-a="del">🗑 Delete</button>` : ""}
    </div>
    ${topUp ? `<div class="rwa-topup">${o.budget != null ? `<label class="rwa-f">Add budget (₹)<input class="rwa-in" type="number" inputmode="decimal" min="0" data-a="tb" /></label>` : ""}${o.maxOrders != null ? `<label class="rwa-f">Add orders<input class="rwa-in" type="number" inputmode="numeric" min="0" data-a="to" /></label>` : ""}<button type="button" class="btn btn-gold btn-sm" data-a="topgo">Add</button></div>` : ""}`;
    const claimsBlock = `<h3 class="rwa-h">Claims</h3><div class="rwa-claims" id="rwaClaims">${claimsHtml()}</div>`;
    const scopeRow = o.scope === "CATEGORY" ? (o.keys || []).join(", ") || "Chosen categories"
      : o.scope === "ITEMS" ? (indexFail || index ? (o.keys || []).map(itemName).join(", ") || "Chosen items" : "Loading…") : "Whole order";
    const rules = [
      ["Gives", valueText(o)],
      o.kind !== "FREE_DELIVERY" ? ["Applies to", scopeRow] : null,
      o.minOrder ? ["Minimum order", rs(o.minOrder)] : null,
      o.maxPct ? ["Never more than", `${o.maxPct}% of the order`] : null,
      o.minQty ? ["Needs at least", `${o.minQty} units`] : null,
      o.maxQty ? ["Counts at most", `${o.maxQty} units`] : null,
      ["How", MODE[o.mode] + (o.mode === "CODE" && o.code ? ` · ${o.code}` : "") + (o.mode !== "AUTO" ? ` · held ${o.hold || 10} min` : "")],
      ["Who", AUD[o.audience] || o.audience || ""],
      o.audience === "PHONES" ? ["Numbers (" + (o.phones || []).length + ")", (o.phones || []).join(", ") || "None"] : null,
      ["Per phone", `${o.perPhone || 1} time${(o.perPhone || 1) === 1 ? "" : "s"}`],
      ["Starts", o.starts ? fmtDT(o.starts) : "Right away"],
      ["Ends", o.ends ? fmtDT(o.ends) : "No end date"],
      o.maxOrders != null || o.budget != null ? ["“N left” counter", o.showLeft === false ? "Hidden from customers" : "Shown to customers"] : null,
      ["If cancelled", o.returnOnCancel === false ? "Not given back" : "Given back"],
    ].filter(Boolean).map((r) => `<div class="rwa-kv"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join("");
    return `<button type="button" class="settings-back" data-a="back"><span aria-hidden="true">←</span> All offers</button>
      <div class="rwa-card"><div class="rwa-top2"><b class="rwa-name">${esc(o.name)}</b>${chip(st)}</div>
      ${o.note ? `<div class="rwa-sub">${esc(o.note)}</div>` : ""}
      ${pr.limited ? `<div class="rwa-bar"><i style="width:${Math.round(pr.pct * 100)}%"></i></div>` : ""}${stats}${acts}</div>
      <details class="rwa-det"${rulesOpen ? " open" : ""}><summary>Rules</summary><div class="rwa-kvs">${rules}</div></details>${claimsBlock}`;
  }

  // ---- drawing: editor --------------------------------------------------------------------------------------------------------
  const field = (label, inner, hint) => `<label class="rwa-f"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ""}</label>`;
  const inp = (f, type, extra) => `<input class="rwa-in" data-f="${f}" type="${type}" ${type === "number" ? 'inputmode="decimal" min="0" step="any"' : ""} value="${esc(w[f] == null ? "" : w[f])}" ${extra || ""} />`;
  const seg = (f, opts) => `<div class="rwa-seg rwa-seg-sm">${Object.entries(opts).map(([k, v]) => `<button type="button" data-a="seg" data-f="${f}" data-v="${k}" class="${w[f] === k ? "is-on" : ""}">${v}</button>`).join("")}</div>`;

  // ---- phone numbers: a list of chips. Type a number (it is added at the 10th digit) or paste a list - spaces, commas or new lines all work, and
  // duplicates are skipped. Nothing needs a "new line" key (a number keypad has none); the Add button / Enter does it too. ----------------------
  const PH_MAX = 100;
  const phMsg = { offer: null, block: null }; // {t, warn}
  const PL = {
    offer: { get: () => phoneArr(w && w.phones), set: (a) => { w.phones = a.join("\n"); } },
    block: { get: () => phoneArr(settings && settings.blocked), set: (a) => { settings.blocked = a; } },
  };
  function phoneArr(v) {
    const seen = new Set(), out = [];
    for (const x of Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)) {
      const d = String(x).replace(/\D/g, "");
      if (d.length < 10) continue;
      const p = d.slice(-10);
      if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
    return out;
  }
  /** The numbers in a typed / pasted text. Commas, semicolons and new lines separate numbers; spaces separate them too, while a number may itself hold
   * spaces or dashes ("98765 43210", "+91 98765 43210", "+91-98765-43210"): the pieces are joined until they make up one number (10 digits, or 12 after +91). */
  function phoneTokens(text) {
    const out = [];
    for (const seg of String(text || "").split(/[,;\n\r]+/)) {
      let cur = [], digits = 0, target = 10;
      for (const tok of seg.split(/\s+/)) {
        const d = tok.replace(/\D/g, "").length;
        if (!d) continue;
        if (!cur.length) target = /^\+/.test(tok) ? 12 : 10;
        cur.push(tok); digits += d;
        if (digits >= target) { out.push(cur.join(" ")); cur = []; digits = 0; }
      }
      if (cur.length) out.push(cur.join(" "));
    }
    return out;
  }
  function phAdd(kind, text) {
    const list = PL[kind].get(), have = new Set(list);
    let added = 0, dup = 0, full = false;
    const bad = [];
    const toks = phoneTokens(text);
    for (const tok of toks) {
      const d = tok.replace(/\D/g, "");
      if (d.length < 10 || d.length > 13) { bad.push(tok.trim()); continue; }
      const p = d.slice(-10);
      if (have.has(p)) { dup++; continue; }
      if (list.length >= PH_MAX) { full = true; continue; }
      have.add(p); list.push(p); added++;
    }
    PL[kind].set(list);
    const parts = [];
    if (added) parts.push(`Added ${added}`);
    if (dup) parts.push(`${dup} already in the list`);
    if (bad.length) parts.push(`Skipped (not a 10-digit number): ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? " …" : ""}`);
    if (full) parts.push(`A list holds up to ${PH_MAX} numbers`);
    if (!toks.length) parts.push("Type a 10-digit number first");
    phMsg[kind] = { t: parts.join(" · "), warn: !!(bad.length || full || !toks.length) };
  }
  function phonesHtml(kind) {
    const list = PL[kind].get(), m = phMsg[kind];
    const chips = list.map((x) => `<span class="rwa-ph-chip">${x}<button type="button" data-a="phdel" data-n="${x}" aria-label="Remove ${x}">×</button></span>`).join("");
    return `<div class="rwa-phones" data-pl="${kind}">
      <div class="rwa-ph-add"><input class="rwa-in" data-a="phin" type="tel" inputmode="numeric" autocomplete="off" enterkeyhint="done" placeholder="Number, or paste a list" aria-label="Phone number" /><button type="button" class="btn btn-gold btn-sm" data-a="phadd">Add</button></div>
      <small class="rwa-ph-hint${m && m.warn ? " is-warn" : ""}">${esc(m && m.t ? m.t : "Paste many at once: spaces, commas or new lines all work. Duplicates are skipped.")}</small>
      ${list.length ? `<div class="rwa-ph-top"><b>${list.length} number${list.length === 1 ? "" : "s"}</b>${list.length > 1 ? `<button type="button" class="rwa-link" data-a="phclear">Remove all</button>` : ""}</div><div class="rwa-ph-chips">${chips}</div>` : ""}
    </div>`;
  }
  /** Redraws just the number list (not the whole page), and puts the cursor back in the box so more can be typed. */
  function phRedraw(kind, refocus) {
    const box = root.querySelector(`[data-pl="${kind}"]`);
    if (!box) return;
    box.outerHTML = phonesHtml(kind);
    if (refocus) { const i = root.querySelector(`[data-pl="${kind}"] [data-a="phin"]`); if (i) i.focus(); }
  }
  function phInput(t, e) {
    const box = t.closest("[data-pl]");
    if (!box) return;
    const kind = box.dataset.pl, v = t.value;
    const paste = !!(e && e.inputType && e.inputType.indexOf("Paste") >= 0);
    const digits = v.replace(/\D/g, "");
    // pasted: always; typed: when a comma / new line comes or the 10th digit is typed (not when it starts with +, the country code makes it longer)
    if (paste || /[,;\n]/.test(v) || (digits.length >= 10 && !/^\s*\+/.test(v))) { phAdd(kind, v); phRedraw(kind, true); }
  }

  // ---- the limits line: how the budget and the number of orders fit together (live while typing) -------------------------------------------
  const cents = (x) => Math.round(Number(x) * 100);
  function limitInfo() {
    const budget = numOrNull(w.budget), orders = numOrNull(w.maxOrders);
    const flat = w.kind === "FLAT";
    const per = flat ? numOrNull(w.value) : numOrNull(w.perClaim);
    const used = editId && detail ? Number(detail.usedAmount || 0) + Number(detail.heldAmount || 0) : 0;
    const usedN = editId && detail ? Number(detail.usedCount || 0) + Number(detail.heldCount || 0) : 0;
    if (budget != null && cents(budget) < cents(used)) return { err: `${rs(used)} is already given or held, so the budget can't be below that.` };
    if (orders != null && orders < usedN) return { err: `${usedN} order${usedN === 1 ? "" : "s"} already used or hold this offer, so the number of orders can't be below that.` };
    if (!(budget > 0) && !(orders > 0)) return { warn: "No limit set: it keeps giving until you pause or end it." };
    if (flat) {
      if (!(per > 0)) return { info: "Fill in “Rupees off” above to see how the budget and the orders fit." };
      const b = cents(budget || 0), p = cents(per);
      if (budget > 0 && b < p) return { err: `The budget (${rs(budget)}) is less than the ${rs(per)} off, so not even one order could get it.` };
      if (budget > 0 && orders > 0) {
        const cap = Math.floor(b / p);
        if (orders > cap) return { err: `${rs(budget)} only covers ${cap} order${cap === 1 ? "" : "s"} of ${rs(per)}. Use ${cap} or fewer orders, or raise the budget to ${rs(orders * per)}.` };
        const give = orders * per;
        if (cents(give) < b) return { warn: `${orders} × ${rs(per)} = ${rs(give)} at most. ${rs(budget - give)} of the budget will stay unused.` };
        return { ok: `${orders} order${orders === 1 ? "" : "s"} × ${rs(per)} = ${rs(give)} given away at most.` };
      }
      if (budget > 0) {
        const cap = Math.floor(b / p), rest = (b - cap * p) / 100;
        return rest > 0 ? { warn: `${rs(budget)} ÷ ${rs(per)} = ${cap} order${cap === 1 ? "" : "s"}. ${rs(rest)} is left over and can never be given. Use ${rs(cap * per)} to use it all.` }
          : { ok: `${rs(budget)} ÷ ${rs(per)} = ${cap} order${cap === 1 ? "" : "s"}.` };
      }
      return { ok: `${orders} order${orders === 1 ? "" : "s"} × ${rs(per)} = ${rs(orders * per)} given away at most.` };
    }
    // a percent / free-delivery offer gives a different amount each time, so this is only a guide
    if (budget > 0 && !(per > 0)) return { info: "Set the most one order can get (in “What it gives”) so the budget can be shared out." };
    if (per > 0 && budget > 0) return { info: `Up to ${rs(per)} per order: ${rs(budget)} covers at least ${Math.floor(cents(budget) / cents(per))} orders (more when orders get less).` };
    if (per > 0 && orders > 0) return { info: `${orders} order${orders === 1 ? "" : "s"} × up to ${rs(per)} = ${rs(orders * per)} at most.` };
    return { info: "" };
  }
  function limitHtml() {
    const li = limitInfo();
    const t = li.err || li.warn || li.ok || li.info || "";
    const cls = li.err ? "err" : li.warn ? "warn" : li.ok ? "ok" : "info";
    return `<div class="rwa-limit is-${cls}" data-live="limits"${t ? "" : " hidden"} role="status">${esc(t)}</div>`;
  }
  function minHint() {
    const v = w.kind === "FLAT" ? numOrNull(w.value) : null;
    const m = numOrNull(w.minOrder) || 0;
    return v > 0 && m < v ? `Smaller orders would get ${rs(v)} off too (up to the order total). Set a minimum above ${rs(v)} to stop that.` : "";
  }
  /** Keeps the two live lines right while a number is typed (no redraw, so the keyboard stays). */
  function liveUpdate(f) {
    if (["budget", "maxOrders", "value", "perClaim"].includes(f)) { const el = root.querySelector('[data-live="limits"]'); if (el) el.outerHTML = limitHtml(); }
    if (["value", "minOrder"].includes(f)) { const el = root.querySelector('[data-live="minhint"]'); if (el) el.textContent = minHint(); }
  }

  const BANNER_HINT = {
    TEXT: "The card is drawn from the offer: the amount, name, timer and Claim button.",
    IMAGE: "Customers see only your picture. Tapping it claims the offer (or opens the checkout once it is reserved). No timer or text is drawn on it, so put what you want to say in the picture.",
    BOTH: "Your picture is the background; the amount, name, timer and Claim button are drawn on top of it. Use a picture with no writing on it (or empty space on the left), otherwise its words will overlap the drawn text. To use a picture with its own words, choose \"My picture only\".",
  };
  const picUrl = (id) => Utils.resolveImageUrl(`/api/rewards/image/${encodeURIComponent(id)}`);
  function pictureHtml() {
    return `<div class="rwa-pic">
      ${w.imageId ? `<img class="rwa-pic-img" src="${esc(picUrl(w.imageId))}" alt="Your banner picture" />` : `<div class="rwa-pic-empty">No picture yet</div>`}
      <div class="rwa-pic-row">
        <label class="rwa-pic-btn${picBusy ? " is-busy" : ""}"><span>${picBusy ? "Uploading…" : w.imageId ? "Change picture" : "Upload picture"}</span><input type="file" accept="image/*" data-a="pic" hidden${picBusy ? " disabled" : ""} /></label>
        ${w.imageId && !picBusy ? `<button type="button" class="rwa-link" data-a="picdel">Remove picture</button>` : ""}
      </div>
      <small>Best size: wide, about 1200 × 525 px (a little is cropped on big screens). It is saved when you save the offer.</small>
    </div>`;
  }

  /** Makes a picture small (longest side 1400 px, JPEG) before it is sent, like the sliding banners do. */
  async function shrinkPic(file) {
    const url = URL_.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("That file isn't a picture this browser can read")); i.src = url; });
      const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const cx = c.getContext("2d");
      cx.fillStyle = "#fff";
      cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("Couldn't prepare that picture");
      return new File([blob], "banner.jpg", { type: "image/jpeg" });
    } finally { URL_.revokeObjectURL(url); }
  }

  async function uploadPic(input) {
    const file = (input.files || [])[0];
    input.value = "";
    if (!file || !w || picBusy) return;
    if (file.type && !file.type.startsWith("image/")) { Toast.show(`"${file.name}" isn't a picture`, "error"); return; }
    if (file.size > 40 * 1024 * 1024) { Toast.show("That picture is too big (over 40 MB)", "error"); return; }
    picBusy = true; render();
    try {
      const small = await shrinkPic(file);
      const form = new FormData();
      form.append("file", small);
      const r = await Api.upload(`${URL}/image`, form);
      w.imageId = r.id;
      if (w.bannerMode === "TEXT") w.bannerMode = "IMAGE"; // (a picture was added: show it)
      Toast.show("Picture added - it goes live when you save the offer", "success");
    } catch (e) { toastErr(e); }
    picBusy = false;
    render();
  }

  function editHtml() {
    const flat = w.kind === "FLAT", pct = w.kind === "PERCENT", free = w.kind === "FREE_DELIVERY";
    let n = 0;
    return `<button type="button" class="settings-back" data-a="cancel"><span aria-hidden="true">←</span> ${editId ? "Back" : "All offers"}</button>
    <h2 class="us-title">${editId ? "Edit offer" : "New offer"}</h2>
    <section class="rwa-sec"><h3 class="rwa-h">${++n} · The offer</h3>
      ${field("Name (customers see this)", inp("name", "text", 'maxlength="80" placeholder="e.g. Monsoon ₹50 off"'))}
      ${field("Short line (optional)", inp("note", "text", 'maxlength="160" placeholder="e.g. First 20 orders only"'), "Shown to customers under the offer name, and on the order once they use it.")}
      ${field("Big line on the home banner", seg("headlineMode", { AUTO: "Show the amount", TEXT: "My own text", NONE: "Hide it" }), w.headlineMode === "TEXT" ? "Replaces the amount (like ₹50 off) on the big line of the home banner." : w.headlineMode === "NONE" ? "The banner starts with the offer name instead." : "The amount is worked out from the offer, like ₹50 off or 10% off.")}
      ${w.headlineMode === "TEXT" ? field("Your big line", inp("headline", "text", 'maxlength="60" placeholder="e.g. MONSOON SALE"')) : ""}
      ${field("Home banner look", seg("bannerMode", { TEXT: "Text card", IMAGE: "My picture only", BOTH: "Picture + details" }), BANNER_HINT[w.bannerMode] || BANNER_HINT.TEXT)}
      ${w.bannerMode !== "TEXT" || w.imageId ? pictureHtml() : ""}
    </section>
    <section class="rwa-sec"><h3 class="rwa-h">${++n} · What it gives</h3>
      ${seg("kind", KIND)}
      ${flat ? field("Rupees off", inp("value", "number", 'placeholder="e.g. 100"')) : ""}
      ${pct ? field("Percent off", inp("value", "number", 'placeholder="e.g. 10"')) + field("Most one order can get (₹)", inp("perClaim", "number", 'placeholder="e.g. 100"'), "Needed with a budget, so the budget can be shared out. Leave empty for no cap.") : ""}
      ${free ? field("Most delivery it can cover (₹)", inp("perClaim", "number", 'placeholder="e.g. 40"'), "Free delivery: the delivery charge, up to this. Leave empty to cover all of it.") : ""}
      <label class="rwa-f"><span>Minimum order (₹)</span>${inp("minOrder", "number", 'placeholder="0"')}<small data-live="minhint">${esc(minHint())}</small></label>
      ${!free ? field("Never more than … % of the order (optional)", inp("maxPct", "number", 'placeholder="e.g. 15"'), "A safety limit on the discount, whatever the order.") : ""}
    </section>
    <section class="rwa-sec"><h3 class="rwa-h">${++n} · Limits (empty = no limit)</h3>
      ${field("Budget to give away (₹)", inp("budget", "number", 'placeholder="e.g. 2000"'))}
      <div class="rwa-f"><span>Number of orders</span><div class="rwa-inline">${inp("maxOrders", "number", 'placeholder="e.g. 50"')}<label class="ch-check rwa-showleft"><input type="checkbox" data-f="showLeft" ${w.showLeft ? "checked" : ""} /><span>Show “N left”</span></label></div><small>${w.showLeft ? "Customers see how many are left, like “Only 3 left”." : "Customers won’t see the “N left” counter. The limit still applies."}</small></div>
      ${limitHtml()}
      ${field("Times one phone number can use it", inp("perPhone", "number"))}
    </section>
    ${free ? "" : `<section class="rwa-sec"><h3 class="rwa-h">${++n} · Applies to</h3>
      ${seg("scope", { ORDER: "Whole order", ITEMS: "Chosen items", CATEGORY: "Categories" })}
      ${w.scope !== "ORDER" ? `${chooserHtml(w.scope, w.scopeKeys, w._q)}
        ${field("Needs at least this many units", inp("minQty", "number", 'placeholder="1"'))}
        ${pct ? field("Counts at most this many units (optional)", inp("maxQty", "number", 'placeholder="e.g. 6"'), "e.g. eggs: 20% off the first 6 only.") : ""}` : ""}
    </section>`}
    <section class="rwa-sec"><h3 class="rwa-h">${++n} · When</h3>
      ${field("Starts (empty = right away)", inp("starts", "datetime-local"))}
      ${field("Ends (empty = no end date)", inp("ends", "datetime-local"))}
      <div class="rwa-quick"><span>Ends in:</span>${[["1h", 1], ["6h", 6], ["24h", 24], ["3 days", 72], ["7 days", 168]].map(([t, h]) => `<button type="button" class="rwa-pill" data-a="endin" data-h="${h}">${t}</button>`).join("")}</div>
    </section>
    <section class="rwa-sec"><h3 class="rwa-h">${++n} · Who and how</h3>
      ${field("Who can have it", seg("audience", AUD))}
      ${w.audience === "PHONES" ? `<div class="rwa-f"><span>Phone numbers</span>${phonesHtml("offer")}</div>` : ""}
      ${field("How customers get it", seg("mode", MODE), w.mode === "AUTO" ? "Applied by itself at checkout (still counts against the limits)." : w.mode === "CLAIM" ? "A Claim button holds a spot for them - the “N left” counter and the countdown create the urgency." : "Hidden. Customers type the code at checkout or in My rewards.")}
      ${w.mode === "CODE" ? field("Code", inp("code", "text", 'maxlength="20" placeholder="e.g. EGGS10" style="text-transform:uppercase"')) : ""}
      ${w.mode !== "AUTO" ? field("Hold a spot for (minutes)", inp("holdMinutes", "number", 'placeholder="10"'), "While they check out. It goes back to everyone else if they leave.") : ""}
      <label class="ch-check"><input type="checkbox" data-f="returnOnCancel" ${w.returnOnCancel ? "checked" : ""} /><span>Give the spot and budget back if the order is cancelled</span></label>
    </section>
    <div class="rwa-savebar">
      ${editId ? `<button type="button" class="btn btn-gold btn-block" data-a="save" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save changes"}</button>`
        : `<button type="button" class="btn btn-ghost" data-a="draft" ${busy ? "disabled" : ""}>Save as draft</button><button type="button" class="btn btn-gold" data-a="create" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Start offer"}</button>`}
    </div>`;
  }

  // ---- drawing: vouchers + settings --------------------------------------------------------------------------------------------
  function vouchersHtml() {
    const edit = canEdit();
    const v = vouchers;
    const give = !edit ? "" : `<section class="rwa-sec"><h3 class="rwa-h">Give a voucher</h3>
      <p class="rwa-hint">A gift for one customer: rupees off an order, valid for some days.</p>
      ${field("Customer's mobile number", `<input class="rwa-in" data-g="phone" type="tel" inputmode="numeric" maxlength="14" placeholder="10-digit number" />`)}
      <div class="ch-grid rwa-g3">${field("Rupees off", `<input class="rwa-in" data-g="amount" type="number" inputmode="decimal" min="0" placeholder="100" />`)}${field("Min order (₹)", `<input class="rwa-in" data-g="minOrder" type="number" inputmode="decimal" min="0" placeholder="0" />`)}${field("Valid for (days)", `<input class="rwa-in" data-g="days" type="number" inputmode="numeric" min="1" value="30" />`)}</div>
      ${field("Title", `<input class="rwa-in" data-g="title" type="text" maxlength="80" placeholder="e.g. A thank-you from us" />`)}
      <button type="button" class="btn btn-gold btn-block" data-a="give">🎟️ Give voucher</button></section>`;
    return `<button type="button" class="settings-back" data-a="back"><span aria-hidden="true">←</span> All offers</button>
      <h2 class="us-title">Vouchers</h2>${give}
      <h3 class="rwa-h">Given so far</h3>
      <div class="rwa-search"><input class="rwa-in" data-a="vq" type="tel" inputmode="numeric" placeholder="Find a customer by number" value="${esc(v ? v.phone : "")}" /></div>
      <div class="rwa-claims" id="rwaVList">${vlistHtml()}</div>`;
  }

  /** The vouchers read so far (ten at a time) + "Load more". Redrawn on its own: the form above and the search box are not touched. */
  function vlistHtml() {
    const edit = canEdit();
    const v = vouchers;
    if (!v || (v.loading && !v.rows.length && !v.more)) return spinRow("Loading…");
    if (v.failed) return `<p class="rwa-hint">Could not load the vouchers.</p><div class="rwa-morewrap"><button type="button" class="btn btn-ghost btn-sm rwa-more" data-a="retryv">Try again</button></div>`;
    const vinfo = (x) => [x.title + (x.source === "LOYALTY" ? " (loyalty)" : ""), x.note || "", x.minOrder > 0 ? `min order ${rs(x.minOrder)}` : "", x.order ? (x.status === "USED" ? `used on order ${x.order}` : x.status === "AVAILABLE" ? `given back (order ${x.order} was cancelled)` : `was on order ${x.order}`) : "", `valid till ${fmtDT(x.ends)}`].filter(Boolean).join(" · ");
    const rows = v.rows.map((x) => `<div class="rwa-row rwa-vrow"><span class="rwa-ph">${esc(x.phone)}</span><span class="rwa-chip is-${x.status.toLowerCase()}">${esc(x.status === "AVAILABLE" ? "Available" : x.status === "USED" ? "Used" : x.status === "REVOKED" ? "Taken back" : "Expired")}</span><b class="rwa-amt">${rs(x.amount)}</b><span class="rwa-dim">${esc(vinfo(x))}</span>${edit && x.status === "AVAILABLE" ? `<button type="button" class="btn btn-ghost btn-sm rwa-danger" data-a="revoke" data-id="${x.id}">Take back</button>` : ""}</div>`).join("");
    return (rows || `<p class="rwa-hint">${v.phone ? "No vouchers for this number." : "No vouchers yet."}</p>`) + (v.more ? moreBtn("morev", v.loading) : "");
  }

  /** "Loyalty": its own page (one standing rule for the whole shop: a voucher after every N delivered orders). Shares the loaded settings with the Settings page. */
  function loyaltyHtml() {
    const s = settings;
    const back = `<button type="button" class="settings-back" data-a="back"><span aria-hidden="true">←</span> All offers</button>`;
    if (!s) return back + spinRow("Loading…");
    const rule = s.loyaltyOn ? `Every ${s.loyaltyEvery} delivered order${s.loyaltyEvery === 1 ? "" : "s"}, the customer gets a ${rs(s.loyaltyAmount)} voucher${s.loyaltyMinOrder > 0 ? ` for orders of ${rs(s.loyaltyMinOrder)} or more` : ""}, valid for ${s.loyaltyDays} day${s.loyaltyDays === 1 ? "" : "s"}.` : "Switched off: no loyalty vouchers are given.";
    return `${back}
      <h2 class="us-title">Loyalty reward</h2>
      <p class="us-sub">Thank customers who keep ordering. Every voucher it gives is listed under Vouchers, marked (loyalty).</p>
      ${featureOff ? `<p class="rwa-hint rwa-warn">Rewards &amp; offers are switched OFF, so no loyalty vouchers are given until you turn it back on.</p>` : ""}
      <section class="rwa-sec">
        <label class="rwa-switchrow"><span><b>Reward loyal customers</b><small>${esc(rule)}</small></span>
          <label class="mp-switch" aria-label="Loyalty reward"><input type="checkbox" data-s="loyaltyOn" ${s.loyaltyOn ? "checked" : ""} /><span></span></label></label>
        <div class="${s.loyaltyOn ? "" : "rwa-off"}">
          ${field("Every … delivered orders", `<input class="rwa-in" data-s="loyaltyEvery" type="number" inputmode="numeric" min="1" value="${s.loyaltyEvery}" />`)}
          ${field("Voucher amount (₹)", `<input class="rwa-in" data-s="loyaltyAmount" type="number" inputmode="decimal" min="1" value="${s.loyaltyAmount}" />`)}
          ${field("Minimum order to use it (₹)", `<input class="rwa-in" data-s="loyaltyMinOrder" type="number" inputmode="decimal" min="0" value="${s.loyaltyMinOrder}" />`)}
          ${field("Valid for (days)", `<input class="rwa-in" data-s="loyaltyDays" type="number" inputmode="numeric" min="1" value="${s.loyaltyDays}" />`)}
          ${field("Title", `<input class="rwa-in" data-s="loyaltyTitle" type="text" maxlength="80" value="${esc(s.loyaltyTitle)}" />`)}
        </div></section>
      <div class="rwa-savebar"><button type="button" class="btn btn-gold btn-block" data-a="savesettings" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save"}</button></div>`;
  }

  function settingsHtml() {
    const s = settings;
    if (!s) return `<button type="button" class="settings-back" data-a="back"><span aria-hidden="true">←</span> All offers</button>${spinRow("Loading…")}`;
    return `<button type="button" class="settings-back" data-a="back"><span aria-hidden="true">←</span> All offers</button>
      <h2 class="us-title">Settings</h2>
      <section class="rwa-sec"><h3 class="rwa-h">Offers on the home page</h3>
        <p class="rwa-hint">Where customers see the offers slider. Offers are always shown on the Final Step page too.</p>
        ${field("Show offers", `<select class="rwa-in" data-s="homeWhere">${[["PRODUCTS", "Among the products (like a banner)"], ["ABOVE_CATEGORIES", "At the very top, above the categories"], ["BELOW_CATEGORIES", "Below the categories"], ["HIDDEN", "Not on the home page"]].map(([v, t]) => `<option value="${v}" ${(s.homeWhere || "PRODUCTS") === v ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
        ${(s.homeWhere || "PRODUCTS") === "PRODUCTS" ? field("Position", `<input class="rwa-in" data-s="homePlace" type="number" inputmode="numeric" min="1" max="500" value="${s.homePlace || 1}" />`) + `<p class="rwa-hint">1 = above the first product, 5 = after the 4th product (same as the Banners tab).</p>` : ""}
      </section>
      <section class="rwa-sec"><h3 class="rwa-h">Block list</h3>
        <p class="rwa-hint">These numbers never get any offer or voucher.</p>
        ${phonesHtml("block")}</section>
      <div class="rwa-savebar"><button type="button" class="btn btn-gold btn-block" data-a="savesettings" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save"}</button></div>`;
  }

  // ---- render ----------------------------------------------------------------------------------------------------------------
  function render() {
    if (!canView()) { root.innerHTML = `<p class="rwa-hint">You don't have access to this.</p>`; return; }
    // what is being typed in the box that has the focus survives a redraw (the lists redraw every 20 seconds)
    const act = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
    const keep = act && (act.dataset.f || act.dataset.g || act.dataset.s || act.dataset.a) ? { sel: ["f", "g", "s", "a"].map((k) => (act.dataset[k] ? `[data-${k}="${act.dataset[k]}"]` : "")).join(""), start: act.selectionStart, end: act.selectionEnd } : null;
    const scroll = window.scrollY;
    const sec = root.closest("#view-rewards");
    if (sec) sec.classList.toggle("rwa-sub", page !== "list"); // (one back button at a time: the page's own "All offers" replaces the shell's "More")
    root.innerHTML = `<div class="rwa-wrap${page === "edit" || page === "settings" || page === "loyalty" ? " has-bar" : ""}">${page === "edit" ? editHtml() : page === "detail" ? detailHtml() : page === "vouchers" ? vouchersHtml() : page === "settings" ? settingsHtml() : page === "loyalty" ? loyaltyHtml() : listHtml()}</div>`;
    if (keep && keep.sel) {
      const el = root.querySelector(keep.sel);
      if (el && el.tagName !== "BUTTON") { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch (_) { /* number boxes have no selection */ } }
    }
    if (window.scrollY !== scroll) window.scrollTo(0, scroll); // (a redraw does not move the page)
  }

  // ---- the editor's data -------------------------------------------------------------------------------------------------------
  const BLANK = () => ({ name: "", note: "", headlineMode: "AUTO", headline: "", imageId: null, bannerMode: "TEXT", kind: "FLAT", value: "", perClaim: "", minOrder: "", maxPct: "", scope: "ORDER", scopeKeys: [], minQty: "", maxQty: "",
    budget: "", maxOrders: "", perPhone: 1, starts: "", ends: "", audience: "ALL", phones: "", mode: "CLAIM", code: "", holdMinutes: 10, returnOnCancel: true, showLeft: true });

  function fromServer(o) {
    return { name: o.name || "", note: o.note || "", headlineMode: o.headlineMode || "AUTO", headline: o.headline || "", imageId: o.imageId || null, bannerMode: o.bannerMode || "TEXT", kind: o.kind, value: o.kind === "FREE_DELIVERY" ? "" : o.value, perClaim: o.kind === "FLAT" ? "" : (o.perClaim || ""), minOrder: o.minOrder || "",
      maxPct: o.maxPct || "", scope: o.scope, scopeKeys: (o.keys || []).map(String), minQty: o.minQty || "", maxQty: o.maxQty || "", budget: o.budget == null ? "" : o.budget,
      maxOrders: o.maxOrders == null ? "" : o.maxOrders, perPhone: o.perPhone || 1, starts: toInput(o.starts), ends: toInput(o.ends), audience: o.audience,
      phones: (o.phones || []).join("\n"), mode: o.mode, code: o.code || "", holdMinutes: o.hold || 10, returnOnCancel: o.returnOnCancel !== false, showLeft: o.showLeft !== false };
  }

  /** The value of one field as the server takes it. */
  function wire(f, v) {
    switch (f) {
      case "name": case "note": case "code": case "headline": return String(v || "").trim();
      case "kind": case "scope": case "audience": case "mode": case "headlineMode": case "bannerMode": return v;
      case "imageId": return v ? Number(v) : null;
      case "scopeKeys": return [...v];
      case "phones": return String(v || "").split(/[\s,;]+/).map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
      case "starts": case "ends": return fromInput(v);
      case "returnOnCancel": case "showLeft": return !!v;
      case "perPhone": case "holdMinutes": return numOrNull(v);
      case "value": case "perClaim": case "minOrder": case "minQty": return numOrNull(v) == null ? 0 : numOrNull(v);
      default: return numOrNull(v); // maxPct, maxQty, budget, maxOrders: empty = no limit
    }
  }
  const FIELDS = ["name", "note", "headlineMode", "headline", "imageId", "bannerMode", "kind", "value", "perClaim", "minOrder", "maxPct", "scope", "scopeKeys", "minQty", "maxQty", "budget", "maxOrders", "perPhone",
    "starts", "ends", "audience", "phones", "mode", "code", "holdMinutes", "returnOnCancel", "showLeft"];

  /** Only the fields that differ from what the offer was opened with. */
  function changes() {
    const out = {};
    for (const f of FIELDS) {
      const a = wire(f, w[f]), b = wire(f, orig[f]);
      if (JSON.stringify(a) !== JSON.stringify(b)) out[f] = a;
    }
    return out;
  }

  const SCOPE_NEEDS_INDEX = () => w && (w.scope === "ITEMS" || w.scope === "CATEGORY");
  async function ensureIndex() {
    if (SCOPE_NEEDS_INDEX() && !index && !indexFail) { await loadIndex(); if (page === "edit") render(); }
  }

  // ---- actions ----------------------------------------------------------------------------------------------------------------------
  async function changeStatus(id, status, text) {
    try {
      await Api.post(`${URL}/${id}/status`, { status });
      Toast.show(text, "success");
      dropAll();
      if (page === "detail") { await reloadDetail(true); } else await loadList(curKey(), true);
    } catch (e) { toastErr(e); }
  }

  async function save(asStatus) {
    if (busy) return;
    const li = limitInfo();
    if (li.err) { Toast.show(li.err, "error"); return; }
    if (picBusy) { Toast.show("Wait for the picture to finish uploading", "info"); return; }
    if (w.bannerMode !== "TEXT" && !w.imageId) { Toast.show("Upload the banner picture first, or choose the text card", "error"); return; }
    busy = true; render();
    try {
      if (editId) {
        const body = changes();
        if (!Object.keys(body).length) { Toast.show("Nothing was changed", "info"); busy = false; render(); return; }
        await Api.patch(`${URL}/${editId}`, body);
        Toast.show("Saved", "success");
        dropAll();
        busy = false;
        await openDetail(editId);
      } else {
        const body = {};
        for (const f of FIELDS) body[f] = wire(f, w[f]);
        body.status = asStatus;
        const r = await Api.post(URL, body);
        Toast.show(asStatus === "ACTIVE" ? "Offer started" : "Saved as a draft", "success");
        dropAll();
        busy = false;
        await openDetail(r.id);
      }
    } catch (e) { busy = false; render(); toastErr(e); }
  }

  /** Vouchers: a search number ("" = everybody) is read once and kept; coming back shows it at once and asks again only when it is old. */
  async function loadVouchers(more, phone) {
    const p = phone != null ? phone : vouchers ? vouchers.phone : "";
    const q = (extra) => `${URL}/vouchers?size=${PAGE}${p ? "&phone=" + encodeURIComponent(p) : ""}${extra || ""}`;
    if (more) { // the next ten, added under the ones already shown
      const cur = vouchers;
      if (!cur || !cur.more || cur.loading || !cur.rows.length) return;
      cur.loading = true;
      paintVouchers();
      try {
        const d = await Api.get(q("&before=" + cur.rows[cur.rows.length - 1].id));
        const seen = new Set(cur.rows.map((r) => r.id));
        cur.rows = cur.rows.concat(d.vouchers.filter((r) => !seen.has(r.id)));
        cur.more = d.more;
        cur.at = Date.now();
      } catch (e) { toastErr(e); }
      cur.loading = false;
      if (vouchers === cur) paintVouchers();
      return;
    }
    const hit = vCache.get(p);
    if (hit) {
      vouchers = hit;
      paintVouchers();
      if (Date.now() - hit.at < FRESH_MS || hit.refreshing || hit.loading) return; // (seen a moment ago: nothing is asked)
    }
    const v = hit || { rows: [], more: false, phone: p, loading: true, at: 0 };
    if (!hit) { vouchers = v; paintVouchers(); }
    v.refreshing = true;
    try {
      const d = await Api.get(q());
      v.rows = d.vouchers;
      v.more = d.more;
      v.failed = false;
      v.at = Date.now();
      vCache.set(p, v);
      if (vCache.size > 12) vCache.delete(vCache.keys().next().value); // (only the last few searches are kept)
    } catch (e) { if (!hit) v.failed = true; toastErr(e); }
    v.loading = false;
    v.refreshing = false;
    if (vouchers === v) paintVouchers();
  }

  // ---- events -------------------------------------------------------------------------------------------------------------------------
  const num = (v) => (v === "" ? "" : v);
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.a === "phin") { phInput(t, e); return; }
    if (t.dataset.f && w) { w[t.dataset.f] = t.type === "checkbox" ? t.checked : t.value; liveUpdate(t.dataset.f); return; }
    if (t.dataset.s && settings) { settings[t.dataset.s] = t.value; return; }
    if (t.dataset.a === "itemq" && w) { w._q = t.value; render(); return; }
    if (t.dataset.a === "oq") {
      endedRaw = t.value;
      clearTimeout(oqTimer);
      const hint = root.querySelector("#rwaOqHint");
      if (hint) hint.hidden = !(endedRaw.trim() && !longEnough(endedRaw)); // 1-2 letters: nothing is asked, just a reminder
      if (!longEnough(endedRaw)) searchEnded();                            // emptied or under 3 letters: the whole list is back at once (already loaded, no request)
      else oqTimer = setTimeout(searchEnded, OQ_DELAY);
      return;
    }
    if (t.dataset.a === "vq") { clearTimeout(vqTimer); vqTimer = setTimeout(() => loadVouchers(false, t.value.replace(/\D/g, "").slice(-10)), 450); }
  });
  /** The master switch. The screen shows the new state at once and goes back if the server could not save it. */
  let gateBusy = false;
  async function setGate(off) {
    if (gateBusy || !canEdit()) return;
    gateBusy = true;
    const before = featureOff;
    featureOff = off;
    paintList();
    try {
      const r = await Api.patch(`${URL}/settings`, { off });
      featureOff = !!r.off;
      settings = null; settingsOrig = null; settingsAt = 0; // (the Settings page reads it again next time)
      Toast.show(featureOff ? "Rewards & offers are off" : "Rewards & offers are on", "success");
    } catch (er) { featureOff = before; toastErr(er); }
    gateBusy = false;
    paintList();
  }
  let vqTimer = 0, oqTimer = 0;
  /** The Ended tab's search. Asks the server only when a word has 3 letters, and never when the answer is already known: a result read a
   * moment ago is shown again, and a phrase that contains one that found nothing cannot find anything either. */
  function searchEnded() {
    clearTimeout(oqTimer);
    const q = longEnough(endedRaw) ? endedRaw.trim().toLowerCase().split(/\s+/).join(" ").slice(0, 60) : "";
    if (page !== "list" || tab !== "ended" || q === endedQ) return;
    endedQ = q;
    const key = curKey();
    if (q && !lists[key]) {
      const none = Object.keys(lists).find((k) => k.includes("|") && lists[k] && !lists[k].offers.length && !lists[k].more && q.includes(k.slice(k.indexOf("|") + 1)));
      if (none) lists[key] = { offers: [], more: false, given: 0, live: 0, total: 0, loading: false, refreshing: false, at: lists[none].at };
    }
    const old = Object.keys(lists).filter((k) => k.includes("|") && k !== key);
    if (old.length > 5) delete lists[old[0]]; // (a few recent searches are kept, not all)
    paintList();
    loadList(key, false);
  }
  // the names of chosen items are read (once) only when the Rules box is opened
  root.addEventListener("toggle", async (e) => {
    const d = e.target;
    if (!d || !d.classList || !d.classList.contains("rwa-det")) return;
    rulesOpen = d.open;
    if (d.open && detail && detail.scope === "ITEMS" && !index && !indexFail) { await loadIndex(); if (page === "detail") render(); }
  }, true);
  // a pasted list is read from the clipboard itself (a one-line box would turn its new lines into spaces or drop them)
  root.addEventListener("paste", (e) => {
    const t = e.target;
    if (!t || !t.dataset || t.dataset.a !== "phin" || !e.clipboardData) return;
    const box = t.closest("[data-pl]");
    if (!box) return;
    e.preventDefault();
    phAdd(box.dataset.pl, e.clipboardData.getData("text") || "");
    phRedraw(box.dataset.pl, true);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset && e.target.dataset.a === "oq") { e.preventDefault(); searchEnded(); e.target.blur(); return; } // search now + closes the phone keyboard
    if (e.key !== "Enter" || !e.target.dataset || e.target.dataset.a !== "phin") return;
    e.preventDefault();
    const box = e.target.closest("[data-pl]");
    if (box) { phAdd(box.dataset.pl, e.target.value); phRedraw(box.dataset.pl, true); }
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.f === "returnOnCancel" && w) { w.returnOnCancel = t.checked; return; }
    if (t.dataset.f === "showLeft" && w) { w.showLeft = t.checked; render(); return; }
    if (t.dataset.a === "pic" && w) { uploadPic(t); return; }
    if (t.dataset.a === "gate") { setGate(!t.checked); return; }
    if (t.dataset.s === "loyaltyOn" && settings) { settings.loyaltyOn = t.checked; render(); return; }
    if (t.dataset.s === "homeWhere" && settings) { settings.homeWhere = t.value; render(); return; }
    if (t.dataset.a === "cat" && w) {
      const k = t.dataset.k;
      w.scopeKeys = t.checked ? [...new Set([...w.scopeKeys, k])] : w.scopeKeys.filter((x) => x !== k);
      render();
    }
  });

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || b.tagName === "INPUT") return;
    const a = b.dataset.a;
    const id = +b.dataset.id;
    switch (a) {
      case "tab": tab = b.dataset.t; render(); loadList(curKey(), false); break;
      case "open": openDetail(id); break;
      case "back": page = "list"; detail = null; render(); loadList(curKey(), false); break;
      case "pause": changeStatus(id, "PAUSED", "Paused - customers can't claim it now"); break;
      case "resume": case "start": changeStatus(id, "ACTIVE", "Live"); break;
      case "end":
        if (confirm("End this offer for good? Held spots are given back. You can duplicate it later to run it again.")) changeStatus(detail.id, "ENDED", "Ended");
        break;
      case "del":
        if (!confirm("Delete this offer?")) break;
        try { await Api.del(`${URL}/${detail.id}`); dropAll(); page = "list"; render(); loadList(curKey(), false); } catch (er) { toastErr(er); }
        break;
      case "dup":
        try { const r = await Api.post(`${URL}/${detail.id}/duplicate`, {}); dropAll(); Toast.show("Copied as a draft - check it and start it", "success"); await openDetail(r.id); } catch (er) { toastErr(er); }
        break;
      case "topup": topUp = !topUp; render(); break;
      case "topgo": {
        const tb = numOrNull((root.querySelector('[data-a="tb"]') || {}).value), to = numOrNull((root.querySelector('[data-a="to"]') || {}).value);
        if (!(tb > 0) && !(to > 0)) { Toast.show("Enter how much to add", "info"); break; }
        try { await Api.post(`${URL}/${detail.id}/topup`, { budget: tb > 0 ? tb : undefined, orders: to > 0 ? to : undefined }); topUp = false; dropAll(); Toast.show("Added", "success"); await reloadDetail(true); } catch (er) { toastErr(er); }
        break;
      }
      case "moreclaims": loadClaims(true); break;
      case "moreoffers": loadMoreList(curKey()); break;
      case "new": editId = null; w = BLANK(); orig = BLANK(); page = "edit"; render(); window.scrollTo(0, 0); break;
      case "edit": editId = detail.id; w = fromServer(detail); orig = fromServer(detail); page = "edit"; render(); window.scrollTo(0, 0); ensureIndex(); break;
      case "cancel": if (editId) { page = "detail"; } else { page = "list"; } render(); break;
      case "seg": {
        const f = b.dataset.f, v = b.dataset.v;
        if (w[f] === v) break;
        w[f] = v;
        if (f === "kind" && v === "FREE_DELIVERY") w.scope = "ORDER";
        if (f === "scope") w.scopeKeys = [];
        render();
        if (f === "scope") ensureIndex();
        break;
      }
      case "picdel": w.imageId = null; if (w.bannerMode !== "TEXT") w.bannerMode = "TEXT"; render(); break;
      case "endin": w.ends = toInput(now() + (+b.dataset.h) * 3600 * 1000); render(); break;
      case "pickitem": w.scopeKeys = [...new Set([...w.scopeKeys, b.dataset.k])]; w._q = ""; render(); break;
      case "unpick": w.scopeKeys = w.scopeKeys.filter((x) => x !== b.dataset.k); render(); break;
      case "phadd": {
        const box = b.closest("[data-pl]"), i = box && box.querySelector('[data-a="phin"]');
        if (box) { phAdd(box.dataset.pl, i ? i.value : ""); phRedraw(box.dataset.pl, true); }
        break;
      }
      case "phdel": {
        const box = b.closest("[data-pl]");
        if (box) { PL[box.dataset.pl].set(PL[box.dataset.pl].get().filter((x) => x !== b.dataset.n)); phMsg[box.dataset.pl] = null; phRedraw(box.dataset.pl, false); }
        break;
      }
      case "phclear": {
        const box = b.closest("[data-pl]");
        if (box && confirm("Remove all the numbers from this list?")) { PL[box.dataset.pl].set([]); phMsg[box.dataset.pl] = null; phRedraw(box.dataset.pl, false); }
        break;
      }
      case "save": save(); break;
      case "draft": save("DRAFT"); break;
      case "create": save("ACTIVE"); break;
      case "vouchers": page = "vouchers"; render(); loadVouchers(false, vouchers ? vouchers.phone : ""); break;
      case "morev": loadVouchers(true); break;
      case "retryv": { const p = vouchers ? vouchers.phone : ""; vCache.delete(p); vouchers = null; loadVouchers(false, p); break; }
      case "give": {
        const g = (k) => (root.querySelector(`[data-g="${k}"]`) || {}).value || "";
        try {
          await Api.post(`${URL}/vouchers`, { phone: g("phone"), amount: g("amount"), minOrder: g("minOrder") || 0, days: g("days"), title: g("title") });
          Toast.show("Voucher given", "success");
          // the form is emptied and the list starts again from the newest (the page itself is not redrawn)
          root.querySelectorAll("[data-g]").forEach((el) => { el.value = el.dataset.g === "days" ? "30" : ""; });
          const vq = root.querySelector('[data-a="vq"]');
          if (vq) vq.value = "";
          vCache.clear();
          vouchers = null;
          await loadVouchers(false, "");
        } catch (er) { toastErr(er); }
        break;
      }
      case "revoke":
        if (!confirm("Take this voucher back?")) break;
        try { await Api.post(`${URL}/vouchers/${id}/revoke`, {}); Toast.show("Taken back", "success"); const p = vouchers ? vouchers.phone : ""; vCache.clear(); vouchers = null; await loadVouchers(false, p); } catch (er) { toastErr(er); }
        break;
      case "settings":
      case "loyalty":
        page = a;
        if (settings && settingsOrig && Date.now() - settingsAt < 2 * FRESH_MS) { settings = JSON.parse(settingsOrig); render(); break; }
        settings = null; render();
        try { const s = await Api.get(`${URL}/settings`); settings = { ...s }; settingsOrig = JSON.stringify(settings); settingsAt = Date.now(); } catch (er) { toastErr(er); }
        render();
        break;
      case "savesettings": {
        // only what changed is sent
        const before = JSON.parse(settingsOrig);
        const body = {};
        for (const k of ["loyaltyOn", "loyaltyEvery", "loyaltyAmount", "loyaltyMinOrder", "loyaltyDays", "loyaltyTitle"]) {
          const v = k === "loyaltyOn" ? !!settings[k] : k === "loyaltyTitle" ? String(settings[k] || "") : Number(settings[k]);
          if (v !== before[k]) body[k] = v;
        }
        if ((settings.homeWhere || "PRODUCTS") !== (before.homeWhere || "PRODUCTS")) body.homeWhere = settings.homeWhere;
        if (Number(settings.homePlace || 1) !== Number(before.homePlace || 1)) body.homePlace = Math.max(1, Math.min(500, Math.round(Number(settings.homePlace) || 1)));
        const blocked = Array.isArray(settings.blocked) ? settings.blocked : String(settings.blocked || "").split(/[\s,;]+/).map((x) => x.replace(/\D/g, "").slice(-10)).filter((x) => x.length === 10);
        if (JSON.stringify(blocked) !== JSON.stringify(before.blocked || [])) body.blocked = blocked;
        if (!Object.keys(body).length) { Toast.show("Nothing was changed", "info"); break; }
        busy = true; render();
        try { const s = await Api.patch(`${URL}/settings`, body); settings = { ...s }; settingsOrig = JSON.stringify(settings); settingsAt = Date.now(); Toast.show("Saved", "success"); } catch (er) { toastErr(er); }
        busy = false; render();
        break;
      }
      default: break;
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && root.isConnected && root.closest(".admin-view.active") && page === "list") loadList(curKey(), false);
  });

  return {
    /** Called each time this screen is opened. */
    refresh() {
      if (!canView()) { render(); return; }
      if (page === "list") { render(); loadList(curKey(), false); }
      else render();
      startPoll();
    },
  };
})();
