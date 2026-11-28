/* Typing in a sheet on a phone (used by the Edit order sheets, customer and admin).
 *
 * The problem: an iPhone's keyboard slides OVER the page without resizing it. If the box being typed in is under where the keyboard will be, Safari pans
 * the screen to reach it - the sheet's bars jump, the page behind shows, and anything that tries to follow that pan lags a frame behind it (jitter).
 *
 * The fix is to never let Safari need to pan: the sheet is NOT resized or moved at all. When a text box is tapped, the sheet's scrolling part is first
 * scrolled so that box sits near its top - well above where the keyboard comes up - and only then is the box focused. The scrolling part gets extra room
 * at its end while typing (so a box near the bottom can still be lifted), which eases away when the keyboard goes.
 *
 *   KbFit.avoid(root, scrollerOf)  watches `root`: a tap on a text box (or its label) lifts it first. scrollerOf(box) -> its scrolling element.
 *                                  Returns off().
 *   KbFit.focusLifted(box, scroller)  focus a box the same way from code (used right after a click).
 *   KbFit.dock(sheet, body)        (customer Edit order only) lifts the sheet's foot above the keyboard while a box is typed in. Returns off().
 *   KbFit.guard(root)              a touch that cannot scroll anything inside `root` is dropped, so the page behind never moves. Returns off().
 *   KbFit.lockPage()               holds the page itself still (position: fixed) until the returned function is called.
 */
window.KbFit = (function () {
  const TEXT = "textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]):not([type=hidden]):not([type=color])";
  const isText = (el) => !!el && !!el.matches && el.matches(TEXT);

  /** The text box a touch on `t` is meant for: the box itself, or the only box inside the label that was touched. */
  function boxFor(t) {
    if (!t || !t.closest) return null;
    if (isText(t)) return t;
    const label = t.closest("label");
    if (!label) return null;
    const boxes = label.querySelectorAll(TEXT);
    return boxes.length === 1 ? boxes[0] : null;
  }

  /** Where the top of the keyboard will be (px from the top of the screen): its real place when it is up, else a safe guess (it is ~45% of the screen). */
  function keyboardTop() {
    const vv = window.visualViewport;
    const full = window.innerHeight;
    if (vv && vv.height < full - 80) return vv.offsetTop + vv.height;
    return Math.round(full * 0.52);
  }

  /** How far to scroll so the box clears the keyboard (`limit` = the lowest y it may reach) - for a sheet that is not resized: only as far as that takes, or, if the
   * content ends sooner, until the content's end rests on the keyboard, so there is never an empty gap between the content and the keyboard. */
  function tightDelta(box, scroller, limit) {
    const c = scroller.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const want = Math.min(c.top + 52, limit - r.height);
    const ideal = r.top - Math.max(c.top + 4, want);
    const last = scroller.lastElementChild;
    if (!last) return ideal;
    const end = last.getBoundingClientRect().bottom; // (the content itself - not the empty padding under it - rests just above the keyboard)
    return Math.min(ideal, Math.max(r.bottom - limit, end - limit - 8));
  }

  /** Makes room at the end of the scroller and scrolls it so the box sits near the top of it. Instant (a glide would still be moving when the keyboard arrives). */
  function lift(box, scroller) {
    if (!box || !scroller) return;
    const tight = scroller.hasAttribute("data-kb-tight");
    if (!tight) scroller.style.removeProperty("--kb-pad"); // (full room again while a box is being lifted)
    else if (!scroller.style.getPropertyValue("--kb-pad")) scroller.style.setProperty("--kb-pad", "0px"); // (no extra room unless the lift itself needs it)
    scroller.classList.add("kb-pad");
    const c = scroller.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const limit = keyboardTop() - 14;
    if (r.bottom <= limit && r.top >= c.top + 4) return; // (already in the clear: nothing to move)
    const want = Math.min(c.top + 52, limit - r.height); // (a little of what is above it - the chosen reason - stays in view)
    let delta = r.top - Math.max(c.top + 4, want);
    if (tight && r.bottom > limit) {
      delta = tightDelta(box, scroller, limit);
      scroller.style.setProperty("--kb-pad", "0px");
      const room = scroller.scrollHeight - scroller.clientHeight; // (how far it can scroll with no extra room)
      const target = scroller.scrollTop + delta;
      scroller.style.setProperty("--kb-pad", Math.max(0, Math.ceil(target - room)) + "px"); // (just the extra room the lift itself needs)
    }
    scroller.scrollTop += delta;
  }

  function unpad(s) { s.classList.remove("kb-pad"); s.style.removeProperty("--kb-pad"); }

  /** Cuts the extra room at the end of the scroller down to what the current scroll position needs, so it can never be scrolled into an empty page. */
  function trim(scroller) {
    if (!scroller || !scroller.classList.contains("kb-pad")) return;
    const st = scroller.scrollTop;
    scroller.style.setProperty("--kb-pad", "0px");
    const natural = scroller.scrollHeight - scroller.clientHeight;
    const need = Math.max(0, Math.ceil(st - natural));
    scroller.style.setProperty("--kb-pad", need + "px");
    scroller.scrollTop = st;
  }

  function focusLifted(box, scroller) {
    if (!box) return;
    lift(box, scroller);
    try { box.focus({ preventScroll: true }); } catch (_) { box.focus(); }
  }

  function avoid(root, scrollerOf) {
    if (!root) return () => {};
    let box = null, x0 = 0, y0 = 0, moved = false, timer = 0;
    const pads = new Set();
    const scrollerFor = (b) => (scrollerOf ? scrollerOf(b) : null);

    const start = (e) => {
      const t = e.touches && e.touches[0];
      box = e.touches && e.touches.length === 1 ? boxFor(e.target) : null;
      if (t) { x0 = t.clientX; y0 = t.clientY; }
      moved = false;
    };
    const move = (e) => {
      const t = e.touches && e.touches[0];
      if (t && (Math.abs(t.clientX - x0) > 8 || Math.abs(t.clientY - y0) > 8)) moved = true;
    };
    const end = (e) => {
      const b = box;
      box = null;
      if (!b || moved || !e.cancelable || document.activeElement === b || b.disabled || b.readOnly) return;
      const sc = scrollerFor(b);
      if (!sc) return;
      e.preventDefault(); // (the tap would focus it where it is: lifted first, then focused here, in the same touch)
      pads.add(sc);
      focusLifted(b, sc);
    };
    const focusIn = (e) => {
      if (!isText(e.target)) return;
      clearTimeout(timer);
      const sc = scrollerFor(e.target);
      if (sc) { pads.add(sc); lift(e.target, sc); } // (reached another way - the keyboard's next / previous arrows, a script: still lifted)
    };
    const focusOut = (e) => {
      if (isText(e.relatedTarget)) return; // (going to another box: the keyboard stays)
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isText(document.activeElement)) return;
        pads.forEach(unpad);
        pads.clear();
      }, 120);
    };
    // the lift was made from a guess of the keyboard's height: once its real height is known, a tight sheet is eased to exactly the right place (a short glide)
    const vv = window.visualViewport;
    let tv = 0;
    const onVV = () => {
      clearTimeout(tv);
      tv = setTimeout(() => {
        const a = document.activeElement;
        if (!a || !isText(a) || !root.contains(a) || !(vv.height < window.innerHeight - 80)) return;
        const sc = scrollerFor(a);
        if (!sc || !sc.hasAttribute("data-kb-tight") || !sc.classList.contains("kb-pad")) return;
        const delta = tightDelta(a, sc, vv.offsetTop + vv.height - 14);
        if (Math.abs(delta) < 8) return;
        const top = Math.max(0, sc.scrollTop + delta);
        try { sc.scrollTo({ top, behavior: "smooth" }); } catch (_) { sc.scrollTop = top; }
        setTimeout(() => trim(sc), 420); // (then the extra room is cut to what that place needs)
      }, 160);
    };
    if (vv) vv.addEventListener("resize", onVV);
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: true });
    root.addEventListener("touchend", end, { passive: false });
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);
    return () => {
      clearTimeout(timer); clearTimeout(tv);
      if (vv) vv.removeEventListener("resize", onVV);
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
      pads.forEach(unpad);
      pads.clear();
    };
  }

  /** For a bottom sheet with a bill and an action button (the customer's Edit order): while a box in `body` is being typed in, the sheet slides up ONCE so it
   * rests on the keyboard, and the Update button becomes the last thing in the scrolling part (not a pinned bar), so the box and as much of the bill as
   * possible are in view and the button is one scroll away. It is set from a guess of the keyboard's height the moment the box is focused (one smooth
   * move with the keyboard) and corrected once the real height is known. Nothing runs per frame, and when the box loses focus the button goes back to its
   * bar, the sheet slides back and its content glides down to the very end. */
  function dock(sheet, body) {
    const vv = window.visualViewport;
    if (!vv || !sheet || !body) return () => {};
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)";
    document.body.appendChild(probe);
    let timer = 0, timer2 = 0, tEnd = 0, tDown = 0, docked = false;
    // while typing, the Update button is not a bar pinned under the content: it is the last thing IN the scrolling content, so the bill gets all the room above the keyboard
    const foot = sheet.querySelector(":scope > .sheet-footer");
    let inFlow = false;
    const flowFoot = (on) => {
      if (!foot || inFlow === on) return;
      inFlow = on;
      if (on) { body.appendChild(foot); sheet.classList.add("kb-flowfoot"); }
      else { body.insertAdjacentElement("afterend", foot); sheet.classList.remove("kb-flowfoot"); }
    };
    const safeTop = () => parseFloat(getComputedStyle(probe).paddingTop) || 0;
    const typed = () => { const a = document.activeElement; return a && body.contains(a) && isText(a) ? a : null; };
    const place = (kb) => {
      const full = window.innerHeight;
      const gap = Math.max(safeTop() + 14, Math.round(full * 0.1)); // (room above the sheet: the page still shows above it, and a notch / status bar is never touched)
      sheet.style.transition = "bottom .2s ease, max-height .2s ease";
      sheet.style.bottom = Math.max(0, Math.round(kb)) + "px";
      sheet.style.maxHeight = Math.max(240, Math.round(full - kb - gap)) + "px";
      docked = true;
      sheet.classList.add("kb-docked");
      flowFoot(true);
      clearTimeout(tEnd);
      tEnd = setTimeout(() => { const a = typed(); if (a) { keepInView(a, body, 8); trim(body); } }, 260); // (only if the box is not wholly in view yet)
    };
    const undock = () => {
      if (!docked) return;
      docked = false;
      clearTimeout(tEnd);
      flowFoot(false); // (the Update bar is back in its place before the sheet has slid down)
      // the keyboard is gone: once the sheet is down (and the extra room under the content has eased away) it glides to the very end, so the whole bill is in view
      clearTimeout(tDown);
      tDown = setTimeout(() => { if (!docked && !typed()) { try { body.scrollTo({ top: body.scrollHeight, behavior: "smooth" }); } catch (_) { body.scrollTop = body.scrollHeight; } } }, 420);
      setTimeout(() => { if (!docked) sheet.classList.remove("kb-docked"); }, 200);
      sheet.style.transition = "bottom .18s ease, max-height .18s ease";
      sheet.style.bottom = "";
      sheet.style.maxHeight = "";
      setTimeout(() => { if (!docked) sheet.style.transition = ""; }, 240);
    };
    const settle = () => {
      if (!typed()) return undock();
      const full = window.innerHeight;
      if (vv.height < full - 80) place(Math.max(0, full - vv.offsetTop - vv.height)); // (the keyboard is up: its real height)
      else if (!docked) place(full * 0.43); // (not up yet: a guess, so the sheet moves together with the keyboard)
    };
    const later = (ms) => { clearTimeout(timer); timer = setTimeout(settle, ms); };
    const onVV = () => later(140);
    const onIn = (e) => {
      if (!isText(e.target)) return;
      settle(); // (at once: the guess)
      clearTimeout(timer2);
      timer2 = setTimeout(settle, 450); // (and the real height, in case no resize message comes)
    };
    const onOut = (e) => {
      if (isText(e.relatedTarget)) return;
      later(40);
    };
    vv.addEventListener("resize", onVV);
    vv.addEventListener("scroll", onVV);
    body.addEventListener("focusin", onIn);
    body.addEventListener("focusout", onOut);
    return () => {
      clearTimeout(timer); clearTimeout(timer2); clearTimeout(tEnd); clearTimeout(tDown);
      vv.removeEventListener("resize", onVV);
      vv.removeEventListener("scroll", onVV);
      body.removeEventListener("focusin", onIn);
      body.removeEventListener("focusout", onOut);
      sheet.style.transition = ""; sheet.style.bottom = ""; sheet.style.maxHeight = ""; flowFoot(false); sheet.classList.remove("kb-docked");
      probe.remove();
    };
  }

  /** Scrolls `scroller` (only it) just enough for `el` to be wholly inside it. */
  function keepInView(el, scroller, pad) {
    if (!el || !scroller || !scroller.contains(el)) return;
    const p = pad == null ? 12 : pad;
    const c = scroller.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom > c.bottom - p) scroller.scrollTop += r.bottom - c.bottom + p;
    else if (r.top < c.top + p) scroller.scrollTop -= c.top - r.top + p;
  }

  function guard(root) {
    if (!root) return () => {};
    let y0 = 0, x0 = 0;
    const start = (e) => { const t = e.touches && e.touches[0]; if (t) { y0 = t.clientY; x0 = t.clientX; } };
    const canY = (n, dy) => {
      for (; n && n.nodeType === 1; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) {
          if (dy > 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true; // (it can still move that way)
        }
        if (n === root) break;
      }
      return false;
    };
    const canX = (n) => {
      for (; n && n.nodeType === 1; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 1) return true;
        if (n === root) break;
      }
      return false;
    };
    const move = (e) => {
      const t = e.touches && e.touches[0];
      if (!t || !e.cancelable) return;
      const dy = t.clientY - y0, dx = t.clientX - x0;
      if (Math.abs(dx) > Math.abs(dy)) { if (!canX(e.target)) e.preventDefault(); return; } // (sideways: only a sideways strip may take it)
      if (dy !== 0 && !canY(e.target, dy)) e.preventDefault();
    };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    return () => { root.removeEventListener("touchstart", start); root.removeEventListener("touchmove", move); };
  }

  /** Holds the page behind a full-screen sheet completely still (iOS scrolls it to reach a focused box even when it is "overflow: hidden"). */
  function lockPage() {
    if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return () => {}; // (a phone / tablet only)
    const b = document.body;
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;
    const keep = { position: b.style.position, top: b.style.top, left: b.style.left, right: b.style.right, width: b.style.width };
    b.style.position = "fixed";
    b.style.top = `-${y}px`;
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    return () => {
      b.style.position = keep.position;
      b.style.top = keep.top;
      b.style.left = keep.left;
      b.style.right = keep.right;
      b.style.width = keep.width;
      window.scrollTo(0, y);
    };
  }

  return { avoid, dock, keepInView, focusLifted, guard, lockPage, isText };
})();
