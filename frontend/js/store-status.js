/* Whether the store is currently accepting orders (admin can flip this
 * offline for the night / when overwhelmed) and shows a banner when it
 * isn't. checkout.js checks window.StoreStatus.isOnline() before opening
 * the checkout form, as a proactive UX layer — the real gate is
 * server-side in OrderService.placeOrder(), so this can't be bypassed by
 * skipping the banner.
 *
 * Used to poll /api/store/status every 15 seconds forever; now opens one
 * Server-Sent Events connection to /api/store/status/stream instead and
 * simply waits — the backend pushes a fresh value the moment an admin
 * actually flips the toggle, instead of the browser asking on a timer. */

window.StoreStatus = (() => {
  const banner = document.getElementById("storeOfflineBanner");
  let online = true;
  let eventSource = null;

  function apply() {
    if (banner) banner.hidden = online;
  }

  function applyStatus(status) {
    online = !!status && status.online !== false;
    apply();
  }

  function connect() {
    if (eventSource) return;
    eventSource = new EventSource(Api.streamUrl("/api/store/status/stream"));
    eventSource.addEventListener("status", (e) => {
      try {
        applyStatus(JSON.parse(e.data));
      } catch {
        // malformed payload — keep whatever value we last knew and wait
        // for the next push rather than guessing
      }
    });
    // No further handling needed on error/close: EventSource retries the
    // connection on its own, same as it does for storefront-sync.js.
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  /* Same reasoning as storefront-sync.js: don't keep a live connection
   * open for a backgrounded/minimized tab for hours on end — close it,
   * and reconnect (picking up anything missed immediately) once the tab
   * is visible again. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      disconnect();
    } else {
      connect();
    }
  });

  if (!document.hidden) connect();

  return { isOnline: () => online };
})();