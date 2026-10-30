/* Hide-on-scroll for the customer header and category chips.
 *
 *  - Scrolling DOWN slides the header (logo, WhatsApp, account) and the
 *    category chips out of view so products get the full screen.
 *  - Scrolling UP even a little slides them back in (CSS animation in
 *    storefront-header.css).
 *  - Always shown near the top of the page, and while a cart / checkout /
 *    account sheet is open (the page behind it is pinned then).
 *
 * One passive scroll listener, throttled with requestAnimationFrame; it only
 * reads window.scrollY plus two tiny position checks and toggles classes. */
(() => {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const body = document.body;

  const TOP_ZONE = 70;     // px from the top where the header is always shown
  const HIDE_AFTER = 14;   // px of continuous downward scroll before hiding
  const SHOW_AFTER = 8;    // px of upward scroll before showing again

  // A bar that is sticky under the header only needs to slide away once it is
  // actually stuck there. A zero-height marker placed just before it tells us
  // where the bar would sit if it were not sticky.
  const bars = ["categoryBar", "storeOfflineBanner"]
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((el) => {
      const marker = document.createElement("span");
      marker.setAttribute("aria-hidden", "true");
      marker.style.cssText = "display:block;height:0;width:0;";
      el.parentNode.insertBefore(marker, el);
      return { el, marker };
    });

  let lastY = Math.max(0, window.scrollY);
  let travelled = 0; // signed distance since the scroll direction last changed
  let hidden = false;
  let ticking = false;

  function paint() {
    body.classList.toggle("header-hidden", hidden);
    // While the header is hidden the bars stick to the very top of the screen (CSS: body.header-hidden .category-bar
    // { top: 0 }), so a bar scrolls away with the page like any other content, and only slides off once its own
    // spot has left the screen. (Tucking it earlier left a blank strip where it used to be.)
    const stickAt = header.offsetHeight + 1;
    bars.forEach(({ el, marker }) => {
      const natural = marker.getBoundingClientRect().top; // where the bar would be if it were not sticky
      const gone = hidden ? natural + el.offsetHeight <= 0 : natural <= stickAt;
      el.classList.toggle("is-tucked", hidden && gone);
    });
  }

  function setHidden(next) {
    hidden = next;
    paint();
  }

  /** Shows the header at once (no slide), then lets the normal slide animation work again for the next scroll. */
  function snapShow() {
    const root = document.documentElement;
    root.classList.add("header-snap");
    setHidden(false);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("header-snap")));
  }

  function update() {
    ticking = false;

    // a tab switch is moving the page to that tab's own spot — not the user scrolling
    if (document.documentElement.classList.contains("tab-switching")) return;

    // sheets (cart/checkout/account) pin <body> with position: fixed, which
    // makes scrollY read 0 — leave everything as it was until they close
    if (document.documentElement.classList.contains("sheet-open")) return;

    const y = Math.max(0, window.scrollY); // ignore iOS rubber-band overscroll
    const dy = y - lastY;
    lastY = y;

    if (y <= TOP_ZONE) {
      travelled = 0;
      if (hidden) snapShow(); // back at the top: the header is simply there, no sliding in (that left a blank strip)
      else setHidden(false);
      return;
    }
    if (dy === 0) {
      if (hidden) paint(); // a bar may have just become stuck
      return;
    }

    travelled = Math.sign(dy) === Math.sign(travelled) ? travelled + dy : dy;

    if (travelled > HIDE_AFTER && !hidden) setHidden(true);
    else if (travelled < -SHOW_AFTER && hidden) setHidden(false);
    else if (hidden) paint();
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

  // typing in the search box / tabbing to a header control → bring it back
  const show = () => { travelled = 0; setHidden(false); };
  header.addEventListener("focusin", show);

  // a tab/category switch restored a saved scroll position — re-sync, keep the header shown
  document.addEventListener("freshcutz:scroll-restored", () => {
    if (document.documentElement.classList.contains("sheet-open")) return;
    lastY = Math.max(0, window.scrollY);
    show();
  });

  update();
})();
