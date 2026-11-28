/* Customer "Edit order": a small button on an order that is still open - ONLY while the shop allows it for that status, time and number of edits
 * (the server decides: every order the page receives says canEdit / editSecs, and it checks everything again on every preview and save).
 *
 * Tap it -> the shop's usual slide-up sheet (pull it down to close): the items as in the cart (quantity, size, remove), "Add another item"
 * (the product cards as on the shop page), the delivery address as one line with "Change address" (the same address page as My Account), a
 * reason, and the new total (worked out by the server: delivery / other charges, offers, what was already paid) -> "Update My Order".
 * The order is then changed everywhere at once ("freshcutz:orderedit", handled by profile.js), and the shop is told.
 *
 * This file also draws what an edited order shows on its card: "Edited", the items the shop could not deliver (struck through, "Not delivered")
 * and any money still to settle (refund due / more to pay). Nothing here runs, loads or asks the server unless the shop switched editing on.
 *
 * To undo this feature: restore the previous index.html, profile.js and site-customize.js, and delete this file and css/order-edit.css. */

window.OrderEdit = (() => {
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const money = (v) => Utils.formatMoney(v == null ? 0 : v);
  const MAX_QTY = 50;
  const PREVIEW_WAIT = 250;

  // ---- the reasons (set by the shop in Customize > Edit orders) ---------------------------------------------------
  let reasons = ["🐔 Wrong size or quantity", "➕ Add or remove item", "📍 Address correction", "🙈 My finger ordered before my brain", "🤷 Even I don't know what happened", "🕵️ A fridge check just happened", "💸 Chasing that free delivery", "✍️ Other (It's a long story...)"];
  const OTHER_TEXT = "✏️ Other";
  const reasonList = () => (reasons.some((r) => /\bother\b/i.test(r)) ? reasons : reasons.concat(OTHER_TEXT));
  const isOther = () => E && E.reason >= 0 && E.reason === reasonList().length - 1;
  let uiAt = 0;
  let uiBusy = null;
  function loadUi() {
    if (uiBusy) return uiBusy;
    if (Date.now() - uiAt < 5 * 60 * 1000) return Promise.resolve();
    uiAt = Date.now();
    uiBusy = Api.get("/api/store/order-edit-ui")
      .then((c) => {
        const mine = c && Array.isArray(c.reasons) ? c.reasons.filter((r) => !/not available|out of stock|unavailable/i.test(r)) : [];
        if (mine.length) reasons = mine; // ("item not available" is the shop's reason, not the customer's)
      })
      .catch(() => { /* the standard ones stay */ })
      .finally(() => { uiBusy = null; });
    return uiBusy;
  }

  // ---- what the page knows about an order ------------------------------------------------------------------------

  /** Orders that just arrived from the server: the seconds left become a clock time on this phone. */
  function stamp(list) {
    const now = Date.now();
    (Array.isArray(list) ? list : [list]).forEach((o) => {
      if (!o) return;
      if (o.canEdit && o.editSecs > 0) o.editBy = now + o.editSecs * 1000;
      else delete o.editBy; // (no limit, or cannot edit)
    });
  }

  /** The order's status changed (a live message): what it says about editing replaces what was held. */
  function apply(order, msg) {
    if (!order) return;
    order.canEdit = !!(msg && msg.canEdit);
    order.editSecs = msg && msg.editSecs > 0 ? msg.editSecs : undefined;
    stamp(order);
  }

  function can(order) {
    return !!order && order.canEdit === true && (order.status === "NEW" || order.status === "PACKED") && (order.editBy == null || Date.now() < order.editBy);
  }

  // ---- on the order card -----------------------------------------------------------------------------------------

  const removedOf = (order) => (Array.isArray(order.removed) ? order.removed : []);
  // an item that is not on the order any more stays on it as a record: "not available" (the shop could not supply it: its price came off the bill)
  // or "removed" (taken off in an edit, by the customer or the shop). Older rows have no kind: not available.
  const naOf = (order) => removedOf(order).filter((r) => !r.kind || r.kind === "na");
  // an item still on the order whose quantity was changed: the quantity it had when the order was placed, struck through beside the new one
  const changedMap = (order) => {
    const m = new Map();
    removedOf(order).forEach((r) => { if (r.kind === "changed") m.set(`${r.productId}|${r.variant}`, r); });
    return m;
  };

  // a size swap (500 g -> 1 kg of the same product): the old size is gone from the order and another size of it is there. The swap is shown on ONE line
  // (old size / quantity / price struck through beside the new ones), so each item that took the place of a removed size gets that record.
  // Returns Map: index in order.items -> the record it replaced; the records used are in .used
  const swapMap = (order) => {
    const m = new Map(); m.used = new Set();
    const items = order.items || [], recs = removedOf(order);
    const has = (r) => items.some((i) => String(i.productId) === String(r.productId) && (i.variant || "variant1") === r.variant);
    const same = (i, r) => String(i.productId) === String(r.productId) && (i.variant || "variant1") === r.variant;
    items.forEach((it, idx) => {
      if (recs.some((r) => r.kind === "changed" && same(it, r))) return; // (that one is a quantity change on its own size)
      const r = recs.find((x) => x.kind === "removed" && !m.used.has(x) && String(x.productId) === String(it.productId) && !has(x));
      if (r) { m.set(idx, r); m.used.add(r); }
    });
    return m;
  };

  /** The items the shop could not deliver, as struck-through lines for the item list of an order (and of this sheet). ("" = none.)
   *  keepAll: also the removed sizes that swapMap shows beside their new size (the edit sheet has no such line). */
  function struckHtml(order, keepAll) {
    // (a size swap - the old size gone, another size of the same product on the order - says "Changed" rather than "Removed")
    const swapped = (r) => (order.items || []).some((i) => String(i.productId) === String(r.productId) && (i.variant || "variant1") !== r.variant);
    const used = keepAll ? new Set() : swapMap(order).used;
    return removedOf(order).filter((r) => r.kind !== "changed" && !used.has(r)).map((r) => `<div class="oec-na"><s>${esc(r.qty)} × ${esc(r.name)} (${esc(r.label)}) <span class="oec-nw">— ${money(r.lineTotal)}</span></s> <em>${r.kind === "removed" ? (swapped(r) ? "Changed" : "Removed") : "Not available"}</em></div>`).join("");
  }

  /** The small line in the "Items total" row of an order's bill: what was taken off for the items that could not be delivered. ("" = nothing was.) */
  function itemsNote(order) {
    const na = naOf(order);
    const less = na.reduce((n, r) => n + Number(r.lineTotal || 0), 0);
    return less > 0 ? `${money(less)} not charged - ${na.length === 1 ? "an item" : "items"} couldn't be delivered` : "";
  }

  /** One plain line under an order's Total: how much was taken off for the items that could not be delivered. ("" = nothing was.) */
  function lessHtml(order) {
    const removed = naOf(order);
    const less = removed.reduce((n, r) => n + Number(r.lineTotal || 0), 0);
    return less > 0 ? `<div class="oec-less">Your total doesn't include ${money(less)} for ${removed.length === 1 ? "the item" : "the items"} we couldn't deliver.</div>` : "";
  }

  /** The small "✏️ Edited" tag, put beside the time the order was placed (so it takes no line of its own). ("" = never edited.) */
  function editedHtml(order) {
    return order && order.edited ? `<span class="oec-tag">✏️ Edited</span>` : "";
  }

  /** The part of an order card about editing: the notes of an edited order, and the Edit button while it is allowed. ("" when there is nothing to say.) */
  /** The money notes of an edited order (refund due, already paid / still to pay, refunded before): put BELOW the order's Total by the page. */
  function payHtml(order, track) {
    if (!order) return "";
    const closed = order.status === "DELIVERED" || order.status === "CANCELLED"; // (delivered / cancelled: nothing is "still to pay" or "still to be refunded" any more - only the record of what was refunded stays)
    let h = "";
    if (closed) { /* no open money notes */ }
    else if (Number(order.refundDue) > 0) h += `<div class="oec-pay is-refund">↩ <b>${money(order.refundDue)}</b> will be refunded to you.</div>`;
    else if (Number(order.payLeft) > 0 && Number(order.paidSoFar) > 0) {
      // what is already paid and what is still to pay: two plain rows in a small card (the same sentence is the screen-reader label)
      const by = order.paymentMode === "UPI" ? "by UPI" : "on delivery";
      h += `<div class="oec-paycard" role="group" aria-label="You've already paid ${esc(money(order.paidSoFar))}. The other ${esc(money(order.payLeft))} is to be paid ${by}.">
        <span class="oec-pc-paid">✓ Paid <b>${money(order.paidSoFar)}</b></span><span class="oec-pc-due">💳 <b>${money(order.payLeft)}</b> to pay ${by}</span>
      </div>`;
    }
    else if (Number(order.payMore) > 0) h += `<div class="oec-pay is-more">💳 Please pay <b>${money(order.payMore)}</b> more${order.paymentMode === "UPI" ? " by UPI" : " on delivery"}.</div>`;
    if (Number(order.refunded) > 0) h += `<div class="oec-pay is-refund is-done">✓ <b>${money(order.refunded)}</b> was refunded to you.</div>`; // (a record: stays on the order)
    return h ? `<div class="oec-wrap oec-payw${track ? " is-track" : ""}">${h}</div>` : "";
  }

  /** The Edit button of an open order (while the shop allows it). */
  function cardHtml(order, track) {
    if (!order) return "";
    let h = "";
    if (can(order)) {
      const limited = order.editBy != null;
      if (limited) startTimer();
      h += `<button type="button" class="oec-btn" data-oec="${esc(order.orderCode)}"${limited ? ` data-by="${order.editBy}"` : ""}><span>✏️&nbsp; Edit order &amp; address</span>${limited ? `<em class="oec-left" data-oec-left>${leftText(order.editBy - Date.now())}</em>` : ""}</button>`;
    }
    return h ? `<div class="oec-wrap${track ? " is-track" : ""}">${h}</div>` : "";
  }

  function leftText(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
  }

  let timer = 0;
  let idle = 0;
  function startTimer() {
    idle = 0;
    if (!timer) timer = setInterval(tick, 1000);
  }
  function tick() {
    if (document.hidden) return;
    const buttons = document.querySelectorAll(".oec-btn[data-by]");
    if (!buttons.length) {
      if (++idle > 3) { clearInterval(timer); timer = 0; }
      return;
    }
    idle = 0;
    const now = Date.now();
    buttons.forEach((b) => {
      const left = Number(b.dataset.by) - now;
      if (left <= 0) {
        const code = b.dataset.oec;
        const wrap = b.parentElement;
        b.remove();
        if (wrap && wrap.classList.contains("oec-wrap") && !wrap.children.length) wrap.remove();
        if (E && E.code === code) { E.expired = true; paintFoot(); }
        return;
      }
      const t = b.querySelector("[data-oec-left]");
      if (t) t.textContent = leftText(left);
    });
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".oec-btn");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation(); // (a tap here must not fold the Track order panel)
    open(b.dataset.oec);
  });

  // ---- the sheet: the shop's own slide-up sheet (CheckoutSheet.renderSheet), so it looks and closes like the cart ---------------------------
  let E = null; // the edit that is open: { order, code, phone, rows, addr, reason, note, preview, ..., view: "main" | "add" | "addr" }

  const prodOf = (id) => { try { return window.CatalogStore ? CatalogStore.getProduct(id) : null; } catch (_) { return null; } };
  const sizesOf = (p) => {
    const out = [];
    if (p && p.variant1Label != null && p.variant1Price != null) out.push({ v: "variant1", label: p.variant1Label, price: Number(p.variant1Price) });
    if (p && p.variant2Label != null && p.variant2Price != null) out.push({ v: "variant2", label: p.variant2Label, price: Number(p.variant2Price) });
    return out;
  };
  const note = (msg, type) => { if (window.Toast) Toast.show(msg, type || "info"); };
  const sheetRoot = () => document.getElementById("sheetRoot");
  const $ = (sel) => { const r = sheetRoot(); return r ? r.querySelector(sel) : null; };
  const live = () => E.rows.filter((r) => !r.gone);
  const TRASH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  function open(code) {
    if (E && !$(".oec-flow")) { clearTimeout(E.timer); clearInterval(E.introTimer); E = null; } // (another sheet took its place: forget it)
    if (E) return;
    const P = window.ProfileSheet;
    const order = P && P.findOrder ? P.findOrder(code) : null;
    if (!can(order)) {
      note("This order can't be edited any more", "info");
      document.querySelectorAll(`.oec-btn[data-oec="${CSS.escape(code)}"]`).forEach((b) => b.remove());
      return;
    }
    const DM = window.DeliveryMap;
    const hasPin = order.deliveryLat != null && order.deliveryLng != null;
    E = {
      order,
      code,
      phone: P.getSavedPhone(),
      fromOrders: !!$(".profile-order-card"), // opened from My Orders: closing brings that page back
      rows: order.items.map((i) => ({
        productId: i.productId, name: i.productName, imageUrl: i.productImageUrl, label: i.variantLabel, variant: i.variant === "variant2" ? "variant2" : "variant1",
        origVariant: i.variant === "variant2" ? "variant2" : "variant1", origLabel: i.variantLabel, unit: Number(i.unitPrice), origUnit: Number(i.unitPrice),
        qty: i.quantity, origQty: i.quantity, orig: true, gone: false,
      })),
      addr: {
        flatNo: order.flatNo || "",
        full: order.addressLine || "",
        landmark: order.landmark || "",
        notes: order.notes || "",
        pin: hasPin && DM ? { deliveryLat: order.deliveryLat, deliveryLng: order.deliveryLng, deliveryArea: order.deliveryArea || "" } : null,
        changed: false, // the address page was used ("Use this address")
      },
      slot: undefined,
      reason: -1,
      note: "",
      preview: null,
      previewErr: "",
      previewing: false,
      busy: false,
      expired: false,
      seq: 0,
      timer: 0,
      introTimer: 0,
      pick: {}, // the size chosen on each product card of "Add another item"
      view: "main",
    };
    loadUi().then(() => { if (E && E.view === "main") paintReasons(); });
    showMain();
    // wake the server up while the customer is still looking at the sheet: the first real total then comes back quickly
    try {
      const cur = E;
      Api.post(`/api/orders/${encodeURIComponent(E.code)}/edit-warm`, { phone: E.phone })
        .then((w) => { if (E === cur && w && Number(w.needMore) > 0) { cur.need0 = Number(w.needMore); if (cur.view === "main") paintSum(); } })
        .catch(() => {});
    } catch (_) {}
  }

  /** The sheet's ✕ / dark area / pull-down: an unsaved change is asked about first. */
  function dirty() {
    if (!E) return false;
    return !!E.preview || E.rows.some((r) => r.gone || !r.orig || r.qty !== r.origQty || r.variant !== r.origVariant) || E.addr.changed || E.slot !== undefined;
  }

  function end() {
    if (!E) return;
    closeBig(true);
    unfit();
    clearTimeout(E.timer);
    clearInterval(E.introTimer);
    const back = E.fromOrders;
    E = null;
    if (back) setTimeout(() => { if (window.ProfileSheet && ProfileSheet.openOrders && !$(".oec-flow")) ProfileSheet.openOrders(); }, 330);
  }

  /** A sheet-leave question in the style of the "Cancel order" pop-up. */
  /** "Cancel your changes?" - asked when the customer leaves the sheet with something changed. */
  function askDiscard(go) {
    askBox({ title: "Cancel your changes?", html: `<p class="oc-p">Your order will stay as it is now.</p>`, yes: "Yes, cancel", no: "Keep editing", go });
  }

  /** "Update your order?" - asked when Update My Order is tapped (after the reason is chosen): the new total, and what is to be paid or refunded. */
  function askUpdate(p, go) {
    const pn = payNote(p);
    askBox({
      title: "Update your order?",
      html: `<p class="oc-p oc-p-tight">${Number(p.oldTotal) !== Number(p.total) ? "Your new total will be" : "Your total stays the same at"} <b>${money(p.total)}</b>.</p>${pn ? `<p class="oc-p oc-p-sub">${esc(pn)}</p>` : ""}`,
      yes: "Update & place",
      no: "Go back",
      go,
    });
  }

  /** The small slide-up question the shop uses everywhere (cancel an order, ...): a green "yes" and a plain "no"; a pull down, the dark area or
   * Escape is "no". It works in day and night mode (the shop's own dialog styles). */
  function askBox({ title, html, yes, no, go }) {
    const el = document.createElement("div");
    el.className = "oc-ov";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="oc-card"><div class="oc-grab" aria-hidden="true"></div><div class="oc-pane">
      <h3 class="oc-h oc-center">${esc(title)}</h3>
      ${html}
      <div class="oc-actions"><button type="button" class="oc-b oc-keep-hi oc-discard">${esc(yes)}</button><button type="button" class="oc-b oc-keep oc-stay">${esc(no)}</button></div></div></div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add("oc-open"); // (the page and the sheet behind do not scroll while this is up)
    const card = el.querySelector(".oc-card");
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    const shut = (after) => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("oc-open");
      el.remove();
      if (after) after();
    };
    document.addEventListener("keydown", onKey);
    el.addEventListener("touchmove", (e) => { if (!e.target.closest(".oc-card") && e.cancelable) e.preventDefault(); }, { passive: false });
    // pull the card down to close it (= keep editing): it follows the finger, goes on a long pull or a quick flick, else springs back
    let y0 = 0, t0 = 0, dy = 0, on = false;
    card.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) return; y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0; on = false; }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      dy = e.touches[0].clientY - y0;
      if (dy <= 0) { if (on) card.style.transform = ""; return; }
      if (!on) { on = true; card.style.animation = "none"; card.style.transition = "none"; }
      if (e.cancelable) e.preventDefault();
      card.style.transform = `translateY(${dy}px)`;
    }, { passive: false });
    const end = () => {
      if (!on) return;
      on = false;
      const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
      if (dy > 90 || (fast && dy > 30)) {
        card.style.transition = "transform 0.18s ease-in";
        card.style.transform = "translateY(110%)";
        setTimeout(() => shut(), 170);
      } else {
        card.style.transition = "transform 0.2s ease-out";
        card.style.transform = "";
      }
    };
    card.addEventListener("touchend", end, { passive: true });
    card.addEventListener("touchcancel", end, { passive: true });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest(".oc-discard")) shut(go);
      else if (e.target.closest(".oc-stay") || e.target === el) shut();
    });
  }

  function guardMain(go) {
    if (!E) return false;
    if (E.busy) return true; // (saving: ignore)
    const leave = () => { end(); go(); };
    if (dirty()) askDiscard(leave); else leave();
    return true;
  }

  // ---- screen 1: the edit page --------------------------------------------------------------------------------------
  function rowHtml(r, i, last) {
    const p = prodOf(r.productId);
    const sizes = r.orig ? sizesOf(p) : [];
    const img = Utils.mediumImageUrl(r.imageUrl || (p && p.imageUrl) || "");
    return `<div class="cart-item" data-i="${i}">
      <img src="${esc(img)}" alt="${esc(r.name)}" onerror="this.style.visibility='hidden'" />
      <div class="cart-item-main">
        <div class="cart-item-name">${esc(r.name)}${r.orig ? "" : ` <em class="oec-newtag">Added</em>`}</div>
        <div class="cart-item-variant oec-vline">${sizes.length > 1 ? `<span class="variant-toggle oec-vt">${sizes.map((z) => `<button type="button" data-sz="${z.v}" class="${z.v === r.variant ? "active" : ""}">${esc(z.label)}</button>`).join("")}</span>` : `<span>${esc(r.label)}</span>`}<span>· ${money(r.unit)} each</span></div>
        <div class="cart-item-row">
          <div class="qty-stepper show" style="flex:0 0 auto;"><button type="button" data-op="dec"${last && r.qty <= 1 ? ` class="oec-off" aria-disabled="true"` : ""}>−</button><span class="qty-value">${r.qty}</span><button type="button" data-op="inc">+</button></div>
          <span class="cart-item-price">${money(r.unit * r.qty)}</span>
        </div>
      </div>
      <button type="button" class="cart-item-delete${last ? " oec-off" : ""}" data-op="rm"${last ? ` aria-disabled="true"` : ""} aria-label="Remove ${esc(r.name)}" title="${last ? "An order needs at least one item" : "Remove item"}">${TRASH}</button>
    </div>`;
  }

  /** A + / − / size on one item: only that row's numbers change, nothing is drawn again. */
  function patchRow(el, r) {
    const q = el.querySelector(".qty-value");
    if (q) q.textContent = r.qty;
    const pr = el.querySelector(".cart-item-price");
    if (pr) pr.textContent = money(r.unit * r.qty);
    el.querySelectorAll("[data-sz]").forEach((b) => b.classList.toggle("active", b.dataset.sz === r.variant));
    const vl = el.querySelector(".oec-vline");
    if (vl && vl.lastElementChild) vl.lastElementChild.textContent = `· ${money(r.unit)} each`;
    const dec = el.querySelector('[data-op="dec"]');
    if (dec) {
      const off = live().length === 1 && r.qty <= 1;
      dec.classList.toggle("oec-off", off);
      if (off) dec.setAttribute("aria-disabled", "true"); else dec.removeAttribute("aria-disabled");
    }
  }

  const goneHtml = () => E.rows.map((r, i) => (r.gone ? `<div class="oec-gone"><s>${esc(r.name)} (${esc(r.label)}) × ${r.qty}</s><button type="button" class="oec-undo" data-undo="${i}">Undo</button></div>` : "")).join("");

  /** Only a button: the customer taps it when the address needs changing (the address page then shows everything). */
  function addrSummary() {
    const a = E.addr;
    if (!a.changed) return `<button type="button" class="btn btn-ghost btn-sm oec-addrbtn" data-do="addr">✏️ Change address</button>`;
    // changed: the new address itself is shown (with a small button to change it again)
    return `<div class="oec-addrcard">
      <div class="oec-addrhead"><b>New delivery address</b><button type="button" class="oec-addredit" data-do="addr">✏️ Change</button></div>
      <div class="oec-addrline">🏠 ${esc([a.flatNo, a.full].filter(Boolean).join(", "))}</div>
      ${a.landmark ? `<div class="oec-addrline">📍 ${esc(a.landmark)}</div>` : ""}
      ${a.notes ? `<div class="oec-addrline">📝 ${esc(a.notes)}</div>` : ""}
    </div>`;
  }

  // ---- the preferred delivery time: the one chosen when ordering is shown picked, and can be changed or taken off.
  // E.slot: undefined = not touched (nothing is sent), "" = taken off, text = the new time. Saved texts start with a day word
  // ("Tomorrow, 29 Oct · 9 AM – 10 AM") that moves on with the clock, so two times are the same when what follows the comma matches.
  const slotCfg = () => (window.SiteCustomize && SiteCustomize.deliverySlots ? SiteCustomize.deliverySlots() : { show: false });
  const slotNow = () => (E.slot === undefined ? (E.order.deliverySlot || "") : E.slot);
  const slotKey = (v) => { const m = /^(?:Today|Tomorrow|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (.+)$/.exec(v || ""); return m ? m[1] : String(v || ""); };
  const slotSame = (a, b) => !!a && !!b && slotKey(a) === slotKey(b);
  const slotPlan = (d) => (d.schedule && window.SlotTime ? SlotTime.plan(d.windows, d.notice) : []);

  function slotChipsHtml(d, plan) {
    const cur = slotNow();
    const chip = (value, text) => { const on = slotSame(value, cur); return `<button type="button" class="slot-chip${on ? " is-selected" : ""}" aria-pressed="${on}" data-slot="${esc(value)}">${esc(text)}</button>`; };
    // the time booked when ordering may no longer be among the offered ones (today's advance notice has passed): it stays as a chip of its own,
    // so it can be kept - or come back after another time was tried
    const orig = E.order.deliverySlot;
    const offered = plan.length ? plan.some((day) => day.slots.some((s) => slotSame(s.value, orig))) : (d.slots || []).some((s) => slotSame(s, orig));
    const booked = orig && !offered
      ? `<div class="slot-day-head"><b>Your booked time</b></div><div class="slot-row">${chip(orig, window.SlotTime ? SlotTime.display(orig, E.order.status) : orig)}</div>`
      : "";
    if (plan.length) {
      return booked + plan.map((day) => `<div class="slot-day-head"><b>${esc(day.name)}</b><span>${esc(day.date)}</span></div><div class="slot-row" role="group" aria-label="${esc(day.name)} ${esc(day.date)}">${day.slots.map((s) => chip(s.value, s.time)).join("")}</div>`).join("");
    }
    return booked + `<div class="slot-row" role="group">${(d.slots || []).map((s) => chip(s, s)).join("")}</div>`;
  }

  function slotPickedHtml() {
    const cur = slotNow();
    if (!cur) return E.order.deliverySlot ? `<span aria-hidden="true">🕗</span> <span>No preferred time any more</span>` : "";
    const t = window.SlotTime ? SlotTime.display(cur, E.slot === undefined ? E.order.status : "") : cur;
    return `<span aria-hidden="true">🕗</span> <span>Delivery time: <b>${esc(t)}</b></span>`;
  }

  function slotBoxHtml() {
    const d = slotCfg();
    if (!d.show) return E.order.deliverySlot ? `<div class="slot-panel oec-slotbox"><div class="slot-picked" data-slot-picked>${slotPickedHtml()}</div></div>` : "";
    const plan = slotPlan(d);
    return `<div class="field oec-slotfield" data-slotbox>
      <div class="oec-sec">${esc(d.label || "Preferred delivery time")}</div>
      <div class="slot-panel oec-slotbox"><div data-slot-body>${slotChipsHtml(d, plan)}</div><div class="slot-picked" data-slot-picked ${slotNow() || E.order.deliverySlot ? "" : "hidden"}>${slotPickedHtml()}</div></div>
    </div>`;
  }

  function paintSlot() {
    const d = slotCfg();
    const body = $("[data-slot-body]");
    if (body && d.show) body.innerHTML = slotChipsHtml(d, slotPlan(d));
    const el = $("[data-slot-picked]");
    if (el) { el.innerHTML = slotPickedHtml(); el.hidden = !el.innerHTML; }
  }

  function pickSlot(value) {
    const cur = slotNow();
    E.slot = slotSame(value, cur) ? "" : value; // (tapping the picked one again takes it off, as at checkout)
    if (E.slot && slotSame(E.slot, E.order.deliverySlot)) E.slot = undefined; // (back to what it was: nothing changed)
    if (E.slot === "" && !E.order.deliverySlot) E.slot = undefined;
    paintSlot();
    schedulePreview();
  }

  /** Before saving: a time that has moved out of the offered ones meanwhile (the clock) is dropped with a message, not sent. */
  function slotStillOk() {
    const d = slotCfg();
    if (E.slot === undefined || E.slot === "" || !d.show) return true;
    const plan = slotPlan(d);
    if (!plan.length || plan.some((day) => day.slots.some((s) => s.value === E.slot))) return true;
    E.slot = undefined;
    paintSlot();
    schedulePreview();
    note("That delivery time is no longer available. Please choose another.", "info");
    return false;
  }

  function showMain() {
    E.view = "main";
    closeBig(true);
    unfit();
    const o = E.order;
    const removedOld = removedOf(o).filter((r) => r.kind !== "changed");
    const body = `
      <div class="sheet-body oec-flow">
        <div data-addr>${addrSummary()}</div>
        <div class="oec-toperr" data-toperr role="alert" hidden></div>
        <div data-items class="oec-itemlist"></div>
        <div class="oec-hint" data-hint hidden></div>
        <div data-gone class="oec-gones"></div>
        ${removedOld.length ? `<div class="oec-nas">${struckHtml(o, true)}</div>` : ""}
        <button type="button" class="btn btn-ghost btn-sm oec-addbtn" data-do="add">＋ Add another item</button>
        ${slotBoxHtml()}
        <div class="field pay-field oec-reasonbox" data-reasonbox>
          <div class="oec-sec">Why are you changing it? <span class="oec-star" aria-hidden="true">*</span></div>
          <div class="oc-reasons" data-reasons></div>
          <textarea class="oc-note oec-note" data-note rows="2" maxlength="150" placeholder="Write your reason" aria-label="Your reason" hidden>${esc(E.note)}</textarea>
          <div class="error" data-reason-err></div>
        </div>
        <div class="order-summary-list oec-sum" data-sum></div>
      </div>
      <div class="sheet-footer">
        <button type="button" class="btn btn-gold btn-block" data-do="save" disabled>Update My Order</button>
      </div>`;
    const root = window.CheckoutSheet.renderSheet(body, "Edit order");
    root.querySelector(".sheet").classList.add("sheet-oe");
    window.CheckoutSheet.setLeaveGuard(guardMain);
    paintItems();
    paintReasons();
    paintSum();
    paintFoot();
    wireMain(root);
    fit(root, true);
  }

  /** Typing on a phone: the sheet is never resized or moved (that is what made it jump). A tapped text box is first scrolled up to near the top of the
   * sheet's body - above where the keyboard will come - and then focused (js/kb-fit.js). Used on every screen of this flow that has a text box. */
  let fitOff = null;
  function fit(root, dockFoot) {
    unfit();
    const sheet = root && root.querySelector ? root.querySelector(".sheet") : null;
    const body = sheet ? sheet.querySelector(".sheet-body") : null;
    if (!window.KbFit || !sheet || !body) return;
    const offA = KbFit.avoid(sheet, () => body);
    // the main screen has the bill and the Update button: while the reason box is typed in, the sheet rests on the keyboard so all of it stays in view
    const offD = dockFoot ? KbFit.dock(sheet, body) : null;
    fitOff = () => { offA(); if (offD) offD(); };
  }
  function unfit() { if (fitOff) { fitOff(); fitOff = null; } }

  function paintItems() {
    if (!E || E.view !== "main") return;
    const host = $("[data-items]");
    if (!host) return;
    const last = live().length === 1; // (the only item left cannot be taken off: an order needs at least one)
    host.innerHTML = E.rows.map((r, i) => (r.gone ? "" : rowHtml(r, i, last))).join("") || `<p class="oec-fine">No items left. Add one, or cancel the order instead.</p>`;
    paintGone();
  }

  /** The removed items (with Undo) are listed above only until the bill below shows them - there they carry "Removed" and their own Undo. */
  /** A problem with the change (the server's answer to the preview), in plain words. "This order is already paid (₹222)..." is the one
   * a customer meets most: the new total would be lower than what was already paid. */
  const paidErr = (m) => /already paid/i.exec(m || "") ? (/already paid\s*\(?(₹[\d,.]+)/i.exec(m) || [])[1] || "what you paid" : "";
  function errText(m) {
    const amt = paidErr(m);
    return amt ? `You've already paid ${amt}, so the new total can't be lower than that. To reduce it further, please contact us.` : m;
  }
  /** Shown above the items (right under the address button), where the customer is looking while changing things. */
  function paintTopErr() {
    const el = $("[data-toperr]");
    if (!el) return;
    const bad = E && !E.preview && !E.previewing && E.previewErr && E.previewErr !== "Nothing was changed";
    el.hidden = !bad;
    el.textContent = bad ? errText(E.previewErr) : "";
  }

  function paintGone() {
    const g = $("[data-gone]");
    // (only when there is no bill to show them in: the bill carries every removed item, with its own Undo)
    const noBill = E && !E.preview && !E.previewing && E.previewErr && E.previewErr !== "Nothing was changed";
    if (g) g.innerHTML = noBill ? goneHtml() : "";
  }

  function paintReasons() {
    if (!E || E.view !== "main") return;
    const host = $("[data-reasons]");
    if (!host) return;
    const list = reasonList();
    if (E.reason >= list.length) E.reason = -1;
    host.innerHTML = list.map((r, i) => `<button type="button" class="oc-r${E.reason === i ? " is-on" : ""}" data-r="${i}">${esc(r)}</button>`).join("");
    const note = $("[data-note]");
    if (note) note.hidden = !isOther();
  }

  function wireMain(root) {
    const flow = root.querySelector(".oec-flow");
    const foot = root.querySelector(".sheet-footer");
    const onClick = (e) => {
      e.stopPropagation(); // (a tap here must not reach the shop page behind the sheet)
      if (!E || E.busy) return;
      const act = e.target.closest("[data-do]");
      if (act) {
        const what = act.dataset.do;
        if (what === "add") return showAdd();
        if (what === "addr") return showAddr();
        if (what === "save") return save();
        return;
      }
      const sl = e.target.closest("[data-slotbox] .slot-chip");
      if (sl) return pickSlot(sl.dataset.slot);
      const r = e.target.closest("[data-r]");
      if (r) {
        E.reason = Number(r.dataset.r);
        paintReasons();
        paintFoot();
        clearReasonErr();
        if (isOther()) { const n = $("[data-note]"); if (n) { if (window.KbFit) KbFit.focusLifted(n, n.closest(".sheet-body")); else n.focus({ preventScroll: true }); } }
        return;
      }
      const undo = e.target.closest("[data-undo]");
      if (undo) { E.rows[Number(undo.dataset.undo)].gone = false; const h = $("[data-hint]"); if (h) h.hidden = true; paintItems(); schedulePreview(); return; }
      const rowEl = e.target.closest(".cart-item");
      if (!rowEl) return;
      const idx = Number(rowEl.dataset.i);
      const row = E.rows[idx];
      const op = e.target.closest("[data-op]");
      const sz = e.target.closest("[data-sz]");
      let whole = false; // (the list is drawn again only when an item goes; a + / − / size touches just its own row, so the others never flicker)
      if (op) {
        const w = op.dataset.op;
        if (w === "inc" && row.qty < MAX_QTY) row.qty++;
        else if (w === "dec") { if (row.qty > 1) row.qty--; else if (!removeRow(idx)) return; else whole = true; }
        else if (w === "rm") { if (!removeRow(idx)) return; whole = true; }
      } else if (sz) {
        const z = sizesOf(prodOf(row.productId)).find((x) => x.v === sz.dataset.sz);
        if (!z) return;
        row.variant = z.v;
        row.label = z.label;
        row.unit = z.v === row.origVariant ? row.origUnit : z.price;
      } else return;
      if (whole) paintItems(); else patchRow(rowEl, row);
      schedulePreview();
    };
    flow.addEventListener("click", onClick);
    foot.addEventListener("click", onClick);
    flow.addEventListener("input", (e) => { if (e.target.matches("[data-note]")) { E.note = e.target.value; if (E.note.trim()) clearReasonErr(); } });
  }

  /** Takes an item off the order - unless it is the last one (then it says why, and nothing changes). Returns whether it was taken off. */
  function removeRow(idx) {
    if (live().length <= 1) {
      const h = $("[data-hint]");
      if (h) {
        h.textContent = "An order needs at least one item. To drop all of it, cancel the order instead.";
        h.hidden = false;
        clearTimeout(E.hintTimer);
        E.hintTimer = setTimeout(() => { const x = $("[data-hint]"); if (x) x.hidden = true; }, 4000);
      }
      return false;
    }
    const r = E.rows[idx];
    if (r.orig) r.gone = true; else E.rows.splice(idx, 1);
    return true;
  }

  // ---- the new bill ---------------------------------------------------------------------------------------------------
  function clearReasonErr() {
    const box = $("[data-reasonbox]");
    if (!box) return;
    box.classList.remove("pay-attn");
    const er = box.querySelector("[data-reason-err]");
    if (er) er.textContent = "";
  }

  /** Save with no reason (or "Other" with nothing written): says so under the reasons, scrolls there and makes them blink once -
   * the same as Place Order does with no payment mode. Returns true when the reason is fine. */
  function reasonOk() {
    if (E.reason >= 0 && (!isOther() || E.note.trim())) return true;
    const box = $("[data-reasonbox]");
    if (!box) return false;
    box.querySelector("[data-reason-err]").textContent = E.reason < 0 ? "Please choose a reason" : "Please write your reason";
    const area = box.closest(".sheet-body") || box.parentElement;
    const top = area.scrollTop + (box.getBoundingClientRect().top - area.getBoundingClientRect().top) - Math.max(12, (area.clientHeight - box.offsetHeight) / 2);
    try { area.scrollTo({ top: Math.max(0, top), behavior: "smooth" }); } catch (_) { area.scrollTop = Math.max(0, top); }
    box.classList.remove("pay-attn");
    void box.offsetWidth; // (restarts the blink when tapped again)
    box.classList.add("pay-attn");
    if (E.reason >= 0) { const n = $("[data-note]"); if (n) n.focus({ preventScroll: true }); }
    return false;
  }

  function request() {
    const a = E.addr;
    const body = {
      phone: E.phone,
      items: live().map((r) => ({ productId: r.productId, variant: r.variant, quantity: r.qty })),
      flatNo: a.flatNo,
      addressLine: a.full,
      landmark: a.landmark,
      notes: a.notes,
      reason: E.reason >= 0 ? reasonList()[E.reason] : "",
      note: isOther() ? E.note.trim() : "",
    };
    if (a.changed && a.pin) Object.assign(body, a.pin);
    if (E.slot !== undefined) body.deliverySlot = E.slot;
    return body;
  }

  /** What the new total depends on (the items and the address - not the reason): two moments with the same text need no new answer. */
  function sigNow() {
    const r = request();
    return JSON.stringify([r.items, r.flatNo, r.addressLine, r.landmark, r.notes, r.deliveryLat, r.deliveryLng, r.clearPin, r.deliverySlot]);
  }
  function untouched() {
    return !E.addr.changed && E.slot === undefined && !E.rows.some((r) => r.gone || !r.orig || r.qty !== r.origQty || r.variant !== r.origVariant);
  }

  function schedulePreview() {
    if (!E) return;
    clearTimeout(E.timer);
    // coming back to the order, or putting things back as they were: nothing to ask the server - the answer is already known
    if (untouched()) {
      E.seq++; // (an answer still on its way is no longer wanted)
      E.sig = "";
      E.preview = null;
      E.previewErr = "Nothing was changed";
      E.previewing = false;
      paintSum();
      paintFoot();
      return;
    }
    if (E.sig && E.sig === sigNow() && (E.preview || E.previewErr)) {
      E.seq++;
      E.previewing = false;
      paintSum();
      paintFoot();
      return;
    }
    E.previewing = true;
    paintSum(); // (the items of the bill follow the change at once; the amounts are dimmed until the new total is in)
    const bill = $("[data-sum]");
    if (bill && E.preview) bill.classList.add("oec-stale"); // (the bill shown is the one before this change: dimmed until the new one arrives)
    paintFoot();
    E.timer = setTimeout(runPreview, PREVIEW_WAIT);
  }

  async function runPreview() {
    const cur = E;
    if (!cur) return;
    const seq = ++cur.seq;
    const sig = sigNow();
    try {
      const p = await Api.post(`/api/orders/${encodeURIComponent(cur.code)}/edit-preview`, request());
      if (E !== cur || seq !== cur.seq) return;
      cur.preview = p;
      cur.previewErr = "";
      cur.sig = sig;
    } catch (err) {
      if (E !== cur || seq !== cur.seq) return;
      cur.preview = null;
      cur.previewErr = err && err.message ? err.message : "Couldn't work out the total";
      cur.sig = sig;
    }
    cur.previewing = false;
    paintSum();
    paintFoot();
  }

  /** What was paid and what is still to pay - said plainly, and only about money the shop really holds. */
  function payNote(p) {
    const upi = E.order.paymentMode === "UPI";
    const paid = Number(p.paid || 0);
    if (p.payKind === "MORE") return `You've already paid ${money(paid)}. The other ${money(p.payAmount)} is to be paid${upi ? " by UPI" : " on delivery"}.`;
    if (p.payKind === "REFUND") return `You've already paid ${money(paid)}. ${money(p.payAmount)} will be refunded to you.`;
    if (paid > 0) return `You've already paid ${money(paid)} - nothing more to pay.`;
    return "";
  }

  /** The bill, drawn like the Final Step's items panel: each item, "Items total", the charges (struck-through when free), the green tip and
   * the Total - with the old total struck through beside the new one when it changed. */
  function paintSum() {
    if (!E || E.view !== "main") return;
    const host = $("[data-sum]");
    if (!host) return;
    host.classList.remove("oec-stale");
    paintGone();
    paintTopErr();
    const p = E.preview;
    const lines = E.rows.map((r, idx) => {
      const name = esc(r.name);
      if (r.gone) return `<div class="summary-row"><span><s>${r.origQty} × ${name} (${esc(r.origLabel || r.label)})</s> <em class="oec-t-rm">Removed</em> <button type="button" class="oec-undo oec-undo-sm" data-undo="${idx}">Undo</button></span><span><s>${money(r.origUnit * r.origQty)}</s></span></div>`;
      if (!r.orig) return `<div class="summary-row"><span>${r.qty} × ${name} (${esc(r.label)}) <em class="oec-t-add">Added</em></span><span>${money(r.unit * r.qty)}</span></div>`;
      const qtyChg = r.qty !== r.origQty;
      const sizeChg = r.variant !== r.origVariant;
      if (!qtyChg && !sizeChg) return `<div class="summary-row"><span>${r.qty} × ${name} (${esc(r.label)})</span><span>${money(r.unit * r.qty)}</span></div>`;
      const q = qtyChg ? `<s>${r.origQty}</s> <span class="oec-ch">${r.qty}</span>` : `${r.qty}`;
      const l = sizeChg ? `<s>${esc(r.origLabel)}</s> <span class="oec-ch">${esc(r.label)}</span>` : esc(r.label);
      return `<div class="summary-row"><span>${q} × ${name} (${l})</span><span><s>${money(r.origUnit * r.origQty)}</s> <span class="oec-ch">${money(r.unit * r.qty)}</span></span></div>`;
    }).join("");
    if (!p) {
      const bad = E.previewErr && E.previewErr !== "Nothing was changed";
      if (!bad && E.previewing && !untouched()) { // (the first total is still on its way: the items are shown at once, dimmed, with what changed marked)
        host.innerHTML = lines;
        host.classList.add("oec-stale");
        return;
      }
      // nothing changed yet: the same "Add ₹X more for free delivery" tip as the Final Step, for the order as it stands
      host.innerHTML = bad ? "" : untouched() && E.need0 > 0 ? `<div class="chg-nudge">🛵 Add <b>${money(E.need0)}</b> more for <b>free delivery</b></div>` : "";
      return;
    }
    const charges = p.charges || [];
    const rowOf = (l) => (window.Charges && Charges.rowHtml
      ? Charges.rowHtml({ key: l.key, label: l.label, note: l.note, amount: Math.round(Number(l.amount || 0) * 100), charged: Math.round(Number(l.charged || 0) * 100), free: !!l.free })
      : `<div class="summary-row"><span>${esc(l.label)}</span><span>${l.free ? `<s>${money(l.amount)}</s> FREE` : money(l.charged)}</span></div>`);
    const items = charges.length ? `<div class="chg-sep" aria-hidden="true"></div><div class="summary-row chg-items"><span>Items total</span><span>${money(p.itemsTotal)}</span></div>` : "";
    const free = charges.filter((l) => l.free && l.key !== "offer").map((l) => esc(l.label));
    let tip = "";
    if (Number(p.needMore) > 0) { // (delivery is charged, and a little more would make it free - the same tip as the cart)
      tip = `<div class="chg-nudge">🛵 Add <b>${money(p.needMore)}</b> more for <b>free delivery</b></div>`;
    } else if (free.length) {
      const names = free.length > 1 ? free.slice(0, -1).join(", ") + " and " + free[free.length - 1] : free[0];
      const plural = free.length > 1 || /[^s]s$/i.test(String(charges.find((l) => l.free && l.key !== "offer").label).trim());
      tip = `<div class="chg-nudge">🎉 <b>${names}</b> ${plural ? "are" : "is"} free on this order.</div>`;
    }
    const pn = payNote(p);
    const was = Number(p.oldTotal) !== Number(p.total) ? `<s class="oec-was">${money(p.oldTotal)}</s> ` : "";
    host.innerHTML = `${lines}${items}${charges.map(rowOf).join("")}${tip}
      <div class="summary-row total"><span>${Number(p.oldTotal) !== Number(p.total) ? "New Total" : "Total"}</span><span>${was}${money(p.total)}</span></div>
      ${p.rewardWarning ? `<p class="oec-fine">${esc(p.rewardWarning)}</p>` : ""}
      ${pn ? `<p class="oec-fine">${esc(pn)}</p>` : ""}`;
  }

  function paintFoot() {
    if (!E || E.view !== "main") return;
    const save = $('[data-do="save"]');
    if (!save) return;
    const p = E.preview;
    let why = "";
    if (E.expired) why = "The time to edit is over";
    else if (E.busy) why = "Saving…";
    else if (E.previewing) why = "Updating your total…";
    else if (!p) {
      if (!E.previewErr || E.previewErr === "Nothing was changed") why = "Change something to update";
      else why = paidErr(E.previewErr) ? `Total can't be below ${paidErr(E.previewErr)}` : "Please see the message above";
    }
    save.disabled = !!why;
    save.textContent = why || `Update My Order · ${money(p.total)}`;
  }

  function save() {
    const cur = E;
    if (!cur || cur.busy || !cur.preview || cur.expired) return;
    if (!slotStillOk()) return;
    if (!reasonOk()) return;
    askUpdate(cur.preview, () => doSave(cur)); // (nothing is sent until the customer says yes)
  }

  async function doSave(cur) {
    if (E !== cur || cur.busy || !cur.preview || cur.expired) return;
    cur.busy = true;
    paintFoot();
    try {
      const order = await Api.post(`/api/orders/${encodeURIComponent(cur.code)}/edit`, { ...request(), expectedTotal: cur.preview.total });
      stamp(order);
      window.dispatchEvent(new CustomEvent("freshcutz:orderedit", { detail: { order, local: true } }));
      const back = cur.fromOrders;
      unfit();
      clearTimeout(cur.timer);
      clearInterval(cur.introTimer);
      E = null;
      if (window.CheckoutSheet && CheckoutSheet.openSuccess) {
        // the "Order placed" page again, with the order as it is now; closing it opens the order in the Track order strip (as for a new order)
        CheckoutSheet.setLeaveGuard(null);
        CheckoutSheet.openSuccess(order, { title: "Order updated", message: "Your changes are saved. We'll prepare your order with them.", extraHtml: successExtra(order) });
      } else {
        if (back && window.ProfileSheet && ProfileSheet.openOrders) ProfileSheet.openOrders();
        else if (window.CheckoutSheet) { CheckoutSheet.setLeaveGuard(null); CheckoutSheet.closeSheet(); }
        note("Your order was updated", "success");
      }
    } catch (err) {
      cur.busy = false;
      cur.previewErr = err && err.message ? err.message : "Couldn't save";
      cur.preview = null;
      paintSum();
      paintFoot();
      if (/changed meanwhile/i.test(cur.previewErr)) { cur.sig = ""; schedulePreview(); }
    }
  }

  /** What the "Order updated" page tells besides the items and the total: what is still to pay / to be refunded, the items that could not be delivered, and where it goes. */
  function successExtra(order) {
    const where = [order.flatNo, order.addressLine].filter(Boolean).join(", ");
    const addr = where ? `<div class="order-notes oec-sx-addr"><span class="order-notes-label">Delivering to</span> ${esc(where)}${order.landmark ? ` · ${esc(order.landmark)}` : ""}</div>` : "";
    return `${payHtml(order)}${lessHtml(order)}${addr}`;
  }

  // ---- screen 2: the address (the same page as "Update name & address" in My Account) -----------------------------------
  function showAddr() {
    E.view = "addr";
    closeBig(true);
    unfit();
    const a = E.addr;
    const DM = window.DeliveryMap;
    const o = E.order;
    const prefill = { addressLine: a.full, deliveryLat: a.pin ? a.pin.deliveryLat : o.deliveryLat, deliveryLng: a.pin ? a.pin.deliveryLng : o.deliveryLng, deliveryArea: a.pin ? a.pin.deliveryArea : o.deliveryArea };
    const showLandmark = !!a.landmark || (window.SiteCustomize && SiteCustomize.on("showLandmarkField"));
    const body = `
      <form class="sheet-body acct-edit oec-flow" id="oecAddrForm" novalidate>
        <button type="button" class="acct-back" data-role="back">‹ Back</button>
        <div class="acct-card acct-edit-card addr-card">
          ${DM ? DM.pickerHtml(prefill) : ""}
          <div class="field">
            <label for="oec-flat">Flat / House no.</label>
            <input id="oec-flat" name="flatNo" required value="${esc(a.flatNo)}" />
            <div class="error" data-err="flatNo"></div>
          </div>
          <div class="field">
            <label for="oec-address" data-dm-addr-label>${DM ? DM.addrLabel(prefill) : "Building name / Address"}</label>
            <textarea id="oec-address" name="addressLine" rows="2" placeholder="${esc(DM ? DM.addrPlaceholder(prefill) : "")}">${esc(DM ? DM.buildingOf(prefill) : a.full)}</textarea>
            <div class="error" data-err="addressLine"></div>
          </div>
          ${showLandmark ? `<div class="field"><label for="oec-landmark">Landmark (optional)</label><input id="oec-landmark" name="landmark" value="${esc(a.landmark)}" /></div>` : ""}
          <div class="field"><label for="oec-notes">Note for the shop (optional)</label><textarea id="oec-notes" name="notes" rows="2" maxlength="300">${esc(a.notes)}</textarea></div>
        </div>
      </form>
      <div class="sheet-footer acct-edit-foot"><button type="button" class="btn btn-gold btn-block" data-do="use">Use this address</button></div>`;
    const root = window.CheckoutSheet.renderSheet(body, "Change delivery address");
    root.querySelector(".sheet").classList.add("sheet-addr");
    fit(root);
    if (DM) DM.wirePicker(root);
    const form = root.querySelector("#oecAddrForm");
    const label = () => "Use this address";
    const back = () => showMain();
    const guard = (go) => !!(DM && DM.guardLeave(form, label(), go));
    window.CheckoutSheet.setLeaveGuard((go) => { if (guard(back)) return true; back(); return true; });
    root.querySelector('[data-role="back"]').addEventListener("click", () => { if (!guard(back)) back(); });
    root.querySelector('[data-do="use"]').addEventListener("click", () => {
      const data = new FormData(form);
      root.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
      const err = {};
      if (!String(data.get("flatNo") || "").trim()) err.flatNo = SiteCustomize.text("errFlat");
      if (!String(data.get("addressLine") || "").trim()) err.addressLine = SiteCustomize.text("errAddress");
      else if (Utils.isJunkAddress && Utils.isJunkAddress(data.get("addressLine"))) err.addressLine = Utils.JUNK_ADDRESS_MESSAGE;
      if (Object.keys(err).length) {
        Object.entries(err).forEach(([k, m]) => { const el = root.querySelector(`[data-err="${k}"]`); if (el) el.textContent = m; });
        return;
      }
      a.flatNo = String(data.get("flatNo")).trim();
      a.full = DM ? DM.addressFrom(data) : String(data.get("addressLine")).trim();
      if (data.has("landmark")) a.landmark = String(data.get("landmark") || "").trim();
      a.notes = String(data.get("notes") || "").trim();
      const pin = DM ? DM.pinFrom(data) : {};
      a.pin = pin.deliveryLat != null ? pin : null;
      a.changed = true;
      showMain();
      schedulePreview();
    });
  }

  // ---- screen 3: "Add another item" - the shop page's own look: category chips, search, the product cards (tap one to open it big) --------
  const PAGE_CARDS = 12;
  let pop = null; // the big card that is open: { el, id, key }

  function cardQty(p, variant) {
    const r = E.rows.find((x) => !x.gone && x.productId === p.id && x.variant === variant);
    return r ? r.qty : 0;
  }

  function productCard(p) {
    const variant = E.pick[p.id] || "variant1";
    const has2 = !!p.variant2Label;
    const price = variant === "variant2" ? p.variant2Price : p.variant1Price;
    const mrp = variant === "variant2" ? p.variant2Mrp : p.variant1Mrp;
    const discount = Utils.discountPercent ? Utils.discountPercent(price, mrp) : 0;
    const saving = Utils.savingAmount ? Utils.savingAmount(price, mrp) : 0;
    const qty = cardQty(p, variant);
    const foot = p.outOfStock ? "" : `
      <button class="add-btn ${qty > 0 ? "hide" : ""}" data-action="add" aria-label="Add" title="Add"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <div class="qty-stepper ${qty > 0 ? "show" : ""}">
        <button data-action="dec" aria-label="Decrease"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
        <span class="qty-value">${qty}</span>
        <button data-action="inc" aria-label="Increase"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>`;
    return `<div class="product-card is-visible ${p.outOfStock ? "out-of-stock" : ""}" data-id="${p.id}">
      <div class="product-media">
        <div class="product-media-frame">
          <img src="${esc(Utils.mediumImageUrl(p.imageUrl))}" alt="${esc(p.name)}" loading="lazy" onerror="this.style.opacity=0" />
          <span class="discount-badge" ${discount > 0 && !p.outOfStock ? "" : "hidden"}>${discount}% OFF</span>
          <span class="out-of-stock-badge" ${p.outOfStock ? "" : "hidden"}>Out of stock</span>
        </div>
        <div class="product-footer">${foot}</div>
      </div>
      <div class="product-body">
        <div class="product-text"><div class="product-name">${esc(p.name)}</div><div class="product-desc">${esc(p.description || "")}</div></div>
        ${has2 ? `<div class="variant-toggle"><button data-action="variant" data-variant="variant1" class="${variant === "variant1" ? "active" : ""}">${esc(p.variant1Label)}</button><button data-action="variant" data-variant="variant2" class="${variant === "variant2" ? "active" : ""}">${esc(p.variant2Label)}</button></div>`
          : `<div class="variant-toggle"><button class="active" disabled>${esc(p.variant1Label)}</button></div>`}
        <div class="price-row"><span class="price-now">${money(price)}</span>${discount > 0 ? `<span class="price-mrp">${money(mrp)}</span>` : ""}${saving > 0 && !p.outOfStock ? `<span class="price-save">Save ${money(saving)}</span>` : ""}</div>
      </div>
    </div>`;
  }

  /** The big card (a tap on an item): the same one the shop page opens, but its buttons change THIS order, never the cart. */
  function bigHtml(p) {
    const v = E.pick[p.id] || "variant1";
    const price = v === "variant2" ? p.variant2Price : p.variant1Price;
    const mrp = v === "variant2" ? p.variant2Mrp : p.variant1Mrp;
    const off = Utils.discountPercent ? Utils.discountPercent(price, mrp) : 0;
    const saving = Utils.savingAmount ? Utils.savingAmount(price, mrp) : 0;
    const qty = cardQty(p, v);
    const two = !!p.variant2Label;
    const variants = two
      ? `<div class="sp-var" role="group" aria-label="Choose size"><button type="button" data-ox="variant" data-v="variant1" class="${v === "variant1" ? "on" : ""}">${esc(p.variant1Label)}</button><button type="button" data-ox="variant" data-v="variant2" class="${v === "variant2" ? "on" : ""}">${esc(p.variant2Label)}</button></div>`
      : p.variant1Label ? `<div class="sp-var"><button type="button" class="on" disabled>${esc(p.variant1Label)}</button></div>` : "";
    const foot = p.outOfStock ? `<button type="button" class="sp-soldout" disabled>Out of stock</button>`
      : `<button type="button" class="sp-add ${qty > 0 ? "hide" : ""}" data-ox="add" aria-label="Add" title="Add"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
         <div class="sp-step ${qty > 0 ? "show" : ""}"><button type="button" data-ox="dec" aria-label="Decrease"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button><span class="sp-qty">${qty}</span><button type="button" data-ox="inc" aria-label="Increase"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>`;
    return `<article class="sp-card sp-big ${p.outOfStock ? "sp-out" : ""}" data-id="${p.id}">
        <div class="sp-photo">
          <div class="sp-media"><img src="${esc(Utils.mediumImageUrl(p.imageUrl))}" alt="" draggable="false" onerror="this.style.opacity=0" /><span class="sp-off" ${off > 0 && !p.outOfStock ? "" : "hidden"}>${off}% OFF</span></div>
          <div class="sp-foot">${foot}</div>
        </div>
        <div class="sp-body">
          <div class="sp-name">${esc(p.name)}</div>
          ${p.description ? `<div class="sp-desc">${esc(p.description)}</div>` : ""}
          ${variants}
          <div class="sp-price"><span class="sp-now">${money(price)}</span><span class="sp-mrp" ${off > 0 ? "" : "hidden"}>${money(mrp)}</span><span class="sp-save" ${saving > 0 && !p.outOfStock ? "" : "hidden"}>Save ${money(saving)}</span></div>
        </div>
      </article>`;
  }

  function closeBig(now) {
    if (!pop) return;
    const { el, onKey } = pop;
    pop = null;
    document.removeEventListener("keydown", onKey);
    if (now || !el.animate) return el.remove();
    const done = () => el.remove();
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in" }).onfinish = done;
  }

  /** Pull the big card down to close it: it follows the finger and leaves on a long pull or a quick flick, else springs back. */
  function swipeDown(card, back) {
    let y0 = 0, x0 = 0, dy = 0, t0 = 0, on = false;
    card.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; on = false; t0 = Date.now();
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      const d = t.clientY - y0;
      if (!on) {
        if (d > 8 && d > Math.abs(t.clientX - x0) && card.scrollTop <= 0) on = true; else return;
      }
      e.preventDefault();
      dy = Math.max(0, d);
      card.style.transition = "none";
      card.style.transform = `translateY(${dy}px)`;
      back.style.opacity = String(Math.max(0.15, 1 - dy / 420));
    }, { passive: false });
    const end = () => {
      if (!on) return;
      on = false;
      const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
      if (dy > 90 || (fast && dy > 30)) {
        card.style.transition = "transform .2s ease-in";
        card.style.transform = "translateY(105vh)";
        back.style.transition = "opacity .2s";
        back.style.opacity = "0";
        setTimeout(() => closeBig(true), 200);
      } else {
        card.style.transition = "transform .22s cubic-bezier(.2,.9,.25,1)";
        card.style.transform = "";
        back.style.opacity = "";
      }
    };
    card.addEventListener("touchend", end);
    card.addEventListener("touchcancel", end);
  }

  function openBig(p, change) {
    const host = sheetRoot();
    if (pop || !host) return;
    const el = document.createElement("div");
    el.className = "sp-pop";
    el.innerHTML = `<div class="sp-pop-back" data-ox="close"></div><div class="sp-pop-clip"><div class="sp-pop-stage"><div class="sp-pop-card" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">${bigHtml(p)}<button type="button" class="sp-pop-x" data-ox="close" aria-label="Close"></button></div></div></div>`;
    host.appendChild(el);
    const de = document.documentElement;
    const stage = el.querySelector(".sp-pop-stage");
    stage.style.width = de.clientWidth + "px";
    stage.style.height = de.clientHeight + "px";
    const card = el.querySelector(".sp-pop-card");
    const onKey = (e) => { if (e.key === "Escape") closeBig(); };
    pop = { el, onKey };
    document.addEventListener("keydown", onKey);
    swipeDown(card, el.querySelector(".sp-pop-back"));
    const stop = (ev) => ev.preventDefault();
    el.querySelector(".sp-pop-back").addEventListener("touchmove", stop, { passive: false });
    el.querySelector(".sp-pop-back").addEventListener("wheel", stop, { passive: false });
    // (a finger on the card moves the card only - never the sheet or the page behind it - unless the card is taller than the screen)
    card.addEventListener("touchmove", (ev) => { if (card.scrollHeight <= card.clientHeight + 1 && ev.cancelable) ev.preventDefault(); }, { passive: false });
    el.addEventListener("click", (e) => {
      e.stopPropagation(); // (nothing here may reach the shop page's own handlers)
      if (e.target.closest('[data-ox="close"]')) return closeBig();
      const b = e.target.closest("[data-ox]");
      if (!b) return;
      const what = b.dataset.ox;
      const rect = b.getBoundingClientRect();
      const img = card.querySelector(".sp-media img");
      if (what === "dec") bubble(rect, img, false);
      change(p, what, b.dataset.v);
      if (what === "add" || what === "inc") bubble(rect, img, true);
      const art = card.querySelector(".sp-card");
      if (art) art.outerHTML = bigHtml(p);
    });
    if (el.animate) {
      card.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.9,.25,1)" });
      el.querySelector(".sp-pop-back").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    const x = card.querySelector(".sp-pop-x");
    if (x) x.focus({ preventScroll: true });
  }

  /** The little round photo that flies from the + button to the "Done" bar (and back for −), as the shop page does into its cart bar.
   * Purely visual; skipped when the shop switched cart animations off or the phone asks for less motion. */
  function bubble(rect, img, toBar) {
    const bar = $('[data-role="done"]');
    if (!bar || !rect || !document.body.animate) return;
    if (window.SiteCustomize && !SiteCustomize.on("showCartAnimations")) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const size = 42;
    const b = bar.getBoundingClientRect();
    const barX = b.left + Math.min(b.width, 120) / 2 - size / 2;
    const barY = b.top + b.height / 2 - size / 2;
    const cx = rect.left + rect.width / 2 - size / 2;
    const cy = rect.top + rect.height / 2 - size / 2;
    const [sx, sy, ex, ey] = toBar ? [cx, cy, barX, barY] : [barX, barY, cx, cy];
    const mx = (sx + ex) / 2;
    const my = Math.min(sy, ey) - 70;
    const s0 = Math.max(0.5, Math.min(1, rect.width / size));
    const ghost = document.createElement("div");
    ghost.className = "fx-fly";
    if (img && img.complete && img.naturalWidth > 0) ghost.style.backgroundImage = `url("${(img.currentSrc || img.src).replace(/"/g, "%22")}")`;
    document.body.appendChild(ghost);
    const frames = toBar
      ? [{ transform: `translate(${sx}px, ${sy}px) scale(${s0})`, opacity: 1, offset: 0 }, { transform: `translate(${mx}px, ${my}px) scale(${Math.min(0.85, s0)})`, opacity: 1, offset: 0.5 }, { transform: `translate(${ex}px, ${ey}px) scale(0.2)`, opacity: 0.9, offset: 1 }]
      : [{ transform: `translate(${sx}px, ${sy}px) scale(0.3)`, opacity: 0.9, offset: 0 }, { transform: `translate(${mx}px, ${my}px) scale(0.85)`, opacity: 1, offset: 0.5 }, { transform: `translate(${ex}px, ${ey}px) scale(${s0})`, opacity: 1, offset: 0.85 }, { transform: `translate(${ex}px, ${ey}px) scale(${s0 * 0.6})`, opacity: 0, offset: 1 }];
    const anim = ghost.animate(frames, { duration: 620, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)", fill: "forwards" });
    const done = () => {
      ghost.remove();
      if (toBar && bar.isConnected) bar.animate([{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 280, easing: "ease-out" });
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function showAdd() {
    E.view = "add";
    closeBig(true);
    unfit();
    const home = document.getElementById("productGrid");
    const compact = !home || home.classList.contains("pg-compact"); // (the same two-per-row / big look the shop page has)
    const body = `
      <div class="sheet-body oec-flow oec-add">
        <button type="button" class="acct-back" data-role="back">‹ Back to my order</button>
        <div class="oec-search"><div class="search-bar"><span class="search-bar-icon" aria-hidden="true">🔍</span><input type="text" class="search-bar-input" data-q placeholder="Search chicken, eggs…" autocomplete="off" aria-label="Search products" /></div></div>
        <nav class="category-bar oec-catbar" data-catbar hidden><div class="category-scroll" data-cats></div></nav>
        <div class="product-grid${compact ? " pg-compact" : ""} oec-grid" data-grid><p class="oec-fine">Loading…</p></div>
        <button type="button" class="btn btn-ghost btn-sm oec-more" data-more hidden>Show more</button>
      </div>
      <div class="sheet-footer"><button type="button" class="btn btn-gold btn-block" data-role="done"></button></div>`;
    const root = window.CheckoutSheet.renderSheet(body, "Add an item");
    root.querySelector(".sheet").classList.add("sheet-oe");
    fit(root);
    // this page never moves sideways: nothing on it scrolls that way except the category chips
    const sb = root.querySelector(".sheet-body");
    sb.addEventListener("scroll", () => { if (sb.scrollLeft) sb.scrollLeft = 0; }, { passive: true });
    const back = () => { closeBig(true); showMain(); schedulePreview(); };
    window.CheckoutSheet.setLeaveGuard(() => { back(); return true; });
    const flow = root.querySelector(".oec-flow");
    const gridEl = root.querySelector("[data-grid]");
    const catsEl = root.querySelector("[data-cats]");
    const catBar = root.querySelector("[data-catbar]");
    const moreBtn = root.querySelector("[data-more]");
    const q = root.querySelector("[data-q]");
    const done = root.querySelector('[data-role="done"]');
    const paintDone = () => {
      const n = live().length;
      done.textContent = n ? `Back to my order · ${n} ${n === 1 ? "item" : "items"}` : "Back to my order";
    };
    paintDone();
    let all = [];
    let cat = "All";
    let shown = PAGE_CARDS;
    const matches = () => {
      const term = q.value.trim().toLowerCase();
      return all.filter((p) => (cat === "All" || p.category === cat) && sizesOf(p).length &&
        (!term || String(p.name).toLowerCase().includes(term) || String(p.description || "").toLowerCase().includes(term)));
    };
    // (the two cards of a row get the same text height, so their sizes / prices line up - as on the shop page)
    const align = () => {
      const cards = [...gridEl.querySelectorAll(".product-card")];
      cards.forEach((c) => { const t = c.querySelector(".product-text"); if (t) t.style.minHeight = ""; });
      if (!compact || !window.matchMedia || !window.matchMedia("(max-width: 619px)").matches) return;
      const rows = new Map();
      cards.forEach((c) => {
        const t = c.querySelector(".product-text");
        if (!t || !c.offsetParent) return;
        if (!rows.has(c.offsetTop)) rows.set(c.offsetTop, []);
        rows.get(c.offsetTop).push(t);
      });
      rows.forEach((list) => {
        if (list.length < 2) return;
        const h = Math.max(...list.map((t) => t.getBoundingClientRect().height));
        list.forEach((t) => (t.style.minHeight = h + "px"));
      });
    };
    // a card whose text part has no height was squeezed on a first layout (seen on an iPhone): draw the cards again once the sheet has settled
    let heals = 0;
    const heal = () => {
      if (!E || E.view !== "add" || !gridEl.isConnected || heals >= 3) return;
      const bad = [...gridEl.querySelectorAll(".product-card")].some((c) => {
        const b = c.querySelector(".product-body");
        return c.offsetParent && b && b.getBoundingClientRect().height < 24;
      });
      if (bad) { heals++; draw(true); }
    };
    const draw = (again) => {
      const rows = matches();
      gridEl.innerHTML = rows.slice(0, shown).map(productCard).join("") || `<p class="oec-fine">No items match.</p>`;
      moreBtn.hidden = rows.length <= shown;
      requestAnimationFrame(align);
      if (!again) { setTimeout(heal, 120); setTimeout(heal, 500); setTimeout(heal, 1300); } // (the sheet is still sliding in at the first draw)
    };
    const drawCats = () => {
      const names = ["All", ...new Set(all.map((p) => p.category).filter(Boolean))];
      catBar.hidden = names.length < 3;
      const keep = catsEl.scrollLeft; // (a redraw must not throw the strip back to the start)
      catsEl.innerHTML = names.map((c) => `<button type="button" class="cat-chip ${c === cat ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
      catsEl.scrollLeft = keep;
    };
    const loader = window.CatalogStore ? Promise.resolve(CatalogStore.loadAll()).catch(() => {}).then(() => CatalogStore.pooled()) : Promise.resolve([]);
    loader.then((rows) => { if (!E || E.view !== "add") return; all = rows || []; drawCats(); draw(); });
    q.addEventListener("input", () => { shown = PAGE_CARDS; draw(); });

    /** One change from a card (or from the big card): add / more / less / the size. Only this order's list is touched. */
    const change = (p, what, v) => {
      const cur = E.pick[p.id] || "variant1";
      if (what === "variant") { E.pick[p.id] = v === "variant2" ? "variant2" : "variant1"; }
      else if (what === "add" || what === "inc") {
        const z = sizesOf(p).find((x) => x.v === cur);
        const have = E.rows.find((r) => r.productId === p.id && r.variant === cur);
        if (have) { have.gone = false; if (have.qty < MAX_QTY) have.qty++; }
        else if (z) E.rows.push({ productId: p.id, name: p.name, imageUrl: p.imageUrl, label: z.label, variant: cur, origVariant: cur, unit: z.price, origUnit: z.price, qty: 1, origQty: 0, orig: false, gone: false });
      } else if (what === "dec") {
        const idx = E.rows.findIndex((r) => !r.gone && r.productId === p.id && r.variant === cur);
        if (idx >= 0) { if (E.rows[idx].qty > 1) E.rows[idx].qty--; else removeRow(idx); }
      } else return;
      paintDone();
      const card = gridEl.querySelector(`.product-card[data-id="${p.id}"]`);
      if (!card) return;
      if (what !== "variant") {
        // + / - / add: only the count and the buttons change, IN PLACE - the card (and its photo) is not rebuilt, so the photo can never blink
        const qty = cardQty(p, E.pick[p.id] || "variant1");
        const addBtn = card.querySelector(".add-btn"), step = card.querySelector(".qty-stepper"), val = card.querySelector(".qty-value");
        if (addBtn && step && val) {
          addBtn.classList.toggle("hide", qty > 0);
          step.classList.toggle("show", qty > 0);
          val.textContent = qty;
          return;
        }
      }
      // another size: the price, the size buttons and the offer badge change - they are swapped one by one; the card itself and its photo are never touched
      const fresh = document.createElement("template");
      fresh.innerHTML = productCard(p).trim();
      const nc = fresh.content.firstElementChild;
      [".discount-badge", ".product-footer", ".product-body"].forEach((sel) => {
        const was = card.querySelector(sel), now = nc.querySelector(sel);
        if (was && now) was.replaceWith(now);
      });
      requestAnimationFrame(align);
    };

    catsEl.addEventListener("click", (e) => {
      const chip = e.target.closest(".cat-chip");
      if (!chip) return;
      cat = chip.dataset.cat;
      shown = PAGE_CARDS;
      // only move the highlight (no redraw: a redraw cuts a scroll that is still gliding), and bring the chip fully into view
      catsEl.querySelectorAll(".cat-chip.active").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const cr = catsEl.getBoundingClientRect(), r = chip.getBoundingClientRect();
      if (r.left < cr.left + 8) catsEl.scrollBy({ left: r.left - cr.left - 16, behavior: "smooth" });
      else if (r.right > cr.right - 8) catsEl.scrollBy({ left: r.right - cr.right + 16, behavior: "smooth" });
      draw();
    });
    done.addEventListener("click", (e) => { e.stopPropagation(); back(); });
    flow.addEventListener("click", (e) => {
      e.stopPropagation(); // (the shop page's own card handler on this sheet would put the item in the CART)
      if (e.target.closest('[data-role="back"]')) return back();
      if (e.target.closest('[data-role="done"]')) return back();
      if (e.target.closest("[data-more]")) { shown += PAGE_CARDS; return draw(); }
      const card = e.target.closest(".product-card");
      if (!card) return;
      const p = all.find((x) => String(x.id) === card.dataset.id);
      if (!p) return;
      const act = e.target.closest("[data-action]");
      if (act) {
        const what = act.dataset.action;
        const rect = act.getBoundingClientRect(); // (before the card is redrawn)
        const img = card.querySelector(".product-media-frame img");
        if (what === "dec") bubble(rect, img, false);
        change(p, what, act.dataset.variant);
        if (what === "add" || what === "inc") bubble(rect, img, true);
        return;
      }
      if (!e.target.closest(".product-footer, .variant-toggle")) openBig(p, change); // a tap on the item itself opens it big, as on the shop page
    });
  }

  return { stamp, apply, can, cardHtml, payHtml, editedHtml, struckHtml, lessHtml, itemsNote, changedMap, swapMap };
})();
