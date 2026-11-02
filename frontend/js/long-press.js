/* Long press on an item = a preview: the big item card opens while the finger is held down, the card follows the finger if it
 * is moved (anywhere on the screen), and it closes again when the finger is lifted (a normal tap still opens it and keeps it open).
 *
 * Works on the item panels of the page and on the featured rows (and the "View all" list). Holding for about half a second on
 * the picture, name or text of an item opens it (the phone gives a tiny buzz); moving the finger (scrolling) or lifting it earlier
 * does nothing special. Holding a button on the item (Add to cart, + / -, the size choices) does nothing extra.
 * The tap that the finger lift would otherwise make is swallowed, so nothing else happens by accident. */
(() => {
  const HOLD_MS = 450;     // how long the finger has to stay down
  const MOVE_PX = 10;      // moving more than this = it is a scroll, not a press

  // no text-selection / "save image" pop-up while pressing an item
  const css = document.createElement("style");
  css.textContent =
    ".product-card, .sp-card { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }" +
    ".product-card img, .sp-card img { -webkit-user-drag: none; }" +
    ".product-card.lp-press, .sp-card.lp-press { filter: brightness(0.95); transition: filter 0.15s; }";
  document.head.appendChild(css);

  let timer = null, card = null, x0 = 0, y0 = 0, fired = false, swallowUntil = 0, opening = false, openedAt = 0;
  const OPEN_MS = 380; // the card's opening movement: it is let finish before it closes again

  const clear = () => {
    clearTimeout(timer);
    timer = null;
    if (card) card.classList.remove("lp-press");
    card = null;
  };

  /** Is this a spot where a long press should open the item (not a button of the item)? */
  function pressable(target) {
    if (!target.closest) return null;
    if (target.closest("[data-sp-pop], .sp-pop")) return null; // (already the big card)
    const c = target.closest(".product-card, .sp-card");
    if (!c) return null;
    if (c.classList.contains("sp-card")) {
      if (target.closest(".sp-add, .sp-step, .sp-var, [data-sp='add'], [data-sp='inc'], [data-sp='dec'], [data-sp='variant']")) return null;
    } else if (target.closest(".product-footer, .variant-toggle, [data-action]")) {
      return null;
    }
    return c;
  }

  function open(c) {
    if (document.querySelector(".sp-pop")) return;
    opening = true;
    try {
      if (c.classList.contains("sp-card")) {
        const b = c.querySelector('[data-sp="open"]');
        if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } else if (window.SiteSpecials && window.SiteSpecials.openCard) {
        window.SiteSpecials.openCard(c);
      }
    } finally {
      opening = false;
    }
  }

  document.addEventListener("pointerdown", (e) => {
    clear();
    fired = false;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const c = pressable(e.target);
    if (!c) return;
    card = c;
    x0 = e.clientX;
    y0 = e.clientY;
    timer = setTimeout(() => {
      const target = card;
      timer = null;
      if (!target || !target.isConnected) return clear();
      fired = true;
      target.classList.remove("lp-press");
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* no buzz on this phone */ }
      openedAt = performance.now();
      open(target);
      peeking = !!previewCard();
      card = null;
    }, HOLD_MS);
    setTimeout(() => { if (timer && card === c) c.classList.add("lp-press"); }, 120); // a faint hint that the press is being noticed
  }, { passive: true });

  /** The big card of the preview, moved by `translate` (a separate property: it adds to the card's own opening / closing movement). */
  const previewCard = () => document.querySelector(".sp-pop .sp-pop-card");
  let peeking = false;

  document.addEventListener("pointermove", (e) => {
    if (peeking) { // the preview is open and the finger is still down: the card goes where the finger goes
      const c = previewCard();
      if (c) c.style.translate = `${Math.round(e.clientX - x0)}px ${Math.round(e.clientY - y0)}px`;
      return;
    }
    if (!timer) return;
    if (Math.abs(e.clientX - x0) > MOVE_PX || Math.abs(e.clientY - y0) > MOVE_PX) clear();
  }, { passive: true });

  // while a preview is held, moving the finger must not scroll the page behind it
  document.addEventListener("touchmove", (e) => { if (peeking && e.cancelable) e.preventDefault(); }, { passive: false });

  /** The finger came off after a long press: the preview closes again (the same way the card's own close button closes it). */
  function closePreview() {
    const wait = Math.max(0, OPEN_MS - (performance.now() - openedAt));
    setTimeout(() => {
      const x = document.querySelector(".sp-pop .sp-pop-x");
      if (!x) return;
      // it closes from wherever the finger left it: the card's own closing movement carries it back to the item it came from,
      // and the offset of the drag is let go over the same time, so it never jumps to the middle first
      const c = previewCard();
      const held = c && c.style.translate;
      if (c && held) c.style.translate = ""; // (the card's closing movement is worked out from where the card sits, as for the X button;
                                              // the drag offset is put back at once below, in the same moment, and let go along the way)
      opening = true; // (so the tap-swallowing below lets this one through)
      try { x.click(); } finally { opening = false; }
      if (c && held && held !== "0px 0px" && c.animate) {
        c.animate([{ translate: held }, { translate: "0px 0px" }], { duration: 280, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" });
      }
    }, wait);
  }

  const lift = () => {
    peeking = false;
    if (fired) { swallowUntil = performance.now() + 500; fired = false; closePreview(); }
    clear();
  };
  document.addEventListener("pointerup", lift, { passive: true });
  document.addEventListener("pointercancel", lift, { passive: true });

  // the tap that ends a long press must not do anything (open again, add to cart ...)
  document.addEventListener("click", (e) => {
    if (opening) return;
    if (performance.now() < swallowUntil) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      swallowUntil = 0;
    }
  }, true);

  // (a long press would otherwise bring up the phone's own menu)
  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest && e.target.closest(".product-card, .sp-card")) e.preventDefault();
  });
})();
