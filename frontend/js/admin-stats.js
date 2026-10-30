/* The Sales tab: a period dropdown (Today / Yesterday / Last 7 days / Last
 * 30 days / All time / Custom date) that drives everything on the tab —
 * the money + order-count header, the All/New/Delivered/Cancelled boxes,
 * and three sub-tabs underneath (By Day, By Customer, By Item). This
 * module owns the period and the header and the By Day list; By Customer
 * and By Item live in admin-customers.js / admin-items.js, which read the
 * selected period back through getRange(). Also owns the "new orders" nav
 * badge, the custom date-range fields, and the xlsx export/import
 * controls.
 *
 * Switching period (or arriving at the tab) re-fetches the header and the
 * ACTIVE sub-tab only; the other two are just marked dirty and fetched
 * the first time they're opened, so a period change never pays for lists
 * nobody is looking at.
 *
 * Request economy: the header and the By Day list come from ONE request
 * (/summary/overview) — one SQL query on the server too. When By Day isn't
 * the visible sub-tab, only the header is requested (size=0). By Day is
 * paged by the server (31 days, then "Show more days" asks for older
 * ones). Every day row carries all statuses' numbers, so tapping the
 * All / New / Delivered / Cancelled boxes re-renders from data already in
 * hand with no request, and By Customer / By Item do the same whenever
 * their All list was loaded in full (see their own files). A status whose
 * header count is 0 never fetches anything at all. Coming back to the Sales tab doesn't refetch at all unless
 * something marked it stale (an order changed, the poll saw a change, the
 * shop's date rolled over) or the data is more than 5 minutes old. */

window.AdminStats = (() => {
  const pill = document.getElementById("newOrdersPill");
  const periodSelect = document.getElementById("salesPeriod");
  const customRow = document.getElementById("customRangeRow");
  const fromInput = document.getElementById("statsFrom");
  const toInput = document.getElementById("statsTo");
  const fromHint = document.getElementById("statsFromHint");
  const toHint = document.getElementById("statsToHint");
  const applyBtn = document.getElementById("applyRangeBtn");
  const summaryEl = document.getElementById("salesSummary");
  const statusGrid = document.getElementById("salesStatusGrid");
  const subtabs = document.getElementById("salesSubtabs");
  const rangeResult = document.getElementById("rangeResult");
  const exportFilteredBtn = document.getElementById("exportFilteredBtn");
  const exportAllBtn = document.getElementById("exportAllBtn");
  const importFile = document.getElementById("importFile");
  const importResult = document.getElementById("importResult");
  let lastSummary = null; // the header numbers last received from the server
  let summaryValid = false; // true while lastSummary belongs to the period on screen
  let lastSnapshot = null; // skip re-rendering the header when a refresh
  // finds nothing changed, so it doesn't flash on every revisit.

  function card(label, value, sub) {
    return `<div class="stat-card anim-fade-up">
      <div class="label">${label}<span class="spinner spinner-dark stat-spinner" hidden></span></div>
      <div class="value">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>`;
  }

  /** Shows/hides the small spinner next to every header card's label at
   * once — the money card and all four status boxes come from the same
   * single API call and always update together. Re-queries the DOM live
   * each time rather than caching the spinner elements, since the cards'
   * innerHTML only gets replaced when the fetched data actually differs
   * from last time (see renderSummary). */
  function setStatsLoading(loading) {
    document.querySelectorAll("#salesSummary .stat-spinner, #salesStatusGrid .stat-spinner").forEach((el) => {
      el.hidden = !loading;
    });
  }

  // ---- Period -----------------------------------------------------------
  // "Today" is the SHOP's today (India time), not whatever the browser's
  // clock says — an admin checking from a laptop set to another time zone
  // must still get the same days the backend (see SalesService.SHOP_ZONE)
  // buckets orders into. The en-CA locale formats as yyyy-MM-dd, which is
  // exactly what the API's from/to params and <input type="date"> use.
  const SHOP_TIME_ZONE = "Asia/Kolkata";

  function shopToday() {
    return new Date().toLocaleDateString("en-CA", { timeZone: SHOP_TIME_ZONE });
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  const PERIOD_LABELS = {
    today: "Today",
    yesterday: "Yesterday",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    all: "All time",
  };

  let activePeriod = "today"; // the period whose data is on screen
  let customRange = null; // { from, to } once a custom range has been applied

  /** The selected period as { from, to } (inclusive shop-local days,
   *  yyyy-MM-dd), or null for All time. Re-evaluated on every call rather
   *  than stored, so a tab left open past midnight rolls "Today" forward
   *  on its next refresh. The By Customer / By Item modules call this to
   *  scope their own requests. */
  function getRange() {
    const today = shopToday();
    switch (activePeriod) {
      case "today":
        return { from: today, to: today };
      case "yesterday": {
        const y = addDays(today, -1);
        return { from: y, to: y };
      }
      case "7d":
        return { from: addDays(today, -6), to: today };
      case "30d":
        return { from: addDays(today, -29), to: today };
      case "custom":
        return customRange;
      default:
        return null;
    }
  }

  function periodLabel() {
    if (activePeriod === "custom" && customRange) {
      return customRange.from === customRange.to
        ? formatDateDisplay(customRange.from)
        : `${formatDateDisplay(customRange.from)} → ${formatDateDisplay(customRange.to)}`;
    }
    return PERIOD_LABELS[activePeriod] || "Sales";
  }

  /** URL of the overview request: the period's range (no status — the
   *  response carries every status), how many day rows to return (0 = header only) and, for "Show more
   *  days", the oldest day already on screen. */
  function overviewUrl(size, cursorDay) {
    const params = new URLSearchParams();
    const range = getRange();
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    params.set("size", String(size));
    if (cursorDay) params.set("cursorDay", cursorDay);
    return `/api/admin/orders/summary/overview?${params.toString()}`;
  }

  // Which orders the three lists below show — set by tapping the
  // All / New / Delivered / Cancelled boxes. Opens on All so an order
  // placed a minute ago (still New) is visible straight away; tap
  // Delivered for actual sales only. The period header's money card is
  // unaffected: it is always Delivered sales for the period.
  let statusFilter = "ALL";

  function getStatus() {
    return statusFilter;
  }

  // Last known "new orders" badge count. In this app's order lifecycle,
  // EVERY mutation that could change what any Orders/Sales view shows — a
  // new order placed, one marked delivered, cancelled, or reopened —
  // moves an order into or out of NEW status, so it always shifts this
  // count by exactly ±1. That makes it a reliable (if not airtight —
  // two opposite mutations landing in the very same poll tick would net
  // to zero) signal for "did anything actually change" — and its SIGN
  // (see noteNewOrdersCount below) further says what kind of change it
  // was, which is what lets the background poll skip re-fetching a full
  // list or summary it already knows can't have moved, rather than
  // blindly re-requesting one every 15 seconds any time the count so
  // much as twitches.
  let lastKnownNewOrders = null;

  /** Records the latest "new orders" count and reports how it moved
   *  since the last time either this or refresh() checked it — 0 for no
   *  change, a positive number if it went up (an order arrived or was
   *  reopened into NEW), a negative number if it went down (an order
   *  left NEW for DELIVERED or CANCELLED). The sign is what lets the
   *  background poll (admin-main.js) tell a brand-new order — which
   *  can only ever add to the New/All views and never touches Delivered,
   *  Cancelled, or the Sales money totals (only DELIVERED orders count
   *  toward those) — apart from an order leaving NEW, which can affect
   *  any of those and so still needs a real refetch. */
  function noteNewOrdersCount(newOrders) {
    const previous = lastKnownNewOrders;
    lastKnownNewOrders = newOrders;
    return previous === null ? 0 : newOrders - previous;
  }

  function renderSummary(s) {
    const label = periodLabel();
    const data = s || { total: 0, orders: 0, all: 0, newOrders: 0, delivered: 0, cancelled: 0 };
    if (s) lastSummary = s;
    const snapshot = label + JSON.stringify(data);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    summaryEl.innerHTML = card(
      label,
      Utils.formatMoney(data.total),
      `${data.orders} order${data.orders === 1 ? "" : "s"}`
    );
    statusGrid.innerHTML = [
      statusBox("ALL", "All", data.all),
      statusBox("NEW", "New", data.newOrders),
      statusBox("DELIVERED", "Delivered", data.delivered),
      statusBox("CANCELLED", "Cancelled", data.cancelled),
    ].join("");
  }

  /** One of the four status boxes — a button, since tapping it filters
   *  the lists underneath to that status. */
  function statusBox(status, label, count) {
    return `<button type="button" class="stat-card status-box anim-fade-up${status === statusFilter ? " is-selected" : ""}" data-status="${status}">
      <div class="label">${label}<span class="spinner spinner-dark stat-spinner" hidden></span></div>
      <div class="value">${count}</div>
    </button>`;
  }

  /** The header count of the selected status box (All / New / Delivered /
   *  Cancelled) for the period on screen, or null when it isn't known yet
   *  (header still loading). 0 means there is nothing to fetch: every
   *  status is a part of All, so a zero here means that status has no
   *  orders in the period and its list is simply empty — the By Customer /
   *  By Item modules check this before making any request. */
  function getSelectedCount() {
    if (!summaryValid || !lastSummary) return null;
    return { ALL: lastSummary.all, NEW: lastSummary.newOrders, DELIVERED: lastSummary.delivered, CANCELLED: lastSummary.cancelled }[statusFilter] ?? null;
  }

  /** How many orders the whole period has (the All box), or null while
   *  the header is unknown. By Customer / By Item use it to see that their
   *  All list is guaranteed to fit on one page, so a first visit made
   *  while New/Delivered/Cancelled is selected can still fetch All once
   *  and serve every box from it. */
  function getTotalCount() {
    return summaryValid && lastSummary ? lastSummary.all : null;
  }

  statusGrid.addEventListener("click", (e) => {
    const box = e.target.closest(".status-box");
    if (!box || box.dataset.status === statusFilter) return;
    statusFilter = box.dataset.status;
    statusGrid.querySelectorAll(".status-box").forEach((b) => {
      b.classList.toggle("is-selected", b.dataset.status === statusFilter);
    });
    // The header numbers don't depend on the selection, and By Day already
    // holds every status's numbers for each loaded day — so it just
    // re-renders (no request) when it has been loaded; otherwise it waits
    // for its first load. By Customer / By Item decide for themselves
    // whether their loaded All list can answer or a request is needed.
    PANES.forEach((p) => {
      dirty[p] = p !== "days" || !dailyLoaded;
    });
    if (dailyLoaded) renderDays();
    if (dirty[activePane]) refreshPane(activePane);
  });

  let overviewSeq = 0;
  let loadedAt = 0; // when the Sales data on screen was last fetched
  let loadedRangeKey = null; // which period that data was for
  let dailyLoaded = false; // By Day's rows on screen are current for this period
  const FRESH_MS = 5 * 60 * 1000;

  // Why the data on screen might be out of date, recorded while the admin
  // is elsewhere and checked when they come back (refreshIfNeeded). Kept
  // separate on purpose so a change only costs a reload when it can
  // actually affect the period being viewed:
  //  - staleAll: unknown cause (a failed fetch) — reload whatever period.
  //  - changedDates: shop-local days an order change from THIS session
  //    touched (see noteOrderChanged) — reload only a period containing one.
  //  - remoteChanged: the poll saw the new-order count move (a customer
  //    ordered, or another device acted) — those are today's events, so
  //    only a period that includes today is affected.
  let staleAll = true;
  let remoteChanged = false;
  const changedDates = new Set();

  const rangeKey = () => JSON.stringify(getRange());

  /** True when the selected period reaches today (or is All time), i.e. it
   *  can still change just because time passes or a new order arrives. A
   *  period that ended before today only changes if an old order's status
   *  is changed. */
  function includesToday(range) {
    return !range || range.to >= shopToday();
  }

  function inRange(date, range) {
    return !range || (date >= range.from && date <= range.to);
  }

  /** The shop-local yyyy-MM-dd of a timestamp, or null. */
  function shopDateOf(instant) {
    return instant ? new Date(instant).toLocaleDateString("en-CA", { timeZone: SHOP_TIME_ZONE }) : null;
  }

  /** The poll saw something change somewhere while the admin is on another
   *  tab: remember it, but fetch nothing. It only matters to a period that
   *  includes today — see remoteChanged above. */
  function noteRemoteChange() {
    remoteChanged = true;
  }

  /** The poll saw a change while the Sales tab IS open. A period that
   *  ended before today can't be affected by a new order, so it is left
   *  alone — no requests, no re-render; otherwise reload as usual. */
  function onRemoteChange() {
    if (includesToday(getRange())) refresh();
  }

  /** Called when an order's status was changed from the Orders tab, with
   *  the updated order and (if known) how it looked before. Works out
   *  which days that touched — the day it was placed (its New side), the
   *  day it was delivered/cancelled, and, for a reopen, the day it had
   *  been delivered/cancelled before — and clears the cached day lists.
   *  The Sales data is only reloaded on the next visit if the selected
   *  period contains one of those days. */
  function noteOrderChanged(updated, before) {
    // New <-> Packed: Sales counts both as New, on the same day, so nothing here changes.
    const open = (o) => o && (o.status === "NEW" || o.status === "PACKED");
    if (open(updated) && open(before)) return;
    clearDayCaches();
    [updated?.createdAt, updated?.statusUpdatedAt, updated?.deliveredAt, before?.statusUpdatedAt, before?.deliveredAt]
      .map(shopDateOf)
      .filter(Boolean)
      .forEach((d) => changedDates.add(d));
    if (!updated) staleAll = true;
  }

  /** What opening the Sales tab calls: reloads only when there's a reason
   *  — never loaded, a different period than what's on screen (e.g. a
   *  "Yesterday" that rolled over), a recorded change that can affect this
   *  period, or (for a period that includes today) data older than
   *  FRESH_MS. A past period is otherwise never reloaded just by
   *  revisiting. */
  function refreshIfNeeded() {
    const range = getRange();
    const needs =
      !loadedAt ||
      loadedRangeKey !== rangeKey() ||
      staleAll ||
      [...changedDates].some((d) => inRange(d, range)) ||
      (includesToday(range) && (remoteChanged || Date.now() - loadedAt > FRESH_MS));
    if (needs) refresh();
  }

  /** One request for the header (money + status boxes) and, when
   *  `withDays`, the first page of the By Day list. The seq guard drops a
   *  slow earlier response that lands after a newer request was already
   *  made — otherwise flipping quickly between periods could leave the
   *  screen showing the wrong one. Header-only (withDays false) is used
   *  when another sub-tab is the visible one. */
  async function loadOverview(withDays) {
    const seq = ++overviewSeq;
    if (withDays) dailyLoaded = false;
    const firstLoad = lastSnapshot === null;
    const hadDays = rangeResult.children.length > 0;
    if (firstLoad) renderSummary(null); // placeholders, so the spinners have cards to sit in
    setStatsLoading(true);
    if (withDays) {
      // Day/order caches are keyed by date and id, not by period — drop
      // them so a refresh can never show an order list that's gone stale
      // (e.g. delivered from another device since).
      clearDayCaches();
      if (!hadDays) {
        rangeResult.innerHTML = `<div class="skeleton" style="height:56px;margin-bottom:12px;"></div>`.repeat(3);
      }
    }
    try {
      const res = await Api.get(overviewUrl(withDays ? DAYS_FIRST_PAGE : 0));
      if (seq !== overviewSeq) return false;
      summaryValid = true;
      renderSummary(res.summary);
      if (withDays) {
        dailyRows = res.days || [];
        daysHasMore = !!res.hasMore;
        dailyLoaded = true;
        renderDays();
      }
      return true;
    } catch (err) {
      if (seq !== overviewSeq) return false;
      staleAll = true; // let the next visit try again
      if (firstLoad) {
        summaryEl.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
        lastSnapshot = null;
      }
      if (withDays && !hadDays) {
        rangeResult.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
      } else if (!firstLoad) {
        Toast.show(err.message, "error");
      }
      return false;
    } finally {
      if (seq === overviewSeq) setStatsLoading(false);
    }
  }

  // ---- Sub-tabs ----------------------------------------------------------
  const PANES = ["days", "customers", "items"];
  let activePane = "days";
  // A pane is "dirty" when the period (or the underlying orders) may have
  // changed since it last fetched. Only the visible pane refetches
  // eagerly; the rest wait until they're opened.
  const dirty = { days: true, customers: true, items: true };

  const paneRefreshers = {
    days: () => loadOverview(true),
    customers: () => window.AdminSalesCustomers?.refresh(),
    items: () => window.AdminItems?.refresh(),
  };

  function refreshPane(name) {
    dirty[name] = false;
    paneRefreshers[name]();
  }

  function showPane(name) {
    activePane = name;
    subtabs.querySelectorAll(".sales-subtab").forEach((b) => {
      b.classList.toggle("active", b.dataset.pane === name);
    });
    PANES.forEach((p) => {
      document.getElementById(`salesPane-${p}`).hidden = p !== name;
    });
    if (dirty[name]) refreshPane(name);
  }

  subtabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".sales-subtab");
    if (btn) showPane(btn.dataset.pane);
  });

  /** Re-fetches the header and the visible sub-tab for the selected
   *  period — what a period change, an import and the background poll
   *  (while the Sales tab is open) call; opening the tab goes through
   *  refreshIfNeeded() instead. The visible sub-tab and the header cost
   *  one request when it's By Day (the overview carries both), otherwise a
   *  header-only request plus that sub-tab's own. The other sub-tabs are
   *  only marked dirty. */
  async function refresh() {
    staleAll = false;
    remoteChanged = false;
    changedDates.clear();
    loadedAt = Date.now();
    loadedRangeKey = rangeKey();
    summaryValid = false;
    dailyLoaded = false;
    // Whatever By Customer / By Item kept from their last All load may be
    // out of date now — drop it so their next refresh asks the server.
    window.AdminSalesCustomers?.clearCache?.();
    window.AdminItems?.clearCache?.();
    PANES.forEach((p) => {
      dirty[p] = true;
    });
    if (activePane === "days") {
      refreshPane("days");
      return;
    }
    // Another sub-tab is showing: get the header first, so that a status
    // with zero orders in this period can skip its list request entirely
    // (see getSelectedCount). If a newer request superseded this one, or
    // it failed, the list isn't loaded here — the newer request / the
    // next visit does it.
    const ok = await loadOverview(false);
    if (ok && dirty[activePane]) refreshPane(activePane);
  }

  // ---- By Day ------------------------------------------------------------
  const DAYS_FIRST_PAGE = 31; // day rows in the first response
  const DAYS_MORE_PAGE = 62; // day rows per "Show more days" tap — an All-time list can run to hundreds
  let dailyRows = [];
  let daysHasMore = false;
  let loadingMoreDays = false;

  /** The day's numbers for the selected status box, built from the
   *  per-status parts the server sent — or null when the day has no
   *  orders of that status (it isn't listed then). */
  function dayView(day) {
    const inc = {
      ALL: [true, true, true],
      NEW: [true, false, false],
      DELIVERED: [false, true, false],
      CANCELLED: [false, false, true],
    }[statusFilter];
    const n = inc[0] ? day.newOrders : 0;
    const d = inc[1] ? day.deliveredOrders : 0;
    const c = inc[2] ? day.cancelledOrders : 0;
    if (n + d + c === 0) return null;
    return {
      date: day.date,
      orders: n + d + c,
      total: (inc[0] ? day.newTotal : 0) + (inc[1] ? day.deliveredTotal : 0) + (inc[2] ? day.cancelledTotal : 0),
      newOrders: n,
      deliveredOrders: d,
      cancelledOrders: c,
    };
  }

  function dayGroupHtml(day) {
    return `
        <div class="daily-sales-group anim-fade-up">
          <button type="button" class="daily-sales-head" data-role="day-toggle" data-date="${day.date}">
            <span class="daily-sales-date"><span class="daily-sales-head-chevron">▸</span>${formatDateHeading(day.date)}</span>
            <span class="daily-sales-day-total">${Utils.formatMoney(day.total)} · ${day.orders} order${day.orders === 1 ? "" : "s"}${statusFilter === "ALL" ? statusSplit(day.newOrders, day.deliveredOrders, day.cancelledOrders) : ""}</span>
          </button>
          <div class="daily-sales-rows" hidden></div>
        </div>`;
  }

  /** " · 2 new · 3 delivered · 1 cancelled" — only the parts that aren't
   *  zero, shown on the All view only. */
  function statusSplit(newOrders, deliveredOrders, cancelledOrders) {
    return (newOrders ? ` · ${newOrders} new` : "") +
      (deliveredOrders ? ` · ${deliveredOrders} delivered` : "") +
      (cancelledOrders ? ` · ${cancelledOrders} cancelled` : "");
  }

  function showMoreDaysHtml() {
    return `<button type="button" class="btn btn-ghost btn-sm show-more-days" id="showMoreDaysBtn">Show more days</button>`;
  }

  /** Paints the loaded days for the selected status box — purely from
   *  dailyRows, so changing the box costs no request. */
  function renderDays() {
    const views = dailyRows.map(dayView).filter(Boolean);
    const empty = !views.length
      ? `<div class="empty-state"><p>No ${statusFilter === "ALL" ? "" : statusLabel() + " "}orders in this period${daysHasMore ? " among the days loaded so far" : ""}.</p></div>`
      : "";
    rangeResult.innerHTML =
      empty +
      (views.length ? `<div class="daily-sales">${views.map(dayGroupHtml).join("")}</div>` : "") +
      (daysHasMore ? showMoreDaysHtml() : "");
  }

  /** "Show more days": asks the server for the next page of older days
   *  (cursorDay = the oldest day already on screen) and appends it. The
   *  header isn't touched. Dropped if the period changed meanwhile. */
  async function showMoreDays() {
    if (loadingMoreDays || !daysHasMore || !dailyRows.length) return;
    const btn = document.getElementById("showMoreDaysBtn");
    const seq = overviewSeq;
    loadingMoreDays = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Loading…";
    }
    try {
      const res = await Api.get(overviewUrl(DAYS_MORE_PAGE, dailyRows[dailyRows.length - 1].date));
      if (seq !== overviewSeq) return;
      const more = res.days || [];
      dailyRows = dailyRows.concat(more);
      daysHasMore = !!res.hasMore;
      // Append just the new days (days already open stay open); fall back
      // to a full repaint when the list is currently showing the empty note.
      const container = rangeResult.querySelector(".daily-sales");
      if (container) {
        container.insertAdjacentHTML("beforeend", more.map(dayView).filter(Boolean).map(dayGroupHtml).join(""));
        if (!daysHasMore) btn?.remove();
      } else {
        renderDays();
      }
    } catch (err) {
      Toast.show(err.message, "error");
    } finally {
      loadingMoreDays = false;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = "Show more days";
      }
    }
  }

  function statusLabel() {
    return { NEW: "new", DELIVERED: "delivered", CANCELLED: "cancelled" }[statusFilter] || "";
  }

  /** Keeps just the Orders-tab badge live — a single cheap COUNT(*) on
   *  the server, meant to be polled everywhere in the admin panel (not
   *  just the Sales tab) instead of the full multi-bucket summary that
   *  refresh() above fetches. Doesn't touch the stats grid at all.
   *  Returns whether the count actually moved since the last time either
   *  this or refresh() checked it, so the background poll (admin-main.js)
   *  knows whether it's worth re-fetching the currently visible tab's
   *  full data at all. */
  async function refreshBadge() {
    try {
      const { newOrders } = await Api.get("/api/admin/orders/summary/new-count");
      pill.hidden = newOrders === 0;
      pill.textContent = newOrders;
      return noteNewOrdersCount(newOrders);
    } catch (err) {
      // a background badge poll failing silently is fine — the next tick
      // will just try again, and whatever count is already showing stays
      // put rather than being replaced with an error.
      return 0;
    }
  }

  /** Sets the "new orders" badge from a count the caller already has in
   *  hand — no API call of its own. Used when the Orders tab's own list
   *  fetch already told us exactly how many NEW orders there are (its
   *  default filter), so a separate /summary/new-count round trip for
   *  the same number right alongside it would be pure duplication (see
   *  admin-orders.js's refresh()). */
  function setNewOrdersCount(count) {
    pill.hidden = count === 0;
    pill.textContent = count;
    lastKnownNewOrders = count;
  }

  /** Adjusts the "new orders" badge by a known, exact delta (±1) without
   *  asking the server — safe because this app's order lifecycle only has
   *  three statuses (NEW/DELIVERED/CANCELLED), so any single delivered/
   *  cancelled/reopen action always moves an order into or out of NEW
   *  status by exactly this much, and the caller only calls this once the
   *  server has already confirmed the action succeeded (the PATCH
   *  response came back). Falls back to doing nothing if the badge
   *  hasn't loaded a real count yet — the next real fetch will establish
   *  the true value instead of guessing from an unknown base. */
  function adjustNewOrdersCount(delta) {
    if (lastKnownNewOrders === null) return;
    lastKnownNewOrders = Math.max(0, lastKnownNewOrders + delta);
    pill.hidden = lastKnownNewOrders === 0;
    pill.textContent = lastKnownNewOrders;
  }

  // The real <input type="date"> is fully invisible (see admin-sales.css)
  // — .date-field-hint is the only thing ever actually shown for this
  // field, so it has to display whatever the real input's state is:
  // the placeholder text while empty, or the picked date, formatted by
  // us, once one is chosen. A plain placeholder attribute can not do
  // this for a date input on most mobile browsers, and showing the
  // native input itself is what caused the iOS-only box-shrinking /
  // "second box" bug in the first place.
  const DATE_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function formatDateDisplay(value) {
    // value is "YYYY-MM-DD" (the native <input type="date"> format).
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return value;
    const [y, m, d] = parts;
    const dt = new Date(y, m - 1, d);
    return `${dt.getDate()} ${DATE_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  function syncDateHint(input, hint, placeholder) {
    if (input.value) {
      hint.textContent = formatDateDisplay(input.value);
      hint.classList.add("has-value");
    } else {
      hint.textContent = placeholder;
      hint.classList.remove("has-value");
    }
  }

  fromInput.addEventListener("input", () => syncDateHint(fromInput, fromHint, "From Date"));
  toInput.addEventListener("input", () => syncDateHint(toInput, toHint, "To Date"));

  // In case either input already has a value at load time (e.g. the
  // browser restored form state), sync the display box immediately
  // rather than waiting for the first "input" event.
  syncDateHint(fromInput, fromHint, "From Date");
  syncDateHint(toInput, toHint, "To Date");

  // Desktop Chrome/Edge only open the native calendar when the click
  // lands on the small icon at the input's own right edge — clicking
  // anywhere else in the box just places a text cursor. showPicker()
  // opens the same calendar programmatically, so calling it on any
  // click makes the whole box act as the trigger, not just that icon.
  // It is a newer API (not on older Safari/Firefox); where it is
  // missing this is a no-op and the browser's own default click
  // behavior on the icon still works exactly as before.
  function bindWholeBoxOpensPicker(input) {
    input.addEventListener("click", () => {
      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
        } catch (_) {
          // Can refuse outside a direct user gesture, or if the
          // picker is already open — the ordinary click still
          // does whatever the browser would have done anyway.
        }
      }
    });
  }

  bindWholeBoxOpensPicker(fromInput);
  bindWholeBoxOpensPicker(toInput);

  /** Applies whatever is in the custom From/To fields as the period.
   *  Only reachable while "Custom date" is selected (the fields are
   *  hidden otherwise). */
  function applyCustomRange() {
    const from = fromInput.value;
    const to = toInput.value;
    if (!from || !to) {
      Toast.show("Pick both a from and to date", "error");
      return;
    }
    if (from > to) {
      Toast.show("From date can't be after To date", "error");
      return;
    }
    customRange = { from, to };
    applyPeriod("custom");
  }

  function applyPeriod(period) {
    activePeriod = period;
    refresh();
  }

  periodSelect.addEventListener("change", () => {
    const value = periodSelect.value;
    if (value === "custom") {
      // Just reveal the From/To fields — nothing changes until Apply, so
      // the data on screen still matches the period actually applied.
      customRow.hidden = false;
      return;
    }
    customRow.hidden = true;
    applyPeriod(value);
  });

  /** Makes the filter controls show exactly the period whose data is on
   *  screen. Browsers restore <select>/<input> values on reload and when
   *  coming back via Back/Forward, while activePeriod itself always starts
   *  as "today" — which is how the dropdown could say "All time" over
   *  Today's numbers. Run at load, on pageshow, and on login/logout. */
  function syncPeriodControls() {
    periodSelect.value = activePeriod;
    const showCustom = activePeriod === "custom" && !!customRange;
    customRow.hidden = !showCustom;
    fromInput.value = showCustom ? customRange.from : "";
    toInput.value = showCustom ? customRange.to : "";
    syncDateHint(fromInput, fromHint, "From Date");
    syncDateHint(toInput, toHint, "To Date");
  }

  /** A fresh sign-in/out starts back on Today, like a fresh page load. */
  function resetPeriod() {
    const changed = activePeriod !== "today" || customRange;
    activePeriod = "today";
    customRange = null;
    if (changed) {
      summaryValid = false;
      lastSnapshot = null;
    }
    syncPeriodControls();
  }

  syncPeriodControls();
  window.addEventListener("pageshow", syncPeriodControls);
  document.addEventListener("freshcutz:logout", resetPeriod);
  document.addEventListener("freshcutz:login", resetPeriod);

  function formatDateHeading(dateStr) {
    // dateStr is a plain "yyyy-MM-dd" — parsed as local midnight (not UTC)
    // so the weekday/date shown always matches the date the backend meant.
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }

  /** Same items-list markup as the Orders tab's own order cards (see
   *  admin-orders.js's itemsSummary) — kept as its own small copy here
   *  since AdminStats and AdminOrders don't share internals. */
  function itemsSummary(order) {
    return (order.items || [])
      .map(
        (i) =>
          `<div>${i.quantity} × ${Utils.escapeHtml(i.productName)} (${Utils.escapeHtml(i.variantLabel)}) — ${Utils.formatMoney(i.lineTotal)}</div>`
      )
      .join("");
  }

  /** Full order detail markup (phone, address, notes, items) — same shape
   *  an Orders-tab card shows. Filled into a row's detail panel once its
   *  full data has actually been fetched (see the click listener below);
   *  Apply itself only ever ships the lightweight row below. */
  function orderDetailHtml(o) {
    return `
      <div class="order-customer">
        📞 <a href="tel:${Utils.escapeHtml(o.phone)}">${Utils.escapeHtml(o.phone)}</a><br/>
        🏠 ${Utils.escapeHtml(o.flatNo)}, ${Utils.escapeHtml(o.addressLine)}
        ${o.landmark ? `<br/>📍 ${Utils.escapeHtml(o.landmark)}` : ""}
        ${o.deliverySlot ? `<br/>🕗 Deliver: ${Utils.escapeHtml(SlotTime.display(o.deliverySlot, o.status))}` : ""}
        ${o.paymentMode === "UPI" && window.AdminProof ? AdminProof.lineHtml(o) : o.paymentMode ? `<br/>${o.paymentMode === "UPI" ? "📲 Payment: UPI" : "💵 Payment: Cash on delivery"}` : ""}
        ${o.notes ? `<br/>📝 ${Utils.escapeHtml(o.notes)}` : ""}
      </div>
      <div class="order-items-list">${itemsSummary(o)}</div>`;
  }

  const badgeClass = { NEW: "badge-new", PACKED: "badge-packed", DELIVERED: "badge-delivered", CANCELLED: "badge-cancelled" };

  /** One collapsed row — code, amount, customer, status, and the time that
   *  status happened (placed / delivered / cancelled).
   *  `row` is the lightweight DailySalesRow the backend sends; its detail
   *  panel starts empty and is filled in on first tap (see the click
   *  listener below). */
  function orderRowHtml(row) {
    return `
      <div class="daily-sales-row" data-id="${row.id}">
        <button type="button" class="daily-sales-row-summary" data-role="toggle">
          <div class="daily-sales-row-top">
            <span><span class="daily-sales-row-chevron">▸</span>${Utils.escapeHtml(row.orderCode)}</span>
            <span>${Utils.formatMoney(row.totalAmount)}</span>
          </div>
          <div class="daily-sales-row-sub">
            <span>${Utils.escapeHtml(row.customerName)} <span class="badge ${badgeClass[row.status] || ""}">${Utils.escapeHtml(row.status || "")}</span></span>
            <span>${Utils.formatDateTime(row.at)}</span>
          </div>
        </button>
        <div class="daily-sales-row-details" hidden></div>
      </div>`;
  }

  /** A day's cached order rows, filtered to the selected status box. */
  function dayOrdersHtml(rows) {
    return rows.filter((r) => statusFilter === "ALL" || r.status === statusFilter).map(orderRowHtml).join("");
  }

  // Full order details fetched on tap, keyed by order id, so re-opening a
  // row an admin already expanded doesn't hit the server again. Capped —
  // without a limit this would grow for as long as the tab stays open,
  // one entry per distinct order ever tapped. A Map keeps insertion
  // order, so the oldest entry is just its first key; dropping that one
  // before adding a new entry past the cap keeps memory bounded while
  // still caching whatever's been looked at most recently.
  const orderDetailCache = new Map();
  const ORDER_DETAIL_CACHE_MAX = 200;

  function cacheOrderDetail(id, html) {
    if (orderDetailCache.size >= ORDER_DETAIL_CACHE_MAX) {
      const oldestId = orderDetailCache.keys().next().value;
      orderDetailCache.delete(oldestId);
    }
    orderDetailCache.set(id, html);
  }

  // A day's individual orders, fetched on tap, keyed by date (yyyy-MM-dd)
  // so re-expanding a day an admin already opened doesn't hit the server
  // again. Capped the same way as orderDetailCache above, for the same
  // reason — a long-lived tab shouldn't grow this forever.
  const dayOrdersCache = new Map();
  const DAY_ORDERS_CACHE_MAX = 60;

  function cacheDayOrders(date, rows) {
    if (dayOrdersCache.size >= DAY_ORDERS_CACHE_MAX) {
      const oldestDate = dayOrdersCache.keys().next().value;
      dayOrdersCache.delete(oldestDate);
    }
    dayOrdersCache.set(date, rows);
  }

  /** Drops every cached "day expanded" order list (and individual order
   *  detail), so the next tap re-fetches from the server instead of
   *  showing a stale list. Needed because marking an order Delivered/
   *  Cancelled/Reopened from the Orders tab can change which orders
   *  belong to a given day's DELIVERED bucket here on the Sales tab —
   *  without this, a day already expanded once in this session would
   *  keep showing its old (now-stale) order list even after a fresh
   *  Apply correctly recomputes the day's total/count from the server
   *  (see admin-orders.js's click handler, which calls this alongside
   *  adjustNewOrdersCount for the same delivered/cancelled/reopen
   *  actions). Clearing both caches outright is simpler and just as
   *  cheap as trying to work out exactly which single day/order was
   *  affected — either refetches lazily, only once something is
   *  actually re-expanded/re-tapped. */
  function clearDayCaches() {
    dayOrdersCache.clear();
    orderDetailCache.clear();
  }

  // Delegated once on the container rather than per-row, so it keeps
  // working across re-renders (a fresh Apply replaces rangeResult's
  // innerHTML entirely). Tapping anywhere on a row's summary toggles just
  // that row's detail panel, fetching its full data the first time it's
  // opened — Apply only ever ships the lightweight code/customer/date/
  // total columns for every order in range, so this is the one small
  // extra request per order an admin actually chooses to look at.
  rangeResult.addEventListener("click", async (e) => {
    if (e.target.closest("#showMoreDaysBtn")) {
      showMoreDays();
      return;
    }
    if (e.target.closest("a")) return; // a tel: link inside an already-open row — dial, don't collapse it

    // Level 1: a day header — lazily fetches that single day's lightweight
    // order rows (code/amount/customer/time only), the same shape Apply
    // used to ship for every order in the whole range up front.
    const dayToggle = e.target.closest('[data-role="day-toggle"]');
    if (dayToggle) {
      const group = dayToggle.closest(".daily-sales-group");
      const rowsContainer = group.querySelector(".daily-sales-rows");
      const isOpen = group.classList.toggle("is-open");
      rowsContainer.hidden = !isOpen;
      if (!isOpen) return;

      // A day's orders are fetched once, for ALL statuses, and cached as
      // rows; the selected status box just filters them when painting.
      const date = dayToggle.dataset.date;
      if (dayOrdersCache.has(date)) {
        rowsContainer.innerHTML = dayOrdersHtml(dayOrdersCache.get(date));
        return;
      }

      rowsContainer.innerHTML = `<div class="daily-sales-row-loading"><span class="spinner spinner-dark"></span> Loading orders…</div>`;
      try {
        const rows = await Api.get(`/api/admin/orders/summary/range/daily/${date}`);
        cacheDayOrders(date, rows);
        // The day may have been collapsed again while this was in flight —
        // don't fill it back in if the admin already closed it.
        if (group.classList.contains("is-open")) {
          rowsContainer.innerHTML = dayOrdersHtml(rows);
        }
      } catch (err) {
        rowsContainer.innerHTML = `<div class="daily-sales-row-loading">${Utils.escapeHtml(err.message)}</div>`;
      }
      return;
    }

    // Level 2: an individual order row — unchanged from before, just no
    // longer reachable until its day has been expanded first.
    const toggleBtn = e.target.closest('[data-role="toggle"]');
    if (!toggleBtn) return;
    const row = toggleBtn.closest(".daily-sales-row");
    const details = row.querySelector(".daily-sales-row-details");
    const isOpen = row.classList.toggle("is-open");
    details.hidden = !isOpen;
    if (!isOpen) return;

    const id = row.dataset.id;
    if (orderDetailCache.has(id)) {
      details.innerHTML = orderDetailCache.get(id);
      return;
    }

    details.innerHTML = `<div class="daily-sales-row-loading"><span class="spinner spinner-dark"></span> Loading order details…</div>`;
    try {
      const order = await Api.get(`/api/admin/orders/${id}`);
      const html = orderDetailHtml(order);
      cacheOrderDetail(id, html);
      // The row may have been collapsed again while this was in flight —
      // don't fill it back in if the admin already closed it.
      if (row.classList.contains("is-open")) {
        details.innerHTML = html;
      }
    } catch (err) {
      details.innerHTML = `<div class="daily-sales-row-loading">${Utils.escapeHtml(err.message)}</div>`;
    }
  });

  /** A UPI payment changed (screenshot uploaded / admin marked it): only the payment line of a remembered order detail is out of
   * date, so that line is updated inside the remembered HTML - nothing is read from the server again. (A row that is open right
   * now is updated on screen by admin-proof.js, which listens to the same event.) */
  window.addEventListener("freshcutz:payment", (e) => {
    const p = e.detail;
    if (!p || p.id == null || !window.AdminProof) return;
    [String(p.id), p.id].forEach((k) => {
      if (orderDetailCache.has(k)) orderDetailCache.set(k, AdminProof.patch(orderDetailCache.get(k), p));
    });
  });

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Period + sub-tab + status -> the saved file's name, e.g.
  // FreshCutz_Today_All_ByItem.xlsx.
  const PERIOD_SLUGS = { today: "Today", yesterday: "Yesterday", "7d": "Last7Days", "30d": "Last30Days", all: "AllTime" };
  const PANE_EXPORT = {
    days: { view: "day", slug: "ByDay" },
    customers: { view: "customer", slug: "ByCustomer" },
    items: { view: "item", slug: "ByItem" },
  };
  const STATUS_SLUGS = { ALL: "All", NEW: "New", DELIVERED: "Delivered", CANCELLED: "Cancelled" };

  /** Part of the download's file name that says which dates it covers: the
   *  real date for a single day ("2026-10-13" for Today / Yesterday), or
   *  "2026-09-14_to_2026-10-13" for a range (Last 7 days, Last 30 days,
   *  Custom date) — much easier to recognise months later than the word
   *  "Today". All time has no dates, so it stays "AllTime". */
  function periodSlug() {
    const range = getRange();
    if (range && range.from && range.to) {
      return range.from === range.to ? range.from : `${range.from}_to_${range.to}`;
    }
    return PERIOD_SLUGS[activePeriod] || "AllTime";
  }

  /** "Export this period" downloads exactly what the open sub-tab shows —
   *  By Day orders, By Customer customers or By Item items — for the
   *  selected period and status box, on one sheet. "Export all" ignores
   *  every filter and downloads every order. */
  async function exportOrders(useFilters) {
    let query = "";
    let filename = "FreshCutz_All_Orders.xlsx";
    if (useFilters) {
      const pane = PANE_EXPORT[activePane];
      const range = getRange();
      const params = [`view=${pane.view}`, `status=${statusFilter}`];
      if (range) params.push(`from=${range.from}`, `to=${range.to}`);
      query = `?${params.join("&")}`;
      filename = `FreshCutz_${periodSlug()}_${STATUS_SLUGS[statusFilter] || "All"}_${pane.slug}.xlsx`;
    }
    const btn = useFilters ? exportFilteredBtn : exportAllBtn;
    btn.disabled = true;
    try {
      const { blob } = await Api.downloadBlob(`/api/admin/orders/export${query}`);
      triggerDownload(blob, filename);
    } catch (err) {
      Toast.show(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function importOrders() {
    const file = importFile.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await Api.upload("/api/admin/orders/import", formData);
      const summary = `Updated ${result.updated} order${result.updated === 1 ? "" : "s"}` +
        (result.unchanged ? `, ${result.unchanged} unchanged` : "") +
        (result.skipped ? `, ${result.skipped} skipped` : "");
      Toast.show(summary, result.skipped ? "error" : "success");
      renderImportResult(result);
      refresh();
      window.AdminOrders?.refresh();
    } catch (err) {
      Toast.show(err.message, "error");
    } finally {
      importFile.value = "";
    }
  }

  /** Shows exactly what the import did — which rows updated, and the exact
   * reason for any that were skipped — instead of leaving the admin to
   * guess whether their file actually changed anything. */
  function renderImportResult(result) {
    importResult.hidden = false;
    const errorLines = (result.errors || [])
      .map((e) => `<div>⚠️ ${Utils.escapeHtml(e)}</div>`)
      .join("");
    importResult.innerHTML = `
      <div class="stat-card anim-fade-up">
        <div class="label">Last import</div>
        <div class="value">${result.updated} updated</div>
        ${result.unchanged ? `<div class="sub">${result.unchanged} row${result.unchanged === 1 ? "" : "s"} had no changes</div>` : ""}
        ${result.skipped ? `<div class="sub">${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped</div>` : ""}
        ${errorLines ? `<div class="import-errors">${errorLines}</div>` : ""}
      </div>`;
  }

  applyBtn.addEventListener("click", applyCustomRange);
  exportFilteredBtn.addEventListener("click", () => exportOrders(true));
  exportAllBtn.addEventListener("click", () => exportOrders(false));
  importFile.addEventListener("change", importOrders);

  return { refresh, refreshIfNeeded, noteRemoteChange, onRemoteChange, noteOrderChanged, getSelectedCount, getTotalCount, refreshBadge, adjustNewOrdersCount, setNewOrdersCount, getRange, getStatus };
})();
