/* Rest when nobody is looking. Streaming apps stop their auto-playing banners after a while without a touch; this does the same for every slow,
 * endless movement here (the featured rows, the banners' auto-slide, the order tracker's pulse and sweep, the running text): after IDLE_MS
 * without a touch, scroll, key or mouse move they stand still - the screen is then not redrawn at all, so a phone left open on the page stays cool.
 * The first touch (or scroll, key, mouse move) sets everything going again from where it stopped.
 *
 * - It also rests while a sheet / pop-up covers the page (View all, cart, orders, a lifted-out card): everything behind it is dimmed and blurred, and
 *   the browser re-blurs the whole screen on every frame of any movement behind it, so a covered, moving page is the costliest case of all.
 * - Only slow endless movements are stopped (an endless animation of 1.5 s or longer); a spinner or anything quick keeps going.
 * - A phone set to "reduce motion" gets the still page straight away.
 * - A phone below 20 % battery, not charging, rests after 15 s instead.
 * - ?idle=0 in the address turns this off (to compare). (?calm=1 stops all movement, see index.html.) */
(() => {
  if (/[?&]idle=0\b/.test(location.search) || window.FC_CALM) return;
  let IDLE_MS = 45000;
  const MIN_MS = 1500;
  const root = document.documentElement;
  const held = new Set(); // the animations this file stopped
  let idle = false;
  let last = Date.now();
  let timer = 0;
  const rm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  const slowEndless = (a) => {
    try {
      const t = a.effect && a.effect.getTiming && a.effect.getTiming();
      return !!t && t.iterations === Infinity && Number(t.duration) >= MIN_MS;
    } catch (e) { return false; }
  };
  const sheetUp = () => root.classList.contains("sheet-open") || !!document.querySelector("#sheetRoot .sp-pop");
  let covered = false;
  const inSheet = (a) => { try { const t = a.effect && a.effect.target; return !!(t && t.closest && t.closest("#sheetRoot")); } catch (e) { return false; } };
  function stopAll() {
    let list = [];
    try { list = document.getAnimations(); } catch (e) { return; }
    for (const a of list) {
      if (a.playState === "running" && slowEndless(a) && !(covered && !idle && inSheet(a))) { held.add(a); try { a.pause(); } catch (e) { /* leave it */ } }
    }
  }
  // one place decides: still when nobody has touched the page for a while OR a sheet covers it
  function apply() {
    const on = idle || covered;
    if (on) {
      if (window.FC_IDLE) { stopAll(); return; }
      window.FC_IDLE = 1;
      root.classList.add("fc-idle");
      stopAll();
    } else if (window.FC_IDLE) {
      window.FC_IDLE = 0;
      root.classList.remove("fc-idle");
      held.forEach((a) => { try { if (a.playState === "paused") a.play(); } catch (e) { /* gone */ } });
      held.clear();
    }
  }
  function goIdle() {
    if (idle) return;
    idle = true;
    apply();
  }
  function wake() {
    last = Date.now();
    if (!idle) return;
    if (rm && rm.matches) return; // reduce-motion stays still
    idle = false;
    apply();
    arm();
  }
  function cover() {
    const c = sheetUp();
    if (c === covered) return;
    covered = c;
    apply();
  }
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(check, Math.max(500, IDLE_MS - (Date.now() - last)));
  }
  function check() {
    if (document.hidden) return arm();
    if (Date.now() - last >= IDLE_MS) goIdle();
    else arm();
  }
  // a slow endless movement that starts while resting (a row arriving, the tracker appearing) is stopped too
  document.addEventListener("animationstart", () => { if (idle || covered) setTimeout(stopAll, 0); }, true);

  let moved = 0;
  const touch = () => { if (idle || Date.now() - last > 1000) wake(); last = Date.now(); };
  ["pointerdown", "touchstart", "keydown", "wheel"].forEach((n) => addEventListener(n, touch, { passive: true, capture: true }));
  addEventListener("scroll", touch, { passive: true }); // (the page itself only: a banner or row that slides by itself also "scrolls" and is not a person)
  addEventListener("pointermove", () => { const n = Date.now(); if (n - moved > 400) { moved = n; touch(); } }, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) touch(); });

  try {
    if (navigator.getBattery) navigator.getBattery().then((b) => { if (!b.charging && b.level <= 0.2) IDLE_MS = 15000; }).catch(() => {});
  } catch (e) { /* no battery info */ }
  if (rm) {
    const sync = () => { if (rm.matches) goIdle(); else wake(); };
    if (rm.addEventListener) rm.addEventListener("change", sync); else if (rm.addListener) rm.addListener(sync);
    if (rm.matches) goIdle();
  }
  // watch for a sheet / pop-up opening and closing
  try {
    new MutationObserver(cover).observe(root, { attributes: true, attributeFilter: ["class"] });
    const hook = () => { const h = document.getElementById("sheetRoot"); if (h) new MutationObserver(cover).observe(h, { childList: true }); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
  } catch (e) { /* no observer: only the idle rest */ }
  arm();
})();
