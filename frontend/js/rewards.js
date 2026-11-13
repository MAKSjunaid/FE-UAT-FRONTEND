/* Rewards on the customer website: limited offers (claim button, "N left", countdown, held for a few minutes while checking out),
 * automatic offers, code offers and vouchers (gifts / loyalty). One place for every screen that shows them:
 *
 *   Rewards.mountHome(el)        the strip under the header (home page)
 *   Rewards.mount(el)            the offer card on the Final Step: claim, applied, change, "have a code?"
 *   Rewards.mountAccount(el)     "My rewards" in the account screen
 *   Rewards.discountFor(q)       used by charges.js: the discount that applies to this bill (so the totals show it)
 *   Rewards.setPhone(p)          the number being ordered with (the Final Step knows it before the customer is signed in)
 *   Rewards.afterOrder()         the order was placed: what it used is gone, read again
 *   Rewards.savedHtml(order)     "You saved ₹X" on the order-placed screen
 *
 * This file only REPEATS the server's rules (server/RewardsCalc.java) to show the discount while the cart is open: money in paise.
 * The server works the discount out again when the order is placed, and what it says counts (the page sends the total it showed).
 *
 * Kept light on purpose: the public list is read once per visit (the browser keeps it a few seconds, and asks "has it changed?" with an
 * ETag); a signed-in customer's own list is read only when it is needed (Final Step, My rewards, the home strip) and kept 45 seconds;
 * a change by the owner arrives over the live connection (and each page waits a random moment before asking, so they do not all ask at once). */

window.Rewards = (() => {
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const money = (paise) => Utils.formatMoney(paise / 100);
  const P = (rupees) => Math.round(Number(rupees || 0) * 100);
  const KEY = "fc_rewards_pub";
  const MINE_FRESH = 45 * 1000;

  let pub = null;        // {offers, codes, v, at}  (offers for everybody)
  let mine = null;       // {phone, offers, vouchers, codes, blocked, at}
  let skew = 0;          // server clock - this phone's clock (ms)
  let phoneNow = "";     // the number being ordered with
  let pubFlying = null;
  let mineFlying = null;
  let mineSeq = 0; // goes up with every change this page makes (claim, remove): the answer to a read that started BEFORE it is old news and is not shown
  const declined = new Set(); // entries the customer took off this order ("O12" / "V5")
  let popKey = ""; // the entry just put back on the bill (its card glows once)
  let accOpen = false;   // My rewards (account screen) is opened: it reads the customer's offers only when tapped open
  const claimMsg = {};   // offerId -> why a Claim was refused (shown on that offer's card until the next try)
  let coAll = false;     // Final Step lists every other offer (otherwise the first two)
  let homeSig = "";      // what the home slider shows now (it is redrawn only when this changes)
  let homeIds = [];      // the offers in the slider, in order (so the view can follow an offer that moves)
  let homeIdx = 0;       // the slide being shown
  let homeOn = false;    // the slider has something to show
  let homeSeen = false;  // it is on screen (it slides by itself only then)
  let homePause = 0;     // a finger / mouse is on it: it does not slide until this time
  let mineTried = false; // this phone's own list was asked for (and may have failed: then the public list is shown)
  let homeRestore = false; // the slider was redrawn or moved: its scrolling is put back on the current slide
  let lastCtx = null;    // what the product grid last told us (storefront.js), for the "among the products" place
  let hist = null;       // {phone, items, at, loading, failed}: what this customer has used (read only when "History" is opened)
  let histOpen = false;
  const badImg = new Set(); // owner pictures that could not be loaded (their banner falls back to the text card)
  const HIST_KEY = "fc_rewards_hist"; // set once this device has seen a used reward, so the My rewards card can show "History" even with nothing to use now
  const histKnown = () => { try { return localStorage.getItem(HIST_KEY) === "1"; } catch (_) { return false; } };
  const knowHist = () => { try { localStorage.setItem(HIST_KEY, "1"); } catch (_) { /* not kept */ } };
  let picked = "";            // the entry the customer chose ("O12" / "V5")
  let last = null;            // what discountFor last applied (checkout-form sends it with the order)
  const slots = new Set();    // { el, mode }
  let home = null;
  let ticker = 0;

  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && Array.isArray(c.offers) && Date.now() - (c.at || 0) < 10 * 60 * 1000) pub = c;
  } catch (_) { pub = null; }

  const now = () => Date.now() + skew;

  // ---- who ----------------------------------------------------------------------------------------------

  /** The number of the customer who is logged in ("" = nobody). */
  function savedPhone() {
    let p = "";
    try { p = (window.ProfileSheet && ProfileSheet.getSavedPhone && ProfileSheet.getSavedPhone()) || ""; } catch (_) { p = ""; }
    // this file loads BEFORE profile.js, so on the first draw the profile code is not there yet: the saved number is read from the same place it keeps it
    if (!p) { try { p = localStorage.getItem("freshcutz_profile_phone") || ""; } catch (_) { p = ""; } }
    const d = String(p || "").replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : "";
  }

  /** The number the offers are worked out for: the one the Final Step was told (a customer typing it before logging in), else the logged-in one. */
  function phone() {
    const d = String(phoneNow || "").replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : savedPhone();
  }

  function setPhone(p) {
    const d = String(p || "").replace(/\D/g, "").slice(-10);
    if (d === phoneNow) return;
    phoneNow = d;
    declined.clear();
    picked = "";
    for (const k of Object.keys(claimMsg)) delete claimMsg[k];
    mineTried = false;
    redraw();
    if (wantsMine() || (home && pub && pub.offers.length)) loadMine(false).then(redraw);
  }

  // ---- reading from the server ------------------------------------------------------------------------------

  // an offer that is switched on but starts later: the server tells when the soonest one starts, and an open page looks again then
  // (otherwise it would only show up on the next visit - nothing else changes on the server at that moment)
  let startTimer = 0;
  function armStart(next) {
    clearTimeout(startTimer);
    startTimer = 0;
    const at = Number(next);
    if (!at) return;
    const wait = at - (Date.now() + (skew || 0));
    if (wait > 12 * 3600 * 1000) return; // far away: the next visit / refresh sets it again
    startTimer = setTimeout(() => { startTimer = 0; refresh(true); }, Math.max(1000, wait) + 5500 + Math.random() * 2500); // (the public list is kept by the browser for 5 s: asked just after that)
  }

  function loadPub(force) {
    if (pubFlying) return pubFlying;
    if (!force && pub && Date.now() - pub.at < 20 * 1000) return Promise.resolve();
    pubFlying = Api.get("/api/rewards/active")
      .then((d) => {
        if (!d || !Array.isArray(d.offers)) return;
        // (the server's clock is NOT read from this answer: the browser may hand back an older copy of it after "nothing changed",
        // and an old "now" made every timer show too long - e.g. a 10 minute hold as 15. Only this phone's own answers set it.)
        pub = { offers: d.offers, codes: !!d.codes, v: d.v, home: d.home || null, at: Date.now() };
        armStart(d.next);
        try { localStorage.setItem(KEY, JSON.stringify(pub)); } catch (_) { /* kept in memory only */ }
      })
      .catch(() => { /* offline: what is held stays */ })
      .finally(() => { pubFlying = null; });
    return pubFlying;
  }

  function loadMine(force) {
    const p = phone();
    if (!p) { mine = null; return Promise.resolve(); }
    if (!force && mine && mine.phone === p && Date.now() - mine.at < MINE_FRESH) return Promise.resolve();
    if (mineFlying && mineFlying.p === p && mineFlying.seq === mineSeq) return mineFlying.pr; // (a read that started before the last change is not joined: it would bring the old list back)
    const seq = mineSeq;
    const pr = Api.post("/api/rewards/mine", { phone: p })
      .then((d) => {
        if (!d || seq !== mineSeq) return;
        skew = (d.now || Date.now()) - Date.now();
        mine = { phone: p, offers: d.offers || [], vouchers: d.vouchers || [], codes: !!d.codes, blocked: !!d.blocked, at: Date.now() };
        armStart(d.next);
      })
      .catch(() => { /* offline: what is held stays */ })
      .finally(() => { mineTried = true; if (mineFlying && mineFlying.pr === pr) mineFlying = null; });
    mineFlying = { p, pr, seq };
    return pr;
  }

  /** Reads what is on screen again (a change from the owner, the page came back, a hold ran out, the server refused an offer). */
  const wantsMine = () => [...slots].some((x) => x.mode !== "account" || accOpen);

  function refresh(force) {
    // the home slider starts from the public list (cached, the same for everybody); a signed-in customer's own list (what is meant for
    // THIS number: new-customer offers, offers already used) is read once more, at most every 45 seconds, and also serves Final Step
    const first = home || !phone() ? loadPub(force) : Promise.resolve();
    return first.then(() => (phone() && (wantsMine() || holding() || (home && pub && pub.offers.length)) ? loadMine(force) : null)).then(redraw);
  }

  // an offer this phone has claimed and holds (remembered so the home strip can say "Reserved for you" without asking for the list every visit)
  const HOLD_KEY = "fc_rewards_hold";
  function rememberHold(until) { try { localStorage.setItem(HOLD_KEY, String(until)); } catch (_) { /* not kept */ } }
  function holding() { try { return Number(localStorage.getItem(HOLD_KEY) || 0) > now(); } catch (_) { return false; } }

  // the owner changed an offer: asked again after a random moment (so a crowd of open pages does not ask at the same instant)
  let jitter = 0;
  window.addEventListener("freshcutz:rewards", () => {
    if (!(home || slots.size)) return;
    clearTimeout(jitter);
    jitter = setTimeout(() => refresh(true), 300 + Math.random() * 2500);
  });
  // an order of this customer was cancelled (by them, or by the owner: the same event): the server gives the voucher / offer it used back a moment
  // after the cancel, so the lists are read once more after a short wait (never straight from the 45 s memory)
  // (the same goes for an order the owner opens again - it takes its offer / voucher again - and for one that is delivered: the loyalty voucher,
  // and who still counts as a new customer, change then)
  let backTimer = 0;
  const lastStatus = new Map(); // order code -> the status last heard of
  window.addEventListener("freshcutz:orderstatus", (e) => {
    const d = (e && e.detail) || {};
    const code = String(d.orderCode || "");
    const before = lastStatus.get(code);
    if (code) { lastStatus.set(code, d.status); if (lastStatus.size > 40) lastStatus.delete(lastStatus.keys().next().value); }
    const reopened = before === "CANCELLED" && d.status && d.status !== "CANCELLED";
    if (!(d.status === "CANCELLED" || d.status === "DELIVERED" || reopened) || !phone()) return;
    clearTimeout(backTimer);
    backTimer = setTimeout(() => {
      if (mine) mine.at = 0;
      hist = null;
      if (home || slots.size) refresh(true);
    }, 3000 + Math.random() * 1000);
  });
  // signed in / signed out on this page (profile.js announces it): what belonged to the old number goes, the home slider is redrawn
  // at once (a new-customer offer disappears for an existing customer) and the new number's own list is read once
  let lastWho = "";
  let lastSaved = savedPhone();
  function whoChanged() {
    // somebody logged in or out (or another tab did): the number the Final Step was told belonged to whoever was there before, so it goes -
    // the offers are worked out for the logged-in customer again (or, with nobody logged in, for a visitor)
    const saved = savedPhone();
    if (saved !== lastSaved) { lastSaved = saved; phoneNow = ""; }
    const p = phone();
    if (p === lastWho) return;
    const was = lastWho;
    lastWho = p;
    declined.clear();
    picked = "";
    for (const k of Object.keys(claimMsg)) delete claimMsg[k];
    if (was && was !== p) { try { localStorage.removeItem(HOLD_KEY); } catch (_) { /* not kept */ } } // (a hold belongs to the number that claimed it)
    mineTried = false;
    if (mine && mine.phone !== p) mine = null;
    redraw();
    if (p && (wantsMine() || (home && pub && pub.offers.length))) loadMine(false).then(redraw);
  }
  window.addEventListener("freshcutz:who", whoChanged);
  window.addEventListener("freshcutz:profile", whoChanged);
  window.addEventListener("storage", whoChanged);
  const comeBack = () => { if (!document.hidden && (home || slots.size)) refresh(false); };
  document.addEventListener("visibilitychange", comeBack);
  window.addEventListener("focus", comeBack);

  // ---- the rules (a copy of RewardsCalc.java, for showing only) ---------------------------------------------------

  function linesOfCart() {
    return Cart.getItems().map((i) => ({ id: i.productId, cat: i.category || "", unit: P(i.unitPrice), qty: i.quantity }));
  }

  function matches(rule, l) {
    for (const k of rule.keys || []) {
      if (rule.scope === "ITEMS") { if (String(l.id) === String(k)) return true; }
      else if (l.cat && String(k).toLowerCase() === String(l.cat).trim().toLowerCase()) return true;
    }
    return false;
  }

  /** The discount in paise (0 = it does not apply to this bill). rule: {kind, value, perClaim, minOrder, maxPct, scope, keys, minQty, maxQty} (rupees). */
  function calc(rule, lines, items, delivery) {
    if (items <= 0 || items < P(rule.minOrder)) return 0;
    const all = rule.scope === "ORDER";
    let eligible = 0, qty = 0;
    const units = [];
    for (const l of lines) {
      if (!all && !matches(rule, l)) continue;
      eligible += l.unit * l.qty;
      qty += l.qty;
      units.push([l.unit, l.qty]);
    }
    if (!all && (eligible <= 0 || qty < Math.max(1, rule.minQty || 0))) return 0;
    let d = 0;
    if (rule.kind === "FLAT") {
      d = Math.round(rule.value * 100);
      if (!all) d = Math.min(d, eligible);
    } else if (rule.kind === "PERCENT") {
      let base = all ? items : eligible;
      if (!all && rule.maxQty && rule.maxQty > 0 && rule.maxQty < qty) {
        units.sort((a, b) => b[0] - a[0]);
        let left = rule.maxQty;
        base = 0;
        for (const u of units) {
          const take = Math.min(left, u[1]);
          base += take * u[0];
          left -= take;
          if (left <= 0) break;
        }
      }
      d = Math.round(base * rule.value / 100);
      d = Math.floor(d / 100) * 100; // whole rupees, rounded down
      if (P(rule.perClaim) > 0) d = Math.min(d, P(rule.perClaim));
    } else if (rule.kind === "FREE_DELIVERY") {
      d = Math.max(0, delivery);
      if (P(rule.perClaim) > 0) d = Math.min(d, P(rule.perClaim));
    }
    if (rule.maxPct > 0) d = Math.min(d, Math.round(items * rule.maxPct / 100));
    d = Math.min(d, rule.kind === "FREE_DELIVERY" ? Math.max(0, delivery) : items);
    return Math.max(0, d);
  }

  const voucherRule = (v) => ({ kind: "FLAT", value: v.amount, perClaim: 0, minOrder: v.minOrder, maxPct: null, scope: (v.keys || []).length ? "ITEMS" : "ORDER", keys: v.keys || [], minQty: 1, maxQty: null });

  /** The quantity rule of an item / category offer, up front: "buy 2+ · first 6 units". */
  function qtyText(o) {
    if (!o || o.scope === "ORDER" || o.kind === "FREE_DELIVERY") return "";
    const parts = [];
    if (o.minQty > 1) parts.push(`buy ${o.minQty}+`);
    if (o.kind === "PERCENT" && o.maxQty) parts.push(`first ${o.maxQty} ${o.maxQty === 1 ? "unit" : "units"}`);
    return parts.join(" · ");
  }

  function scopeText(o) {
    if (o.scope === "CATEGORY") return (o.keys || []).join(", ");
    if (o.scope === "ITEMS") {
      const names = (o.keys || []).map((k) => { try { const p = window.CatalogStore && CatalogStore.getProduct(+k); return p ? p.name : ""; } catch (_) { return ""; } }).filter(Boolean);
      if (!names.length) return "the offer items";
      return names.length > 2 ? names.slice(0, 2).join(", ") + "…" : names.join(", ");
    }
    return "";
  }

  /** What the offer gives, in a few words: "₹50 off", "20% off eggs (up to ₹100)", "Free delivery". */
  function valueText(o) {
    const on = o.scope !== "ORDER" && scopeText(o) ? ` on ${scopeText(o)}` : "";
    if (o.kind === "FLAT") return `₹${plain(o.value)} off${on}`;
    if (o.kind === "PERCENT") return `${plain(o.value)}% off${on}${o.perClaim > 0 ? ` (up to ₹${plain(o.perClaim)})` : ""}`;
    return "Free delivery";
  }
  const plain = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

  /** Why an offer gives nothing on this bill (what the customer can do about it). */
  function why(rule, lines, items, delivery) {
    if (items < P(rule.minOrder)) return `Add ${money(P(rule.minOrder) - items)} more to use this`;
    if (rule.kind === "FREE_DELIVERY" && delivery <= 0) return "Delivery is already free on this order";
    if (rule.scope !== "ORDER") {
      const qty = lines.filter((l) => matches(rule, l)).reduce((s, l) => s + l.qty, 0);
      const t = scopeText(rule);
      if (qty === 0) return `Add ${t || "the offer items"} to use this`;
      if (qty < (rule.minQty || 1)) return `Add ${(rule.minQty || 1) - qty} more of ${t || "these items"} to use this`;
    }
    return "This doesn't apply to your order";
  }

  // ---- the entries (everything this customer could use on this bill) ----------------------------------------------

  const secsLeft = (ms) => Math.max(0, Math.floor((ms - now()) / 1000));

  /** One row per offer / voucher the customer may use or claim, with what it would give on the bill (ctx = {lines, items, delivery}). */
  function entries(ctx, withUsed) {
    const out = [];
    if (!mine || mine.blocked || mine.phone !== phone()) return out;
    for (const o of mine.offers) {
      const held = o.claimId && o.until && o.until > now();
      const ranOut = o.claimId && o.until && o.until <= now(); // a hold whose time has run out no longer counts as used (the server frees it; this just does not wait for it)
      if ((o.used || 0) - (ranOut ? 1 : 0) >= (o.perPhone || 1) && !held) {
        // Final Step still lists it, greyed, so it is clear why it gives nothing
        if (withUsed && o.mode !== "CODE") out.push({ key: "O" + o.id, type: "OFFER", o, id: o.id, claimId: null, until: 0, claimable: false, d: 0, spent: true, why: "", label: o.name });
        continue;
      }
      const usable = o.mode === "AUTO" || held;
      if (!usable && o.mode === "CODE") continue;
      const d = calc(o, ctx.lines, ctx.items, ctx.delivery);
      out.push({ key: "O" + o.id, type: "OFFER", o, id: o.id, claimId: held ? o.claimId : null, until: held ? o.until : 0, claimable: !usable, d, why: d ? "" : why(o, ctx.lines, ctx.items, ctx.delivery), label: o.name });
    }
    for (const v of mine.vouchers) {
      if (v.ends && v.ends <= now()) continue;
      const r = voucherRule(v);
      const d = calc(r, ctx.lines, ctx.items, ctx.delivery);
      out.push({ key: "V" + v.id, type: "VOUCHER", v, id: v.id, claimId: null, until: 0, claimable: false, d, why: d ? "" : why(r, ctx.lines, ctx.items, ctx.delivery), label: v.title });
    }
    return out;
  }

  /** Final Step before any mobile number is known: the offers meant for everybody (new-customer ones included, they are checked against the number
   * once it is typed). Nothing is applied yet - the server can only say who may have what when it knows the number. */
  function previewEntries() {
    if (phone() || !pub) return [];
    return pub.offers
      .filter((o) => (o.left == null || o.left > 0) && (!o.ends || o.ends > now()))
      .map((o) => ({ key: "O" + o.id, type: "OFFER", o, id: o.id, claimId: null, until: 0, claimable: o.mode === "CLAIM", d: 0, preview: true, why: "", label: o.name }));
  }

  /** The entry that is applied: the customer's choice while it still gives something, else the one that gives the most. */
  function chosen(list) {
    const ok = list.filter((e) => !e.claimable && e.d > 0 && !declined.has(e.key));
    if (!ok.length) return null;
    const mineKey = ok.find((e) => e.key === picked);
    if (mineKey) return mineKey;
    return ok.reduce((a, b) => (b.d > a.d ? b : a));
  }

  function ctxOf(q) {
    let delivery = 0;
    for (const l of q.lines || []) if (l.key === "delivery") delivery += l.charged;
    return { lines: linesOfCart(), items: q.items, delivery };
  }

  /** For charges.js: the discount on this bill, or null. {paise, label, type, id, claimId} */
  function discountFor(q) {
    last = null;
    if (!mine) return null;
    const list = entries(ctxOf(q));
    const e = chosen(list);
    if (!e) return null;
    last = { paise: e.d, label: e.label, type: e.type, id: e.id, claimId: e.claimId, key: e.key };
    return last;
  }

  /** What the order must carry so the server applies the same reward ({} = none). */
  function payload(applied) {
    const r = applied || last;
    if (!r) return {};
    return { rewardType: r.type, rewardId: r.id, ...(r.claimId ? { rewardClaimId: r.claimId } : {}) };
  }

  // ---- acting ---------------------------------------------------------------------------------------------------

  /** Claim an offer (offerId) or use a code. A refusal is shown where the customer is looking: under the code box (slot.msg), or on
   * the offer's own card (claimMsg) - not in a popup that goes away. A wrong code asks nothing more of the server. */
  async function claim(body, slot) {
    const p = phone();
    const fail = (text) => { if (body.code) { if (slot) slot.msg = text; } else if (body.offerId) claimMsg[body.offerId] = text; };
    if (body.code) { if (slot) slot.msg = ""; } else if (body.offerId) delete claimMsg[body.offerId];
    if (!p) { fail("Enter your mobile number first"); redraw(); return false; }
    try {
      const r = await Api.post("/api/rewards/claim", { ...body, phone: p });
      mineSeq++; // (a read that was already on its way does not know about this hold)
      // the server answers a refusal (wrong / expired code, ended, used, run out ...) with 200 and {ok:false, message}
      if (r && r.ok === false) { await refused(r.message); return false; }
      if (r && r.until) rememberHold(r.until);
      if (r && r.now) skew = r.now - Date.now(); // (the server's clock, fresh from this answer)
      // An offer already in the customer's list is marked as held right away from the answer, so the card turns "Reserved" without another
      // wait; the list is read again in the background. A code offer is not in the list yet (codes are never listed) - that one is read first.
      const known = mine && mine.phone === p && r && r.offerId ? mine.offers.find((x) => x.id === r.offerId) : null;
      if (known) {
        known.claimId = r.claimId;
        known.until = r.until;
        known.used = (known.used || 0) + 1; // (a hold counts as used until it is given back)
      } else {
        await loadMine(true);
      }
      if (r && r.offerId) { picked = "O" + r.offerId; declined.delete(picked); }
      if (known) { redraw(); loadMine(true).then(redraw); }
      return true;
    } catch (err) {
      await refused(err.message); // (a real fault, or a server that still answers with an error)
      return false;
    } finally {
      redraw();
    }

    async function refused(msg) {
      const text = msg || "Could not claim this offer";
      fail(text);
      // only when an offer itself may have changed (run out, already used, hold over) is the customer's own list read again;
      // a wrong code, or no connection, changes nothing
      if (!(body.code && /valid/i.test(text)) && !/reach|connection/i.test(text)) await loadMine(true);
    }
  }

  async function release(e) {
    mineSeq++; // (a read already on its way still has the hold in it)
    declined.add(e.key);
    if (picked === e.key) picked = "";
    // A claimed offer that is taken off gives its slot back: it is a "Claim" card again at once (not an "Apply" card for the few seconds
    // the server takes to answer). Only what stays the customer's - an automatic offer, a voucher - offers "Apply".
    if (e.claimId && e.type === "OFFER") {
      const o = mine && mine.offers.find((x) => x.id === e.id);
      if (o) { delete o.claimId; delete o.until; o.used = Math.max(0, (o.used || 0) - 1); if (o.left != null) o.left += 1; declined.delete(e.key); } // (the hold counted as "used": give that back too, or the card says "Already used on this number" until the server answers)
    }
    redraw();
    if (e.claimId) {
      try { await Api.post("/api/rewards/release", { claimId: e.claimId, phone: phone() }); } catch (_) { /* it runs out by itself */ }
      mineSeq++; // (so is a read that started while the server was still giving it back)
      await loadMine(true);
      redraw();
    }
  }


  /** The order was placed: what it used is gone from this customer's list; the next screen reads it again. */
  function afterOrder() {
    mine = null;
    hist = null;
    declined.clear();
    picked = "";
    last = null;
    if (phone()) loadMine(true).then(redraw);
  }

  // ---- drawing ------------------------------------------------------------------------------------------------------

  function clock(secs) {
    const s = Math.max(0, secs);
    if (s >= 172800) return `${Math.floor(s / 86400)}d`;
    if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
    if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  const leftHtml = (o) => (o.left == null || o.hideLeft ? "" : `<span class="rw-left${o.left <= 5 ? " is-low" : ""}">${o.left <= 5 ? `Only ${o.left} left` : `${o.left} left`}</span>`);
  const endsHtml = (o) => (o.ends ? `<span class="rw-ends">ends in <b data-rw-end="${o.ends}">${clock(secsLeft(o.ends))}</b></span>` : "");

  function cardHtml(e, state, nChoices, listOnly) {
    const o = e.o, v = e.v;
    const title = esc(e.label);
    const holdHtml = e.until ? `<span class="rw-hold">Reserved for you · <b data-rw-hold="${e.until}">${clock(secsLeft(e.until))}</b></span>` : "";
    let sub;
    if (v) {
      sub = `<span>${esc(valueText({ kind: "FLAT", value: v.amount, scope: (v.keys || []).length ? "ITEMS" : "ORDER", keys: v.keys || [] }))}</span><span>${esc(v.note || "Gift voucher")}</span>${v.minOrder ? `<span>min order ₹${plain(v.minOrder)}</span>` : ""}<span>valid till ${esc(new Date(v.ends).toLocaleDateString("en-IN", { day: "numeric", month: "short" }))}</span>`;
    } else {
      sub = `<span>${esc(valueText(o))}</span>${qtyText(o) ? `<span>${esc(qtyText(o))}</span>` : ""}${o.minOrder > 0 ? `<span>min order ₹${plain(o.minOrder)}</span>` : ""}${leftHtml(o)}${endsHtml(o)}`;
    }
    const icon = v ? "🎟️" : e.claimable ? "⚡" : "🎁";
    const line = !v && o.note ? `<span class="rw-note">${esc(o.note)}</span>` : "";
    const off = !listOnly && declined.has(e.key) && e.d > 0 && !e.claimable; // (listOnly = My rewards: a plain list, nothing "removed from this order")
    let right = "";
    if (e.claimable) right = `<button type="button" class="rw-btn" data-rw="claim" data-id="${e.id}">Claim</button>`;
    else if (state === "applied") right = `<div class="rw-save">−${money(e.d)}</div>`;
    else if (off) right = `<button type="button" class="rw-btn rw-btn-ghost" data-rw="use" data-key="${e.key}">Apply</button>`;
    else if (e.d > 0 && nChoices > 1) right = `<button type="button" class="rw-btn rw-btn-ghost" data-rw="use" data-key="${e.key}">Use this</button>`;
    const refused = !v && claimMsg[e.id] ? `<span class="rw-why" role="alert">${esc(claimMsg[e.id])}</span>` : "";
    const note = refused ? refused : e.preview ? `<span class="rw-why rw-off">${o.audience === "NEW" ? "For new customers · " : o.audience === "RETURNING" ? "For returning customers · " : ""}Enter your mobile number to use it</span>` : e.spent ? `<span class="rw-why rw-off">Already used on this number</span>` : off ? `<span class="rw-why rw-off">Removed from this order</span>` : !e.claimable && !e.d ? `<span class="rw-why">${esc(e.why)}</span>` : e.claimable && !e.d && e.why ? `<span class="rw-why">${esc(e.why)} after claiming</span>` : "";
    return `<div class="rw-card ${state === "applied" ? "is-on" : e.claimable ? "is-claim" : ""}${e.spent ? " is-spent" : ""}${popKey === e.key ? " rw-pop" : ""}" data-rw-key="${e.key}">
      <span class="rw-ic" aria-hidden="true">${icon}</span>
      <div class="rw-main"><b class="rw-title">${title}</b>${line}<span class="rw-sub">${sub}</span>${holdHtml}${note}${state === "applied" ? `<button type="button" class="rw-link" data-rw="remove" data-key="${e.key}">Remove</button>` : ""}</div>
      ${right}
    </div>`;
  }

  const codeBoxHtml = (open, msg) => open
    ? `<div class="rw-code-box"><div class="rw-code"><input type="text" class="rw-code-in" maxlength="20" autocapitalize="characters" autocomplete="off" placeholder="Enter code" aria-label="Offer code" /><button type="button" class="rw-btn" data-rw="code">Apply</button></div>${msg ? `<p class="rw-code-msg" role="alert">${esc(msg)}</p>` : ""}</div>`
    : `<button type="button" class="rw-link rw-code-open" data-rw="code-open">🏷️ Have a code?</button>`;

  /** The Final Step card. Empty (no height at all) when there is nothing for this customer. */
  function checkoutHtml(s) {
    const q = window.Charges && Charges.current ? Charges.current() : { items: P(Cart.getTotal()), lines: [] }; // (the bill as the Final Step shows it: the delivery charge counts for "free delivery")
    const ctx = ctxOf({ items: q.items, lines: (q.lines || []).filter((l) => l.key !== "offer") });
    const list = phone() ? entries(ctx, true) : previewEntries(); // (no number yet: the public offers are shown, to be checked once the number is typed)
    const applied = chosen(list);
    const usable = list.filter((e) => !e.claimable && e.d > 0 && !declined.has(e.key));
    // the other things the customer may use / claim first, the ones already used last
    const rest = list.filter((e) => e !== applied).sort((a, b) => (a.spent ? 1 : 0) - (b.spent ? 1 : 0));
    const parts = [];
    if (applied) parts.push(cardHtml(applied, "applied", usable.length));
    const shown = coAll ? rest : rest.slice(0, 2);
    for (const e of shown) parts.push(cardHtml(e, "", usable.length));
    if (rest.length > 2) parts.push(`<button type="button" class="rw-link rw-more" data-rw="co-more">${coAll ? "Show fewer offers" : `Show ${rest.length - 2} more offer${rest.length - 2 === 1 ? "" : "s"}`}</button>`);
    const codes = phone() ? mine && mine.codes : pub && pub.codes;
    if (codes) parts.push(codeBoxHtml(!!s.code, s.msg));
    if (!parts.length) return "";
    return `<div class="rw-wrap">${parts.join("")}</div>`;
  }

  /** "History": what was used or ran out. Closed by default; its data is read (once a minute at most) when it is opened. */
  function histHtml() {
    if (!phone()) return "";
    const h = hist && hist.phone === phone() ? hist : null;
    if (!h && histOpen) setTimeout(loadHist, 0); // (the box is open but its list was cleared - an order was placed / cancelled: read it again, once)
    let body;
    if (!h || (h.loading && !h.items)) body = `<p class="rw-hnote">Loading…</p>`;
    else if (h.failed && !h.items.length) body = `<p class="rw-hnote">Could not load. Close and open this again.</p>`;
    else if (!h.items.length) body = `<p class="rw-hnote">Nothing used yet.</p>`;
    else body = h.items.map((x) => `<div class="rw-hrow"><span class="rw-hic ${x.state === "USED" ? "is-used" : ""}" aria-hidden="true">${x.state === "USED" ? "✓" : "⏳"}</span>
      <div class="rw-hmain"><b>${esc(x.title)}</b><small>${x.state === "USED" ? `Used${x.order ? " on order " + esc(x.order) : ""}` : "Expired"} · ${esc(new Date(x.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }))}</small></div>
      <span class="rw-hamt${x.state === "USED" ? " is-used" : ""}">${x.state === "USED" ? "−" : ""}${money(P(x.amount))}</span></div>`).join("");
    return `<details class="rw-hist"${histOpen ? " open" : ""}><summary>History</summary>${body}</details>`;
  }

  async function loadHist() {
    const p = phone();
    if (!p || (hist && hist.phone === p && (hist.loading || Date.now() - hist.at < 60000))) return;
    hist = { phone: p, items: hist && hist.phone === p ? hist.items : null, at: Date.now(), loading: true };
    redraw();
    try {
      const r = await Api.post("/api/rewards/history", { phone: p });
      hist = { phone: p, items: (r && r.items) || [], at: Date.now() };
      if (hist.items.length) knowHist();
    } catch (_) {
      // failed: shown as "could not load", and not tried again for at least 10 seconds (at = a minute minus 10 seconds ago)
      hist = { phone: p, items: (hist && hist.items) || [], at: Date.now() - 50 * 1000, failed: true };
    }
    redraw();
  }
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d || !d.classList || !d.classList.contains("rw-hist")) return;
    // a request starts only when the customer opens the box - a redraw puts an already open box back (which also fires "toggle") and must ask nothing
    const opened = d.open && !histOpen;
    histOpen = d.open;
    if (opened) loadHist();
  }, true);

  /** "My rewards": one row that opens and closes on a tap. The customer's offers are read when it is opened (kept 45 seconds), not before. */
  function accountHtml(s) {
    if (!phone()) return "";
    const head = `<button type="button" class="rw-acc-head acct-title" data-rw="acc" aria-expanded="${accOpen}">🎁 My rewards<span class="rw-chev" aria-hidden="true"></span></button>`;
    if (!accOpen) return head;
    let body;
    if (!mine || mine.phone !== phone()) {
      body = mineFlying ? `<p class="rw-hnote">Loading…</p>` : `<p class="rw-hnote">Could not load. <button type="button" class="rw-link" data-rw="acc-retry">Try again</button></p>`;
    } else {
      const q = { items: P(Cart.getTotal()), lines: [] };
      const cards = mine.blocked ? "" : entries(ctxOf(q)).map((e) => cardHtml({ ...e, d: 1, why: "" }, "", 0, true)).join("");
      const codes = !mine.blocked && mine.codes;
      body = `<div class="rw-wrap">${cards || `<p class="rw-hnote">No rewards right now.</p>`}${codes ? codeBoxHtml(!!s.code, s.msg) : ""}${mine.blocked ? "" : histHtml()}</div>`;
    }
    return head + body;
  }

  function homeList() {
    const signed = !!phone();
    let src;
    if (signed && mine && mine.phone === phone()) src = mine.offers;
    else if (signed && pub && pub.offers.length && !mineTried) return null; // wait for this number's own list (no flash of offers meant for someone else)
    else {
      src = pub ? pub.offers : [];
      // this number is known but its own list could not be read: only offers meant for everybody (never new-customer / returning / chosen-number ones)
      if (signed) src = src.filter((o) => !o.audience || o.audience === "ALL");
    }
    const list = src.filter((o) => (o.left == null || o.left > 0 || o.claimId) && (!o.ends || o.ends > now()) && ((o.used || 0) < (o.perPhone || 1) || o.claimId));
    // an offer this customer holds first, then the ones that end soonest
    list.sort((a, b) => (b.claimId ? 1 : 0) - (a.claimId ? 1 : 0) || (a.ends || 1e15) - (b.ends || 1e15));
    return list;
  }

  /** One slide of the home slider (the look of a banner: one offer at a time, swipe or dots). */
  function slideHtml(o, i, n, signed) {
    const held = o.claimId && o.until > now();
    // the owner's own picture (set per offer in admin): "IMAGE" = only the picture, "BOTH" = the picture with the details on it
    const imgUrl = o.imageId && !badImg.has(o.imageId) && (o.bannerMode === "IMAGE" || o.bannerMode === "BOTH") ? Utils.resolveImageUrl(`/api/rewards/image/${encodeURIComponent(o.imageId)}`) : "";
    const pic = imgUrl ? `<img class="rw-pic" src="${esc(imgUrl)}" alt="" draggable="false" decoding="async" data-img="${o.imageId}"${i === 0 ? "" : ' loading="lazy"'}>` : "";
    if (imgUrl && o.bannerMode === "IMAGE") {
      // picture only: tapping it claims the offer (signed in), or opens the checkout (reserved already / needs the number there); no timer, no text
      const act = !held && signed && o.mode === "CLAIM" ? "claim" : "go";
      const rib = claimMsg[o.id] ? `<span class="rw-rib is-msg" role="alert">${esc(claimMsg[o.id])}</span>` : held ? `<span class="rw-rib is-ok">🎁 Reserved for you · Checkout ›</span>` : "";
      return `<div class="rw-slide rw-img" role="button" tabindex="0" data-rw="tap" data-do="${act}" data-id="${o.id}" aria-label="${esc(o.name)}${held ? " (reserved - opens the checkout)" : ""}"><span class="rw-bk" aria-hidden="true" style="background-image:url('${esc(imgUrl)}')"></span>${pic}${rib}</div>`;
    }
    let right = "";
    if (held) right = `<button type="button" class="rw-btn" data-rw="go">Checkout</button>`;
    else if (signed && o.mode === "CLAIM") right = `<button type="button" class="rw-btn" data-rw="claim" data-id="${o.id}">Claim</button>`;
    const tag = held ? "🎁 Reserved for you" : o.audience === "NEW" ? "⚡ For new customers" : o.audience === "RETURNING" ? "⚡ Welcome back" : o.mode === "CLAIM" ? "⚡ Limited offer" : "⚡ Applied at checkout";
    const hint = claimMsg[o.id] ? `<span class="rw-why" role="alert">${esc(claimMsg[o.id])}</span>` : held ? `<span class="rw-hold">Reserved for you · <b data-rw-hold="${o.until}">${clock(secsLeft(o.until))}</b></span>`
      : !signed && o.mode === "CLAIM" ? `<span class="rw-why rw-soft">Your reward is waiting at checkout</span>` : "";
    // the big line is the owner's choice per offer: the amount (default), their own words, or nothing
    const big = o.headlineMode === "NONE" ? "" : o.headlineMode === "TEXT" && o.headline ? o.headline : valueText(o);
    const chips = `${qtyText(o) ? `<span>${esc(qtyText(o))}</span>` : ""}${o.minOrder > 0 ? `<span>min order ₹${plain(o.minOrder)}</span>` : ""}${leftHtml(o)}${endsHtml(o)}`;
    return `<div class="rw-slide ${held ? "is-on" : ""}${imgUrl ? " rw-over" : ""}" role="group" aria-label="Offer ${i + 1} of ${n}">${pic}
      <span class="rw-tag">${tag}</span>
      <div class="rw-sl-row"><div class="rw-sl-text">${big ? `<b class="rw-sl-value">${esc(big)}</b>` : ""}<span class="rw-sl-name${big ? "" : " is-big"}">${esc(o.name)}</span>${o.note ? `<span class="rw-note">${esc(o.note)}</span>` : ""}</div>${right}</div>
      ${chips ? `<span class="rw-sub">${chips}</span>` : ""}${hint}
    </div>`;
  }

  /** Draws the home slider (only when what it shows changed) and puts it where the owner chose. */
  function drawHome() {
    const list = homeList();
    if (list === null) { homeOn = false; return; }
    const signed = !!phone();
    const n = list.length;
    const sig = JSON.stringify([signed, list.map((o) => [o.id, o.name, o.note, o.kind, o.value, o.perClaim, o.minOrder, o.maxPct, o.scope, o.keys, o.minQty, o.maxQty, o.mode, o.audience, o.left, o.hideLeft, o.ends, o.claimId, o.until, o.used, o.headlineMode, o.headline, o.imageId, o.bannerMode, claimMsg[o.id] || ""])]);
    homeOn = n > 0;
    if (sig === homeSig) return;
    homeSig = sig;
    if (!n) { home.innerHTML = ""; return; }
    // the slider follows the offer being looked at (a claimed offer moves to the front: the view must move with it, not stay on a different offer)
    const keepId = homeIds[homeIdx];
    const at = keepId == null ? -1 : list.findIndex((o) => o.id === keepId);
    if (at >= 0) homeIdx = at;
    homeIds = list.map((o) => o.id);
    if (homeIdx >= n) homeIdx = 0;
    home.innerHTML = `<div class="rw-bn${n > 1 ? " rw-multi" : ""}${list.some((o) => o.imageId && !badImg.has(o.imageId) && (o.bannerMode === "IMAGE" || o.bannerMode === "BOTH")) ? " rw-hasimg" : ""}" role="region" aria-roledescription="carousel" aria-label="Offers"><div class="rw-track" tabindex="-1">${list.map((o, i) => slideHtml(o, i, n, signed)).join("")}</div>${n > 1 ? `<div class="rw-dots">${list.map((_, i) => `<button type="button" class="rw-dot${i === homeIdx ? " on" : ""}" data-rw="dot" data-i="${i}" aria-label="Offer ${i + 1}"></button>`).join("")}</div>` : ""}</div>`;
    homeRestore = true; // (put back on the slide being shown once it is on the page)
  }

  function showSlide(i, smooth) {
    const t = home && home.querySelector(".rw-track");
    if (!t || !t.clientWidth) return;
    t.scrollTo({ left: i * t.clientWidth, behavior: smooth ? "smooth" : "auto" });
  }

  // which slide is showing follows the scrolling (a swipe or the automatic slide)
  document.addEventListener("scroll", (ev) => {
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains("rw-track") || !t.clientWidth) return;
    const i = Math.round(t.scrollLeft / t.clientWidth);
    if (i === homeIdx || i < 0) return;
    homeIdx = i;
    t.parentNode.querySelectorAll(".rw-dot").forEach((d, k) => d.classList.toggle("on", k === i));
  }, true);
  ["pointerdown", "touchstart", "focusin", "mouseover"].forEach((name) => document.addEventListener(name, (ev) => {
    if (home && ev.target.closest && ev.target.closest("#rewardsHome")) homePause = Date.now() + 9000;
  }, { passive: true }));

  /** Every 5 seconds the slider moves on by itself - only while it is on screen, the page is in front, and nobody is touching it. */
  let slideTick = 0;
  function autoSlide() {
    if (!home || !homeOn || !homeSeen || document.hidden || Date.now() < homePause) return;
    if (window.FC_CALM || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const n = home.querySelectorAll(".rw-slide").length;
    if (n < 2) return;
    showSlide((homeIdx + 1) % n, true);
  }

  // ---- where the home slider sits (the owner chooses: among the products, above / below the categories, or nowhere) ----------

  const cardsBefore = (grid, el) => {
    let n = 0;
    for (const c of grid.children) {
      if (c === el) break;
      if (c.classList.contains("product-card") && c.dataset.id) n++;
    }
    return n;
  };

  /** Called by storefront.js whenever the product grid changes (the same call the banners get). */
  function place(ctx) {
    if (ctx) lastCtx = ctx;
    settle();
  }

  function settle() {
    settleInner();
    const t = homeRestore && home && home.querySelector(".rw-track");
    if (t && t.clientWidth) { homeRestore = false; showSlide(homeIdx, false); }
  }

  function settleInner() {
    if (!home) return;
    const where = (pub && pub.home && pub.home.where) || "PRODUCTS";
    const wasIn = home.parentNode;
    const hideIt = () => { home.hidden = true; if (home.classList.contains("rw-in-grid") && home.parentNode) home.remove(); };
    if (!homeOn || where === "HIDDEN") return hideIt();
    const bar = document.getElementById("categoryBar");
    if (where === "ABOVE_CATEGORIES" || where === "BELOW_CATEGORIES") {
      if (!bar || !bar.parentNode) return hideIt();
      home.classList.remove("rw-in-grid");
      home.classList.add("container");
      if (where === "ABOVE_CATEGORIES") { if (home.parentNode !== bar.parentNode || home.nextElementSibling !== bar) bar.parentNode.insertBefore(home, bar); }
      else if (home.parentNode !== bar.parentNode || home.previousElementSibling !== bar) bar.after(home);
      home.hidden = false;
    } else {
      // among the products, like a banner: 1 = above the first product, N = after the first N-1 products
      const ctx = lastCtx;
      const grid = ctx && ctx.grid;
      if (!grid || ctx.hidden) return hideIt(); // (searching or still loading: the slider waits)
      const place = Math.max(1, Math.min(500, Math.round(Number(pub && pub.home && pub.home.place)) || 1));
      const cards = [...grid.children].filter((c) => c.classList.contains("product-card") && c.dataset.id);
      const after = place - 1;
      let ref;
      if (after === 0) ref = [...grid.children].find((c) => c !== home && !c.classList.contains("sb") && !c.classList.contains("sp")) || null;
      else if (cards.length > after) ref = cards[after];
      else if (ctx.finished) ref = null;
      else return hideIt(); // not enough products yet: wait for more to load
      const wanted = Math.min(after, cards.length);
      home.classList.add("rw-in-grid");
      home.classList.remove("container");
      home.hidden = false;
      if (home.parentNode === grid && cardsBefore(grid, home) === wanted) return;
      grid.insertBefore(home, ref);
      homeRestore = true; // (moving an element puts its scrolling back to the first slide)
      return;
    }
    if (wasIn !== home.parentNode) homeRestore = true;
  }

  function redrawHome() {
    if (!home) return;
    if (phone() !== lastWho) { whoChanged(); return; } // (the signed-in number is not what the offers on screen were worked out for: start from this number's own list)
    drawHome();
    settle();
    if (!homeSeen && homeOn && "IntersectionObserver" in window && !redrawHome.io) {
      redrawHome.io = new IntersectionObserver((es) => { homeSeen = es.some((e) => e.isIntersecting); }, { threshold: 0.3 });
      redrawHome.io.observe(home);
    } else if (!("IntersectionObserver" in window)) homeSeen = true;
  }

  // ---- mounting -----------------------------------------------------------------------------------------------------------

  function paint(s) {
    if (!s.el.isConnected) return false;
    // what the customer was typing is kept while the card redraws
    const typed = s.el.querySelector(".rw-code-in");
    const had = typed ? typed.value : "";
    const focused = typed && document.activeElement === typed;
    s.el.innerHTML = s.mode === "account" ? accountHtml(s) : checkoutHtml(s);
    s.el.classList.toggle("rw-slot-empty", !s.el.innerHTML);
    const card = s.mode === "account" && s.el.closest("[data-rewards-card]");
    if (card) card.hidden = !s.el.innerHTML;
    if (card) card.classList.toggle("rw-acc-open", accOpen);
    const again = s.el.querySelector(".rw-code-in");
    if (again && had) again.value = had;
    if (again && focused) again.focus();
    return true;
  }

  function redraw() {
    for (const s of slots) if (!paint(s)) slots.delete(s);
    redrawHome();
    if (window.Charges && Charges.redraw) Charges.redraw(); // the bill shows the discount
    if (slots.size || home) startTick(); else stopTick();
  }

  function startTick() {
    if (ticker) return;
    ticker = setInterval(tickOnce, 1000);
  }
  function stopTick() { if (ticker) { clearInterval(ticker); ticker = 0; } }

  /** Once a second: only the numbers of the countdowns change (nothing is redrawn); a hold or an offer that ended is read again. */
  function tickOnce() {
    if (document.hidden) return;
    if (++slideTick % 5 === 0) autoSlide();
    let expired = false;
    // only the countdowns of the offers slider and of the boxes mounted on the page are looked at (never the whole document), and a number is
    // written only when it changed - a slider that is off screen is not touched at all (its numbers are put right when it is seen again)
    const roots = [];
    if (home && home.isConnected) roots.push(home);
    for (const sl of slots) if (sl.el.isConnected) roots.push(sl.el);
    for (const root of roots) {
      const quiet = root === home && !homeSeen;
      root.querySelectorAll("[data-rw-hold],[data-rw-end]").forEach((el) => {
        const t = +(el.dataset.rwHold || el.dataset.rwEnd);
        const s = secsLeft(t);
        if (s <= 0) expired = true;
        if (quiet) return;
        const txt = clock(s);
        if (el.textContent !== txt) el.textContent = txt;
      });
    }
    if (expired && !tickOnce.busy) {
      tickOnce.busy = true;
      refresh(true).finally(() => setTimeout(() => { tickOnce.busy = false; }, 4000));
    }
  }

  function mount(el, opts) {
    if (!el) return;
    for (const s of slots) if (s.el === el) slots.delete(s);
    const s = { el, mode: (opts && opts.mode) || "checkout", code: false };
    slots.add(s);
    el.classList.add("rw-slot");
    if (s.mode === "account") accOpen = false; // (the account screen starts with it closed, and asks the server nothing until it is opened)
    paint(s);
    if (s.mode !== "account") {
      loadMine(false).then(() => { redraw(); });
      if (!phone()) loadPub(false).then(redraw); // (no number yet: the public offers are what can be shown)
    }
    startTick();
    return s;
  }

  const mountAccount = (el) => mount(el, { mode: "account" });

  function mountHome(el) {
    home = el;
    if (!el) return;
    el.hidden = true;
    homeSig = "";
    redraw();
    refresh(false);
  }

  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains("rw-code-in")) return;
    const slot = [...slots].find((x) => x.el.contains(t));
    if (slot && slot.msg) slot.msg = "";
    const m = t.closest(".rw-code-box") && t.closest(".rw-code-box").querySelector(".rw-code-msg");
    if (m) m.remove();
  });

  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-rw]");
    if (!b) return;
    ev.preventDefault();
    const act = b.dataset.rw;
    const slot = [...slots].find((s) => s.el.contains(b));
    if (act === "claim") {
      b.disabled = true;
      b.textContent = "Reserving…"; // (the answer can take a moment: the button says so at once)
      await claim({ offerId: +b.dataset.id });
      if (b.isConnected) { b.disabled = false; b.textContent = "Claim"; }
    } else if (act === "use") {
      picked = b.dataset.key;
      declined.delete(picked);
      popKey = picked;
      redraw();
      popKey = "";
    } else if (act === "remove") {
      const e = entries(ctxOf({ items: P(Cart.getTotal()), lines: [] })).find((x) => x.key === b.dataset.key);
      if (e) await release(e);
    } else if (act === "code-open") {
      if (slot) { slot.code = true; slot.msg = ""; paint(slot); const i = slot.el.querySelector(".rw-code-in"); if (i) i.focus(); }
    } else if (act === "code") {
      const inp = b.parentElement.querySelector(".rw-code-in");
      const code = inp ? inp.value.trim() : "";
      if (!code) { if (inp) inp.focus(); return; }
      b.disabled = true;
      b.textContent = "Checking…";
      const ok = await claim({ code }, slot);
      if (ok && slot) slot.code = false;
      redraw();
      if (!ok && slot) { const i = slot.el.querySelector(".rw-code-in"); if (i) i.focus(); } // (the wrong code is still there, ready to be corrected)
    } else if (act === "acc") {
      accOpen = !accOpen;
      const asked = accOpen ? loadMine(false) : null; // (started first, so the row says "Loading…" and not "Could not load")
      redraw();
      if (asked) asked.then(redraw);
    } else if (act === "acc-retry") {
      const again = loadMine(true);
      redraw();
      again.then(redraw);
    } else if (act === "co-more") {
      coAll = !coAll;
      redraw();
    } else if (act === "dot") {
      homePause = Date.now() + 9000;
      homeIdx = +b.dataset.i;
      showSlide(homeIdx, true);
    } else if (act === "go") {
      if (window.CheckoutSheet) CheckoutSheet.openCart();
    } else if (act === "tap") {
      // the owner's picture banner: a tap claims the offer (or opens the checkout)
      if (b.dataset.do !== "claim") { if (window.CheckoutSheet) CheckoutSheet.openCart(); return; }
      if (b.classList.contains("is-busy")) return;
      b.classList.add("is-busy");
      const old = b.querySelector(".rw-rib");
      const kept = old ? old.outerHTML : "";
      if (old) old.remove();
      b.insertAdjacentHTML("beforeend", `<span class="rw-rib">Reserving…</span>`);
      await claim({ offerId: +b.dataset.id });
      b.classList.remove("is-busy");
      if (b.isConnected) { const r = b.querySelector(".rw-rib"); if (r) r.remove(); if (kept) b.insertAdjacentHTML("beforeend", kept); } // (a refusal that changes nothing on screen: the banner is as it was)
    }
  });

  // a picture banner is a button: Enter / Space work like a tap
  document.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target && ev.target.matches && ev.target.matches(".rw-img[data-rw=tap]")) { ev.preventDefault(); ev.target.click(); }
  });
  // a picture that does not load: that offer shows its text card instead
  document.addEventListener("error", (ev) => {
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains("rw-pic")) return;
    badImg.add(Number(t.dataset.img));
    homeSig = "";
    redrawHome();
  }, true);

  /** "You saved ₹X" for the order-placed screen (the order carries its own reward line). */
  function savedHtml(order) {
    const l = order && Array.isArray(order.charges) ? order.charges.find((x) => x.key === "offer") : null;
    if (!l) return "";
    const amt = Math.abs(Number(l.charged || 0));
    knowHist();
    return `<div class="rw-saved anim-fade-up" style="animation-delay:270ms;">🎉 You saved <b>${Utils.formatMoney(amt)}</b> with <b>${esc(l.label)}</b></div>`;
  }

  return { mountHome, mount, mountAccount, discountFor, payload, setPhone, afterOrder, savedHtml, refresh, calc, place };
})();

// the home strip (the page is already built when this script runs: it sits at the end of the body)
(() => {
  const el = document.getElementById("rewardsHome");
  if (el) window.Rewards.mountHome(el);
})();
