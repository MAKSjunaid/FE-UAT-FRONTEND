/* Gives every tab its own scroll position, with no visible flash or jitter.
 *
 * Admin tabs, the Orders status filter, the Sales sub-tabs and the customer
 * category chips all swap content inside ONE scrolling page, so the browser
 * would carry the old scroll position over to the new content. Here:
 *   - leaving a tab remembers where you were in it;
 *   - coming back restores exactly that spot;
 *   - a tab you haven't opened yet starts at its top (for customer categories:
 *     the start of the product list).
 *
 * How the switch is kept invisible:
 *   1. The page height is pinned while the content swaps, so the browser never
 *      yanks the scroll position when the page momentarily gets shorter.
 *   2. The jump to the tab's spot happens in the same click, right after the
 *      page's own handler and BEFORE the browser paints — the first frame
 *      already shows the right position.
 *   3. The jump is always instant (never the page's smooth-scroll slide) and
 *      browser scroll-anchoring is off while it settles, so nothing nudges the
 *      page afterwards.
 *   4. While html.tab-switching is set, the hide-on-scroll headers ignore
 *      scroll events and their shadow/fade animations are paused (see the
 *      CSS), so the header can't flicker.
 *
 * It listens for clicks (capture phase first, so it sees the old tab before the
 * page's own handlers switch it) and needs no changes to any other script. */
(() => {
  const html = document.documentElement;
  const pos = {};                       // "group:key" -> scrollY

  const headerH = () => {
    const h = document.querySelector(".site-header, .admin-header-group");
    return h ? h.offsetHeight : 0;
  };

  // Start of the product list on the customer page: the spot where the category
  // chips have just stuck under the header.
  function catalogStart() {
    const hero = document.getElementById("heroSection");
    const heroEnd = hero && hero.offsetParent !== null ? hero.offsetTop + hero.offsetHeight : 0;
    return Math.max(0, heroEnd - headerH());
  }

  const GROUPS = [
    { name: "view",      item: ".admin-tabs > .admin-tab[data-view]", key: (el) => el.dataset.view,        fresh: () => 0 },
    { name: "ostatus",   item: "#orderStatusFilter .admin-tab",             key: (el) => el.dataset.status || "", fresh: () => 0 },
    { name: "salespane", item: "#salesSubtabs .sales-subtab",               key: (el) => el.dataset.pane,       fresh: () => 0 },
    { name: "category",  item: "#categoryScroll .cat-chip",                 key: (el) => el.dataset.cat,        fresh: (y) => Math.min(y, catalogStart()) },
  ];

  let token = 0;        // a newer switch (or the user touching the page) cancels an older one
  let pending = null;   // scroll target chosen in the capture phase, applied after the page's handler

  // ---- the "switching" state -------------------------------------------
  const pin = () => { document.body.style.minHeight = html.scrollHeight + "px"; };

  function begin() {
    html.classList.add("tab-switching");
    pin();
  }

  function finish() {
    document.body.style.minHeight = "";
    // let the headers re-sync to where the page ended up…
    document.dispatchEvent(new Event("freshcutz:scroll-restored"));
    // …and only then switch their animations back on
    requestAnimationFrame(() => html.classList.remove("tab-switching"));
  }

  function jumpTo(y) {
    // html has `scroll-behavior: smooth`, which would turn this jump into a
    // visible slide. "instant" overrides it; very old browsers that reject that
    // option get the same result by switching smooth-scrolling off for the call
    // (reading the computed style forces the browser to notice before we jump).
    try {
      window.scrollTo({ top: y, left: 0, behavior: "instant" });
    } catch (err) {
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      void getComputedStyle(html).scrollBehavior;
      window.scrollTo(0, y);
      html.style.scrollBehavior = prev;
    }
  }

  // The new tab's content may still be loading (so the page is momentarily too
  // short to scroll that far) — keep nudging for a moment until it can.
  function restore(y) {
    const mine = ++token;
    let tries = 0;
    (function step() {
      if (mine !== token) return;
      jumpTo(y);
      const reached = Math.abs(window.scrollY - y) < 2;
      if ((reached && tries >= 4) || ++tries > 16) { finish(); return; }
      setTimeout(step, 90);
    })();
  }

  // the user grabbing the page ends the switch right away
  const cancel = () => {
    if (!html.classList.contains("tab-switching") && pending === null) return;
    token++;
    pending = null;
    finish();
  };
  ["wheel", "touchstart", "keydown", "mousedown"].forEach((t) =>
    window.addEventListener(t, cancel, { passive: true, capture: true })
  );

  // ---- click handling ---------------------------------------------------
  // 1) capture phase: runs BEFORE the page's own tab handler. Work out where
  //    the new tab should land and freeze the page height.
  document.addEventListener(
    "click",
    (e) => {
      if (!e.target.closest) return;
      for (const g of GROUPS) {
        const clicked = e.target.closest(g.item);
        if (!clicked) continue;

        const current = document.querySelector(g.item + ".active");
        const from = current ? g.key(current) : null;
        const to = g.key(clicked);
        if (from === to) return;                   // same tab tapped again

        const y = Math.max(0, window.scrollY);
        if (from !== null) pos[g.name + ":" + from] = y;

        const saved = pos[g.name + ":" + to];
        pending = saved !== undefined ? saved : g.fresh(y);
        begin();
        return;
      }
    },
    true
  );

  // 2) bubble phase on document: runs right AFTER the page's own handler (same
  //    click, before the browser paints), so the very first frame already shows
  //    the tab at its own position — no intermediate frame, no visible jump.
  document.addEventListener("click", () => {
    if (pending === null) return;
    const target = pending;
    pending = null;
    jumpTo(target);
    restore(target); // keeps nudging while the tab's list is still loading
  });
})();
