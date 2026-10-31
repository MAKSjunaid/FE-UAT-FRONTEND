/* Customer "Cancel order": a small button on an order that is still open - ONLY while the shop allows it for that status and time
 * (the server decides: every order the page receives says canCancel / cancelSecs, and it checks everything again when cancelling).
 *
 * Tap it -> pick a short reason -> "Are you sure?" -> done. The order becomes Cancelled everywhere at once (the same
 * "freshcutz:orderstatus" event the admin's own status changes use, see profile.js).
 *
 * One 1-second timer serves every button on screen (it only runs while a button with a time limit is showing); a button
 * disappears by itself when its time is up. Nothing here runs, loads or asks the server unless the shop switched cancelling on.
 *
 * To undo this feature: restore the previous index.html, profile.js and the css files, and delete this file and css/order-cancel.css. */

window.OrderCancel = (() => {
  const NOTE_MAX = 80;
  const OTHER_TEXT = "✏️ Other";

  // The reasons and wording come from the shop (Customize > Customer cancellation): read once when the first Cancel button is
  // about to show, and again after a few minutes. Until then (or if it can't be read) these standard ones are used.
  let cfg = {
    reasons: ["🤔 Changed my mind", "🙈 Ordered by mistake"],
    sureTitle: "Your order is crying in the corner! 😢",
    sureText: "Are you sure you want to do this?",
    keepText: "No, keep it",
    yesText: "Yes, cancel",
    cancelledToast: "And just like that, the order story ended.",
    keptToast: "Phew! That was close! 😅",
    dodge: false, // "Yes, cancel" jumps away from the first two taps (set in Customize > Customer cancellation)
  };
  let cfgAt = 0;
  let cfgBusy = false;
  const CFG_FRESH_MS = 5 * 60 * 1000;

  let cfgFromStream = false;
  // the wording arrives on the live connection the page already has (see site-customize.js, "cancelui")
  window.addEventListener("freshcutz:cancelui", (e) => {
    const c = e.detail;
    if (c && Array.isArray(c.reasons)) { cfg = { ...cfg, ...c }; cfgFromStream = true; cfgAt = Date.now(); }
  });

  /** Only a fallback for when the live connection did not deliver the wording: it is asked for once, when a customer taps
   * Cancel (never on page load). Resolves at once when the wording is already held. */
  function loadCfg() {
    if (cfgFromStream || cfgBusy || Date.now() - cfgAt < CFG_FRESH_MS || typeof Api === "undefined") return Promise.resolve();
    cfgBusy = true;
    cfgAt = Date.now(); // (a failed read is not retried for a few minutes either)
    return Api.get("/api/store/cancel-ui")
      .then((c) => { if (c && Array.isArray(c.reasons)) cfg = { ...cfg, ...c }; })
      .catch(() => { /* the standard wording stays */ })
      .finally(() => { cfgBusy = false; });
  }

  let timer = 0;
  let idleTicks = 0;
  let sheet = null; // the open reason / confirm sheet: { el, code, close }

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));

  // ---- what the page knows about an order ---------------------------------------------------------

  /** Orders that just arrived from the server: the seconds left become a clock time on this phone. */
  function stamp(list) {
    const now = Date.now();
    (Array.isArray(list) ? list : [list]).forEach((o) => {
      if (!o) return;
      if (o.canCancel && o.cancelSecs > 0) o.cancelBy = now + o.cancelSecs * 1000;
      else delete o.cancelBy; // (no limit, or cannot cancel)
    });
  }

  /** The order's status changed (a live message from the server): what it says about cancelling replaces what was held. */
  function apply(order, msg) {
    if (!order) return;
    order.canCancel = !!(msg && msg.canCancel);
    order.cancelSecs = msg && msg.cancelSecs > 0 ? msg.cancelSecs : undefined;
    stamp(order);
  }

  /** Whether the Cancel button shows for this order right now. */
  function can(order) {
    return !!order && order.canCancel === true && (order.status === "NEW" || order.status === "PACKED") &&
      (order.cancelBy == null || Date.now() < order.cancelBy);
  }

  // ---- the button -----------------------------------------------------------------------------------

  /** The button's markup for an order card ("" when it must not show). */
  function html(order) {
    if (!can(order)) return "";
    const limited = order.cancelBy != null;
    if (limited) startTimer();
    return `<button type="button" class="oc-btn" data-oc="${esc(order.orderCode)}"${limited ? ` data-by="${order.cancelBy}"` : ""}>` +
      `<span>✕&nbsp; Cancel order</span></button>`;
  }

  /** After a status change: the button goes when it no longer applies, and comes back when it applies again (a reopened order). */
  function settle(card, order) {
    if (!card) return;
    const btn = card.querySelector(".oc-btn");
    if (!can(order)) {
      if (btn) btn.remove();
    } else if (!btn) {
      const anchor = card.querySelector('[data-action="reorder"]');
      if (anchor) anchor.insertAdjacentHTML("afterend", html(order));
    }
  }

  function startTimer() {
    idleTicks = 0;
    if (!timer) timer = setInterval(tick, 1000);
  }

  function tick() {
    if (document.hidden) return;
    const buttons = document.querySelectorAll(".oc-btn[data-by]");
    if (!buttons.length) {
      if (++idleTicks > 3) { clearInterval(timer); timer = 0; } // nothing to count down: the timer stops itself
      return;
    }
    idleTicks = 0;
    const now = Date.now();
    buttons.forEach((b) => {
      const left = Number(b.dataset.by) - now;
      if (left <= 0) {
        const code = b.dataset.oc;
        b.remove(); // time is up: the button goes
        if (sheet && sheet.code === code) {
          sheet.close();
          notify("Time is up for cancelling this order", "info");
        }
        return;
      }
    });
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  // Where the order was cancelled from: the top edge of the "My Orders" sheet, or of the opened-out "Track order" panel.
  // The pop-up appears there (null = the top of the screen). Measured when the sheet opens, because a cancelled order
  // can make the panel fold away before the pop-up shows.
  let where = null;

  function whereFrom(btn) {
    const host = btn && btn.closest ? btn.closest(".trk-detail, .sheet") : null;
    if (!host) return null;
    const r = host.getBoundingClientRect();
    return r.width > 120 ? { top: r.top, left: r.left, width: r.width } : null;
  }

  /** The short pop-up ("Order cancelled", "Phew!..."): over the page it was triggered from, at its top, one at a time. */
  function notify(message, type) {
    document.querySelectorAll(".oc-toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = `oc-toast ${type || "info"}`;
    t.setAttribute("role", "status");
    t.textContent = message;
    if (where) {
      const w = Math.min(380, where.width - 24);
      t.style.width = w + "px";
      t.style.left = where.left + where.width / 2 + "px";
      t.style.top = Math.max(where.top + 12, 12) + "px";
    }
    document.body.appendChild(t);
    setTimeout(() => {
      t.classList.add("is-out");
      setTimeout(() => t.remove(), 260);
    }, 3600);
  }

  // ---- the sheet: reason, then "Are you sure?" ----------------------------------------------------------

  /** Pull the sheet down with a finger to close it: it follows the finger, and goes past ~90px (or with a quick flick); earlier, it springs back. */
  function swipeToClose(card, canDrag, onClose) {
    let y0 = 0, t0 = 0, dy = 0, on = false, tracking = false;
    card.addEventListener("touchstart", (e) => {
      tracking = false;
      if (!canDrag() || e.touches.length !== 1 || e.target.closest("textarea") || card.scrollTop > 1) return;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
      dy = 0;
      tracking = true;
      on = false;
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      if (!tracking) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 0) { if (on) card.style.transform = ""; return; }
      if (!on) { on = true; card.style.animation = "none"; card.style.transition = "none"; }
      if (e.cancelable) e.preventDefault();
      card.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    const end = () => {
      if (!tracking) return;
      tracking = false;
      if (!on) return;
      on = false;
      const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
      if (dy > 90 || (fast && dy > 30)) {
        card.style.transition = "transform 0.18s ease-in";
        card.style.transform = "translateY(110%)";
        onClose();
      } else {
        card.style.transition = "transform 0.2s var(--ease-out)";
        card.style.transform = "";
      }
    };
    card.addEventListener("touchend", end, { passive: true });
    card.addEventListener("touchcancel", end, { passive: true });
  }

  function open(code, btn) {
    if (sheet) return;
    where = whereFrom(btn);
    const P = window.ProfileSheet;
    const order = P && P.findOrder ? P.findOrder(code) : null;
    if (!can(order)) {
      notify("This order can't be cancelled any more", "info");
      document.querySelectorAll(`.oc-btn[data-oc="${CSS.escape(code)}"]`).forEach((b) => b.remove());
      return;
    }
    if (!cfgFromStream && Date.now() - cfgAt >= CFG_FRESH_MS && typeof Api !== "undefined") {
      loadCfg().then(() => open(code, btn)); // (no live connection gave the wording: ask once, then open)
      return;
    }
    const reasons = cfg.reasons.concat(OTHER_TEXT);
    const OTHER = reasons.length - 1;

    let pick = -1;
    const el = document.createElement("div");
    el.className = "oc-ov";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Cancel order");
    el.innerHTML = `
      <div class="oc-card" data-card="reason">
        <div class="oc-grab" aria-hidden="true"></div>
        <div class="oc-pane" data-pane="reason">
          <h3 class="oc-h">Why cancel?</h3>
          <div class="oc-reasons">
            ${reasons.map((text, i) => `<button type="button" class="oc-r" data-i="${i}">${esc(text)}</button>`).join("")}
          </div>
          <textarea class="oc-note" rows="2" maxlength="${NOTE_MAX}" placeholder="Tell us more (optional)" hidden></textarea>
          <div class="oc-actions oc-actions-sure">
            <button type="button" class="oc-b oc-keep oc-keep-hi">Keep order</button>
            <button type="button" class="oc-b oc-next" disabled>Continue</button>
          </div>
        </div>
      </div>
      <div class="oc-card" data-card="sure" hidden>
        <div class="oc-grab" aria-hidden="true"></div>
        <div class="oc-pane" data-pane="sure">
          <div class="oc-warn" aria-hidden="true">!</div>
          <h3 class="oc-h oc-center">${esc(cfg.sureTitle)}</h3>
          <p class="oc-p">${esc(cfg.sureText)}</p>
          <div class="oc-actions oc-actions-sure">
            <button type="button" class="oc-b oc-keep oc-keep-big">${esc(cfg.keepText)}</button>
            <div class="oc-go-slot"><button type="button" class="oc-b oc-go">${esc(cfg.yesText)}</button></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add("oc-open");

    const $ = (s) => el.querySelector(s);
    const cardReason = $('[data-card="reason"]');
    const cardSure = $('[data-card="sure"]');
    const note = $(".oc-note");
    const next = $(".oc-next");
    const go = $(".oc-go");
    let busy = false;
    let dodged = 0; // how many times "Yes, cancel" has jumped away from a tap

    /** "Yes, cancel" hops to another spot on the screen (never on top of the Keep button): the first two taps only move it. */
    function dodge() {
      const keep = $(".oc-keep-big").getBoundingClientRect();
      const r = go.getBoundingClientRect();
      const w = Math.min(r.width, 150);
      const h = r.height;
      if (!go.classList.contains("is-dodging")) {
        el.appendChild(go); // (out of the sheet, which is itself transformed: only the full-screen layer measures from the screen's corner)
        go.classList.add("is-dodging");
        Object.assign(go.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
        void go.offsetWidth; // (so the first hop starts from where the button was)
      }
      const vw = window.innerWidth, vh = window.innerHeight;
      let x = 0, y = 0;
      for (let i = 0; i < 40; i++) {
        x = 10 + Math.random() * Math.max(0, vw - w - 20);
        y = 70 + Math.random() * Math.max(0, vh - h - 90);
        const clear = x + w < keep.left - 10 || x > keep.right + 10 || y + h < keep.top - 10 || y > keep.bottom + 10;
        const moved = Math.abs(x - r.left) + Math.abs(y - r.top) > 220;
        if (clear && moved) break;
      }
      Object.assign(go.style, { left: x + "px", top: y + "px", width: w + "px" });
    }

    function close() {
      if (!sheet || sheet.el !== el) return;
      sheet = null;
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("oc-open");
      // slide the visible sheet back down and fade the dim layer (Web Animations: it works from wherever the sheet is right now)
      const MS = 260;
      const shown = el.querySelector(".oc-card:not([hidden])");
      const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (el.animate && !calm) {
        if (shown && !shown.style.transform) { // (a swipe has already sent it down by itself)
          const now = getComputedStyle(shown).transform;
          shown.style.animation = "none";
          shown.animate([{ transform: now === "none" ? "translateY(0)" : now }, { transform: "translateY(105%)" }],
            { duration: MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
        }
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MS, easing: "ease-in", fill: "forwards" });
        el.style.pointerEvents = "none";
        setTimeout(() => el.remove(), MS + 30);
      } else {
        el.remove();
      }
    }
    const onKey = (e) => { if (e.key === "Escape" && !busy) close(); };
    document.addEventListener("keydown", onKey);
    sheet = { el, code, close };
    swipeToClose(cardReason, () => !busy, close);
    swipeToClose(cardSure, () => !busy, close);
    $(".oc-keep-hi").focus({ preventScroll: true }); // (the safe answer is the highlighted one on this page too)

    el.addEventListener("click", async (e) => {
      // Everything that happens on this sheet stays on this sheet: a tap here must not reach the page behind it
      // (the Track order panel folds when something outside it is tapped).
      e.stopPropagation();
      if (busy) return;
      if (e.target.closest(".oc-keep")) {
        close();
        notify(cfg.keptToast, "info");
        return;
      }
      if (e.target === el) return close();
      const r = e.target.closest(".oc-r");
      if (r) {
        pick = Number(r.dataset.i);
        el.querySelectorAll(".oc-r").forEach((b) => b.classList.toggle("is-on", b === r));
        note.hidden = pick !== OTHER;
        if (pick === OTHER) note.focus({ preventScroll: true });
        next.disabled = false;
        return;
      }
      if (e.target.closest(".oc-next") && pick >= 0) {
        // the reason sheet slides down and "Are you sure?" rises from the bottom (the same movement the other sheets use)
        cardReason.style.animation = "none";
        cardReason.style.transition = "transform 0.22s ease-in";
        cardReason.style.transform = "translateY(105%)";
        setTimeout(() => {
          cardReason.hidden = true;
          cardSure.hidden = false;
          $(".oc-keep-big").focus({ preventScroll: true }); // (the safe answer is the highlighted one)
        }, 200);
        return;
      }
      if (e.target.closest(".oc-go") && pick >= 0) {
        if (cfg.dodge && dodged < 2) {
          dodged++;
          dodge();
          return;
        }
        busy = true;
        go.disabled = true;
        go.classList.add("is-busy");
        go.textContent = "Cancelling…";
        const typed = note.value.trim();
        const reason = reasons[pick] + (pick === OTHER && typed ? ` - ${typed}` : "");
        try {
          await Api.post(`/api/orders/${encodeURIComponent(code)}/cancel`, { phone: P.getSavedPhone(), reason });
          busy = false;
          close();
          // the order is Cancelled on this page at once (profile.js listens for this, as for the admin's own changes)
          window.dispatchEvent(new CustomEvent("freshcutz:orderstatus", { detail: { orderCode: code, status: "CANCELLED", deliveredAt: null } }));
          notify(cfg.cancelledToast, "success");
        } catch (err) {
          busy = false;
          const offline = /reach|interrupted|cancelled$/i.test(err.message || "");
          if (!offline) {
            // the shop's answer is final ("too late", "already delivered"): the button goes, and the page re-reads its orders
            window.dispatchEvent(new CustomEvent("freshcutz:orderstatus", { detail: { orderCode: code, status: (order && order.status) || "NEW", deliveredAt: null, refresh: true } }));
            close();
          } else {
            go.disabled = false;
            go.classList.remove("is-busy");
            go.textContent = cfg.yesText;
          }
          notify(err.message || "Could not cancel - please try again", "error");
        }
      }
    });
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".oc-btn");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    open(b.dataset.oc, b);
  });

  return { stamp, apply, can, html, settle };
})();
