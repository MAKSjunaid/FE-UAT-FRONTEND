/* "Featured Products" rows on the customer website.
 *
 * The admin (Banners tab -> Featured Products) can add as many rows as they like. Every row has its own title, line under
 * the title, products (any number), Position and Select Category - exactly like a banner: the row sits among the product
 * cards at its Position (1 = above the first product, 5 = after the first 4 products ...) and shows on the tabs it was
 * made for (All categories / the ALL tab / chosen categories).
 *
 * A row is one soft panel with the title on top and a strip of small cards: photo, name, price and an Add button (the same
 * gold button as the product cards). Tapping a card's photo or name lifts it out of its place into a bigger card with every
 * detail (full description, sizes, Add); the X, a tap outside it, or Esc sends it back to its place the same way in reverse.
 * "View all" - shown only when some cards do not fit the screen - opens a sheet listing every product of that row, and the
 * cards in that sheet lift out the same way.
 *
 * When there are more cards than fit the screen the strip drifts slowly from right to left by itself, round and round
 * (the cards are repeated once while it drifts; the repeat is removed as soon as the customer swipes it). It stops while a
 * finger / the mouse is on it, resumes a moment after, and only moves while it is on screen and the page is in front. With
 * "reduce motion" on, or animations switched off in Customize, it stays still (and can still be swiped).
 *
 * Quiet by design - it adds no request of its own on the usual path:
 *  - what to show (rows, titles, product ids) arrives inside the website settings the page already loads;
 *  - the products come from the catalog the page already holds; only the ones it does not hold yet are fetched, in ONE
 *    request by id for all rows together (the same call the cart uses);
 *  - rows are not shown while searching (storefront.js calls SiteSpecials.place() together with the banners).
 * A product that was hidden or deleted is simply left out. When nothing is left, or the row's switch is off, the row is not
 * there at all.
 *
 * The same panel also carries the "Buy it again" row (see the BUY IT AGAIN section near the end of this file): when the admin
 * switches it on it is one more row with kind "reorder", placed by the very same rules and drifting the same way, but its
 * cards are the products the signed-in customer has ordered most (small cards: picture, name, Add button) - or one slim
 * sign-in strip when nobody is signed in.
 *
 * To remove the feature completely: delete this file, css/site-specials.css, their two tags in index.html and the
 * SiteSpecials line in storefront.js (placeBanners). */

window.SiteSpecials = (() => {
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));

  const rows = new Map(); // row id -> row (see makeRow)
  let ctx = { grid: null, hidden: true, finished: false, category: "All" };
  const variantOf = {}; // product id -> "variant1" | "variant2"
  const asked = new Set(); // ids already requested (a hidden / deleted product is not asked for again and again)
  let loading = false;

  const cfg = () => {
    const c = window.SiteCustomize && window.SiteCustomize.cfg && window.SiteCustomize.cfg();
    return (c && c.specials) || null;
  };

  /** The rows to show, cleaned. (The old single "Today's Specials" row, if the server still sends it that way, is one row
   * at the top of the All tab.) */
  function setsOf(s) {
    if (!s) return [];
    let list = Array.isArray(s.sets) ? s.sets : [];
    if (!list.length && s.enabled && Array.isArray(s.productIds) && s.productIds.length) {
      list = [{ id: "legacy", enabled: true, title: s.title, subtitle: s.subtitle, place: 1, showIn: ["@all"], productIds: s.productIds }];
    }
    const out = list
      .filter((x) => x && x.id && x.enabled !== false && Array.isArray(x.productIds) && x.productIds.length)
      .map((x) => ({
        id: String(x.id),
        title: x.title || "",
        subtitle: x.subtitle || "",
        place: Math.max(1, Math.min(500, Math.round(Number(x.place)) || 1)),
        bannerFirst: x.bannerFirst === true, // with a banner at the same place: false = this row on top, true = banner on top
        showIn: Array.isArray(x.showIn) ? x.showIn.filter((c) => typeof c === "string") : [],
        productIds: x.productIds,
      }));
    // "Buy it again": one more row, filled with the customer's own most-ordered products (none of its own in the settings)
    const r = s.reorder;
    if (r && r.enabled === true) {
      out.push({
        id: RO_ID,
        kind: "reorder",
        title: (typeof r.title === "string" && r.title.trim()) || RO_TITLE, // (what the admin wrote; these words until then)
        subtitle: typeof r.subtitle === "string" ? r.subtitle.trim() : RO_LINE,
        guests: r.showGuests === true, // also a "Sign in" strip for visitors who are not signed in (the admin's choice, off by default)
        count: Math.max(3, Math.round(Number(r.count)) || 10),
        place: Math.max(1, Math.min(500, Math.round(Number(r.place)) || 1)),
        bannerFirst: r.bannerFirst === true,
        showIn: Array.isArray(r.showIn) ? r.showIn.filter((c) => typeof c === "string") : [],
        pins: Array.isArray(r.pins)
          ? r.pins.map((p) => ({ id: Number(p && p.id), pos: Math.max(1, Math.round(Number(p && p.pos)) || 1) })).filter((p) => p.id > 0)
          : [],
        productIds: [],
      });
    }
    return out;
  }

  /** Is a row with these "show in" choices meant for this tab? Empty = every tab; "@all" = the All tab. */
  function shownIn(cats, category) {
    if (!cats || !cats.length) return true;
    return !category || category === "All" ? cats.includes("@all") : cats.includes(category);
  }

  const priceOf = (p, v) => (v === "variant2" ? p.variant2Price : p.variant1Price);
  const mrpOf = (p, v) => (v === "variant2" ? p.variant2Mrp : p.variant1Mrp);

  function cardHtml(p, full) {
    const v = variantOf[p.id] || "variant1";
    const price = priceOf(p, v);
    const mrp = mrpOf(p, v);
    const off = Utils.discountPercent(price, mrp);
    const qty = Cart.quantityOf(p.id, v);
    const showDesc = !!(full && p.description && SiteCustomize.on("showProductDescription")); // the short row has none; the "View all" sheet does
    const two = !!p.variant2Label;
    const variants = two
      ? `<div class="sp-var" role="group" aria-label="Choose size">
          <button type="button" data-sp="variant" data-v="variant1" class="${v === "variant1" ? "on" : ""}">${esc(p.variant1Label)}</button>
          <button type="button" data-sp="variant" data-v="variant2" class="${v === "variant2" ? "on" : ""}">${esc(p.variant2Label)}</button>
        </div>`
      : p.variant1Label
        ? `<div class="sp-var"><button type="button" class="on" disabled>${esc(p.variant1Label)}</button></div>`
        : "";
    const foot = p.outOfStock
      ? `<button type="button" class="sp-soldout" disabled>${esc(SiteCustomize.t("outOfStockText"))}</button>`
      : `<button type="button" class="sp-add ${qty > 0 ? "hide" : ""}" data-sp="add">${esc(SiteCustomize.t("addToCartText"))}</button>
         <div class="sp-step ${qty > 0 ? "show" : ""}">
           <button type="button" data-sp="dec" aria-label="Decrease">−</button><span class="sp-qty">${qty}</span><button type="button" data-sp="inc" aria-label="Increase">+</button>
         </div>`;
    return `
      <article class="sp-card ${p.outOfStock ? "sp-out" : ""}" data-id="${p.id}">
        <button type="button" class="sp-media" data-sp="open" aria-label="${esc(p.name)} - view item">
          <img src="${esc(Utils.mediumImageUrl(p.imageUrl))}" alt="" decoding="async" draggable="false" onerror="this.style.opacity=0" />
          <span class="sp-off" ${off > 0 && !p.outOfStock ? "" : "hidden"}>${off}% OFF</span>
        </button>
        <div class="sp-body">
          <button type="button" class="sp-name" data-sp="open">${esc(p.name)}</button>
          ${showDesc ? `<div class="sp-desc">${esc(p.description)}</div>` : ""}
          ${variants}
          <div class="sp-price"><span class="sp-now" data-sp-now>${Utils.formatMoney(price)}</span><span class="sp-mrp" data-sp-mrp ${off > 0 ? "" : "hidden"}>${Utils.formatMoney(mrp)}</span></div>
          <div class="sp-foot">${foot}</div>
        </div>
      </article>`;
  }

  function skeleton(n) {
    return Array.from({ length: n }).map(() =>
      `<div class="sp-card sp-skel"><div class="sp-media skeleton"></div><div class="sp-body"><div class="skeleton sp-sk1"></div><div class="skeleton sp-sk2"></div><div class="skeleton sp-sk3"></div></div></div>`
    ).join("");
  }

  function frame(s, cards) {
    const title = esc(s.title || "");
    const sub = esc(s.subtitle || "");
    // with no title and no line the head only holds "View all" (and is not shown at all when that is hidden)
    return `
      <div class="sp-head ${title || sub ? "" : "sp-head-bare"}">
        <div class="sp-titles">${title ? `<h2 class="sp-title">${title}</h2>` : ""}${sub ? `<p class="sp-sub">${sub}</p>` : ""}</div>
        <button type="button" class="sp-all" data-sp="all" hidden>View all <span aria-hidden="true">→</span></button>
      </div>
      <div class="sp-track" tabindex="-1"><div class="sp-rail">${cards}</div></div>`;
  }

  // ---- the slow drift ----------------------------------------------------------------------------
  const SPEED = 22; // pixels per second: slow enough to read and tap
  const HOLD_MS = 2500; // after a swipe / tap the row waits this long before drifting on
  const motionOff = () => {
    const c = window.SiteCustomize && window.SiteCustomize.cfg && window.SiteCustomize.cfg();
    return !!(c && c.animationsOff === true) || !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  };


  // ---- one row ------------------------------------------------------------------------------------
  /** Everything that belongs to one row: its panel, its drift, its taps. The panel is made once and moved around; it is
   * only put on the page (inside the product grid) by place(). */
  function makeRow(id) {
    const el = document.createElement("section");
    el.className = "sp";
    el.dataset.spRow = id;
    let set = null; // the row's settings
    let sig = ""; // what the panel currently shows, to skip redraws when nothing changed
    let needsStart = false; // the drift must be (re)started once the panel is on the page
    let drift = null; // { track, setW, pos, lastSet, last, until, raf }
    let onScreen = true;
    let down = null; // the button pressed when the repeat was taken away: { what, v, id, at, x, y }
    // What really holds the drift still. A phone sends fake "mouse" events after a tap (mouseenter, and no mouseleave until
    // the next tap somewhere else) and can lose the end of a touch: those must never freeze the row for good, so only
    // these three count, and step() lets go of a hold when none of them is true any more.
    let pressedAt = 0; // a finger / button is down on the row (since when)
    let mouseOver = false; // a real mouse pointer rests on the row
    let kbFocus = false; // keyboard focus is inside the row
    let tapped = 0; // when a tap was completed by hand (a "click" right after it must not act a second time)
    let watcher = null;

    /** The panel was taken out of the page and put back (the grid was redrawn): some browsers drop the drift's animations
     * then. They are started again from exactly where they were, so nothing visible jumps. */
    function reattached() {
      if (!drift || !drift.anims || !el.isConnected) return;
      const t = drift.anims[0] && typeof drift.anims[0].currentTime === "number" ? drift.anims[0].currentTime : drift.time;
      const paused = drift.anims.some((a) => a.playState === "paused");
      startLoop(t);
      if (paused && drift && drift.anims) drift.anims.forEach((a) => a.pause());
    }

    const row = {
      id,
      el,
      reattached,
      get set() { return set; },
      get needsStart() { return needsStart; },
      set needsStart(v) { needsStart = v; },
    };

    // ---- the slow drift ------------------------------------------------------------------------
    // Every card drifts on its OWN small animation (a ring: a card that has left on the left comes back in on the right,
    // out of sight). Nothing is repeated off-screen as one big block, the row itself is a plain scroller, and the row is
    // never rebuilt while it drifts - so it cannot blank out or restart. The moment a finger / the mouse touches the row,
    // bake() turns the drift into a real scroll position (the cards are put in the order they are seen) so it can be
    // swiped normally; a moment after they let go, the drift goes on from exactly where the row is.
    const cardsOf = () => [...el.querySelectorAll(".sp-set > .sp-card")];
    const realCards = () => cardsOf().filter((c) => !c.hasAttribute("data-extra"));

    function stopLoop() {
      if (!drift) return;
      cancelAnimationFrame(drift.raf);
      if (drift.anims) drift.anims.forEach((a) => a.cancel());
      el.querySelectorAll(".sp-card[data-extra]").forEach((c) => c.remove());
      const track = el.querySelector(".sp-track");
      if (track) track.classList.remove("sp-loop");
      drift = null;
    }

    /** Card width, the distance from one card to the next, and whether the cards are more than fit the screen. (Only the
     * real cards count; copies added for the drift do not.) Also decides whether "View all" is shown. */
    function measure() {
      const track = el.querySelector(".sp-track");
      const all = el.querySelector(".sp-all");
      const reals = realCards();
      if (!track || !reals.length) return null;
      const w = reals[0].offsetWidth;
      const P = reals.length > 1 ? reals[1].offsetLeft - reals[0].offsetLeft : w + 12;
      const lead = parseFloat(getComputedStyle(track).paddingLeft) || 0;
      // two cards at least (one card never drifts and never needs "View all"), and a real width to compare with
      const overflow = reals.length >= 2 && w > 0 && P > 0 && track.clientWidth > 0 && lead + reals.length * P - (P - w) > track.clientWidth + 1;
      if (all) all.hidden = !overflow;
      return { track, w, P, lead, n: reals.length, overflow };
    }

    /** Starts the drift - only when there are more cards than fit the screen and movement is allowed. */
    function startLoop(resumeAt) {
      stopLoop();
      if (!el.isConnected) return;
      const m = measure();
      if (!m || !m.overflow || motionOff()) return; // everything fits (or movement is off): nothing to drift
      m.track.classList.add("sp-loop"); // no snapping while it drifts (snapping would fight the movement)
      drift = { track: m.track, anims: null, until: 0, raf: 0, lastSet: m.track.scrollLeft, width: m.track.clientWidth };
      startRing(typeof resumeAt === "number" && resumeAt >= 0 ? resumeAt : null);
      drift.raf = requestAnimationFrame(step);
    }

    /** Sets the ring going from where the row is now (its scroll position). Visually nothing moves. */
    function startRing(resumeAt) {
      const d = drift;
      const m = measure();
      if (!d || !m) return;
      const { track, w, P, lead, n } = m;
      // the ring must be long enough that, while a card waits out of sight on the right, the screen is still full
      const need = track.clientWidth + w + 24;
      const copies = Math.max(1, Math.ceil(need / (n * P)));
      if (!el.querySelector(".sp-card[data-extra]") && copies > 1) {
        const setEl = el.querySelector(".sp-set");
        const reals = realCards();
        for (let c = 1; c < copies; c++) {
          reals.forEach((r) => {
            const x = r.cloneNode(true);
            x.setAttribute("data-extra", "1");
            x.setAttribute("aria-hidden", "true");
            x.querySelectorAll("button").forEach((b) => (b.tabIndex = -1));
            setEl.appendChild(x);
          });
        }
      }
      const cards = cardsOf();
      const L = cards.length * P; // the length of the ring
      const W0 = -(w + lead) - 2; // a card is completely out of sight (to the left) from here: it goes round to the right
      const s0 = track.scrollLeft; // where the row is now
      const tr = (x) => `translate3d(${x}px, 0, 0)`;
      const dur = L / SPEED * 1000;
      track.scrollLeft = 0;
      d.anims = cards.map((card, i) => {
        const nat = i * P;
        let pos = nat;
        while (pos >= W0 + L) pos -= L;
        if (pos <= W0) pos += L;
        const a = pos - nat;
        const wrap = pos - W0; // how far it drifts before it is out of sight
        const kf = [{ transform: tr(a), offset: 0 }];
        if (wrap < L) {
          kf.push({ transform: tr(W0 - nat), offset: wrap / L });
          kf.push({ transform: tr(W0 + L - nat), offset: wrap / L });
        }
        kf.push({ transform: tr(a), offset: 1 });
        return card.animate(kf, { duration: dur, iterations: Infinity, easing: "linear" });
      });
      d.time = resumeAt != null ? resumeAt : s0 / SPEED * 1000; // (resumeAt: carry on exactly where the drift was)
      d.anims.forEach((a) => (a.currentTime = d.time));
      d.lastSet = 0;
    }

    /** The customer takes over: the drift becomes a real scroll position. The cards are put in the order they are SEEN (a
     * card that went round to the right goes to the end of the row), and the row is scrolled so that nothing on screen
     * moves. Returns true when it was drifting. */
    function bake() {
      const d = drift;
      if (!d || !d.anims) return false;
      const t = d.track;
      const setEl = el.querySelector(".sp-set");
      const tl = t.getBoundingClientRect().left;
      const cards = cardsOf();
      const seen = cards.map((c) => ({ c, x: c.getBoundingClientRect().left - tl })).sort((u, v) => u.x - v.x);
      d.anims.forEach((a) => a.cancel());
      d.anims = null;
      seen.forEach((o, i) => {
        if (setEl.children[i] !== o.c) setEl.insertBefore(o.c, setEl.children[i]);
      });
      const lead = parseFloat(getComputedStyle(t).paddingLeft) || 0;
      t.scrollLeft = Math.max(0, lead - seen[0].x);
      d.lastSet = t.scrollLeft;
      return true;
    }

    /** Only watches over the drift (it does not move anything): pauses it while a finger / the mouse is on the row, the page
     * is hidden or a sheet is open, and sets it going again afterwards. */
    function step(now) {
      const d = drift;
      if (!d) return;
      d.raf = requestAnimationFrame(step);
      const t = d.track;
      // the customer moved it (swipe, wheel, momentum, keys): take over, then wait a moment
      if (Math.abs(t.scrollLeft - d.lastSet) > 2.5) {
        bake();
        d.until = now + HOLD_MS;
      }
      if (d.until === Infinity && !((pressedAt && now - pressedAt < 6000) || mouseOver || kbFocus)) d.until = now + HOLD_MS;
      const busy = d.until === Infinity || now < d.until;
      const front = onScreen && !document.hidden; // (the rows keep drifting behind a sheet or a lifted-out card too)
      if (busy || !front) {
        if (d.anims) d.anims.forEach((a) => a.playState === "running" && a.pause());
        d.lastSet = t.scrollLeft;
        d.probe = null;
        return;
      }
      if (!d.anims) {
        startRing(); // they let go: the drift goes on from where the row is
        d.probe = null;
        return;
      }
      d.anims.forEach((a) => a.playState === "paused" && a.play());
      if (typeof d.anims[0].currentTime === "number") d.time = d.anims[0].currentTime; // where the drift is (to carry on from it)
      // Self-healing: the page redraws (a product was switched on / off, so the grid is rebuilt and this panel is taken out
      // and put back), and some browsers then drop or freeze the drift's animations. If they are gone, or the cards have not
      // moved for over a second although they should, the drift is simply started again.
      if (!el.isConnected) return;
      if (d.anims.some((a) => a.playState === "idle" || a.playState === "finished")) {
        startLoop(d.time);
        return;
      }
      const c0 = el.querySelector(".sp-set > .sp-card");
      if (c0) {
        const x = c0.getBoundingClientRect().left;
        if (!d.probe) d.probe = { x, t: now };
        else if (now - d.probe.t > 1300) {
          const stuck = Math.abs(x - d.probe.x) < 0.4;
          d.probe = { x, t: now };
          if (stuck) startLoop(d.time);
        }
      }
    }

    function hold(ms) {
      if (!drift) return;
      if (ms !== Infinity && (popUp() || document.documentElement.classList.contains("sheet-open"))) ms = 0; // a card is lifted out / a sheet is open: the row keeps drifting behind it, no waiting
      drift.until = ms === Infinity ? Infinity : performance.now() + ms;
      if (drift.anims) drift.anims.forEach((a) => a.pause()); // stops at once; the watcher sets it going again when the wait is over
    }

    let sizeWatch = null;
    let sizeTimer = 0;
    /** Measures again whenever the row's own size changes (the page settling, fonts, turning the phone) - so a measurement
     * taken too early can never leave "View all" or the drift wrong. */
    function watchTrack() {
      const track = el.querySelector(".sp-track");
      if (!track || !window.ResizeObserver) return;
      if (!sizeWatch) {
        sizeWatch = new ResizeObserver(() => {
          cancelAnimationFrame(sizeTimer);
          sizeTimer = requestAnimationFrame(refit);
        });
      }
      sizeWatch.disconnect();
      sizeWatch.observe(track);
    }

    /** The row's width changed (turning the phone) or the settings changed: start again - but only when it is needed, and
     * from where the row is. (A phone's address bar sliding in and out also sends "resize" - that must change nothing.) */
    function refit() {
      if (!el.isConnected) return;
      const track = el.querySelector(".sp-track");
      if (!track) return;
      const wantsDrift = !!(measure() || {}).overflow && !motionOff();
      if (wantsDrift && drift && drift.width === track.clientWidth) return; // nothing changed
      if (!wantsDrift && !drift) return;
      bake();
      startLoop();
    }

    /** Draws (or removes from the drawing) the panel's contents. Returns true when the row has something to show. */
    function render(s, wanted) {
      if (s.kind === "reorder") {
        el.classList.add("sp-ro", "sp-mini");
        el.classList.toggle("sp-ro-out", s.state === "signin");
        if (!wanted || s.state === "none") {
          set = s;
          return hide();
        }
        if (s.state === "signin") return renderSignIn(s);
        if (s.state === "loading") return renderUsualsLoading(s);
      }
      set = s;
      el.setAttribute("aria-label", s.title || "Featured products");
      if (!wanted) return hide();
      const ids = s.productIds;
      const products = ids.map((pid) => CatalogStore.getProduct(pid)).filter(Boolean);
      if (!products.length) {
        if (!loading) return hide();
        // first load: placeholders, so the page does not jump when the row arrives
        const key = `skel|${ids.length}`;
        if (sig !== key) {
          sig = key;
          stopLoop();
          el.innerHTML = frame(s, skeleton(Math.min(ids.length, 4)));
        }
        return true;
      }
      const next = JSON.stringify([
        s.title, s.subtitle, SiteCustomize.t("addToCartText"), SiteCustomize.t("outOfStockText"),
        products.map((p) => [p.id, p.name, p.imageUrl, p.variant1Label, p.variant1Price, p.variant1Mrp,
          p.variant2Label, p.variant2Price, p.variant2Mrp, !!p.outOfStock]),
      ]);
      if (next !== sig) {
        const track = el.querySelector(".sp-track");
        bake(); // where the row really is
        const keep = track ? track.scrollLeft : 0;
        stopLoop();
        sig = next;
        el.innerHTML = frame(s, `<div class="sp-set">${products.map((p) => cardHtml(p, false)).join("")}</div>`);
        const t = el.querySelector(".sp-track");
        if (t) t.scrollLeft = keep;
        watchTrack();
        needsStart = true; // measured once the row is really on screen
      }
      return true;
    }

    /** Nobody is signed in: one slim strip - a short invitation and a Sign in button. */
    function renderSignIn(s) {
      set = s;
      el.setAttribute("aria-label", RO_OUT_TITLE);
      if (sig !== "ro-in") {
        stopLoop();
        sig = "ro-in";
        el.innerHTML = frame({ title: "", subtitle: "" }, `<div class="sp-set ro-set">${roSignInHtml()}</div>`);
      }
      return true;
    }

    /** Signed in, the list is on its way: placeholders, so the page does not jump when the row arrives. */
    function renderUsualsLoading(s) {
      set = s;
      el.setAttribute("aria-label", s.title);
      if (sig !== "ro-skel") {
        stopLoop();
        sig = "ro-skel";
        el.innerHTML = frame(s, skeleton(3));
      }
      return true;
    }

    /** Not shown now (wrong tab, searching, nothing to show): the drift stops; place() takes the panel off the page. */
    function hide() {
      if (drift) stopLoop();
      needsStart = true;
      return false;
    }

    function destroy() {
      stopLoop();
      if (watcher) watcher.disconnect();
      if (sizeWatch) sizeWatch.disconnect();
      el.remove();
    }

    // ---- touches ------------------------------------------------------------------------------------
    // a finger or the mouse on the row stops it; it moves on shortly after they leave
    el.addEventListener(
      "pointerdown",
      (e) => {
        // Taking the repeat away (settle) replaces the elements under the finger, and a browser sends no "click" to a
        // button that was removed mid-press - so when that happened the tap is completed by hand on pointer-up.
        const b = e.target.closest && e.target.closest("[data-sp]");
        const c = b && b.closest(".sp-card");
        const note = b && c ? { what: b.dataset.sp, v: b.dataset.v || "", id: Number(c.dataset.id), at: performance.now(), x: e.clientX, y: e.clientY } : null;
        pressedAt = performance.now();
        hold(Infinity);
        tapped = 0;
        down = bake() ? note : null;
      },
      { passive: true }
    );
    el.addEventListener(
      "pointerup",
      (e) => {
        const d = down;
        down = null;
        if (!d || performance.now() - d.at > 700 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
        const real = el.querySelector(`.sp-set > .sp-card:not([data-extra])[data-id="${d.id}"] [data-sp="${d.what}"]${d.v ? `[data-v="${d.v}"]` : ""}`);
        if (!real) return;
        tapped = performance.now();
        handle(real, row);
      },
      { passive: true }
    );
    ["pointerup", "pointercancel"].forEach((t) =>
      el.addEventListener(t, () => {
        pressedAt = 0;
        hold(mouseOver ? Infinity : HOLD_MS);
      }, { passive: true })
    );
    // only a real mouse "hovers" (a finger never does - phones fake it after a tap)
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      mouseOver = true;
      hold(Infinity);
    }, { passive: true });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch") return;
      mouseOver = false;
      hold(HOLD_MS);
    }, { passive: true });
    el.addEventListener("wheel", () => { bake(); hold(HOLD_MS); }, { passive: true });
    el.addEventListener("focusin", (e) => {
      // only keyboard focus holds it (a tapped button keeps the focus on some browsers, and that must not freeze the row)
      let kb = false;
      try { kb = !!(e.target.matches && e.target.matches(":focus-visible")); } catch { kb = false; }
      if (!kb) return;
      kbFocus = true;
      hold(Infinity);
    });
    el.addEventListener("focusout", () => {
      kbFocus = false;
      hold(HOLD_MS);
    });
    el.addEventListener("click", (e) => {
      if (performance.now() - tapped < 500) return; // already done on pointer-up
      onClick(e, row);
    });
    if (window.IntersectionObserver) {
      watcher = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => {
            onScreen = e.isIntersecting;
            if (onScreen && !drift) refit(); // it just came into view: check again that it is measured right
          }),
        { threshold: 0 }
      );
      watcher.observe(el);
    }

    row.render = render;
    row.hide = hide;
    row.destroy = destroy;
    row.hold = hold;
    row.startLoop = startLoop;
    row.restart = refit;
    return row;
  }

  // ---- taps --------------------------------------------------------------------------------------
  function onClick(e, row) {
    const btn = e.target.closest("[data-sp]");
    if (btn) handle(btn, row);
  }

  function handle(btn, row) {
    const what = btn.dataset.sp;
    if (what === "all") return row && openAll(row);
    if (what === "close") return closePop();
    if (what === "ro-login") return window.ProfileSheet && (window.ProfileSheet.signIn || window.ProfileSheet.open)();

    const card = btn.closest(".sp-card");
    if (!card) return;
    const inPop = !!card.closest("[data-sp-pop]"); // the big card lifted out of that sheet
    const id = Number(card.dataset.id);
    const p = CatalogStore.getProduct(id);
    if (!p) return;
    const v = variantOf[id] || "variant1";
    if (what === "open") {
      if (!inPop) openPop(card, row); // from the row or from the "View all" sheet: the card lifts out, big
    } else if (what === "variant") {
      variantOf[id] = btn.dataset.v;
      document.querySelectorAll(`.sp-card[data-id="${id}"]`).forEach((c) => patchCard(c)); // the row, its repeat and the sheet
    } else if (what === "add" || what === "inc") {
      const from = btn.getBoundingClientRect(); // before the button hides itself
      Cart.setQuantity(p, v, what === "add" ? 1 : Cart.quantityOf(id, v) + 1);
      pulse(id);
      if (what === "add") Toast.msg("addedToCart", { name: p.name });
      if (window.CartFx) CartFx.fly(from, { querySelector: () => card.querySelector("img") });
    } else if (what === "dec") {
      if (window.CartFx) CartFx.back(btn.getBoundingClientRect(), { querySelector: () => card.querySelector("img") });
      Cart.setQuantity(p, v, Cart.quantityOf(id, v) - 1);
      pulse(id);
    }
  }

  /** Every copy of this card (row, repeat, sheet) shows the new quantity, and the quantity number gives a little pulse. */
  function pulse(id) {
    document.querySelectorAll(`.sp-card[data-id="${id}"]`).forEach((c) => patchQty(c, id, variantOf[id] || "variant1", true));
  }

  /** Price, discount, size buttons and quantity of one card, after the size was switched - no redraw. */
  function patchCard(card) {
    const id = Number(card.dataset.id);
    const p = CatalogStore.getProduct(id);
    if (!p) return;
    const v = variantOf[id] || "variant1";
    const price = priceOf(p, v);
    const mrp = mrpOf(p, v);
    const off = Utils.discountPercent(price, mrp);
    card.querySelectorAll('[data-sp="variant"]').forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    const now = card.querySelector("[data-sp-now]");
    if (now) now.textContent = Utils.formatMoney(price);
    const was = card.querySelector("[data-sp-mrp]");
    if (was) {
      was.textContent = Utils.formatMoney(mrp);
      was.hidden = off <= 0;
    }
    const badge = card.querySelector(".sp-off");
    if (badge) {
      badge.textContent = `${off}% OFF`;
      badge.hidden = off <= 0 || !!p.outOfStock;
    }
    patchQty(card, id, v, false);
  }

  function patchQty(card, id, v, withPulse) {
    const qty = Cart.quantityOf(id, v);
    const add = card.querySelector(".sp-add");
    const step = card.querySelector(".sp-step");
    const val = card.querySelector(".sp-qty");
    if (!add || !step || !val) return; // sold out: nothing to patch
    add.classList.toggle("hide", qty > 0);
    step.classList.toggle("show", qty > 0);
    if (val.textContent !== String(qty)) {
      val.textContent = qty;
      if (withPulse) {
        val.classList.remove("pulse");
        void val.offsetWidth; // restart the animation
        val.classList.add("pulse");
      }
    }
  }

  // ---- "View all": every product of one row in one sheet -----------------------------------------------
  function openAll(row) {
    const s = row.set;
    const products = ((s && s.productIds) || []).map((id) => CatalogStore.getProduct(id)).filter(Boolean);
    if (!products.length || !window.CheckoutSheet) return;
    CheckoutSheet.renderSheet(
      `<div class="sheet-body"><div class="sp-listgrid" data-sp-list data-sp-row="${esc(row.id)}">${products.map((p) => cardHtml(p, true)).join("")}</div></div>`,
      esc(s.title || "View all")
    );
    // A shorter sheet than the cart's: on an iPhone the tall one slid under the address bar (top border + X cropped)
    const sh = document.querySelector("#sheetRoot .sheet");
    if (sh) {
      sh.classList.add("sp-sheet");
      document.documentElement.style.setProperty("--toast-sheet-gap", `${sh.getBoundingClientRect().height + 14}px`);
    }
  }

  // ---- a special lifted out of the "View all" sheet -------------------------------------------------
  let pop = null; // { el, card, source, id, closing, owner }
  const popUp = () => { try { return !!(pop && pop.el.isConnected); } catch { return false; } }; // a card is lifted out right now

  const animate = () => !motionOff() && !!document.body.animate;
  const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

  /** The tapped card grows out of its place into a bigger card with everything about it. */
  function openPop(source, owner) {
    if (pop || !source) return;
    const id = Number(source.dataset.id);
    const p = CatalogStore.getProduct(id);
    const host = document.getElementById("sheetRoot");
    if (!p || !host) return;
    const el = document.createElement("div");
    el.className = "sp-pop";
    el.dataset.spPop = "1";
    el.innerHTML = `
      <div class="sp-pop-back" data-sp="close"></div>
      <div class="sp-pop-clip"><div class="sp-pop-stage">
        <div class="sp-pop-card" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
          ${cardHtml(p, true)}
          <button type="button" class="sp-pop-x" data-sp="close" aria-label="Close"></button>
        </div>
      </div></div>`;
    host.appendChild(el);
    const card = el.querySelector(".sp-pop-card");
    const clip = el.querySelector(".sp-pop-clip");
    const stage = el.querySelector(".sp-pop-stage");
    sizeStage(stage);
    pop = { el, card, clip, stage, source, id, closing: false, owner, smooth: !!source.closest("#sheetRoot") };
    el.querySelector(".sp-card").classList.add("sp-big");

    const from = source.getBoundingClientRect();
    // The big card is centred in the free area UNDER the header / category chips, so that when it has landed it does not
    // sit over them either (the page behind stays visible, dimmed, exactly where it is).
    if (!source.closest("#sheetRoot")) {
      const de = document.documentElement;
      const top = Math.round(floatingBars(source, from, de.clientWidth, de.clientHeight, true).T);
      if (top > 8) {
        const pad = top + 12;
        stage.style.paddingTop = pad + "px";
        card.style.maxHeight = Math.max(240, de.clientHeight - pad - 16) + "px";
      }
    }
    snapToPixels(card);
    const to = card.getBoundingClientRect();
    // the small card stays in its place behind the big one (no hole in the row / the sheet while the big card is up)
    if (animate()) {
      card.animate(
        // the big card is laid out differently from the small one (taller photo, longer text), so while it is squeezed into the small
        // card's box it looks stretched; it is faded in over the first part of the flight and faded out over the last part of the
        // way back, so the real small card underneath takes over smoothly instead of "snapping" into its own layout
        [{ transform: flip(from, to), borderRadius: "16px", opacity: 0 }, { offset: 0.3, opacity: 1 }, { transform: "none", borderRadius: "20px", opacity: 1 }],
        { duration: 340, easing: EASE }
      );
      const smooth = !!source.closest("#sheetRoot");
      fly(clip, stage, cutOff(source, from), true, 340, to, smooth); // grows out from UNDER the header / chips
      el.querySelector(".sp-pop-back").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: "ease-out" });
      card.querySelectorAll(".sp-desc, .sp-pop-x").forEach((n) =>
        n.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: 340, easing: "ease-out" })
      );
    }
    document.addEventListener("keydown", onKey);
    // the page behind must not scroll while the big card is up (the card itself can scroll if it is taller than the screen)
    const stop = (ev) => ev.preventDefault();
    if (window.CheckoutSheet && window.CheckoutSheet.holdScroll) window.CheckoutSheet.holdScroll(true); // the whole page is held still (checkout.js)
    const back = el.querySelector(".sp-pop-back");
    back.addEventListener("touchmove", stop, { passive: false });
    back.addEventListener("wheel", stop, { passive: false });
    const x = card.querySelector(".sp-pop-x");
    if (x) x.focus({ preventScroll: true });
    if (owner) owner.hold(0); // the row it came from drifts on behind the big card (the tap had paused it for a moment)
  }

  /** The card is centred, which can leave its edges half way between two screen pixels; the half-covered row of pixels
   * then blends with the (light) page behind and shows as a faint pale line along the top of the photo. Nudging the card
   * by a fraction of a pixel puts its edges exactly on screen pixels. (A margin on a centred flex item moves it by half.) */
  function snapToPixels(card) {
    const r = card.getBoundingClientRect();
    const k = window.devicePixelRatio || 1;
    const dx = Math.round(r.left * k) / k - r.left;
    const dy = Math.round(r.top * k) / k - r.top;
    if (Math.abs(dx) > 0.001) card.style.marginLeft = 2 * dx + "px";
    if (Math.abs(dy) > 0.001) card.style.marginTop = 2 * dy + "px";
  }

  /** The stage (the layer the card is centred in) is as big as the screen; it sits inside a window (the clip) that is
   * the whole screen at rest and shrinks to the visible area while the card flies. */
  function sizeStage(stage) {
    const de = document.documentElement;
    stage.style.width = de.clientWidth + "px";
    stage.style.height = de.clientHeight + "px";
  }

  /** Everything that floats over the page at the card's place (header, category chips, cart bar...): found by looking at
   * what is really painted on top at the card's top and bottom edge - not by a list of names - and by the usual names too. */
  function floatingBars(source, rect, W, H, named) {
    let T = 0, B = H;
    const bars = (x, y) => {
      const out = [];
      (document.elementsFromPoint ? document.elementsFromPoint(x, y) : []).forEach((e) => {
        if (e.closest(".sp-pop")) return;
        for (let n = e; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
          if (n.contains(source)) return;
          const pos = getComputedStyle(n).position;
          if (pos === "fixed" || pos === "sticky") {
            const r = n.getBoundingClientRect();
            if (r.height > 0 && r.height < H * 0.5) out.push(r);
            return;
          }
        }
      });
      return out;
    };
    const xs = [0.2, 0.5, 0.8].map((k) => Math.min(W - 1, Math.max(1, rect.left + rect.width * k)));
    // top: the bars stacked at the top (the header, then the chips under it) - look again just below each one found
    let y = Math.max(rect.top + 2, 1);
    for (let i = 0; i < 4 && y < rect.bottom; i++) {
      let next = T;
      xs.forEach((x) => bars(x, y).forEach((r) => { if (r.top < H * 0.5 && r.bottom > next) next = r.bottom; }));
      if (next <= T) break;
      T = next;
      y = T + 1;
    }
    // bottom: the cart bar
    const yb = Math.min(rect.bottom - 2, H - 1);
    xs.forEach((x) => bars(x, yb).forEach((r) => { if (r.top >= H * 0.5 && r.top < B) B = r.top; }));
    if (!named) return { T, B };
    // and by name, in case nothing was found at those points
    document.querySelectorAll(".site-header, .category-bar, .store-offline-banner").forEach((h) => {
      const r = h.getBoundingClientRect();
      const pos = getComputedStyle(h).position;
      if ((pos === "sticky" || pos === "fixed") && r.height && r.bottom > 0 && r.top < 240) T = Math.max(T, r.bottom);
    });
    const bar = document.querySelector(".cart-bar.show");
    if (bar && bar.getBoundingClientRect().top < H) B = Math.min(B, bar.getBoundingClientRect().top);
    return { T, B };
  }

  /** The part of the screen in which the card may be seen while it flies, or null when nothing needs cutting.
   * The card slides in / out UNDER whatever hides part of its place: the header / category chips / cart bar that float
   * on top, and the edge of the row panel or of the "View all" list when the card was cut off by it. Only the EDGES that
   * really cut the card are used (a card cut off on its left edge is cut there only) - so there is never a box around it,
   * and when nothing hides it (the page was scrolled so the bars are away) there is no cut at all. */
  function cutOff(source, rect) {
    const de = document.documentElement;
    const W = de.clientWidth, H = de.clientHeight;
    const f = floatingBars(source, rect, W, H, !source.closest("#sheetRoot"));
    let T = f.T, B = f.B, L = 0, R = W;
    for (let n = source.parentElement; n && n !== document.body && n !== de; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!/(auto|scroll|hidden|clip)/.test(cs.overflowX + " " + cs.overflowY)) continue;
      const r = n.getBoundingClientRect();
      if (rect.top < r.top - 1) T = Math.max(T, r.top);
      if (rect.bottom > r.bottom + 1) B = Math.min(B, r.bottom);
      if (rect.left < r.left - 1) L = Math.max(L, r.left);
      if (rect.right > r.right + 1) R = Math.min(R, r.right);
    }
    const box = { top: Math.max(0, T), left: Math.max(0, L), right: Math.max(0, W - R), bottom: Math.max(0, H - B) };
    return box.top || box.left || box.right || box.bottom ? box : null;
  }

  /** Animates the window (clip) between "the visible area" and "as much as the big card needs". Plain overflow:hidden +
   * top/left/right/bottom, which every browser understands (no clip-path needed); the stage moves the opposite way so
   * the card does not shift. The window is cut to the visible area for (almost) the whole flight - it only opens up for
   * the big card at rest - so the card is never painted over the header / chips, not even for a moment.
   * opening: cut for the flight, opens in its last moments; closing: closes in at once, stays cut. */
  const LEAD_MS = 130;
  function fly(clip, stage, box, opening, total, rest, smooth) {
    if (!box || !clip.animate) return;
    const de = document.documentElement;
    const px = (n) => n + "px";
    const open = { // what the big card at rest needs (never more than the visible area allows)
      top: Math.min(box.top, Math.max(0, rest.top)),
      left: Math.min(box.left, Math.max(0, rest.left)),
      right: Math.min(box.right, Math.max(0, de.clientWidth - rest.right)),
      bottom: Math.min(box.bottom, Math.max(0, de.clientHeight - rest.bottom)),
    };
    const win = (b) => ({ top: px(b.top), left: px(b.left), right: px(b.right), bottom: px(b.bottom) });
    const stg = (b) => ({ top: px(-b.top), left: px(-b.left) });
    // smooth (a card of the "View all" list): the cut edge opens / closes together with the card's own growth, so the part
    // of the big card that rises above the list's heading appears gradually instead of popping in at the very end
    const opts = smooth
      ? (opening
          ? { duration: total, easing: EASE, fill: "backwards" }
          : { duration: total, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" })
      : opening
      ? { delay: Math.max(0, total - LEAD_MS), duration: LEAD_MS, easing: "ease-in", fill: "backwards" }
      : { duration: LEAD_MS, easing: "ease-out", fill: "forwards" };
    clip.animate(opening ? [win(box), win(open)] : [win(open), win(box)], opts);
    stage.animate(opening ? [stg(box), stg(open)] : [stg(open), stg(box)], opts);
  }

  /** Moves a box that is at `to` so that it looks like it is at `from` (position and size). */
  function flip(from, to) {
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`;
  }

  /** The small card keeps drifting while the big one is up, so the big card must fly to where the small card WILL be when it
   * arrives, not to where it is now. The card's own drift animation is moved on by that time, the card is measured, and the
   * animation is put back - all within one frame, so nothing on screen moves. (A card that would be out of sight or
   * going round the ring by then simply uses its present place.) */
  function whereItWillBe(card, ms) {
    const now = card.getBoundingClientRect();
    let anims = [];
    try { anims = card.getAnimations ? card.getAnimations().filter((a) => a.playState === "running") : []; } catch { anims = []; }
    if (!anims.length) return now;
    const saved = anims.map((a) => a.currentTime);
    let r = now;
    try {
      anims.forEach((a, i) => { a.currentTime = saved[i] + ms; });
      const t = card.getBoundingClientRect();
      if (Math.abs(t.left - now.left) < 120) r = t; // a bigger jump = it went round the ring: keep the present place
    } catch { r = now; }
    anims.forEach((a, i) => { try { a.currentTime = saved[i]; } catch { /* ignore */ } });
    return r;
  }

  /** The big card goes back to where it came from, then the sheet is as it was. */
  function closePop() {
    const c = pop;
    if (!c || c.closing) return;
    c.closing = true;
    document.removeEventListener("keydown", onKey);
    const done = () => {
      c.el.remove();
      if (pop === c) pop = null;
      if (!pop && window.CheckoutSheet && window.CheckoutSheet.holdScroll) window.CheckoutSheet.holdScroll(false);
      if (c.owner) c.owner.hold(0); // (the row never stopped)
    };
    if (!c.el.isConnected) return done(); // the sheet was replaced meanwhile
    if (!animate()) return done();
    const to = c.card.getBoundingClientRect();
    const from = c.source.isConnected ? whereItWillBe(c.source, 280) : null;
    c.card.querySelectorAll(".sp-desc, .sp-pop-x").forEach((n) => n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }));
    c.el.querySelector(".sp-pop-back").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-in", fill: "forwards" });
    if (from) fly(c.clip, c.stage, cutOff(c.source, from), false, 280, to, c.smooth); // goes back UNDER the header / chips
    const a = c.card.animate(
      from
        ? [{ transform: "none", opacity: 1 }, { offset: 0.6, opacity: 1 }, { transform: flip(from, to), opacity: 0 }]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: 280, easing: "cubic-bezier(0.4, 0, 0.6, 1)", fill: "forwards" }
    );
    a.onfinish = done;
    a.oncancel = done;
    setTimeout(done, 600); // safety: whatever happens to the animation, the card always lands back in its place
  }

  /** Safety net: a card must never stay invisible. Called whenever the row is drawn / the sheet closes. */
  function unhideAll() {
    if (pop && pop.el.isConnected) return; // one is really lifted out right now
    pop = null;
    document.querySelectorAll('.sp-card[style*="visibility"]').forEach((c) => (c.style.visibility = ""));
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePop();
    }
  }


  // the cart changed somewhere else (a card below, the cart sheet, checkout): keep every copy's buttons right
  if (typeof Cart !== "undefined" && Cart.onChange) {
    Cart.onChange(() => {
      document.querySelectorAll(".sp-card[data-id]").forEach((card) => {
        const id = Number(card.dataset.id);
        patchQty(card, id, variantOf[id] || "variant1", false);
      });
    });
  }

  // ---- BUY IT AGAIN ----------------------------------------------------------------------------------
  // The products the signed-in customer has ordered most, as small cards (picture, name, Add button) that drift like the
  // Featured rows. Nobody signed in: one slim sign-in strip. Quiet by design:
  //  - the server keeps a small per-customer tally, updated one order at a time, and sends the customer's list (just product ids
  //    and sizes) over the live site stream - when the page connects and whenever it really changes - so the list is kept in this
  //    browser with its version and trusted until the server says otherwise (no timer); the old request (/api/customers/usuals)
  //    is only a fallback when the stream says nothing;
  //  - the products themselves come from the catalog the page already holds; only the ones it does not hold yet are fetched,
  //    in ONE request by id for all rows together - exactly like the Featured rows. A product that was hidden or deleted
  //    is simply left out, and its price and stock are always today's.
  const RO_ID = "reorder";
  const RO_TITLE = "Good Choices Deserve a Repeat!";
  const RO_LINE = "Get back to what you love with just one tap.";
  const RO_OUT_TITLE = "Your favorites are waiting!"; // what a visitor who is not signed in reads
  const RO_OUT_LINE = "Sign in to reorder.";
  const RO_MIN = 3; // the row shows only for a customer with at least this many different delivered products
  const RO_KEY = "freshcutz_usuals_v1";
  // v = the version the server gave the list held (so the live stream can say "still the same"); live = the live stream has
  // confirmed or sent the list on this connection; waitUntil = until then the page does not ask for the list itself, the live
  // stream is about to send it (see site-customize.js)
  const ro = { phone: null, items: null, raw: false, limit: 0, at: 0, stale: false, busy: false, failed: false, prod: [], v: "", live: false, refreshedFor: 0, sawServer: false, waitUntil: Date.now() + 4000 };
  const roComplete = (count) => !!ro.items && (ro.items.length < ro.limit || ro.limit >= count); // nothing more to ask for
  const roPhone = () => {
    try {
      return (window.ProfileSheet && window.ProfileSheet.getSavedPhone()) || "";
    } catch {
      return "";
    }
  };

  function roReset(phone) {
    ro.phone = phone;
    ro.items = null;
    ro.raw = false;
    ro.limit = 0;
    ro.at = 0;
    ro.stale = false;
    ro.failed = false;
    ro.v = "";
    ro.live = false;
    ro.refreshedFor = 0;
  }

  function roForget() {
    try {
      localStorage.removeItem(RO_KEY);
    } catch {
      /* ignore */
    }
    roReset(null); // the next draw starts again from the (new) phone number
  }

  /** What this browser kept of this customer's list (any age: the live stream says whether it is still right). */
  function roStored(phone) {
    try {
      const c = JSON.parse(localStorage.getItem(RO_KEY) || "null");
      return c && c.phone === phone && Array.isArray(c.items) ? c : null;
    } catch {
      return null;
    }
  }

  function roKeep(phone) {
    try {
      localStorage.setItem(RO_KEY, JSON.stringify({ phone, at: ro.at, limit: ro.limit, items: ro.items, prod: ro.prod || [], v: ro.v }));
    } catch {
      /* ignore */
    }
  }

  /** Starts this customer's state from what this browser kept (an old copy is fine when the live stream is there to check it). */
  function roLoad(phone) {
    roReset(phone);
    ro.prod = [];
    const c = roStored(phone);
    if (c && window.EventSource) { // (the live stream confirms it, or sends the right one, in a moment)
      if (Array.isArray(c.prod) && CatalogStore.adopt) CatalogStore.adopt(c.prod); // (the details that came with it)
      ro.items = c.items;
      ro.limit = c.limit || 0;
      ro.at = c.at;
      ro.v = typeof c.v === "string" ? c.v : "";
      ro.prod = Array.isArray(c.prod) ? c.prod : [];
    }
  }

  /** The live stream is about to tell this page the list (it just connected): until then the page does not ask for it
   * itself. If nothing comes, an old copy is asked for after all. */
  function roWaitFor(ms) {
    ro.waitUntil = Date.now() + ms;
    ro.live = false;
    setTimeout(() => {
      if (!roPhone() || ro.live) return;
      if (ro.items && !ro.sawServer) ro.stale = true; // (an older server that never speaks on the stream: ask for the list)
      if (ctx.grid) renderAll();
    }, ms + 100);
  }
  const roWaiting = () => !!window.EventSource && !ro.live && Date.now() < ro.waitUntil;
  setTimeout(() => (ro.live ? 0 : roWaitFor(0)), 4100); // (page just opened and the stream never said anything: ask for a list that is not fresh)

  /** Starts the one request this row needs (or reads the answer kept in this browser). */
  function roEnsure(phone, count) {
    if (ro.phone !== phone) roLoad(phone);
    if ((roComplete(count) && !ro.stale) || ro.failed || ro.busy || typeof Api === "undefined") return;
    // (asked again when the admin raised the number, or when the answer got old: see below)
    if (roWaiting()) return; // the live stream sends the list (or says it is unchanged) in a moment
    if (ro.sawServer && window.EventSource && window.FreshcutzStream && window.FreshcutzStream.phone === phone && ro.refreshedFor !== count) {
      // a number the stream was not asked for yet (the admin raised it, or switched the row on after this page connected): ask the
      // stream again - it answers with the list or "unchanged" - rather than making a request
      ro.refreshedFor = count;
      roWaitFor(3500);
      window.dispatchEvent(new Event("freshcutz:refresh"));
      return;
    }
    ro.busy = true;
    Promise.resolve(Api.get(roUrl(phone, count)))
      .then((answer) => {
        if (ro.phone !== phone) return; // signed out / another number meanwhile
        roAdopt(phone, count, roParse(answer));
      })
      .catch(() => {
        if (ro.phone !== phone) return;
        if (ro.items) ro.stale = false; // (what is shown stays; asked again later)
        else ro.failed = true; // no row now; asked again on the next visit
      })
      .finally(() => {
        ro.busy = false;
        if (ctx.grid) renderAll();
      });
  }

  /** The one request: the customer's products, plus the details of those the page does not hold yet (it says which it holds). */
  function roUrl(phone, count) {
    const have = (CatalogStore.pooled ? CatalogStore.pooled() : []).slice(0, 300).map((p) => p.id).join(",");
    return `/api/customers/usuals?phone=${encodeURIComponent(phone)}&limit=${count}&products=1${have ? `&have=${have}` : ""}`;
  }

  function roParse(answer) {
    const list = Array.isArray(answer) ? answer : (answer && answer.items) || []; // (an older server answers with just the list)
    return {
      items: (Array.isArray(list) ? list : [])
        .filter((x) => x && Number(x.id) > 0)
        .map((x) => ({ id: Number(x.id), v: x.v === "variant2" ? "variant2" : "variant1" })),
      prod: Array.isArray(answer) ? [] : (answer && answer.products) || [],
      v: !Array.isArray(answer) && answer && typeof answer.v === "string" ? answer.v : "",
    };
  }

  /** Keeps an answer: the details join the page's catalog, the list is held (and kept in this browser with its version). */
  function roAdopt(phone, count, r) {
    if (r.prod.length && CatalogStore.adopt) CatalogStore.adopt(r.prod);
    ro.phone = phone;
    ro.items = r.items;
    ro.prod = r.prod;
    ro.v = r.v || "";
    ro.raw = false;
    ro.limit = count;
    ro.at = Date.now();
    ro.stale = false;
    ro.failed = false;
    roKeep(phone);
  }

  const roSet = () => setsOf(cfg()).find((x) => x.kind === "reorder") || null;

  /** Signing in from the row: ONE request tells whether this number has ordered (the list itself comes back with it, so
   * nothing is asked again afterwards). true = yes, false = never ordered, null = could not ask. */
  let roPending = null; // a number being signed in from the row: the stream is asked for its list, which is the answer
  async function roCheck(phone) {
    if (ro.sawServer && window.EventSource && window.FreshcutzStream) {
      // over the live stream: reconnect it with this number (site-customize.js); the server answers with the list (or "unchanged")
      const answer = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (roPending && roPending.phone === phone) roPending = null;
          resolve(undefined);
        }, 4000);
        roPending = { phone, resolve: (found) => (clearTimeout(timer), resolve(found)) };
        window.dispatchEvent(new Event("freshcutz:who"));
      });
      if (answer !== undefined) return answer;
      window.dispatchEvent(new Event("freshcutz:who")); // (no answer: the stream goes back to the number that is signed in)
    }
    const s = roSet();
    const count = s ? s.count : 10;
    try {
      const r = roParse(await Api.get(roUrl(phone, count)));
      if (!r.items.length) {
        roEmpty = { phone, count, r };
        return false;
      }
      roAdopt(phone, count, r);
      return true;
    } catch {
      return null;
    }
  }

  // nothing to show for this number (never ordered, or every order cancelled): remembered so signing in costs no second request
  let roEmpty = null;
  window.BuyAgain = {
    check: roCheck,
    keepEmpty: (phone) => {
      if (roEmpty && roEmpty.phone === phone) roAdopt(phone, roEmpty.count, roEmpty.r); // signed in, and no row (the list is empty)
      roEmpty = null;
    },
    redraw: () => ctx.grid && renderAll(),
    // who this page is, for the live stream: the signed-in number and the version of the list held (site-customize.js adds them to the stream's address)
    who: () => {
      const phone = roPending ? roPending.phone : roPhone();
      if (!phone) return null;
      const c = ro.phone === phone ? null : roStored(phone);
      return { phone, v: ro.phone === phone ? ro.v : (c && typeof c.v === "string" && c.v) || "" };
    },
  };

  // The live stream (site-customize.js) sends this customer's list when it connects (or says it is unchanged) and again whenever an
  // order is placed, cancelled or reopened - and only when the list really is different. So no request is made for it.
  window.addEventListener("freshcutz:stream", () => {
    if (roPhone()) roWaitFor(3500); // just connected: the list (or "unchanged") follows
  });
  window.addEventListener("freshcutz:usuals", (e) => {
    const m = (e && e.detail) || {};
    ro.sawServer = true; // this server sends lists over the stream (even if the row is off right now)
    if (m.kind === "usoff") return;
    const pending = roPending && m.phone === roPending.phone ? roPending : null;
    const phone = pending ? pending.phone : roPhone();
    if (!phone || (m.phone && m.phone !== phone)) return;
    if (ro.phone !== phone) roLoad(phone);
    const n = Number(m.n) > 0 ? Number(m.n) : ro.limit;
    if (m.kind === "usame") {
      if (!(ro.items && ro.v && ro.v === m.v)) {
        ro.stale = true; // (what is held is not what the server means: ask for the list once)
        ro.waitUntil = 0;
        if (ctx.grid) renderAll();
        return;
      }
    } else {
      ro.items = roParse({ items: m.items }).items;
      ro.prod = [];
      ro.v = typeof m.v === "string" ? m.v : "";
      ro.raw = false;
      ro.failed = false;
    }
    ro.limit = n;
    ro.at = Date.now();
    ro.stale = false;
    ro.live = true;
    roKeep(phone);
    if (pending) {
      roPending = null; // signing in from the row: this is the answer (true = there is something to show)
      pending.resolve(ro.items.length > 0);
    }
    if (ctx.grid) renderAll();
  });

  /** The account page has just loaded ALL the customer's orders: the row is worked out from those very orders (the same rule as
   * the server's tally: only orders that are not cancelled, each product once per order, most orders first, then the most
   * recent), so what the row shows always agrees with the order list - and no request is made for it. */
  window.addEventListener("freshcutz:orders", (e) => {
    const d = (e && e.detail) || {};
    const s = roSet();
    if (!s || !d.phone || d.phone !== roPhone() || !Array.isArray(d.orders)) return;
    const tally = new Map();
    for (const o of d.orders) {
      if (!o || o.status !== "DELIVERED") continue; // only delivered orders count
      const at = Date.parse(o.createdAt) || 0;
      const once = new Map();
      for (const it of o.items || []) if (Number(it.productId) > 0) once.set(Number(it.productId), it.variant === "variant2" ? "variant2" : "variant1");
      once.forEach((v, id) => {
        const t = tally.get(id) || { id, times: 0, at: -1, v: "variant1" };
        t.times++;
        if (at >= t.at) {
          t.at = at;
          t.v = v;
        }
        tally.set(id, t);
      });
    }
    const list = [...tally.values()].sort((a, b) => b.times - a.times || b.at - a.at || b.id - a.id).map((t) => ({ id: t.id, v: t.v }));
    ro.phone = d.phone;
    ro.items = list.slice(0, s.count + 30); // (a few spare: some may be hidden products - checked when drawn)
    ro.v = ""; // (worked out here, not the server's list: it has no version)
    ro.raw = true;
    ro.limit = s.count;
    ro.at = Date.now();
    ro.stale = false;
    ro.failed = false;
    try {
      localStorage.removeItem(RO_KEY); // (the next visit asks the server again)
    } catch {
      /* ignore */
    }
    if (ctx.grid) renderAll();
  });

  /** The "Buy it again" set as the row draws it: which state it is in, and its products. */
  function roPrepare(s, wanted) {
    if (s.kind !== "reorder") return s;
    const phone = roPhone();
    if (!phone) return { ...s, state: s.guests && wanted ? "signin" : "none", productIds: [] };
    if (!wanted) return { ...s, state: "none", productIds: [] };
    roEnsure(phone, s.count);
    if (!ro.items) return { ...s, state: ro.failed ? "none" : "loading", productIds: [] };
    // fewer than 3 different delivered products would look empty: no row at all (the server sends nothing then; this also covers a list worked out here)
    if (ro.items.length < RO_MIN) return { ...s, state: "none", productIds: [] };
    // The customer's own most-ordered products (the admin may have lowered the number: nothing to ask for then) ...
    const pins = (s.pins || []).filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i).sort((a, b) => a.pos - b.pos).slice(0, s.count);
    const pinned = new Set(pins.map((p) => p.id));
    let items = ro.items.filter((it) => !pinned.has(it.id));
    if (ro.raw) {
      // worked out from the order list (not checked by the server): products that are hidden or deleted are skipped here; the
      // ones the page does not know yet are looked up with the others (the list holds a few spare for that)
      const need = s.count - pins.length;
      const keep = [];
      let unknown = 0;
      for (const it of items) {
        if (keep.length >= need) break;
        if (CatalogStore.getProduct(it.id)) keep.push(it);
        else if (!asked.has(it.id) && keep.length + unknown < need) {
          keep.push(it);
          unknown++;
        }
      }
      items = keep;
      if (keep.length + pins.filter((p) => ro.items.some((it) => it.id === p.id)).length < RO_MIN) return { ...s, state: "none", productIds: [] };
    } else {
      items = items.slice(0, s.count - pins.length);
    }
    items.forEach((it) => {
      // each card opens on the size the customer chose last time (only when the product really has it)
      const p = CatalogStore.getProduct(it.id);
      if (p && variantOf[it.id] === undefined && it.v === "variant2" && p.variant2Price) variantOf[it.id] = "variant2";
    });
    // ... with the products the admin fixed placed at their numbers in between (a number past the end simply goes last).
    // Only reached for a customer who has ordered something (an empty list above ends in "none"), so the fixed products never
    // appear on their own.
    const ids = items.map((it) => it.id);
    let last = 0;
    pins.forEach((p) => {
      const at = Math.min(Math.max(p.pos, last + 1) - 1, ids.length);
      ids.splice(at, 0, p.id);
      last = at + 1;
    });
    return { ...s, state: "ready", productIds: ids };
  }

  const RO_BAG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M9.5 13.5l1.7 1.7 3.3-3.4"/></svg>';
  function roSignInHtml() {
    return `
      <div class="ro-signin">
        <span class="ro-sign-ico">${RO_BAG}</span>
        <span class="ro-sign-txt"><b class="ro-sign-title">${esc(RO_OUT_TITLE)}</b><span class="ro-sign-line">${esc(RO_OUT_LINE)}</span></span>
        <button type="button" class="ro-sign-btn" data-sp="ro-login">Sign in</button>
      </div>`;
  }

  // signed in / out, or an order was placed (profile.js tells us). The same customer (an order was just placed): the live stream
  // sends the new list when it changed - nothing is asked for. Another customer (or none): forget what was kept and draw again.
  window.addEventListener("freshcutz:profile", () => {
    const phone = roPhone();
    if (phone && ro.phone === phone && window.EventSource) {
      if (ctx.grid) renderAll();
      return;
    }
    roForget();
    if (phone) roWaitFor(3500); // (the stream reconnects with this number and sends the list)
    if (ctx.grid) renderAll();
  });

  // ---- the rows on the page -------------------------------------------------------------------------
  /** Fetches the products this page does not hold yet: ONE request for all rows together. */
  function ensure(ids) {
    const missing = ids.filter((id) => !CatalogStore.getProduct(id) && !asked.has(id));
    if (!missing.length || loading) return;
    loading = true;
    missing.forEach((id) => asked.add(id));
    Promise.resolve(CatalogStore.ensure(missing))
      .catch(() => missing.forEach((id) => asked.delete(id))) // offline: try again next time
      .finally(() => {
        loading = false;
        renderAll();
      });
  }

  const isBelowRow = (c) => c.classList.contains("sp") && c.dataset.below === "1";
  const isTopRow = (c) => c.classList.contains("sp") && c.dataset.below !== "1";
  const isCard = (c) => c.classList.contains("product-card") && c.dataset.id;
  const cardsBefore = (grid, el) => {
    let n = 0;
    for (const c of grid.children) {
      if (c === el) break;
      if (isCard(c)) n++;
    }
    return n;
  };

  function renderAll() {
    const raw = setsOf(cfg());
    const showRaw = (s) => !ctx.hidden && shownIn(s.showIn, ctx.category);
    const sets = raw.map((s) => roPrepare(s, showRaw(s))); // "Buy it again" gets its state and the customer's products here
    const keep = new Set(sets.map((s) => s.id));
    for (const [id, row] of rows) {
      if (!keep.has(id)) {
        row.destroy();
        rows.delete(id);
      }
    }
    const show = (s) => !ctx.hidden && shownIn(s.showIn, ctx.category);
    ensure([...new Set(sets.filter(show).flatMap((s) => s.productIds))]);
    unhideAll();
    const live = [];
    sets.forEach((s) => {
      let row = rows.get(s.id);
      if (!row) {
        row = makeRow(s.id);
        rows.set(s.id, row);
      }
      if (row.render(s, show(s))) live.push(row);
    });
    place(live);
  }

  /** Puts each row at its Position among the product cards (the same rule as the banners), or takes it off the page. */
  function place(live) {
    const grid = ctx.grid;
    if (!grid) return;
    rows.forEach((r) => {
      if (!live.includes(r) && r.el.isConnected) r.el.remove();
    });
    const cards = [...grid.children].filter(isCard);
    live.forEach((row) => {
      const after = row.set.place - 1; // products above this row
      if (after > 0 && cards.length <= after && !ctx.finished) {
        // not enough cards yet - wait for more to load
        if (row.el.isConnected) row.el.remove();
        row.hide();
        return;
      }
      const wanted = Math.min(after, cards.length);
      const below = row.set.bannerFirst;
      if (below) row.el.dataset.below = "1";
      else row.el.removeAttribute("data-below");
      // What sits at one place, top to bottom: Featured rows meant to be on top, then the banners, then Featured rows meant
      // to be below the banners, then the next product card.
      let ref;
      let right;
      if (!below) {
        ref = wanted === 0 ? grid.firstElementChild : cards[wanted - 1].nextElementSibling; // right after the card above...
        while (ref && isTopRow(ref)) ref = ref.nextElementSibling; // ...past the other "on top" rows
        let p = row.el.previousElementSibling;
        while (p && isTopRow(p)) p = p.previousElementSibling;
        let n = row.el.nextElementSibling;
        while (n && isTopRow(n)) n = n.nextElementSibling;
        right = row.el.parentNode === grid && (wanted === 0 ? p === null : p === cards[wanted - 1]) && n === ref;
      } else {
        ref = wanted < cards.length ? cards[wanted] : null; // right before the card below (the banners are before these rows)
        let n = row.el.nextElementSibling;
        while (n && isBelowRow(n)) n = n.nextElementSibling;
        right = row.el.parentNode === grid && cardsBefore(grid, row.el) === wanted && n === ref;
      }
      if (!right) {
        grid.insertBefore(row.el, ref);
        row.reattached();
      }
      if (row.needsStart && row.el.isConnected) {
        row.needsStart = false;
        row.startLoop(); // measured now that the row is really on the page
      }
    });
    // on wide screens a full-row panel can leave a gap in the row above it; "dense" lets the next products fill it
    grid.classList.toggle("has-sp", [...rows.values()].some((r) => r.el.parentNode === grid));
  }

  /** storefront.js tells the rows what the customer is looking at: { grid, hidden, finished, category }. */
  function update(next) {
    ctx = { ...ctx, ...next };
    renderAll();
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => rows.forEach((r) => r.restart()), 250);
  });
  document.addEventListener("freshcutz:site", () => {
    if (ctx.grid) renderAll(); // the admin changed the rows / "animations off" may have changed
    rows.forEach((r) => r.restart());
  });

  // the "View all" sheet, and the card lifted out of it: taps are handled here
  let sheetWired = false;
  function wireSheet() {
    if (sheetWired) return;
    const sheet = document.getElementById("sheetRoot");
    if (!sheet) return;
    sheetWired = true;
    sheet.addEventListener("click", (e) => {
      if (!e.target.closest("[data-sp-list],[data-sp-pop],[data-ro-sheet]")) return;
      const list = e.target.closest("[data-sp-list]");
      onClick(e, list ? rows.get(list.dataset.spRow) : pop && pop.owner);
    });
  }
  document.addEventListener("DOMContentLoaded", wireSheet);
  wireSheet();

  // a product card of the page grid (compact view): a tap lifts it out as the big card, like a card of "View all"
  return { place: update, update, openCard: (el) => openPop(el, null) };
})();
