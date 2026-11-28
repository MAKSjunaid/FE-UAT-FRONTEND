/* Orders -> "Edit order": the shop changes an order after it was placed - quantities and sizes, items added or removed, "Not available"
 * (an item the shop cannot supply: the order is delivered without it, the customer is told it was not delivered and pays less), and the
 * delivery details. Everything that is worked out - the new total, delivery / other charges, any offer or voucher, what was already
 * paid and so what is to be collected or refunded - comes from the server (/api/admin/orders/{id}/edit-preview); this page only shows it.
 *
 * What is here:
 *   - state: is editing switched on (Customize > Edit orders), may THIS login do it (Settings > Users > "Can edit orders"), in which statuses;
 *   - the sheet (open): items, details, reason, live summary, Save;
 *   - what an order card shows once it was edited: "Edited · View changes", the items that were NOT delivered, and the money still to settle;
 *   - the history sheet (every change ever made to the order: who, when, why, before / after).
 * admin-orders.js calls canEdit / open / history / settle / cardHtml and listens for "freshcutz:orderedit" (the order as it is now).
 * To undo this feature: restore the previous admin.html, admin-orders.js, admin-live.js, admin-main.js, admin-customize.js, admin-users.js
 * and delete this file, admin-edit-rule.js and css/admin-order-edit.css (see _revert_edit/MANIFEST.txt). */

window.AdminOrderEdit = (() => {
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const money = (v) => Utils.formatMoney(v == null ? 0 : v);
  const STATE_URL = "/api/admin/orders/edit-state";
  const STATE_FRESH_MS = 5 * 60 * 1000;
  const MAX_QTY = 50;
  const PREVIEW_WAIT = 380;

  // ---- state ---------------------------------------------------------------------------------------

  let st = null; // { enabled, canEdit, may, statuses, reasons }
  // the reasons to pick from, with "Other" always last (the shop types its own words, as a customer can)
  const OTHER_TEXT = "✏️ Other";
  const reasonsOf = () => { const r = (st && st.reasons) || []; return r.some((x) => /\bother\b/i.test(x)) ? r : r.concat(OTHER_TEXT); };
  const isOther = (S) => S.reason !== "" && /\bother\b/i.test(reasonsOf()[Number(S.reason)] || "");
  const otherMissing = (S) => isOther(S) && !String((S.el.querySelector('[data-f="note"]') || {}).value || "").trim();
  let stAt = 0;
  let stBusy = false;

  function loadState(force) {
    if (stBusy || (!force && st && Date.now() - stAt < STATE_FRESH_MS)) return;
    stBusy = true;
    Api.get(STATE_URL)
      .then((s) => {
        const changed = JSON.stringify(s) !== JSON.stringify(st);
        st = s;
        stAt = Date.now();
        if (changed) window.dispatchEvent(new Event("freshcutz:orderedit-state"));
      })
      .catch(() => {
        if (!st) { st = { enabled: false, canEdit: false, may: false, statuses: [], reasons: [] }; stAt = Date.now(); }
      })
      .finally(() => { stBusy = false; });
  }

  /** Whether the Edit button shows for this order right now. The first call starts reading the state (the Orders tab redraws itself when it arrives). */
  function canEdit(order) {
    if (!st) { loadState(false); return false; }
    if (Date.now() - stAt > STATE_FRESH_MS) loadState(false);
    return !!(st.canEdit && order && st.statuses.includes(order.status));
  }

  document.addEventListener("freshcutz:logout", () => { st = null; stAt = 0; closeAll(); });
  window.addEventListener("freshcutz:orderedit-rule-saved", () => loadState(true));

  // ---- the order card: what an edited order shows -----------------------------------------------------

  const ago = (iso) => (iso ? Utils.formatDateTime(iso) : "");

  // An item whose quantity or size was changed in an edit is still on the order: what it was stays on the same line, struck through. Returns Map: index in
  // order.items -> the record of what it was before (.used = the records shown that way, which are not "not delivered" items).
  // (A size swap - the old size gone, another size of the same product there - is a record of the old size.)
  function changeOf(order) {
    const items = order.items || [];
    const recs = Array.isArray(order.removed) ? order.removed : [];
    const m = new Map(); m.used = new Set();
    const same = (i, r) => String(i.productId) === String(r.productId) && (i.variant || "variant1") === r.variant;
    const has = (r) => items.some((i) => same(i, r));
    items.forEach((it, idx) => {
      const q = recs.find((r) => r.kind === "changed" && same(it, r));
      if (q) { m.set(idx, q); m.used.add(q); return; }
      const r = recs.find((x) => x.kind === "removed" && !m.used.has(x) && String(x.productId) === String(it.productId) && !has(x));
      if (r) { m.set(idx, r); m.used.add(r); }
    });
    return m;
  }

  /** The item lines of an order card, with what an edit changed struck through beside the new quantity / size / price. */
  function itemsHtml(order) {
    const m = changeOf(order);
    return (order.items || []).map((i, idx) => {
      const w = m.get(idx);
      const q = w && w.qty !== i.quantity ? `<s class="oe-was">${esc(w.qty)}</s> ${esc(i.quantity)}` : esc(i.quantity);
      const lbl = w && w.label !== i.variantLabel ? `<s class="oe-was">${esc(w.label)}</s> ${esc(i.variantLabel)}` : esc(i.variantLabel);
      const amt = w ? `<s class="oe-was">${money(w.lineTotal)}</s> ${money(i.lineTotal)}` : money(i.lineTotal);
      return `<div>${q} × ${esc(i.productName)} (${lbl}) — ${amt}</div>`;
    }).join("");
  }

  /** The part of an order card about editing ("" for an order that was never edited). */
  function cardHtml(order) {
    if (!order) return "";
    let h = "";
    const shownOnItems = changeOf(order).used;
    const removed = (Array.isArray(order.removed) ? order.removed : []).filter((r) => r.kind !== "changed" && !shownOnItems.has(r));
    if ((order.editCount || 0) > 0) {
      h += `<div class="oe-edited"><span class="oe-edited-tag">✏️ Edited</span><span class="oe-edited-when">${esc(ago(order.lastEditedAt))}</span>` +
        `<button type="button" class="oe-linkbtn" data-oe="history">View changes</button></div>`;
    }
    if (removed.length) {
      h += `<div class="oe-removed"><div class="oe-removed-h">🚫 Not delivered (not available / removed)</div>` +
        removed.map((r) => `<div class="oe-removed-i"><s>${esc(r.qty)} × ${esc(r.name)} (${esc(r.label)})</s><span>${r.kind === "removed" ? "Removed" : money(r.lineTotal)}</span></div>`).join("") + `</div>`;
    }
    const d = Number(order.payDelta);
    if (d) {
      const upi = order.paymentMode === "UPI";
      const more = d > 0;
      const text = more
        ? `💳 Collect <b>${money(d)}</b> more from the customer${upi ? " (UPI)" : ""}`
        : `↩ Refund <b>${money(-d)}</b> to the customer${upi ? " (UPI)" : ""}`;
      h += `<div class="oe-pay ${more ? "is-more" : "is-refund"}"><span>${text}</span>` +
        `${st && st.may ? `<button type="button" class="oe-linkbtn" data-oe="settle">Mark settled</button>` : ""}</div>`;
    }
    return h ? `<div class="oe-wrap">${h}</div>` : "";
  }

  // ---- small UI helpers ---------------------------------------------------------------------------------

  let sheet = null; // { el, order, ... }
  let hist = null;
  let unlockPage = null; // (the page behind is held still - position: fixed - while a sheet is open on a phone)
  const lock = () => {
    document.documentElement.classList.add("oe-lock");
    if (!unlockPage && window.KbFit) unlockPage = KbFit.lockPage();
  };
  const unlock = () => {
    if (sheet || hist) return;
    document.documentElement.classList.remove("oe-lock");
    if (unlockPage) { unlockPage(); unlockPage = null; }
  };

  function closeAll() {
    if (sheet) { sheet.el.remove(); sheet = null; }
    if (hist) { hist.remove(); hist = null; }
    unlock();
  }

  const toast = (m, t) => { if (window.Toast) Toast.show(m, t || "info"); };

  // ---- the catalog (for adding items and changing a size): read when the sheet opens ------------------------

  let catalog = null; // Map id -> { id, name, l1, p1, l2, p2, on, _at }: every product this sheet has heard of, whichever way it came
  let catalogBusy = null;
  const CATALOG_FRESH_MS = 5 * 60 * 1000;
  const put = (r) => { if (!catalog) catalog = new Map(); if (!r._at) r._at = Date.now(); catalog.set(r.id, r); return r; };
  const rowFrom = (p) => ({ id: p.id, name: p.name, category: p.category, imageUrl: p.imageUrl, l1: p.variant1Label, p1: p.variant1Price, l2: p.variant2Label, p2: p.variant2Price, on: !!p.enabled && !p.outOfStock });
  document.addEventListener("freshcutz:logout", () => { catalog = null; searched.clear(); });

  // The details of a product are used from wherever they are already here - the Products page's lists (kept in step with every edit made there), or an
  // earlier read of this sheet - and only what is missing is asked for.
  function known(id) {
    const p = window.AdminProducts && AdminProducts.find ? AdminProducts.find(id) : null;
    if (p) return put(rowFrom(p));
    const r = catalog && catalog.get(id);
    return r && Date.now() - r._at < CATALOG_FRESH_MS ? r : null;
  }

  // ids = the products on the order: the ones not known yet are read (a few rows). The whole catalog is never read.
  function loadCatalog(ids) {
    const need = [...new Set((ids || []).filter((id) => !known(id)))];
    if (!need.length) return Promise.resolve(catalog);
    const key = need.sort((x, y) => x - y).join(",");
    if (catalogBusy && catalogBusy.key === key) return catalogBusy;
    const p = Api.get("/api/admin/orders/edit-products?ids=" + key)
      .then((rows) => { (rows || []).forEach(put); return catalog; })
      .catch(() => catalog)
      .finally(() => { if (catalogBusy === p) catalogBusy = null; });
    p.key = key; catalogBusy = p;
    return p;
  }

  // "Add an item": what was searched is kept for a few minutes across openings. A longer text of one that was answered in full (fewer than 30 rows) is
  // answered from those rows, so typing on narrows the list without asking again.
  const SEARCH_PAGE = 30;
  const searched = new Map(); // text -> { rows, at }
  function searchLocal(term) {
    const now = Date.now();
    const hit = searched.get(term);
    if (hit && now - hit.at < CATALOG_FRESH_MS) return hit.rows;
    for (const [k, v] of searched) {
      if (now - v.at < CATALOG_FRESH_MS && v.rows.length < SEARCH_PAGE && term.includes(k)) {
        return v.rows.filter((r) => String(r.name).toLowerCase().includes(term) || String(r.category || "").toLowerCase().includes(term));
      }
    }
    return null;
  }

  const sizesOf = (p) => {
    const out = [];
    if (p && p.l1 != null && p.p1 != null) out.push({ v: "variant1", label: p.l1, price: p.p1 });
    if (p && p.l2 != null && p.p2 != null) out.push({ v: "variant2", label: p.l2, price: p.p2 });
    return out;
  };

  // ---- the sheet ---------------------------------------------------------------------------------------------

  /** Opens the Edit sheet for an order (the object the Orders tab holds). */
  function open(order) {
    if (sheet || !order) return;
    if (!canEdit(order)) { toast("This order can't be edited right now", "error"); return; }
    const S = {
      order,
      rows: order.items.map((i) => ({
        productId: i.productId, name: i.productName, label: i.variantLabel, variant: i.variant === "variant2" ? "variant2" : "variant1",
        origVariant: i.variant === "variant2" ? "variant2" : "variant1", unit: Number(i.unitPrice), origUnit: Number(i.unitPrice),
        qty: i.quantity, origQty: i.quantity, orig: true, na: false, gone: false,
      })),
      reason: "",
      preview: null,
      previewErr: "",
      previewing: false,
      busy: false,
      seq: 0,
      timer: 0,
      el: null,
    };
    sheet = S;
    lock();
    const el = document.createElement("div");
    el.className = "oe-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Edit order");
    S.el = el;
    const reasons = reasonsOf();
    const hasPin = order.deliveryLat != null && order.deliveryLng != null;
    el.innerHTML = `
      <div class="oe-top"><button type="button" class="oe-x" data-oe-do="close" aria-label="Close">✕</button>
        <span class="oe-title">Edit order · ${esc(order.orderCode)}</span></div>
      <div class="oe-body" data-kb-tight>
        <p class="oe-note">${esc(order.customerName)} · ${order.paymentMode === "UPI" ? "UPI" : "Cash on delivery"} · now ${money(order.totalAmount)}. The customer is told about the change.</p>

        <h4 class="oe-h">Items</h4>
        <div class="oe-items" data-items></div>
        <button type="button" class="oe-add" data-oe-do="add">＋ Add an item</button>

        <h4 class="oe-h">Delivery details</h4>
        <div class="oe-fields">
          <label class="oe-f">Name<input type="text" data-f="customerName" maxlength="120" autocomplete="off" value="${esc(order.customerName)}" /></label>
          <label class="oe-f">Flat / House no.<input type="text" data-f="flatNo" maxlength="60" autocomplete="off" value="${esc(order.flatNo)}" /></label>
          <label class="oe-f">Address<textarea data-f="addressLine" rows="2" maxlength="300">${esc(order.addressLine)}</textarea></label>
          <label class="oe-f">Landmark (optional)<input type="text" data-f="landmark" maxlength="150" autocomplete="off" value="${esc(order.landmark || "")}" /></label>
          <label class="oe-f">Notes (optional)<textarea data-f="notes" rows="2" maxlength="300">${esc(order.notes || "")}</textarea></label>
          <label class="oe-check" data-profile-row hidden><input type="checkbox" data-f="saveToProfile" /><span>Also update the customer's saved address (My Account), so their next order starts with this one.</span></label>
          ${hasPin ? `<label class="oe-check"><input type="checkbox" data-f="clearPin" /><span>Remove the map pin (the address is somewhere else now). The order also leaves its delivery route.</span></label>` : ""}
        </div>

        <h4 class="oe-h">Why are you changing it? <span class="oe-req">required</span></h4>
        <div class="oe-chips" data-reasons>${reasons.map((r, i) =>
          `<label class="oe-chip"><input type="radio" name="oe-reason" value="${i}" /><span>${esc(r)}</span></label>`).join("")}</div>
        <label class="oe-f oe-f-note"><span data-note-label>Add a note (optional, kept in the order's history)</span><textarea data-f="note" rows="2" maxlength="150" placeholder="e.g. Customer called at 6:10 pm"></textarea></label>

        <h4 class="oe-h">Summary</h4>
        <div class="oe-sum" data-sum><p class="oe-fine">Make a change to see the new total.</p></div>
      </div>
      <div class="oe-foot">
        <div class="oe-foot-total" data-foot-total></div>
        <button type="button" class="btn btn-gold btn-block" data-oe-do="save" disabled>Save changes</button>
        <div class="oe-hint" data-hint></div>
      </div>
      <div class="oe-over" data-over hidden></div>`;
    document.body.appendChild(el);
    wire(S);
    paintItems(S);
    paintFoot(S);
    loadCatalog([...new Set((order.items || []).map((i) => i.productId))]).then(() => { if (sheet === S) paintItems(S); });
    // typing on a phone: the sheet is never resized or moved. A tapped text box is first scrolled up near the top of the sheet's body (above where the
    // keyboard comes) and then focused (js/kb-fit.js); a drag that cannot scroll anything in the sheet is dropped, so the page behind never moves.
    if (window.KbFit) {
      const offAvoid = KbFit.avoid(el, (b) => (b && b.closest ? b.closest(".oe-over") ? null : b.closest(".oe-body") : null));
      const unguard = KbFit.guard(el);
      // the "Add an item" card sits at the bottom of the sheet: while its search box is being typed in it moves to the top, clear of the keyboard
      let typingTimer = 0;
      const over = el.querySelector("[data-over]");
      const onIn = (e) => { if (over && over.contains(e.target) && KbFit.isText(e.target)) { clearTimeout(typingTimer); over.classList.add("is-typing"); } };
      const onOut = (e) => {
        if (!over || !over.contains(e.target) || KbFit.isText(e.relatedTarget)) return;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if (!KbFit.isText(document.activeElement)) over.classList.remove("is-typing"); }, 120);
      };
      el.addEventListener("focusin", onIn);
      el.addEventListener("focusout", onOut);
      S.unfit = () => { offAvoid(); unguard(); clearTimeout(typingTimer); el.removeEventListener("focusin", onIn); el.removeEventListener("focusout", onOut); };
    }
  }

  const rowKey = (r) => `${r.productId}|${r.variant}`;
  const liveRows = (S) => S.rows.filter((r) => !r.gone && !r.na);
  const anyNa = (S) => S.rows.some((r) => r.na);

  function paintItems(S) {
    const host = S.el.querySelector("[data-items]");
    host.innerHTML = S.rows.map((r, i) => {
      const p = catalog ? catalog.get(r.productId) : null;
      const sizes = sizesOf(p);
      const line = r.unit * r.qty;
      if (r.gone) {
        return `<div class="oe-row is-gone" data-i="${i}"><div class="oe-row-main"><div class="oe-row-name"><s>${esc(r.name)}</s><small>${esc(r.label)} × ${r.qty}</small></div>` +
          `<button type="button" class="oe-linkbtn" data-op="undo">Undo</button></div></div>`;
      }
      if (r.na) {
        return `<div class="oe-row is-na" data-i="${i}"><div class="oe-row-main"><div class="oe-row-name"><s>${esc(r.name)}</s><small>${esc(r.label)} × ${r.qty}</small></div>` +
          `<button type="button" class="oe-linkbtn" data-op="undo">Undo</button></div>` +
          `<div class="oe-na-note">🚫 Not available — the order goes out without it. The customer sees it as not delivered and its ${money(r.origUnit * r.qty)} comes off the bill. No charge goes up because of it.</div></div>`;
      }
      const sizeBtns = r.orig && sizes.length > 1
        ? `<div class="oe-sizes">${sizes.map((z) => `<button type="button" class="oe-size${z.v === r.variant ? " is-on" : ""}" data-sz="${z.v}"${p && !p.on && z.v !== r.origVariant ? " disabled" : ""}>${esc(z.label)} · ${money(z.v === r.origVariant ? r.origUnit : z.price)}</button>`).join("")}</div>`
        : "";
      return `<div class="oe-row${r.orig ? "" : " is-new"}" data-i="${i}">
        <div class="oe-row-main"><div class="oe-row-name">${esc(r.name)}<small>${sizeBtns ? "" : esc(r.label)}${r.orig ? "" : `${sizeBtns ? "" : " · "}<b class="oe-newtag">New</b>`}</small></div>
          <div class="oe-row-price">${money(line)}</div></div>
        ${sizeBtns}
        <div class="oe-row-ctl">
          <div class="oe-step"><button type="button" data-op="dec" aria-label="Less"${r.qty <= 1 ? " disabled" : ""}>−</button><span>${r.qty}</span><button type="button" data-op="inc" aria-label="More"${r.qty >= MAX_QTY ? " disabled" : ""}>＋</button></div>
          <div class="oe-row-acts">${r.orig ? `<button type="button" class="oe-linkbtn is-x" data-op="na">Not available</button>` : ""}<button type="button" class="oe-linkbtn" data-op="rm">${r.orig ? "Remove" : "Remove"}</button></div>
        </div></div>`;
    }).join("");
  }

  /** The "also update the saved address" box shows only while the name, flat, address or landmark differs from what the order has. */
  function paintProfile(S) {
    const row = S.el.querySelector("[data-profile-row]");
    if (!row) return;
    const val = (k) => String((S.el.querySelector(`[data-f="${k}"]`) || {}).value || "").trim();
    const o = S.order;
    row.hidden = val("customerName") === String(o.customerName || "").trim() && val("flatNo") === String(o.flatNo || "").trim()
      && val("addressLine") === String(o.addressLine || "").trim() && val("landmark") === String(o.landmark || "").trim();
  }

  function request(S) {
    const f = (k) => S.el.querySelector(`[data-f="${k}"]`);
    const items = liveRows(S).map((r) => ({ productId: r.productId, variant: r.variant, quantity: r.qty }));
    const unavailable = S.rows.filter((r) => r.na && r.orig).map((r) => `${r.productId}|${r.origVariant}`);
    const reasons = reasonsOf();
    return {
      items,
      unavailable,
      customerName: f("customerName").value,
      flatNo: f("flatNo").value,
      addressLine: f("addressLine").value,
      landmark: f("landmark").value,
      notes: f("notes").value,
      clearPin: f("clearPin") ? f("clearPin").checked : undefined,
      saveToProfile: f("saveToProfile") && f("saveToProfile").checked && !S.el.querySelector("[data-profile-row]").hidden ? true : undefined,
      reason: S.reason !== "" ? reasons[Number(S.reason)] : "",
      note: f("note").value,
    };
  }

  /** What the new total depends on (not the reason or the note): the same text twice needs no second answer (typing, then leaving the box,
   * used to ask the server the same thing again). */
  function sigOf(S) {
    const r = request(S);
    return JSON.stringify([r.items, r.unavailable, r.customerName, r.flatNo, r.addressLine, r.landmark, r.notes, r.clearPin, r.saveToProfile]);
  }

  function schedulePreview(S) {
    clearTimeout(S.timer);
    if (!S.previewing && S.sig && S.sig === sigOf(S) && (S.preview || S.previewErr)) { // (the answer on screen is already for exactly this)
      paintFoot(S);
      return;
    }
    S.previewing = true;
    paintFoot(S);
    S.timer = setTimeout(() => runPreview(S), PREVIEW_WAIT);
  }

  async function runPreview(S) {
    const seq = ++S.seq;
    const req = request(S);
    const sg = sigOf(S);
    try {
      const p = await Api.post(`/api/admin/orders/${S.order.id}/edit-preview`, req);
      if (sheet !== S || seq !== S.seq) return;
      S.preview = p;
      S.previewErr = "";
      S.sig = sg;
    } catch (err) {
      if (sheet !== S || seq !== S.seq) return;
      S.preview = null;
      S.previewErr = err && err.message ? err.message : "Couldn't work out the total";
      S.sig = sg;
    }
    S.previewing = false;
    paintSum(S);
    paintFoot(S);
  }

  function payLine(S, p) {
    const o = S.order;
    const upi = o.paymentMode === "UPI";
    const paid = Number(p.paid || 0);
    if (p.payKind === "MORE") return `<div class="oe-pay is-more">💳 The customer already paid <b>${money(paid)}</b>. Collect <b>${money(p.payAmount)}</b> more${upi ? " (UPI)" : " on delivery"}. It stays on the order until you mark it settled.</div>`;
    if (p.payKind === "REFUND") return `<div class="oe-pay is-refund">↩ The customer already paid <b>${money(paid)}</b>. Refund <b>${money(p.payAmount)}</b>${upi ? " to their UPI" : ""}. It stays on the order until you mark it settled.</div>`;
    if (paid > 0) return `<div class="oe-pay">✓ The customer already paid ${money(paid)} — nothing more to collect or refund.</div>`;
    return `<div class="oe-pay">${upi ? "📲 UPI: the customer pays" : "💵 Cash on delivery: collect"} <b>${money(p.total)}</b>${upi ? " (not paid yet)" : ""}.</div>`;
  }

  function paintSum(S) {
    const host = S.el.querySelector("[data-sum]");
    if (!host) return;
    if (!S.preview) {
      const none = S.previewErr === "Nothing was changed";
      host.innerHTML = `<p class="${none ? "oe-fine" : "oe-err"}">${none ? "Make a change to see the new total." : esc(S.previewErr || "")}</p>`;
      return;
    }
    const p = S.preview;
    const ch = Array.isArray(p.charges) ? p.charges : [];
    const diff = Number(p.diff || 0);
    host.innerHTML = `
      <div class="oe-sum-rows">
        <div class="oe-sum-r"><span>Items</span><span>${money(p.itemsTotal)}</span></div>
        ${ch.map((l) => l.key === "offer"
          ? `<div class="oe-sum-r"><span>🎁 ${esc(l.label)}</span><span>−${money(-l.charged)}</span></div>`
          : `<div class="oe-sum-r"><span>${esc(l.label)}</span><span>${l.free ? `<s>${money(l.amount)}</s> FREE` : money(l.charged)}</span></div>`).join("")}
        <div class="oe-sum-r is-total"><span>New total</span><span>${money(p.total)}${diff ? `<em class="${diff > 0 ? "is-up" : "is-down"}">${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}</em>` : ""}</span></div>
        <div class="oe-sum-r is-was"><span>Was</span><span>${money(p.oldTotal)}</span></div>
      </div>
      ${p.rewardWarning ? `<div class="oe-warn">⚠️ ${esc(p.rewardWarning)}</div>` : ""}
      ${payLine(S, p)}
      <div class="oe-changes"><b>What changes</b>${(p.changes || []).map((c) => `<div>• ${esc(c)}</div>`).join("")}</div>`;
  }

  /** "Other" needs its words: the note box then says so (required); with any other reason it stays an optional note. */
  function paintNote(S) {
    const lab = S.el.querySelector("[data-note-label]");
    const n = S.el.querySelector('[data-f="note"]');
    const other = isOther(S);
    if (lab) lab.textContent = other ? "Write the reason (required, kept in the order's history)" : "Add a note (optional, kept in the order's history)";
    if (n) n.placeholder = other ? "Type why you are changing this order" : "e.g. Customer called at 6:10 pm";
  }

  function paintFoot(S) {
    const save = S.el.querySelector('[data-oe-do="save"]');
    const hint = S.el.querySelector("[data-hint]");
    const tot = S.el.querySelector("[data-foot-total]");
    const p = S.preview;
    tot.innerHTML = p ? `<span>New total</span><span><b>${money(p.total)}</b>${Number(p.diff) ? ` <em class="${p.diff > 0 ? "is-up" : "is-down"}">(${p.diff > 0 ? "+" : "−"}${money(Math.abs(p.diff))})</em>` : ""}</span>` : "";
    let why = "";
    if (S.busy) why = "Saving…";
    else if (S.previewing) why = "Working out the new total…";
    else if (!p) why = S.previewErr === "Nothing was changed" || !S.previewErr ? "Change something to save." : "Fix the problem above to save.";
    else if (S.reason === "") why = "Choose a reason to save.";
    else if (otherMissing(S)) why = "Write the reason to save.";
    save.disabled = !!why;
    save.textContent = S.busy ? "Saving…" : "Save changes";
    hint.textContent = why;
  }

  const isDirty = (S) => !!S.preview || S.rows.some((r) => r.na || r.gone || !r.orig || r.qty !== r.origQty || r.variant !== r.origVariant);

  function wire(S) {
    const el = S.el;
    el.addEventListener("input", (e) => {
      if (e.target.matches('[data-f="note"]')) paintFoot(S); // (the note changes nothing in the total: no new preview for each letter)
      else if (e.target.matches("[data-f]")) { paintProfile(S); schedulePreview(S); }
    });
    el.addEventListener("change", (e) => {
      if (e.target.matches('input[name="oe-reason"]')) {
        S.reason = e.target.value;
        paintNote(S);
        paintFoot(S);
        if (isOther(S)) { // (the box to type the reason in: focused and brought into view above the keyboard)
          const n = S.el.querySelector('[data-f="note"]');
          if (n) { if (window.KbFit) KbFit.focusLifted(n, n.closest(".oe-body")); else n.focus({ preventScroll: true }); }
        }
      } else if (e.target.matches("[data-f]") && !e.target.matches('[data-f="note"]')) { // (the note changes nothing in the total: leaving the box must not start a new total - it would disable Save under the finger)
        schedulePreview(S);
      }
    });
    el.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-oe-do]");
      if (act) {
        const what = act.dataset.oeDo;
        if (what === "close") return tryClose(S);
        if (what === "add") return openPicker(S);
        if (what === "save") return save(S);
        return;
      }
      const row = e.target.closest(".oe-row");
      const opBtn = e.target.closest("[data-op]");
      if (row && opBtn) {
        const r = S.rows[Number(row.dataset.i)];
        const op = opBtn.dataset.op;
        if (op === "inc" && r.qty < MAX_QTY) r.qty++;
        else if (op === "dec" && r.qty > 1) r.qty--;
        else if (op === "na") { r.na = true; r.variant = r.origVariant; r.unit = r.origUnit; autoReason(S); }
        else if (op === "rm") { if (r.orig) r.gone = true; else S.rows.splice(Number(row.dataset.i), 1); }
        else if (op === "undo") { r.na = false; r.gone = false; }
        paintItems(S);
        schedulePreview(S);
        return;
      }
      const sz = e.target.closest("[data-sz]");
      if (sz && row) {
        const r = S.rows[Number(row.dataset.i)];
        const p = catalog ? catalog.get(r.productId) : null;
        const z = sizesOf(p).find((x) => x.v === sz.dataset.sz);
        if (!z) return;
        r.variant = z.v;
        r.label = z.label;
        r.unit = z.v === r.origVariant ? r.origUnit : Number(z.price);
        paintItems(S);
        schedulePreview(S);
      }
    });
  }

  /** "Not available" was tapped: the matching reason is picked for the shop (it can still be changed). */
  function autoReason(S) {
    if (S.reason !== "") return;
    const reasons = (st && st.reasons) || [];
    const i = reasons.findIndex((r) => /not available|out of stock|unavailable/i.test(r));
    if (i < 0) return;
    S.reason = String(i);
    const radio = S.el.querySelector(`input[name="oe-reason"][value="${i}"]`);
    if (radio) radio.checked = true;
  }

  async function tryClose(S) {
    if (S.busy) return;
    const typed = ["customerName", "flatNo", "addressLine", "landmark", "notes"].some((k) => {
      const v = S.el.querySelector(`[data-f="${k}"]`);
      return v && v.value !== (k === "customerName" ? S.order.customerName : (S.order[k] == null ? "" : S.order[k]));
    });
    if ((isDirty(S) || typed) && window.AdminConfirm) {
      const sure = await window.AdminConfirm.ask({ title: "Discard your changes?", message: "Nothing has been saved yet.", confirmText: "Yes, discard", cancelText: "Keep editing", tone: "danger", icon: "⚠️" });
      if (!sure) return;
    }
    close();
  }

  function close() {
    if (!sheet) return;
    clearTimeout(sheet.timer);
    if (sheet.unfit) sheet.unfit();
    sheet.el.remove();
    sheet = null;
    unlock();
  }

  async function save(S) {
    if (S.busy || !S.preview || S.reason === "") return;
    if (otherMissing(S)) { const n = S.el.querySelector('[data-f="note"]'); if (n) n.focus(); return; }
    const p = S.preview;
    if (window.AdminConfirm) {
      const sure = await window.AdminConfirm.ask({
        title: `Save changes to ${S.order.orderCode}?`,
        message: `The new total is ${Utils.formatMoney(p.total)}${Number(p.diff) ? ` (was ${Utils.formatMoney(p.oldTotal)})` : ""}. The customer is told about the change.`,
        confirmText: "Yes, save",
        tone: "gold",
        icon: "✏️",
      });
      if (!sure) return;
    }
    S.busy = true;
    paintFoot(S);
    const body = { ...request(S), expectedTotal: p.total };
    try {
      const order = await Api.post(`/api/admin/orders/${S.order.id}/edit`, body);
      window.dispatchEvent(new CustomEvent("freshcutz:orderedit", { detail: { order, local: true } }));
      if (body.saveToProfile) toast(order && order.profileSaved ? "Order updated, and the customer's saved address too" : "Order updated, but the saved address was NOT changed (restart the backend so it has the latest code)", order && order.profileSaved ? "success" : "error");
      else toast("Order updated", "success");
      close();
    } catch (err) {
      S.busy = false;
      S.previewErr = err && err.message ? err.message : "Couldn't save";
      S.preview = null;
      paintSum(S);
      paintFoot(S);
      toast(S.previewErr, "error");
      if (/changed meanwhile/i.test(S.previewErr)) schedulePreview(S);
    }
  }

  // ---- adding an item ---------------------------------------------------------------------------------------

  function openPicker(S) {
    const over = S.el.querySelector("[data-over]");
    over.hidden = false;
    over.innerHTML = `<div class="oe-card">
      <div class="oe-card-top"><h3>Add an item</h3><button type="button" class="oe-x oe-x-dark" data-pk="close" aria-label="Close">✕</button></div>
      <input type="text" class="oe-search" data-pk-q placeholder="Search products" autocomplete="off" />
      <div class="oe-pick-list" data-pk-list><p class="oe-fine">Loading products…</p></div></div>`;
    const list = over.querySelector("[data-pk-list]");
    const q = over.querySelector("[data-pk-q]");
    // the list is searched on the server and comes back 30 rows at a time (never the whole catalog); the search is asked for once the typing pauses
    let seq = 0, timer = null, shown = [];
    const draw = (rows, failed) => {
      if (failed) { list.innerHTML = `<p class="oe-fine">Couldn't load the products.</p>`; return; }
      shown = rows;
      list.innerHTML = rows.length ? rows.map((p) => {
        const sizes = sizesOf(p);
        return `<div class="oe-pk${p.on ? "" : " is-off"}"><div class="oe-pk-name">${esc(p.name)}${p.on ? "" : `<small>Out of stock / hidden</small>`}</div>` +
          `<div class="oe-pk-sizes">${sizes.map((z) => `<button type="button" class="oe-size" data-pk-add="${p.id}|${z.v}"${p.on ? "" : " disabled"}>${esc(z.label)} · ${money(z.price)}</button>`).join("")}</div></div>`;
      }).join("") : `<p class="oe-fine">No products match.</p>`;
    };
    const search = () => {
      const term = q.value.trim().toLowerCase();
      const have = searchLocal(term);
      if (have) { draw(have); return; }
      const mine = ++seq;
      Api.get("/api/admin/orders/edit-products?limit=" + SEARCH_PAGE + (term ? "&q=" + encodeURIComponent(term) : ""))
        .then((rows) => {
          rows = rows || [];
          searched.set(term, { rows, at: Date.now() });
          rows.forEach(put);
          if (mine === seq) draw(rows);
        })
        .catch(() => { if (mine === seq) draw([], true); });
    };
    search();
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    over.onclick = (e) => {
      if (e.target === over || e.target.closest("[data-pk='close']")) { over.hidden = true; over.innerHTML = ""; return; }
      const add = e.target.closest("[data-pk-add]");
      if (!add) return;
      const [id, v] = add.dataset.pkAdd.split("|");
      const p = shown.find((x) => x.id === Number(id)) || (catalog && catalog.get(Number(id)));
      const z = sizesOf(p).find((x) => x.v === v);
      if (!p || !z) return;
      const have = S.rows.find((r) => r.productId === p.id && r.variant === v);
      if (have) { have.gone = false; have.na = false; if (have.qty < MAX_QTY) have.qty++; }
      else S.rows.push({ productId: p.id, name: p.name, label: z.label, variant: v, origVariant: v, unit: Number(z.price), origUnit: Number(z.price), qty: 1, origQty: 0, orig: false, na: false, gone: false });
      over.hidden = true;
      over.innerHTML = "";
      paintItems(S);
      schedulePreview(S);
      toast(`${p.name} added`, "success");
    };
    setTimeout(() => { try { q.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }, 60);
  }

  // ---- history: every change ever made to the order -------------------------------------------------------------

  async function history(order) {
    if (hist || !order) return;
    lock();
    const el = document.createElement("div");
    el.className = "oe-sheet oe-hist";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Changes to this order");
    el.innerHTML = `<div class="oe-top"><button type="button" class="oe-x" data-h="close" aria-label="Close">✕</button><span class="oe-title">Changes · ${esc(order.orderCode)}</span></div>
      <div class="oe-body" data-hbody><p class="oe-fine">Loading…</p></div>`;
    document.body.appendChild(el);
    hist = el;
    el.addEventListener("click", (e) => { if (e.target.closest("[data-h='close']")) { el.remove(); hist = null; unlock(); } });
    try {
      const rows = await Api.get(`/api/admin/orders/${order.id}/edits`);
      if (hist !== el) return;
      const body = el.querySelector("[data-hbody]");
      if (!rows.length) { body.innerHTML = `<p class="oe-fine">No changes were made to this order.</p>`; return; }
      const first = rows.find((r) => r.before);
      const orig = first && first.before;
      body.innerHTML = (orig ? `<div class="oe-h-card is-orig"><div class="oe-h-top"><b>Original order</b><span>${money(orig.total)}</span></div>` +
        `${(orig.items || []).map((i) => `<div class="oe-h-line">${esc(i.qty)} × ${esc(i.name)} (${esc(i.label)}) — ${money(i.lineTotal)}</div>`).join("")}` +
        `<div class="oe-h-line oe-h-addr">🏠 ${esc(orig.flatNo)}, ${esc(orig.addressLine)}</div></div>` : "") +
        rows.map((r) => `<div class="oe-h-card"><div class="oe-h-top"><b>${r.byCustomer ? "👤 Customer" : "🧑‍💼 " + esc(r.by || "Shop")}</b><span>${esc(Utils.formatDateTime(r.at))}</span></div>` +
          `${r.reason ? `<div class="oe-h-reason">${esc(r.reason)}</div>` : ""}` +
          `${(r.changes || []).map((c) => `<div class="oe-h-line">• ${esc(c)}</div>`).join("")}` +
          `${r.totalBefore != null && Number(r.totalBefore) !== Number(r.totalAfter) ? `<div class="oe-h-tot">${money(r.totalBefore)} → <b>${money(r.totalAfter)}</b></div>` : ""}</div>`).join("");
    } catch (err) {
      const body = el.querySelector("[data-hbody]");
      if (body) body.innerHTML = `<p class="oe-err">${esc(err && err.message ? err.message : "Couldn't load the changes")}</p>`;
    }
  }

  // ---- the money difference is settled --------------------------------------------------------------------------

  async function settle(order) {
    if (!order || !order.payDelta) return;
    const d = Number(order.payDelta);
    if (window.AdminConfirm) {
      const sure = await window.AdminConfirm.ask({
        title: d > 0 ? "Collected the extra amount?" : "Refund done?",
        message: d > 0 ? `${order.orderCode}: you collected ${Utils.formatMoney(d)} more from the customer.` : `${order.orderCode}: you refunded ${Utils.formatMoney(-d)} to the customer.`,
        confirmText: d > 0 ? "Yes, collected" : "Yes, refunded",
        tone: "ok",
        icon: "✓",
      });
      if (!sure) return;
    }
    try {
      const updated = await Api.patch(`/api/admin/orders/${order.id}/edit-settled`);
      window.dispatchEvent(new CustomEvent("freshcutz:orderedit", { detail: { order: updated, local: true } }));
      toast("Marked as settled", "success");
    } catch (err) {
      toast(err && err.message ? err.message : "Couldn't update", "error");
    }
  }

  return { canEdit, open, history, settle, cardHtml, itemsHtml, reload: () => loadState(true) };
})();
