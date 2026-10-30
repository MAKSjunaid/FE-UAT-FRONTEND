/* Phone bottom menu helpers (the tab switching itself is admin-main.js).
 *  1) mirrors the Orders "new orders" count onto the bottom menu's badge;
 *  2) hides the bar while a text field is focused, so the on-screen keyboard
 *     never has the bar sitting on top of what is being typed. */
(() => {
  const html = document.documentElement;

  // ---- 1) new-orders badge -------------------------------------------
  const pill = document.getElementById("newOrdersPill");
  const badge = document.getElementById("newOrdersBadgeBottom");
  if (pill && badge) {
    const sync = () => {
      const n = parseInt((pill.textContent || "").trim(), 10);
      const show = !pill.hidden && Number.isFinite(n) && n > 0;
      badge.textContent = n > 99 ? "99+" : String(n || 0);
      badge.hidden = !show;
    };
    new MutationObserver(sync).observe(pill, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    sync();
  }

  // ---- 2) keyboard ------------------------------------------------------
  const TEXT_FIELD = "textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]):not([type=color])";
  document.addEventListener("focusin", (e) => {
    if (e.target.matches && e.target.matches(TEXT_FIELD)) html.classList.add("kb-open");
  });
  document.addEventListener("focusout", () => {
    // wait a tick: focus may just be moving to another field
    setTimeout(() => {
      const a = document.activeElement;
      if (!(a && a.matches && a.matches(TEXT_FIELD))) html.classList.remove("kb-open");
    }, 60);
  });
  // ---- 3) always-full-screen page ----------------------------------------
  // iPhone "Add to Home Screen" mode: when a tab has little content (e.g. one
  // order), the page is shorter than the screen and iOS pins the bottom bar to
  // the end of that short page, leaving a blank strip under it. Giving the
  // page the exact screen height (re-measured on rotate/resume) keeps the bar
  // on the real bottom edge.
  const setAppHeight = () => {
    const h = window.innerHeight || document.documentElement.clientHeight;
    if (h) html.style.setProperty("--app-h", h + "px");
  };
  setAppHeight();
  window.addEventListener("resize", setAppHeight);
  window.addEventListener("orientationchange", () => setTimeout(setAppHeight, 250));
  window.addEventListener("pageshow", setAppHeight);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setAppHeight(); });
})();
