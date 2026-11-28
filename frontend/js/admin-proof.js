/* Admin: the screenshot a customer uploaded to show their UPI payment.
 *
 * Every UPI order card gets this payment line (see lineHtml, used by the Orders and Sales order cards): whether a
 * screenshot was uploaded (a small View button, or "No screenshot") and the admin's own payment status (Pending, Verified,
 * Rejected ...; the customer is never shown it). Who may change it depends on the
 * UPI payments access given in Settings > Users ("View & edit" gets a Change link). Tapping View opens the picture full screen next to the amount to check, with the
 * same status. The picture is fetched with the admin's sign-in (a plain image link could not carry it) and the last few
 * are kept in memory while the page is open, so opening one again asks the server for nothing. */

window.AdminProof = (() => {
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  let overlay = null;
  // screenshots already fetched: `${order id}|${when it was uploaded}` -> object URL (a newer upload has a new key, so it is fetched again)
  const shots = new Map();
  const SHOTS_MAX = 20;

  // [code kept on the order, words shown, colour]. No code at all = Pending. (NOT_RECEIVED was the first version's word for Rejected.)
  const STATUSES = [
    ["", "Pending", "pending"],
    ["VERIFIED", "Verified", "ok"],
    ["REJECTED", "Rejected", "bad"],
    ["REVIEW", "Under Review", "warn"],
    ["HOLD", "On Hold", "warn"],
    ["SUSPICIOUS", "Suspicious", "alert"],
    ["DUPLICATE", "Duplicate", "alert"],
    ["FAILED", "Payment Failed", "bad"],
    ["PARTIAL", "Partially Paid", "warn"],
    ["REFUNDED", "Refunded", "info"],
    ["FRAUD", "Fraud", "fraud"],
  ];
  // An order whose screenshot was removed after 30 days (not Fraud ones) has its upload time set to the very first moment (1970-01-01).
  const GONE = "1970-01-01T00:00:00Z";
  /** What an order's upload time says: a screenshot to view, a deleted one, or none. `at` tells a newer upload from one already fetched. */
  function proofState(raw) {
    const deleted = raw === 0 || (typeof raw === "string" && raw !== "" && Date.parse(raw) <= 0);
    return { has: !!raw && !deleted, deleted, at: deleted ? GONE : typeof raw === "string" ? raw : "" };
  }
  const norm = (c) => (c === "NOT_RECEIVED" ? "REJECTED" : c || "");
  // Cash on delivery uses the same control with its own words: "" = Pending (collect it all), RECEIVED = already paid in full,
  // PART:<rupees> = part of it already paid (the rest is collected on delivery). The select shows "PART"; the amount is typed beside it.
  const COD_OPTIONS = [["", "Pending", "pending"], ["RECEIVED", "Received", "ok"], ["PART", "Partially received", "warn"]];
  const isCod = (mode) => mode === "COD";
  const partOf = (c) => (typeof c === "string" && c.startsWith("PART:") ? Number(c.slice(5)) || 0 : 0);
  const statusOf = (c) => {
    const v = norm(c);
    if (v === "RECEIVED") return COD_OPTIONS[1];
    if (v === "PART") return COD_OPTIONS[2];
    if (v.startsWith("PART:")) return [v, `Partially received ₹${partOf(v)}`, "warn"];
    return STATUSES.find((s) => s[0] === v) || STATUSES[0];
  };

  /** What this signed-in person may do with UPI payments (Settings > Users > Payments). The server checks again on every request. */
  const canSee = () => !window.AdminAccess || AdminAccess.can("payments", "VIEW");
  const canEdit = () => !window.AdminAccess || AdminAccess.can("payments", "EDIT");
  /** The payment status can be changed only for this long after the order was delivered or cancelled (the screenshot goes after the same
   * time); an order that is still open can always be changed. `closedAt` = when it was closed, in ms (0 = still open). */
  const CHANGE_DAYS = 30;
  const closedAtOf = (o) => (o && (o.status === "DELIVERED" || o.status === "CANCELLED") ? Date.parse(o.statusUpdatedAt) || 0 : 0);
  const isLocked = (closedAt) => !!closedAt && Date.now() - Number(closedAt) > CHANGE_DAYS * 86400000;

  // ---- the payment status: a small coloured pill; whoever may change it also gets "Change" -> drop-down + Update / Cancel ----

  const optionsHtml = (value, mode) => (isCod(mode) ? COD_OPTIONS : STATUSES).map((s) => `<option value="${s[0]}"${s[0] === value ? " selected" : ""}>${esc(s[1])}</option>`).join("");
  const toneOf = (c) => `tone-${statusOf(c)[2]}`;

  /** What a status control shows normally: the pill (and "Change" for someone who may change it). */
  function viewInner(check, locked, total) {
    let [, label, tone] = statusOf(check);
    // cash part-received, but the order now costs less (it was edited down): say so - "Partially received" would be wrong
    const part = partOf(check);
    const tot = Number(total);
    if (part > 0 && tot > 0 && part >= tot) {
      const money = (n) => `₹${Math.round(n * 100) / 100}`;
      label = part > tot ? `Overpaid ${money(part - tot)} · received ${money(part)}` : `Received in full ${money(part)}`;
      tone = part > tot ? "warn" : "ok";
    }
    return `<span class="pay-pill tone-${tone}">${esc(label)}</span>${canEdit() && !locked ? `<button type="button" class="pay-act pay-change" data-action="pay-change">Change</button>` : ""}`;
  }
  /** While changing: the drop-down in place of the pill, then Update (only once something different is picked) and Cancel. */
  function editInner(committed, value, mode) {
    const cod = isCod(mode);
    if (cod && value.startsWith("PART:")) value = "PART"; // the amount goes in the box beside it
    return `<span class="pay-sel ${toneOf(value)}"><select data-role="pay-select" aria-label="Payment status">${optionsHtml(value, mode)}</select></span>` +
      (cod ? `<input type="number" class="pay-amt" data-role="pay-amt" inputmode="numeric" min="1" step="1" placeholder="Paid ₹" aria-label="Amount already paid, in rupees" value="${partOf(committed) || ""}"${value === "PART" ? "" : " hidden"} />` : "") +
      `<button type="button" class="pay-act pay-update" data-action="pay-update" hidden>Update</button>` +
      `<button type="button" class="pay-act pay-cancel" data-action="pay-cancel">Cancel</button>`;
  }
  function statusControl(id, check, locked, mode, total) {
    return `<span class="pay-ctl" data-id="${esc(id)}" data-check="${esc(norm(check))}"${mode ? ` data-mode="${esc(mode)}"` : ""}${locked ? ' data-locked="1"' : ""}${total != null ? ` data-total="${esc(total)}"` : ""}>${viewInner(check, locked, total)}</span>`;
  }

  let measure = null;
  /** Makes a drop-down only as wide as the words it shows (a native one is as wide as its longest choice). */
  function fit(sel) {
    if (!sel) return;
    try {
      measure = measure || document.createElement("canvas").getContext("2d");
      const cs = getComputedStyle(sel);
      measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = measure.measureText(sel.options[sel.selectedIndex].text).width;
      sel.style.width = `${Math.ceil(w) + 40}px`;
    } catch (e) { /* leaves the natural width */ }
  }
  function enterEdit(ctl, value) {
    if (!ctl) return;
    ctl.classList.add("is-editing");
    ctl.innerHTML = editInner(ctl.dataset.check || "", value, ctl.dataset.mode);
    fit(ctl.querySelector("select"));
    syncUpdate(ctl); // Update shows only once the pick differs from what is saved
  }
  function leaveEdit(ctl, committed) {
    ctl.classList.remove("is-editing");
    ctl.dataset.check = committed || "";
    ctl.innerHTML = viewInner(committed, ctl.dataset.locked, ctl.dataset.total);
  }

  /** The whole payment line of a UPI order card, by what this person may see: nothing but "UPI" without being able to see
   * payments; otherwise whether there is a screenshot (a View button, or "No screenshot") and the status. Used by the Orders
   * and Sales cards. */
  function upiSpan(order) {
    const cod = isCod(order.paymentMode);
    const { has, deleted, at } = proofState(order.paymentProofAt);
    const closedAt = order.closedAt !== undefined ? Number(order.closedAt) || 0 : closedAtOf(order);
    const locked = isLocked(closedAt);
    const check = norm(order.paymentCheck);
    const head = `<span class="upi-line" data-id="${esc(order.id)}" data-code="${esc(order.orderCode)}" data-amount="${esc(order.totalAmount)}" data-proof="${has ? "1" : ""}" data-at="${esc(at)}" data-check="${esc(check)}" data-closed="${closedAt || ""}" data-mode="${cod ? "COD" : "UPI"}"${Number(order.payDelta) < 0 ? ` data-refund="${esc(-Number(order.payDelta))}"` : ""}>${cod ? "💵 Payment: Cash on delivery" : "📲 Payment: UPI"}`;
    if (cod) return `${head} ${statusControl(order.id, check, locked, "COD", order.totalAmount)}</span>`; // everyone sees whether cash is still due; changing it needs UPI payments "View & edit"
    if (!canSee()) return `${head}</span>`;
    const shot = has
      ? ` <button type="button" class="proof-link" data-action="proof-view" data-id="${esc(order.id)}" data-code="${esc(order.orderCode)}" data-amount="${esc(order.totalAmount)}" data-at="${esc(at)}">📎 View</button>`
      : ` <span class="pay-note">(${deleted ? "Screenshot deleted" : "No screenshot"})</span>`;
    return `${head}${shot} ${statusControl(order.id, check, locked)}</span>`;
  }
  function lineHtml(order) {
    if (!order || (order.paymentMode !== "UPI" && order.paymentMode !== "COD") || !order.id) return "";
    return `<br/>${upiSpan(order)}`;
  }

  /** Something about one UPI payment changed (a screenshot arrived, or an admin set a status): redraw that line everywhere on
   * screen, and the open viewer's status. A line that already shows exactly this is left alone. Someone in the middle of
   * choosing a status keeps their open drop-down (and what they picked). Orders and Sales keep their own copies in step by
   * listening to the same event. */
  function patchLines(root, p) {
    const check = norm(p.paymentCheck);
    root.querySelectorAll(".upi-line").forEach((el) => {
      if (String(el.dataset.id) !== String(p.id)) return;
      const st = proofState(p.paymentProofAt !== undefined ? p.paymentProofAt : el.dataset.at || (el.dataset.proof ? true : null));
      if ((el.dataset.check || "") === check && !!el.dataset.proof === st.has && (el.dataset.at || "") === st.at) return;
      const ctl = el.querySelector(".pay-ctl.is-editing");
      const picking = ctl ? ctl.querySelector("select").value : null;
      el.insertAdjacentHTML("afterend", upiSpan({
        id: el.dataset.id,
        orderCode: el.dataset.code,
        totalAmount: el.dataset.amount,
        paymentProofAt: st.has ? st.at || true : st.deleted ? GONE : null,
        paymentCheck: check,
        paymentMode: el.dataset.mode || "UPI",
        closedAt: el.dataset.closed,
      }));
      const fresh = el.nextElementSibling;
      el.remove();
      if (picking !== null && fresh) enterEdit(fresh.querySelector(".pay-ctl"), picking);
    });
  }

  /** The same change applied to a remembered piece of HTML (Sales keeps each opened order's detail): nothing is read again. */
  function patch(html, p) {
    const box = document.createElement("div");
    box.innerHTML = html;
    patchLines(box, p);
    return box.innerHTML;
  }

  window.addEventListener("freshcutz:payment", (e) => {
    const p = e.detail;
    if (!p || p.id == null) return;
    const check = norm(p.paymentCheck);
    patchLines(document, p);
    if (overlay && String(overlay.dataset.id) === String(p.id)) {
      const holder = overlay.querySelector('[data-role="pv-btns"]');
      const ctl = holder && holder.querySelector(".pay-ctl");
      if (ctl && ctl.classList.contains("is-editing")) {
        ctl.dataset.check = check;
        syncUpdate(ctl);
      } else if (holder && (!ctl || ctl.dataset.check !== check)) {
        holder.innerHTML = statusControl(p.id, check, overlay.dataset.locked);
      }
    }
  });

  /** Whether what is picked (and, for "Partially received", typed) differs from what is saved. */
  function changed(ctl) {
    const sel = ctl.querySelector("select");
    if (!sel) return false;
    const was = ctl.dataset.check || "";
    if (sel.value === "PART") {
      const amt = ctl.querySelector(".pay-amt");
      const v = amt ? amt.value.trim() : "";
      return v !== "" && `PART:${Number(v)}` !== was;
    }
    return sel.value !== was;
  }

  /** Update shows only while the pick differs from what is saved. */
  function syncUpdate(ctl) {
    const up = ctl.querySelector(".pay-update");
    if (up) up.hidden = !changed(ctl);
  }

  // Picking in the drop-down: the colour follows the pick, the width follows the words, Update appears if it is a real change.
  document.addEventListener("change", (e) => {
    const sel = e.target.closest('select[data-role="pay-select"]');
    if (!sel) return;
    const ctl = sel.closest(".pay-ctl");
    sel.closest(".pay-sel").className = `pay-sel ${toneOf(sel.value)}`;
    fit(sel);
    const amt = ctl && ctl.querySelector(".pay-amt");
    if (amt) { amt.hidden = sel.value !== "PART"; if (!amt.hidden) amt.focus(); }
    if (ctl) syncUpdate(ctl);
  });
  document.addEventListener("input", (e) => {
    const amt = e.target.closest && e.target.closest(".pay-amt");
    const ctl = amt && amt.closest(".pay-ctl");
    if (ctl) syncUpdate(ctl);
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='pay-change'], [data-action='pay-cancel'], [data-action='pay-update']");
    if (!btn) return;
    e.preventDefault();
    const ctl = btn.closest(".pay-ctl");
    if (!ctl) return;
    const action = btn.dataset.action;
    if (action === "pay-change") return enterEdit(ctl, ctl.dataset.check || "");
    if (action === "pay-cancel") return leaveEdit(ctl, ctl.dataset.check || "");
    // Update: saved now; nothing is saved before this tap.
    const sel = ctl.querySelector("select");
    if (!sel) return;
    const id = ctl.dataset.id;
    let next = sel.value;
    if (next === "PART") { // cash on delivery, part paid: the amount typed beside it
      const amt = Number((ctl.querySelector(".pay-amt") || {}).value);
      const total = Number((ctl.closest(".upi-line") || { dataset: {} }).dataset.amount) || 0;
      if (!Number.isInteger(amt) || amt <= 0) { if (window.Toast) Toast.show("Enter how much was already paid, in rupees", "error"); return; }
      if (total && amt >= total) { if (window.Toast) Toast.show("That is the whole amount: choose Received instead", "error"); return; }
      next = `PART:${amt}`;
    }
    // cash marked Received / Partially received while a refund of an edit is still waiting: the cash the shop holds then includes it, so ask
    // whether the refund has been given back (the customer's "already paid" amount depends on it)
    let alsoSettle = false;
    const lineEl = ctl.closest(".upi-line");
    const refund = lineEl ? Number(lineEl.dataset.refund) : 0;
    if (refund > 0 && (next === "RECEIVED" || next.startsWith("PART:")) && window.AdminConfirm) {
      alsoSettle = await window.AdminConfirm.ask({
        title: `A ${Utils.formatMoney(refund)} refund is still pending`,
        message: `${lineEl.dataset.code}: marking the payment ${next === "RECEIVED" ? "Received" : "Partially received"} does not clear the refund. If you have already given the ${Utils.formatMoney(refund)} back, mark it settled too.`,
        confirmText: "Yes, mark settled",
        cancelText: "No, leave it",
        tone: "ok",
        icon: "↩",
      });
    }
    ctl.querySelectorAll("select, input, button").forEach((x) => (x.disabled = true));
    try {
      const res = await Api.patch(`/api/admin/orders/${encodeURIComponent(id)}/payment-check`, { check: next || null });
      if (alsoSettle) {
        try {
          const updated = await Api.patch(`/api/admin/orders/${encodeURIComponent(id)}/edit-settled`);
          window.dispatchEvent(new CustomEvent("freshcutz:orderedit", { detail: { order: updated, local: true } }));
          if (lineEl) delete lineEl.dataset.refund;
          if (window.Toast) Toast.show("Refund marked as settled", "success");
        } catch (err) {
          if (window.Toast) Toast.show(err && err.message ? err.message : "The status was saved, but the refund could not be marked settled", "error");
        }
      }
      const saved = norm(res && res.paymentCheck);
      leaveEdit(ctl, saved);
      const line = ctl.closest(".upi-line");
      if (line) line.dataset.check = saved;
      window.dispatchEvent(new CustomEvent("freshcutz:payment", { detail: { id: Number(id), paymentCheck: saved || null } }));
    } catch (err) {
      ctl.querySelectorAll("select, input, button").forEach((x) => (x.disabled = false));
      if (window.Toast) Toast.show(err && err.message ? err.message : "Could not save", "error");
    }
  });

  function close() {
    if (overlay) overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  /** Keeps a fetched screenshot (the most recent SHOTS_MAX; one per order) so opening it again costs no request. */
  function remember(key, id, url) {
    for (const [k, u] of shots) {
      if (k.startsWith(`${id}|`) && k !== key) {
        URL.revokeObjectURL(u);
        shots.delete(k);
      }
    }
    if (shots.has(key)) shots.delete(key);
    else if (shots.size >= SHOTS_MAX) {
      const oldest = shots.keys().next().value;
      URL.revokeObjectURL(shots.get(oldest));
      shots.delete(oldest);
    }
    shots.set(key, url);
  }

  async function open(id, code, amount, check, at, closedAt) {
    close();
    overlay = document.createElement("div");
    overlay.className = "pv-overlay";
    overlay.dataset.id = id;
    overlay.dataset.locked = isLocked(closedAt) ? "1" : "";
    overlay.innerHTML = `
      <div class="pv-panel" role="dialog" aria-label="Payment screenshot">
        <div class="pv-head">
          <div><div class="pv-title">Payment screenshot — ${esc(code)}</div><div class="pv-check">Check: <b>${esc(Utils.formatMoney(amount))}</b> received</div></div>
          <button type="button" class="pv-close" data-role="pv-close" aria-label="Close">✕</button>
        </div>
        <div class="pv-body" data-role="pv-body"><div class="pv-msg">Loading…</div></div>
        <div class="pv-foot"><span class="pv-hint">Tap the picture to zoom.</span><span data-role="pv-btns">${statusControl(id, check, overlay.dataset.locked)}</span></div>
      </div>`;
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest('[data-role="pv-close"]')) close();
    });
    const mine = overlay;
    const body = overlay.querySelector('[data-role="pv-body"]');
    try {
      const key = `${id}|${at || ""}`;
      let url = shots.get(key);
      if (url) remember(key, id, url); // opened again: the one fetched earlier is used (and counts as recent)
      else {
        const { blob } = await Api.downloadBlob(`/api/admin/orders/${encodeURIComponent(id)}/payment-proof`);
        url = URL.createObjectURL(blob);
        remember(key, id, url);
      }
      if (overlay !== mine) return; // closed (or another one opened) while it loaded
      body.innerHTML = `<img class="pv-img" alt="Payment screenshot for ${esc(code)}" src="${url}" />`;
      body.querySelector("img").addEventListener("click", () => body.classList.toggle("is-zoomed"));
    } catch (err) {
      if (overlay !== mine) return;
      body.innerHTML = `<div class="pv-msg">${esc(/no payment screenshot/i.test(err.message) ? "The customer hasn't uploaded a screenshot for this order yet." : err.message)}</div>`;
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="proof-view"]');
    if (!btn) return;
    e.preventDefault();
    const line = btn.closest(".upi-line");
    open(btn.dataset.id, btn.dataset.code, btn.dataset.amount, line ? line.dataset.check : "", btn.dataset.at, line ? line.dataset.closed : "");
  });

  return { lineHtml, open, close, patch };
})();
