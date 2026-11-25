/* Hide-on-scroll for the admin header (top bar + tab bar) and, on phones, the bottom menu.
 *
 *  - Scrolling DOWN hides it, so lists get the full screen.
 *  - The bottom menu goes and comes with the header, and is also shown again at the very bottom of the page.
 *  - Scrolling UP even a little brings it back, with a slide animation
 *    (the animation itself is CSS in admin-shell.css).
 *  - Always visible near the top of the page, when a tab is switched, and
 *    when something inside it has keyboard focus.
 *
 * One passive scroll listener, throttled with requestAnimationFrame; it only
 * reads window.scrollY and toggles two classes, so it costs next to nothing. */
(() => {
  const group = document.querySelector(".admin-header-group");
  if (!group) return;
  const nav = document.getElementById("adminBottomNav"); // the phone's bottom menu (display:none on wider screens: nothing to do there)
  const html = document.documentElement;
  const BOTTOM_ZONE = 24;  // px from the end of the page where the bottom menu is always shown

  const TOP_ZONE = 70;     // px from top where the header is always shown
  const HIDE_AFTER = 14;   // px of continuous downward scroll before hiding
  const SHOW_AFTER = 8;    // px of upward scroll before showing again

  let lastY = Math.max(0, window.scrollY);
  let travelled = 0;       // signed distance since the direction last changed
  let ticking = false;

  function setNav(hidden) {
    if (!nav || nav.classList.contains("is-hidden") === hidden) return;
    nav.classList.toggle("is-hidden", hidden);
    html.classList.toggle("nav-away", hidden); // lets the round + button and the save bar settle where the menu was
  }

  function setHidden(hidden) {
    if (group.classList.contains("is-hidden") !== hidden) {
      group.classList.toggle("is-hidden", hidden);
    }
    setNav(hidden);
  }

  function update() {
    ticking = false;

    // a tab switch is moving the page to that tab's own spot — not the user scrolling
    if (document.documentElement.classList.contains("tab-switching")) return;
    const y = Math.max(0, window.scrollY); // ignore iOS rubber-band overscroll
    const dy = y - lastY;
    lastY = y;

    group.classList.toggle("is-scrolled", y > 4);

    if (y <= TOP_ZONE) {
      travelled = 0;
      setHidden(false);
      return;
    }
    if (dy !== 0) {
      // keep a running total in the current direction; reset when it flips
      travelled = Math.sign(dy) === Math.sign(travelled) ? travelled + dy : dy;
      if (travelled > HIDE_AFTER) setHidden(true);
      else if (travelled < -SHOW_AFTER) setHidden(false);
    }
    // at the very end of the page the bottom menu is always there to reach
    if (html.scrollHeight - (y + window.innerHeight) < BOTTOM_ZONE) setNav(false);
  }

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );

  const show = () => { travelled = 0; setHidden(false); };

  // switching tabs, or tabbing/typing into something in the header → reveal it
  group.addEventListener("focusin", show);
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".admin-tab[data-view]")) show();
  });

  // a tab switch restored a saved scroll position — re-sync and keep the header shown
  document.addEventListener("freshcutz:scroll-restored", () => {
    lastY = Math.max(0, window.scrollY);
    show();
    group.classList.toggle("is-scrolled", lastY > 4);
  });

  update();
})();
