/* Customer "My Account" — tap the profile icon in the header, enter the
 * phone number you've ordered with, and see your saved address plus your
 * past orders. There's no separate signup/password: "logging in" here just
 * means "look me up the same way checkout already recognizes a returning
 * customer" (see CustomerLookupResponse). A phone with no past orders has
 * nothing to show, so login only succeeds for someone who's ordered before
 * — a brand new customer places their first order through the cart like
 * always, and can "log in" with that phone number afterwards.
 *
 * Reuses window.CheckoutSheet's bottom-sheet shell (renderSheet/
 * closeSheet) from checkout.js — that shell just renders into #sheetRoot,
 * it isn't actually checkout-specific, so there's no reason to duplicate
 * the overlay/sheet markup and animations here. */

window.ProfileSheet = (() => {
  const STORAGE_KEY = "freshcutz_profile_phone";
  // (by the customer's step - see order-status.js: Order Placed, Confirmed, Getting Ready, Delivered, Cancelled)
  const stageClass = { placed: "badge-new", confirmed: "badge-packed", ready: "badge-ready", delivered: "badge-delivered", cancelled: "badge-cancelled" };
  const stageOf = (status, code) => (window.OrderStatus ? OrderStatus.stage(status, code) : status === "NEW" ? "confirmed" : status === "PACKED" ? "ready" : String(status || "").toLowerCase());
  const badgeClass = (status, code) => stageClass[stageOf(status, code)] || "";
  /** What the customer reads on the badge and in the Track order strip. */
  const statusLabel = (status, code) => (window.OrderStatus ? OrderStatus.label(status, code) : status);
  const trackText = statusLabel;

  function getSavedPhone() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  // ---- the signed-in customer's name (the bottom menu's Account tab shows it, see bottom-nav.js) ------------------------
  // Kept next to the saved number, as {p: number, n: name}, so a name never belongs to another number. It is learnt from what the
  // account page / checkout / look-up already return; when a signed-in customer has none yet it is asked ONCE (the same look-up
  // the account page uses) and kept.
  const NAME_KEY = "freshcutz_profile_name";
  function getName() {
    try {
      const o = JSON.parse(localStorage.getItem(NAME_KEY) || "null");
      const phone = getSavedPhone();
      return o && phone && o.p === phone && typeof o.n === "string" ? o.n : "";
    } catch {
      return "";
    }
  }
  function setName(phone, name) {
    name = String(name || "").trim().replace(/\s+/g, " ");
    if (!phone || !name || (getName() === name && getSavedPhone() === phone)) return;
    try {
      localStorage.setItem(NAME_KEY, JSON.stringify({ p: phone, n: name }));
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new Event("freshcutz:name"));
    } catch {
      /* ignore */
    }
  }
  function forgetName() {
    try {
      localStorage.removeItem(NAME_KEY);
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new Event("freshcutz:name"));
    } catch {
      /* ignore */
    }
  }
  let nameAsked = "";
  /** A signed-in customer whose name is not known yet (signed in before names were kept): asked once per number. */
  function ensureName() {
    const phone = getSavedPhone();
    if (!phone || getName() || nameAsked === phone) return;
    if (acct && acct.phone === phone && acct.profile && acct.profile.name) return setName(phone, acct.profile.name);
    nameAsked = phone;
    Api.get(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`)
      .then((r) => { if (r && r.found && r.name) setName(phone, r.name); })
      .catch(() => { nameAsked = ""; });
  }

  // ---- what the account page keeps in memory ---------------------------------------------------------------------
  // Opening "My Account" again (after closing it) needs no request at all: the address and the orders already shown are kept
  // in memory. The orders come a few at a time over a live connection (the newest first, the next ones when the customer
  // scrolls to the end of the list; see "the orders" below). When the admin changes the status of an order the server pushes just that (see site-customize.js, "orderstatus")
  // and the order on screen is updated in place. Nothing is written to the phone's storage: it lives only while the page is open.
  const AWAY_MS = 30000; // a page hidden for longer than this may have missed pushes: its newest orders are re-read once
  let acct = null; // { phone, profile, orders: [], next, hasMore, loaded, stale }
  let hiddenAt = 0;

  function acctFor(phone) {
    if (!acct || acct.phone !== phone) {
      if (acct) acctForget(); // another number: what was saved for the old one goes
      acct = { phone, profile: null, orders: [], next: null, hasMore: false, loaded: false, stale: false, shown: 0, wantMore: false, streaming: false };
    }
    return acct;
  }

  // ---- also kept on this phone, so that a page reload shows the account at once ------------------------------------------------
  // The address and the orders loaded so far are saved in the browser's storage (IndexedDB) for the signed-in number. After a
  // reload they are drawn immediately (no "Loading your account" screen) and checked against the server in the background (one
  // small live connection for the orders): a changed status updates in place, a new order appears at the top. Signing out deletes
  // the saved copy; so does signing in with another number, and a copy older than a day is not used. Best effort: when the
  // storage is not available everything simply works as before.
  const ACCT_DB = "fc-account";
  const ACCT_KEY = "acct";
  const ACCT_MAX_AGE = 24 * 3600 * 1000;
  let acctDbPromise = null;

  function acctDb() {
    if (!acctDbPromise) {
      acctDbPromise = new Promise((resolve, reject) => {
        try {
          const q = indexedDB.open(ACCT_DB, 1);
          q.onupgradeneeded = () => q.result.createObjectStore("kv");
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
          q.onblocked = () => reject(new Error("blocked"));
        } catch (e) {
          reject(e);
        }
      });
      acctDbPromise.catch(() => {});
    }
    return acctDbPromise;
  }

  async function acctRun(mode, fn) {
    const d = await acctDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  let acctSaveTimer = null;

  // a payment screenshot was uploaded (see upi-pay.js): remember it on the order held here, so My Orders shows the thank-you at once
  window.addEventListener("freshcutz:proof-uploaded", (e) => {
    const d = e.detail || {};
    const held = acct && acct.orders ? acct.orders.find((o) => o.orderCode === d.orderCode) : null;
    if (held) {
      held.paymentProofAt = d.at;
      saveAcctSoon();
    }
  });

  function saveAcctSoon() {
    if (!acct || !acct.phone) return;
    clearTimeout(acctSaveTimer);
    acctSaveTimer = setTimeout(saveAcctNow, 1200);
  }

  function saveAcctNow() {
    clearTimeout(acctSaveTimer);
    acctSaveTimer = null;
    if (!acct || !acct.phone || getSavedPhone() !== acct.phone) return; // (signed out: nothing is kept)
    if (!acct.profile && !acct.loaded) return;
    const rec = {
      v: 1,
      phone: acct.phone,
      profile: acct.profile,
      orders: acct.orders,
      hasMore: acct.hasMore,
      next: acct.next,
      loaded: acct.loaded,
      shown: acct.shown || 0, // (how many orders the customer had scrolled to: shown again after a reload)
      savedAt: Date.now(),
    };
    acctRun("readwrite", (st) => st.put(rec, ACCT_KEY)).catch(() => {});
  }

  function acctForget() {
    clearTimeout(acctSaveTimer);
    acctSaveTimer = null;
    acctRun("readwrite", (st) => st.delete(ACCT_KEY)).catch(() => {});
  }

  /** Brings the saved copy back after a reload (only for the number that is signed in now, and only when it is fresh). */
  const acctReady = (async () => {
    try {
      if (!getSavedPhone() || !window.indexedDB) return;
      const rec = await Promise.race([acctRun("readonly", (st) => st.get(ACCT_KEY)), new Promise((r) => setTimeout(() => r(null), 800))]);
      if (!rec) return;
      const fresh = rec.v === 1 && rec.phone && rec.phone === getSavedPhone() && Date.now() - rec.savedAt < ACCT_MAX_AGE && Array.isArray(rec.orders);
      if (!fresh) {
        acctForget();
        return;
      }
      if (acct) return; // (something already started on this page)
      acct = {
        phone: rec.phone,
        profile: rec.profile || null,
        orders: rec.orders,
        next: rec.next || null,
        hasMore: !!rec.hasMore,
        loaded: !!rec.loaded,
        stale: true, // (the page was closed: pushes were missed, so the orders are checked once when the account is opened)
        shown: Number(rec.shown) || 0,
        wantMore: false,
        streaming: false,
      };
      if (rec.profile && rec.profile.name) setName(rec.phone, rec.profile.name);
    } catch {
      /* no storage: the account loads from the server as before */
    }
  })();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS && acct) {
      acct.stale = true; // (the live connection was closed meanwhile)
      trackCheck(); // (an order may have moved on while the page was away: the Track order strip is checked again)
    }
    if (!document.hidden) hiddenAt = 0;
  });

  /** Tells the page the signed-in customer changed (signed in, signed out, or an order was just placed): the
   * "Order again" row (site-specials.js) listens and draws itself again. */
  function announce() {
    try {
      window.dispatchEvent(new Event("freshcutz:profile"));
    } catch {
      /* ignore */
    }
  }

  /** Tells the live stream (site-customize.js) who is signed in now, so it can send this customer's "Buy it again" list. */
  function announceWho() {
    try {
      window.dispatchEvent(new Event("freshcutz:who"));
    } catch {
      /* ignore */
    }
  }

  function savePhone(phone, quiet) {
    const changed = getSavedPhone() !== phone;
    try {
      localStorage.setItem(STORAGE_KEY, phone);
    } catch {
      /* storage unavailable — they'll just have to log in again next visit */
    }
    if (changed && getName()) forgetName(); // (the name belonged to the number before; getName() already says "" for it)
    announceWho();
    setTimeout(ensureName, 2500); // (the account page / checkout usually tells the name by then; if not it is asked once)
    // tells the notification code a (new) signed-in number exists: the phone then gets that number's recent orders
    try { if (window.CustomerPush && window.CustomerPush.sync) window.CustomerPush.sync(); } catch { /* ignore */ }
    if (!quiet) announce(); // (quiet: the caller redraws the Buy it again row itself, it already holds the answer)
  }

  function clearPhone() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    forgetName();
    nameAsked = "";
    try { if (window.DeliveryMap && DeliveryMap.clearPin) DeliveryMap.clearPin(); } catch { /* ignore */ } // (the top-right button says "Select Location" again)
    // Signing out keeps what this visit already loaded for that number: signing in again with the SAME number shows it at once
    // and only checks (one small live connection for the newest orders) whether anything changed meanwhile. Another number
    // starts clean. (The live connection stops telling this page about the old number's orders once signed out, hence "stale".)
    if (acct) acct.stale = true;
    acctForget(); // (nothing of the account stays saved on the phone)
    announceWho();
    announce();
  }

  /** The address was changed from the checkout's "Change address" page: the Account page's copy is brought up to date (the orders kept). */
  function profileChanged(phone, saved) {
    if (acct && acct.phone === phone && saved && saved.found !== false) {
      acct.profile = { ...(acct.profile || {}), ...saved };
      saveAcctSoon();
    }
    if (saved && saved.name) setName(phone, saved.name);
  }

  /** An order was just placed (checkout): the address may be new and there is a new order at the top - both are read again. */
  function orderPlaced(phone, order) {
    if (window.OrderStatus && order && order.orderCode) OrderStatus.markPlaced(order.orderCode); // (reads "Order Placed" for 5 seconds, then "Confirmed")
    if (acct && acct.phone === phone) {
      acct.profile = null;
      acct.stale = true;
      saveAcctSoon();
    }
    // The order that was just placed is already known from the server's reply: the Track order strip shows it at once, without
    // waiting for (or depending on) a second look-up. The look-up still runs, and again a few seconds later, to catch anything else.
    if (window.OrderCancel) OrderCancel.stamp(order); // (may it be cancelled, and for how long - from the server's reply)
    if (order && order.orderCode) placedHere.set(order.orderCode, { phone, order: { ...order } });
    savePhone(phone);
    if (order && order.customerName) setName(phone, order.customerName);
    announceTrack();
    setTimeout(() => {
      if (acct && acct.phone === phone) acct.stale = true;
      trackCheck();
    }, 4000);
  }

  /** {@code view}: nothing (the header's Account button) = details and orders together; "account" = only the details; "orders" =
   * only My Orders (the bottom menu, see bottom-nav.js). */
  function openProfileIcon(view) {
    if (typeof view !== "string") view = undefined; // (a click event arrives here when used as a listener)
    const phone = getSavedPhone();
    if (phone) {
      openProfile(phone, view);
    } else {
      openLogin(false, view);
    }
  }

  /** {@code quick} (the "Sign in" button of the Buy it again row): only sign in - when the number is recognized the sheet just
   * closes and the row shows the customer's products; the My Account page (a second look-up and the whole order history) is
   * not opened. */
  function openLogin(quick, view) {
    const S = window.CheckoutSheet;
    const body = `
      <form class="sheet-body acct-edit" id="profileLoginForm" novalidate>
        <div class="login-head">
          <div class="login-ico" aria-hidden="true">${view === "orders" ? "🧾" : "👤"}</div>
          <div class="login-title">${quick ? "Sign in" : view === "orders" ? "See your orders" : "Sign in to your account"}</div>
          <p class="acct-edit-intro">
            ${quick ? "Enter the mobile number you've ordered with to see your favorites." : "Enter the mobile number you've ordered with to see your saved address and past orders."}
          </p>
        </div>
        <div class="acct-card acct-edit-card">
          <div class="field">
            <label for="pf-phone">Mobile number</label>
            <input id="pf-phone" name="phone" type="tel" required autocomplete="tel" placeholder="10-digit mobile number" />
            <div class="error" data-err="phone"></div>
          </div>
        </div>
      </form>
      <div class="sheet-footer acct-edit-foot">
        <button class="btn btn-gold btn-block" id="profileLoginBtn" form="profileLoginForm">${SiteCustomize.html("loginButtonText")}</button>
      </div>`;

    const sheet = S.renderSheet(body, quick ? "Sign in" : view === "orders" ? "My Orders" : "My Account");
    const form = sheet.querySelector("#profileLoginForm");
    const btn = sheet.querySelector("#profileLoginBtn");

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const raw = data.get("phone");
      if (!Utils.validatePhone(raw)) {
        sheet.querySelector('[data-err="phone"]').textContent = "Enter a valid 10-digit mobile number";
        return;
      }
      const phone = Utils.normalizePhone(raw);

      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Signing in...`;
      if (quick && window.BuyAgain) {
        // Signing in from the Buy it again row: ONE request does it all - it says whether this number has ordered AND brings
        // the list for the row, so there is no separate look-up and no second request afterwards.
        const found = await window.BuyAgain.check(phone);
        if (found === true) {
          savePhone(phone, true);
          window.BuyAgain.redraw();
          S.closeSheet();
          return;
        }
        if (found === null) {
          btn.disabled = false;
          btn.textContent = SiteCustomize.text("loginButtonText");
          Toast.msg("serverError", { message: "Please try again" });
          return;
        }
        // found === false: nothing to show for this number. Whether it is a customer at all is decided by the normal look-up below: an
        // unknown number gets "We couldn't find any past orders" (and is NOT signed in); a customer whose orders are all cancelled is
        // signed in - the row just does not show.
      }
      // signing in again with the number this visit already looked up (sign out, sign in): nothing to look up again
      let existing = acct && acct.phone === phone ? acct.profile : null;
      if (!existing) {
        try {
          existing = await Api.get(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = SiteCustomize.text("loginButtonText");
          if (quick) announceWho(); // (the live stream goes back to the number that is signed in - none)
          Toast.msg("serverError", { message: err.message });
          return;
        }
      }

      if (!existing || !existing.found) {
        btn.disabled = false;
        btn.textContent = SiteCustomize.text("loginButtonText");
        if (quick) announceWho(); // (not signed in: the live stream forgets this number)
        sheet.querySelector('[data-err="phone"]').textContent =
          "We couldn't find any past orders for this number — place an order first!";
        return;
      }

      if (quick && window.BuyAgain) window.BuyAgain.keepEmpty(phone); // (it has nothing to show: remembered, so nothing is asked again)
      savePhone(phone);
      if (quick) {
        S.closeSheet(); // signed in: the row on the page now fills itself (or does not show, with nothing to show)
        Toast.show("Signed in", "success");
      }
      else renderProfile(phone, existing, view); // (the look-up just made already holds everything the page needs)
    });
  }

  async function openProfile(phone, view) {
    const S = window.CheckoutSheet;
    await acctReady; // (a saved copy from before the reload, if any: read in a few milliseconds, once)
    const kept = acct && acct.phone === phone && acct.profile;
    if (kept) {
      renderProfile(phone, kept, view); // already looked up on this visit: no request
      return;
    }
    S.renderSheet(
      `<div class="sheet-body"><div class="empty-state"><div class="icon">👤</div><p>${SiteCustomize.html("loadingAccountText")}</p></div></div>`,
      view === "orders" ? "My Orders" : "My Account"
    );

    let profile;
    try {
      profile = await Api.get(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
    } catch (err) {
      // The server could not be reached (a phone that has just woken up, a slow connection, the server starting): that says
      // nothing about the account, so the customer STAYS signed in and may try again. (This used to sign them out.)
      const sh = S.renderSheet(
        `<div class="sheet-body"><div class="empty-state"><div class="icon">📡</div><p>${Utils.escapeHtml(err && err.message ? err.message : "Could not reach the server.")}</p><button type="button" class="btn btn-gold" data-role="retry-account">Try again</button></div></div>`,
        view === "orders" ? "My Orders" : "My Account"
      );
      const again = sh && sh.querySelector('[data-role="retry-account"]');
      if (again) again.addEventListener("click", () => openProfile(phone, view));
      return;
    }

    if (!profile || !profile.found) {
      // The saved phone no longer matches anything on file — treat this
      // like a logout instead of showing a broken profile screen.
      clearPhone();
      openLogin(false, view);
      return;
    }

    renderProfile(phone, profile, view);
  }

  function addressSummaryHtml(profile) {
    return `
      <div class="address-summary-card">
        <div class="address-summary-row">🏠 ${Utils.escapeHtml(profile.flatNo)}, ${Utils.escapeHtml(profile.addressLine)}</div>
        ${profile.landmark && SiteCustomize.on("showLandmarkField") ? `<div class="address-summary-row">📍 ${Utils.escapeHtml(profile.landmark)}</div>` : ""}
        <button type="button" class="btn btn-ghost btn-sm" data-role="edit-address" style="margin-top:var(--sp-2);">✏️ Update name &amp; address</button>
      </div>`;
  }

  /** Closing (the X or the dark area) a sheet that was opened FROM the Account page brings the Account page back instead of closing
   * everything. Call right after the sheet is drawn; it only reacts to that one sheet. */
  function returnOnClose(onClose) {
    const root = document.getElementById("sheetRoot");
    const sheetEl = root && root.querySelector(".sheet");
    if (!sheetEl) return;
    const h = (e) => {
      if (!sheetEl.isConnected) { root.removeEventListener("click", h, true); return; }
      const t = e.target;
      if ((t.closest && t.closest('[data-role="close"]')) || (t.matches && t.matches('[data-role="overlay"]'))) {
        e.stopPropagation();
        e.preventDefault();
        root.removeEventListener("click", h, true);
        onClose();
      }
    };
    root.addEventListener("click", h, true);
  }

  /** The Account tab of the bottom menu: the signed-in customer's details, shortcuts, and a short "about the shop" text. */
  function accountPageHtml(phone, profile) {
    const esc = Utils.escapeHtml;
    const txt = (id) => {
      const el = document.getElementById(id);
      return el && !el.hidden ? (el.textContent || "").trim() : "";
    };
    const initial = esc(String(profile.name || "?").trim().charAt(0).toUpperCase() || "?");
    const pretty = /^\d{10}$/.test(phone) ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : esc(phone);
    const brand = esc(txt("brandName") || "FreshCutz");
    const pay = SiteCustomize.payment();
    const row = (role, ico, label) => `<button type="button" class="acct-row" data-role="${role}"><span class="acct-row-ico" aria-hidden="true">${ico}</span><span class="acct-row-text">${label}</span><span class="acct-row-go" aria-hidden="true">›</span></button>`;
    const feat = (ico, title, text) => `<li class="acct-feat"><span class="acct-feat-ico" aria-hidden="true">${ico}</span><span><b>${title}</b><br />${text}</span></li>`;
    return `
      <div class="acct-hero">
        <button type="button" class="acct-x" data-role="acct-x" aria-label="Close">✕</button>
        <div class="acct-avatar" aria-hidden="true">${initial}</div>
        <div class="acct-who">
          <div class="acct-welcome">Welcome back</div>
          <div class="acct-name">Hi, ${esc(profile.name || "")}!</div>
          <div class="acct-phone">${pretty}</div>
        </div>
      </div>

      <div class="acct-card">
        <h3 class="acct-title">${SiteCustomize.html("myAddressTitle")}</h3>
        ${addressSummaryHtml(profile)}
      </div>

      <div class="acct-card acct-rows">
        ${row("acct-orders", "🧾", SiteCustomize.html("myOrdersTitle"))}
        ${row("acct-help", "💬", "Help &amp; support")}
      </div>

      <div class="acct-card acct-about">
        <h3 class="acct-title">About ${brand}</h3>
        <p class="acct-p">We bring fresh chicken from our cutting board to your kitchen. Every order is cut fresh for you, packed hygienically and delivered quickly, so what reaches your door is as good as it gets.</p>
        <ul class="acct-feats">
          ${feat("🐔", "Fresh, never frozen", "Cut to order, not taken out of a freezer.")}
          ${feat("🧼", "Clean and hygienic", "Washed, cut and packed with care.")}
          ${feat("🚚", "Quick delivery", "Order from your phone and we bring it to your door. We call you to confirm the delivery timing.")}
          ${pay.show ? feat("💳", "Easy payment", `Pay by ${esc(String(pay.cod).toLowerCase())} or ${esc(pay.upi)}, whichever suits you.`) : ""}
          ${feat("💬", "Friendly help", "Any question about an order? Message us on WhatsApp.")}
        </ul>
        <p class="acct-thanks">Thank you for choosing ${brand}. 🙏</p>
      </div>

      <button type="button" class="btn btn-ghost btn-block" data-role="logout">${SiteCustomize.html("logoutButtonText")}</button>`;
  }

  function renderProfile(phone, profile, view) {
    const S = window.CheckoutSheet;
    acctFor(phone).profile = profile;
    if (profile && profile.name) setName(phone, profile.name);
    if (window.DeliveryMap && profile) DeliveryMap.pinSaved(profile); // the saved address's pin is the one every screen starts from (unless a newer one is waiting)
    saveAcctSoon();
    const showDetails = view !== "orders"; // address + sign out
    const showOrders = view !== "account"; // My Orders
    const body = view === "account" ? `<div class="sheet-body acct-page">${accountPageHtml(phone, profile)}</div>` : `
      <div class="sheet-body">
        ${showDetails ? `<h3 style="margin:0;font-size:14px;">${SiteCustomize.html("myAddressTitle")}</h3>
        ${addressSummaryHtml(profile)}
        <button type="button" class="btn btn-ghost btn-block" data-role="logout">${SiteCustomize.html("logoutButtonText")}</button>` : ""}
        ${showOrders ? `${view === "orders" ? "" : `<h3 style="margin-top:var(--sp-2);margin-bottom:0;font-size:14px;">${SiteCustomize.html("myOrdersTitle")}</h3>`}
        <div id="profileOrdersList"></div>` : ""}
      </div>`;

    const sheet = S.renderSheet(body, view === "orders" ? "My Orders" : view === "account" ? "My Account" : `Hi, ${Utils.escapeHtml(profile.name)}!`);
    if (view === "account") {
      // (no title bar: the greeting card is the top of the page and has its own ✕, which does what the hidden title bar's ✕ does)
      const dlg = sheet.querySelector(".sheet");
      dlg.classList.add("sheet-acct");
      dlg.setAttribute("aria-label", "My Account");
      sheet.querySelector('[data-role="acct-x"]').addEventListener("click", () => sheet.querySelector('.sheet-header [data-role="close"]').click());
    }

    if (showDetails) {
      sheet.querySelector('[data-role="edit-address"]').addEventListener("click", () => {
        const go = () => renderAddressEdit(phone, profile, view);
        if (window.DeliveryMap) DeliveryMap.pickThen(profile, go); // (the map is on the address page itself now)
        else go();
      });
      sheet.querySelector('[data-role="logout"]').addEventListener("click", () => {
        clearPhone();
        S.closeSheet();
        Toast.msg("loggedOut");
      });
    }
    if (view === "account") {
      const backHere = () => renderProfile(phone, profile, "account"); // the X of the next page brings this page back
      const ord = sheet.querySelector('[data-role="acct-orders"]');
      if (ord) ord.addEventListener("click", () => {
        renderProfile(phone, profile, "orders");
        returnOnClose(backHere);
      });
      const help = sheet.querySelector('[data-role="acct-help"]');
      if (help) help.addEventListener("click", () => { if (window.BottomNav) window.BottomNav.openHelp(backHere); });
    }

    if (showOrders) {
      if (window.UpiPay) UpiPay.collapseAll(); // opened afresh: the "Forgot to pay?" sections start folded
      loadOrders(phone, sheet.querySelector("#profileOrdersList"));
    }
  }

  // ---- the orders: a few at a time, pushed over a live connection ---------------------------------------------------
  // The account screen opens a short live (SSE) connection that pushes only the newest STREAM_LIMIT orders and closes. When the
  // customer scrolls to the end of the list (the line with the spinner), one more connection brings the next STREAM_LIMIT orders,
  // from where the last one stopped. Orders already loaded are kept in memory, so scrolling back up or reopening needs nothing.
  // (STREAM_LIMIT is the only number to change to fetch more or fewer orders at a time.)

  const SHOW_STEP = 3; // orders drawn at first, and added each time the end of the list is reached
  const STREAM_LIMIT = 3; // orders pushed per connection

  let moreObserver = null;

  /** Opens the live connection and calls onChunk({ orders, hasMore, next }) for each push. Resolves when the server says "done";
   * rejects if the connection fails before that (the connection is closed either way). */
  function streamOrders(phone, after, limit, onChunk) {
    return new Promise((resolve, reject) => {
      if (!window.EventSource) return reject(new Error("no-live"));
      const q = `phone=${encodeURIComponent(phone)}&limit=${limit}&first=${SHOW_STEP}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const es = new EventSource(Api.streamUrl(`/api/customers/orders/stream?${q}`));
      let finished = false;
      const end = (fn, v) => {
        if (finished) return;
        finished = true;
        es.close();
        fn(v);
      };
      es.addEventListener("orders", (e) => {
        try {
          const c = JSON.parse(e.data);
          if (c && Array.isArray(c.orders)) {
            if (window.OrderCancel) OrderCancel.stamp(c.orders); // (the seconds left to cancel become a clock time here)
            onChunk(c);
          }
        } catch {
          /* a push that is not understood is skipped */
        }
      });
      es.addEventListener("done", () => end(resolve));
      es.addEventListener("error", () => end(reject, new Error("Could not load your orders — please try again.")));
    });
  }

  /** Reads the history the old way (everything at once) — only for a server that does not have the live connection yet. */
  async function legacyOrders(phone) {
    const all = await Api.get(`/api/customers/orders?phone=${encodeURIComponent(phone)}`);
    if (window.OrderCancel) OrderCancel.stamp(all);
    try {
      // the whole history is here, so the "Buy it again" row can work itself out from it (as it always did)
      window.dispatchEvent(new CustomEvent("freshcutz:orders", { detail: { phone, orders: all } }));
    } catch {
      /* ignore */
    }
    return { orders: all, hasMore: false, next: null };
  }

  /** Adds a push to what is held (an order already held is not added twice). */
  function takeChunk(state, c) {
    const known = new Set(state.orders.map((o) => o.orderCode));
    c.orders.forEach((o) => {
      if (!known.has(o.orderCode)) state.orders.push(o);
    });
    state.hasMore = !!c.hasMore;
    state.next = c.next || null;
    saveAcctSoon();
  }

  function moreHtml(state) {
    if (state.shown < state.orders.length || state.hasMore) {
      return `<div class="profile-orders-more" data-role="more"><span class="spinner"></span><span>Loading more orders…</span></div>`;
    }
    return state.orders.length > SHOW_STEP ? `<div class="profile-orders-end">That's all your orders</div>` : "";
  }

  /** Draws the first part of the orders held in memory, and starts watching for the end of the list. */
  function drawOrders(container, state) {
    if (!container.isConnected) return;
    if (moreObserver) {
      moreObserver.disconnect();
      moreObserver = null;
    }
    state.shown = Math.max(SHOW_STEP, Math.min(state.shown || 0, state.orders.length));
    const list = state.orders.slice(0, state.shown);
    container.innerHTML = list.length
      ? list.map((o) => orderCardHtml(o)).join("") + moreHtml(state)
      : window.BottomNav
        ? BottomNav.emptyHtml("🧾", "Your orders will appear here", SiteCustomize.html("noOrdersText"))
        : `<div class="empty-state"><p>${SiteCustomize.html("noOrdersText")}</p></div>`;
    watchEnd(container, state);
  }

  function watchEnd(container, state) {
    const more = container.querySelector('[data-role="more"]');
    if (!more) return;
    if (!("IntersectionObserver" in window)) {
      revealMore(container, state); // (no observer in this browser: just show them all, a few at a time)
      return;
    }
    if (!moreObserver) {
      moreObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) {
            state.wantMore = true;
            revealMore(container, state);
          }
        },
        { rootMargin: "200px" }
      );
    }
    moreObserver.observe(more);
  }

  /** The end of the list was reached: show the next orders from memory; if everything pushed so far is already shown, ask for the
   * next push (one more live connection) and show them as they arrive. */
  function revealMore(container, state) {
    if (!container.isConnected) return;
    const more = container.querySelector('[data-role="more"]');
    if (!more) return;
    if (state.shown < state.orders.length) {
      const from = state.shown;
      state.shown = Math.min(state.orders.length, state.shown + SHOW_STEP);
      more.insertAdjacentHTML("beforebegin", state.orders.slice(from, state.shown).map((o) => orderCardHtml(o)).join(""));
      state.wantMore = false;
      saveAcctSoon();
      if (state.shown >= state.orders.length && !state.hasMore) {
        if (moreObserver) moreObserver.disconnect();
        moreObserver = null;
        more.outerHTML = moreHtml(state);
        return;
      }
      if (moreObserver) {
        moreObserver.unobserve(more); // (still at the end on a tall screen? looking again makes it check once more)
        moreObserver.observe(more);
      } else if (state.shown < state.orders.length) {
        revealMore(container, state);
      }
      return;
    }
    if (state.hasMore) pushMore(container, state);
  }

  /** Opens one more live connection for the orders after the last one held. */
  async function pushMore(container, state) {
    if (state.streaming) return;
    state.streaming = true;
    try {
      await streamOrders(state.phone, state.next, STREAM_LIMIT, (c) => {
        takeChunk(state, c);
        if (state.wantMore) revealMore(container, state); // the customer is waiting at the end of the list
      });
    } catch {
      const more = container.isConnected && container.querySelector('[data-role="more"]');
      if (more) {
        more.innerHTML = `<span>Couldn't load more orders.</span><button type="button" class="btn btn-ghost btn-sm" data-role="retry-more">Try again</button>`;
        more.querySelector('[data-role="retry-more"]').addEventListener("click", () => {
          more.innerHTML = `<span class="spinner"></span><span>Loading more orders…</span>`;
          pushMore(container, state);
        });
      }
    } finally {
      state.streaming = false;
    }
  }

  /** Shows an order's status on its card (if the account page is open). */
  function paintStatus(code, status, order) {
    document.querySelectorAll(".profile-order-card").forEach((card) => {
      if (card.dataset.code !== code) return;
      const badge = card.querySelector(".badge");
      if (badge) {
        badge.textContent = card.dataset.track ? trackText(status, code) : statusLabel(status, code);
        badge.className = `badge ${badgeClass(status, code)}`;
      }
      const steps = card.parentElement && card.parentElement.querySelector(".trk-steps");
      if (steps && card.dataset.track) steps.outerHTML = trackStepsHtml(code, status);
      const note = card.parentElement && card.parentElement.querySelector(".trk-note");
      if (note && card.dataset.track) note.outerHTML = trackNoteHtml(code, status, order);
      if (window.OrderCancel && order) OrderCancel.settle(card, { ...order, status }); // (the Cancel button goes when it no longer applies)
      if (window.UpiPay && order) UpiPay.settle(card, { ...order, status }); // delivered / cancelled: no more "Forgot to pay?" or screenshot upload; back to packed: they return
    });
  }

  /** Pushes may have been missed (the page was closed or hidden for a while, or the customer signed out and in again): the newest
   * STREAM_LIMIT orders are read again in one small live connection and folded into what is held. Everything loaded earlier stays
   * (it is what the customer already saw, and it is shown again at once); a status that changed is updated in place, and only a NEW
   * order makes the list draw again. */
  async function refreshNewest(container, state) {
    try {
      await refreshNewestNow(container, state);
    } finally {
      announceTrack();
    }
  }

  async function refreshNewestNow(container, state) {
    const got = [];
    let last = null;
    try {
      await streamOrders(state.phone, null, STREAM_LIMIT, (c) => {
        got.push(...c.orders);
        last = c;
      });
    } catch {
      state.stale = true; // offline: what is held stays on screen, and is checked again next time
      return;
    }
    trackVerified = state.phone; // (read from the server just now)
    if (!last) return;
    const fresh = new Map(got.map((o) => [o.orderCode, o]));
    if (state.orders.length && !state.orders.some((o) => fresh.has(o.orderCode))) {
      // so many new orders that they do not join up with what is held: start again from the newest
      state.orders = got.slice();
      state.hasMore = !!last.hasMore;
      state.next = last.next || null;
      state.shown = SHOW_STEP;
      saveAcctSoon();
      drawOrders(container, state);
      return;
    }
    const heldCodes = new Set(state.orders.map((o) => o.orderCode));
    const added = got.filter((o) => !heldCodes.has(o.orderCode));
    state.orders.forEach((o, i) => {
      const f = fresh.get(o.orderCode);
      if (!f) return;
      if (f.status !== o.status) paintStatus(o.orderCode, f.status, f);
      state.orders[i] = f;
    });
    if (added.length) {
      state.orders = added.concat(state.orders).sort((x, y) => (Date.parse(y.createdAt) || 0) - (Date.parse(x.createdAt) || 0));
      state.shown = (state.shown || SHOW_STEP) + added.length;
      drawOrders(container, state);
    }
    saveAcctSoon();
  }

  async function loadOrders(phone, container) {
    const state = acctFor(phone);
    container.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="reorder"]');
      if (!btn) return;
      const order = state.orders.find((o) => o.orderCode === btn.dataset.orderCode);
      if (order) reorder(order);
    });
    if (state.loaded) {
      drawOrders(container, state); // kept from earlier on this visit: no request
      if (state.stale) {
        state.stale = false;
        refreshNewest(container, state);
      }
      return;
    }
    // until the first orders arrive only this line with a spinner shows; the orders then replace it at once
    container.innerHTML = `<div class="profile-orders-more profile-orders-loading"><span class="spinner"></span><span>Loading your orders…</span></div>`;
    let drew = false;
    const show = () => {
      state.loaded = true;
      trackVerified = phone; // (read from the server just now)
      announceTrack();
      if (!drew) {
        drew = true;
        drawOrders(container, state); // the first push: the newest orders appear at once
      } else if (state.wantMore) {
        revealMore(container, state);
      }
    };
    try {
      state.streaming = true;
      await streamOrders(phone, null, STREAM_LIMIT, (c) => {
        takeChunk(state, c);
        show();
      });
      if (!drew) show(); // (no orders at all: say so)
    } catch (err) {
      if (!drew) {
        try {
          // an older server without the live connection: the whole list, as before
          const all = await legacyOrders(phone);
          state.orders = all.orders.slice();
          state.hasMore = false;
          state.next = null;
          show();
        } catch (err2) {
          if (container.isConnected) container.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err2.message)}</p></div>`;
        }
      }
    } finally {
      state.streaming = false;
    }
  }

  // "Order Placed" -> "Confirmed" after 5 seconds (order-status.js): the order's card and the Track order strip are redrawn.
  window.addEventListener("freshcutz:orderstage", (e) => {
    const code = e && e.detail && e.detail.orderCode;
    if (!code) return;
    const mine = placedHere.get(code);
    const held = acct && acct.orders ? acct.orders.find((o) => o.orderCode === code) : null;
    const order = held || (mine && mine.order);
    if (order) paintStatus(code, order.status, order);
    announceTrack();
  });

  // The admin changed an order's status: the order held (and on screen, if the account page is open) shows it at once.
  window.addEventListener("freshcutz:orderstatus", (e) => {
    const d = (e && e.detail) || {};
    const mine = d.orderCode ? placedHere.get(d.orderCode) : null;
    if (mine) {
      mine.order.status = d.status;
      mine.order.deliveredAt = d.deliveredAt || null;
      if (window.OrderCancel) OrderCancel.apply(mine.order, d);
      announceTrack();
    }
    if (!acct || !d.orderCode) return;
    const held = acct.orders.find((o) => o.orderCode === d.orderCode);
    if (!held) {
      if (acct.loaded && !acct.hasMore) acct.stale = true; // (an order this page has never seen: read the newest again next time)
      trackCheck(); // (it may be an order placed on another phone: the Track order strip looks again)
      return;
    }
    held.status = d.status;
    held.deliveredAt = d.deliveredAt || null;
    if (window.OrderCancel) OrderCancel.apply(held, d); // (cancelling may still be allowed in the new status - or not any more)
    if (d.refresh) acct.stale = true; // (the shop refused a cancel: the next look at the orders re-reads them)
    paintStatus(d.orderCode, d.status, held);
    saveAcctSoon();
    announceTrack(); // (delivered / cancelled: the Track order strip goes away at once)
  });

  // ---- the order on its way: feeds the "Track order" strip above the bottom menu (bottom-nav.js) ----------------------------------
  // Shown while the signed-in customer has an order that is NEW or PACKED. The newest orders are read once in the background
  // (one small live connection, the same one My Orders uses, and what it reads is kept for My Orders), and after that the status
  // pushes above keep it current. Nothing is drawn from a saved copy until the server has confirmed it.
  const ON_ITS_WAY = { NEW: 1, PACKED: 1 };
  let trackVerified = ""; // the phone whose orders were read from the server on this visit
  let trackBusy = false;
  let trackBusySince = 0;
  let trackAgain = false;

  const placedHere = new Map(); // orders placed on this page: orderCode -> { phone, order } (known from the server's reply)

  /** The signed-in customer's orders that are not delivered or cancelled yet, newest first. */
  function activeOrders() {
    const phone = getSavedPhone();
    if (!phone) return [];
    const out = [];
    const seen = new Set();
    if (acct && acct.phone === phone && trackVerified === phone) {
      acct.orders.forEach((o) => {
        seen.add(o.orderCode);
        if (ON_ITS_WAY[o.status]) out.push(o);
      });
    }
    placedHere.forEach((e) => {
      if (e.phone === phone && !seen.has(e.order.orderCode) && ON_ITS_WAY[e.order.status]) out.push(e.order);
    });
    return out.sort((x, y) => (Date.parse(y.createdAt) || 0) - (Date.parse(x.createdAt) || 0));
  }

  /** One order of the signed-in customer by its code (as last heard from the server), or null. */
  function findOrder(code) {
    const held = acct && acct.orders ? acct.orders.find((o) => o.orderCode === code) : null;
    if (held) return held;
    const mine = placedHere.get(code);
    return mine ? mine.order : null;
  }

  function announceTrack() {
    try {
      window.dispatchEvent(new Event("freshcutz:track"));
    } catch {
      /* ignore */
    }
  }

  /** The Track order strip must show EVERY open order, however old. "My Orders" only holds the newest page until the customer scrolls
   * down, so while there are more orders on the server, the open ones are asked for by themselves (a tiny list: New / Packed only)
   * and kept beside the held list, never inside it (so the list's paging is untouched). */
  async function loadOpenExtras(phone, state) {
    const extras = () => placedHere.forEach((e, code) => { if (e.extra) placedHere.delete(code); });
    if (!state.hasMore) { extras(); return; } // everything is held already
    let open;
    try {
      open = await Api.get(`/api/customers/orders/open?phone=${encodeURIComponent(phone)}`);
    } catch {
      return; // offline, or a server without this: the strip shows what is held
    }
    if (getSavedPhone() !== phone || !Array.isArray(open)) return;
    if (window.OrderCancel) OrderCancel.stamp(open);
    const held = new Set(state.orders.map((o) => o.orderCode));
    const keep = new Set();
    open.forEach((o) => {
      if (held.has(o.orderCode)) return;
      keep.add(o.orderCode);
      const now = placedHere.get(o.orderCode);
      if (now && !now.extra) return; // (placed on this page: its own, fresher, copy stays)
      placedHere.set(o.orderCode, { phone, order: { ...o }, extra: true });
    });
    placedHere.forEach((e, code) => { if (e.extra && !keep.has(code)) placedHere.delete(code); });
  }

  async function trackCheck() {
    if (trackBusy && Date.now() - trackBusySince < 25000) {
      trackAgain = true;
      return;
    }
    trackBusy = true; // (a look-up that has hung for 25 s no longer blocks the next one)
    trackBusySince = Date.now();
    try {
      const phone = getSavedPhone();
      if (!phone) {
        announceTrack(); // (signed out: the strip goes)
        return;
      }
      await acctReady;
      if (getSavedPhone() !== phone) return;
      const state = acctFor(phone);
      if (state.streaming && Date.now() - trackBusySince < 25000) return; // (My Orders is loading right now: it announces when it has them)
      if (state.loaded) {
        if (!state.stale && trackVerified === phone) {
          announceTrack();
          return;
        }
        state.stale = false;
        await refreshNewest(document.createElement("div"), state); // (nothing is drawn: the container is not on the page)
        await loadOpenExtras(phone, state);
        announceTrack();
      } else {
        state.streaming = true;
        try {
          await streamOrders(phone, null, STREAM_LIMIT, (c) => takeChunk(state, c));
          state.loaded = true;
          trackVerified = phone;
          await loadOpenExtras(phone, state);
        } catch {
          /* offline, or a server without the live connection: no strip */
        } finally {
          state.streaming = false;
        }
        announceTrack();
      }
    } finally {
      trackBusy = false;
      if (trackAgain) {
        trackAgain = false;
        trackCheck();
      }
    }
  }


  /** The friendly line at the top of the opened-out Track order panel. */
  function trackNoteHtml(code, status, order) {
    const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
    const BAG = icon('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>');
    const SEAL = icon('<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>');
    const BOX = icon('<path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><path d="M3.29 7 12 12l8.71-5"/><path d="M12 22V12"/>');
    const CLOCK = icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
    // "Getting Ready" is where a packed order waits for its delivery time, so it says so (with the time, when one was chosen)
    const slot = order && order.deliverySlot ? Utils.escapeHtml(window.SlotTime ? SlotTime.display(order.deliverySlot, status) : order.deliverySlot) : "";
    const words = {
      placed: [BAG, "Thank you! We've got your order", "We'll confirm it with you shortly."],
      confirmed: [SEAL, "Your order is confirmed", "Your fresh order is being lined up for you."],
      ready: slot
        ? [CLOCK, "All set for your delivery time", `${slot}. Fresh, and getting ready for you. We'll bring it to your door.`]
        : [CLOCK, "All set, we're getting it ready", "Fresh, and getting ready for you. We'll bring it to your door."],
      delivered: [BOX, "Delivered. Enjoy!", "Thank you for ordering with us."],
    }[stageOf(status, code)];
    if (!words) return `<div class="trk-note" data-code="${Utils.escapeHtml(code)}" hidden></div>`;
    return `<div class="trk-note" data-code="${Utils.escapeHtml(code)}"><span class="trk-note-ico" aria-hidden="true">${words[0]}</span><div><div class="trk-note-title">${words[1]}</div><div class="trk-note-sub">${words[2]}</div></div></div>`;
  }

  /** The four steps of an order on its way, drawn in the Track order popup. */
  function trackStepsHtml(code, status) {
    if (status === "CANCELLED") {
      return `<div class="trk-steps is-cancelled" data-code="${Utils.escapeHtml(code)}"><div class="trk-cancelled">This order was cancelled</div></div>`;
    }
    const st = stageOf(status, code);
    const delivered = st === "delivered";
    const at = { placed: 1, confirmed: 2, ready: 3, delivered: 4 }[st] || 1; // the last step reached
    const done = at; // (delivered: all four are done)
    const step = (n, label) => `<div class="trk-step${n <= done ? " is-done" : ""}${n === at && !delivered ? " is-now" : ""}"><i>${n <= done ? "✓" : n}</i><span>${label}</span></div>`;
    const line = (n) => `<div class="trk-line${n < done ? " is-done" : n === done && !delivered ? " is-part" : ""}"></div>`; // (steps already passed: full colour; the line out of the step it is at: just a short stretch, on its way to the next)
    return `<div class="trk-steps" data-code="${Utils.escapeHtml(code)}">${step(1, "Order Placed")}${line(1)}${step(2, "Confirmed")}${line(2)}${step(3, "Getting Ready")}${line(3)}${step(4, "Delivered")}</div>`;
  }

  /** What the Track order strip shows when it is opened out (bottom-nav.js): the four steps and that order's card. */
  function trackDetailsHtml(order) {
    if (window.UpiPay) UpiPay.collapseAll();
    return `${trackNoteHtml(order.orderCode, order.status, order)}${trackStepsHtml(order.orderCode, order.status)}${orderCardHtml(order, true)}`;
  }

  /** "Reorder" from the opened-out strip. */
  function reorderOrder(code) {
    const o = activeOrders().find((x) => x.orderCode === code);
    if (o) reorder(o);
  }

  /** "Reorder" on a past order — adds each line back to the cart at
   *  today's price/stock (never the snapshotted order-time values), just
   *  like tapping "Add to cart" on the product grid would. Anything no
   *  longer sold, out of stock, or missing the size it was ordered in gets
   *  skipped and rolled into one summary toast instead of failing silently
   *  or one toast per item. */
  async function reorder(order) {
    // The products of an old order may not be on the page (the shop loads a few at a time): fetch just those.
    try {
      await window.Storefront.ensureProducts(order.items.map((i) => i.productId));
    } catch {
      /* offline: whatever isn't known is reported as unavailable below */
    }
    const unavailable = [];
    const toAdd = []; // { product, variant, quantity } — figured out before touching the cart at all

    order.items.forEach((item) => {
      const product = window.Storefront.getProduct(item.productId);
      if (!product) {
        unavailable.push(item.productName); // no longer in the (enabled) catalog at all
        return;
      }
      let variant = item.variant;
      if (variant !== "variant1" && variant !== "variant2") {
        // Order placed before the variant key itself was recorded —
        // fall back to matching the saved label text against this
        // product's current ones.
        variant = item.variantLabel === product.variant2Label ? "variant2" : "variant1";
      }
      const stillOffered = variant === "variant2" ? !!product.variant2Price : true;
      if (!stillOffered || product.outOfStock) {
        unavailable.push(item.productName);
        return;
      }
      toAdd.push({ product, variant, quantity: item.quantity });
    });

    if (toAdd.length > 0) {
      // Reorder replaces the cart with just this order — whatever was
      // already sitting in there gets cleared first, rather than piling
      // this order on top of it. Only clears once we know there's at
      // least one item to actually reorder, so an order that's entirely
      // unavailable never wipes out an existing cart for nothing.
      Cart.clear();
      toAdd.forEach(({ product, variant, quantity }) => {
        Cart.setQuantity(product, variant, quantity);
      });
      window.CheckoutSheet.openCart();
      Toast.msg("reorderAdded");
    }
    if (unavailable.length > 0) {
      Toast.msg("reorderUnavailable", {
        names: unavailable.join(", "),
        isAre: unavailable.length === 1 ? "is" : "are",
      });
    }
  }

  function orderItemsHtml(order) {
    return order.items
      .map(
        (i) =>
          `<div>${i.quantity} × ${Utils.escapeHtml(i.productName)} (${Utils.escapeHtml(i.variantLabel)}) — ${Utils.formatMoney(i.lineTotal)}</div>`
      )
      .join("");
  }

  function orderCardHtml(order, track) {
    return `
    <div class="profile-order-card" data-code="${Utils.escapeHtml(order.orderCode)}"${track ? ' data-track="1"' : ""}>
      <div class="profile-order-head">
        <div>
          <div class="profile-order-code">${SiteCustomize.html("orderIdLabel")} ${Utils.escapeHtml(order.orderCode)}</div>
          <div class="profile-order-time">${Utils.formatDateTime(order.createdAt)}</div>
        </div>
        <span class="badge ${badgeClass(order.status, order.orderCode)}">${Utils.escapeHtml(track ? trackText(order.status, order.orderCode) : statusLabel(order.status, order.orderCode))}</span>
      </div>
      <div class="profile-order-address">
        🏠 ${Utils.escapeHtml(order.flatNo)}, ${Utils.escapeHtml(order.addressLine)}
        ${order.landmark ? `<br/>📍 ${Utils.escapeHtml(order.landmark)}` : ""}
        ${order.deliverySlot ? `<br/>🕗 Delivery time: ${Utils.escapeHtml(SlotTime.display(order.deliverySlot, order.status))}` : ""}
        ${order.paymentMode ? `<br/>💳 Payment: ${Utils.escapeHtml(order.paymentMode === "UPI" ? SiteCustomize.t("upiLabel") : SiteCustomize.t("codLabel"))}` : ""}
        ${order.notes ? `<br/>📝 ${Utils.escapeHtml(order.notes)}` : ""}
      </div>
      <div class="profile-order-items">${orderItemsHtml(order)}</div>
      <div class="profile-order-total"><span>${SiteCustomize.html("totalLabel")}</span><span>${Utils.formatMoney(order.totalAmount)}</span></div>
      ${window.UpiPay ? UpiPay.forgotHtml(order) : ""}
      <button
        type="button"
        class="btn btn-gold btn-sm btn-block"
        style="margin-top:8px;"
        data-action="reorder"
        data-order-code="${Utils.escapeHtml(order.orderCode)}"
      >${SiteCustomize.html("reorderButtonText")}</button>
      ${window.OrderCancel ? OrderCancel.html(order) : ""}
    </div>`;
  }

  /** The "Edit your name and address" page, opened straight from the delivery-map button after the customer confirmed a location:
   * the pin and the street / area under it are already in the form, ready to be used and saved. Resolves false when it can't open. */
  async function editAddress(opts = {}) {
    const phone = getSavedPhone();
    if (!phone || !window.CheckoutSheet) return false;
    try {
      // the answer is reused when it is already held (passed in, or read earlier for the Account page): no second look-up
      const held = acct && acct.phone === phone && acct.profile && acct.profile.found !== false && acct.profile.name ? acct.profile : null;
      const profile = opts.profile || held || (await Api.get(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`));
      if (!profile || (profile !== held && !profile.found)) return false;
      if (!held && !opts.profile) profileChanged(phone, profile); // keep it for the next time
      if (window.DeliveryMap) DeliveryMap.pinSaved(profile); // the saved address's pin is the one the map starts from
      renderAddressEdit(phone, profile, "account", opts);
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderAddressEdit(phone, profile, view, opts = {}) {
    const S = window.CheckoutSheet;
    const body = `
      <form class="sheet-body acct-edit" id="profileAddressForm" novalidate>
        <button type="button" class="acct-back" data-role="back">‹ Back</button>
        <p class="acct-edit-intro">Update your name and where we should deliver your orders.</p>
        <div class="acct-card acct-edit-card addr-card">
          ${window.DeliveryMap ? DeliveryMap.pickerHtml(profile) : ""}
          <div class="field">
            <label for="pf-name">Your name</label>
            <input id="pf-name" name="name" required autocomplete="name" value="${Utils.escapeHtml(profile.name || "")}" />
            <div class="error" data-err="name"></div>
          </div>
          <div class="field">
            <label for="pf-flat">Flat / House no.</label>
            <input id="pf-flat" name="flatNo" required value="${Utils.escapeHtml(profile.flatNo || "")}" />
            <div class="error" data-err="flatNo"></div>
          </div>
          <div class="field">
            <label for="pf-address" data-dm-addr-label>${window.DeliveryMap ? DeliveryMap.addrLabel(profile) : "Building name / Address"}</label>
            <textarea id="pf-address" name="addressLine" rows="2" placeholder="${Utils.escapeHtml(window.DeliveryMap ? DeliveryMap.addrPlaceholder(profile) : "")}">${Utils.escapeHtml(window.DeliveryMap ? DeliveryMap.buildingOf(profile) : profile.addressLine || "")}</textarea>
            <div class="error" data-err="addressLine"></div>
          </div>
          ${
            SiteCustomize.on("showLandmarkField")
              ? `<div class="field">
            <label for="pf-landmark">Landmark (optional)</label>
            <input id="pf-landmark" name="landmark" value="${Utils.escapeHtml(profile.landmark || "")}" />
          </div>`
              : `<input type="hidden" name="landmark" value="${Utils.escapeHtml(profile.landmark || "")}" />`
          }
        </div>
      </form>
      <div class="sheet-footer acct-edit-foot">
        <button class="btn btn-gold btn-block" id="pfSaveBtn" form="profileAddressForm">${SiteCustomize.html("updateDetailsText")}</button>
      </div>`;

    const sheet = S.renderSheet(body, "Edit your name and address");
    sheet.querySelector(".sheet").classList.add("sheet-addr");
    if (window.DeliveryMap) DeliveryMap.wirePicker(sheet);
    const form = sheet.querySelector("#profileAddressForm");
    const saveBtn = sheet.querySelector("#pfSaveBtn");

    // (opened from the map button: Back just closes this page; opened from My Account: Back returns to it)
    const leave = () => (opts.fromMap ? S.closeSheet() : renderProfile(phone, profile, view));
    const saveLabel = () => (saveBtn.textContent || "").trim() || "Update Details";
    // a spot chosen on the map is lost when this page is left without saving: ask first (Back, ✕ and the dark area)
    const guard = (go) => !!(window.DeliveryMap && DeliveryMap.guardLeave(form, saveLabel(), go));
    S.setLeaveGuard(guard);
    sheet.querySelector('[data-role="back"]').addEventListener("click", () => { if (!guard(leave)) leave(); });

    saveBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const errors = {};
      if (!data.get("name")?.trim()) errors.name = SiteCustomize.text("errName");
      if (!data.get("flatNo")?.trim()) errors.flatNo = SiteCustomize.text("errFlat");
      if (!data.get("addressLine")?.trim()) {
        if (!(window.DeliveryMap && DeliveryMap.addressOptional(data))) errors.addressLine = SiteCustomize.text("errAddress"); // (a spot on the map is an address on its own)
      } else if (Utils.isJunkAddress(data.get("addressLine"))) errors.addressLine = Utils.JUNK_ADDRESS_MESSAGE;
      if (Object.keys(errors).length > 0) {
        sheet.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
        Object.entries(errors).forEach(([field, msg]) => {
          const el = sheet.querySelector(`[data-err="${field}"]`);
          if (el) el.textContent = msg;
        });
        return;
      }

      const payload = {
        phone,
        name: data.get("name").trim(),
        flatNo: data.get("flatNo").trim(),
        addressLine: window.DeliveryMap ? DeliveryMap.addressFrom(data) : data.get("addressLine").trim(),
        landmark: data.get("landmark")?.trim() || null,
        ...(window.DeliveryMap ? DeliveryMap.pinFrom(data) : {}),
      };

      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="spinner"></span> Updating...`;
      try {
        const updated = await Api.put("/api/customers/address", payload);
        if (window.DeliveryMap) DeliveryMap.pinSaved(updated && updated.deliveryLat != null ? updated : payload, true);
        Toast.msg("detailsUpdated");
        profileChanged(phone, updated); // the next screen that needs the address already has it
        if (opts.fromMap) S.closeSheet();
        else renderProfile(phone, updated, view);
      } catch (err) {
        Toast.msg("serverError", { message: err.message });
        saveBtn.disabled = false;
        saveBtn.textContent = SiteCustomize.text("updateDetailsText");
      }
    });
  }

  document.getElementById("profileIconBtn").addEventListener("click", openProfileIcon);

  /** The header button says "Sign in" until a customer is signed in, then "Account". */
  function paintAccountButton() {
    const btn = document.getElementById("profileIconBtn");
    if (!btn) return;
    const signedIn = !!getSavedPhone();
    document.documentElement.classList.toggle("signed-in", signedIn); // (the words themselves come from CSS: see storefront-header.css)
    btn.setAttribute("aria-label", signedIn ? "Your account" : "Sign in");
  }
  paintAccountButton();
  acctReady.then(() => setTimeout(ensureName, 1500));
  window.addEventListener("freshcutz:who", paintAccountButton); // signed in / signed out / saved at checkout
  window.addEventListener("freshcutz:who", trackCheck); // (the Track order strip: a new sign-in or order is looked up, a sign-out clears it)
  trackCheck();
  window.addEventListener("storage", paintAccountButton); // (another tab)

  return { open: openProfileIcon, openAccount: () => openProfileIcon("account"), openOrders: () => openProfileIcon("orders"), returnOnClose, activeOrders, findOrder, trackDetailsHtml, reorderOrder, trackText, signIn: () => openLogin(true), editAddress, getSavedPhone, getName, profileChanged, savePhone: orderPlaced };
})();
