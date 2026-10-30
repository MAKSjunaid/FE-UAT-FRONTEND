/* Web Push notifications for the admin panel. A new order always shows a
 * real OS-level notification; an order-delivered notification is
 * suppressed by sw.js when this device already has the site open (see
 * sw.js for why) — from this file's side, both are the exact same
 * "subscribe once" flow.
 *
 * iOS only allows Web Push from a page added to the Home Screen (Apple's
 * rule) — isIos()/isStandalone() below detect that and show a one-time
 * hint instead of a button that can't work yet. */

window.AdminPush = (() => {
  const btn = document.getElementById("pushToggleBtn");
  const iosBanner = document.getElementById("pushIosBanner");
  const IOS_HINT_DISMISSED_KEY = "freshcutz_admin_ios_push_hint_dismissed";
  let registration = null;

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isStandalone() {
    return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  }

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  async function init() {
    if (window.AdminAccess && !AdminAccess.can("orders")) return;   // order alerts are for logins that see Orders
    if (isIos() && !isStandalone()) {
      if (iosBanner && localStorage.getItem(IOS_HINT_DISMISSED_KEY) !== "1") {
        iosBanner.hidden = false;
      }
      return; // PushManager doesn't exist in a plain iOS Safari tab
    }
    if (!supported() || !btn) return;
    if (registration) { refreshButton(); return; } // already set up (re-login)

    try {
      await navigator.serviceWorker.register("sw.js");
      // .ready resolves only once the worker is ACTIVE — subscribing before
      // that fails on iPhone (and silently did nothing useful).
      registration = await navigator.serviceWorker.ready;
    } catch {
      return;
    }
    btn.hidden = false;
    btn.addEventListener("click", onToggleClick);
    await refreshButton();
    healServerCopy();
  }

  async function currentSub() {
    try {
      return await registration.pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  /** Paint the switch from the phone's real subscription state. */
  async function refreshButton() {
    if (!registration || !btn) return;
    paint(await currentSub());
  }

  function paint(sub) {
    btn.classList.toggle("is-active", !!sub);
    // notifications blocked in the phone's settings: say so instead of "OFF"
    btn.classList.toggle("is-blocked", !sub && "Notification" in window && Notification.permission === "denied");
    btn.title = sub ? "Order alerts are ON — tap to turn off" : "Order alerts are OFF — tap to turn on";
    btn.setAttribute("aria-pressed", sub ? "true" : "false");
  }

  function setBusy(on) {
    btn.classList.toggle("is-busy", on);
    btn.disabled = on;
  }

  /** If this phone is subscribed but the server lost its copy (database
   * reset, old record cleaned up), quietly register it again. */
  async function healServerCopy() {
    // Once a day is plenty — doing it on every page load was one needless request each time.
    const KEY = "fc_push_healed";
    try {
      if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 24 * 3600 * 1000) return;
    } catch {
      /* storage blocked: just carry on */
    }
    const sub = await currentSub();
    if (!sub) return;
    try {
      await Api.post("/api/admin/push/subscribe", sub.toJSON());
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    } catch {
      /* best effort */
    }
  }

  function withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
  }

  function onToggleClick() {
    if (btn.disabled) return;
    // iPhone only shows the permission prompt if it is requested straight
    // from the tap — before any await — so start it here, first thing.
    const permissionPromise =
      Notification.permission === "default"
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);
    run(permissionPromise);
  }

  async function run(permissionPromise) {
    setBusy(true);
    try {
      const existing = await currentSub();
      if (existing) {
        await unsubscribe(existing);
        paint(await currentSub());
      } else {
        await subscribe(await permissionPromise);
      }
    } finally {
      setBusy(false);
    }
  }

  async function subscribe(permission) {
    if (permission !== "granted") {
      paint(null);
      Toast.show(
        permission === "denied"
          ? "Notifications are blocked — allow them in Settings › Notifications › FreshCutz Admin"
          : "Notification permission was not granted",
        "error"
      );
      return;
    }
    let sub;
    try {
      const { publicKey } = await Api.get("/api/admin/push/vapid-public-key");
      if (!publicKey) {
        Toast.show("Push notifications aren't configured on the server yet", "error");
        return;
      }
      // iPhone can take a while to register with Apple's push service the
      // first time (sometimes 30+ seconds). Don't give up early and don't
      // throw the result away: keep waiting on the SAME request and finish
      // setting up whenever it arrives.
      const pending = registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      // if it only arrives after we stopped waiting, still register it with
      // the server and show the switch as ON
      pending
        .then(async (late) => {
          try { await Api.post("/api/admin/push/subscribe", late.toJSON()); } catch { /* best effort */ }
          paint(late);
        })
        .catch(() => {});
      const slowTimer = setTimeout(
        () => Toast.show("Still registering with Apple — keep this app open…", "success"),
        12000
      );
      try {
        // On iPhone, subscribe() sometimes never reports back even though the
        // phone HAS created the subscription (it then shows up as ON only
        // after a restart). So also look for it directly every 1.5 s and go
        // on as soon as either one produces it.
        let stopPolling = false;
        const polled = (async () => {
          const until = Date.now() + 120000;
          while (!stopPolling && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 1500));
            if (stopPolling) return null;
            const found = await currentSub();
            if (found) return found;
          }
          return null;
        })();
        try {
          sub = await withTimeout(
            Promise.race([pending, polled.then((f) => f || new Promise(() => {}))]),
            120000,
            "Apple's push service didn't answer in 2 minutes"
          );
        } finally {
          stopPolling = true;
        }
      } finally {
        clearTimeout(slowTimer);
      }
      await Api.post("/api/admin/push/subscribe", sub.toJSON());
    } catch (err) {
      paint(await currentSub());
      Toast.show("Couldn't enable alerts: " + err.message + " — close the app completely, reopen it and try again", "error");
      return;
    }

    // show ON straight away — don't wait for anything else
    paint(sub);
    Toast.show("Order alerts are ON for this device", "success");
  }

  async function unsubscribe(sub) {
    try {
      await Api.post("/api/admin/push/unsubscribe", { endpoint: sub.endpoint });
    } catch (err) {
      Toast.show(err.message, "error");
      return;
    }
    try {
      await sub.unsubscribe();
      Toast.show("Order alerts turned off on this device", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  document.getElementById("pushIosBannerClose")?.addEventListener("click", () => {
    localStorage.setItem(IOS_HINT_DISMISSED_KEY, "1");
    iosBanner.hidden = true;
  });

  document.addEventListener("freshcutz:login", init);

  return {};
})();
