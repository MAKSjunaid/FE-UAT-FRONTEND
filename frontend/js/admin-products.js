/* Products tab: categories first. Opening the tab loads only the category list (one small query);
 * tapping a category loads just that category's products. Photos are small thumbnails, loaded lazily.
 * Also: add/edit form sheet, enable / out-of-stock toggles, photo upload, delete. */

window.AdminProducts = (() => {
  const list = document.getElementById("productsList");
  const sheetRoot = document.getElementById("sheetRoot");

  const CATS_URL = "/api/admin/products/categories";
  const byUrl = (name) => `/api/admin/products/by-category?name=${encodeURIComponent(name)}`;

  // cats    = [{ name, total, hidden, outOfStock }] from the server ("" = products with no category); null = not loaded yet
  // cache   = category name -> its products, kept while you move around, so opening a category you already saw costs nothing
  // open    = names of the expanded categories (tap a tile to open / close it; several can be open at once)
  let cats = null;
  const cache = new Map();
  const open = new Set();
  let lastOpened = null; // the most recently opened category (the "+" button starts in it)
  let refreshSeq = 0; // only the newest refresh draws its answer
  let epoch = 0; // bumped when cached data is thrown away, so an answer that was already on its way is not cached
  let picked = new Map(); // category name -> how many of its products are ticked in select mode (set by admin-product-bulk.js)
  // Search (the box above the categories). The page reads a SHORT list of every product (id, name, category, flags -
  // about 60 bytes each) ONCE, the first time you search, and finds the matches by itself: typing, narrowing, backspacing,
  // a different word, the Hidden / Out of stock chips - none of it asks the server. Only the 3 products on screen need their
  // full details (price, photo...), and those are asked for only if the page has not already seen them; scrolling down
  // brings the next 3 the same way.
  const SEARCH_PAGE = 3; // products drawn at a time (each scroll adds 3)
  const SEARCH_AHEAD = 0; // extra products asked for together with the ones on screen (0 = ask only for the 3 that are needed)
  const SEARCH_MIN = 3; // a search needs at least one word of 3 letters (so typing "e" or "eg" asks nothing)
  const INDEX_URL = "/api/admin/products/index";
  const INDEX_FRESH_MS = 3 * 24 * 60 * 60 * 1000; // after this long the list is asked for again (a tiny "304" when nothing changed); edits made here update it in place
  let searchTerm = "";
  let searchStatus = ""; // "" = all, "hidden", "out"
  let index = null; // [{ id, n, c, e, o, h }] every product in shop order; null = not read yet
  const indexById = new Map(); // id -> its row in `index`
  let indexAt = 0;
  let indexPending = null;
  const pool = new Map(); // id -> full product details fetched for the search (the category lists in `cache` are used first)
  let matchIds = []; // ids matching the search, in shop order
  let shownCount = 0; // how many of them are on screen
  let moreBusy = false;
  let moreWatch = null; // IntersectionObserver on the spinner at the end of the results
  let searchSeq = 0;
  const searching = () => !!(searchTerm || searchStatus);

  document.addEventListener("freshcutz:logout", () => {
    cats = null;
    cache.clear();
    open.clear();
    lastOpened = null;
    picked = new Map();
    searchTerm = "";
    searchStatus = "";
    resetSearchData();
    searchSeq++;
    refreshSeq++;
    epoch++;
    list.innerHTML = "";
  });

  // the few styles of the category tiles live here so no CSS file has to change
  const style = document.createElement("style");
  style.textContent = `
    .ap-head{font-size:13px;color:var(--text-muted,#777);margin:2px 2px 10px}
    .ap-cat{display:flex;align-items:center;gap:10px;width:100%;text-align:left;margin:0 0 10px;padding:14px 14px;border:0;border-radius:var(--r-md,14px);background:var(--bg-card,#fff);box-shadow:var(--shadow-sm,0 1px 3px rgba(0,0,0,.1));color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .ap-cat:active{transform:scale(.99)}
    .ap-cat-main{flex:1;min-width:0}
    .ap-cat-name{display:block;font-size:16px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ap-cat-meta{display:block;margin-top:2px;font-size:12.5px;color:var(--text-muted,#777)}
    .ap-slide{animation:apslide .38s cubic-bezier(.2,.8,.2,1) both}
    @keyframes apslide{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion:reduce){.ap-slide{animation:none}}
    .ap-more{display:flex;align-items:center;justify-content:center;gap:10px;padding:18px 0 26px;color:var(--text-muted,#777);font-size:13.5px}
    .ap-spin{flex:0 0 auto;width:22px;height:22px;border-radius:50%;border:3px solid rgba(201,161,59,.25);border-top-color:var(--gold,#c9a13b);animation:apspin .8s linear infinite}
    @keyframes apspin{to{transform:rotate(360deg)}}
    .ap-cat-sel{flex:0 0 auto;font-size:13px;font-weight:700;color:var(--success,#2e7d32);white-space:nowrap}
    .ap-cat-sel:empty{display:none}
    .ap-cat-go{flex:0 0 auto;font-size:22px;color:var(--text-muted,#999)}
    .ap-cat-pos{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;padding:5px 9px;border-radius:999px;background:var(--bg-soft,rgba(0,0,0,.06));font-size:12.5px;font-weight:700;color:var(--text-muted,#666)}
    .ap-cat-pos:active{transform:scale(.95)}
    .ap-cat{scroll-margin-top:120px}
    .ap-cat.ap-open{margin-bottom:8px;box-shadow:var(--shadow-md,0 2px 8px rgba(0,0,0,.15))}
    .ap-cat.ap-open .ap-cat-go{transform:rotate(90deg)}
    .ap-cat-go{transition:transform .15s}
    .ap-body{margin:0 0 14px;padding-left:6px;border-left:3px solid var(--gold,#c9a227)}
    .ap-body .admin-product-card:last-child{margin-bottom:0}
  `;
  document.head.appendChild(style);

  // ---- category picker: used by the add/edit form and by Bulk actions -------
  // Not a native <select>: on iPhone, the native picker is still closing when the text box asks for focus, so
  // the keyboard never stays open. This list is made of our own buttons, so tapping "New category…" is a real tap
  // and the text box can take focus right inside it — the keyboard opens and stays.
  // The hint "Select category", then "New category…", then the categories your products already use.
  const NEW_CATEGORY = "__new__";
  const BOX = "border:1.5px solid #e3dcc9;border-radius:var(--r-sm);background:#fff;box-sizing:border-box;width:100%;";
  const CHEVRON = "url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23555' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E&quot;)";

  /** Every category (from the server's category list), alphabetical, with how many products each has. */
  function categoryList() {
    return (cats || [])
      .filter((c) => c.name)
      .map((c) => ({ name: c.name, n: c.total }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /** HTML for the picker. `current` = the category to preselect; with none, the box shows the grey hint
   * "Select category" — nothing is chosen for you. */
  function categoryFieldHtml(current) {
    const cats = categoryList();
    const cur = (current || "").trim();
    if (cur && !cats.some((c) => c.name.toLowerCase() === cur.toLowerCase())) {
      cats.push({ name: cur, n: 0 });
      cats.sort((a, b) => a.name.localeCompare(b.name));
    }
    const shown = cats.find((c) => c.name.toLowerCase() === cur.toLowerCase());
    const value = shown ? shown.name : "";
    const opt = (v, text, on) =>
      `<button type="button" role="option" data-value="${Utils.escapeHtml(v)}" aria-selected="${on}" style="display:block;width:100%;text-align:left;padding:12px 13px;font-size:16px;border:0;border-bottom:1px solid #f0ead9;background:${on ? "#f8f1dc" : "transparent"};color:inherit;font-weight:${on ? 700 : 400};cursor:pointer;">${Utils.escapeHtml(text)}</button>`;
    return `
      <div data-role="cat-pick" data-value="${Utils.escapeHtml(value)}">
        <button type="button" data-role="cat-trigger" aria-haspopup="listbox" aria-expanded="false"
          style="${BOX}display:flex;align-items:center;text-align:left;padding:11px 38px 11px 13px;font-size:16px;color:${value ? "inherit" : "#8a8575"};background:#fff ${CHEVRON} no-repeat right 14px center / 12px 8px;cursor:pointer;">
          <span data-role="cat-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escapeHtml(value || "Select category")}</span>
        </button>
        <div data-role="cat-list" role="listbox" hidden style="${BOX}margin-top:6px;max-height:240px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
          ${opt(NEW_CATEGORY, "➕ New category…", false)}
          ${cats.map((c) => opt(c.name, c.name, !!value && c.name === value)).join("")}
        </div>
        <input data-role="cat-new" maxlength="60" placeholder="Type the new category name" autocomplete="off" style="margin-top:8px;display:none;" />
      </div>`;
  }

  function setCategoryValue(pick, value) {
    const trigger = pick.querySelector('[data-role="cat-trigger"]');
    const label = pick.querySelector('[data-role="cat-label"]');
    const list = pick.querySelector('[data-role="cat-list"]');
    const inp = pick.querySelector('[data-role="cat-new"]');
    pick.dataset.value = value;
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.style.borderColor = "#e3dcc9";
    const isNew = value === NEW_CATEGORY;
    label.textContent = isNew ? "➕ New category…" : value || "Select category";
    trigger.style.color = value ? "inherit" : "#8a8575";
    list.querySelectorAll("[role=option]").forEach((o) => {
      const on = !isNew && !!value && o.dataset.value === value;
      o.setAttribute("aria-selected", on);
      o.style.fontWeight = on ? "700" : "400";
      o.style.background = on ? "#f8f1dc" : "transparent";
    });
    inp.style.display = isNew ? "" : "none";
    // Right here, inside the person's own tap, so iPhone opens the keyboard and keeps it open.
    if (isNew) inp.focus();
  }

  // one listener for every picker on the page (they are re-created each time a form opens)
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest('[data-role="cat-trigger"]');
    const option = e.target.closest('[data-role="cat-list"] [role="option"]');
    if (option) {
      e.preventDefault();
      setCategoryValue(option.closest('[data-role="cat-pick"]'), option.dataset.value);
      return;
    }
    document.querySelectorAll('[data-role="cat-pick"]').forEach((pick) => {
      const list = pick.querySelector('[data-role="cat-list"]');
      const t = pick.querySelector('[data-role="cat-trigger"]');
      const open = trigger === t ? list.hidden : false; // tapping the box toggles; tapping elsewhere closes
      list.hidden = !open;
      t.setAttribute("aria-expanded", String(open));
      t.style.borderColor = open ? "var(--gold)" : "#e3dcc9";
    });
  });

  /** Makes the box exactly as tall as the other boxes in the same form. */
  function bindCategoryField(root) {
    const trigger = root.querySelector('[data-role="cat-trigger"]');
    if (!trigger) return;
    const ref = root.querySelector('input:not([data-role="cat-new"]):not([type="checkbox"]):not([type="hidden"])');
    const h = ref ? ref.offsetHeight : 0;
    if (h) trigger.style.minHeight = h + "px";
  }

  /** The chosen (or newly typed) category name; "" = none. A typed name that already exists (any capitals) reuses it. */
  function readCategory(root) {
    const pick = root.querySelector('[data-role="cat-pick"]');
    if (!pick || !pick.dataset.value) return ""; // nothing chosen
    if (pick.dataset.value !== NEW_CATEGORY) return pick.dataset.value;
    const inp = pick.querySelector('[data-role="cat-new"]');
    const typed = (inp ? inp.value : "").trim().replace(/\s+/g, " ");
    const hit = categoryList().find((c) => c.name.toLowerCase() === typed.toLowerCase());
    return hit ? hit.name : typed;
  }

  function priceLine(p) {
    const v1 = `${Utils.escapeHtml(p.variant1Label)}: ${Utils.formatMoney(p.variant1Price)}`;
    const v2 = p.variant2Label ? ` · ${Utils.escapeHtml(p.variant2Label)}: ${Utils.formatMoney(p.variant2Price)}` : "";
    return v1 + v2;
  }

  function statusBadgesHtml(p) {
    return `${p.enabled ? '<span class="badge badge-live">Live</span>' : '<span class="badge badge-off">Hidden</span>'}
      ${p.outOfStock ? '<span class="badge badge-off">Out of Stock</span>' : ""}`;
  }

  function card(p) {
    return `
    <div class="admin-product-card" data-id="${p.id}">
      <div class="admin-product-thumb">
        <img src="${thumbSrc(p.imageUrl)}" alt="${Utils.escapeHtml(p.name)}" loading="lazy" decoding="async" />
        <button class="thumb-upload-btn" data-action="upload">Change photo</button>
      </div>
      <div class="admin-product-main">
        <div class="name-row">
          <span class="name">${Utils.escapeHtml(p.name)}</span>
          <label class="switch">
            <input type="checkbox" data-action="toggle" ${p.enabled ? "checked" : ""} />
            <span class="track"></span>
          </label>
        </div>
        <div class="name-row">
          <span class="name" style="font-size:12px;font-weight:600;color:var(--text-muted);">Out of stock</span>
          <label class="switch">
            <input type="checkbox" data-action="toggle-stock" ${p.outOfStock ? "checked" : ""} />
            <span class="track"></span>
          </label>
        </div>
        <div class="admin-product-prices">${priceLine(p)}</div>
        <div class="admin-product-prices" data-role="status-badges">${statusBadgesHtml(p)}</div>
        <div class="admin-product-actions">
          <button class="btn btn-outline btn-sm" data-action="edit">Edit</button>
          <button class="btn btn-ghost btn-sm" data-action="delete">Delete</button>
        </div>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-role="file-input" hidden />
    </div>`;
  }

  // ---- screens -------------------------------------------------------

  const catLabel = (name) => name || "Uncategorized";
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const skeleton = (n) => `<div class="skeleton" style="height:${n}px;margin-bottom:12px;"></div>`.repeat(3);
  const emptyAll = `<div class="empty-state"><div class="icon">🍗</div><p>No products yet — tap + to add your first one.</p></div>`;

  /** Small preview of a product's photo (a few KB). Old disk-path photos have no preview and are used as they are. */
  function thumbSrc(imageUrl) {
    const url = Utils.resolveImageUrl(imageUrl);
    // "t=2" = the clearer preview size; it also makes browsers drop the older, blurrier previews they had saved
    return url.includes("/api/products/") ? url + "&s=thumb&t=2" : url;
  }

  const catKey = (p) => (p.category || "").trim();

  /** The category tab the customer website opens on ("" = the normal "All" tab); null = not read yet. */
  let defaultCat = null;
  async function loadDefaultCat() {
    if (defaultCat !== null) return;
    try {
      defaultCat = ((await Api.get("/api/store/default-category")) || {}).category || "";
    } catch {
      defaultCat = ""; // not essential: the tiles just won't show the star
    }
  }

  function metaLine(c) {
    return [
      c.name && c.name === defaultCat ? "★ opens first on the shop" : "",
      plural(c.total, "item"),
      c.hidden ? `${c.hidden} hidden` : "",
      c.outOfStock ? `${c.outOfStock} out of stock` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /** Select mode: "2 selected", shown in green at the right end of the tile. */
  function pickedText(c) {
    const n = picked.get(c.name) || 0;
    return n ? `${n} selected` : "";
  }

  /** The inside of an expanded category: its product cards (or a loading placeholder). */
  function bodyHtml(name) {
    const rows = cache.get(name);
    if (!rows) return skeleton(96);
    return rows.map(card).join("");
  }

  function tileHtml(c) {
    const isOpen = open.has(c.name);
    return `<button type="button" class="ap-cat${isOpen ? " ap-open" : ""}" data-cat="${Utils.escapeHtml(c.name)}" aria-expanded="${isOpen}">
        <span class="ap-cat-tick" data-action="cattick" aria-hidden="true"></span>
        <span class="ap-cat-main"><span class="ap-cat-name">${Utils.escapeHtml(catLabel(c.name))}</span>
        <span class="ap-cat-meta"><span data-m>${Utils.escapeHtml(metaLine(c))}</span></span></span>
        <b class="ap-cat-sel" data-s>${Utils.escapeHtml(pickedText(c))}</b>
        <span class="ap-cat-pos" role="button" tabindex="0" data-action="catpos" title="Change where this category shows (admin and shop)">#${(cats || []).indexOf(c) + 1} ✎</span>
        <span class="ap-cat-go" aria-hidden="true">›</span></button>${isOpen ? `<div class="ap-body" data-body>${bodyHtml(c.name)}</div>` : ""}`;
  }

  /** Draws the whole list: a tile per category, with every open one expanded right below its tile. */
  function render() {
    if (searching() && cats) return showSearch(false);
    for (const name of [...open]) if (!(cats || []).some((c) => c.name === name)) open.delete(name); // emptied / renamed
    if (lastOpened !== null && !open.has(lastOpened)) lastOpened = null;
    if (!cats.length) {
      list.innerHTML = emptyAll;
      return;
    }
    const total = cats.reduce((s, c) => s + c.total, 0);
    list.innerHTML =
      `<div class="ap-head">${plural(cats.length, "category").replace("categorys", "categories")} · ${plural(total, "product")}</div>` +
      cats.map(tileHtml).join("");
  }

  // ---- search ----------------------------------------------------------
  const wordsOf = (t) => String(t || "").toLowerCase().split(/\s+/).filter(Boolean);
  /** True when the text has at least one word long enough to search for. */
  const searchable = (t) => wordsOf(t).some((w) => w.length >= SEARCH_MIN);
  const haystack = (name, category) => `${name} ${category || ""}`.toLowerCase();

  /** Forgets the short list and the details fetched for the search (something changed, or the admin logged out). */
  function resetSearchData() {
    index = null;
    indexById.clear();
    indexAt = 0;
    pool.clear();
    matchIds = [];
    shownCount = 0;
    stopWatching();
  }

  /** One row of the short list was changed on this page (a switch, a bulk action, an edit) - keep it right without asking. */
  function patchIndex(id, fields) {
    const row = indexById.get(id);
    if (!row) return;
    Object.assign(row, fields);
    if ("n" in fields || "c" in fields) row.h = haystack(row.n, row.c);
  }
  function dropFromIndex(ids) {
    if (!index) return;
    const gone = new Set(ids);
    index = index.filter((r) => !gone.has(r.id));
    ids.forEach((id) => { indexById.delete(id); pool.delete(id); });
  }

  /** Reads the short list (one request) - or, when it is older than 3 days, asks whether it changed. */
  async function ensureIndex() {
    if (index && Date.now() - indexAt < INDEX_FRESH_MS) return;
    if (!indexPending) {
      indexPending = Api.get(INDEX_URL)
        .then((rows) => {
          index = rows.map((r) => ({ id: r.id, n: r.n, c: r.c, e: r.e, o: r.o, h: haystack(r.n, r.c) }));
          indexById.clear();
          index.forEach((r) => indexById.set(r.id, r));
          indexAt = Date.now();
        })
        .finally(() => { indexPending = null; });
    }
    await indexPending;
  }

  /** The ids that match the search box and the Hidden / Out of stock chips - worked out here, no request. */
  function computeMatches() {
    const words = wordsOf(searchTerm);
    return (index || [])
      .filter((r) => !(searchStatus === "hidden" && r.e) && !(searchStatus === "out" && !r.o) && words.every((w) => r.h.includes(w)))
      .map((r) => r.id);
  }

  /** Makes sure the full details of these products are here. Nothing is asked when they are all known already; when some are
   *  missing, ONE request brings them together with the next few matches (`ahead`), so scrolling on is free for a while. */
  async function fetchMissing(ids, ahead) {
    if (ids.every(findProduct)) return;
    const want = [...new Set([...ids, ...(ahead || [])])].filter((id) => !findProduct(id));
    for (let i = 0; i < want.length; i += 50) {
      const part = want.slice(i, i + 50);
      const rows = await Api.get(`/api/admin/products/by-ids?ids=${part.join(",")}`);
      rows.forEach((r) => pool.set(r.id, r));
      if (rows.length < part.length) index = null; // some product no longer exists: the short list is out of date
    }
  }

  function stopWatching() {
    if (moreWatch) moreWatch.disconnect();
    moreWatch = null;
  }

  /** Shows the search results: the first page of 6 (reset = true), or the same number as before (after a change). */
  async function showSearch(reset) {
    const seq = ++searchSeq;
    if (reset) shownCount = SEARCH_PAGE;
    try {
      if (!index || Date.now() - indexAt >= INDEX_FRESH_MS) {
        if (!list.querySelector(".admin-product-card")) list.innerHTML = skeleton(96); // first time only
        await ensureIndex();
        if (seq !== searchSeq || !searching()) return;
      }
      matchIds = computeMatches();
      shownCount = Math.max(SEARCH_PAGE, Math.min(shownCount, matchIds.length)) || SEARCH_PAGE;
      await fetchMissing(matchIds.slice(0, shownCount), matchIds.slice(shownCount, shownCount + SEARCH_AHEAD));
    } catch (err) {
      if (seq === searchSeq) list.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
      return;
    }
    if (seq !== searchSeq || !searching()) return;
    drawSearch(true);
  }

  /** Draws the results found so far (no request): a count, the product cards, and a golden spinner while more are to come. */
  /** A product card that slides up into place (each one a little after the one before). */
  const slideCard = (p, i) => card(p).replace('class="admin-product-card"', `class="admin-product-card ap-slide" style="animation-delay:${i * 70}ms"`);
  /** Only typed searches slide in (not the Hidden / Out of stock chips on their own), and only when 3 or more cards come. */
  const canSlide = (count) => searchTerm !== "" && count >= SEARCH_PAGE;
  function drawSearch(animate) {
    stopWatching();
    const hits = matchIds.slice(0, shownCount).map(findProduct).filter(Boolean);
    const label = searchStatus === "hidden" ? "hidden " : searchStatus === "out" ? "out-of-stock " : "";
    const more = shownCount < matchIds.length;
    list.innerHTML =
      `<div class="ap-head">${matchIds.length ? plural(matchIds.length, label + "product") : ""}</div>` +
      (hits.length
        ? hits.map((p, i) => (animate && canSlide(hits.length) ? slideCard(p, i) : card(p))).join("") + (more ? `<div class="ap-more" data-more><span class="ap-spin"></span><span>Loading more…</span></div>` : "")
        : `<div class="empty-state"><div class="icon">🔍</div><p>No ${label}products match${searchTerm.trim() ? ` “${Utils.escapeHtml(searchTerm.trim())}”` : ""}.</p></div>`);
    if (more) watchMore();
  }

  /** When the spinner at the end of the list scrolls into view, the next 3 are brought in (only the ones not seen before are fetched). */
  function watchMore() {
    const el = list.querySelector("[data-more]");
    if (!el || typeof IntersectionObserver === "undefined") return;
    moreWatch = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: "150px" });
    moreWatch.observe(el);
  }

  async function loadMore() {
    if (moreBusy || !searching() || shownCount >= matchIds.length) return;
    const el = list.querySelector("[data-more]");
    if (!el) return;
    moreBusy = true;
    const seq = searchSeq;
    const next = matchIds.slice(shownCount, shownCount + SEARCH_PAGE);
    try {
      await fetchMissing(next, matchIds.slice(shownCount + SEARCH_PAGE, shownCount + SEARCH_AHEAD));
      if (seq !== searchSeq || !el.isConnected) return;
      const batch = next.map(findProduct).filter(Boolean);
      el.insertAdjacentHTML("beforebegin", batch.map((p, i) => (canSlide(batch.length) ? slideCard(p, i) : card(p))).join(""));
      shownCount += next.length;
      if (shownCount >= matchIds.length) {
        el.remove();
        stopWatching();
      } else if (moreWatch) {
        moreWatch.unobserve(el); // look again: the spinner moved down, and may still be in view
        moreWatch.observe(el);
      }
    } catch (err) {
      if (el.isConnected) el.innerHTML = `<button type="button" class="btn btn-outline btn-sm" data-action="retrymore">Couldn't load - tap to retry</button>`;
    } finally {
      moreBusy = false;
    }
  }

  /** Called by the search box and the filter chips in admin-product-import.js. */
  function search(term, status) {
    searchTerm = searchable(term) ? wordsOf(term).join(" ") : ""; // under 3 letters = no text search at all
    searchStatus = status || "";
    if (!cats) return;
    if (!searching()) {
      searchSeq++; // forget any answer still on its way
      matchIds = [];
      shownCount = 0;
      stopWatching();
      return render();
    }
    showSearch(true);
  }

  /** A product is gone (deleted): drop it from the saved lists, without turning a never-opened category into an empty one. */
  function forget(p) {
    const cat = catKey(p);
    if (cache.has(cat)) cache.set(cat, cache.get(cat).filter((x) => x.id !== p.id));
    dropFromIndex([p.id]);
  }

  const tileOf = (name) => [...list.querySelectorAll(".ap-cat")].find((t) => t.dataset.cat === name) || null;

  function setTileMeta(name) {
    const c = (cats || []).find((x) => x.name === name);
    const tile = tileOf(name);
    const base = tile?.querySelector("[data-m]");
    const sel = tile?.querySelector("[data-s]");
    if (!c || !base || !sel) return;
    // only when it changed (select mode watches the list)
    const text = metaLine(c);
    if (base.textContent !== text) base.textContent = text;
    const picks = pickedText(c);
    if (sel.textContent !== picks) sel.textContent = picks;
  }

  function collapse(name) {
    open.delete(name);
    if (lastOpened === name) lastOpened = [...open].pop() ?? null;
    const tile = tileOf(name);
    if (!tile) return;
    tile.classList.remove("ap-open");
    tile.setAttribute("aria-expanded", "false");
    const body = tile.nextElementSibling;
    if (body && body.matches("[data-body]")) body.remove();
  }

  /** Tap a category: it opens right under its tile (loading its products if not seen yet); tap again to close it.
   * Any number of categories can be open, so products from several can be ticked in select mode. */
  async function toggleCategory(name) {
    if (open.has(name)) return collapse(name);
    open.add(name);
    lastOpened = name;
    const tile = tileOf(name);
    if (!tile) return;
    tile.classList.add("ap-open");
    tile.setAttribute("aria-expanded", "true");
    const body = document.createElement("div");
    body.className = "ap-body";
    body.dataset.body = "";
    body.innerHTML = bodyHtml(name);
    tile.after(body);
    // keep the tapped tile in view
    const top = tile.getBoundingClientRect().top;
    if (top < 110 || top > window.innerHeight * 0.6) tile.scrollIntoView({ block: "start", behavior: "smooth" });
    if (cache.has(name)) return;

    const ep = epoch;
    try {
      const rows = await Api.get(byUrl(name));
      if (ep === epoch) cache.set(name, rows);
      if (!body.isConnected || !open.has(name)) return;
      cache.set(name, rows);
      body.innerHTML = bodyHtml(name);
    } catch (err) {
      if (body.isConnected) body.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
    }
  }

  /** Called when the Products tab is opened (loads the category list once) and after changes.
   * force = read again; `names` = only those categories' lists are thrown away and re-read (the others are kept);
   * `withCounts` false = the category tiles' numbers are known to be right, so they are not asked for again. */
  async function refresh(force = false, names = null, withCounts = true) {
    if (!force && cats) return;
    const seq = ++refreshSeq;
    if (force) {
      resetSearchData(); // the short list and the details are read again the next time they are needed
      if (names) names.forEach((n) => cache.delete(n));
      else cache.clear();
      epoch++;
    }
    const wanted = [...open].filter((n) => !cache.has(n)); // open categories whose list was thrown away
    const needCounts = withCounts || !cats;
    if (!cats) list.innerHTML = skeleton(72);
    const ep = epoch;
    try {
      const [c, , ...rows] = await Promise.all([needCounts ? Api.get(CATS_URL) : cats, loadDefaultCat(), ...wanted.map((n) => Api.get(byUrl(n)))]);
      cats = c;
      if (ep === epoch) wanted.forEach((n, i) => cache.set(n, rows[i]));
      if (seq === refreshSeq) render();
    } catch (err) {
      if (seq === refreshSeq) list.innerHTML = `<div class="empty-state"><p>${Utils.escapeHtml(err.message)}</p></div>`;
    }
  }

  const FLAGS = {
    ENABLE: ["enabled", true],
    DISABLE: ["enabled", false],
    OUT_OF_STOCK: ["outOfStock", true],
    IN_STOCK: ["outOfStock", false],
  };

  /** After a bulk action: show / hide, out of stock and delete are applied to what is already on the page (the server
   * did exactly that to these products, so there is nothing to ask it); only a category move re-reads the two
   * categories involved, because the new place in the list is decided by the server. */
  async function afterBulk(action, ids, value) {
    // products that are only in the search list (never opened) are described by their row there
    const light = (id) => {
      const r = indexById.get(id);
      return r ? { id, name: r.n, category: r.c, enabled: r.e, outOfStock: r.o } : null;
    };
    const prods = ids.map((id) => findProduct(id) || light(id));
    // keep the search list right without asking the server
    if (FLAGS[action]) {
      const [field, on] = FLAGS[action];
      ids.forEach((id) => patchIndex(id, field === "enabled" ? { e: on } : { o: on }));
    } else if (action === "CATEGORY") {
      ids.forEach((id) => patchIndex(id, { c: (value || "").trim() }));
    }
    if (!prods.every(Boolean)) return refresh(true); // something not known here: read everything again
    if (action === "CATEGORY") {
      return refresh(true, [...new Set([...prods.map(catKey), (value || "").trim()])]);
    }
    for (const p of prods) {
      const cat = catKey(p);
      if (action === "DELETE") {
        forget(p);
        adjust(cat, { total: -1, hidden: p.enabled ? 0 : -1, outOfStock: p.outOfStock ? -1 : 0 });
      } else if (FLAGS[action]) {
        const [field, on] = FLAGS[action];
        if (p[field] === on) continue; // already like that
        p[field] = on;
        const sign = on ? 1 : -1;
        adjust(cat, field === "enabled" ? { hidden: -sign } : { outOfStock: sign });
      }
    }
    render();
  }

  /** Keeps the category tiles' numbers right after a toggle / delete without asking the server again. */
  function adjust(name, d) {
    const c = (cats || []).find((x) => x.name === name);
    if (!c) return;
    c.total += d.total || 0;
    c.hidden += d.hidden || 0;
    c.outOfStock += d.outOfStock || 0;
    if (c.total <= 0) {
      cats = cats.filter((x) => x !== c);
      return;
    }
    setTileMeta(name);
  }

  /** Products of every open category, in the order the tiles are shown. */
  const openRows = () => searching()
    ? matchIds.map((id) => { const r = indexById.get(id); return { id, name: r ? r.n : "", category: r ? r.c : "" }; }) // every match, shown or not
    : (cats || []).filter((c) => open.has(c.name)).flatMap((c) => cache.get(c.name) || []);

  /** Any product that has been loaded (open or closed category). */
  function findProduct(id) {
    for (const rows of cache.values()) {
      const hit = rows.find((p) => p.id === id);
      if (hit) return hit;
    }
    return pool.get(id) || null;
  }

  /** Select mode shows "✓ n selected" on each category tile. */
  function setPicked(map) {
    const old = picked;
    picked = map;
    for (const name of new Set([...old.keys(), ...map.keys()])) setTileMeta(name);
  }

  list.addEventListener("click", (e) => {
    const card = e.target.closest(".admin-product-card");
    if (!card) {
      if (e.target.closest('[data-action="retrymore"]')) {
        const el = list.querySelector("[data-more]");
        if (el) el.innerHTML = '<span class="ap-spin"></span><span>Loading more…</span>';
        loadMore();
        return;
      }
      const tile = e.target.closest(".ap-cat");
      if (!tile) return;
      if (e.target.closest('[data-action="catpos"]')) openCategoryPosition(tile.dataset.cat);
      else toggleCategory(tile.dataset.cat);
      return;
    }
    const id = Number(card.dataset.id);
    const product = findProduct(id);
    if (!product) return;

    if (e.target.closest('[data-action="upload"]')) {
      card.querySelector('[data-role="file-input"]').click();
    } else if (e.target.closest('[data-action="edit"]')) {
      openForm(product);
    } else if (e.target.closest('[data-action="delete"]')) {
      deleteProduct(product);
    }
  });

  list.addEventListener("change", async (e) => {
    const card = e.target.closest(".admin-product-card");
    if (!card) return;
    const id = Number(card.dataset.id);
    const product = findProduct(id);
    if (!product) return;
    const cat = catKey(product);

    if (e.target.matches('[data-action="toggle"]')) {
      const enabled = e.target.checked;
      try {
        await Api.patch(`/api/admin/products/${id}/enabled`, { enabled });
        product.enabled = enabled;
        patchIndex(id, { e: enabled });
        adjust(cat, { hidden: enabled ? -1 : 1 });
        // Patch just this card's badges in place — a full re-render would destroy the just-toggled
        // (still-focused) checkbox and jump the page back to the top.
        card.querySelector('[data-role="status-badges"]').innerHTML = statusBadgesHtml(product);
        Toast.show(enabled ? `${product.name} is now visible` : `${product.name} is now hidden`, "success");
      } catch (err) {
        e.target.checked = !enabled;
        Toast.show(err.message, "error");
      }
    } else if (e.target.matches('[data-action="toggle-stock"]')) {
      const outOfStock = e.target.checked;
      try {
        await Api.patch(`/api/admin/products/${id}/out-of-stock`, { outOfStock });
        product.outOfStock = outOfStock;
        patchIndex(id, { o: outOfStock });
        adjust(cat, { outOfStock: outOfStock ? 1 : -1 });
        card.querySelector('[data-role="status-badges"]').innerHTML = statusBadgesHtml(product);
        Toast.show(outOfStock ? `${product.name} marked out of stock` : `${product.name} marked back in stock`, "success");
      } catch (err) {
        e.target.checked = !outOfStock;
        Toast.show(err.message, "error");
      }
    } else if (e.target.matches('[data-role="file-input"]')) {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const updated = await Api.upload(`/api/admin/products/${id}/image`, formData);
        Toast.show("Photo updated", "success");
        // Only this one photo changed, and the response's imageUrl carries a fresh cache-buster (?v=...),
        // so swapping this card's <img> src shows the new photo without reloading anything.
        product.imageUrl = updated.imageUrl;
        card.querySelector(".admin-product-thumb img").src = thumbSrc(updated.imageUrl);
      } catch (err) {
        Toast.show(err.message, "error");
      }
    }
  });

  async function deleteProduct(product) {
    if (!confirm(`Delete "${product.name}"? This can't be undone.`)) return;
    const cat = catKey(product);
    try {
      await Api.del(`/api/admin/products/${product.id}`);
      Toast.show("Product deleted", "success");
      // Deleting doesn't move any other product, so just drop this one locally.
      forget(product);
      adjust(cat, { total: -1, hidden: product.enabled ? 0 : -1, outOfStock: product.outOfStock ? -1 : 0 });
      render(); // a category left with no products disappears from the list
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  /** Small box to choose where a whole category shows: 1 = first (right after "All" on the shop). Admin and shop follow. */
  function openCategoryPosition(name) {
    const current = (cats || []).findIndex((c) => c.name === name) + 1;
    sheetRoot.innerHTML = `
      <div class="overlay" data-role="overlay"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-header"><h2>Category position</h2><button class="sheet-close" data-role="close">✕</button></div>
        <form class="sheet-body" id="catPosForm">
          <p class="hint"><b>${Utils.escapeHtml(catLabel(name))}</b> — there are ${(cats || []).length} categories.</p>
          <div class="field">
            <label>Position (1 = first, right after "All" on the shop)</label>
            <input name="position" type="number" min="1" max="${(cats || []).length}" inputmode="numeric" required value="${current}" />
          </div>
          ${name ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
            <input type="checkbox" name="isDefault" ${defaultCat === name ? "checked" : ""} />
            Open the shop on this category by default
          </label>
          <p class="hint">Customers who open the website start on this category instead of "All". They can still tap "All".</p>` : ""}
        </form>
        <div class="sheet-footer"><button class="btn btn-gold btn-block" id="saveCatPos" form="catPosForm">Save</button></div>
      </div>`;
    const close = () => (sheetRoot.innerHTML = "");
    sheetRoot.querySelector('[data-role="overlay"]').addEventListener("click", close);
    sheetRoot.querySelector('[data-role="close"]').addEventListener("click", close);
    const form = sheetRoot.querySelector("#catPosForm");
    const btn = sheetRoot.querySelector("#saveCatPos");
    form.querySelector("input").select();
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const position = Number(form.position.value);
      if (!position || position < 1) return form.position.focus();
      const wantDefault = !!form.isDefault?.checked;
      const moveIt = position !== current;
      const defaultChanged = !!name && wantDefault !== (defaultCat === name);
      if (!moveIt && !defaultChanged) return close();
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Saving...`;
      try {
        if (moveIt) await Api.put("/api/admin/products/categories/position", { name, position });
        if (defaultChanged) {
          await Api.put("/api/admin/products/default-category", { category: wantDefault ? name : "" });
          defaultCat = wantDefault ? name : "";
        }
        Toast.show("Saved", "success");
        close();
        if (moveIt) refresh(true, [], true); // the tile order changed: keep the open categories' lists, read the tiles again
        else render(); // only the star changed
      } catch (err) {
        Toast.show(err.message, "error");
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });
  }

  async function openForm(product) {
    const isEdit = !!product;
    if (!cats) {
      try {
        cats = await Api.get(CATS_URL);
      } catch (err) {
        Toast.show(err.message, "error");
        return;
      }
    }
    const rows = isEdit ? cache.get(catKey(product)) || [] : [];
    const position = isEdit ? rows.findIndex((p) => p.id === product.id) + 1 : "";
    // Adding while a category is open starts in that category (the one opened last); with none open, nothing is picked for you.
    const startCategory = isEdit ? product.category : lastOpened || "";
    const body = `
      <form class="sheet-body" id="productForm">
        <div class="field">
          <label>Name</label>
          <input name="name" required value="${isEdit ? Utils.escapeHtml(product.name) : ""}" placeholder="e.g. Chicken Curry Cut" />
        </div>
        <div class="field">
          <label>Description (optional)</label>
          <textarea name="description" rows="2">${isEdit ? Utils.escapeHtml(product.description || "") : ""}</textarea>
        </div>
        <div class="field">
          <label>Category</label>
          ${categoryFieldHtml(startCategory)}
        </div>
        <div class="field">
          <label>Size 1 label</label>
          <input name="variant1Label" required value="${isEdit ? Utils.escapeHtml(product.variant1Label) : "500g"}" />
        </div>
        <div style="display:flex;gap:10px;">
          <div class="field" style="flex:1;">
            <label>Size 1 price (₹)</label>
            <input name="variant1Price" type="number" min="0" step="1" required value="${isEdit ? product.variant1Price : ""}" />
          </div>
          <div class="field" style="flex:1;">
            <label>Size 1 MRP (₹, optional)</label>
            <input name="variant1Mrp" type="number" min="0" step="1" value="${isEdit && product.variant1Mrp != null ? product.variant1Mrp : ""}" />
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
          <input type="checkbox" id="hasVariant2" ${isEdit && product.variant2Label ? "checked" : ""} />
          Also sell a second size (e.g. 1kg)
        </label>
        <div id="variant2Fields" style="display:${isEdit && product.variant2Label ? "block" : "none"};display:flex;flex-direction:column;gap:12px;">
          <div class="field">
            <label>Size 2 label</label>
            <input name="variant2Label" value="${isEdit ? Utils.escapeHtml(product.variant2Label || "") : "1kg"}" />
          </div>
          <div style="display:flex;gap:10px;">
            <div class="field" style="flex:1;">
              <label>Size 2 price (₹)</label>
              <input name="variant2Price" type="number" min="0" step="1" value="${isEdit ? product.variant2Price ?? "" : ""}" />
            </div>
            <div class="field" style="flex:1;">
              <label>Size 2 MRP (₹, optional)</label>
              <input name="variant2Mrp" type="number" min="0" step="1" value="${isEdit && product.variant2Mrp != null ? product.variant2Mrp : ""}" />
            </div>
          </div>
        </div>
        <div class="field">
          <label>Position overall (1 = first of ALL products on the shop, whatever the category)</label>
          <input name="overallPosition" type="number" min="1" inputmode="numeric" placeholder="Not used" />
        </div>
        <div class="field">
          <label>Position in its category (1 = shows first, empty = last)</label>
          <input name="displayOrder" type="number" min="1" inputmode="numeric" placeholder="Last" value="${position}" />
          <p class="hint" id="posHint" hidden>Not used while "Position overall" is filled.</p>
        </div>
        ${!isEdit ? `<p class="hint">You can add a photo from the product list right after saving.</p>` : ""}
      </form>
      <div class="sheet-footer">
        <button class="btn btn-gold btn-block" id="saveProductBtn" form="productForm">${isEdit ? "Save Changes" : "Add Product"}</button>
      </div>`;

    sheetRoot.innerHTML = `
      <div class="overlay" data-role="overlay"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-header"><h2>${isEdit ? "Edit Product" : "Add Product"}</h2><button class="sheet-close" data-role="close">✕</button></div>
        ${body}
      </div>`;

    const close = () => (sheetRoot.innerHTML = "");
    bindCategoryField(sheetRoot);
    sheetRoot.querySelector('[data-role="overlay"]').addEventListener("click", close);
    sheetRoot.querySelector('[data-role="close"]').addEventListener("click", close);

    const hasV2 = sheetRoot.querySelector("#hasVariant2");
    const v2Fields = sheetRoot.querySelector("#variant2Fields");
    hasV2.addEventListener("change", () => {
      v2Fields.style.display = hasV2.checked ? "flex" : "none";
    });

    const form = sheetRoot.querySelector("#productForm");
    const saveBtn = sheetRoot.querySelector("#saveProductBtn");
    let positionTouched = false;
    const catPos = form.querySelector('[name="displayOrder"]');
    const overallPos = form.querySelector('[name="overallPosition"]');
    const posHint = form.querySelector("#posHint");
    catPos.addEventListener("input", () => (positionTouched = true));
    // only one of the two positions is used: typing an overall position greys out the in-category one
    overallPos.addEventListener("input", () => {
      const on = overallPos.value.trim() !== "";
      catPos.disabled = on;
      posHint.hidden = !on;
    });

    saveBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const category = readCategory(form);
      const overall = Number(data.get("overallPosition")) || 0;
      // The number shown is the product's place in its OLD category; if it was moved to another category without
      // typing a new position, it simply goes to the end of the new one.
      const moved = isEdit && category.toLowerCase() !== (product.category || "").trim().toLowerCase();
      const payload = {
        name: data.get("name")?.trim(),
        description: data.get("description")?.trim() || null,
        category: category || null,
        variant1Label: data.get("variant1Label")?.trim(),
        variant1Price: Number(data.get("variant1Price")),
        variant1Mrp: data.get("variant1Mrp") ? Number(data.get("variant1Mrp")) : null,
        variant2Label: hasV2.checked ? data.get("variant2Label")?.trim() || null : null,
        variant2Price: hasV2.checked && data.get("variant2Price") ? Number(data.get("variant2Price")) : null,
        variant2Mrp: hasV2.checked && data.get("variant2Mrp") ? Number(data.get("variant2Mrp")) : null,
        enabled: isEdit ? product.enabled : true,
        outOfStock: isEdit ? product.outOfStock : false,
        displayOrder: moved && !positionTouched ? 0 : Number(data.get("displayOrder")) || 0,
        overallPosition: overall,
      };

      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="spinner"></span> Saving...`;
      try {
        if (isEdit) {
          await Api.put(`/api/admin/products/${product.id}`, payload);
        } else {
          await Api.post("/api/admin/products", payload);
        }
        Toast.show("Product saved", "success");
        close();
        const samePlace = isEdit && !moved && !overall && String(Number(data.get("displayOrder")) || 0) === String(position);
        if (samePlace) {
          // nothing moved (same category, same position): just show the new details — nothing to read again
          Object.assign(product, {
            name: payload.name, description: payload.description, category: payload.category,
            variant1Label: payload.variant1Label, variant1Price: payload.variant1Price, variant1Mrp: payload.variant1Mrp,
            variant2Label: payload.variant2Label, variant2Price: payload.variant2Price, variant2Mrp: payload.variant2Mrp,
          });
          patchIndex(product.id, { n: payload.name, c: (payload.category || "").trim() });
          const el = list.querySelector(`.admin-product-card[data-id="${product.id}"]`);
          if (el) el.outerHTML = card(product);
        } else {
          // moved: re-read only the categories involved; the tile numbers only change when the category does
          // (an overall position can also change the ORDER of the category tiles, so the tiles are read again too)
          refresh(true, [...new Set(isEdit ? [catKey(product), category] : [category])], !isEdit || moved || !!overall);
        }
      } catch (err) {
        Toast.show(err.message, "error");
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? "Save Changes" : "Add Product";
      }
    });
  }

  document.getElementById("addProductFab").addEventListener("click", () => openForm(null));

  // The category picker and the open category's products are also used by Bulk actions (admin-product-bulk.js)
  return {
    refresh,
    afterBulk,
    // The short item list (id, name, category, shown, out of stock) - shared with the Banners tab, so it is asked for once
    // however many places use it, and kept in step with every edit made on this page.
    getIndex: async () => { await ensureIndex(); return index || []; },
    peekIndex: () => index, // the list if it is already here (null if not) - never asks the server
    getAll: openRows,
    find: findProduct,
    hasProducts: () => (cats || []).length > 0,
    setPicked,
    search,
    isOpen: (name) => open.has(name),
    rowsOf: (name) => cache.get(name) || null,
    openCategory: async (name) => { if (!open.has(name) || !cache.has(name)) { if (open.has(name)) collapse(name); await toggleCategory(name); } return cache.get(name) || []; },
    categoryTotal: (name) => ((cats || []).find((c) => c.name === name) || {}).total || 0,
    categories: categoryList,
    categoryFieldHtml,
    bindCategoryField,
    readCategory,
  };
})();
