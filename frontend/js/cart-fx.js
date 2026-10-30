/* Small cart animations for the customer site:
 *   CartFx.fly(fromRect)  - a little product-photo bubble arcs from the Add / +
 *                           button into the cart bar, which then bounces.
 *   CartFx.back(toRect)   - the reverse: when an item is taken out (- button) a bubble
 *                           flies from the cart bar back to that item's button.
 *   CartFx.bump()         - the cart bar's count + total give a gentle bounce.
 * Purely visual: nothing here touches the cart itself. If the visitor has
 * "reduce motion" turned on, the flight is skipped (just a tiny bounce).
 * To remove the feature: delete this file + css/cart-fx.css and their two
 * tags in index.html, and the CartFx lines in storefront.js. */
window.CartFx = (() => {
  const MAX_FLYING = 4;
  let flying = 0;

  function reduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function enabled() {
    return !window.SiteCustomize || SiteCustomize.on("showCartAnimations");
  }

  function bump() {
    if (!enabled()) return;
    const info = document.querySelector(".cart-bar-info");
    if (!info) return;
    info.classList.remove("fx-bump");
    // eslint-disable-next-line no-unused-expressions
    info.offsetWidth; // restart the animation if it is already running
    info.classList.add("fx-bump");
  }

  /** fromRect: bounding box of the tapped button, captured BEFORE the cart
   *  changes (the Add button hides itself right after being tapped). */
  function fly(fromRect, card) {
    const bar = document.getElementById("cartBar");
    const target = document.getElementById("cartBarCount") || bar;
    if (!enabled()) return;
    if (
      reduced() ||
      !fromRect ||
      !document.body.animate ||
      !bar ||
      !bar.classList.contains("show") ||
      flying >= MAX_FLYING
    ) {
      bump();
      return;
    }

    const size = 42;
    const to = target.getBoundingClientRect();
    const sx = fromRect.left + fromRect.width / 2 - size / 2;
    const sy = fromRect.top + fromRect.height / 2 - size / 2;
    const ex = to.left + Math.min(to.width, 60) / 2 - size / 2;
    const ey = to.top + to.height / 2 - size / 2;
    const mx = (sx + ex) / 2;
    const my = Math.min(sy, ey) - 70; // the arc's peak

    const ghost = document.createElement("div");
    ghost.className = "fx-fly";
    const img = card && card.querySelector(".product-media-frame img");
    if (img && img.complete && img.naturalWidth > 0) {
      ghost.style.backgroundImage = `url("${(img.currentSrc || img.src).replace(/"/g, "%22")}")`;
    }
    document.body.appendChild(ghost);
    flying += 1;

    const anim = ghost.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 1, offset: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(0.85)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.2)`, opacity: 0.9, offset: 1 },
      ],
      { duration: 620, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)", fill: "forwards" }
    );
    const done = () => {
      ghost.remove();
      flying = Math.max(0, flying - 1);
      bump();
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  /** The reverse of fly(): a bubble leaves the cart bar and flies back to the item's "-" button.
   *  Call it BEFORE the cart changes (the cart bar is still showing then). toRect: the tapped button's box. */
  function back(toRect, card) {
    const bar = document.getElementById("cartBar");
    const source = document.getElementById("cartBarCount") || bar;
    if (!enabled()) return;
    if (
      reduced() ||
      !toRect ||
      !document.body.animate ||
      !bar ||
      !bar.classList.contains("show") ||
      flying >= MAX_FLYING
    ) {
      bump();
      return;
    }
    const size = 42;
    const from = source.getBoundingClientRect();
    const sx = from.left + Math.min(from.width, 60) / 2 - size / 2;
    const sy = from.top + from.height / 2 - size / 2;
    const ex = toRect.left + toRect.width / 2 - size / 2;
    const ey = toRect.top + toRect.height / 2 - size / 2;
    const mx = (sx + ex) / 2;
    const my = Math.min(sy, ey) - 70; // the arc's peak

    const ghost = document.createElement("div");
    ghost.className = "fx-fly";
    const img = card && card.querySelector(".product-media-frame img");
    if (img && img.complete && img.naturalWidth > 0) {
      ghost.style.backgroundImage = `url("${(img.currentSrc || img.src).replace(/"/g, "%22")}")`;
    }
    document.body.appendChild(ghost);
    flying += 1;
    bump(); // the count changes right now

    const anim = ghost.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.3)`, opacity: 0.9, offset: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(0.85)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${ex}px, ${ey}px) scale(1)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.6)`, opacity: 0, offset: 1 },
      ],
      { duration: 620, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)", fill: "forwards" }
    );
    const done = () => {
      ghost.remove();
      flying = Math.max(0, flying - 1);
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  return { fly, back, bump };
})();
