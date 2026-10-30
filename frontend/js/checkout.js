/* Cart sheet -> checkout (checkout-form.js) -> order success. Everything
 * renders into #sheetRoot so index.html stays a static skeleton.
 *
 * Exposes window.CheckoutSheet — the shared sheet shell (renderSheet/
 * closeSheet) and openSuccess — so checkout-form.js can render into the
 * same sheet without both files fighting over their own copies of it. */

(() => {
  const root = document.getElementById("sheetRoot");
  let currentView = null; // "cart" | "checkout" | "success" | null — which sheet is open right now

  // While any sheet (cart / checkout / success / My Account) is open, the page behind it must not scroll - and must not be
  // touched at all. (It used to be pinned with position:fixed and put back on close; that jump made the page and the header
  // flash on iPhones. Changing overflow on <html>/<body> is no better: it un-sticks the header.) So nothing about the page
  // is changed here: a swipe / wheel / key that is not inside the sheet's own scrolling part is simply ignored, and the
  // page stays exactly where it is, before, during and after.
  // Two things can hold the page still: a sheet (cart / checkout / success / My Account) and the big card lifted out of a row
  // ("maximized" item, site-specials.js). Either one is enough; the page is let go when neither is left.
  let sheetHold = false;
  let popHold = false;
  let attached = false;
  const SCROLLERS = ".sheet-body, .sp-pop-card, textarea";

  /** Can this element (or an enclosing scrolling part of the sheet / card) still scroll in this direction (1 = down, -1 = up)? */
  function scrollableFor(el, dir) {
    let n = el;
    while (n && n.closest) {
      const sc = n.closest(SCROLLERS);
      if (!sc) return false;
      const max = sc.scrollHeight - sc.clientHeight;
      if (max > 1 && (dir > 0 ? sc.scrollTop < max - 1 : sc.scrollTop > 1)) return true;
      n = sc.parentElement; // (this one is at its end: does the part around it still scroll? if not, the swipe must not reach the page)
    }
    return false;
  }

  let touchY = 0;
  function onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (t) touchY = t.clientY;
  }
  /** A swipe is let through only while the sheet's own scrolling part can still move that way. At its top / bottom end (or when
   * it does not scroll at all) the swipe is dropped, so the page behind never moves - not even by chaining past the end. */
  function blockTouch(e) {
    const t = e.touches && e.touches[0];
    if (!t || (e.target.closest && e.target.closest("select"))) return;
    const dy = t.clientY - touchY;
    if (dy === 0) return;
    if (!scrollableFor(e.target, dy < 0 ? 1 : -1)) e.preventDefault();
  }
  function blockWheel(e) {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0 || e.ctrlKey) return;
    if (!scrollableFor(e.target, e.deltaY > 0 ? 1 : -1)) e.preventDefault();
  }
  const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);
  function blockKeys(e) {
    if (!SCROLL_KEYS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (a && a.tagName === "BUTTON" && (e.key === " " || e.key === "Spacebar")) return; // Space presses the button
    const dir = (e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp" || (e.key === " " && e.shiftKey)) ? -1 : 1;
    if (a && scrollableFor(a, dir)) return; // the card/sheet itself can still scroll that way
    e.preventDefault();
  }

  /** Holds the page still while a sheet or the big card is up, lets it go when neither is. */
  function applyLock() {
    if (popHold && !root.querySelector(".sp-pop")) popHold = false; // (the big card is gone)
    const want = sheetHold || popHold;
    document.documentElement.classList.toggle("sheet-real", sheetHold); // a real sheet (cart, account...) is up, not only the big card: the bottom menu & co. slide away only for that (bottom-nav.css)
    if (want === attached) return;
    attached = want;
    document.documentElement.classList.toggle("sheet-open", want); // only a flag for other scripts (no style is attached to it)
    const on = want ? "addEventListener" : "removeEventListener";
    document[on]("touchstart", onTouchStart, { passive: true });
    document[on]("touchmove", blockTouch, { passive: false });
    document[on]("wheel", blockWheel, { passive: false });
    document[on]("keydown", blockKeys);
  }

  function lockPageScroll() {
    sheetHold = true; // (already held when the cart goes on to checkout: nothing more to do)
    applyLock();
  }

  function unlockPageScroll() {
    sheetHold = false;
    applyLock();
  }

  /** The big card lifted out of a row (site-specials.js) holds the page still too, with or without a sheet. */
  function holdScroll(on) {
    popHold = !!on;
    applyLock();
  }

  /** A form can ask before the sheet is closed with the ✕ / the dark area: fn(go) returns true when it took over (and calls go() later). */
  let leaveGuard = null;
  function setLeaveGuard(fn) { leaveGuard = fn || null; }

  function closeSheet() {
    currentView = null;
    leaveGuard = null;
    root.innerHTML = "";
    document.documentElement.style.removeProperty("--toast-sheet-gap");
    unlockPageScroll();
  }

  /** The ✕ / the dark area: the sheet slides back down (right, on wide screens) the way it came up, then it is closed for
   * real. (closeSheet() itself stays instant - other code calls it while switching screens.) */
  let leaving = null;
  let dragFrom = 0; // px the sheet was already dragged down (pull-down to close): the slide-out goes on from there, not from the top
  let dragOpacity = 1;
  const BLUR_PX = 2; // (the dark area's own blur, see .overlay in components.css)
  /** The dark area behind the sheet: its darkness AND its blur both follow `f` (1 = sheet fully up, 0 = sheet gone). */
  function dim(overlay, f) {
    if (!overlay) return;
    const b = `blur(${(BLUR_PX * f).toFixed(2)}px)`;
    overlay.style.animation = "none"; // (its fade-in animation would hold the opacity at 1 and ignore the value set here)
    overlay.style.opacity = String(f);
    overlay.style.backdropFilter = b;
    overlay.style.webkitBackdropFilter = b;
  }
  function closeSheetSmooth(force) {
    if (force !== true && leaveGuard && leaveGuard(() => closeSheetSmooth(true))) { dragFrom = 0; return; }
    const from = dragFrom, op0 = dragOpacity;
    dragFrom = 0; dragOpacity = 1;
    const sheet = root.querySelector(".sheet");
    const overlay = root.querySelector(".overlay");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!sheet || !sheet.animate || reduce) return closeSheet();
    if (leaving) return;
    leaving = sheet;
    sheet.style.pointerEvents = "none";
    if (overlay) overlay.style.pointerEvents = "none";
    const wide = window.matchMedia && window.matchMedia("(min-width: 720px)").matches;
    const ms = 240;
    const opts = { duration: ms, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" };
    const a = sheet.animate([{ transform: wide ? "translate(0, 0)" : `translate(0, ${from}px)` }, { transform: wide ? "translate(100%, 0)" : "translate(0, 100%)" }], opts);
    if (overlay) overlay.animate([{ opacity: op0, backdropFilter: `blur(${BLUR_PX * op0}px)` }, { opacity: 0, backdropFilter: "blur(0px)" }], { duration: ms, easing: "ease-out", fill: "forwards" });
    const done = () => {
      if (leaving !== sheet) return;
      leaving = null;
      if (root.contains(sheet)) closeSheet(); // not when another screen was drawn meanwhile
    };
    a.onfinish = done;
    a.oncancel = done;
    setTimeout(done, ms + 200); // safety
  }

  // ---- pull the sheet down with a finger to close it (phones: the sheet comes up from the bottom) -----------------------------
  // It starts from the title bar, or from anywhere on the sheet while its content is scrolled to the very top. Not from the map,
  // an input box or a part that can still scroll up. Let go past ~110px (or with a quick flick) and the sheet slides out through the
  // same path as the ✕ (so a form's "leave without saving?" question still appears); let go earlier and it springs back.
  const NO_DRAG = "input, textarea, select, .dm-inline, .dm-map, .sp-pop-card, [data-nodrag]";
  function attachPullDown(sheet, overlay) {
    let y0 = 0, x0 = 0, t0 = 0, state = "idle", dy = 0, h = 1, lastY = 0, lastT = 0, v = 0;
    const phone = () => !(window.matchMedia && window.matchMedia("(min-width: 720px)").matches);
    sheet.addEventListener("touchstart", (e) => {
      state = "idle";
      if (e.touches.length !== 1 || leaving || !phone()) return;
      if (e.target.closest && e.target.closest(NO_DRAG)) return;
      if (scrollableFor(e.target, -1)) return; // (something here can still scroll up: that is a scroll, not a close)
      const t = e.touches[0];
      y0 = lastY = t.clientY; x0 = t.clientX; t0 = lastT = Date.now(); dy = 0; v = 0;
      h = sheet.getBoundingClientRect().height || 1;
      state = "pending";
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (state === "idle" || state === "done") return;
      const t = e.touches[0];
      const ddy = t.clientY - y0, ddx = t.clientX - x0;
      if (state === "pending") {
        if (ddy < -4 || (Math.abs(ddx) > Math.abs(ddy) && Math.abs(ddx) > 8)) { state = "idle"; return; } // up / sideways: not ours
        if (ddy < 8) return;
        state = "drag";
        sheet.style.animation = "none"; // (the entrance animation would hold the sheet in place otherwise)
        sheet.style.transition = "none";
        sheet.style.willChange = "transform";
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, ddy);
      const now = Date.now();
      if (now > lastT) v = (t.clientY - lastY) / (now - lastT);
      lastY = t.clientY; lastT = now;
      sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
      dim(overlay, Math.max(0, 1 - dy / h));
    }, { passive: false });
    const end = () => {
      if (state !== "drag") { state = "idle"; return; }
      state = "done";
      const close = dy > 110 || (v > 0.45 && dy > 36);
      if (close) {
        dragFrom = dy;
        dragOpacity = overlay ? Math.max(0, 1 - dy / h) : 1;
        closeSheetSmooth(); // (a leave guard may ask first: then the sheet springs back below)
        if (leaving === sheet) return;
      }
      sheet.style.transition = "transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)";
      sheet.style.transform = "translate3d(0, 0, 0)";
      if (overlay) { overlay.style.transition = "opacity 0.2s, backdrop-filter 0.2s, -webkit-backdrop-filter 0.2s"; dim(overlay, 1); }
      let cleaned = false;
      const clean = () => {
        if (cleaned) return;
        cleaned = true;
        ["transition", "transform", "willChange"].forEach((k) => sheet.style.removeProperty(k === "willChange" ? "will-change" : k));
        if (overlay) ["transition", "opacity", "backdrop-filter", "-webkit-backdrop-filter"].forEach((k) => overlay.style.removeProperty(k));
      };
      sheet.addEventListener("transitionend", clean, { once: true });
      setTimeout(clean, 320);
    };
    sheet.addEventListener("touchend", end, { passive: true });
    sheet.addEventListener("touchcancel", end, { passive: true });
  }

  function renderSheet(bodyHtml, title) {
    leaving = null;
    leaveGuard = null;
    // A toast from whatever the customer just did on the previous screen
    // (e.g. "added to cart") shouldn't still be sitting on top of this new
    // sheet a couple seconds later — every sheet (cart/checkout/success,
    // plus profile.js's, since they all call this same renderSheet) opens
    // clean instead of inheriting the last screen's toast.
    Toast.dismissAll();
    lockPageScroll();
    root.innerHTML = `
      <div class="overlay" data-role="overlay"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-header">
          <h2>${title}</h2>
          <button class="sheet-close" data-role="close" aria-label="Close">✕</button>
        </div>
        ${bodyHtml}
      </div>`;
    root.querySelector('[data-role="overlay"]').addEventListener("click", closeSheetSmooth);
    root.querySelector('[data-role="close"]').addEventListener("click", closeSheetSmooth);
    attachPullDown(root.querySelector(".sheet"), root.querySelector(".overlay"));

    // A toast shown while this sheet is up floats just above it (see
    // Toast.show()'s .toast-above-sheet toggle + the CSS var) — measured
    // now, with the sheet's real content (every cart item, etc.) already
    // in the DOM, so the gap matches how tall this sheet actually rendered
    // instead of a fixed guess.
    const sheetEl = root.querySelector(".sheet");
    document.documentElement.style.setProperty("--toast-sheet-gap", `${sheetEl.getBoundingClientRect().height + 14}px`);

    return root;
  }

  function cartItemHtml(item) {
    const img = Utils.mediumImageUrl(item.imageUrl);
    return `
    <div class="cart-item" data-key="${item.productId}:${item.variant}">
      <img src="${img}" alt="${Utils.escapeHtml(item.name)}" onerror="this.style.visibility='hidden'" />
      <div class="cart-item-main">
        <div class="cart-item-name">${Utils.escapeHtml(item.name)}</div>
        <div class="cart-item-variant">${Utils.escapeHtml(item.variantLabel)} · ${Utils.formatMoney(item.unitPrice)} each</div>
        <div class="cart-item-row">
          <div class="qty-stepper show" style="flex:0 0 auto;">
            <button data-action="dec">−</button>
            <span class="qty-value">${item.quantity}</span>
            <button data-action="inc">+</button>
          </div>
          <span class="cart-item-price">${Utils.formatMoney(item.unitPrice * item.quantity)}</span>
        </div>
      </div>
      <button type="button" class="cart-item-delete" data-action="delete" aria-label="Remove ${Utils.escapeHtml(item.name)} from cart" title="Remove item">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
    </div>`;
  }

  /** Updates one cart-sheet row's qty/price plus the footer total in place,
   *  instead of re-rendering the whole sheet (which replayed the overlay/
   *  sheet entrance animation and caused a visible flash on every tap). */
  function patchCartRow(sheet, row, product, variant, productId = product && product.id) {
    const items = Cart.getItems();
    if (items.length === 0) {
      openCart(); // cart just became empty — layout changes entirely, full re-render is fine here
      return;
    }
    const qty = Cart.quantityOf(productId, variant);
    if (qty <= 0) {
      row.remove();
    } else {
      const unitPrice = variant === "variant2" ? product.variant2Price : product.variant1Price;
      row.querySelector(".qty-value").textContent = qty;
      row.querySelector(".cart-item-price").textContent = Utils.formatMoney(unitPrice * qty);
    }
    const totalEl = sheet.querySelector(".sheet-footer .summary-row.total span:last-child");
    if (totalEl) totalEl.textContent = Utils.formatMoney(Cart.getTotal());
  }

  function openCart() {
    currentView = "cart";
    const items = Cart.getItems();
    if (items.length === 0) {
      renderSheet(
        `<div class="sheet-body">${window.BottomNav ? BottomNav.emptyHtml("🛒", "Your cart is waiting", Utils.escapeHtml(SiteCustomize.t("cartEmptyText")), false) : `<div class="empty-state"><div class="icon">🛒</div><p>${Utils.escapeHtml(SiteCustomize.t("cartEmptyText"))}</p></div>`}</div>`,
        Utils.escapeHtml(SiteCustomize.t("cartTitle"))
      );
      return;
    }

    const body = `
      <div class="sheet-body">${items.map(cartItemHtml).join("")}</div>
      <div class="sheet-footer">
        <div class="summary-row total"><span>${SiteCustomize.html("totalLabel")}</span><span>${Utils.formatMoney(Cart.getTotal())}</span></div>
        <button class="btn btn-gold btn-block" style="margin-top:10px;" data-role="checkout-btn">${Utils.escapeHtml(SiteCustomize.t("checkoutButtonText"))}</button>
        <div style="text-align:center;margin-top:8px;">
          <button class="btn btn-ghost btn-sm" data-role="clear-btn">${SiteCustomize.html("clearCartText")}</button>
        </div>
      </div>`;

    const sheet = renderSheet(body, Utils.escapeHtml(SiteCustomize.t("cartTitle")));

    sheet.querySelector(".sheet-body").addEventListener("click", (e) => {
      const row = e.target.closest(".cart-item");
      if (!row) return;
      const [productId, variant] = row.dataset.key.split(":");
      // Trash icon: drop the whole line at once, whatever its quantity (and
      // even if the product has since left the catalog).
      if (e.target.closest('[data-action="delete"]')) {
        Cart.remove(Number(productId), variant);
        patchCartRow(sheet, row, null, variant, Number(productId));
        return;
      }
      const product = window.Storefront.getProduct(Number(productId));
      if (!product) return;
      const current = Cart.quantityOf(Number(productId), variant);
      let next = current;
      if (e.target.closest('[data-action="inc"]')) {
        next = current + 1;
      } else if (e.target.closest('[data-action="dec"]')) {
        next = current - 1;
      } else {
        return;
      }
      Cart.setQuantity(product, variant, next);
      patchCartRow(sheet, row, product, variant);
    });

    sheet.querySelector('[data-role="checkout-btn"]').addEventListener("click", openCheckout);
    sheet.querySelector('[data-role="clear-btn"]').addEventListener("click", () => {
      Cart.clear();
      openCart();
    });
  }

  function openCheckout() {
    if (window.StoreStatus && !window.StoreStatus.isOnline()) {
      currentView = "checkout";
      renderSheet(
        `<div class="sheet-body"><div class="empty-state"><div class="icon">🔴</div><p>${Utils.escapeHtml(SiteCustomize.t("offlineSheetText"))}</p></div></div>`,
        "Store Offline"
      );
      return;
    }
    currentView = "checkout";
    // Already logged in via the profile icon (profile.js)? Skip straight
    // to the final confirm-and-place-order screen instead of asking for
    // a name/phone we already have on file.
    const loggedInPhone = window.ProfileSheet && window.ProfileSheet.getSavedPhone();
    if (loggedInPhone) {
      window.CheckoutForm.openFinalStep(loggedInPhone);
    } else {
      window.CheckoutForm.open();
    }
  }

  /** What was actually ordered, so the customer has a record even if they
   * close this screen and never note down the order code — and something
   * worth screenshotting, since there's no order-lookup page for them to
   * come back to. */
  function orderSummaryHtml(order) {
    const rows = (order.items || [])
      .map(
        (i) => `<div class="summary-row">
          <span>${i.quantity} × ${Utils.escapeHtml(i.productName)} (${Utils.escapeHtml(i.variantLabel)})</span>
          <span>${Utils.formatMoney(i.lineTotal)}</span>
        </div>`
      )
      .join("");
    const slot = order.deliverySlot
      ? `<div class="order-notes"><span class="order-notes-label">${SiteCustomize.html("yourSlotLabel")}</span> ${Utils.escapeHtml(SlotTime.display(order.deliverySlot, order.status))}</div>`
      : "";
    const notes = order.notes
      ? `<div class="order-notes"><span class="order-notes-label">${SiteCustomize.html("yourNoteLabel")}</span> ${Utils.escapeHtml(order.notes)}</div>`
      : "";
    return `
      <div class="order-summary-list">
        ${rows}
        <div class="summary-row total"><span>${SiteCustomize.html("totalLabel")}</span><span>${Utils.formatMoney(order.totalAmount)}</span></div>
        ${slot}
        ${notes}
      </div>`;
  }

  function openSuccess(order) {
    currentView = "success";
    const body = `
      <div class="sheet-body">
        <div class="order-success">
          <div class="success-check"><svg class="success-tick" viewBox="0 0 52 52" aria-hidden="true"><path d="M14 27l8.5 8.5L38 18"/></svg><i class="spark" style="--r:0deg"></i><i class="spark" style="--r:45deg"></i><i class="spark" style="--r:90deg"></i><i class="spark" style="--r:135deg"></i><i class="spark" style="--r:180deg"></i><i class="spark" style="--r:225deg"></i><i class="spark" style="--r:270deg"></i><i class="spark" style="--r:315deg"></i><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">✓</span></div>
          <h2 class="anim-fade-up" style="animation-delay:120ms;">${Utils.escapeHtml(SiteCustomize.t("successTitle"))}</h2>
          ${SiteCustomize.on("showSuccessMessage") && SiteCustomize.t("successMessage") ? `<p class="anim-fade-up" style="animation-delay:180ms;color:var(--text-muted);margin-top:6px;">${Utils.escapeHtml(SiteCustomize.t("successMessage"))}</p>` : ""}
          <div class="order-id-chip anim-fade-up" style="animation-delay:240ms;">
            <span class="order-id-label">${SiteCustomize.html("orderIdLabel")}</span>
            <span class="order-id-value">${Utils.escapeHtml(order.orderCode)}</span>
          </div>
        </div>
        <div class="anim-fade-up" style="animation-delay:300ms;">${orderSummaryHtml(order)}</div>
        ${window.UpiPay && order.paymentMode === "UPI" ? `<div class="anim-fade-up" style="animation-delay:340ms;">${UpiPay.cardHtml(order)}</div>` : ""}
        <div class="cn-slot anim-fade-up" style="animation-delay:360ms;" data-role="notify-slot"></div>
        <button class="btn btn-dark btn-block anim-fade-up" style="animation-delay:420ms;margin-top:var(--sp-3);" data-role="continue">${SiteCustomize.html("continueShoppingText")}</button>
      </div>`;
    const sheet = renderSheet(body, "");
    // no title bar on this screen: only the ✕ stays, floating in the top-right corner (see .sheet-success in cart.css)
    sheet.querySelector(".sheet").classList.add("sheet-success");
    document.documentElement.style.setProperty("--toast-sheet-gap", `${sheet.querySelector(".sheet").getBoundingClientRect().height + 14}px`);
    sheet.querySelector('[data-role="continue"]').addEventListener("click", closeSheet);
    if (window.UpiPay) UpiPay.mountCard(sheet, order);
    // "Notify me when it's delivered" (button, or a quiet sign-up when notifications are already allowed)
    if (window.CustomerPush) CustomerPush.mount(sheet.querySelector('[data-role="notify-slot"]'), order);
  }

  // The header cart icon is gone (see profile.js) — the bottom cart-bar's
  // "View Cart" button, which already appears the moment something's
  // added, is the only entry point into the cart sheet now.
  document.getElementById("viewCartBtn").addEventListener("click", openCart);

  /** A price changed or a product got disabled from Admin while this
   * customer already had it in their cart — Cart.syncWithCatalog() (run on
   * every catalog load/poll in storefront.js) just dropped or corrected it.
   * Let them know, and if they're looking at the cart or mid-checkout,
   * refresh what they see so they're never confirming stale details. */
  Cart.onCatalogSync(({ removedNames }) => {
    removedNames.forEach((name) => Toast.msg("itemRemoved", { name }));
    if (currentView === "cart" || currentView === "checkout") {
      openCart();
    }
  });

  window.CheckoutSheet = { renderSheet, closeSheet, setLeaveGuard, openCart, openSuccess, holdScroll };
})();
