/* Storefront: draws the category chips + product cards and wires up add-to-cart / quantity controls via
 * event delegation. The data itself (small pages of products, the product pool, live updates) lives in
 * storefront-sync.js (CatalogStore); this file asks it for "the products of the tab I'm on" and shows them,
 * 12 at a time, adding more as the customer scrolls near the end.
 * Cards animate in as they scroll into view (IntersectionObserver).
 *
 * IMPORTANT: interactions (variant toggle, +/-, add) patch the existing
 * card DOM in place instead of re-rendering it. Replacing a card's HTML
 * on every click is what caused the visible "flash" — the browser has to
 * reload the image and the entrance animation plays again. Patching just
 * the text/classes that changed keeps it instant and flicker-free. */

(() => {
  const PAGE = 12; // cards added each time the customer scrolls near the end
  let activeCategory = "All";
  let shown = PAGE; // how many cards the current view should have (grows by 12 as the customer scrolls)
  let drawn = 0; // how many cards are actually on the page right now
  const shownByTab = {}; // tab -> how many cards it had, so coming back to a tab restores it
  let ready = false; // the first catalog answer has been drawn
  const cardVariant = {}; // productId -> "variant1" | "variant2"

  const grid = document.getElementById("productGrid");
  const emptyState = document.getElementById("emptyState");
  const categoryScroll = document.getElementById("categoryScroll");
  const whatsappLink = document.getElementById("whatsappLink");
  const searchInput = document.getElementById("searchInput");
  const searchClearX = document.getElementById("searchClearX");
  let searchTerm = ""; // trimmed, lowercased comparisons happen in matchesSearch()

  /* Low threshold + a positive bottom rootMargin means a card starts
   * animating in while it's still just below the viewport, instead of
   * needing to be scrolled substantially into view first. */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.01, rootMargin: "0px 0px 200px 0px" }
  );

  /* Safety net for phones: during a very fast flick the browser can skip telling the observer about a card, which would
   * leave an empty card-sized hole. When scrolling pauses, any card on screen that is still not shown is shown now.
   * (Cost: nothing while scrolling; one tiny check after it stops.) */
  let sweepTimer = 0;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(sweepTimer);
      sweepTimer = setTimeout(() => {
        const bottom = window.innerHeight + 200;
        for (const el of document.querySelectorAll("#productGrid .product-card:not(.is-visible)")) {
          const r = el.getBoundingClientRect();
          if (r.top > bottom) break; // the cards are in order: the rest are further down
          if (r.bottom > -200) el.classList.add("is-visible");
        }
      }, 150);
    },
    { passive: true }
  );

  function init() {
    const phone = (window.FRESHCUTZ_WHATSAPP || "").replace(/\D/g, "");
    // An admin-set number (see site-customize.js) wins over the config.js default.
    if (!whatsappLink.dataset.custom) whatsappLink.href = `https://wa.me/${phone}`;
    Cart.onChange(syncAllCardQuantities);
    Cart.onChange(updateCartBadges);
    // The first screen (category tabs + the first 12 products of the default tab) is already being fetched by
    // storefront-sync.js — one request. Show loading placeholders until it arrives.
    grid.innerHTML = skeletonCards(3);
    updateCartBadges();
    initInfiniteScroll();
    CatalogStore.bindUi({ current, refreshed });
    CatalogStore.ready.then(({ category }) => {
      // the admin's default tab; the plain "All" tab when the category bar is switched off
      activeCategory = category && SiteCustomize.on("showCategories") ? category : "All";
      shown = shownByTab[activeCategory] || PAGE;
      ready = true;
      renderCategories();
      renderGrid();
      pump();
    });
  }


  function skeletonCards(n) {
    return Array.from({ length: n })
      .map(
        () => `<div class="product-card is-visible"><div class="product-media"><div class="product-media-frame skeleton"></div></div>
          <div class="product-body">
            <div class="skeleton" style="height:16px;border-radius:6px;width:70%;"></div>
            <div class="skeleton" style="height:14px;border-radius:6px;"></div>
            <div class="skeleton" style="height:24px;border-radius:6px;width:40%;"></div>
          </div></div>`
      )
      .join("");
  }

  function renderCategories() {
    const cats = ["All", ...CatalogStore.tabs().map((t) => t.name)];
    categoryScroll.innerHTML = cats
      .map(
        (c) =>
          `<button class="cat-chip ${c === activeCategory ? "active" : ""}" data-cat="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</button>`
      )
      .join("");
  }

  function matchesSearch(p) {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q)
    );
  }

  /** What the current view lists: the tab's products that are held (no gaps), narrowed by the search words. */
  function currentList() {
    const list = CatalogStore.run(activeCategory);
    return searchTerm ? list.filter(matchesSearch) : list;
  }

  /** Is there more to show for this view — in memory, or still to download? */
  function moreAvailable(list) {
    if (shown < list.length) return true;
    return !searchTerm && list.length < CatalogStore.count(activeCategory);
  }

  function renderGrid() {
    const list = currentList();
    const slice = list.slice(0, shown);
    const waiting = slice.length === 0 && moreAvailable(list); // nothing to draw yet, but more is on its way
    emptyState.hidden = slice.length > 0 || waiting || !ready;
    emptyState.querySelector("p").textContent = searchTerm
      ? SiteCustomize.t("noSearchResultsText")
      : SiteCustomize.t("emptyProductsText");
    grid.innerHTML = waiting || !ready ? skeletonCards(3) : slice.map((p, i) => renderCard(p, i)).join("");
    drawn = waiting || !ready ? 0 : slice.length;
    grid.querySelectorAll(".product-card").forEach((el) => revealObserver.observe(el));
    setRetry(false);
    placeBanners();
  }

  /** Puts the admin's sliding banners among the cards (see site-banners.js): hidden while searching or loading,
   * and a banner meant for further down than the products drawn so far waits until enough cards are there. */
  function placeBanners() {
    const list = currentList();
    // the Featured Products rows among the products (see site-specials.js): same rules as the banners
    if (window.SiteSpecials) {
      SiteSpecials.place({
        grid,
        hidden: !ready || !!searchTerm,
        category: activeCategory,
        finished: drawn >= list.length && !moreAvailable(list),
      });
    }
    if (!window.SiteBanners) return;
    SiteBanners.place({
      grid,
      hidden: !ready || !!searchTerm,
      category: activeCategory,
      finished: drawn >= list.length && !moreAvailable(list),
    });
  }

  /** Adds cards to the end of the grid without touching the ones already there (no flash, scroll stays put). */
  function appendCards(items, startIndex) {
    if (!items.length) return;
    const before = grid.children.length;
    grid.insertAdjacentHTML("beforeend", items.map((p, i) => renderCard(p, startIndex + i)).join(""));
    [...grid.children].slice(before).forEach((el) => revealObserver.observe(el));
    drawn += items.length;
    placeBanners();
  }

  // ---- loading more as the customer scrolls -----------------------------------------------

  const sentinel = document.createElement("div"); // sits right after the grid; reaching it = "load more"
  sentinel.id = "gridSentinel";
  sentinel.style.cssText = "height:1px;";
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.hidden = true;
  retryBtn.textContent = "Couldn't load more — tap to retry";
  retryBtn.style.cssText = "display:block;margin:12px auto;padding:10px 16px;border:0;border-radius:999px;background:var(--bg-soft,rgba(0,0,0,.08));color:inherit;font:inherit;cursor:pointer;";
  grid.after(sentinel);
  sentinel.after(retryBtn);

  let loading = false;
  let busyKey = ""; // which view the running download is for

  function setRetry(on) {
    retryBtn.hidden = !on;
  }

  /** Shows the next cards of the current view. Returns how many were added. Cards already downloaded are just
   * revealed; only when they run out is the next small page asked for (only the missing products). */
  async function showMore() {
    if (loading || !ready) return 0;
    const key = activeCategory + "|" + searchTerm;
    let list = currentList();
    if (drawn >= list.length) {
      if (searchTerm || list.length >= CatalogStore.count(activeCategory)) return 0; // nothing more anywhere
      loading = true;
      busyKey = key;
      const before = grid.children.length;
      grid.insertAdjacentHTML("beforeend", skeletonCards(2));
      [...grid.children].slice(before).forEach((el) => el.classList.add("skel-more"));
      let got = 0;
      try {
        got = await CatalogStore.loadMore(activeCategory);
        setRetry(false);
      } catch {
        setRetry(true);
      } finally {
        grid.querySelectorAll(".skel-more").forEach((el) => el.remove());
        loading = false;
      }
      if (key !== busyKey || key !== activeCategory + "|" + searchTerm) {
        pump(); // the customer moved to another tab meanwhile: this download was for the old one, so look again
        return 0;
      }
      if (!got) return 0;
      list = currentList();
    }
    const from = drawn;
    const to = Math.min(list.length, drawn + PAGE);
    if (to <= from) return 0;
    const wasEmptyGrid = drawn === 0;
    shown = Math.max(shown, to);
    if (!searchTerm) shownByTab[activeCategory] = shown;
    if (wasEmptyGrid) renderGrid(); // replaces the loading placeholders
    else appendCards(list.slice(from, to), from);
    return to - from;
  }

  /** Keeps loading while the end of the grid is close to the screen (a short first page, or a big screen). */
  async function pump(force = false) {
    for (let i = 0; i < 20; i++) {
      // nothing real drawn yet (just placeholders) = load whatever the position; otherwise only when the end is near
      const nothingDrawn = !grid.querySelector(".product-card[data-id]");
      // a tab that holds fewer than one page of cards so far (some were already downloaded for another tab) gets
      // topped up to a full page right away, wherever the end of the grid is
      const shortPage = force && drawn < PAGE && !searchTerm && moreAvailable(currentList());
      if (!nothingDrawn && !shortPage && sentinel.getBoundingClientRect().top > window.innerHeight + 700) return;
      if (!(await showMore())) {
        placeBanners(); // nothing more to come: a banner meant for further down than the last card goes at the end
        return;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  function initInfiniteScroll() {
    new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) pump();
      },
      { rootMargin: "0px 0px 700px 0px" }
    ).observe(sentinel);
    retryBtn.addEventListener("click", () => {
      setRetry(false);
      pump();
    });
  }

  // ---- live updates (storefront-sync.js calls these) -----------------------------------------------

  /** What the customer is looking at, so a refresh knows how much to read again. */
  function current() {
    return { category: activeCategory, shown: searchTerm ? PAGE : shown, full: !!searchTerm };
  }

  /** The catalog changed and the data was read again: update the page in place (no flash when the same
   * products are still there; otherwise redraw). */
  function refreshed({ category }) {
    if (category !== activeCategory) {
      activeCategory = category; // the tab the customer was on is gone
      shown = shownByTab[category] || PAGE;
    }
    renderCategories();
    if (!ready) return;
    const list = currentList().slice(0, shown);
    const domIds = [...grid.querySelectorAll(".product-card[data-id]")].map((c) => Number(c.dataset.id));
    const same = list.length === domIds.length && list.every((p, i) => p.id === domIds[i]);
    if (same) {
      list.forEach((p) => {
        const card = grid.querySelector(`.product-card[data-id="${p.id}"]`);
        if (card) patchCardContent(card, p);
      });
      placeBanners();
    } else {
      renderGrid();
    }
    pump();
  }

  /** Updates one card's name/description/image/price/discount to match a freshly-read product, without touching
   * anything else about the card (its scroll position, reveal state, or qty stepper). */
  function patchCardContent(card, product) {
    const nameEl = card.querySelector(".product-name");
    if (nameEl) nameEl.textContent = product.name;
    const descEl = card.querySelector(".product-desc");
    if (descEl) descEl.textContent = product.description || "";
    const img = card.querySelector(".product-media-frame img");
    const resolved = Utils.mediumImageUrl(product.imageUrl);
    if (img && img.getAttribute("src") !== resolved) img.src = resolved;
    patchVariantUI(card, product, cardVariant[product.id] || "variant1");

    card.classList.toggle("out-of-stock", !!product.outOfStock);
    const stockBadge = card.querySelector(".out-of-stock-badge");
    if (stockBadge) stockBadge.hidden = !product.outOfStock;
    const footer = card.querySelector(".product-footer");
    if (footer) footer.innerHTML = footerHtml(product, cardVariant[product.id] || "variant1");
  }

  /** The Add/qty-stepper controls, or a disabled "Out of Stock" label in
   * their place — kept separate from renderCard so a poll picking up a
   * stock change can just swap this one piece (see storefront-sync.js). */
  function footerHtml(p, variant) {
    if (p.outOfStock) {
      return `<button class="add-btn out-of-stock-btn" disabled>${Utils.escapeHtml(SiteCustomize.t("outOfStockText"))}</button>`;
    }
    const qty = Cart.quantityOf(p.id, variant);
    return `
      <button class="add-btn ${qty > 0 ? "hide" : ""}" data-action="add">${Utils.escapeHtml(SiteCustomize.t("addToCartText"))}</button>
      <div class="qty-stepper ${qty > 0 ? "show" : ""}">
        <button data-action="dec" aria-label="Decrease">−</button>
        <span class="qty-value">${qty}</span>
        <button data-action="inc" aria-label="Increase">+</button>
      </div>`;
  }

  function renderCard(p, index) {
    const variant = cardVariant[p.id] || "variant1";
    const hasVariant2 = !!p.variant2Label;
    const price = variant === "variant2" ? p.variant2Price : p.variant1Price;
    const mrp = variant === "variant2" ? p.variant2Mrp : p.variant1Mrp;
    const discount = Utils.discountPercent(price, mrp);
    const img = Utils.mediumImageUrl(p.imageUrl); // the ~25 KB card-size photo, not the full-size original

    return `
    <div class="product-card ${p.outOfStock ? "out-of-stock" : ""}" data-id="${p.id}" style="--i:${index % 8}">
      <div class="product-media">
        <div class="product-media-frame">
          <img src="${img}" alt="${Utils.escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0" />
          <span class="discount-badge" ${discount > 0 && !p.outOfStock ? "" : "hidden"}>${discount}% OFF</span>
          <span class="out-of-stock-badge" ${p.outOfStock ? "" : "hidden"}>${Utils.escapeHtml(SiteCustomize.t("outOfStockText"))}</span>
        </div>
      </div>
      <div class="product-body">
        <div class="product-text">
          <div class="product-name">${Utils.escapeHtml(p.name)}</div>
          <div class="product-desc">${Utils.escapeHtml(p.description || "")}</div>
        </div>
        ${hasVariant2 ? `
        <div class="variant-toggle" data-role="variant-toggle">
          <button data-action="variant" data-variant="variant1" class="${variant === "variant1" ? "active" : ""}">${Utils.escapeHtml(p.variant1Label)}</button>
          <button data-action="variant" data-variant="variant2" class="${variant === "variant2" ? "active" : ""}">${Utils.escapeHtml(p.variant2Label)}</button>
        </div>` : `<div class="variant-toggle"><button class="active" disabled>${Utils.escapeHtml(p.variant1Label)}</button></div>`}
        <div class="price-row">
          <span class="price-now" data-role="price-now">${Utils.formatMoney(price)}</span>
          <span class="price-mrp" data-role="price-mrp" ${discount > 0 ? "" : "hidden"}>${Utils.formatMoney(mrp)}</span>
        </div>
        <div class="product-footer">${footerHtml(p, variant)}</div>
      </div>
    </div>`;
  }

  /** Re-renders only the price/discount bits of a card after a variant switch. */
  function patchVariantUI(card, product, variant) {
    const price = variant === "variant2" ? product.variant2Price : product.variant1Price;
    const mrp = variant === "variant2" ? product.variant2Mrp : product.variant1Mrp;
    const discount = Utils.discountPercent(price, mrp);

    card.querySelectorAll('[data-action="variant"]').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.variant === variant);
    });
    card.querySelector('[data-role="price-now"]').textContent = Utils.formatMoney(price);
    card.querySelector('[data-role="price-mrp"]').textContent = Utils.formatMoney(mrp);
    card.querySelector('[data-role="price-mrp"]').hidden = discount <= 0;
    const badge = card.querySelector(".discount-badge");
    badge.textContent = `${discount}% OFF`;
    badge.hidden = discount <= 0 || product.outOfStock;
  }

  /** Updates just the Add button / qty stepper of one card. A no-op for an
   *  out-of-stock card — its footer is just a disabled label, no stepper to
   *  patch — which matters beyond this one card: this runs inside a
   *  Cart.onChange loop over every card, and throwing on a missing element
   *  here used to abort that loop partway through, silently skipping the
   *  cart-bar badge update that's registered right after it. */
  function patchQtyUI(card, productId, variant, pulse) {
    const qty = Cart.quantityOf(productId, variant);
    const addBtn = card.querySelector(".add-btn");
    const stepper = card.querySelector(".qty-stepper");
    const qtyValue = card.querySelector(".qty-value");
    if (!addBtn || !stepper || !qtyValue) return;
    addBtn.classList.toggle("hide", qty > 0);
    stepper.classList.toggle("show", qty > 0);
    if (qtyValue.textContent !== String(qty)) {
      qtyValue.textContent = qty;
      if (pulse) {
        qtyValue.classList.remove("pulse");
        // eslint-disable-next-line no-unused-expressions
        qtyValue.offsetWidth; // restart the animation
        qtyValue.classList.add("pulse");
      }
    }
  }

  /** Keeps every card's qty controls in sync with the cart (checkout,
   *  "Clear cart", or edits made from inside the cart sheet all change
   *  the cart without touching a card directly). */
  function syncAllCardQuantities() {
    document.querySelectorAll(".product-card[data-id]").forEach((card) => {
      const productId = Number(card.dataset.id);
      const variant = cardVariant[productId] || "variant1";
      patchQtyUI(card, productId, variant, false);
    });
  }

  categoryScroll.addEventListener("click", (e) => {
    const chip = e.target.closest(".cat-chip");
    if (!chip) return;
    activeCategory = chip.dataset.cat;
    shown = searchTerm ? PAGE : shownByTab[activeCategory] || PAGE;
    renderCategories();
    if (searchTerm && !CatalogStore.tabComplete(activeCategory)) {
      searchThenRender(); // searching in this tab: it needs all of its products first
      return;
    }
    renderGrid();
    pump(true); // a tab that holds only a few of its products so far fetches the missing ones
  });

  let searchSeq = 0;

  /** Search looks inside the tab being viewed, so that tab must be held in full first. A small tab that is already
   * downloaded costs nothing; otherwise only its missing products are downloaded (the whole list for "All"). */
  async function searchThenRender() {
    const seq = ++searchSeq;
    const tab = activeCategory;
    emptyState.hidden = true;
    grid.innerHTML = skeletonCards(3);
    drawn = 0;
    try {
      await CatalogStore.loadTab(tab);
    } catch {
      if (seq === searchSeq) window.Storefront.showLoadError("Couldn't load the search — please check your connection.");
      return;
    }
    if (seq !== searchSeq) return; // a newer search or tab change took over
    renderCategories(); // the tabs may have been re-worked out from a fresh copy
    renderGrid();
    pump();
  }

  // The list is normally already on the phone, and then searching is instant for any length. Only when the tab's
  // products are NOT all held yet does a search need a download — that waits for a second letter, so a single
  // accidental tap on the keyboard never downloads anything.
  const MIN_LETTERS_TO_DOWNLOAD = 2;

  const applySearchTerm = Utils.debounce(async () => {
    const typed = searchInput.value.trim();
    if (typed && typed.length < MIN_LETTERS_TO_DOWNLOAD && !CatalogStore.tabComplete(activeCategory)) return;
    searchTerm = typed;
    shown = searchTerm ? PAGE : shownByTab[activeCategory] || PAGE;
    if (searchTerm && !CatalogStore.tabComplete(activeCategory)) {
      await searchThenRender();
      return;
    }
    searchSeq++;
    renderGrid();
    pump();
  }, 200);

  // (Tapping the search box downloads nothing: the list is already held, or it is fetched once the customer types.)

  searchInput.addEventListener("input", () => {
    searchClearX.hidden = !searchInput.value;
    applySearchTerm();
  });

  searchClearX.addEventListener("click", () => {
    searchInput.value = "";
    searchClearX.hidden = true;
    searchTerm = "";
    searchSeq++;
    shown = shownByTab[activeCategory] || PAGE;
    renderGrid();
    pump();
    // Blur rather than refocus — clearing shouldn't leave the cursor
    // blinking/keyboard up; typing again means tapping the box on purpose.
    searchInput.blur();
  });

  /** Taps on a product card: the ones in the grid, and the one in the sheet a banner opens. */
  function onCardClick(e) {
    const card = e.target.closest(".product-card");
    if (!card) return;
    const productId = Number(card.dataset.id);
    const product = CatalogStore.getProduct(productId);
    if (!product) return;

    const variantBtn = e.target.closest('[data-action="variant"]');
    const addBtn = e.target.closest('[data-action="add"]');
    const incBtn = e.target.closest('[data-action="inc"]');
    const decBtn = e.target.closest('[data-action="dec"]');

    if (variantBtn) {
      cardVariant[productId] = variantBtn.dataset.variant;
      patchVariantUI(card, product, cardVariant[productId]);
      patchQtyUI(card, productId, cardVariant[productId], false);
    } else if (addBtn) {
      const variant = cardVariant[productId] || "variant1";
      const fromRect = addBtn.getBoundingClientRect(); // before the button hides itself
      Cart.setQuantity(product, variant, 1);
      patchQtyUI(card, productId, variant, true);
      Toast.msg("addedToCart", { name: product.name });
      if (window.CartFx) CartFx.fly(fromRect, card);
    } else if (incBtn) {
      const variant = cardVariant[productId] || "variant1";
      const fromRect = incBtn.getBoundingClientRect();
      Cart.setQuantity(product, variant, Cart.quantityOf(productId, variant) + 1);
      patchQtyUI(card, productId, variant, true);
      if (window.CartFx) CartFx.fly(fromRect, card);
    } else if (decBtn) {
      const variant = cardVariant[productId] || "variant1";
      if (window.CartFx) CartFx.back(decBtn.getBoundingClientRect(), card); // (before the change: the cart bar is still showing)
      Cart.setQuantity(product, variant, Cart.quantityOf(productId, variant) - 1);
      patchQtyUI(card, productId, variant, true);
    } else if (isCompactPhone() && grid.contains(card) && !e.target.closest(".product-footer, .variant-toggle") && window.SiteSpecials && SiteSpecials.openCard) {
      SiteSpecials.openCard(card); // compact view: a tap on the panel opens the big card with every detail (same as "View all")
    }
  }

  /** Phones with the compact two-per-row view switched on (see the view toggle below). */
  function isCompactPhone() {
    return grid.classList.contains("pg-compact") && !!window.matchMedia && window.matchMedia("(max-width: 619px)").matches;
  }
  // ---- view toggle (phones): compact 2-per-row cards <-> the big one-per-row panels ------------------------------
  // css/storefront-compact.css does the looks; this remembers the choice and draws the little button by the search box.
  (function viewToggle() {
    const wrap = document.getElementById("searchWrap");
    if (!wrap) return;
    // what the admin chose in Customize (Shop page): the default view, and whether customers get the switch at all
    const adminDefault = () => !window.SiteCustomize || SiteCustomize.on("compactItemCards");
    const switchShown = () => !window.SiteCustomize || SiteCustomize.on("showViewSwitch");
    const saved = () => {
      try {
        return localStorage.getItem("fc-grid-view");
      } catch {
        return null; // private mode: just use the default
      }
    };
    let compact = adminDefault();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-toggle";
    btn.innerHTML =
      '<svg class="vt-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>' +
      '<svg class="vt-big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="7" rx="1.5"/></svg>';
    const apply = () => {
      grid.classList.toggle("pg-compact", compact);
      btn.classList.toggle("is-compact", compact);
      btn.setAttribute("aria-label", compact ? "Show big item panels" : "Show compact items, two per row");
      btn.title = btn.getAttribute("aria-label");
      scheduleAlign();
    };
    // the admin's settings decide; a customer's own pick counts only while the switch is shown to them
    const refresh = () => {
      const shown = switchShown();
      const mine = shown ? saved() : null;
      compact = mine ? mine !== "big" : adminDefault();
      btn.hidden = !shown;
      apply();
    };
    btn.addEventListener("click", () => {
      compact = !compact;
      try {
        localStorage.setItem("fc-grid-view", compact ? "compact" : "big");
      } catch {
        /* not saved, still works */
      }
      apply();
    });
    document.addEventListener("freshcutz:site", refresh); // the settings arrived / the admin changed them
    // The two panels of a row get the same text height (the longer of the two), so their sizes / price / Add button sit in one line
    // without reserving room that is not needed.
    function alignText() {
      const cards = Array.from(grid.querySelectorAll(".product-card"));
      cards.forEach((c) => {
        const t = c.querySelector(".product-text");
        if (t) t.style.minHeight = "";
      });
      if (!isCompactPhone()) return;
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
    }
    let alignRaf = 0;
    const scheduleAlign = () => {
      cancelAnimationFrame(alignRaf);
      alignRaf = requestAnimationFrame(alignText);
    };
    if (window.MutationObserver) new MutationObserver(scheduleAlign).observe(grid, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", scheduleAlign);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleAlign);
    wrap.classList.add("has-vt");
    wrap.appendChild(btn);
    refresh();
  })();

  grid.addEventListener("click", onCardClick);
  document.getElementById("sheetRoot").addEventListener("click", onCardClick);

  /** A sliding banner was tapped: show that item (photo, price, variants, Add to cart) in a sheet. */
  async function openItem(id) {
    try {
      await CatalogStore.ensure([id]);
    } catch {
      Toast.show("Couldn't load that item - please check your connection.", "error");
      return;
    }
    const product = CatalogStore.getProduct(id);
    if (!product) {
      Toast.show("Sorry, that item isn't available right now.", "info");
      return;
    }
    CheckoutSheet.renderSheet(
      `<div class="sheet-body"><div class="item-sheet">${renderCard(product, 0).replace('class="product-card ', 'class="product-card is-visible ')}</div></div>`,
      Utils.escapeHtml(product.name)
    );
  }

  function updateCartBadges() {
    // The header used to also carry a cart-count badge next to a cart
    // icon; that icon's gone now (see profile.js) since the bottom
    // cart-bar below already appears the moment something's added, so
    // this only needs to keep that bar's own count/total in sync.
    const count = Cart.getLineCount(); // distinct items in the cart, not total quantity
    const total = Cart.getTotal();
    const barEl = document.getElementById("cartBar");
    barEl.classList.toggle("show", count > 0);
  document.documentElement.classList.toggle("has-cart-bar", count > 0);
    document.getElementById("cartBarCount").textContent = `${count} item${count === 1 ? "" : "s"}`;
    document.getElementById("cartBarTotal").textContent = Utils.formatMoney(total);
  }

  window.Storefront = {
    // Any product the page knows: those on screen, plus the ones in the cart.
    getProduct: (id) => CatalogStore.getProduct(id),
    // Makes sure these products are known (fetches the missing ones by id) — used by "Reorder".
    ensureProducts: (ids) => CatalogStore.ensure(ids),
    getActiveCategory: () => activeCategory,
    openItem,
    cardVariant,
    grid,
    renderCategories,
    renderGrid,
    patchVariantUI,
    footerHtml,
    // Used by storefront-sync.js if the very first catalog answer hasn't
    // arrived after a generous wait — reuses the same empty-state spot
    // renderGrid() uses for "no products right now", so there's only
    // ever one visual slot for "nothing to show here" messaging.
    showLoadError: (message) => {
      emptyState.hidden = false;
      emptyState.querySelector("p").textContent = message;
    },
  };

  /* The admin changed something in the Customize tab: redraw the pieces that
   * carry admin-set wording (Add button, out-of-stock label, empty message),
   * and drop a category/search filter that the admin just hid. Skipped
   * until the first catalog has arrived, so it can't flash "no products". */
  // The settings the product grid itself is built from (the words on the cards and empty message, the search box and the
  // category bar). Everything else the admin edits (banners, featured rows, colors, sizes, texts elsewhere...) is applied
  // by CSS or by its own part of the page, so the product cards are left exactly as they are: no redraw, no flash.
  const GRID_SETTINGS = ["addToCartText", "outOfStockText", "emptyProductsText", "noSearchResultsText", "showSearch", "showCategories"];

  document.addEventListener("freshcutz:site", (e) => {
    const changed = e.detail && e.detail.changed; // null / missing = not known: redraw
    if (changed && !changed.some((key) => GRID_SETTINGS.includes(key))) return;
    if (!SiteCustomize.on("showSearch") && searchTerm) {
      searchTerm = "";
      searchInput.value = "";
    }
    if (!SiteCustomize.on("showCategories") && activeCategory !== "All") {
      activeCategory = "All";
      shown = shownByTab.All || PAGE;
      if (ready) renderCategories();
    }
    if (ready) {
      renderGrid();
      pump();
    }
  });

  document.addEventListener("DOMContentLoaded", init);
})();
