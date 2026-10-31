/* Orders tab: list + filter by status, mark delivered/cancelled/reopen.
 *
 * Fetches 10 orders at a time instead of the whole filtered list, loading
 * more as the admin scrolls — a status like Delivered or Cancelled only
 * ever grows over the life of the shop, so asking the database (and
 * shipping over the network) for every single one of them on every tab
 * visit gets slower and slower forever. Search is a real server-side
 * query for the same reason: filtering only what's already been
 * scrolled into view would silently miss matches further down a list
 * that's no longer fully loaded client-side.
 *
 * Each of the five tabs (All / New / Packed / Delivered / Cancelled) keeps its OWN
 * loaded list ("view"). While the live line to the server is open
 * (admin-live.js) every order change arrives as a small numbered message
 * and is applied to ALL the views, so switching tabs just shows what is
 * already held — no request — and an order marked Delivered is already in
 * the Delivered and All lists (and gone from New) the moment it happens.
 * Without the live line (older server, dropped connection) a view is
 * trusted for 3 minutes and re-read after that, as before.
 *
 * Search needs 2+ letters and waits for a pause in typing. A finished search
 * that held every match is reused: typing more letters ("fe" -> "fer" ->
 * "fere") filters it here instead of asking the server again. */

window.AdminOrders = (() => {
  const list = document.getElementById("ordersList");
  const filterBar = document.getElementById("orderStatusFilter");
  const searchInput = document.getElementById("orderSearchInput");
  const PAGE_SIZE = 10;
  const FRESH_MS = 3 * 60 * 1000; // how long a list is trusted when the live line is not open
  const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000; // "Reopen as New" only within 24h of being marked Delivered/Cancelled
  const MIN_SEARCH = 2; // letters needed before a search is made
  const SEARCH_WAIT_MS = 400; // pause in typing before it is made
  const LOCK_MS = 2000; // after a tap, that order's buttons do nothing for this long

  let activeStatus = "NEW"; // default view: keep an eye on new incoming orders
  let searchTerm = "";

  /** One loaded list. `snapshot` = JSON of the first page as last read from the server (null = nothing loaded yet);
   *  `cursor` = the seek position just past the last order the server gave us (kept apart from `orders`, because
   *  an order leaving the list must not move it); `seq` = the live-message number this list is up to date as of
   *  (null = unknown, so it can only be trusted for a few minutes). */
  const newView = () => ({ orders: [], hasMore: false, cursor: null, snapshot: null, loadedAt: 0, stale: false, seq: null });
  const tabs = {}; // status -> view, for "", "NEW", "PACKED", "DELIVERED", "CANCELLED"
  let v = (tabs[activeStatus] = newView()); // the view on screen (a throwaway one while searching)
  const known = new Map(); // order id -> the latest full order we have seen (an order moving between tabs is built from it)
  let loadingMore = false;
  let scrollObserver = null;
  const lockedUntil = new Map(); // order id -> time until which its buttons are ignored
  const searchCache = new Map(); // "status|term" -> a finished search (a view); dropped whenever any order changes
  let cacheEpoch = 0; // bumped when the cache is dropped, so a search that was in flight then is not stored

  const badgeClass = { NEW: "badge-new", PACKED: "badge-packed", DELIVERED: "badge-delivered", CANCELLED: "badge-cancelled" };
  const liveOpen = () => !!(window.AdminLive && window.AdminLive.isConnected());

  // ---- small helpers ------------------------------------------------------------
  const ts = (o) => Date.parse(o.statusUpdatedAt) || 0;
  /** Newest first, the order id breaking ties — the same order the server lists them in. */
  const newerFirst = (a, b) => ts(b) - ts(a) || b.id - a.id;

  /** Where `order` belongs in a list that is sorted newest-first. */
  function sortedIndex(orders, order) {
    let i = 0;
    while (i < orders.length && newerFirst(orders[i], order) <= 0) i++;
    return i;
  }

  function remember(orders) {
    orders.forEach((o) => known.set(o.id, o));
  }

  /** A view is trusted while the live line keeps it current, or (without it) for a few minutes. */
  function isFresh(view) {
    if (view.snapshot === null || view.stale) return false;
    if (liveOpen() && view.seq != null) return true;
    return Date.now() - view.loadedAt < FRESH_MS;
  }

  function dropView(status) {
    if (tabs[status]) tabs[status] = newView();
    if (tabs[status] && status === activeStatus && !searchTerm) v = tabs[status];
  }

  // ---- search reuse ----------------------------------------------------------------
  const WILD = /[%_\\]/; // characters the server's LIKE treats specially: such terms are always asked of the server
  const searchKey = (status, term) => `${status}|${term.toLowerCase()}`;
  const searchValid = (view) => view.snapshot !== null && !view.stale && Date.now() - view.loadedAt < FRESH_MS;

  /** Any order change makes every remembered search suspect: forget them all. */
  function forgetSearches() {
    searchCache.clear();
    cacheEpoch++;
  }

  /** The same test the server's search does: the term is inside the order code, phone or name (any case). */
  function matchesTerm(o, q) {
    return [o.orderCode, o.phone, o.customerName].some((x) => String(x || "").toLowerCase().includes(q));
  }

  /** A search answered without a request, from a list we already hold that is sorted the same way (newest first) and
   *  holds the start of everything the term could match: a finished shorter search, or a tab's list. Because the order
   *  is the same, the matches found in the loaded start of such a list are exactly the first matches of the new search:
   *   - if that list was complete, they are ALL the matches (an empty answer too: no match for "xyz" means none for "xyzq");
   *   - if it was not complete but already holds at least a page of matches, that page is known, and the rest is read
   *     from the server only if the admin scrolls to it.
   *  null when no held list can answer it (the server is asked). */
  function deriveSearch(status, term) {
    if (WILD.test(term)) return null;
    const q = term.toLowerCase();
    const sources = []; // { orders, hasMore, loadedAt }
    searchCache.forEach((view, key) => {
      const i = key.indexOf("|");
      const pstatus = key.slice(0, i);
      const pterm = key.slice(i + 1);
      if (!searchValid(view) || WILD.test(pterm) || !q.includes(pterm)) return;
      if (pstatus !== "" && pstatus !== status) return;
      sources.push({ orders: view.orders, hasMore: view.hasMore, loadedAt: view.loadedAt });
    });
    [tabs[""], tabs[status]].forEach((view) => {
      if (view && view.snapshot !== null && isFresh(view)) sources.push({ orders: view.orders, hasMore: view.hasMore, loadedAt: Date.now() });
    });
    let best = null; // { orders, hasMore, loadedAt }
    sources.forEach((src) => {
      const orders = src.orders.filter((o) => (status === "" || o.status === status) && matchesTerm(o, q));
      if (src.hasMore && orders.length < PAGE_SIZE) return; // not enough to be sure of a whole first page
      if (!best || (best.hasMore && !src.hasMore) || (best.hasMore === src.hasMore && src.hasMore && orders.length > best.orders.length)) {
        best = { orders, hasMore: src.hasMore, loadedAt: src.loadedAt };
      }
    });
    if (!best) return null;
    return {
      orders: best.orders,
      hasMore: best.hasMore,
      cursor: cursorFrom(best.orders),
      snapshot: JSON.stringify(best.orders),
      loadedAt: best.loadedAt,
      stale: false,
      seq: null,
    };
  }

  // ---- rendering -----------------------------------------------------------------
  function itemsSummary(order) {
    return order.items
      .map((i) => `<div>${i.quantity} × ${Utils.escapeHtml(i.productName)} (${Utils.escapeHtml(i.variantLabel)}) — ${Utils.formatMoney(i.lineTotal)}</div>`)
      .join("");
  }

  function actionsFor(order) {
    if (order.status === "NEW") {
      return `
        <button class="btn btn-packed btn-sm" data-action="packed">📦 Mark Packed</button>
        <button class="btn btn-gold btn-sm" data-action="delivered">✓ Mark Delivered</button>
        <button class="btn btn-ghost btn-sm" data-action="cancelled">Cancel Order</button>`;
    }
    if (order.status === "PACKED") {
      // Still an open order: it can go out or be cancelled, and "Reopen as New" undoes a Packed tap made by mistake
      // (no 24-hour limit — nothing was delivered or cancelled).
      return `
        <button class="btn btn-gold btn-sm" data-action="delivered">✓ Mark Delivered</button>
        <button class="btn btn-ghost btn-sm" data-action="cancelled">Cancel Order</button>
        <button class="btn btn-ghost btn-sm" data-action="reopen">↺ Reopen as New</button>`;
    }
    const actionedAt = order.statusUpdatedAt || order.createdAt;
    const age = Date.now() - new Date(actionedAt).getTime();
    if (age > REOPEN_WINDOW_MS) return "";
    return `<button class="btn btn-ghost btn-sm" data-action="reopen">↺ Reopen as New</button>`;
  }

  function card(order) {
    return `
    <div class="order-card" data-id="${order.id}"${order.deliveryLat != null && order.deliveryLng != null ? ` data-pin="${Number(order.deliveryLat)},${Number(order.deliveryLng)}"` : ""}>
      <div class="order-card-head">
        <div>
          <div class="order-code-lbl">${Utils.escapeHtml(order.orderCode)}</div>
          <div class="order-time">Placed: ${Utils.formatDateTime(order.createdAt)}</div>
          ${order.status !== "NEW" && order.statusUpdatedAt ? `<div class="order-time">${{ PACKED: "Packed", DELIVERED: "Delivered" }[order.status] || "Cancelled"}: ${Utils.formatDateTime(order.statusUpdatedAt)}</div>` : ""}
        </div>
        <span class="badge ${badgeClass[order.status] || ""}">${order.status}</span>
      </div>
      <div class="order-customer">
        <strong>${Utils.escapeHtml(order.customerName)}</strong>
        📞 <a href="tel:${Utils.escapeHtml(order.phone)}">${Utils.escapeHtml(order.phone)}</a><br/>
        <span class="oc-addr">🏠 ${Utils.escapeHtml(order.flatNo)}, ${Utils.escapeHtml(order.addressLine)}</span>
        ${order.landmark ? `<br/>📍 ${Utils.escapeHtml(order.landmark)}` : ""}
        ${order.deliverySlot ? `<br/>🕗 Deliver: ${Utils.escapeHtml(SlotTime.display(order.deliverySlot, order.status))}` : ""}
        ${order.paymentMode === "UPI" && window.AdminProof ? AdminProof.lineHtml(order) : order.paymentMode ? `<br/>${order.paymentMode === "UPI" ? "📲 Payment: UPI" : "💵 Payment: Cash on delivery"}` : ""}
        ${order.notes ? `<br/>📝 ${Utils.escapeHtml(order.notes)}` : ""}
      </div>
      ${order.status === "CANCELLED" && order.cancelledByCustomer ? `<div class="order-cancel-note"><strong>Cancelled by customer</strong>${order.cancelReason ? `<span>${Utils.escapeHtml(order.cancelReason)}</span>` : ""}</div>` : ""}
      <div class="order-items-list">${itemsSummary(order)}</div>
      <div class="order-total-row"><span>Total</span><span>${Utils.formatMoney(order.totalAmount)}</span></div>
      ${actionsFor(order) ? `<div class="order-actions">${actionsFor(order)}</div>` : ""}
    </div>`;
  }

  function emptyStateHtml() {
    return `<div class="empty-state"><div class="icon">📭</div><p>${searchTerm ? "No orders match your search." : "No orders here yet."}</p></div>`;
  }

  function loadMoreRowHtml() {
    return `<div id="ordersLoadMore" class="orders-load-more">
      <span class="spinner spinner-dark" hidden></span>
      <span hidden>Loading more orders…</span>
    </div>`;
  }

  function setLoadMoreSpinning(spinning) {
    const row = document.getElementById("ordersLoadMore");
    if (!row) return;
    row.querySelectorAll("span").forEach((el) => {
      el.hidden = !spinning;
    });
  }

  /** Draws the view on screen from what it holds — no request. */
  function render() {
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
    if (!v.orders.length) {
      list.innerHTML = emptyStateHtml();
      return;
    }
    list.innerHTML = v.orders.map(card).join("") + (v.hasMore ? loadMoreRowHtml() : "");
    if (v.hasMore) observeLoadMoreRow();
  }

  function flash(ids, cls) {
    ids.forEach((id) => {
      const el = list.querySelector(`.order-card[data-id="${id}"]`);
      if (!el) return;
      el.classList.add("is-flashing", cls);
      setTimeout(() => el.classList.remove("is-flashing", cls), 1500);
    });
  }

  /** (Re)builds the query string for the current status/search — shared
   * by refresh() (cursor = null, the first page) and loadMore() (cursor
   * = the view's cursor, everything after). Every tab — New included — loads
   * PAGE_SIZE (10) orders at a time and fetches the next 10 as the admin
   * scrolls down, so even thousands of new orders never load at once. No "page" param at all — cursorStatusUpdatedAt/
   * cursorId (the last order's own statusUpdatedAt/id) replace it, so the
   * database never has to walk past and discard rows just to find where
   * the next page starts (see OrderRepository.findOrdersWithItemsOneTrip).
   * Keyed on statusUpdatedAt (when an order last changed status) rather
   * than createdAt (when it was placed), so Delivered/Cancelled/All page
   * through in the same "most recently actioned first" order they're
   * displayed in. */
  function queryFor(status, term, cursor) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (term) params.set("search", term);
    params.set("size", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursorStatusUpdatedAt", cursor.statusUpdatedAt);
      params.set("cursorId", String(cursor.id));
    }
    return `/api/admin/orders?${params.toString()}`;
  }

  /** Watches the trailing "load more" row — once it scrolls into view
   * (the admin has reached the bottom of what's loaded so far) and
   * there's genuinely another page, fetches it. Re-created on every
   * render() since that replaces the row's DOM node entirely; loadMore()
   * itself never touches the DOM structure around the row, so the same
   * observer instance keeps working across however many pages get
   * appended afterward. */
  function observeLoadMoreRow() {
    if (scrollObserver) scrollObserver.disconnect();
    const row = document.getElementById("ordersLoadMore");
    if (!row) return;
    // Starts loading the next page a bit before the row is actually
    // scrolled into view, so there's no visible pause at the bottom.
    scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "0px 0px 200px 0px" }
    );
    scrollObserver.observe(row);
  }

  /** The seek cursor pointing just past the last order in this batch. null for an empty batch. */
  function cursorFrom(orders) {
    if (!orders.length) return null;
    const last = orders[orders.length - 1];
    return { statusUpdatedAt: last.statusUpdatedAt, id: last.id };
  }

  // ---- loading from the server ---------------------------------------------------
  /** Reads page 0 of the view on screen from the server. */
  async function load() {
    const target = v;
    const status = activeStatus;
    const term = searchTerm;
    const epoch = cacheEpoch;
    const firstLoadForThisFilter = target.snapshot === null;
    if (firstLoadForThisFilter) {
      list.innerHTML = `<div class="skeleton" style="height:140px;margin-bottom:12px;"></div>`.repeat(2);
    }
    try {
      const res = await Api.get(queryFor(status, term, null));
      window.AdminOrderMap?.setOn(res.mapOn); // Delivery map on: show which orders are inside the delivery area
      target.loadedAt = Date.now();
      target.stale = false;
      // Only trustworthy as the Orders-tab badge count while NOT
      // searching — a search narrows totalElements down to just the matches.
      if (status === "NEW" && !term) window.AdminStats?.setNewOrdersCount(res.totalElements);
      remember(res.orders);
      const snapshot = JSON.stringify(res.orders);
      if (snapshot === target.snapshot) {
        // page 0 is unchanged — leave everything as-is (including any further pages already scrolled in)
        if (res.seq != null && (target.seq == null || res.seq > target.seq)) target.seq = res.seq;
        return;
      }
      if (!term) forgetSearches(); // a tab's list changed: remembered searches may be out of date
      target.snapshot = snapshot;
      target.orders = res.orders;
      target.hasMore = res.hasMore;
      target.cursor = cursorFrom(res.orders);
      target.seq = res.seq != null ? res.seq : null;
      catchUp(target);
      if (term && epoch === cacheEpoch) searchCache.set(searchKey(status, term), target); // kept, so typing more letters can reuse it
      if (target === v) render(); // (the admin may have moved to another tab while this was loading)
    } catch (err) {
      if (firstLoadForThisFilter && target === v) {
        list.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
      }
      // otherwise a background hiccup shouldn't wipe out what's already shown
    }
  }

  /** Public "read the list again": also forgets the other tabs' lists (something changed that we can't patch). */
  function refresh() {
    forgetSearches();
    Object.keys(tabs).forEach((s) => {
      if (tabs[s] !== v) tabs[s] = newView();
    });
    return load();
  }

  async function loadMore() {
    if (!v.hasMore || loadingMore || !v.cursor) return;
    const target = v;
    loadingMore = true;
    setLoadMoreSpinning(true);
    try {
      const res = await Api.get(queryFor(activeStatus, searchTerm, target.cursor));
      window.AdminOrderMap?.setOn(res.mapOn);
      remember(res.orders);
      const have = new Set(target.orders.map((o) => o.id));
      const fresh = res.orders.filter((o) => !have.has(o.id)); // (an order moved here by a live message is not added twice)
      target.orders = target.orders.concat(fresh);
      target.hasMore = res.hasMore;
      if (res.orders.length) target.cursor = cursorFrom(res.orders);
      if (target !== v) return;
      const row = document.getElementById("ordersLoadMore");
      const cardsHtml = fresh.map(card).join("");
      if (row) {
        row.insertAdjacentHTML("beforebegin", cardsHtml);
        if (!target.hasMore) row.remove();
        else setLoadMoreSpinning(false);
      } else {
        list.insertAdjacentHTML("beforeend", cardsHtml);
      }
    } catch (err) {
      Toast.show(err.message, "error");
      setLoadMoreSpinning(false);
    } finally {
      loadingMore = false;
    }
  }

  /** Shows the view for the current tab / search: from what is held when it is still good (no request), else loads it. */
  function showActive() {
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
    if (searchTerm) {
      const key = searchKey(activeStatus, searchTerm);
      let hit = searchCache.get(key);
      if (hit && !searchValid(hit)) {
        searchCache.delete(key);
        hit = null;
      }
      if (!hit) {
        hit = deriveSearch(activeStatus, searchTerm); // from a finished shorter search / a fully loaded tab: no request
        if (hit) searchCache.set(key, hit);
      }
      if (hit) {
        v = hit;
        render();
        return;
      }
      v = newView();
      load();
      return;
    }
    v = tabs[activeStatus] || (tabs[activeStatus] = newView());
    if (v.snapshot !== null) {
      render();
      if (!isFresh(v)) load(); // shown at once; read again in the background only when it can't be trusted
    } else {
      load();
    }
  }

  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status]");
    if (!btn) return;
    activeStatus = btn.dataset.status;
    filterBar.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("active", t === btn));
    searchTerm = "";
    searchInput.value = "";
    showActive();
  });

  // 2+ letters, after a short pause in typing. Clearing the box goes back to the tab's own list; a single letter changes
  // nothing. A longer term that holds the earlier one is answered from that earlier result when it was complete.
  searchInput.addEventListener(
    "input",
    Utils.debounce(() => {
      const raw = searchInput.value.trim();
      if (!raw) {
        if (searchTerm) {
          searchTerm = "";
          showActive();
        }
        return;
      }
      if (raw.length < MIN_SEARCH || raw === searchTerm) return;
      searchTerm = raw;
      showActive();
    }, SEARCH_WAIT_MS)
  );

  // ---- applying changes to every held list ---------------------------------------
  /** Takes the order out of a view. Returns true if it was there. */
  function removeFrom(view, id) {
    const i = view.orders.findIndex((o) => o.id === id);
    if (i === -1) return false;
    view.orders.splice(i, 1);
    return true;
  }

  /** Puts an order into a view at its sorted place. A place beyond the loaded part (with more pages still to come) is
   *  left out: it will be there when that page is read. Returns true if the list changed. */
  function insertInto(view, order) {
    const pos = sortedIndex(view.orders, order);
    if (pos >= view.orders.length && view.hasMore) return false;
    view.orders.splice(pos, 0, order);
    return true;
  }

  /** Applies "this order is now <status>" to every held list. `patch` = {id, status, statusUpdatedAt, deliveredAt}.
   *  Returns { changed: [views that changed], dropped: [views that could not be patched and were emptied] }. */
  function applyStatusToViews(patch, onlyIfNewerThan, onlyView) {
    let base = known.get(patch.id);
    if (!base) {
      Object.values(tabs).forEach((view) => {
        if (!base) base = view.orders.find((o) => o.id === patch.id);
      });
    }
    const merged = base
      ? { ...base, status: patch.status, statusUpdatedAt: patch.statusUpdatedAt, deliveredAt: patch.deliveredAt,
          cancelReason: patch.cancelReason || null, cancelledByCustomer: patch.cancelledByCustomer || null } // only set when the customer cancelled it
      : null;
    if (merged) known.set(patch.id, merged);
    const out = { changed: [], dropped: [] };
    Object.keys(tabs).forEach((status) => {
      const view = tabs[status];
      if (view.snapshot === null) return;
      if (onlyView && view !== onlyView) return;
      if (onlyIfNewerThan != null) {
        if (view.seq == null) {
          dropView(status); // can't be kept in step: read again when needed
          out.dropped.push(status);
          return;
        }
        if (onlyIfNewerThan <= view.seq) return; // this list already includes that message
      }
      const belongs = status === "" || status === patch.status;
      const before = view.orders.findIndex((o) => o.id === patch.id);
      let changed = false;
      if (!belongs) {
        changed = removeFrom(view, patch.id);
      } else if (!merged) {
        view.snapshot = null; // we have never seen this order in full: this list is read again when needed
        out.dropped.push(status);
        return;
      } else if (before >= 0) {
        view.orders.splice(before, 1);
        const pos = sortedIndex(view.orders, merged);
        view.orders.splice(pos, 0, merged);
        changed = pos !== before;
      } else {
        changed = insertInto(view, merged);
      }
      if (onlyIfNewerThan != null) view.seq = onlyIfNewerThan;
      if (changed) out.changed.push(view);
    });
    return out;
  }

  /** A brand-new order into every held New / All list. */
  function applyNewOrderToViews(order, seq, onlyView) {
    const out = { changed: [], dropped: [] };
    remember([order]);
    Object.keys(tabs).forEach((status) => {
      const view = tabs[status];
      if (view.snapshot === null) return;
      if (onlyView && view !== onlyView) return;
      if (seq != null) {
        if (view.seq == null) {
          dropView(status);
          out.dropped.push(status);
          return;
        }
        if (seq <= view.seq) return;
      }
      let changed = false;
      if ((status === "" || status === "NEW") && !view.orders.some((o) => o.id === order.id)) changed = insertInto(view, order);
      if (seq != null) view.seq = seq;
      if (changed) out.changed.push(view);
    });
    return out;
  }

  /** After views changed: redraw the one on screen if it was among them (or re-read it if it had to be emptied). */
  function settle(out, flashIds, flashClass) {
    if (searchTerm) return; // a search result is a snapshot of that search: left as it is
    if (out.dropped.includes(activeStatus)) {
      v = tabs[activeStatus];
      load();
      return;
    }
    if (out.changed.includes(v)) {
      render();
      if (flashIds && flashIds.length) flash(flashIds, flashClass);
    }
  }

  // ---- live messages (admin-live.js, via admin-main.js) --------------------------
  const recentLive = []; // the last few live messages, so a list that finished loading while they arrived can be brought up to date

  /** One message from the live line. type: "order" | "status". Returns { echo } — true when this page already had that
   *  very change (its own click, or an order it had read), so nothing else needs doing. */
  function applyLive(type, msg) {
    recentLive.push({ type, msg });
    if (recentLive.length > 100) recentLive.shift();
    forgetSearches();
    if (type === "order") {
      if (!msg.order) return { echo: true };
      const echo = known.has(msg.order.id);
      const out = applyNewOrderToViews(msg.order, msg.seq);
      settle(out, [msg.order.id], "flash-arrived");
      return { echo };
    }
    if (type === "status") {
      const prev = known.get(msg.id);
      const echo = !!prev && prev.status === msg.status;
      const out = applyStatusToViews(msg, msg.seq);
      settle(out);
      return { echo };
    }
    return { echo: false };
  }

  /** A UPI payment changed (a screenshot arrived, or an admin marked Verified / Not received): the held copies of that
   * order are updated, so a list drawn again later shows it. The card on screen is redrawn by admin-proof.js. */
  window.addEventListener("freshcutz:payment", (e) => {
    const p = e.detail;
    if (!p || p.id == null) return;
    const touch = (o) => {
      if (!o || o.id !== p.id) return;
      o.paymentCheck = p.paymentCheck == null ? null : p.paymentCheck;
      if (p.paymentProofAt !== undefined) o.paymentProofAt = p.paymentProofAt;
    };
    touch(known.get(p.id));
    Object.values(tabs).forEach((view) => view.orders.forEach(touch));
    if (v && v.orders) v.orders.forEach(touch);
    forgetSearches();
  });

  /** A list was just replaced by a read from the server: apply the live messages that came in after the number it is up to date as of. */
  function catchUp(view) {
    recentLive.forEach(({ type, msg }) => {
      if (view.seq == null || msg.seq == null || msg.seq <= view.seq) return;
      if (type === "order") applyNewOrderToViews(msg.order, msg.seq, view);
      else applyStatusToViews(msg, msg.seq, view);
    });
  }

  /** The live line says "reload everything" (too long away, or a bulk change like an import). */
  function resetAll() {
    forgetSearches();
    Object.keys(tabs).forEach((s) => {
      tabs[s] = newView();
    });
    known.clear();
    v = searchTerm ? v : tabs[activeStatus] || (tabs[activeStatus] = newView());
    if (!searchTerm) load();
  }

  /** The number to ask the live line to catch up from: the oldest point any held list is at (null = nothing held). */
  function minSeq() {
    let min = null;
    Object.keys(tabs).forEach((s) => {
      const view = tabs[s];
      if (view.snapshot === null) return;
      if (view.seq == null) {
        tabs[s] = newView(); // can't be caught up: read again when needed
        return;
      }
      if (min === null || view.seq < min) min = view.seq;
    });
    return min;
  }

  // ---- the admin's own Delivered / Cancel / Reopen taps --------------------------
  const STATUS_FOR = { packed: "PACKED", delivered: "DELIVERED", cancelled: "CANCELLED", reopen: "NEW" };
  // Named to match the CSS classes in admin-cards.css (.flash-delivered /
  // .flash-cancelled / .flash-reopened) and keyed by the exact action
  // string actionsFor() puts in data-action (also the URL segment PATCHed)
  // — "packed"/"delivered"/"cancelled"/"reopen".
  const FLASH_CLASS = { packed: "flash-packed", delivered: "flash-delivered", cancelled: "flash-cancelled", reopen: "flash-reopened" };
  // Must match the CSS animations' own durations (orderCardFlash/
  // orderCardLeave in admin-cards.css).
  const FLASH_MS = 700;
  const LEAVE_MS = 420;

  /** A time for the change that is later than anything we hold (the server's own clock replaces it moments later). */
  function nextStamp() {
    let latest = Date.now();
    known.forEach((o) => {
      const t = ts(o);
      if (t >= latest) latest = t + 1;
    });
    return new Date(latest).toISOString();
  }

  list.addEventListener("click", async (e) => {
    const cardEl = e.target.closest(".order-card");
    const actionBtn = e.target.closest("[data-action]");
    if (!cardEl || !actionBtn) return;
    const id = Number(cardEl.dataset.id);
    const action = actionBtn.dataset.action;
    const before = known.get(id) || v.orders.find((o) => o.id === id);
    if (!before || !STATUS_FOR[action]) return;
    // A second tap on the same order within 2 seconds (a double-tap, a slow connection) does nothing.
    if ((lockedUntil.get(id) || 0) > Date.now()) return;
    lockedUntil.set(id, Date.now() + LOCK_MS);
    if (lockedUntil.size > 50) lockedUntil.forEach((t, k) => t <= Date.now() && lockedUntil.delete(k));
    actionBtn.disabled = true;
    forgetSearches(); // any remembered search result may now be out of date

    // The change is shown AT ONCE, before the server has answered: the order moves to its new tab(s) in every list we
    // hold, the badge and the other screens are told, and the card flashes. The request then confirms it; if the
    // server refuses, everything below is put back.
    const flashClass = FLASH_CLASS[action];
    if (flashClass) cardEl.classList.add("is-flashing", flashClass);
    const flashStartedAt = Date.now();
    const undo = { id, status: before.status, statusUpdatedAt: before.statusUpdatedAt, deliveredAt: before.deliveredAt || null };
    const stamp = nextStamp();
    const predicted = { id, status: STATUS_FOR[action], statusUpdatedAt: stamp, deliveredAt: action === "delivered" ? stamp : null };

    applyStatusToViews(predicted, null);
    const updated = known.get(id);
    if (searchTerm) syncSearchView(updated);
    // The New badge counts NEW orders only: Packed leaves it, and so does Delivered/Cancelled from New; a Packed order
    // being delivered/cancelled does not change it (it was not counted), and a reopen always lands back in New.
    const badgeDelta = (STATUS_FOR[action] === "NEW" ? 1 : 0) - (before.status === "NEW" ? 1 : 0);
    if (badgeDelta) window.AdminStats?.adjustNewOrdersCount(badgeDelta);
    // Delivered/Cancelled/Reopen can all change which orders belong to a day's DELIVERED bucket on the Sales tab —
    // see admin-stats.js's noteOrderChanged; and the customer's cached "View past orders" list is dropped — see
    // admin-customers.js's invalidateOrdersCache.
    window.AdminStats?.noteOrderChanged(updated, before);
    window.AdminCustomers?.invalidateOrdersCache(updated.phone);
    window.AdminSalesCustomers?.invalidateOrdersCache(updated.phone);
    animateCard(id, updated, cardEl, action, flashStartedAt);

    try {
      // The server replies with only the fields that just changed; they replace our guess (same status, its own clock).
      const patch = await Api.patch(`/api/admin/orders/${id}/${action}`);
      const actual = { id, status: patch.status, statusUpdatedAt: patch.statusUpdatedAt, deliveredAt: patch.deliveredAt || null };
      const out = applyStatusToViews(actual, null);
      if (patch.already || patch.status !== predicted.status) {
        // Somebody else got to this order first (or it had already been done): the server changed nothing and says how
        // the order really is. Show that, correct the badge from the server, and say so.
        forgetSearches();
        const real = known.get(id);
        if (searchTerm) syncSearchView(real);
        window.AdminStats?.noteOrderChanged(real, updated);
        window.AdminCustomers?.invalidateOrdersCache(before.phone);
        window.AdminSalesCustomers?.invalidateOrdersCache(before.phone);
        window.AdminStats?.refreshBadge?.(); // the exact count of New orders, from the server
        setTimeout(() => {
          if (cardEl.isConnected || list.querySelector(`.order-card[data-id="${id}"]`)) render(); // redrawn as the order really is
        }, FLASH_MS + LEAVE_MS + 50);
        const word = { PACKED: "marked Packed", DELIVERED: "marked Delivered", CANCELLED: "marked Cancelled", NEW: "set back to New" }[patch.status] || "updated";
        Toast.show(`This order was already ${word} by someone else — nothing was changed.`, "error");
        return;
      }
      if (out.changed.includes(v) && !searchTerm) setTimeout(() => settle(out), FLASH_MS + LEAVE_MS + 50); // (only if the server's clock put it in a different place)
      Toast.show(
        action === "packed" ? "Marked as packed" : action === "delivered" ? "Marked as delivered" : action === "cancelled" ? "Order cancelled" : "Order reopened",
        "success"
      );
    } catch (err) {
      // The server did not do it: put everything back.
      lockedUntil.delete(id);
      forgetSearches();
      applyStatusToViews(undo, null);
      if (badgeDelta) window.AdminStats?.adjustNewOrdersCount(-badgeDelta);
      window.AdminStats?.noteOrderChanged(known.get(id), updated);
      window.AdminCustomers?.invalidateOrdersCache(before.phone);
      window.AdminSalesCustomers?.invalidateOrdersCache(before.phone);
      markStale(); // put back from what we hold; every list is also read again when next opened
      if (searchTerm) syncSearchView(known.get(id));
      render();
      Toast.show(err.message, "error");
    }
  });

  /** On a search screen: keep that screen's own copy of the order in step (it is not one of the tab lists). */
  function syncSearchView(order) {
    if (!order) return;
    const i = v.orders.findIndex((o) => o.id === order.id);
    if (i >= 0) v.orders[i] = order;
  }

  /** Shows the confirmation flash, then (on a New / Packed / Delivered / Cancelled tab) slides the card away; on All the card
   *  stays and simply shows its new state. The data was already moved by applyStatusToViews. */
  function animateCard(id, updated, cardEl, action, flashStartedAt) {
    const flashClass = FLASH_CLASS[action];
    if (activeStatus === "" || searchTerm) {
      if (!cardEl.isConnected) return;
      cardEl.outerHTML = card(updated);
      const freshEl = list.querySelector(`.order-card[data-id="${id}"]`);
      if (freshEl && flashClass) freshEl.classList.add("is-flashing", flashClass);
      return;
    }
    // Only wait out whatever's left of the flash that already started at click time.
    const flashRemaining = Math.max(0, FLASH_MS - (Date.now() - flashStartedAt));
    setTimeout(() => {
      cardEl.classList.add("is-leaving");
      setTimeout(() => {
        cardEl.remove();
        if (!v.orders.length) {
          // Genuinely more orders exist beyond this page (hasMore) — pull the next page in rather than claiming
          // "no orders here" when there plainly are, just not loaded yet.
          if (v.hasMore) loadMore();
          else list.innerHTML = emptyStateHtml();
        }
      }, LEAVE_MS);
    }, flashRemaining);
  }

  /** Forgets everything held (a different person may sign in next on this page). */
  function forgetAll() {
    forgetSearches();
    lockedUntil.clear();
    Object.keys(tabs).forEach((s) => {
      tabs[s] = newView();
    });
    known.clear();
    recentLive.length = 0;
    searchTerm = "";
    searchInput.value = "";
    v = tabs[activeStatus] || (tabs[activeStatus] = newView());
    list.innerHTML = "";
  }
  document.addEventListener("freshcutz:logout", forgetAll);
  document.addEventListener("freshcutz:login", forgetAll);

  // ---- hooks for admin-main.js ---------------------------------------------------
  /** Whether the currently active filter is one a brand-new incoming order (always status NEW) could ever show up in. */
  function affectedByNewOrder() {
    return activeStatus === "" || activeStatus === "NEW";
  }

  /** Opening the Orders tab again: re-read only when the list on screen can't be trusted. */
  function refreshIfNeeded() {
    if (v.snapshot === null || !isFresh(v)) return load();
    return null;
  }

  /** Called when the order counts moved and nothing could be patched: every list is read again when next opened. */
  function markStale() {
    forgetSearches();
    Object.values(tabs).forEach((view) => {
      view.stale = true;
    });
  }

  /** When the live line is NOT open and the background check saw more NEW orders: ask for ONLY the orders newer than
   *  the top one we hold and add them — instead of re-reading the whole first page. */
  async function fetchNewer() {
    const view = v;
    if (searchTerm || view.snapshot === null || !affectedByNewOrder()) {
      markStale();
      return;
    }
    let top = null;
    view.orders.forEach((o) => {
      if (!top || newerFirst(o, top) < 0) top = o;
    });
    const since = top ? top.statusUpdatedAt : "1970-01-01T00:00:00Z";
    const sinceId = top ? top.id : 0;
    try {
      const res = await Api.get(`/api/admin/orders/new-since?since=${encodeURIComponent(since)}&sinceId=${sinceId}`);
      if (res.tooMany) return refresh();
      if (!Array.isArray(res.orders)) {
        markStale();
        return load(); // an unexpected answer: just read this list again
      }
      if (res.orders.length) {
        forgetSearches();
        const ordered = res.orders.slice().reverse(); // oldest first, so each lands above the last
        const changedViews = new Set();
        ordered.forEach((o) => {
          remember([o]);
          Object.keys(tabs).forEach((status) => {
            const t = tabs[status];
            if (t.snapshot === null) return;
            if (status === "" || status === "NEW") {
              removeFrom(t, o.id); // (a reopened order is already listed under its old state)
              if (insertInto(t, o)) changedViews.add(t);
            } else {
              t.stale = true; // Packed / Delivered / Cancelled may have lost a reopened order
            }
          });
        });
        if (changedViews.has(view)) {
          render();
          flash(res.orders.map((o) => o.id), "flash-arrived");
        }
      }
    } catch {
      markStale(); // the next check / visit reads it again
    }
    return null;
  }

  return { refresh, refreshIfNeeded, markStale, affectedByNewOrder, fetchNewer, applyLive, resetAll, minSeq };
})();
