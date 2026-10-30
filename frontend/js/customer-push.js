/* Customer notifications.
 *
 * 1. When the shop is opened: a small "Allow" bar (browsers only show their permission box after a tap). If they
 *    allow, the phone is signed up for notifications right away — even if they never order.
 *    The bar comes back on EVERY launch until they allow (tapping ✕ only hides it for this visit).
 *    Already allowed -> signed up quietly (at most once a day), nothing is asked.
 *    Blocked ("Don't Allow") -> a website cannot show the permission box again, so the bar's Allow button opens a
 *    small help card with the exact steps to switch it on in the phone's settings; coming back to the app with it
 *    switched on is picked up automatically.
 *    A customer who is signed in (My Account) also sends their phone number: the phone is then linked to that
 *    number's orders from the last 3 days.
 * 2. On the order-success screen, offers "Notify me when my order is delivered" and turns
 * it on for THIS order. Uses its own service worker (sw-store.js, scope ./cn/) — separate from the admin one.
 *
 *  - Permission not asked yet  -> a button (a tap is required on iPhone, and it is polite everywhere).
 *  - Permission already given  -> subscribes quietly for the new order, nothing to tap, nothing asked again.
 *  - Blocked in the browser    -> the same button, which opens the help card.
 *  - iPhone, not on the Home Screen -> a hint how to Add to Home Screen (Apple only allows web push from there).
 *
 * The server only accepts an order subscription together with the token that came back with this order. */

window.CustomerPush = (() => {
  const SW_URL = "sw-store.js";
  const SW_SCOPE = "./cn/";
  const SYNC_KEY = "fc_cn_synced";   // when this phone was last signed up with the server
  const PHONE_SYNC_KEY = "fc_cn_phone"; // the signed-in phone number the server last heard from this phone
  const PROFILE_KEY = "freshcutz_profile_phone"; // written by profile.js (My Account)
  const DAY = 24 * 3600 * 1000;

  const lsGet = (k) => { try { return Number(localStorage.getItem(k) || 0); } catch (e) { return 0; } };
  const lsSet = (k) => { try { localStorage.setItem(k, String(Date.now())); } catch (e) { /* ignore */ } };
  const lsText = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const lsPutText = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const signedInPhone = () => lsText(PROFILE_KEY).replace(/\D/g, "");

  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  /** Resolves with a registration whose worker is ACTIVE (subscribing before that fails on iPhone). */
  async function readyRegistration() {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    if (reg.active) return reg;
    const worker = reg.installing || reg.waiting;
    if (!worker) return reg;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker timeout")), 15000);
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") { clearTimeout(timer); resolve(); }
        else if (worker.state === "redundant") { clearTimeout(timer); reject(new Error("worker failed")); }
      });
    });
    return reg;
  }

  /** This phone's push subscription (made now if there is none). Throws on failure. */
  async function deviceSubscription() {
    const key = await Api.get("/api/customer-push/public-key");
    if (!key || !key.publicKey || key.enabled === false) throw new Error("not enabled");
    const reg = await readyRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
      });
    }
    return sub;
  }

  /** Signs this phone up for notifications (no order involved). */
  async function subscribeDevice() {
    const sub = await deviceSubscription();
    const phone = signedInPhone();
    await Api.post("/api/customer-push/subscribe-device", { subscription: sub.toJSON(), phone: phone || undefined });
    lsSet(SYNC_KEY);
    lsPutText(PHONE_SYNC_KEY, phone);
  }

  /** Subscribes this device and links it to the order. Throws on failure. */
  async function subscribeFor(order) {
    const sub = await deviceSubscription();
    await Api.post("/api/customer-push/subscribe", {
      orderId: order.id,
      token: order.notifyToken,
      subscription: sub.toJSON(),
    });
    lsSet(SYNC_KEY);
  }

  function done(slot) {
    slot.innerHTML = `<div class="cn-box cn-ok">✅ <span>You'll get a notification when your order is delivered.</span></div>`;
  }

  /** Puts the right thing (button / hint / nothing) into `slot` for this freshly placed order. */
  function mount(slot, order) {
    if (!slot || !order || !order.notifyToken || order.id == null) return;
    const bar = document.getElementById("cnBar"); // the "Allow" bar from opening the shop is not needed any more
    if (bar) bar.remove();

    if (isIos() && !isStandalone()) {
      slot.innerHTML = `<div class="cn-box cn-hint">📲 <span><b>Want a ping when it's delivered?</b> On iPhone, tap <b>Share</b> then <b>Add to Home Screen</b>, and open FreshCutz from there next time.</span></div>`;
      return;
    }
    if (!supported()) return;

    const perm = Notification.permission;

    if (perm === "granted") {
      // already allowed (for example when they opened the shop): no question and nothing on screen —
      // just quietly follow this order too
      subscribeFor(order).catch(() => {});
      return;
    }

    slot.innerHTML = `<button type="button" class="cn-btn" data-role="cn-ask">🔔 <span>Notify me when my order is delivered</span></button>`;
    const btn = slot.querySelector('[data-role="cn-ask"]');
    btn.addEventListener("click", () => {
      if (Notification.permission === "denied") { showHelp(); return; } // blocked earlier: only the phone's settings can undo that
      btn.disabled = true;
      // requested straight from the tap — before any await — which iPhone insists on
      const asked = Notification.requestPermission();
      Promise.resolve(asked).then(async (result) => {
        if (result !== "granted") {
          slot.innerHTML = `<div class="cn-box cn-hint">🔕 <span>No problem — you can still see your order status on this page.</span></div>`;
          if (result === "denied") showHelp();
          return;
        }
        try {
          await subscribeFor(order);
          done(slot);
        } catch (e) {
          slot.innerHTML = `<div class="cn-box cn-hint">⚠️ <span>Couldn't turn notifications on right now. You can try again with your next order.</span></div>`;
        }
      });
    });
  }

  // ---- when the shop is opened ------------------------------------------------
  function showAskBar() {
    if (document.getElementById("cnBar")) return;
    const bar = document.createElement("div");
    bar.id = "cnBar";
    bar.className = "cn-bar";
    bar.innerHTML = `<span class="cn-bar-txt">🍗 Fresh updates from FreshCutz</span>
      <button type="button" class="cn-bar-yes" data-role="cn-yes">Allow</button>
      <button type="button" class="cn-bar-no" data-role="cn-no" aria-label="Not now"></button>`;
    document.body.appendChild(bar);
    // ✕ only hides it for this visit: it is shown again the next time the shop is opened
    bar.querySelector('[data-role="cn-no"]').addEventListener("click", () => bar.remove());
    bar.querySelector('[data-role="cn-yes"]').addEventListener("click", () => {
      if (Notification.permission === "denied") { bar.remove(); showHelp(); return; }
      // straight from the tap — before any await — which iPhone and Safari insist on
      const asked = Notification.requestPermission();
      bar.remove();
      Promise.resolve(asked).then((result) => {
        if (result === "granted") subscribeDevice().catch(() => {});
        else if (result === "denied") showHelp();
      });
    });
  }

  /** The steps to switch notifications on in the phone's own settings (a website can't show the box again). */
  function helpSteps() {
    if (isIos()) {
      return ["Open the iPhone <b>Settings</b> app", "Tap <b>Notifications</b>, then <b>FreshCutz</b>", "Turn on <b>Allow Notifications</b>"];
    }
    if (/android/i.test(navigator.userAgent)) {
      return isStandalone()
        ? ["Press and hold the <b>FreshCutz</b> icon, then tap <b>App info</b>", "Tap <b>Notifications</b>", "Turn notifications <b>on</b>"]
        : ["Tap the <b>lock</b> icon next to the address", "Tap <b>Permissions</b> (or Site settings), then <b>Notifications</b>", "Set it to <b>Allow</b>"];
    }
    return ["Click the <b>lock</b> icon next to the address", "Find <b>Notifications</b>", "Set it to <b>Allow</b>"];
  }

  function showHelp() {
    if (document.getElementById("cnHelp")) return;
    const card = document.createElement("div");
    card.id = "cnHelp";
    card.className = "cn-help";
    card.setAttribute("role", "dialog");
    card.innerHTML = `
      <div class="cn-help-top"><b>🍗 Turn on fresh updates</b>
        <button type="button" class="cn-help-x" data-role="cn-help-close" aria-label="Close"></button></div>
      <p class="cn-help-note">Notifications are switched off for FreshCutz on this phone. Your phone only lets you switch them back on in its settings:</p>
      <ol class="cn-help-steps">${helpSteps().map((t) => `<li>${t}</li>`).join("")}</ol>
      <p class="cn-help-note">Then come back to FreshCutz — we'll notice.</p>`;
    document.body.appendChild(card);
    card.querySelector('[data-role="cn-help-close"]').addEventListener("click", () => card.remove());
  }

  /** Signs the phone up (again) when it may be needed: allowed, and either not told the server for a day or the
   * signed-in number changed. `force` = do it now. */
  function syncIfGranted(force) {
    if (!supported() || (isIos() && !isStandalone())) return;
    if (Notification.permission !== "granted") return;
    const bar = document.getElementById("cnBar"); if (bar) bar.remove();
    const help = document.getElementById("cnHelp"); if (help) help.remove();
    const numberChanged = signedInPhone() !== lsText(PHONE_SYNC_KEY);
    if (force || numberChanged || Date.now() - lsGet(SYNC_KEY) > DAY) subscribeDevice().catch(() => {});
  }

  function init() {
    if (!supported()) return;
    if (isIos() && !isStandalone()) return;      // iPhone: only from the Home Screen app
    if (Notification.permission === "granted") { syncIfGranted(false); return; }
    // Not allowed (not asked yet, or "Don't Allow"): the bar, on every launch, until they allow.
    let tries = 0;
    const offer = () => {
      if (Notification.permission === "granted") return;
      // don't talk over a cart / checkout sheet that is already open: try again a little later
      const sheet = document.getElementById("sheetRoot");
      if (sheet && sheet.childElementCount && tries++ < 8) { setTimeout(offer, 5000); return; }
      showAskBar();
    };
    setTimeout(offer, 3000);
  }

  // Back from the phone's settings (or from another tab) with notifications now switched on: pick it up.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncIfGranted(false);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // profile.js calls this right after a customer signs in to My Account: the phone then learns their orders
  return { mount, sync: () => syncIfGranted(false) };
})();
