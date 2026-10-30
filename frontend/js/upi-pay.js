/* Payment mode on the customer website.
 *
 *  - Final Step: "Payment mode" radio buttons - Cash on delivery and UPI (UPI shows "Google Pay, PhonePe, Paytm & more" and the
 *    app icons once ticked). Which one starts ticked - or none - is the admin's choice (Customize > Payment options); with none
 *    ticked the customer has to choose before "Place Order" goes through (see validate). The wording and the UPI ID come from
 *    the admin's Customize tab (SiteCustomize.payment()).
 *  - Order Placed screen, UPI orders only (iPhone / iPad: the three app icons instead of "Pay now", each opens its own app): a "Pay by UPI" card with one animated "Pay now" button that carries the Google Pay,
 *    PhonePe and Paytm icons. On a phone it opens the phone's own list of UPI apps with the UPI ID and the exact order
 *    total already filled in; on a computer it shows the QR code to scan with the phone. "Other ways to pay" holds the ID to
 *    copy and a QR code (hidden until asked for; made on the spot from the small library js/qrcode.min.js, which is only
 *    loaded when a QR is actually shown).
 *
 * The website cannot see whether a UPI payment really went through - the shop checks its own UPI app. */

window.UpiPay = (() => {
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isPhone = isIOS || /Android/i.test(ua);
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const rupees = (n) => Utils.formatMoney(n);

  // ---- Final Step: the radio buttons ----------------------------------------------------------
  const APPS = [
    { key: "gpay", name: "Google Pay" },
    { key: "phonepe", name: "PhonePe" },
    { key: "paytm", name: "Paytm" },
  ];
  const MORE = { key: "more", name: "More" };
  const iconImg = (a) => `<img src="images/upi/${a.key}.png" alt="${esc(a.name)}" width="40" height="40" loading="lazy" decoding="async" />`;

  /** "Payment mode" with two radio buttons; "" when the admin switched it off (or has no UPI ID, so there is nothing to choose).
   * The admin decides which one starts ticked (p.def); with nothing ticked the customer has to choose. */
  function optionsHtml() {
    const p = SiteCustomize.payment();
    if (!p.show) return "";
    const cod = p.def === "COD";
    const upi = p.def === "UPI";
    return `<div class="field pay-field" data-role="payment">
          <label id="pay-label">${esc(p.label)}</label>
          <div class="pay-opts" role="radiogroup" aria-labelledby="pay-label">
            <label class="pay-opt${cod ? " is-selected" : ""}"><input type="radio" name="paymentMode" value="COD"${cod ? " checked" : ""} /><span class="pay-opt-text"><span class="pay-opt-title">${esc(p.cod)}</span></span></label>
            <label class="pay-opt${upi ? " is-selected" : ""}"><input type="radio" name="paymentMode" value="UPI"${upi ? " checked" : ""} /><span class="pay-opt-text"><span class="pay-opt-title">${esc(p.upi)}</span><span class="pay-opt-sub">Google Pay, PhonePe, Paytm &amp; more</span><span class="pay-apps" aria-hidden="true">${APPS.map((a) => `<span class="pay-app">${iconImg(a)}</span>`).join("")}<span class="pay-app">${iconImg(MORE)}</span></span></span></label>
          </div>
          <div class="error" data-role="pay-err"></div>
        </div>`;
  }

  /** Makes the radio buttons work (call after the sheet is drawn). */
  function wire(sheet) {
    const box = sheet.querySelector('[data-role="payment"]');
    if (!box) return;
    const update = () => {
      const mode = box.querySelector('input[name="paymentMode"]:checked')?.value;
      box.querySelectorAll(".pay-opt").forEach((l) => l.classList.toggle("is-selected", l.querySelector("input").checked));
      // the bottom bar says "Total (Cash on Delivery)" only once Cash on delivery is chosen
      const totalLabel = sheet.querySelector(".sheet-footer .summary-row.total span");
      if (totalLabel) totalLabel.textContent = SiteCustomize.text(mode === "COD" ? "codTotalLabel" : "totalLabel");
      if (mode) box.querySelector('[data-role="pay-err"]').textContent = "";
    };
    box.addEventListener("change", update);
    update();
  }

  /** "Place Order" check: true when the payment section is not shown or one choice is ticked. With nothing ticked it says so
   * under the choices, scrolls there and returns false. */
  function validate(sheet) {
    const box = sheet.querySelector('[data-role="payment"]');
    if (!box || box.querySelector('input[name="paymentMode"]:checked')) return true;
    box.querySelector('[data-role="pay-err"]').textContent = "Please choose how you'll pay";
    // scroll the Final Step's own scrolling area (not the page behind it) so the whole Payment mode section is on screen, then
    // make it blink once so the customer sees where to choose
    const area = box.closest(".sheet-body") || box.parentElement;
    const top = area.scrollTop + (box.getBoundingClientRect().top - area.getBoundingClientRect().top) - Math.max(12, (area.clientHeight - box.offsetHeight) / 2);
    try {
      area.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } catch {
      area.scrollTop = Math.max(0, top);
    }
    box.classList.remove("pay-attn");
    void box.offsetWidth; // (restarts the blink when tapped again)
    box.classList.add("pay-attn");
    return false;
  }

  // ---- Order Placed: pay with UPI -------------------------------------------------------------
  function params(order) {
    const p = SiteCustomize.payment();
    const amount = Number(order.totalAmount || 0).toFixed(2);
    // plain ASCII only (the name and note are percent-encoded), so the QR code and the link carry exactly the same text
    return `pa=${p.id}&pn=${encodeURIComponent(p.name)}&am=${amount}&cu=INR&tn=${encodeURIComponent("Order " + order.orderCode)}`;
  }

  const orderByCode = {}; // the orders whose card is on screen (the buttons below look the order up by its code)
  const openForgot = new Set(); // My Orders: "Forgot to pay?" sections the customer has opened (kept when the list redraws)

  /** iPhone / iPad: iOS has no list of UPI apps - the plain upi:// link goes to whichever app claimed it (often WhatsApp). So instead of
   * "Pay now" the customer gets the app icons, and each opens its own app with the UPI ID and the exact total already filled in. */
  const IOS_LINKS = { gpay: "gpay://upi/pay?", phonepe: "phonepe://pay?", paytm: "paytmmp://pay?" };
  function iosAppsHtml(q) {
    return `<div class="upi-ios-apps" role="group" aria-label="Pay with your UPI app">${APPS.map((a) => `<a class="upi-ios-app" data-role="upi-app" href="${IOS_LINKS[a.key]}${q}" aria-label="Pay with ${esc(a.name)}"><img src="images/upi/${a.key}.png" alt="${esc(a.name)}" width="46" height="46" decoding="async" /></a>`).join("")}</div>`;
  }

  function cardHtml(order, noProof) {
    if (!order || order.paymentMode !== "UPI") return "";
    const p = SiteCustomize.payment();
    if (!p.id) return "";
    if (order.orderCode) orderByCode[order.orderCode] = order;
    const q = params(order);
    const icons = APPS.map((a) => `<img src="images/upi/${a.key}.png" alt="" width="22" height="22" decoding="async" />`).join("");
    return `<div class="upi-card" data-role="upi-card" data-code="${esc(order.orderCode || "")}">
        <div class="upi-title">Pay ${esc(rupees(order.totalAmount))} by UPI</div>
        ${isIOS ? iosAppsHtml(q) : `<a class="btn btn-gold upi-paynow" data-role="upi-paynow" href="${isPhone ? `upi://pay?${q}` : "#"}" aria-label="Pay now - opens your UPI apps"><span class="upi-paynow-text">Pay now</span><span class="upi-paynow-icons" aria-hidden="true">${icons}</span></a>`}
        <div class="upi-idrow"><span class="upi-id" data-role="upi-id">${esc(p.id)}</span><button type="button" class="btn btn-outline btn-sm upi-copy-main" data-role="upi-copy" data-label="Copy">Copy</button></div>
        <button type="button" class="upi-other" data-role="upi-other-toggle" aria-expanded="false">Other ways to pay <span class="upi-other-arrow" aria-hidden="true">›</span></button>
        <div class="upi-other-body" data-role="upi-other-body" hidden>
          <div class="upi-actions">
            <button type="button" class="btn btn-outline btn-sm" data-role="upi-qr">Show QR code</button>
          </div>
          <div class="upi-qr" data-role="upi-qr-box" hidden></div>
        </div>
        ${noProof ? "" : proofHtml(order, order.phone)}
      </div>`;
  }

  /** Paying (or uploading a screenshot) only makes sense while the order is still open: new or packed. One rule, used by the
   * My Orders section, the upload box and the live status change (see settle). */
  const isOpen = (status) => !status || status === "NEW" || status === "PACKED";

  /** My Orders: a small "Forgot to pay? Pay now" line on a UPI order that has no screenshot yet. Tapping it opens the same
   * payment card as on Order Placed. "" once a screenshot was uploaded, for cash orders, and for delivered / cancelled orders. */
  function forgotHtml(order) {
    if (!order || order.paymentMode !== "UPI" || !order.orderCode || order.paymentProofAt) return "";
    if (!isOpen(order.status)) return "";
    if (!SiteCustomize.payment().proof) return "";
    // the screenshot upload is always visible under the line; only the payment card folds away
    const upload = proofHtml(order, order.phone, "", "Already paid?");
    const card = cardHtml(order, true);
    if (!card) return upload;
    const open = openForgot.has(order.orderCode);
    return `<div class="upi-forgot${open ? " is-open" : ""}" data-role="upi-forgot" data-code="${esc(order.orderCode)}">
        <button type="button" class="upi-forgot-btn" data-role="forgot-toggle" aria-expanded="${open}">Forgot to pay? <b>Pay now</b> <span class="upi-forgot-arrow" aria-hidden="true">›</span></button>
        <div class="upi-forgot-body" data-role="forgot-body"${open ? "" : " hidden"}>${card}</div>
        ${upload}
      </div>`;
  }

  let qrLoading = null;
  function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLoading) {
      qrLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "js/qrcode.min.js?v=1";
        s.onload = resolve;
        s.onerror = () => {
          qrLoading = null;
          reject(new Error("QR code could not be loaded"));
        };
        document.head.appendChild(s);
      });
    }
    return qrLoading;
  }

  async function drawQr(box, order) {
    try {
      await loadQrLib();
      const qr = window.qrcode(0, "M");
      qr.addData(`upi://pay?${params(order)}`);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
      const svg = box.querySelector("svg");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "UPI QR code");
      }
    } catch {
      box.textContent = "The QR code could not be shown - please use the UPI ID above.";
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function openOther(card, open) {
    const body = card.querySelector('[data-role="upi-other-body"]');
    const tg = card.querySelector('[data-role="upi-other-toggle"]');
    if (!body || !tg) return;
    body.hidden = !open;
    tg.setAttribute("aria-expanded", String(open));
    card.classList.toggle("is-other-open", open);
  }

  async function showQr(card) {
    const order = orderByCode[card.dataset.code];
    const box = card.querySelector('[data-role="upi-qr-box"]');
    const btn = card.querySelector('[data-role="upi-qr"]');
    if (!order || !box) return;
    openOther(card, true);
    box.hidden = false;
    if (!box.dataset.drawn) {
      box.dataset.drawn = "1";
      drawQr(box, order);
    }
    if (btn) btn.textContent = "Hide QR code";
  }

  /** The buttons of every payment card (Order Placed and My Orders) - one listener, so a redrawn list keeps working. The QR code
   * stays hidden until asked for (the button, or - on a computer - a tap on "Pay now"). */
  document.addEventListener("click", async (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-role="forgot-toggle"],[data-role="upi-other-toggle"],[data-role="upi-paynow"],[data-role="upi-app"],[data-role="upi-qr"],[data-role="upi-copy"]') : null;
    if (!t) return;
    const role = t.dataset.role;
    if (role === "forgot-toggle") {
      const wrap = t.closest('[data-role="upi-forgot"]');
      const body = wrap.querySelector('[data-role="forgot-body"]');
      const open = body.hidden;
      body.hidden = !open;
      wrap.classList.toggle("is-open", open);
      t.setAttribute("aria-expanded", String(open));
      if (open) openForgot.add(wrap.dataset.code);
      else openForgot.delete(wrap.dataset.code);
      return;
    }
    const card = t.closest('[data-role="upi-card"]');
    if (!card) return;
    if (isPhone && (role === "upi-paynow" || role === "upi-app" || role === "upi-copy")) paying = { code: card.dataset.code, away: false }; // off to a UPI app
    if (role === "upi-other-toggle") {
      openOther(card, card.querySelector('[data-role="upi-other-body"]').hidden);
    } else if (role === "upi-app") {
      return; // the link opens that app
    } else if (role === "upi-paynow") {
      if (isPhone) return; // the link opens the phone's own list of UPI apps
      e.preventDefault();
      const box = card.querySelector('[data-role="upi-qr-box"]');
      if (box && box.hidden) showQr(card);
    } else if (role === "upi-qr") {
      const box = card.querySelector('[data-role="upi-qr-box"]');
      if (box.hidden) return showQr(card);
      box.hidden = true;
      t.textContent = "Show QR code";
    } else if (role === "upi-copy") {
      const ok = await copyText(SiteCustomize.payment().id);
      t.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => (t.textContent = t.dataset.label || "Copy UPI ID"), 2200);
    }
  });

  /** Kept for the Order Placed screen: the card now works through the listener above, so there is nothing to wire. */
  function mountCard() {}

  // ---- payment screenshot (Order Placed screen and My Orders) --------------------------------------
  // The picture is shrunk on the phone first, to about 20 KB: [longest side in px, quality] from the sharpest to the smallest, and the
  // first one that fits is used. A payment screenshot is mostly flat colour and text, so this stays easy to read (amount, status).
  const PROOF_TARGET_BYTES = 20 * 1024;
  const PROOF_TIERS = [[1200, 0.6], [1000, 0.6], [1000, 0.45], [860, 0.45], [860, 0.35], [740, 0.35], [740, 0.28], [620, 0.3]];
  const PROOF_MAX_BYTES = 2 * 1024 * 1024; // the server's limit (the original is only sent when the phone could not shrink it)

  function proofDoneHtml(code, phone) {
    return `<div class="proof-box is-done" data-role="proof-box" data-code="${esc(code)}" data-phone="${esc(phone || "")}">
        <div class="proof-thanks">✓ Thank you for uploading!</div>
        <div class="proof-sub">We know this was a bit of an extra step, and we're working on reducing this manual step. We'll verify your payment. Thank you for your cooperation.</div>
        <div class="proof-msg" data-role="proof-msg" role="status"></div>
      </div>`;
  }

  /** The "upload your payment screenshot" box for a UPI order. "" for anything else (cash orders, the admin switched it off, an
   * order that is already delivered or cancelled and has no screenshot) - and once a screenshot was uploaded: the thank-you is
   * shown only once, right after the upload (see onProofPicked), never again on a later visit. */
  function proofHtml(order, phone, label, lead) {
    if (!order || order.paymentMode !== "UPI" || !order.orderCode) return "";
    if (order.paymentProofAt) return "";
    if (!SiteCustomize.payment().proof) return "";
    if (!isOpen(order.status)) return "";
    return `<div class="proof-box" data-role="proof-box" data-code="${esc(order.orderCode)}" data-phone="${esc(phone || "")}">
        <div class="proof-nudge">Done paying? Take a screenshot in your UPI app, then upload it here 👇</div>
        <label class="btn btn-outline btn-sm proof-btn"><svg class="proof-clip" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg><span>${lead ? `<span class="proof-lead">${esc(lead)}</span> ` : ""}${esc(label || "Upload payment screenshot")}</span><input type="file" accept="image/*" hidden data-proof-file /></label>
        <div class="proof-sub">This will help us serve you better and quicker.</div>
        <div class="proof-msg" data-role="proof-msg" role="status"></div>
      </div>`;
  }

  /** My Orders was opened afresh: every "Forgot to pay?" section starts folded (the set only keeps a section open while the list
   * is redrawn live, e.g. a status change, with the page still open). */
  function collapseAll() {
    openForgot.clear();
  }

  // ---- coming back from the UPI app -------------------------------------------------------------------------------
  // The customer taps "Pay now" (or copies the UPI ID), pays in another app and returns: the page scrolls to the upload box and
  // it is highlighted, so the next step (screenshot of the payment, then upload) is obvious. Works for Order Placed and My Orders.
  let paying = null;
  function nudge(code) {
    const box = [...document.querySelectorAll(".proof-box:not(.is-done)")].find((b) => b.dataset.code === code);
    if (!box) return;
    box.classList.add("is-nudge");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  document.addEventListener("visibilitychange", () => {
    if (!paying) return;
    if (document.visibilityState === "hidden") paying.away = true;
    else if (paying.away) {
      const code = paying.code;
      paying = null;
      setTimeout(() => nudge(code), 350); // let the page settle first
    }
  });
  // the highlight goes as soon as the customer starts choosing the picture
  document.addEventListener("click", (e) => {
    const lab = e.target && e.target.closest ? e.target.closest(".proof-box.is-nudge .proof-btn") : null;
    if (lab) lab.closest(".proof-box").classList.remove("is-nudge");
  });

  /** An order on screen changed status (My Orders, live): while it is open (new / packed) it shows the "Forgot to pay?" line and
   * the upload box - if it has none yet (it was delivered or cancelled a moment ago) they come back; once it is delivered or
   * cancelled they go. A "Thank you" that is showing stays. Same pieces as when the list is drawn, so nothing is written twice. */
  function settle(card, order) {
    if (!card || !order) return;
    const shown = card.querySelector('[data-role="upi-forgot"], .proof-box');
    if (!isOpen(order.status)) {
      card.querySelectorAll('[data-role="upi-forgot"], .proof-box:not(.is-done)').forEach((el) => el.remove());
      openForgot.delete(card.dataset.code);
    } else if (!shown) {
      const anchor = card.querySelector(".profile-order-total");
      if (anchor) anchor.insertAdjacentHTML("afterend", forgotHtml(order));
    }
  }

  let webpOk = null;
  /** WebP is about half the size of a JPEG; used when the phone can make it (Chrome / Android), else JPEG (iPhone Safari). */
  const canWebp = () => {
    if (webpOk === null) {
      try {
        webpOk = document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp");
      } catch {
        webpOk = false;
      }
    }
    return webpOk;
  };

  /** Shrinks a screenshot to about PROOF_TARGET_BYTES (see PROOF_TIERS). The original is returned if it is already that small, or if
   * the phone cannot decode it. */
  async function shrink(file) {
    if (file.size <= PROOF_TARGET_BYTES && /^image\/(jpeg|webp|png)$/i.test(file.type)) return file;
    let url;
    try {
      url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return file;
      const type = canWebp() ? "image/webp" : "image/jpeg";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let best = null;
      for (const [side, quality] of PROOF_TIERS) {
        const scale = Math.min(1, side / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
        if (!blob || !blob.size) continue;
        best = blob;
        if (blob.size <= PROOF_TARGET_BYTES) break;
      }
      return best || file;
    } catch {
      return file;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  async function onProofPicked(e) {
    const input = e.target;
    if (!input || !input.matches || !input.matches("input[data-proof-file]")) return;
    const box = input.closest('[data-role="proof-box"]');
    const file = input.files && input.files[0];
    input.value = "";
    if (!box || !file) return;
    const msg = box.querySelector('[data-role="proof-msg"]');
    const say = (text) => msg && (msg.textContent = text);
    if (!/^image\//i.test(file.type)) return say("Please choose a picture - the screenshot of your payment.");
    if (box.classList.contains("is-busy")) return;
    box.classList.add("is-busy");
    say("Uploading…");
    try {
      const code = box.dataset.code;
      const phone = box.dataset.phone || (window.ProfileSheet && window.ProfileSheet.getSavedPhone && window.ProfileSheet.getSavedPhone()) || "";
      const blob = await shrink(file);
      if (blob.size > PROOF_MAX_BYTES) throw new Error("That picture is too large - please choose a smaller screenshot.");
      const form = new FormData();
      form.append("phone", phone);
      form.append("file", blob, blob.type === "image/webp" ? "payment.webp" : "payment.jpg");
      const res = await Api.upload(`/api/orders/${encodeURIComponent(code)}/payment-proof`, form);
      // the whole payment card (Order Placed) or "Forgot to pay?" section (My Orders) is replaced by the thank-you, shown this once
      const whole = box.closest('[data-role="upi-forgot"]') || box.closest('[data-role="upi-card"]') || box;
      openForgot.delete(code);
      whole.outerHTML = proofDoneHtml(code, phone);
      window.dispatchEvent(new CustomEvent("freshcutz:proof-uploaded", { detail: { orderCode: code, at: (res && res.paymentProofAt) || new Date().toISOString() } }));
    } catch (err) {
      box.classList.remove("is-busy");
      say(err && err.message ? err.message : "Upload failed - please try again.");
    }
  }
  document.addEventListener("change", onProofPicked);

  return { optionsHtml, wire, validate, cardHtml, mountCard, proofHtml, forgotHtml, settle, collapseAll };
})();
