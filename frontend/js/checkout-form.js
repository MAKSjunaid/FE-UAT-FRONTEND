/* The two checkout steps: "Your Details" (name + phone) then "Delivery
 * Details" (address). Split out of checkout.js to keep that file under the
 * project's size limit — same reasoning as storefront-sync.js being split
 * out of storefront.js. Uses window.CheckoutSheet (checkout.js) for the
 * shared sheet shell and the success screen.
 *
 * Right after phone is entered, this calls the public lookup endpoint —
 * if it's a returning customer, their flat/address/landmark from their
 * last order are filled in automatically instead of retyped, and their
 * name/phone never has to be entered again on the address step.
 *
 * For a returning customer with a complete saved address, the delivery
 * step opens as a read-only summary card (renderAddressSummary) instead
 * of the full form — same idea as the admin order view, just the flat
 * no. and address at a glance — with a "Change address" control that
 * drops into the normal editable form (renderAddressForm) if they need
 * to fix anything. First-time customers, or anyone with an incomplete
 * saved address, go straight to the editable form.
 *
 * A customer already logged in via the profile icon (see profile.js)
 * skips the "Your Details" name/phone step entirely — checkout.js calls
 * openFinalStep(phone) instead of open(), which jumps straight to the
 * same address-summary screen (retitled "Final Step" and with the cart's
 * items listed too, via renderAddressSummary's skipContactStep option)
 * since there's nothing left to ask them. */

window.CheckoutForm = (() => {
  function openContactStep(prefillName = "", prefillPhone = "") {
    const S = window.CheckoutSheet;
    const body = `
      <form class="sheet-body acct-edit" id="contactForm" novalidate>
        <p class="acct-edit-intro">Tell us who's ordering. We'll use these details to confirm your order.</p>
        <div class="acct-card acct-edit-card">
          <div class="field">
            <label for="cf-name">Your name</label>
            <input id="cf-name" name="customerName" required autocomplete="name" placeholder="e.g. Ayesha Khan" value="${Utils.escapeHtml(prefillName)}" />
            <div class="error" data-err="customerName"></div>
          </div>
          <div class="field">
            <label for="cf-phone">Mobile number</label>
            <input id="cf-phone" name="phone" type="tel" inputmode="numeric" required autocomplete="tel" placeholder="10-digit mobile number" value="${Utils.escapeHtml(prefillPhone)}" />
            <div class="error" data-err="phone"></div>
          </div>
          <div class="field">
            <label for="cf-phone2">Re-enter mobile number</label>
            <input id="cf-phone2" name="phone2" type="tel" inputmode="numeric" required autocomplete="off" placeholder="Re-enter 10-digit mobile number" value="${Utils.escapeHtml(prefillPhone)}" />
            <div class="error" data-err="phone2"></div>
          </div>
        </div>
      </form>
      <div class="sheet-footer acct-edit-foot">
        <button class="btn btn-gold btn-block" id="contactNextBtn" form="contactForm">${SiteCustomize.html("nextButtonText")}</button>
      </div>`;

    const sheet = S.renderSheet(body, "Your Details");
    const form = sheet.querySelector("#contactForm");
    const nextBtn = sheet.querySelector("#contactNextBtn");

    // the second box is there to catch typos, so pasting the first number into it is blocked
    sheet.querySelector("#cf-phone2").addEventListener("paste", (e) => e.preventDefault());

    nextBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const errors = {};
      if (!data.get("customerName")?.trim()) errors.customerName = SiteCustomize.text("errName");
      if (!Utils.validatePhone(data.get("phone"))) errors.phone = SiteCustomize.text("errPhone");
      else if (Utils.normalizePhone(data.get("phone2") || "").slice(-10) !== Utils.normalizePhone(data.get("phone")).slice(-10))
        errors.phone2 = data.get("phone2")?.trim() ? "The two mobile numbers don't match. Please check and try again." : "Please re-enter your mobile number.";
      if (Object.keys(errors).length > 0) {
        showErrors(sheet, errors);
        return;
      }

      const customerName = data.get("customerName").trim();
      const phone = Utils.normalizePhone(data.get("phone"));

      nextBtn.disabled = true;
      nextBtn.innerHTML = `<span class="spinner"></span> Checking...`;
      let existing = null;
      try {
        existing = await Api.get(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
      } catch {
        existing = null; // a lookup hiccup shouldn't block checkout — just start with a blank address
      }
      openDeliveryStep(customerName, phone, existing);
    });
  }

  /** The delivery-map bits of the address forms (nothing at all while the admin has the map switched off). */
  const mapPickHtml = (p) => (window.DeliveryMap ? DeliveryMap.pickerHtml(p) : "");
  const wireMapPick = (root) => { if (window.DeliveryMap) DeliveryMap.wirePicker(root); };
  const mapPinOf = (formData) => (window.DeliveryMap ? DeliveryMap.pinFrom(formData) : {});
  /** The "Building name / Address" box: with a spot chosen on the map it is only for the building / apartment. */
  const bldLabel = (p) => (window.DeliveryMap ? DeliveryMap.addrLabel(p) : "Building name / Address");
  const bldPlaceholder = (p) => (window.DeliveryMap ? DeliveryMap.addrPlaceholder(p) : "Building, street, area");
  const bldValue = (p) => (window.DeliveryMap ? DeliveryMap.buildingOf(p) : (p && p.addressLine) || "");
  const addressOf = (data) => (window.DeliveryMap ? DeliveryMap.addressFrom(data) : (data.get("addressLine") || "").trim());
  const hasMapPin = (p) => !!(window.DeliveryMap && DeliveryMap.isEnabled() && p && isFinite(parseFloat(p.deliveryLat)) && isFinite(parseFloat(p.deliveryLng)));

  /** A saved address only counts as "complete" (worth showing as a
   * read-only summary) if it actually has the two required fields —
   * otherwise fall straight through to the normal editable form. */
  function hasSavedAddress(prefill) {
    return !!(prefill && prefill.flatNo?.trim() && prefill.addressLine?.trim());
  }

  /** "Preferred delivery time (optional)". Never required: nothing is chosen to begin with, one at a time, and tapping the chosen one
   * again clears it. Two ways to show it (the admin's Delivery time choices):
   *  - Today / Tomorrow (default): day buttons, then the times of the chosen day. A slot is offered for today only while it starts at
   *    least the admin's advance notice from now (India time); every slot is offered for
   *    tomorrow. What is saved with the order says the day too, e.g. "Today, 28 Oct · 9 AM – 10 AM" (see js/slot-time.js).
   *  - plain buttons (switched off, or old options that are not times): every option, no day. */
  function slotPlanNow(d) {
    return SlotTime.plan(d.windows, d.notice);
  }

  function slotsInnerHtml(plan, pickedValue) {
    const esc = Utils.escapeHtml;
    // each day is a plain heading with its times under it (only the times can be tapped); Tomorrow comes below Today
    return plan
      .map(
        (day) => `
          <div class="slot-day-head"><b>${esc(day.name)}</b><span>${esc(day.date)}</span></div>
          <div class="slot-row" role="group" aria-label="${esc(day.name)} ${esc(day.date)}">
            ${day.slots.map((s) => `<button type="button" class="slot-chip${s.value === pickedValue ? " is-selected" : ""}" aria-pressed="${s.value === pickedValue}" data-slot="${esc(s.value)}">${esc(s.time)}</button>`).join("")}
          </div>`
      )
      .join("");
  }

  function slotPickedHtml(value) {
    return value ? `<span aria-hidden="true">🕗</span> <span>Delivery time: <b>${Utils.escapeHtml(value)}</b></span>` : "";
  }

  function deliverySlotsHtml() {
    const d = SiteCustomize.deliverySlots();
    if (!d.show) return "";
    const label = Utils.escapeHtml(d.label);
    if (d.schedule) {
      const plan = slotPlanNow(d);
      if (plan.length) {
        return `<div class="field" data-role="slots" data-mode="days">
          <label>${label}</label>
          <div class="slot-panel">
            <div data-role="slot-body">${slotsInnerHtml(plan, "")}</div>
            <div class="slot-picked" data-role="slot-picked" hidden></div>
            <input type="hidden" name="deliverySlot" value="" />
            <div class="error" data-role="slot-err"></div>
          </div>
        </div>`;
      }
    }
    return `<div class="field" data-role="slots" data-mode="plain">
          <label>${label}</label>
          <div class="slot-panel">
            <div class="slot-row" role="group" aria-label="${label}">
              ${d.slots.map((s) => `<button type="button" class="slot-chip" aria-pressed="false" data-slot="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</button>`).join("")}
            </div>
            <input type="hidden" name="deliverySlot" value="" />
          </div>
        </div>`;
  }

  /** Makes the slot buttons work (call after the sheet is drawn). */
  function wireSlots(sheet) {
    const box = sheet.querySelector('[data-role="slots"]');
    if (!box) return;
    const input = box.querySelector('input[name="deliverySlot"]');
    const smart = box.dataset.mode === "days";

    const paintPicked = () => {
      const el = box.querySelector('[data-role="slot-picked"]');
      if (!el) return;
      el.innerHTML = slotPickedHtml(input.value);
      el.hidden = !input.value;
    };
    const say = (msg) => {
      const el = box.querySelector('[data-role="slot-err"]');
      if (el) el.textContent = msg || "";
    };

    // redraws the day buttons and times (the clock moved on: a slot may no longer be offered for today)
    let signature = "";
    const redraw = (fromTimer) => {
      const d = SiteCustomize.deliverySlots();
      const plan = d.schedule ? slotPlanNow(d) : [];
      if (!plan.length) return;
      const sig = JSON.stringify(plan.map((x) => [x.key, x.slots.map((s) => s.value)]));
      if (fromTimer && sig === signature) return;
      signature = sig;
      if (input.value && !plan.some((x) => x.slots.some((sl) => sl.value === input.value))) {
        input.value = "";
        say("That delivery time is no longer available. Please choose another.");
      }
      box.querySelector('[data-role="slot-body"]').innerHTML = slotsInnerHtml(plan, input.value);
      paintPicked();
    };

    if (smart) {
      redraw(false);
      const timer = setInterval(() => {
        if (!box.isConnected) return clearInterval(timer);
        redraw(true);
      }, 20000);
      box.revalidate = () => { // (called when Place Order is tapped)
        const before = input.value;
        redraw(false);
        return !before || before === input.value;
      };
    }

    box.addEventListener("click", (e) => {
      const btn = e.target.closest(".slot-chip");
      if (!btn) return;
      say("");
      const wasOn = btn.classList.contains("is-selected");
      box.querySelectorAll(".slot-chip").forEach((b) => {
        b.classList.remove("is-selected");
        b.setAttribute("aria-pressed", "false");
      });
      input.value = "";
      if (!wasOn) {
        btn.classList.add("is-selected");
        btn.setAttribute("aria-pressed", "true");
        input.value = btn.dataset.slot;
      }
      paintPicked();
    });
  }

  /** Coming back to the Final Step: picks the time chosen before (switching to its day), when it is still offered. */
  function restoreSlot(sheet, value) {
    const box = sheet.querySelector('[data-role="slots"]');
    if (!box) return;
    const input = box.querySelector('input[name="deliverySlot"]');
    input.value = value;
    if (box.dataset.mode === "days") {
      if (!box.revalidate()) return; // (no longer offered: cleared, with the message)
      return;
    }
    box.querySelector(`.slot-chip[data-slot="${CSS.escape(value)}"]`)?.click();
    if (!box.querySelector(".slot-chip.is-selected")) input.value = "";
  }

  /** Place Order: a chosen time that is no longer offered (the clock moved on) is cleared with a message instead of being sent. */
  function slotsStillValid(sheet) {
    const box = sheet.querySelector('[data-role="slots"]');
    if (!box || !box.revalidate) return true;
    if (box.revalidate()) return true;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  /** The "special instructions" box — the admin can rename or hide it. */
  function notesFieldHtml() {
    if (!SiteCustomize.on("showNotesField")) return "";
    return `<div class="field">
          <label for="cf-notes">${Utils.escapeHtml(SiteCustomize.t("notesLabel"))}</label>
          <textarea id="cf-notes" name="notes" rows="2" placeholder="e.g. Call before delivering"></textarea>
        </div>`;
  }

  function checkoutFooterHtml() {
    return `
      <div class="sheet-footer">
        <div class="summary-row"><span>${SiteCustomize.html("itemsLabel")}</span><span>${Cart.getLineCount()}</span></div>
        <div class="summary-row total"><span>${SiteCustomize.html("codTotalLabel")}</span><span>${Utils.formatMoney(Cart.getTotal())}</span></div>
        <button class="btn btn-gold btn-block" style="margin-top:10px;" id="placeOrderBtn" form="checkoutForm">
          ${Utils.escapeHtml(SiteCustomize.t("placeOrderText"))}
        </button>
      </div>`;
  }

  function openDeliveryStep(customerName, phone, existing) {
    const prefill = existing && existing.found ? existing : null;
    if (hasSavedAddress(prefill)) {
      renderAddressSummary(customerName, phone, prefill);
    } else {
      renderAddressForm(customerName, phone, prefill);
    }
  }

  /** Entry point for a customer already logged in via the profile icon —
   * checkout.js calls this instead of open() so they never see the
   * "Your Details" name/phone step again; their name comes straight from
   * the same lookup profile.js already trusts. Falls back to the normal
   * name/phone flow if the saved login doesn't resolve to anything
   * (e.g. it was cleared server-side), same defensive pattern profile.js
   * itself uses. */
  async function openFinalStep(phone) {
    const S = window.CheckoutSheet;
    S.renderSheet(
      `<div class="sheet-body"><div class="empty-state"><div class="icon">🛒</div><p>${SiteCustomize.html("loadingDetailsText")}</p></div></div>`,
      "Final Step"
    );

    let existing;
    try {
      existing = await Api.get(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
    } catch {
      existing = null;
    }

    if (!existing || !existing.found || !hasSavedAddress(existing)) {
      openContactStep();
      return;
    }

    renderAddressSummary(existing.name, phone, existing, { skipContactStep: true });
  }

  /** Line-by-line cart contents, shown on the "Final Step" screen (a
   * logged-in customer skipping straight past the name/phone step has
   * never otherwise seen their cart summarized before placing the order,
   * unlike the normal flow where they just came from the cart sheet). */
  function cartItemsSectionHtml() {
    // Exactly the order-success screen's own summary card (see
    // checkout.js's orderSummaryHtml) — same .order-summary-list/
    // .summary-row classes, so what you confirm here and what you see
    // right after placing the order look identical.
    const rows = Cart.getItems()
      .map(
        (i) => `<div class="summary-row">
          <span>${i.quantity} × ${Utils.escapeHtml(i.name)} (${Utils.escapeHtml(i.variantLabel)})</span>
          <span>${Utils.formatMoney(i.unitPrice * i.quantity)}</span>
        </div>`
      )
      .join("");
    return `
      <div class="field">
        <label>${SiteCustomize.html("itemsLabel")}</label>
        <div class="order-summary-list">
          ${rows}
          <div class="summary-row total"><span>${SiteCustomize.html("totalLabel")}</span><span>${Utils.formatMoney(Cart.getTotal())}</span></div>
        </div>
      </div>`;
  }

  /** Returning customer, complete saved address: the "Final Step" screen
   * — address summary (🏠 flat/house, 📍 landmark) the way admin sees it
   * on an order, the cart's items in the same card style as the
   * order-success screen, and the notes field, all before Place Order.
   * "Change address" swaps in the normal editable form.
   *
   * Two ways in, one visual difference: arriving via the profile-login
   * shortcut (opts.skipContactStep, from openFinalStep) has no "Back" —
   * there's no prior step in that shortened flow — and a plain "Final
   * Step" title. Arriving here after typing a phone number that turned
   * out to match a saved address (the normal openDeliveryStep path) keeps
   * the "← Back" (to fix the name/phone just typed) and greets them by
   * name, since this is the first they're seeing of "Final Step". */
  function renderAddressSummary(customerName, phone, prefill, opts = {}) {
    const S = window.CheckoutSheet;
    const skipContactStep = !!opts.skipContactStep;

    const backButtonHtml = skipContactStep
      ? ""
      : `<button type="button" class="btn btn-ghost btn-sm" data-role="back" style="margin-bottom:4px;">← Back</button>`;

    const pinP = window.DeliveryMap ? DeliveryMap.withPin(prefill) : prefill; // a location just chosen on the map wins over the one on file
    const addrShown = window.DeliveryMap ? DeliveryMap.composedFor(prefill) : prefill.addressLine; // (building, street / area of that spot)
    const body = `
      <form class="sheet-body" id="checkoutForm" novalidate>
        ${backButtonHtml}
        <div class="address-summary-card">
          <div class="address-summary-row">🏠 ${Utils.escapeHtml(prefill.flatNo)}, ${Utils.escapeHtml(addrShown)}</div>
          ${prefill.landmark && SiteCustomize.on("showLandmarkField") ? `<div class="address-summary-row">📍 ${Utils.escapeHtml(prefill.landmark)}</div>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-role="edit-address" style="margin-top:var(--sp-2);">✏️ Change address</button>
        </div>
        <input type="hidden" name="flatNo" value="${Utils.escapeHtml(prefill.flatNo)}" />
        <input type="hidden" name="addressLine" value="${Utils.escapeHtml(addrShown)}" />
        <input type="hidden" name="landmark" value="${Utils.escapeHtml(prefill.landmark || "")}" />
        ${hasMapPin(pinP) ? `<input type="hidden" name="deliveryLat" value="${parseFloat(pinP.deliveryLat)}" /><input type="hidden" name="deliveryLng" value="${parseFloat(pinP.deliveryLng)}" /><input type="hidden" name="deliveryArea" value="${Utils.escapeHtml(pinP.deliveryArea || "")}" />` : ""}
        ${cartItemsSectionHtml()}
        ${deliverySlotsHtml()}
        ${notesFieldHtml()}
        ${window.UpiPay ? UpiPay.optionsHtml() : ""}
      </form>
      ${checkoutFooterHtml()}`;

    const title = skipContactStep
      ? "Final Step"
      : `Welcome back, ${Utils.escapeHtml(customerName)}! Final Step`;

    const sheet = S.renderSheet(body, title);
    wireSlots(sheet);
    if (window.UpiPay) UpiPay.wire(sheet);
    const form = sheet.querySelector("#checkoutForm");
    const placeBtn = sheet.querySelector("#placeOrderBtn");

    const backBtn = sheet.querySelector('[data-role="back"]');
    if (backBtn) {
      backBtn.addEventListener("click", () => openContactStep(customerName, phone));
    }
    // coming back from "Change address": what was chosen before (delivery time, notes, payment) is still chosen
    const kept = opts.keep;
    if (kept) {
      if (kept.slot) restoreSlot(sheet, kept.slot);
      const notes = form.querySelector('[name="notes"]');
      if (notes && kept.notes) notes.value = kept.notes;
      if (kept.pay) {
        const r = form.querySelector(`input[name="paymentMode"][value="${CSS.escape(kept.pay)}"]`);
        if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    }
    const snapshot = () => ({
      slot: form.querySelector('[name="deliverySlot"]')?.value || "",
      notes: form.querySelector('[name="notes"]')?.value || "",
      pay: form.querySelector('input[name="paymentMode"]:checked')?.value || "",
    });
    sheet.querySelector('[data-role="edit-address"]').addEventListener("click", () => {
      const keep = snapshot();
      const go = () => renderAddressForm(customerName, phone, prefill, { ...opts, keep });
      if (window.DeliveryMap) DeliveryMap.pickThen(pinP, go); // (the map is on the address page itself now)
      else go();
    });

    placeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      // Address fields are hidden inputs carrying already-known-good saved
      // values here, so there's nothing to validate — only notes is free text.
      if (Utils.isJunkAddress(prefill.addressLine)) { // an address saved earlier that is made-up text: ask for a real one
        renderAddressForm(customerName, phone, prefill, { ...opts, keep: snapshot(), initialErrors: { addressLine: Utils.JUNK_ADDRESS_MESSAGE } });
        return;
      }
      if (!slotsStillValid(sheet)) return;
      if (window.UpiPay && !UpiPay.validate(sheet)) return; // nothing ticked under "Payment mode"
      await submitOrder(customerName, phone, form, placeBtn);
    });
  }

  /** The normal editable address form — used for first-time customers,
   * anyone whose saved address is incomplete, and returning customers who
   * tapped "Change address" on the summary card. */
  function renderAddressForm(customerName, phone, prefill, opts = {}) {
    const S = window.CheckoutSheet;
    const cameFromSummary = hasSavedAddress(prefill);
    if (cameFromSummary) return renderAddressOnly(customerName, phone, prefill, opts); // "Change address": the address and nothing else

    // Everything below the address is built by the very same functions as the "Final Step" (items, delivery time, notes, payment),
    // straight inside the form, so the two screens look identical; only the address on top is typed in instead of shown.
    const body = `
      <form class="sheet-body" id="checkoutForm" novalidate>
        <div class="acct-edit addr-edit" style="display:flex;flex-direction:column;gap:10px;">
          <button type="button" class="acct-back" data-role="back">← Back</button>
          <p class="acct-edit-intro">${cameFromSummary ? "Update where we should deliver this order." : "Just this once \u2014 we'll remember it for next time."}</p>
          <div class="acct-card acct-edit-card addr-card">
            ${mapPickHtml(prefill)}
            <div class="field">
              <label for="cf-flat">Flat / House no.</label>
              <input id="cf-flat" name="flatNo" required placeholder="e.g. Flat 302, Block B" value="${Utils.escapeHtml(prefill?.flatNo || "")}" />
              <div class="error" data-err="flatNo"></div>
            </div>
            <div class="field">
              <label for="cf-address" data-dm-addr-label>${bldLabel(prefill)}</label>
              <textarea id="cf-address" name="addressLine" rows="2" placeholder="${Utils.escapeHtml(bldPlaceholder(prefill))}">${Utils.escapeHtml(bldValue(prefill))}</textarea>
              <div class="error" data-err="addressLine"></div>
            </div>
            ${
              SiteCustomize.on("showLandmarkField")
                ? `<div class="field">
              <label for="cf-landmark">Landmark (optional)</label>
              <input id="cf-landmark" name="landmark" placeholder="e.g. Near XYZ apartments" value="${Utils.escapeHtml(prefill?.landmark || "")}" />
            </div>`
                : `<input type="hidden" name="landmark" value="${Utils.escapeHtml(prefill?.landmark || "")}" />`
            }
          </div>
        </div>
        ${cartItemsSectionHtml()}
        ${deliverySlotsHtml()}
        ${notesFieldHtml()}
        ${window.UpiPay ? UpiPay.optionsHtml() : ""}
      </form>
      ${checkoutFooterHtml()}`;

    const title = cameFromSummary ? "Edit your delivery address" : "Final Step";

    const sheet = S.renderSheet(body, title);
    wireMapPick(sheet);
    wireSlots(sheet);
    if (window.UpiPay) UpiPay.wire(sheet);
    const form = sheet.querySelector("#checkoutForm");
    const placeBtn = sheet.querySelector("#placeOrderBtn");

    if (opts.initialErrors) showErrors(sheet, opts.initialErrors);
    clearErrorWhileTyping(sheet);

    sheet.querySelector('[data-role="back"]').addEventListener("click", () => {
      if (cameFromSummary) {
        renderAddressSummary(customerName, phone, prefill, opts);
      } else {
        openContactStep(customerName, phone);
      }
    });

    placeBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const errors = validateDelivery(form);
      if (Object.keys(errors).length > 0) {
        showErrors(sheet, errors);
        return;
      }
      clearAddressErrors(sheet); // the address is fine now: drop the messages from the last try
      if (!slotsStillValid(sheet)) return;
      if (window.UpiPay && !UpiPay.validate(sheet)) return; // nothing ticked under "Payment mode"
      await submitOrder(customerName, phone, form, placeBtn);
    });
  }

  /** "Change address" on the Final Step: only Flat / House no., Building name / Address and Landmark, with "Update address". It saves
   * the address (the same call My Account uses) and goes straight back to the Final Step, which then shows the new address; the
   * delivery time, notes and payment choice made there are still as they were. No order is placed here. */
  function renderAddressOnly(customerName, phone, prefill, opts) {
    const S = window.CheckoutSheet;
    const body = `
      <form class="sheet-body acct-edit addr-edit" id="checkoutForm" novalidate>
        <button type="button" class="acct-back" data-role="back">← Back</button>
        <p class="acct-edit-intro">Update where we should deliver your orders.</p>
        <div class="acct-card acct-edit-card addr-card">
          ${mapPickHtml(prefill)}
          <div class="field">
            <label for="cf-flat">Flat / House no.</label>
            <input id="cf-flat" name="flatNo" required placeholder="e.g. Flat 302, Block B" value="${Utils.escapeHtml(prefill?.flatNo || "")}" />
            <div class="error" data-err="flatNo"></div>
          </div>
          <div class="field">
            <label for="cf-address" data-dm-addr-label>${bldLabel(prefill)}</label>
            <textarea id="cf-address" name="addressLine" rows="2" placeholder="${Utils.escapeHtml(bldPlaceholder(prefill))}">${Utils.escapeHtml(bldValue(prefill))}</textarea>
            <div class="error" data-err="addressLine"></div>
          </div>
          ${
            SiteCustomize.on("showLandmarkField")
              ? `<div class="field">
            <label for="cf-landmark">Landmark (optional)</label>
            <input id="cf-landmark" name="landmark" placeholder="e.g. Near XYZ apartments" value="${Utils.escapeHtml(prefill?.landmark || "")}" />
          </div>`
              : `<input type="hidden" name="landmark" value="${Utils.escapeHtml(prefill?.landmark || "")}" />`
          }
        </div>
      </form>
      <div class="sheet-footer acct-edit-foot">
        <button class="btn btn-gold btn-block" id="updateAddressBtn" form="checkoutForm">Update address</button>
      </div>`;

    const sheet = S.renderSheet(body, "Change address");
    sheet.querySelector(".sheet").classList.add("sheet-addr");
    wireMapPick(sheet);
    const form = sheet.querySelector("#checkoutForm");
    const btn = sheet.querySelector("#updateAddressBtn");
    if (opts.initialErrors) showErrors(sheet, opts.initialErrors);
    clearErrorWhileTyping(sheet);

    const backToSummary = (address) => renderAddressSummary(customerName, phone, address || prefill, opts);
    const guard = (go) => !!(window.DeliveryMap && DeliveryMap.guardLeave(form, "Update address", go));
    S.setLeaveGuard(guard);
    sheet.querySelector('[data-role="back"]').addEventListener("click", () => { if (!guard(() => backToSummary())) backToSummary(); });

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const errors = validateDelivery(form);
      if (Object.keys(errors).length > 0) {
        showErrors(sheet, errors);
        return;
      }
      const data = new FormData(form);
      const payload = {
        phone,
        name: customerName,
        flatNo: data.get("flatNo").trim(),
        addressLine: addressOf(data),
        landmark: data.get("landmark")?.trim() || null,
        ...mapPinOf(data),
      };
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Updating...`;
      try {
        const saved = await Api.put("/api/customers/address", payload);
        if (window.ProfileSheet && ProfileSheet.profileChanged) ProfileSheet.profileChanged(phone, saved);
        if (window.DeliveryMap) DeliveryMap.pinSaved(saved && saved.deliveryLat != null ? saved : payload, true);
        Toast.msg("detailsUpdated");
        backToSummary({ ...prefill, flatNo: payload.flatNo, addressLine: payload.addressLine, landmark: payload.landmark || "", deliveryLat: payload.deliveryLat ?? null, deliveryLng: payload.deliveryLng ?? null, deliveryArea: payload.deliveryArea ?? null });
      } catch (err) {
        Toast.msg("serverError", { message: err.message });
        btn.disabled = false;
        btn.textContent = "Update address";
      }
    });
  }

  function validateDelivery(form) {
    const errors = {};
    const data = new FormData(form);
    if (!data.get("flatNo")?.trim()) errors.flatNo = SiteCustomize.text("errFlat");
    if (!data.get("addressLine")?.trim()) {
      // (with a spot chosen on the map the building box may stay empty: the map's street / area is the address then)
      if (!(window.DeliveryMap && DeliveryMap.addressOptional(data))) errors.addressLine = SiteCustomize.text("errAddress");
    } else if (Utils.isJunkAddress(data.get("addressLine"))) errors.addressLine = Utils.JUNK_ADDRESS_MESSAGE; // "xyz", "abcd", "asdf", "test", "aaaa"...
    return errors;
  }

  /** Removes the address messages ("Please enter your flat / house no." ...), only the ones of the address boxes. */
  function clearAddressErrors(sheet) {
    sheet.querySelectorAll('[data-err="flatNo"], [data-err="addressLine"]').forEach((el) => (el.textContent = ""));
  }

  /** A box's own message goes away as soon as it is being typed in. */
  function clearErrorWhileTyping(sheet) {
    sheet.addEventListener("input", (e) => {
      const name = e.target && e.target.name;
      if (!name) return;
      const el = sheet.querySelector(`[data-err="${name}"]`);
      if (el) el.textContent = "";
    });
  }

  function showErrors(sheet, errors) {
    sheet.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
    Object.entries(errors).forEach(([field, msg]) => {
      const el = sheet.querySelector(`[data-err="${field}"]`);
      if (el) el.textContent = msg;
    });
    const firstField = Object.keys(errors)[0];
    sheet.querySelector(`[name="${firstField}"]`)?.focus();
  }

  async function submitOrder(customerName, phone, form, btn) {
    const data = new FormData(form);
    const payload = {
      customerName,
      phone,
      flatNo: data.get("flatNo").trim(),
      addressLine: addressOf(data),
      landmark: data.get("landmark")?.trim() || null,
      ...mapPinOf(data),
      notes: data.get("notes")?.trim() || null,
      deliverySlot: data.get("deliverySlot")?.trim() || null,
      paymentMode: data.get("paymentMode") || null,
      items: Cart.toOrderItems(),
    };

    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${SiteCustomize.html("placingOrderText")}`;
    try {
      const order = await Api.post("/api/orders", payload);
      if (window.DeliveryMap) DeliveryMap.pinSaved(payload, true); // the address saved with this order now carries the pin
      Cart.clear();
      // Any successful order — whichever checkout path got them here — logs
      // the customer into the profile system with this phone number, so
      // "My Orders"/"My Address" are ready for them next time without a
      // separate login step.
      window.ProfileSheet && window.ProfileSheet.savePhone(phone, order);
      window.CheckoutSheet.openSuccess(order);
    } catch (err) {
      Toast.msg("serverError", { message: err.message });
      btn.disabled = false;
      btn.textContent = SiteCustomize.t("placeOrderText");
    }
  }

  return { open: openContactStep, openFinalStep };
})();
