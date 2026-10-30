/* Sales tab > By Customer: customers ranked by the total of their orders
 * in whichever period the Sales tab's dropdown has selected — read back
 * through AdminStats.getRange(), null meaning All time — and whichever
 * orders the All / New / Delivered / Cancelled boxes have selected
 * (AdminStats.getStatus()), grouped by phone number (see AdminCustomerController's
 * /top endpoint). Fetches 10 at a time instead of the whole list,
 * loading more as the admin scrolls — the same reasoning as the Orders
 * tab's own infinite scroll: asking the database (and shipping over the
 * network) for every customer, on every visit or search keystroke, gets
 * slower and slower forever. Search is a real server-side query for the
 * same reason. A customer's past orders are fetched lazily too, only once
 * an admin actually taps "View past orders" on their card, instead of
 * every customer's full order history (items included) riding along with
 * the list up front, whether anyone looks at it or not. */

window.AdminSalesCustomers = (() => {
  const list = document.getElementById("salesCustomersList");
  const searchInput = document.getElementById("salesCustomerSearchInput");
  const PAGE_SIZE = 20;

  let searchTerm = "";
  // The last All-statuses list fetched, kept so the New / Delivered /
  // Cancelled boxes can be answered from it without another request:
  // each row carries its order count and money split by status, so any
  // status view is just a re-sum and re-sort. Only usable when the whole
  // list arrived (complete = no further page) — a partial first page
  // can't tell what the top of a different ranking would be. Keyed by
  // period + search; dropped by AdminStats whenever the data may have
  // changed (a period change, a refresh, a stale revisit).
  let allCache = null; // { key, rows, complete }
  let currentCustomers = []; // every customer loaded so far across all pages
  let lastCursor = null; // { spent, phone } of the last customer from the
  // most recent fetch — the seek cursor loadMore() sends for the next
  // page instead of a page number (see queryFor). Two keys because the
  // sort (highest spend first) isn't unique enough to seek on by itself
  // — two customers can have spent exactly the same, so phone breaks
  // the tie. See CustomerRepository.findTopCustomersAllTime/Between.
  let hasMore = false;
  let loadingMore = false;
  let scrollObserver = null;
  // Bumped on every refresh() (a search edit, a period change, or
  // reopening this sub-tab) and checked after each fetch resolves — a fast typist can have
  // several searches in flight at once, and without this a slower early
  // response landing after a faster later one would silently overwrite
  // the screen with stale results for whatever was typed a moment ago.
  // loadMore() checks it too, since a refresh can start while a
  // scroll-triggered loadMore is still in flight.
  let requestSeq = 0;
  const expanded = new Set(); // phone numbers whose past-orders list is open

  // A customer's past orders for the selected PERIOD (all statuses),
  // fetched on first tap and kept as rows — keyed by phone, and tagged
  // with the period they were fetched for so a different period never
  // reuses them. The New / Delivered / Cancelled box then just filters
  // these rows when painting, so switching boxes needs no request. Capped
  // the same way (and for the same "a long-lived tab shouldn't grow this
  // forever" reason) as admin-stats.js's dayOrdersCache/orderDetailCache.
  const ordersCache = new Map(); // phone -> { rangeKey, orders }
  const ORDERS_CACHE_MAX = 60;

  const currentRangeKey = () => JSON.stringify(window.AdminStats?.getRange() || null);

  function cacheOrders(phone, orders, rangeKey) {
    if (ordersCache.size >= ORDERS_CACHE_MAX) {
      const oldestPhone = ordersCache.keys().next().value;
      ordersCache.delete(oldestPhone);
    }
    ordersCache.set(phone, { rangeKey, orders });
  }

  function hasCachedOrders(phone) {
    const entry = ordersCache.get(phone);
    return !!entry && entry.rangeKey === currentRangeKey();
  }

  /** The cached orders for this phone, narrowed to the selected status
   *  box, as HTML — or null when nothing usable is cached. */
  function cachedOrdersHtml(phone) {
    if (!hasCachedOrders(phone)) return null;
    return ordersHtml(ordersCache.get(phone).orders);
  }

  function ordersHtml(orders) {
    const status = currentStatus();
    const shown = orders.filter((o) => status === "ALL" || o.status === status);
    return shown.length
      ? shown.map(orderRow).join("")
      : `<div class="daily-sales-row-loading">No orders for this selection.</div>`;
  }

  /** Called from admin-orders.js the moment an order is marked Delivered/
   * Cancelled/Reopened elsewhere (see admin-orders.js's click handler) —
   * without this, a customer's "View past orders" list, once fetched and
   * cached here, kept showing that order under its old status forever,
   * since nothing ever told this cache the order had changed. Same bug,
   * same fix shape as admin-stats.js's invalidateDayOrdersCache for the
   * Sales tab's day-order cache.
   *
   * Only drops the one phone's cache entry, not the whole cache — if
   * that customer's card happens to be expanded on screen right now
   * (this tab visible or not), loadOrdersInto re-fetches it fresh the
   * next time this module re-renders (see hydrateExpandedCards, called
   * from refresh()/loadMore()) rather than leaving a blank panel. */
  function invalidateOrdersCache(phone) {
    ordersCache.delete(phone);
  }

  const badgeClass = { NEW: "badge-new", PACKED: "badge-packed", DELIVERED: "badge-delivered", CANCELLED: "badge-cancelled" };

  function orderRow(order) {
    const itemsSummary = (order.items || [])
      .map((i) => `${i.quantity} × ${Utils.escapeHtml(i.productName)}`)
      .join(", ");
    return `
      <div class="customer-order-row">
        <div class="customer-order-head">
          <span class="order-code-lbl">${Utils.escapeHtml(order.orderCode)}</span>
          <span class="badge ${badgeClass[order.status] || ""}">${order.status}</span>
        </div>
        <div class="customer-order-meta">${Utils.formatDateTime(order.createdAt)} · ${Utils.formatMoney(order.totalAmount)}</div>
        ${itemsSummary ? `<div class="customer-order-items">${Utils.escapeHtml(itemsSummary)}</div>` : ""}
      </div>`;
  }

  /** The customer's current delivery address — flatNo/addressLine always
   *  present (every customer has placed at least one order), landmark
   *  only shown when they actually have one, same convention as an order
   *  card's own address block. */
  function addressHtml(customer) {
    return `
      <div class="customer-address">
        🏠 ${Utils.escapeHtml(customer.flatNo)}, ${Utils.escapeHtml(customer.addressLine)}
        ${customer.landmark ? `<br/>📍 ${Utils.escapeHtml(customer.landmark)}` : ""}
      </div>`;
  }

  /** " · 1 new · 3 delivered · 2 cancelled" — only the parts that aren't
   *  zero, shown on the All view only. Delivered is what's left of the
   *  customer's orders after New and Cancelled. */
  function statusSplit(customer) {
    const delivered = customer.orders - customer.newOrders - customer.cancelledOrders;
    return (customer.newOrders ? ` · ${customer.newOrders} new` : "") +
      (delivered > 0 ? ` · ${delivered} delivered` : "") +
      (customer.cancelledOrders ? ` · ${customer.cancelledOrders} cancelled` : "");
  }

  function card(customer) {
    const isOpen = expanded.has(customer.phone);
    return `
    <div class="customer-card" data-phone="${Utils.escapeHtml(customer.phone)}">
      <div class="customer-card-head">
        <div>
          <div class="customer-name">${Utils.escapeHtml(customer.name)}</div>
          <div class="customer-phone">📞 <a href="tel:${Utils.escapeHtml(customer.phone)}">${Utils.escapeHtml(customer.phone)}</a></div>
        </div>
        <div class="customer-stats">
          <span class="customer-sales-spent">${Utils.formatMoney(customer.spent)}</span>
          <span class="customer-sales-count">${customer.orders} order${customer.orders === 1 ? "" : "s"}${currentStatus() === "ALL" ? statusSplit(customer) : ""}</span>
        </div>
      </div>
      ${addressHtml(customer)}
      <button class="btn btn-ghost btn-sm" data-action="toggle">${isOpen ? "Hide past orders ▲" : "View past orders ▼"}</button>
      <div class="customer-orders-list" ${isOpen ? "" : "hidden"}>
        ${isOpen ? cachedOrdersHtml(customer.phone) || "" : ""}
      </div>
    </div>`;
  }

  function currentStatus() {
    return window.AdminStats?.getStatus() || "ALL";
  }

  function emptyStateHtml() {
    const word = { NEW: "new ", DELIVERED: "delivered ", CANCELLED: "cancelled " }[currentStatus()] || "";
    return `<div class="empty-state"><div class="icon">👤</div><p>${searchTerm ? "No customers match your search." : `No ${word}orders in this period.`}</p></div>`;
  }

  function cacheKey() {
    const range = window.AdminStats?.getRange();
    return `${range ? range.from + "|" + range.to : "all"}|${searchTerm}`;
  }

  /** Called by AdminStats when the loaded All list may be out of date. */
  function clearCache() {
    allCache = null;
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  /** The ranking for `status`, computed from All rows: re-sum the parts
   *  that status includes (Delivered = All minus New minus Cancelled),
   *  drop customers with no such orders, and sort by spend then phone,
   *  descending — the same order the server uses. */
  function deriveFor(status, rows) {
    if (status === "ALL") return rows;
    const incNew = status === "NEW";
    const incDelivered = status === "DELIVERED";
    const incCancelled = status === "CANCELLED";
    const out = [];
    rows.forEach((c) => {
      const delivered = c.orders - c.newOrders - c.cancelledOrders;
      const deliveredSpent = c.spent - c.newSpent - c.cancelledSpent;
      const orders = (incNew ? c.newOrders : 0) + (incDelivered ? delivered : 0) + (incCancelled ? c.cancelledOrders : 0);
      if (orders <= 0) return;
      const spent = (incNew ? c.newSpent : 0) + (incDelivered ? deliveredSpent : 0) + (incCancelled ? c.cancelledSpent : 0);
      out.push({
        ...c,
        orders,
        spent: round2(spent),
        newOrders: incNew ? c.newOrders : 0,
        cancelledOrders: incCancelled ? c.cancelledOrders : 0,
      });
    });
    out.sort((a, b) => b.spent - a.spent || (a.phone < b.phone ? 1 : a.phone > b.phone ? -1 : 0));
    return out;
  }

  /** Paints a complete (single-page) list — used for answers derived
   *  locally or known to be empty, where there is no next page. */
  function renderLocal(customers) {
    resetPagination();
    currentCustomers = customers;
    list.innerHTML = customers.length ? customers.map(card).join("") : emptyStateHtml();
    if (customers.length) hydrateExpandedCards();
  }

  function loadMoreRowHtml() {
    return `<div id="salesCustomersLoadMore" class="orders-load-more">
      <span class="spinner spinner-dark" hidden></span>
      <span hidden>Loading more customers…</span>
    </div>`;
  }

  function setLoadMoreSpinning(spinning) {
    const row = document.getElementById("salesCustomersLoadMore");
    if (!row) return;
    row.querySelectorAll("span").forEach((el) => {
      el.hidden = !spinning;
    });
  }

  /** (Re)builds the query string for the current period + search —
   *  shared by refresh() (cursor = null, the first page) and loadMore()
   *  (cursor = lastCursor, everything after). Same keyset-cursor shape as
   *  the Orders tab's own queryFor, keyed on (spent, phone) since the
   *  list is ranked by spend. The period comes from the Sales tab's
   *  dropdown on every call rather than being stored here. */
  function queryFor(cursor, statusOverride) {
    const params = new URLSearchParams();
    const range = window.AdminStats?.getRange();
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    params.set("status", statusOverride || currentStatus());
    if (searchTerm) params.set("q", searchTerm);
    params.set("size", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursorSpent", String(cursor.spent));
      params.set("cursorPhone", cursor.phone);
    }
    return `/api/admin/customers/top?${params.toString()}`;
  }

  function observeLoadMoreRow() {
    if (scrollObserver) scrollObserver.disconnect();
    const row = document.getElementById("salesCustomersLoadMore");
    if (!row) return;
    scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "0px 0px 200px 0px" }
    );
    scrollObserver.observe(row);
  }

  function cursorFrom(customers) {
    if (!customers.length) return null;
    const last = customers[customers.length - 1];
    return { spent: last.spent, phone: last.phone };
  }

  function resetPagination() {
    currentCustomers = [];
    hasMore = false;
    lastCursor = null;
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
  }

  /** True once this tab has ever actually shown something — real cards,
   * an empty state, or an error. Used below so only a genuinely first
   * load (right after login, before this module has rendered anything
   * at all) wipes the list to loading-skeleton placeholders. Every
   * switchTo("customers") in admin-main.js calls refresh() again on
   * every single visit to this tab — on purpose, not a bug: it's what
   * keeps a card's order count/total delivered (and, since last
   * session's fix, an already-expanded customer's past-orders list)
   * showing the latest status even if it changed from the Orders tab
   * while this tab wasn't open. The problem reported was never that
   * re-fetching itself is wrong — it's that re-fetching wiped the whole
   * list back to empty gray boxes first, every single time, even though
   * the admin had just been looking at this exact same list moments
   * before. Keeping the previous content on screen while the quiet
   * background fetch runs — and only swapping it out once the new data
   * actually arrives — fixes that without giving up the freshness. */
  function hasRenderedContent() {
    return list.children.length > 0;
  }

  async function refresh() {
    const seq = ++requestSeq;
    const status = currentStatus();
    const key = cacheKey();

    // 1. The header says this status has no orders in the period (every
    //    status is part of All, so All = 0 means everything is empty):
    //    nothing to ask the server.
    if (window.AdminStats?.getSelectedCount?.() === 0) {
      renderLocal([]);
      return;
    }
    // 2. The full All list for this period/search is already in hand:
    //    any status view is derived from it, no request.
    if (allCache && allCache.complete && allCache.key === key) {
      renderLocal(deriveFor(status, allCache.rows));
      return;
    }

    const hadContent = hasRenderedContent();
    resetPagination();
    // Only a genuinely empty tab gets the skeleton-wipe treatment —
    // once something is already showing, this fetch runs quietly behind
    // it instead (see hasRenderedContent's own comment).
    if (!hadContent) {
      list.innerHTML = `<div class="skeleton" style="height:80px;margin-bottom:12px;"></div>`.repeat(2);
    }
    try {
      // With another status selected but no All list in hand yet: when the
      // period has at most PAGE_SIZE orders, All can't have more than
      // PAGE_SIZE customers, so fetch All (one page, complete) and serve
      // this box AND every later one from it. Otherwise ask for the
      // selected status directly.
      const total = window.AdminStats?.getTotalCount?.();
      const wantAll = status !== "ALL" && total !== null && total !== undefined && total <= PAGE_SIZE;
      let res = await Api.get(queryFor(null, wantAll ? "ALL" : status));
      // A newer refresh (or a search edit) has started since this one
      // went out — its own response will render the screen instead, so
      // applying this older one now would just flash stale results.
      if (seq !== requestSeq) return;
      if (wantAll) {
        allCache = { key, rows: res.customers, complete: !res.hasMore };
        if (!res.hasMore) {
          renderLocal(deriveFor(status, res.customers));
          return;
        }
        res = await Api.get(queryFor(null, status)); // didn't fit after all
        if (seq !== requestSeq) return;
      }
      currentCustomers = res.customers;
      hasMore = res.hasMore;
      lastCursor = cursorFrom(res.customers);
      // Remember an All answer so the other status boxes can reuse it.
      if (status === "ALL") allCache = { key, rows: res.customers, complete: !res.hasMore };

      if (!res.customers.length) {
        list.innerHTML = emptyStateHtml();
      } else {
        list.innerHTML = res.customers.map(card).join("") + (hasMore ? loadMoreRowHtml() : "");
        if (hasMore) observeLoadMoreRow();
        hydrateExpandedCards();
      }
    } catch (err) {
      if (seq !== requestSeq) return;
      // Something was already on screen (most likely: this is a quiet
      // background re-fetch on a repeat tab visit) — leave it exactly as
      // it was rather than replacing valid, still-good data with an
      // error card, and just toast the problem instead.
      if (hadContent) {
        Toast.show(err.message, "error");
      } else {
        list.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore || !lastCursor) return;
    const seq = requestSeq; // a refresh() (search edit) mid-flight invalidates this page
    loadingMore = true;
    setLoadMoreSpinning(true);
    try {
      const res = await Api.get(queryFor(lastCursor));
      // The search term (or a plain refresh) changed while this page was
      // in flight — refresh() has already rebuilt the list for whatever
      // is current now, so appending this page on top would mix results
      // from two different searches together.
      if (seq !== requestSeq) return;
      currentCustomers = currentCustomers.concat(res.customers);
      hasMore = res.hasMore;
      if (res.customers.length) lastCursor = cursorFrom(res.customers);
      const row = document.getElementById("salesCustomersLoadMore");
      const cardsHtml = res.customers.map(card).join("");
      if (row) {
        row.insertAdjacentHTML("beforebegin", cardsHtml);
        if (!hasMore) row.remove();
        else setLoadMoreSpinning(false);
      } else {
        list.insertAdjacentHTML("beforeend", cardsHtml);
      }
      hydrateExpandedCards();
    } catch (err) {
      if (seq !== requestSeq) return;
      Toast.show(err.message, "error");
      setLoadMoreSpinning(false);
    } finally {
      loadingMore = false;
    }
  }

  /** Fetches one customer's past orders and fills them into their card's
   * (already-visible) orders panel, caching the result — shared by the
   * toggle click handler below and by hydrateExpandedCards, which calls
   * this for a card that renders expanded-but-empty because its cache
   * entry was invalidated (an order of theirs changed status elsewhere)
   * while this tab wasn't even open to re-fetch it itself. */
  async function loadOrdersInto(phone, ordersListEl) {
    ordersListEl.innerHTML = `<div class="daily-sales-row-loading"><span class="spinner spinner-dark"></span> Loading orders…</div>`;
    try {
      // Only this period's orders (all statuses, filtered on screen by the
      // selected box) — not the customer's whole history.
      const params = new URLSearchParams();
      const range = window.AdminStats?.getRange();
      if (range) {
        params.set("from", range.from);
        params.set("to", range.to);
      }
      const rangeKey = currentRangeKey();
      const orders = await Api.get(`/api/admin/customers/${encodeURIComponent(phone)}/orders${params.toString() ? "?" + params.toString() : ""}`);
      cacheOrders(phone, orders, rangeKey);
      const html = ordersHtml(orders);
      // The card may have collapsed again (or been re-rendered by a
      // refresh/loadMore in flight at the same time) while this was in
      // flight — don't fill in an element that's no longer the current
      // one for this phone, or isn't even open anymore.
      if (expanded.has(phone) && document.contains(ordersListEl)) {
        ordersListEl.innerHTML = html;
      }
    } catch (err) {
      if (expanded.has(phone) && document.contains(ordersListEl)) {
        ordersListEl.innerHTML = `<div class="daily-sales-row-loading">${Utils.escapeHtml(err.message)}</div>`;
      }
    }
  }

  /** After any (re)render — refresh() or loadMore() — a customer card
   * can come back marked expanded (expanded.has(phone)) but with an
   * empty orders panel: card()'s template only inlines cached HTML, and
   * the cache entry can be missing either because this customer was
   * never actually expanded this session (expanded.has would be false
   * then too, so this doesn't apply) or — the real case this exists for
   * — because invalidateOrdersCache dropped it while this tab was
   * showing something else, e.g. the admin marked one of their orders
   * Delivered from the Orders tab and then switched back here. Without
   * this, that card would just show a blank "past orders" panel until
   * the admin manually collapsed and re-expanded it. */
  function hydrateExpandedCards() {
    list.querySelectorAll(".customer-card").forEach((cardEl) => {
      const phone = cardEl.dataset.phone;
      if (!expanded.has(phone) || hasCachedOrders(phone)) return;
      const ordersListEl = cardEl.querySelector(".customer-orders-list");
      if (ordersListEl) loadOrdersInto(phone, ordersListEl);
    });
  }

  list.addEventListener("click", (e) => {
    const cardEl = e.target.closest(".customer-card");
    const toggleBtn = e.target.closest('[data-action="toggle"]');
    if (!cardEl || !toggleBtn) return;
    const phone = cardEl.dataset.phone;
    const ordersList = cardEl.querySelector(".customer-orders-list");

    const isOpen = expanded.has(phone);
    if (isOpen) {
      expanded.delete(phone);
      ordersList.hidden = true;
      toggleBtn.textContent = "View past orders ▼";
      return;
    }

    expanded.add(phone);
    ordersList.hidden = false;
    toggleBtn.textContent = "Hide past orders ▲";

    if (hasCachedOrders(phone)) {
      ordersList.innerHTML = cachedOrdersHtml(phone);
      return;
    }

    loadOrdersInto(phone, ordersList);
  });

  // A phone number or name typed digit-by-digit/letter-by-letter has a
  // pause somewhere in nearly every normal typing cadence that's longer
  // than a short debounce window — each one of those pauses fired its
  // own search for whatever partial text existed at that moment (9, 90,
  // 905, 9052, ... for a phone number typed at an ordinary pace), so a
  // single ten-digit number being typed out could cost most of ten
  // separate database queries instead of one. Two changes against that:
  // a longer debounce window (400ms — long enough to ride out a normal
  // mid-word pause, still short enough to feel live once typing
  // actually stops), and not searching at all below MIN_SEARCH_LENGTH
  // characters, since 1-2 characters against the whole customer list is
  // both a near-useless result and the single most-repeated wasted call
  // while typing. An emptied box is exempt from that minimum — clearing
  // the search is "show me everyone again", not "still typing" — and a
  // value identical to the search already in effect is skipped outright
  // rather than re-querying for something that can't have changed.
  const MIN_SEARCH_LENGTH = 3;

  // Bug fix (kept from the previous version of this listener): this
  // used to call refresh() directly without ever reading the box's
  // value into searchTerm first, so queryFor() never actually sent a
  // "q" param — every search silently matched everything instead of
  // filtering, regardless of what was typed.
  searchInput.addEventListener(
    "input",
    Utils.debounce(() => {
      const value = searchInput.value.trim();
      if (value.length > 0 && value.length < MIN_SEARCH_LENGTH) return;
      if (value === searchTerm) return;
      searchTerm = value;
      refresh();
    }, 400)
  );

  return { refresh, invalidateOrdersCache, clearCache };
})();
