/* Tab switching, kicking off each view's first data load after login, and
 * polling in the background so a new order shows up on its own instead of
 * only appearing once the admin happens to click a tab.
 *
 * The background poll only refreshes whichever tab is actually visible —
 * it used to always refresh both Orders' full list and Sales' full
 * multi-bucket summary every tick, no matter which tab was open, which
 * meant e.g. browsing Sales kept re-fetching the entire Orders list (at
 * whatever status filter it was last left on) for no reason. The one
 * thing that does need to stay live everywhere is the small "new orders"
 * badge on the Orders tab button — that's kept up by its own lightweight
 * endpoint (see admin-stats.js's refreshBadge), not the full summary. */

(() => {
  const tabs = document.querySelectorAll(".admin-tabs > .admin-tab[data-view]");
  const views = document.querySelectorAll(".admin-view");
  // Still checks for new orders every 15 s, but the server answers from a
  // small in-memory cache (it only re-reads the database when an order really
  // changes), so this no longer keeps the Neon database awake. A push
  // notification (sw.js -> the "message" listener below) and returning to the
  // app also refresh immediately.
  const POLL_MS = 15000; // 15 s — answered from an in-memory cache on the server, so it does not touch the DB
  let pollTimer = null;
  let loggedIn = false;
  let currentView = "orders"; // matches the tab marked "active" in admin.html

  // Customers and Customize now live inside the Settings tab (a menu list
  // with a back arrow), so the Settings tab stays highlighted on all three.
  const SETTINGS_PAGES = ["settings", "customers", "customize", "promotions", "users", "map"];
  const access = () => window.AdminAccess;

  /** Shows one screen (and highlights its tab) without loading anything. */
  function activate(viewName) {
    currentView = viewName;
    const tabView = SETTINGS_PAGES.includes(viewName) ? "settings" : viewName;
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === tabView));
    views.forEach((v) => v.classList.toggle("active", v.id === `view-${viewName}`));
  }

  /** Loads a screen's data (each one skips the request when it is still fresh). */
  function loadView(viewName) {
    if (viewName === "products" && window.AdminProducts) window.AdminProducts.refresh();
    if (viewName === "orders" && window.AdminOrders) window.AdminOrders.refreshIfNeeded();
    // Sales reloads only when stale / older than a few minutes / a new day — see
    // AdminStats.refreshIfNeeded — so flipping back and forth costs nothing.
    if (viewName === "stats" && window.AdminStats) window.AdminStats.refreshIfNeeded();
    if (viewName === "customers" && window.AdminCustomers) window.AdminCustomers.refreshIfNeeded();
    if (viewName === "customize" && window.AdminCustomize) window.AdminCustomize.refresh();
    if (viewName === "customize" && window.AdminOrderMessages) window.AdminOrderMessages.refresh();
    if (viewName === "promotions" && window.AdminPromotions) window.AdminPromotions.refresh();
    if (viewName === "users" && window.AdminUsers) window.AdminUsers.refresh();
    if (viewName === "map" && window.AdminMap) window.AdminMap.refresh();
    if (viewName === "banners" && window.AdminBanners) window.AdminBanners.refresh();
    if (viewName === "banners" && window.AdminSpecials) window.AdminSpecials.refresh();
    if (viewName === "banners" && window.AdminReorder) window.AdminReorder.refresh();
  }

  function switchTo(viewName) {
    // A staff login can't open screens the owner didn't give it.
    if (access() && viewName !== "settings" && !access().canOpen(viewName)) return;
    activate(viewName);
    loadView(viewName);
  }

  // If what this login may open changes while the page is open, leave a screen it lost.
  document.addEventListener("freshcutz:access", () => {
    if (loggedIn && access() && !access().canOpen(currentView) && currentView !== "settings") {
      switchTo(access().firstView());
    }
  });

  tabs.forEach((tab) => tab.addEventListener("click", () => switchTo(tab.dataset.view)));

  // Rows inside Settings ("Customers", "Customize") and the "← Settings" back
  // button: open that page, jump to the top and bring the header back.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-open-view]");
    if (!btn) return;
    switchTo(btn.dataset.openView);
    window.scrollTo(0, 0);
    document.dispatchEvent(new Event("freshcutz:scroll-restored"));
  });

  async function pollTick() {
    // Keeps the Orders-tab badge live no matter which tab is open — one
    // small COUNT(*), not the full dashboard summary. It also reports
    // back HOW the "new orders" count moved since the last tick (see
    // admin-stats.js's noteNewOrdersCount): 0 means nothing changed
    // anywhere, so there's nothing for a full re-fetch to pick up and
    // it's skipped entirely. A nonzero delta means something did, but
    // its sign says what kind of something, which decides how much of
    // a refetch is actually warranted:
    //  - delta > 0: an order arrived or was reopened into NEW status.
    //    Either way the only views that can ever show it are the New
    //    and All filters (see AdminOrders.affectedByNewOrder) — it can
    //    never be sitting on Delivered or Cancelled, and it can't touch
    //    the Sales tab's money totals either, since those only ever
    //    count DELIVERED orders and a NEW order isn't one yet.
    //  - delta < 0: an order left NEW for DELIVERED or CANCELLED. Which
    //    of the two isn't knowable from the count alone, and either one
    //    can change what Orders (any filter) or Sales money totals show
    //    — a delivery adds to the money totals, a cancellation can
    //    still remove the order from whatever list currently has it —
    //    so this case keeps the previous, unconditional refetch.
    // (This poll only ever needs to catch a change made from another
    // admin session/device — this session's own delivered/cancelled/
    // reopen actions already update themselves locally; see
    // admin-orders.js's applyLocalStatusChange and adjustNewOrdersCount.)
    const delta = await window.AdminStats?.refreshBadge();
    if (!delta) return;
    if (delta > 0) window.AdminSound?.newOrder(); // more New orders than before (found by the check, not the live line): chime
    if (window.AdminLive?.isConnected()) {
      // The live line keeps every Orders list current by itself (see admin-orders.js): a badge that moved here
      // is its message still on the way, so there is nothing to ask the server for.
      afterRemoteOrderChange();
      return;
    }
    if (delta < 0) {
      // An order left NEW (delivered / cancelled on another device): any list may have changed.
      if (currentView === "orders") window.AdminOrders?.refresh();
      else window.AdminOrders?.markStale?.();
    } else if (window.AdminOrders?.affectedByNewOrder?.()) {
      // More NEW orders than we know of: ask only for the ones newer than the top of the list we hold and
      // add them (see AdminOrders.fetchNewer) — not the whole first page again.
      window.AdminOrders?.fetchNewer?.();
    } else {
      // On Delivered / Cancelled a new order can't be in the list: just remember to re-read it later.
      window.AdminOrders?.markStale?.();
    }
    afterRemoteOrderChange();
  }

  /** What every other screen does when an order arrived or changed elsewhere (shared by the check above and the live line). */
  function afterRemoteOrderChange() {
    window.AdminCustomers?.markStale?.();
    // Sales lists New orders too, so a brand-new order changes what it shows just like a delivered/cancelled
    // one. When Sales isn't the visible tab nothing is fetched — it's marked stale and reloads when opened.
    // A period that ended before today can't be touched by a new order, so onRemoteChange leaves it alone.
    if (currentView === "stats") {
      window.AdminStats?.onRemoteChange();
    } else {
      window.AdminStats?.noteRemoteChange();
    }
  }

  /** One message from the live line (admin-live.js): an order was placed / delivered / cancelled / reopened, or
   *  "reload everything". It is applied to every Orders list we hold — no request at all. */
  function onLiveMessage(type, msg) {
    if (!loggedIn || !msg) return;
    if (type === "reset") {
      window.AdminOrders?.resetAll?.();
      afterRemoteOrderChange();
      return;
    }
    // The server's exact count of NEW orders comes with a live message, so the badge is set — never guessed — and
    // the 15-second check then sees no difference. (A replayed message carries an old number: left to the check.)
    if (!msg.replay && typeof msg.newCount === "number") window.AdminStats?.setNewOrdersCount(msg.newCount);
    if (type === "payment") {
      // A customer uploaded a payment screenshot, or an admin marked a UPI payment: the cards on screen redraw themselves.
      window.dispatchEvent(new CustomEvent("freshcutz:payment", { detail: { id: msg.id, paymentProofAt: msg.paymentProofAt || null, paymentCheck: msg.paymentCheck || null } }));
      return;
    }
    const result = window.AdminOrders?.applyLive?.(type, msg) || { echo: false };
    if (result.echo) return; // this page already had that change (its own tap): nothing more to do
    if (type === "order" && !msg.replay) {
      window.AdminSound?.newOrder(); // the new-order chime (admin-sound.js): only for an order this page did not already have
      if (currentView !== "orders") {
        Toast.show(`🐔 New order ${(msg.order && msg.order.orderCode) || ""}`.trim(), "success");
      }
    }
    afterRemoteOrderChange();
  }

  function startLive() {
    window.AdminLive?.start({
      onMessage: onLiveMessage,
      // Where to catch up from after a drop / a locked phone: the oldest point any held list is at.
      getSince: () => window.AdminOrders?.minSeq?.() ?? null,
      // Reconnected after a drop: one check now corrects the badge from anything that arrived meanwhile.
      onOpen: (isReconnect) => { if (isReconnect) pollTick(); },
    });
  }

  function startPolling() {
    stopPolling();
    // The 15-second check is only the fallback: while the live line is open it does nothing at all (every order change,
    // and the exact New-orders count, arrive on the line). If the line is down it checks every 15 s, as before.
    pollTimer = setInterval(() => {
      if (!window.AdminLive?.isConnected()) pollTick();
    }, POLL_MS);
    startLive(); // plus the live line, so a new order appears at once
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    window.AdminLive?.stop();
  }

  document.addEventListener("freshcutz:login", () => {
    loggedIn = true;
    // Orders is the default visible tab, so its list is worth loading
    // right away — same reasoning for the store toggle below, which
    // lives in the topbar and is always on screen no matter which tab
    // is open. The Sales tab's full multi-bucket summary is neither:
    // it's inside a hidden view the admin hasn't opened yet, so it's
    // loaded lazily the moment the admin actually switches to Sales
    // (see switchTo() above), exactly like Products and Customers
    // already only load once their own tab is opened. No separate
    // badge fetch here either: Orders' default filter is New, so the
    // very refresh() below already asks the server for exactly the
    // NEW orders and hands their count straight to the badge itself
    // (see admin-orders.js) — a second /summary/new-count request for
    // the same number right alongside it would just be duplicate work.
    // Open the first screen this login may use (the owner: Orders, as always).
    const A = access();
    const first = A ? A.firstView() : "orders";
    activate(first);
    loadView(first);
    if (!A || A.can("store")) window.AdminStore?.refresh();
    if (!A || A.can("orders")) startPolling();
  });

  document.addEventListener("freshcutz:logout", () => {
    loggedIn = false;
    stopPolling();
  });

  /* Same reasoning as the customer page's background-tab pause (see
   * storefront-sync.js): don't keep polling every 15 seconds while this
   * browser tab is backgrounded. Gated on loggedIn so this can't start
   * polling early if the tab becomes visible again while still sitting on
   * the login screen. */
  // A push notification just arrived (sw.js tells every open page): refresh now.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      // (with the live line open the order itself arrives on it: nothing to ask)
      if (loggedIn && e.data && e.data.type === "freshcutz-push" && !window.AdminLive?.isConnected()) pollTick();
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (!loggedIn) return;
    if (document.hidden) {
      // With the new-order sound on, the live line stays open while this tab is in the background, so the chime
      // still plays when you are on another tab. With it off, everything pauses as before.
      if (!window.AdminSound?.isOn()) stopPolling();
    } else if (pollTimer && window.AdminLive?.isConnected()) {
      pollTick(); // kept running in the background: nothing to restart, just make sure the badge is right
    } else {
      pollTick();
      startPolling();
    }
  });
})();
