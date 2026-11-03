/* "Install FreshCutz" prompt.
 *
 * A small card that offers to put FreshCutz on the phone's Home Screen (faster to open, and on iPhone it is also the only
 * way to get order notifications).
 *  - Android / Chrome: the browser's own install box (beforeinstallprompt) opens from the card's Install button.
 *    When the browser does not offer it, the card shows the two taps to do it by hand.
 *  - iPhone / iPad: Apple has no install box, so the card's "How" button shows the steps (Share -> Add to Home Screen).
 *  - Never shown: inside the installed app, in another app's built-in browser, on a desktop, or in a cart / checkout sheet.
 *  - The ✕ hides it for 3 days; after it has been closed 3 times it does not come back. Installing ends it for good.
 *  - Test it: open the site with ?installprompt=1 in the address (it is then shown whatever was remembered).
 */
(() => {
  const DONE_KEY = "fc_inst_done";     // installed (or opened as the installed app): never again
  const SNOOZE_KEY = "fc_inst_snooze"; // when the card may show again
  const COUNT_KEY = "fc_inst_closed";  // how many times it was closed with ✕
  const DAY = 24 * 3600 * 1000;
  const SNOOZE = 3 * DAY;
  const MAX_CLOSES = 3;
  const FIRST_DELAY = 15000;   // let the shop be used for a moment first
  const RETRY_EVERY = 8000;    // busy (another card or a sheet is open): look again a little later
  const MAX_TRIES = 8;
  const NO_EVENT_WAIT = 20000; // Android: how long to wait for the browser's install offer before showing the manual steps

  const ua = navigator.userAgent || "";
  const force = /[?&]installprompt=1\b/.test(location.search);

  const get = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const put = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };

  const isIos = () => /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = () => /android/i.test(ua);
  const isStandalone = () => window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  // Facebook / Instagram / Line / TikTok ... built-in browsers cannot install anything
  const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|Twitter|; wv\)/i.test(ua);

  let deferred = null; // the browser's install offer (Android / Chrome)

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it: the card's Install button opens it
    deferred = e;
  });
  window.addEventListener("appinstalled", () => {
    put(DONE_KEY, "1");
    deferred = null;
    removeCard();
    removeSteps();
  });

  function removeCard() { const c = document.getElementById("cnInstall"); if (c) c.remove(); }
  function removeSteps() { const c = document.getElementById("cnInstSteps"); if (c) c.remove(); }

  function allowed() {
    if (force) return true;
    if (isStandalone() || inAppBrowser()) return false;
    if (!(isIos() || isAndroid())) return false;       // a phone / tablet only
    if (get(DONE_KEY)) return false;
    if (Number(get(COUNT_KEY) || 0) >= MAX_CLOSES) return false;
    if (Date.now() < Number(get(SNOOZE_KEY) || 0)) return false;
    return true;
  }

  function busy() {
    const sheet = document.getElementById("sheetRoot");
    return document.visibilityState !== "visible" ||
      !!document.getElementById("cnBar") || !!document.getElementById("cnHelp") ||
      !!document.getElementById("cnInstSteps") ||
      !!(sheet && sheet.childElementCount);
  }

  function closeForNow() {
    put(COUNT_KEY, Number(get(COUNT_KEY) || 0) + 1);
    put(SNOOZE_KEY, Date.now() + SNOOZE);
    removeCard();
  }

  function stepsFor() {
    if (isIos()) {
      return ["Tap the <b>Share</b> button in Safari (the square with an arrow, at the bottom or top)",
        "Scroll down and tap <b>Add to Home Screen</b>",
        "Tap <b>Add</b>, then open <b>FreshCutz</b> from your Home Screen"];
    }
    return ["Tap the <b>⋮</b> menu at the top right of Chrome",
      "Tap <b>Install app</b> (or <b>Add to Home screen</b>)",
      "Tap <b>Install</b>, then open <b>FreshCutz</b> from your Home Screen"];
  }

  function showSteps() {
    if (document.getElementById("cnInstSteps")) return;
    removeCard();
    const card = document.createElement("div");
    card.id = "cnInstSteps";
    card.className = "cn-help";
    card.setAttribute("role", "dialog");
    card.innerHTML = `
      <div class="cn-help-top"><b>📲 Install FreshCutz</b>
        <button type="button" class="cn-help-x" data-role="inst-close" aria-label="Close"></button></div>
      <p class="cn-help-note">It opens faster and works like an app${isIos() ? ", and it is how an iPhone gets order notifications" : ""}:</p>
      <ol class="cn-help-steps">${stepsFor().map((t) => `<li>${t}</li>`).join("")}</ol>`;
    document.body.appendChild(card);
    card.querySelector('[data-role="inst-close"]').addEventListener("click", () => { removeSteps(); closeForNow(); });
  }

  function showCard() {
    if (document.getElementById("cnInstall")) return;
    const canInstallHere = !!deferred;
    const card = document.createElement("div");
    card.id = "cnInstall";
    card.className = "cn-bar cn-install";
    card.setAttribute("role", "dialog");
    card.innerHTML = `<img class="cn-inst-ico" src="images/icons/icon-192.png?v=3" alt="" width="38" height="38">
      <span class="cn-inst-txt"><b>Install FreshCutz</b><small>Opens faster, like an app</small></span>
      <button type="button" class="cn-bar-yes" data-role="inst-go">${canInstallHere ? "Install" : "How"}</button>
      <button type="button" class="cn-bar-no" data-role="inst-no" aria-label="Not now"></button>`;
    document.body.appendChild(card);
    card.querySelector('[data-role="inst-no"]').addEventListener("click", closeForNow);
    card.querySelector('[data-role="inst-go"]').addEventListener("click", async () => {
      if (!deferred) { showSteps(); return; }
      const offer = deferred;
      deferred = null; // an offer can be used once
      removeCard();
      try {
        offer.prompt();
        const choice = await offer.userChoice;
        if (choice && choice.outcome === "accepted") put(DONE_KEY, "1");
        else closeForNow();
      } catch (e) { showSteps(); }
    });
  }

  function start() {
    if (!allowed()) return;
    let tries = 0;
    const offer = () => {
      if (!allowed()) return;
      if (busy()) { if (tries++ < MAX_TRIES) setTimeout(offer, RETRY_EVERY); return; }
      // Android: give the browser a moment to make its install offer; without one, the card shows the manual steps
      if (isAndroid() && !deferred && !force && Date.now() - started < FIRST_DELAY + NO_EVENT_WAIT) {
        if (tries++ < MAX_TRIES + 4) setTimeout(offer, RETRY_EVERY);
        return;
      }
      showCard();
    };
    const started = Date.now();
    setTimeout(offer, force ? 1000 : FIRST_DELAY);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
