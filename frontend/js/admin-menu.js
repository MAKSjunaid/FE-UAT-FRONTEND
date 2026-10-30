/* Phone ☰ menu: opens/closes the drop-down that holds the store switch, ⏰
 * store hours, 🔔 order alerts and Log out (CSS in css/admin-menu.css).
 * Those controls are the original elements, just shown inside the drop-down,
 * so their own scripts (admin-store.js, admin-push.js, admin-auth.js) keep
 * working untouched. */
(() => {
  const btn = document.getElementById("topMenuBtn");
  const topbar = document.querySelector(".admin-topbar");
  const backdrop = document.getElementById("topMenuBackdrop");
  if (!btn || !topbar || !backdrop) return;

  let open = false;

  function setOpen(next) {
    if (open === next) return;
    open = next;
    topbar.classList.toggle("menu-open", open);
    backdrop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  }

  btn.addEventListener("click", () => setOpen(!open));
  backdrop.addEventListener("click", () => setOpen(false));

  // Esc closes, and puts focus back on the ☰
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) { setOpen(false); btn.focus(); }
  });

  document.addEventListener("click", (e) => {
    if (!open || !e.target.closest) return;
    // choosing ⏰ / Log out, or a tab, closes it — the store switch and the
    // 🔔 order-alerts switch stay open so you can see them change
    if (e.target.closest("#storeScheduleBtn, #logoutBtn, .admin-tab[data-view]")) setOpen(false);
  });

  // scrolling the page away closes it
  let startY = window.scrollY;
  window.addEventListener("scroll", () => {
    if (!open) { startY = window.scrollY; return; }
    if (Math.abs(window.scrollY - startY) > 12) setOpen(false);
  }, { passive: true });
  btn.addEventListener("click", () => { startY = window.scrollY; });

  // back to a wide screen: nothing should stay open
  window.addEventListener("resize", () => { if (window.innerWidth > 640) setOpen(false); });

  // ---- green / red dot on the ☰ follows the store's Online / Offline state ----
  const label = document.getElementById("storeToggleLabel");
  const toggle = document.getElementById("storeOnlineToggle");
  function paintDot() {
    const online = toggle ? toggle.checked : !/offline/i.test((label && label.textContent) || "");
    btn.classList.toggle("is-offline", !online);
  }
  if (label) new MutationObserver(paintDot).observe(label, { childList: true, characterData: true, subtree: true });
  if (toggle) toggle.addEventListener("change", paintDot);
  paintDot();
})();
