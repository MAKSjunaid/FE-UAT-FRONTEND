/* Bottom menu for the customer website (phones; css/bottom-nav.css shows it only under 720px wide).
 *
 *   Help & support | Cart | Home | Orders | Account
 *
 *  - Home (selected when the site opens): back to the top of the shop.
 *  - Cart: the cart sheet. The number on the icon is how many items are in the cart (the same count the cart bar shows), and it
 *    is not shown for an empty cart.
 *  - Orders: My Orders only. Account: the name / address / sign out only (ProfileSheet.openOrders / openAccount; not signed in:
 *    the sign-in sheet opens first).
 *  - Help & support: a small sheet with a "Chat on WhatsApp" button (the number set in the admin's Customize tab).
 *  - Scrolling DOWN slides the menu out of view so the page has the full screen, scrolling UP (even a little) brings it back, and
 *    it is always shown near the top. It stays hidden while a sheet is open (html.sheet-open, set by checkout.js).
 *  - Track order strip: while the signed-in customer has an order that is not delivered or cancelled yet, one line sits just above
 *    the menu ("Track order" + the order's status, with a small progress line). Tapping it opens the strip out upwards, showing that order's
 *    steps and details in place (tap it again, tap elsewhere or scroll to fold it); with several orders they are swiped sideways
 *    (dots show which one). It follows the live status
 *    (ProfileSheet.activeOrders / the "freshcutz:track" event of profile.js) and goes when the order is delivered or cancelled.
 *  - The admin's own choices are respected: with the WhatsApp button switched off the Help tab is not shown, with the account
 *    button switched off the Orders and Account tabs are not shown.
 *
 * One passive scroll listener, throttled with requestAnimationFrame; it only reads window.scrollY and toggles one class. */
(() => {
  const root = document.documentElement;
  const body = document.body;
  if (!body || !window.CheckoutSheet) return;
  const CartRef = typeof Cart !== "undefined" ? Cart : null; // (Cart is a plain const of cart.js, not a window property)

  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const ICONS = {
    help: svg('<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19v.5a2.5 2.5 0 0 1-2.5 2.5H13"/>'),
    cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6"/>'),
    home: svg('<path d="M3.5 11 12 3.8 20.5 11"/><path d="M5.5 9.7V20h13V9.7"/><path d="M10 20v-5.5h4V20"/>'),
    orders: svg('<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-3-1.8-2 1.8-2-1.8-2 1.8-3-1.8V4.5a1 1 0 0 1 1-1Z" transform="translate(-1 0)"/><path d="M8.5 8.5h6M8.5 12h6"/>'),
    account: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  };

  const TABS = [
    { id: "help", label: "Help & support" },
    { id: "cart", label: "Cart" },
    { id: "home", label: "Home" },
    { id: "orders", label: "Orders" },
    { id: "account", label: "Account" },
  ];

  const nav = document.createElement("nav");
  nav.className = "bnav";
  nav.id = "bottomNav";
  nav.setAttribute("aria-label", "Main menu");
  nav.innerHTML = TABS.map((t) =>
    `<button type="button" class="bnav-item${t.id === "home" ? " is-active" : ""}" data-tab="${t.id}"${t.id === "home" ? ' aria-current="page"' : ""}>${ICONS[t.id]}<span class="bnav-label">${t.label.replace("&", "&amp;")}</span>${t.id === "cart" ? '<span class="bnav-badge" id="bnavBadge" hidden></span>' : ""}</button>`
  ).join("");
  body.appendChild(nav);
  root.classList.add("has-bnav");

  const tab = (id) => nav.querySelector(`[data-tab="${id}"]`);
  const badge = nav.querySelector("#bnavBadge");

  // ---- the Account tab: "Account" until a customer is signed in, then the customer's name -------------------------------
  // A name too long for the label keeps running through it from right to left, round and round (CSS .bnav-run). The name itself
  // is kept by profile.js (ProfileSheet.getName, the "freshcutz:name" event) - nothing is asked from the server here.
  function paintAccountLabel() {
    const btn = tab("account");
    const el = btn && btn.querySelector(".bnav-label");
    if (!el) return;
    const name = window.ProfileSheet && ProfileSheet.getName ? ProfileSheet.getName() : "";
    if (el.dataset.name === name && (name || el.textContent === "Account")) { fitAccountLabel(el); return; }
    el.dataset.name = name;
    el.classList.remove("is-run");
    if (!name) {
      el.classList.remove("is-name");
      el.textContent = "Account";
      btn.setAttribute("aria-label", "Account");
      return;
    }
    el.classList.add("is-name");
    el.textContent = name;
    btn.setAttribute("aria-label", "Account: " + name);
    fitAccountLabel(el);
  }
  function fitAccountLabel(el) {
    const name = el.dataset.name || "";
    if (!name) return;
    const running = el.classList.contains("is-run");
    if (running) { // (re-measure: back to the plain name first)
      el.classList.remove("is-run");
      el.textContent = name;
    }
    if (el.scrollWidth <= el.clientWidth + 1) return; // fits: stays as it is
    const gap = 22;
    const w = el.scrollWidth;
    const mk = (hide) => `<span${hide ? ' aria-hidden="true"' : ""}>${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
    el.innerHTML = `<span class="bnav-run" style="--run-dur:${Math.max(5, (w + gap) / 28).toFixed(1)}s">${mk(false)}${mk(true)}</span>`;
    el.classList.add("is-run");
  }
  paintAccountLabel();
  window.addEventListener("freshcutz:name", paintAccountLabel);
  window.addEventListener("freshcutz:who", paintAccountLabel);
  window.addEventListener("storage", paintAccountLabel);
  window.addEventListener("resize", () => { const el = tab("account") && tab("account").querySelector(".bnav-label"); if (el) fitAccountLabel(el); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const el = tab("account") && tab("account").querySelector(".bnav-label"); if (el) fitAccountLabel(el); });

  // ---- cart number -------------------------------------------------------------------------------------------
  let shown = 0;
  function paintBadge() {
    const n = CartRef ? CartRef.getLineCount() : 0;
    badge.hidden = n <= 0;
    badge.textContent = n > 9 ? "9+" : String(n);
    if (n > shown && n > 0) {
      badge.classList.remove("is-bump");
      void badge.offsetWidth; // (restart the little pop)
      badge.classList.add("is-bump");
    }
    shown = n;
  }
  if (CartRef) CartRef.onChange(paintBadge);
  paintBadge();

  // ---- what the admin switched off -----------------------------------------------------------------------------
  function syncAdminChoices() {
    const wa = document.getElementById("whatsappLink");
    const acct = document.getElementById("profileIconBtn");
    tab("help").hidden = !!(wa && wa.hidden);
    tab("orders").hidden = !!(acct && acct.hidden);
    tab("account").hidden = !!(acct && acct.hidden);
  }
  syncAdminChoices();
  if (window.MutationObserver) {
    const mo = new MutationObserver(() => { syncAdminChoices(); paintTrack(); }); // (paintTrack: the Track order strip also follows the account switch)
    ["whatsappLink", "profileIconBtn"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ["hidden"] });
    });
  }


  // ---- Track order strip ---------------------------------------------------------------------------------------
  // One slide per order on its way; with more than one, the customer swipes sideways (the next order slides in softly) and small
  // dots show which one is on screen. Tapping the strip opens it out upwards to show that order (ProfileSheet.trackDetailsHtml).
  const TRACK_PCT = { placed: 25, confirmed: 50, ready: 75 };
  const stageOf = (o) => (window.OrderStatus ? OrderStatus.stage(o.status, o.orderCode) : o.status === "PACKED" ? "ready" : "confirmed");
  const trk = document.createElement("div");
  trk.className = "trkbar";
  trk.id = "trackBar";
  trk.setAttribute("role", "region");
  trk.setAttribute("aria-label", "Your orders on their way");
  trk.hidden = true;
  body.appendChild(trk);
  // While the strip is opened out the page behind it is blurred. This layer takes the touch: a tap (or swipe) on it only folds the strip
  // back and goes no further, so nothing underneath is pressed.
  const veil = document.createElement("div");
  veil.className = "trk-veil";
  veil.id = "trackVeil";
  veil.setAttribute("aria-hidden", "true");
  body.appendChild(veil);
  let trkKey = "";
  let trkTimer = null;
  let trkCode = ""; // the order on screen (kept when the strip is drawn again, e.g. after a status change)
  let trkRO = null;
  // (for the "Delivered!" celebration further down; declared here because the strip is first drawn before that code is reached)
  const CELEB_KEY = "freshcutz_celebrated";
  const celebrated = () => { try { return JSON.parse(localStorage.getItem(CELEB_KEY) || "[]"); } catch (e) { return []; } };
  const markCelebrated = (code) => { try { localStorage.setItem(CELEB_KEY, JSON.stringify([code, ...celebrated().filter((c) => c !== code)].slice(0, 40))); } catch (e) {} };
  let wasActive = new Set(); // the orders the strip was showing the last time it was drawn
  let celebEl = null;
  let celebTimer = 0;

  const escT = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const trkWords = (o) => (window.ProfileSheet && ProfileSheet.trackText ? ProfileSheet.trackText(o.status, o.orderCode) : String(o.status || ""));
  const CUBE = svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>');

  function slideHtml(o, n, total) {
    const stage = stageOf(o);
    const pct = TRACK_PCT[stage] || 25;
    const detail = window.ProfileSheet && ProfileSheet.trackDetailsHtml ? ProfileSheet.trackDetailsHtml(o) : "";
    return `<div class="trk-slide is-${stage}" data-code="${escT(o.orderCode)}">` +
      `<button type="button" class="trk-head" aria-expanded="false" aria-label="Track your order: ${escT(trkWords(o))}">` +
      `<span class="trk-ico" aria-hidden="true">${CUBE}</span>` +
      `<span class="trk-txt"><b class="trk-title">Track order</b><span class="trk-status"><i class="trk-dot"></i>${escT(trkWords(o))}</span></span>` +
      (Number(o.totalAmount) > 0 ? `<span class="trk-total" aria-label="Order total ${escT(Utils.formatMoney(o.totalAmount))}"><small>Total</small><b>${escT(Utils.formatMoney(o.totalAmount))}</b></span>` : "") +
      (total > 1 ? `<span class="trk-count" aria-label="Order ${n + 1} of ${total}">${n + 1}/${total}</span>` : "") +
      `<span class="trk-go" aria-hidden="true">›</span>` +
      `<span class="trk-prog" aria-hidden="true"><i style="width:${pct}%"></i></span></button>` +
      `<div class="trk-detail"><div class="trk-detail-in">${detail}</div></div></div>`;
  }

  /** Opens the strip out upwards (the order's steps and details appear in it) or folds it back. */
  let closingTimer = 0;
  let openingTimer = 0;
  function setOpen(open, keepInline) {
    open = !!open && !trk.hidden;
    if (open === trk.classList.contains("is-open")) return;
    // the panel is laid out at its full size at once and only slides (see .trk-detail in bottom-nav.css), so the size never jumps:
    // is-opening runs the rise, is-closing keeps the panel in place while it sinks (and the bar see-through: the row is as tall as the
    // tallest order, so a dark bar would show above a shorter one)
    if (!keepInline) trk.querySelectorAll(".trk-detail").forEach((d) => d.style.removeProperty("animation")); // (left there by a pull-down)
    clearTimeout(closingTimer);
    clearTimeout(openingTimer);
    trk.classList.toggle("is-opening", open);
    trk.classList.toggle("is-closing", !open);
    if (open) openingTimer = setTimeout(() => trk.classList.remove("is-opening"), 420);
    else closingTimer = setTimeout(() => trk.classList.remove("is-closing"), 400);
    trk.classList.toggle("is-open", open);
    root.classList.toggle("has-track-open", open);
    // The "Thank you for uploading" note is shown once, while the panel is open right after the upload: folding it away takes the note with it
    // (the next time the panel opens there is only the order, as the screenshot is already with us).
    if (!open) setTimeout(() => trk.querySelectorAll(".proof-box.is-done").forEach((el) => el.remove()), 450);
    trk.querySelectorAll(".trk-head").forEach((h) => h.setAttribute("aria-expanded", String(open)));
  }

  function scroller() { return trk.querySelector(".trk-scroll"); }
  function currentIndex() {
    const sc = scroller();
    return sc && sc.clientWidth ? Math.round(sc.scrollLeft / sc.clientWidth) : 0;
  }
  function paintDots() {
    const i = currentIndex();
    trk.querySelectorAll(".trk-dots i").forEach((d, n) => d.classList.toggle("is-cur", n === i));
    const slides = trk.querySelectorAll(".trk-slide");
    slides.forEach((sl, n) => sl.classList.toggle("is-cur", n === i)); // (the opened-out panel follows the order on screen)
    if (slides[i]) trkCode = slides[i].dataset.code;
  }

  function paintTrack() {
    const acctBtn = document.getElementById("profileIconBtn");
    const list = !(acctBtn && acctBtn.hidden) && window.ProfileSheet && ProfileSheet.activeOrders ? ProfileSheet.activeOrders() : [];
    clearTimeout(trkTimer);
    watchDelivered(list);
    if (!list.length) {
      trkKey = "";
      trkCode = "";
      trk.classList.remove("is-on", "is-open", "is-closing", "is-opening");
      root.classList.remove("has-track", "has-track-multi", "has-track-open");
      trkTimer = setTimeout(() => { trk.hidden = true; }, 300); // (after it has slid away)
      return;
    }
    const key = list.map((o) => `${o.orderCode}:${o.status}:${stageOf(o)}`).join("|");
    if (key !== trkKey) {
      trkKey = key;
      const multi = list.length > 1;
      trk.classList.toggle("is-multi", multi);
      trk.innerHTML = `<div class="trk-scroll">${list.map((o, i) => slideHtml(o, i, list.length)).join("")}</div>` +
        (multi ? `<div class="trk-dots" aria-hidden="true">${list.map(() => "<i></i>").join("")}</div>` : "");
      root.classList.toggle("has-track-multi", multi);
      const at = Math.max(0, list.findIndex((o) => o.orderCode === trkCode)); // (the order the customer was looking at stays on screen)
      const sc = scroller();
      trk.hidden = false;
      sc.scrollLeft = at * sc.clientWidth;
      paintDots();
      watchSlides(sc);
      if (trk.classList.contains("is-open")) trk.querySelectorAll(".trk-head").forEach((h) => h.setAttribute("aria-expanded", "true"));
    }
    const wasHidden = trk.hidden;
    trk.hidden = false;
    root.classList.add("has-track");
    if (wasHidden) void trk.offsetWidth; // (so it slides up instead of just appearing)
    requestAnimationFrame(() => trk.classList.add("is-on"));
  }

  /** The orders just move sideways, nothing else changes while they do (no fading, no growing or shrinking). Each order panel keeps
   * its own height, level with the "Track order" line at the bottom; the row is as tall as the tallest one, so none is cut off, and
   * what is left above a shorter panel is see-through. */
  function slideMotion() {
    const sc = scroller();
    if (!sc) return;
    sc.style.height = ""; // (the row is as tall as its tallest order by itself - no measuring, so nothing lags a frame behind the opening / folding panel)
  }

  function watchSlides(sc) {
    if (trkRO) { trkRO.disconnect(); trkRO = null; }
    sc.addEventListener("scroll", () => requestAnimationFrame(paintDots), { passive: true });
    slideMotion();
    if (window.ResizeObserver) { // (an order's panel opening or folding changes its height: the panel follows)
      trkRO = new ResizeObserver(slideMotion);
      sc.querySelectorAll(".trk-slide").forEach((el) => trkRO.observe(el));
    }
  }

  trk.addEventListener("click", (e) => {
    if (!e.target.closest(".trk-slide")) { // (the see-through part above a shorter order: a tap there folds the strip like a tap anywhere else)
      if (trk.classList.contains("is-open")) setOpen(false);
      return;
    }
    if (e.target.closest(".trk-head")) {
      setOpen(!trk.classList.contains("is-open"));
      return;
    }
    const re = e.target.closest('[data-action="reorder"]');
    if (re && window.ProfileSheet && ProfileSheet.reorderOrder) {
      const slide = re.closest(".trk-slide");
      if (slide) ProfileSheet.reorderOrder(slide.dataset.code);
    }
  });

  // ---- pull the opened-out order panel down with a finger to fold it ----------------------------------------------------------
  // The panel sinks back into the "Track order" line while the dark, blurred page behind it clears in step with the finger. Let go
  // past ~90px (or with a quick flick) and it folds; earlier and it springs back. Starts on the panel (while its own text is at the top)
  // or on the "Track order" line; a sideways swipe still goes to the next order.
  const VEIL_BLUR = 2; // (as .trk-veil in bottom-nav.css)
  const paintVeil = (f) => {
    const b = `blur(${(VEIL_BLUR * f).toFixed(2)}px)`;
    veil.style.opacity = String(f);
    veil.style.backdropFilter = b;
    veil.style.webkitBackdropFilter = b;
  };
  const clearVeil = () => ["transition", "opacity", "backdrop-filter", "-webkit-backdrop-filter"].forEach((k) => veil.style.removeProperty(k));
  (function pullToFold() {
    let st = "idle", y0 = 0, x0 = 0, dy = 0, h = 1, full = 1, v = 0, lastY = 0, lastT = 0, panel = null, arrow = null, head = null;
    trk.addEventListener("touchstart", (e) => {
      st = "idle";
      if (e.touches.length !== 1 || !trk.classList.contains("is-open") || trk.classList.contains("is-closing")) return;
      const slide = e.target.closest && e.target.closest(".trk-slide.is-cur, .trk-slide");
      if (!slide) return;
      const inner = e.target.closest(".trk-detail-in");
      if (inner && inner.scrollTop > 1) return; // (the panel's own text can still scroll up: that is a scroll)
      panel = slide.querySelector(".trk-detail");
      if (!panel) return;
      head = slide.querySelector(".trk-head");
      arrow = slide.querySelector(".trk-go"); // (the › on the "Track order" line turns with the panel while it is pulled)
      const t = e.touches[0];
      y0 = lastY = t.clientY; x0 = t.clientX; lastT = Date.now(); dy = 0; v = 0;
      full = (panel.getBoundingClientRect().height || 1) + 44; // (how far the panel must go down to be completely behind the "Track order" line)
      h = full * 0.8; // (the page behind is fully clear a little before the panel is all the way down)
      st = "pending";
    }, { passive: true });
    trk.addEventListener("touchmove", (e) => {
      if (st === "idle" || st === "done") return;
      const t = e.touches[0], ddy = t.clientY - y0, ddx = t.clientX - x0;
      if (st === "pending") {
        if (ddy < -4 || (Math.abs(ddx) > Math.abs(ddy) && Math.abs(ddx) > 8)) { st = "idle"; return; } // up / sideways: not ours
        if (ddy < 8) return;
        st = "drag";
        panel.style.animation = "none"; // (the rise / sink animation would hold the panel in place)
        panel.style.transition = "none";
        panel.style.willChange = "transform";
        veil.style.transition = "none";
        if (arrow) arrow.style.transition = "none";
        if (head) { head.style.animation = "none"; head.style.transition = "none"; head.style.borderRadius = "0px 0px 0 0"; }
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, ddy);
      const now = Date.now();
      if (now > lastT) v = (t.clientY - lastY) / (now - lastT);
      lastY = t.clientY; lastT = now;
      panel.style.transform = `translate3d(0, ${dy}px, 0)`;
      paintVeil(Math.max(0, 1 - dy / h));
      if (head) { // the line's top corners round off as the panel's top edge reaches it (and square again if the finger goes back up)
        const r = 14 * Math.min(1, Math.max(0, (dy - (full - 44 - 40)) / 40));
        head.style.borderRadius = `${r.toFixed(1)}px ${r.toFixed(1)}px 0 0`;
      }
      if (arrow) arrow.style.transform = `rotate(${(90 - 180 * Math.min(1, dy / full)).toFixed(1)}deg)`; // pointing down (open) ... pointing up (folded)
    }, { passive: false });
    const end = () => {
      if (st !== "drag") { st = "idle"; return; }
      st = "done";
      const pn = panel, f = Math.max(0, 1 - dy / h);
      const close = dy > 90 || (v > 0.45 && dy > 30);
      // the same soft in-and-out slide as tapping the line (0.3s), a touch longer when it has far to go - never the quick snap it was
      const ms = Math.round(300 + 60 * Math.min(1, Math.max(0, 1 - dy / full)));
      const ease = `${ms}ms cubic-bezier(0.4, 0, 0.6, 1)`;
      const vtr = `opacity ${ms}ms cubic-bezier(0.4, 0, 0.6, 1), backdrop-filter ${ms}ms ease, -webkit-backdrop-filter ${ms}ms ease`;
      const ar = arrow, hd = head;
      const tidy = () => {
        if (hd) ["animation", "transition", "border-radius"].forEach((k) => hd.style.removeProperty(k));
        if (ar) { ar.style.removeProperty("transition"); ar.style.removeProperty("transform"); }
        pn.style.removeProperty("transition"); pn.style.removeProperty("transform"); pn.style.removeProperty("will-change");
        clearVeil();
      };
      if (close) {
        // the panel sinks the rest of the way into the strip, the page behind clears completely; then it is folded for real
        if (ar) { ar.style.transition = `transform ${ease}`; ar.style.transform = "rotate(-90deg)"; }
        if (hd) { // the line's top corners finish rounding off as the panel goes the rest of the way in
          hd.style.transition = `border-radius ${Math.round(ms * 0.4)}ms ease-out ${Math.round(ms * 0.45)}ms`;
          hd.style.borderRadius = "14px 14px 0 0";
        }
        pn.style.transition = `transform ${ease}`;
        pn.style.transform = `translate3d(0, ${full + 4}px, 0)`; // (ALL the way down: none of it is left showing)
        veil.style.transition = vtr;
        paintVeil(0);
        setTimeout(() => { setOpen(false, true); setTimeout(tidy, 420); }, ms - 20);
      } else {
        if (ar) { ar.style.transition = "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)"; ar.style.transform = "rotate(90deg)"; }
        if (hd) { hd.style.transition = "border-radius 0.2s ease-out"; hd.style.borderRadius = "0px 0px 0 0"; }
        pn.style.transition = "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)";
        pn.style.transform = "translate3d(0, 0, 0)";
        veil.style.transition = "opacity 0.32s ease, backdrop-filter 0.32s ease, -webkit-backdrop-filter 0.32s ease";
        paintVeil(1);
        setTimeout(tidy, 360);
      }
    };
    trk.addEventListener("touchend", end, { passive: true });
    trk.addEventListener("touchcancel", end, { passive: true });
  })();

  // tapping anywhere else folds the strip - and only that
  veil.addEventListener("pointerup", () => setOpen(false));
  veil.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); });
  document.addEventListener("click", (e) => {
    if (trk.classList.contains("is-open") && !e.target.closest("#trackBar")) setOpen(false);
  });
  window.addEventListener("scroll", () => { if (trk.classList.contains("is-open")) setOpen(false); }, { passive: true });
  new MutationObserver(() => { if (root.classList.contains("sheet-real")) setOpen(false); }).observe(root, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("freshcutz:track", paintTrack);
  paintTrack();

  // ---- "Delivered!" celebration ------------------------------------------------------------------------------------
  // When an order the customer was following turns Delivered while the page is open, the Track order strip does not just vanish:
  // a small card rises above the menu (also when the strip is folded) with a tick, a thank-you and a short burst of gold confetti.
  // It shows once per order (remembered on this phone), stays about 9 seconds, and a tap closes it.

  function closeCelebration() {
    clearTimeout(celebTimer);
    const el = celebEl;
    celebEl = null;
    if (!el) return;
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 400);
  }

  function celebrate(code) {
    if (!window.matchMedia || !matchMedia("(max-width: 719px)").matches) return; // (the strip is a phone thing)
    if (celebrated().includes(code)) return;
    markCelebrated(code);
    closeCelebration();
    if (trk.classList.contains("is-open")) setOpen(false);
    const el = document.createElement("div");
    el.className = "celeb";
    el.setAttribute("role", "status");
    const bits = Array.from({ length: 26 }, (_, i) => {
      const x = Math.round(Math.random() * 100);
      const dx = Math.round((Math.random() - 0.5) * 90);
      const d = (0.9 + Math.random() * 1.3).toFixed(2);
      const delay = (Math.random() * 0.35).toFixed(2);
      const r = Math.round(Math.random() * 360);
      const col = ["#e9c968", "#c9a13b", "#a8801f", "#f0b429", "#3f9d63"][i % 5];
      return `<i style="left:${x}%;--dx:${dx}px;--r:${r}deg;background:${col};animation-duration:${d}s;animation-delay:${delay}s"></i>`;
    }).join("");
    el.innerHTML = `<div class="celeb-bits" aria-hidden="true">${bits}</div>` +
      `<span class="celeb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>` +
      `<span class="celeb-txt"><b>Delivered! 🎉</b><span>Enjoy your fresh order. Thank you for choosing us 🙏</span></span>` +
      `<button type="button" class="celeb-x" aria-label="Close">✕</button>`;
    body.appendChild(el);
    celebEl = el;
    // sit just above whatever is at the bottom: the Track order strip (when other orders are still on their way), else the menu
    const strip = !trk.hidden && !trk.classList.contains("is-open") && trk.classList.contains("is-on") ? trk : null;
    const ref = strip || document.getElementById("bottomNav");
    const rect = ref ? ref.getBoundingClientRect() : null;
    const above = rect && rect.height > 0 ? Math.max(10, innerHeight - rect.top + 10) : 14;
    el.style.bottom = `${Math.round(above)}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-in")));
    el.addEventListener("click", closeCelebration);
    celebTimer = setTimeout(closeCelebration, 9000);
  }

  /** Called every time the strip is drawn: an order that was on its way a moment ago and is Delivered now gets its celebration. */
  function watchDelivered(list) {
    const now = new Set(list.map((o) => o.orderCode));
    wasActive.forEach((code) => {
      if (now.has(code)) return;
      const o = window.ProfileSheet && ProfileSheet.findOrder ? ProfileSheet.findOrder(code) : null;
      if (o && o.status === "DELIVERED") celebrate(code);
    });
    wasActive = now;
  }

  // ---- Help & support ------------------------------------------------------------------------------------------
  function whatsappInfo() {
    const link = document.getElementById("whatsappLink");
    let digits = "";
    const m = link && /wa\.me\/(\d+)/.exec(link.getAttribute("href") || "");
    if (m) digits = m[1];
    if (!digits) digits = String(window.FRESHCUTZ_WHATSAPP || "").replace(/\D/g, "");
    return digits ? { href: `https://wa.me/${digits}`, text: `+${digits.replace(/^(\d{2})(\d{5})(\d+)$/, "$1 $2 $3")}` } : null;
  }
  function openHelp(onClose) {
    const wa = whatsappInfo();
    const waIcon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
    const pay = window.SiteCustomize ? SiteCustomize.payment() : { show: false };
    const heroEl = document.getElementById("heroText");
    const hero = heroEl && !heroEl.hidden ? (heroEl.textContent || "").trim() : "";
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const faq = (q, a) => `<details class="help-q"><summary>${q}</summary><div class="help-a">${a}</div></details>`;
    const html = `<div class="sheet-body help-sheet">
          <div class="help-hero">
            <div class="help-hero-ico" aria-hidden="true">💬</div>
            <div>
              <div class="help-hero-title">We're happy to help</div>
              <p>Questions about an order, delivery or payment? Message us on WhatsApp and we'll get back to you.</p>
            </div>
          </div>
          ${wa ? `<a class="btn btn-gold btn-block help-wa" href="${wa.href}" target="_blank" rel="noopener">${waIcon}<span>Chat on WhatsApp</span></a>` : ""}

          <div class="acct-card">
            <h3 class="acct-h">Quick answers</h3>
            ${faq("How do I place an order?", "Pick what you like and tap <b>View Cart</b>. Check your items, tap checkout, enter your name and address, choose how you'd like to pay and place the order.")}
            ${faq("How do I see my order status?", "Open <b>Orders</b> in the menu below. Each order shows its status as it moves from placed, to confirmed, to delivered.")}
            ${faq("When will my order arrive?", `${hero ? esc(hero) + " " : ""}After you order, we call you to confirm the delivery timing.`)}
            ${pay.show ? faq("How can I pay?", `You can choose <b>${esc(pay.cod)}</b> or <b>${esc(pay.upi)}</b> when you place the order.`) : ""}
            ${pay.show ? faq("I paid by UPI. What next?", "Upload a screenshot of your payment from the order confirmation screen, or from <b>Orders</b> in the menu. We'll check it and confirm your payment.") : ""}
            ${faq("How do I change my address?", "Open <b>Account</b> in the menu and tap <b>Update name &amp; address</b>.")}
            ${faq("Need to change or cancel an order?", "Message us on WhatsApp as soon as you can with your Order ID, and we'll do our best to help.")}
          </div>

          <div class="acct-card">
            <h3 class="acct-h">Good to know</h3>
            <p class="acct-p">Please keep your <b>Order ID</b> handy when you contact us. You can find it on the order confirmation and in <b>Orders</b>. It helps us find your order quickly.</p>
            <p class="acct-p">Thank you for ordering with us. 🙏</p>
          </div>
        </div>`;
    CheckoutSheet.renderSheet(html, "Help &amp; support");
    if (typeof onClose === "function" && window.ProfileSheet && ProfileSheet.returnOnClose) ProfileSheet.returnOnClose(onClose);
  }

  /** A friendly empty page (empty cart, no orders yet): a soft round picture, a title, the shop's own sentence, a "Start shopping"
   * button and three short reasons to order. {@code textHtml} must already be escaped. Used by checkout.js and profile.js. */
  function emptyHtml(icon, title, textHtml, withPerks = true) {
    return `<div class="empty-fancy">
        <div class="empty-art" aria-hidden="true"><span class="empty-art-emoji">${icon}</span></div>
        <h3 class="empty-title">${title}</h3>
        <p class="empty-text">${textHtml}</p>
        <button type="button" class="btn btn-gold empty-cta" data-role="start-shopping">Start shopping</button>
        ${withPerks ? `<ul class="empty-perks" aria-label="Why order from us"><li>🐔 Fresh, never frozen</li><li>🚚 Quick delivery</li><li>🧼 Hygienic packing</li></ul>` : ""}
      </div>`;
  }

  // "Start shopping": closes whatever sheet is open and goes to the products
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest('[data-role="start-shopping"]');
    if (!btn) return;
    CheckoutSheet.closeSheet();
    const cat = document.getElementById("catalog");
    if (cat) {
      const top = cat.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: Math.max(0, top), left: 0, behavior: "smooth" });
    }
  });

  window.BottomNav = { openHelp, emptyHtml };

  // ---- the tabs ------------------------------------------------------------------------------------------------
  function setActive(id) {
    nav.querySelectorAll(".bnav-item").forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".bnav-item");
    if (!b) return;
    switch (b.dataset.tab) {
      case "home":
        setActive("home");
        root.classList.remove("bnav-hidden");
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
        break;
      case "cart":
        CheckoutSheet.openCart();
        break;
      case "orders":
        if (window.ProfileSheet) ProfileSheet.openOrders();
        break;
      case "account":
        if (window.ProfileSheet) ProfileSheet.openAccount();
        break;
      case "help":
        openHelp();
        break;
    }
  });

  // ---- hide while scrolling down, show while scrolling up ----------------------------------------------------------
  const TOP_ZONE = 70;    // px from the top where the menu is always shown
  const HIDE_AFTER = 14;  // px of continuous downward scroll before it hides
  const SHOW_AFTER = 8;   // px of upward scroll before it shows again
  let lastY = Math.max(0, window.scrollY);
  let run = 0;            // + down, - up (resets when the direction changes)
  let hidden = false;
  let ticking = false;

  function setHidden(h) {
    if (h === hidden) return;
    hidden = h;
    footerMoving = performance.now() + 600;
    root.classList.toggle("bnav-hidden", h);
  }

  // Scrolls only count once the customer has touched / scrolled / pressed something, or a moment after the page finished loading
  // (the browser's own scroll back to the old place after a reload comes before that and must not hide the menu).
  let touched = false;
  const touch = () => { touched = true; };
  ["touchstart", "wheel", "keydown", "mousedown", "pointerdown"].forEach((t) => window.addEventListener(t, touch, { passive: true, once: true }));
  const armLater = () => setTimeout(touch, 3000);
  if (document.readyState === "complete") armLater();
  else window.addEventListener("load", armLater, { once: true });

  let lastH = document.documentElement.scrollHeight;
  let footerMoving = 0; // until when the footer's room is still moving after the menu slid (see css/bottom-nav.css)
  function onScroll() {
    ticking = false;
    // the page itself got shorter / taller (the footer's room follows the menu): the scroll that comes with it is not the customer's
    const h = document.documentElement.scrollHeight;
    const grew = h !== lastH;
    lastH = h;
    if (grew && performance.now() < footerMoving) { lastY = Math.max(0, window.scrollY); run = 0; return; }
    if (root.classList.contains("sheet-open")) { lastY = Math.max(0, window.scrollY); run = 0; return; }
    // a reload: the browser puts the page back where it was (a scroll the customer did not make) - the menu stays as it is
    if (!touched) { lastY = Math.max(0, window.scrollY); run = 0; return; }
    const y = Math.max(0, window.scrollY);
    const dy = y - lastY;
    lastY = y;
    if (y < TOP_ZONE) { run = 0; setHidden(false); return; }
    if (dy === 0) return;
    if ((dy > 0) !== (run > 0)) run = 0;
    run += dy;
    if (run > HIDE_AFTER) setHidden(true);
    else if (run < -SHOW_AFTER) setHidden(false);
  }

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  }, { passive: true });


  // ---- the "Fresh updates from FreshCutz" bar: pop-up messages float above it (css/bottom-nav.css reads --cn-gap) --------------------
  function syncCnGap() {
    const el = document.querySelector(".cn-bar, .cn-help");
    root.style.setProperty("--cn-gap", el ? `${Math.round(el.offsetHeight) + 8}px` : "0px");
  }
  new MutationObserver(syncCnGap).observe(document.body, { childList: true });
  window.addEventListener("resize", syncCnGap);
  syncCnGap();

  // a sheet closed: the menu comes back the way it was before the sheet opened (still minimised if it was minimised,
  // shown if it was shown - e.g. when the sheet was opened from the menu itself)
  let sheetWasOpen = root.classList.contains("sheet-real");
  new MutationObserver(() => {
    const open = root.classList.contains("sheet-real");
    if (sheetWasOpen && !open) { run = 0; lastY = Math.max(0, window.scrollY); }
    sheetWasOpen = open;
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
})();
