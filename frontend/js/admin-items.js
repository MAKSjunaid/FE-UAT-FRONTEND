/* Sales tab > By Item: which products are ordered the most, and how much
 * money they've earned — see ProductStatsService/ProductSalesStatRepository
 * on the backend for the full "why a rollup table" story. Scoped to
 * whichever period the Sales tab's dropdown has selected (read back
 * through AdminStats.getRange(), null meaning All time), with the same
 * paged/infinite-scroll shape as the Orders tab (10 at a time, highest
 * revenue first by default), plus a per-product tap-to-expand variant
 * breakdown (500 gm vs 1 kg, say). Built with the lessons this project
 * learned the hard way on its other tabs from the start — a running
 * rollup instead of recomputing from scratch on every request, a keyset
 * cursor instead of OFFSET, and a soft (no loading-flash) re-render on
 * every revisit instead of wiping the list back to empty first. */

window.AdminItems = (() => {
  const list = document.getElementById("itemsList");
  // Big on purpose: a shop's product list is short (and gzipped rows are
  // tiny), so one request normally returns EVERY product for the period.
  // That complete All list is what lets the New / Delivered / Cancelled
  // boxes be answered locally with no further request (see allCache).
  const PAGE_SIZE = 100;

  /** The Sales tab's selected period as { from, to } (yyyy-MM-dd), or
   *  null for All time — read fresh on every fetch rather than stored
   *  here, so there is exactly one source of truth for the period. */
  function currentRange() {
    return window.AdminStats?.getRange() || null;
  }

  /** The Sales tab's All / New / Delivered / Cancelled filter — which
   *  orders count towards these numbers. Same single-source-of-truth
   *  reasoning as currentRange above. */
  function currentStatus() {
    return window.AdminStats?.getStatus() || "ALL";
  }

  // The last All-statuses list fetched, kept so the New / Delivered /
  // Cancelled boxes can be answered from it without another request —
  // each row carries its quantity and revenue split by status. Only
  // usable when the whole list arrived (complete = no further page).
  // Keyed by period; dropped by AdminStats whenever data may have changed.
  let allCache = null; // { key, rows, complete }

  let currentProducts = []; // every product loaded so far across all pages
  let lastCursor = null; // { revenue, productId } of the last product from
  // the most recent fetch — the seek cursor loadMore() sends for the next
  // page, same keyset-pagination reasoning as the Orders/Customers tabs'
  // own cursors. Revenue alone isn't unique enough to seek on by itself
  // (two products can tie), hence productId as the tiebreaker.
  let hasMore = false;
  let loadingMore = false;
  let scrollObserver = null;
  // Bumped on every refresh() (a period change, or reopening this
  // sub-tab) and checked after each fetch resolves — two quick period
  // changes can have two requests in flight at once, and without this a
  // slower earlier one landing after a faster later one would silently
  // overwrite the screen with stale results for a period that's no
  // longer even selected. Same fix as
  // admin-customers.js's own requestSeq, for the same reason.
  let requestSeq = 0;
  const expanded = new Set(); // product ids whose variant breakdown is open

  // A product's variant breakdown, fetched on first tap, keyed by product
  // id — cleared on every refresh() (not just on a period change) rather than
  // kept indefinitely like admin-customers.js's own ordersCache: unlike a
  // customer's order history, a variant breakdown's numbers are only
  // correct for the date range they were fetched under, and this tab
  // re-fetches on every single visit anyway (see hasRenderedContent's own
  // comment below), so clearing it here instead of wiring a cross-tab
  // invalidation hook (the way admin-orders.js invalidates
  // AdminCustomers' cache) keeps this self-contained while still never
  // showing a stale number.
  const variantCache = new Map();
  // A variant breakdown depends on the status box too, so it is keyed by both.
  const vKey = (productId) => `${productId}|${currentStatus()}`;

  /** The word after a quantity follows the selected status box, so a number
   *  never reads as "sold" when it isn't (cancelled / still-new orders). */
  function qtyWord() {
    return { NEW: "new", DELIVERED: "delivered", CANCELLED: "cancelled" }[currentStatus()] || "ordered";
  }

  function itemsSummary(product) {
    const isOpen = expanded.has(product.productId);
    return `
    <div class="item-card${isOpen ? " is-open" : ""}" data-product-id="${product.productId}">
      <button type="button" class="item-card-head" data-action="toggle">
        <span class="item-card-name"><span class="item-card-chevron">▸</span>${Utils.escapeHtml(product.productName)}</span>
        <span class="item-card-stats">
          <span class="item-card-revenue">${Utils.formatMoney(product.revenue)}</span>
          <span class="item-card-qty">${product.quantity} ${qtyWord()}</span>
        </span>
      </button>
      <div class="item-variant-list" ${isOpen ? "" : "hidden"}>
        ${isOpen && variantCache.has(vKey(product.productId)) ? variantCache.get(vKey(product.productId)) : ""}
      </div>
    </div>`;
  }

  function variantRowHtml(v) {
    return `
      <div class="item-variant-row">
        <span>${Utils.escapeHtml(v.variantLabel)}</span>
        <span>${v.quantity} ${qtyWord()} · ${Utils.formatMoney(v.revenue)}</span>
      </div>`;
  }

  function emptyStateHtml() {
    const word = { NEW: "new ", DELIVERED: "delivered ", CANCELLED: "cancelled " }[currentStatus()] || "";
    return `<div class="empty-state"><div class="icon">📦</div><p>${currentRange() ? `No ${word}items in this period.` : `No ${word}items yet.`}</p></div>`;
  }

  function cacheKey() {
    const range = currentRange();
    return range ? `${range.from}|${range.to}` : "all";
  }

  /** Called by AdminStats when the loaded All list may be out of date. */
  function clearCache() {
    allCache = null;
    variantCache.clear();
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  /** The ranking for `status`, computed from All rows: re-sum the parts
   *  that status includes (Delivered = All minus New minus Cancelled),
   *  drop products with none, sort by revenue then product id, descending
   *  — the same order the server uses. */
  function deriveFor(status, rows) {
    if (status === "ALL") return rows;
    const incNew = status === "NEW";
    const incDelivered = status === "DELIVERED";
    const incCancelled = status === "CANCELLED";
    const out = [];
    rows.forEach((p) => {
      const deliveredQty = p.quantity - p.newQuantity - p.cancelledQuantity;
      const deliveredRev = p.revenue - p.newRevenue - p.cancelledRevenue;
      const quantity = (incNew ? p.newQuantity : 0) + (incDelivered ? deliveredQty : 0) + (incCancelled ? p.cancelledQuantity : 0);
      if (quantity <= 0) return;
      const revenue = (incNew ? p.newRevenue : 0) + (incDelivered ? deliveredRev : 0) + (incCancelled ? p.cancelledRevenue : 0);
      out.push({ ...p, quantity, revenue: round2(revenue) });
    });
    out.sort((a, b) => b.revenue - a.revenue || b.productId - a.productId);
    return out;
  }

  /** Paints a complete (single-page) list — an answer derived locally or
   *  known to be empty, so there is no next page. */
  function renderLocal(products) {
    resetPagination();
    currentProducts = products;
    list.innerHTML = products.length ? products.map(itemsSummary).join("") : emptyStateHtml();
    if (products.length) hydrateExpandedCards();
  }

  function loadMoreRowHtml() {
    return `<div id="itemsLoadMore" class="orders-load-more">
      <span class="spinner spinner-dark" hidden></span>
      <span hidden>Loading more items…</span>
    </div>`;
  }

  function setLoadMoreSpinning(spinning) {
    const row = document.getElementById("itemsLoadMore");
    if (!row) return;
    row.querySelectorAll("span").forEach((el) => {
      el.hidden = !spinning;
    });
  }

  // Orders hold a few items each, so the order count only loosely bounds
  // the number of products; All is fetched up front for another status
  // only when the period is this small (and falls back to a direct request
  // for the selected status if the guess was wrong).
  const ALL_FETCH_MAX_ORDERS = 30;

  function queryFor(cursor, statusOverride) {
    const params = new URLSearchParams();
    const range = currentRange();
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    params.set("status", statusOverride || currentStatus());
    params.set("size", String(PAGE_SIZE));
    if (cursor) {
      params.set("cursorRevenue", String(cursor.revenue));
      params.set("cursorProductId", String(cursor.productId));
    }
    return `/api/admin/items?${params.toString()}`;
  }

  function observeLoadMoreRow() {
    if (scrollObserver) scrollObserver.disconnect();
    const row = document.getElementById("itemsLoadMore");
    if (!row) return;
    scrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "0px 0px 200px 0px" }
    );
    scrollObserver.observe(row);
  }

  function cursorFrom(products) {
    if (!products.length) return null;
    const last = products[products.length - 1];
    return { revenue: last.revenue, productId: last.productId };
  }

  function resetPagination() {
    currentProducts = [];
    hasMore = false;
    lastCursor = null;
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
  }

  /** True once this tab has ever actually shown something. Mirrors
   *  admin-customers.js's own hasRenderedContent fix: refresh() runs on
   *  every single visit to this sub-tab (and every period change) on purpose — it's
   *  what keeps the ranking and the status counts current if an order
   *  was delivered/reopened elsewhere since — but only a genuinely empty
   *  tab needs the loading-skeleton wipe first; every revisit after that
   *  keeps the existing list on screen while the quiet re-fetch runs
   *  behind it. */
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
    // 2. The full All list for this period is already in hand: any status
    //    view is derived from it, no request.
    if (allCache && allCache.complete && allCache.key === key) {
      renderLocal(deriveFor(status, allCache.rows));
      return;
    }

    const hadContent = hasRenderedContent();
    // See variantCache's own comment — a date-range change invalidates
    // any previously fetched variant breakdown, and every refresh() is
    // treated as a potential range change rather than trying to tell
    // "just revisiting the tab" apart from "the range actually changed".
    variantCache.clear();
    resetPagination();
    if (!hadContent) {
      list.innerHTML = `<div class="skeleton" style="height:70px;margin-bottom:12px;"></div>`.repeat(3);
    }
    try {
      const total = window.AdminStats?.getTotalCount?.();
      const wantAll = status !== "ALL" && total !== null && total !== undefined && total <= ALL_FETCH_MAX_ORDERS;
      let res = await Api.get(queryFor(null, wantAll ? "ALL" : status));
      if (seq !== requestSeq) return;
      if (wantAll) {
        allCache = { key, rows: res.items, complete: !res.hasMore };
        if (!res.hasMore) {
          renderLocal(deriveFor(status, res.items));
          return;
        }
        res = await Api.get(queryFor(null, status)); // didn't fit after all
        if (seq !== requestSeq) return;
      }
      currentProducts = res.items;
      hasMore = res.hasMore;
      lastCursor = cursorFrom(res.items);
      // Remember an All answer so the other status boxes can reuse it.
      if (status === "ALL") allCache = { key, rows: res.items, complete: !res.hasMore };

      if (!res.items.length) {
        list.innerHTML = emptyStateHtml();
      } else {
        list.innerHTML = res.items.map(itemsSummary).join("") + (hasMore ? loadMoreRowHtml() : "");
        if (hasMore) observeLoadMoreRow();
        hydrateExpandedCards();
      }
    } catch (err) {
      if (seq !== requestSeq) return;
      if (hadContent) {
        Toast.show(err.message, "error");
      } else {
        list.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore || !lastCursor) return;
    const seq = requestSeq;
    loadingMore = true;
    setLoadMoreSpinning(true);
    try {
      const res = await Api.get(queryFor(lastCursor));
      if (seq !== requestSeq) return;
      currentProducts = currentProducts.concat(res.items);
      hasMore = res.hasMore;
      if (res.items.length) lastCursor = cursorFrom(res.items);
      const row = document.getElementById("itemsLoadMore");
      const cardsHtml = res.items.map(itemsSummary).join("");
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

  /** Fetches one product's variant breakdown and fills it into its
   *  (already-visible) panel, caching the result — shared by the toggle
   *  click handler and hydrateExpandedCards. */
  async function loadVariantsInto(productId, panelEl) {
    const cacheId = vKey(productId);
    panelEl.innerHTML = `<div class="daily-sales-row-loading"><span class="spinner spinner-dark"></span> Loading…</div>`;
    try {
      const params = new URLSearchParams();
      const range = currentRange();
      if (range) {
        params.set("from", range.from);
        params.set("to", range.to);
      }
      params.set("status", currentStatus());
      const variants = await Api.get(`/api/admin/items/${encodeURIComponent(productId)}/variants?${params.toString()}`);
      const html = variants.map(variantRowHtml).join("");
      variantCache.set(cacheId, html);
      if (expanded.has(productId) && document.contains(panelEl)) {
        panelEl.innerHTML = html;
      }
    } catch (err) {
      if (expanded.has(productId) && document.contains(panelEl)) {
        panelEl.innerHTML = `<div class="daily-sales-row-loading">${Utils.escapeHtml(err.message)}</div>`;
      }
    }
  }

  /** After any (re)render, a product card can come back expanded but
   *  with an empty variant panel — see admin-customers.js's identical
   *  hydrateExpandedCards for the full reasoning (there: an invalidated
   *  cache; here: variantCache.clear() on every refresh, same effect). */
  function hydrateExpandedCards() {
    list.querySelectorAll(".item-card").forEach((cardEl) => {
      const productId = Number(cardEl.dataset.productId);
      if (!expanded.has(productId) || variantCache.has(vKey(productId))) return;
      const panelEl = cardEl.querySelector(".item-variant-list");
      if (panelEl) loadVariantsInto(productId, panelEl);
    });
  }

  list.addEventListener("click", (e) => {
    const cardEl = e.target.closest(".item-card");
    const toggleBtn = e.target.closest('[data-action="toggle"]');
    if (!cardEl || !toggleBtn) return;
    const productId = Number(cardEl.dataset.productId);
    const panelEl = cardEl.querySelector(".item-variant-list");

    const isOpen = expanded.has(productId);
    if (isOpen) {
      expanded.delete(productId);
      cardEl.classList.remove("is-open");
      panelEl.hidden = true;
      return;
    }

    expanded.add(productId);
    cardEl.classList.add("is-open");
    panelEl.hidden = false;

    if (variantCache.has(vKey(productId))) {
      panelEl.innerHTML = variantCache.get(vKey(productId));
      return;
    }

    loadVariantsInto(productId, panelEl);
  });

  return { refresh, clearCache };
})();
