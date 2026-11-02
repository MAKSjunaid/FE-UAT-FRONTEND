/* Whether the store is currently accepting orders (admin can flip this
 * offline for the night / when overwhelmed) and shows a banner when it
 * isn't. checkout.js checks window.StoreStatus.isOnline() before opening
 * the checkout form, as a proactive UX layer — the real gate is
 * server-side in OrderService.placeOrder(), so this can't be bypassed by
 * skipping the banner.
 *
 * Used to poll /api/store/status every 15 seconds forever; now it simply
 * listens on the page's shared live connection (live-stream.js, which
 * replaced this file's own Server-Sent Events connection to
 * /api/store/status/stream) — the backend pushes a fresh value the moment
 * an admin actually flips the toggle, instead of the browser asking on a timer. */

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

  // Whether the shop is taking orders arrives on the page's one shared live connection (live-stream.js); only an older
  // server, without that connection, gets this part's own stream.
  const listeners = {
    status: (e) => {
      try {
        applyStatus(JSON.parse(e.data));
      } catch {
        // malformed payload — keep whatever value we last knew and wait
        // for the next push rather than guessing
      }
    },
  };
  const livePart = {
    query: () => "status=1",
    on: listeners,
    legacyStart() {
      if (eventSource) return;
      eventSource = new EventSource(Api.streamUrl("/api/store/status/stream"));
      eventSource.addEventListener("status", listeners.status);
      // No further handling needed on error/close: EventSource retries the connection on its own.
    },
    legacyStop() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    },
  };
  let attached = false;

  function connect() {
    if (attached) return;
    attached = true;
    if (window.FreshcutzLive) window.FreshcutzLive.attach("status", livePart);
    else livePart.legacyStart();
  }

  function disconnect() {
    attached = false;
    if (window.FreshcutzLive) window.FreshcutzLive.detach("status");
    else livePart.legacyStop();
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