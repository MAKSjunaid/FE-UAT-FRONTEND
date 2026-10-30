/* Admin -> "Banners" tab.
 *
 * Any number of banners (sliders), each with any number of pictures. For every banner you can type the name customers
 * see on it ("Ramadan offer"), the position among the products (any number: 1 = above the first product, 5 = after the
 * 4th product ...), where it shows (categories), and for every picture which item opens when a customer taps it.
 *
 * Built to ask the server for as little as possible:
 *  - opening the tab loads ONE short list (name, position, number of pictures ... per banner, and the category
 *    names for the "Show in" menu) - nothing else;
 *  - the list also carries each banner's pictures (a few bytes each), so opening a banner is instant; the names of the
 *    items its pictures open come from the Products list if this page already has it, otherwise from ONE small request
 *    that reads only those few items;
 *  - the list of all items is only needed when "Choose item" is used - and it is the same list the Products page
 *    search uses, so it is asked for once for both;
 *  - Save is ONE request with only what changed (turning a banner on or off sends just that switch).
 * Banners belong to the live website; they are not part of a template, so Customize never touches them.
 * Pictures: choosing one only prepares it in this browser (checked, and shrunk so even a big phone photo is about
 * 100-200 KB) and shows it from memory - nothing is sent to the server until you press Save. Save uploads the new
 * pictures (one small request each) and then sends the banner changes in one request. Leave without saving and nothing
 * was stored anywhere.
 * Width, height and speed of the banners are in Customize -> "Sliding banners". */

window.AdminBanners = (() => {
  const MAX_PLACE = 500;
  const MAX_SIDE = 1200;
  const API = "/api/admin/site/banners";
  const EMOJIS = ["🎉", "🔥", "✨", "🪔", "🎆", "🎊", "⭐", "💥", "🎁", "💰", "🏷️", "🛒", "🍗", "🥩", "🐟", "🥚", "🍖", "😍", "❤️", "👉", "✅", "☀️", "🌟", "🎯"];
  /** The same bin icon as the cart on the customer website. */
  const BIN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));

  let host = null;
  let list = null; // null = not loaded yet; otherwise the banners (see toLocal)
  let loadingList = false;
  let listFailed = false;
  let categories = []; // category names (with the short list when the server has them ready, else when the menu is first opened)
  let categoriesKnown = false;
  let categoriesLoading = null;
  let products = null; // id -> { n, c, e, o }: the whole item list, only needed when "Choose item" is used
  let productsFrom = null; // the shared list `products` was built from
  let productsLoading = null;
  let openPicker = null; // "setIndex:slideIndex" of the item search that is open
  let busy = 0; // uploads running
  let saving = false;
  const removed = new Map(); // saved banners to delete when Save is pressed: id -> the banner (so Cancel can bring it back)
  let baseOrder = []; // ids of the banners in the order the server has them (for Cancel)
  const expanded = new Set(); // ids of the banners that are opened (all start minimized)
  let openCats = -1; // index of the banner whose "show in" dropdown is open (kept open while the page redraws)

  /** What to show for a picture: the one still in this browser (not saved yet), or the saved one. */
  const slideSrc = (s) => s.preview || imgSrc(s.imageId);
  const imgSrc = (id) => Utils.resolveImageUrl(`/api/store/site/banner/${encodeURIComponent(id)}`);
  const newId = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "a").padEnd(8, "x");

  /** One banner as the page keeps it. `slides` stays null until the banner is opened (then it is loaded). */
  function toLocal(s) {
    return {
      id: s.id,
      enabled: s.enabled !== false,
      title: s.title || "",
      place: Math.max(1, Number(s.place) || 1),
      showIn: Array.isArray(s.showIn) ? s.showIn.slice() : [],
      slideCount: Number(s.slides) || 0,
      slides: Array.isArray(s.pics) ? s.pics.map((x) => ({ imageId: x.imageId, productId: x.productId || null })) : null,
      items: {},
      itemsReady: false, // have the names of the items its pictures open been looked up?
      loading: false,
      failed: false,
      isNew: false,
      dirty: new Set(), // which fields were changed here and are not saved yet
    };
  }

  /** Remembers how a banner is on the server, so Cancel can put it back without asking the server. */
  function snap(set) {
    set.orig = {
      enabled: set.enabled,
      title: set.title,
      place: set.place,
      showIn: set.showIn.slice(),
      slideCount: set.slideCount,
      slides: set.slides ? set.slides.map((x) => ({ imageId: x.imageId, productId: x.productId || null })) : null,
    };
  }

  const anyDirty = () => !!list && (removed.size > 0 || list.some((s) => s.isNew || s.dirty.size > 0));

  // ---- loading ----------------------------------------------------------------------------------------------
  /** Called whenever the Banners tab is opened: the first time it loads the short list, later it costs nothing. */
  function refresh() {
    ensureMounted();
    if (!host) return;
    if (list || loadingList) return;
    loadingList = true;
    listFailed = false;
    render();
    Api.get(API)
      .then((res) => {
        list = ((res && res.banners) || []).map(toLocal);
        list.forEach(snap);
        baseOrder = list.map((x) => x.id);
        categoriesKnown = Array.isArray(res && res.categories);
        categories = categoriesKnown ? res.categories : [];
      })
      .catch((err) => {
        listFailed = true;
        Toast.show(err.message || "Couldn't load your banners", "error");
      })
      .finally(() => {
        loadingList = false;
        render();
      });
  }

  /** Makes a banner ready to show when it is opened: its pictures are already here (they came with the list); only the names
   *  of the items they open may still be needed. */
  function ensureLoaded(set) {
    if (!set || set.isNew || set.loading) return;
    if (set.slides) return ensureItems(set);
    // (an older server that does not send the pictures with the list: ask for this one banner)
    set.loading = true;
    set.failed = false;
    renderCard(set.id);
    Api.get(`${API}/${encodeURIComponent(set.id)}`)
      .then((d) => {
        const b = d.banner || {};
        set.slides = (b.slides || []).map((x) => ({ imageId: x.imageId, productId: x.productId || null }));
        set.slideCount = set.slides.length;
        set.items = d.items || {};
        set.itemsReady = true;
        snap(set);
      })
      .catch((err) => {
        set.failed = true;
        Toast.show(err.message || "Couldn't open that banner", "error");
      })
      .finally(() => {
        set.loading = false;
        renderCard(set.id);
      });
  }

  const productIdsOf = (set) => [...new Set((set.slides || []).map((x) => x.productId).filter(Boolean))];

  /** Looks up the names of the items this banner's pictures open: from the Products list if the page has it already (no
   *  request), otherwise ONE small request for just those items. Only the "Opens:" lines are redrawn when they arrive. */
  function ensureItems(set) {
    if (set.itemsReady || set.itemsLoading) return;
    const ids = productIdsOf(set);
    if (!ids.length) {
      set.itemsReady = true;
      return;
    }
    const known = window.AdminProducts && window.AdminProducts.peekIndex ? window.AdminProducts.peekIndex() : null;
    if (Array.isArray(known)) {
      const byId = new Map(known.map((r) => [r.id, r]));
      ids.forEach((id) => {
        const r = byId.get(id);
        if (r) set.items[id] = { id, n: r.n, c: r.c || "", e: !!r.e };
      });
      set.itemsReady = true;
      refreshOpens(set);
      return;
    }
    set.itemsLoading = true;
    Api.get(`${API}/items?ids=${ids.join(",")}`)
      .then((d) => {
        Object.assign(set.items, d.items || {});
        set.itemsReady = true;
      })
      .catch(() => {
        set.itemsReady = true; // couldn't look the names up: show "Item #id" instead of waiting forever
      })
      .finally(() => {
        set.itemsLoading = false;
        refreshOpens(set);
      });
  }

  /** Redraws just the "Opens: ..." lines of one banner (so nothing else on screen is disturbed). */
  function refreshOpens(set) {
    const si = list ? list.indexOf(set) : -1;
    const card = si >= 0 && host && host.querySelector(`.bn-set[data-bn-si="${si}"]`);
    if (!card || !set.slides) return;
    card.querySelectorAll(".bn-slide").forEach((el) => {
      const s = set.slides[Number(el.dataset.bnIi)];
      const box = el.querySelector(".bn-opens-note");
      if (s && box) box.innerHTML = opensNote(set, s);
    });
  }

  /** The whole item list - only when someone wants to choose an item. It is the Products page's own short list (asked for
   *  once, kept up to date by that page), so if the search there was used already this costs nothing. */
  function loadProducts() {
    if (!productsLoading) {
      const source = window.AdminProducts && window.AdminProducts.getIndex ? window.AdminProducts.getIndex() : Api.get("/api/admin/products/index");
      productsLoading = Promise.resolve(source)
        .then((rows) => {
          if (rows !== productsFrom) {
            products = new Map((rows || []).map((r) => [r.id, r]));
            productsFrom = rows;
          }
        })
        .catch(() => {
          products = products || new Map();
        })
        .finally(() => {
          productsLoading = null;
          const box = host && host.querySelector("[data-bn-results]");
          if (box) box.innerHTML = resultsHtml(host.querySelector(".bn-search") ? host.querySelector(".bn-search").value : "");
        });
    }
    return productsLoading;
  }

  /** The category names - only when the menu is opened and the server did not send them with the list. */
  function loadCategories() {
    if (categoriesKnown) return Promise.resolve();
    if (!categoriesLoading) {
      categoriesLoading = Api.get(`${API}/categories`)
        .then((r) => {
          categories = Array.isArray(r && r.categories) ? r.categories : [];
          categoriesKnown = true;
        })
        .catch(() => {})
        .finally(() => {
          categoriesLoading = null;
        });
    }
    return categoriesLoading;
  }

  // ---- "show in" dropdown: All categories / the ALL tab / chosen categories ------------------------------
  const ALL_TAB = "@all";

  /** The category names to offer, plus any already chosen but no longer in use. */
  function categoryNames(chosen) {
    const names = categories.slice();
    chosen.forEach((c) => c !== ALL_TAB && !names.includes(c) && names.push(c));
    return names;
  }

  function catsSummary(showIn) {
    if (!showIn.length) return "All categories (ALL tab + every category)";
    const parts = [];
    if (showIn.includes(ALL_TAB)) parts.push("ALL");
    showIn.filter((c) => c !== ALL_TAB).forEach((c) => parts.push(c));
    return parts.length === 1 && parts[0] === "ALL" ? "ALL tab only" : parts.join(" + ");
  }

  function catsItems(set) {
    const showIn = Array.isArray(set.showIn) ? set.showIn : [];
    const box = (value, checked, label, note) =>
      `<label class="bn-cat"><input type="checkbox" data-bn-cat="${esc(value)}" ${checked ? "checked" : ""} /><span>${esc(label)}${note ? ` <small>${esc(note)}</small>` : ""}</span></label>`;
    return `
          ${box("*", !showIn.length, "All categories", "- the ALL tab and every category")}
          ${box(ALL_TAB, showIn.includes(ALL_TAB), "ALL", "- the first tab, with every product")}
          ${categoryNames(showIn).map((c) => box(c, showIn.includes(c), c, "")).join("")}`;
  }

  function catsMenu(set, si) {
    const showIn = Array.isArray(set.showIn) ? set.showIn : [];
    return `
      <details class="bn-cats" data-bn-cats ${openCats === si ? "open" : ""}>
        <summary class="bn-cats-btn" data-bn-cats-summary>${esc(catsSummary(showIn))}</summary>
        <div class="bn-cats-menu">${catsItems(set)}
        </div>
      </details>`;
  }

  // ---- drawing -------------------------------------------------------------------------------------------
  const infoOf = (set, id) => (set.items && (set.items[id] || set.items[String(id)])) || null;

  /** What a picture opens, in words. Shows "..." until the item names have been looked up. */
  function opensNote(set, s) {
    if (!s.productId) return `<span class="bn-muted">Not tappable</span>`;
    const p = infoOf(set, s.productId);
    if (p) return `<b>${esc(p.n)}</b>${p.c ? ` <span class="bn-muted">· ${esc(p.c)}</span>` : ""}${p.e ? "" : ` <span class="bn-warn">hidden from customers</span>`}`;
    if (!set.itemsReady) return `<span class="bn-muted">…</span>`;
    return `<b>Item #${s.productId}</b> <span class="bn-warn">not found (deleted?)</span>`;
  }

  function slideRow(set, s, si, ii, count) {
    const key = `${si}:${ii}`;
    return `
      <div class="bn-slide" data-bn-si="${si}" data-bn-ii="${ii}">
        <label class="bn-thumb-wrap" title="Change this banner image">
          <img class="bn-thumb" src="${esc(slideSrc(s))}" alt="Picture ${ii + 1}" loading="lazy" />
          <span class="bn-thumb-change">Change image</span>
          <input type="file" accept="image/*" data-bn-replace hidden />
        </label>
        <div class="bn-slide-main">
          <div class="bn-opens"><span class="bn-opens-label">Opens:</span> <span class="bn-opens-note">${opensNote(set, s)}</span></div>
          <div class="bn-slide-btns">
            <button type="button" class="bn-btn" data-bn="pick">${s.productId ? "Change item" : "Choose item"}</button>
            ${s.productId ? `<button type="button" class="bn-btn" data-bn="unpick">Not tappable</button>` : ""}
          </div>
        </div>
        <div class="bn-tools">
          <button type="button" class="bn-icon" data-bn="up" aria-label="Move picture up" ${ii === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="bn-icon" data-bn="down" aria-label="Move picture down" ${ii === count - 1 ? "disabled" : ""}>▼</button>
          <button type="button" class="bn-icon bn-bin" data-bn="del-slide" aria-label="Remove picture" title="Remove picture">${BIN}</button>
        </div>
        ${openPicker === key ? pickerHtml() : ""}
      </div>`;
  }

  function pickerHtml() {
    return `
      <div class="bn-picker">
        <input type="search" class="bn-search" placeholder="Search your items…" autocomplete="off" spellcheck="false" aria-label="Search items" />
        <div class="bn-results" data-bn-results>${resultsHtml("")}</div>
      </div>`;
  }

  function resultsHtml(term) {
    if (!products) return `<div class="bn-muted bn-pad">Loading your items…</div>`;
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const [id, r] of products) {
      const h = `${r.n} ${r.c || ""}`.toLowerCase();
      if (words.every((w) => h.includes(w))) hits.push([id, r]);
      if (hits.length >= 8) break;
    }
    if (!hits.length) return `<div class="bn-muted bn-pad">No item matches.</div>`;
    return hits
      .map(
        ([id, r]) =>
          `<button type="button" class="bn-result" data-bn="choose" data-bn-id="${id}"><span>${esc(r.n)}</span><span class="bn-muted">${esc(r.c || "")}${r.e ? "" : " · hidden"}</span></button>`
      )
      .join("");
  }

  const shortCats = (showIn) => (showIn && showIn.length ? catsSummary(showIn) : "All categories");

  /** The one-line summary shown on a minimized banner. */
  function headHtml(set, si) {
    const n = set.slides ? set.slides.length : set.slideCount;
    const label = (set.title || "").trim();
    const sub = [
      set.enabled === false ? "OFF" : null,
      `Position ${Math.max(1, Number(set.place) || 1)}`,
      `${n} picture${n === 1 ? "" : "s"}`,
      shortCats(set.showIn),
    ].filter(Boolean);
    return `<b class="bn-head-name">Banner ${si + 1}${label ? ` · ${esc(label)}` : ""}</b><span class="bn-head-sub">${esc(sub.join(" · "))}</span>`;
  }

  function refreshHead(si) {
    const set = list[si];
    const el = host && host.querySelector(`.bn-set[data-bn-si="${si}"] .bn-head-text`);
    if (set && el) el.innerHTML = headHtml(set, si);
  }

  function bodyHtml(set, si) {
    if (set.loading) return `<div class="bn-muted bn-pad">Opening this banner…</div>`;
    if (!set.slides) {
      return `<div class="bn-muted bn-pad">Couldn't open this banner. <button type="button" class="bn-link" data-bn="reload">Try again</button></div>`;
    }
    const slides = set.slides;
    return `
          <div class="field">
            <label>Banner name (customers see this)</label>
            <input type="text" data-bn-field="title" enterkeyhint="done" maxlength="80" value="${esc(set.title || "")}" placeholder="e.g. Ramadan offer" autocomplete="off" />
            <div class="bn-emojis" aria-label="Add an emoji">${EMOJIS.map((e) => `<button type="button" class="bn-emoji" data-bn="emoji" data-bn-emoji="${e}" aria-label="Add ${e}">${e}</button>`).join("")}</div>
          </div>
          <div class="bn-two">
            <div class="field">
              <label>Position</label>
              <input type="number" data-bn-field="place" enterkeyhint="done" inputmode="numeric" min="1" max="${MAX_PLACE}" step="1" value="${Math.max(1, Number(set.place) || 1)}" />
            </div>
            <div class="field bn-grow">
              <label>Select Category</label>
              ${catsMenu(set, si)}
            </div>
          </div>
          <div class="bn-slides">
            ${slides.map((s, ii) => slideRow(set, s, si, ii, slides.length)).join("") || `<div class="bn-muted bn-pad">No pictures yet.</div>`}
          </div>
          <label class="bn-add-pics">
            <span>⬆ Add banner images</span>
            <input type="file" accept="image/*" multiple data-bn-upload hidden />
          </label>`;
  }

  function setCard(set, si) {
    const open = expanded.has(set.id);
    return `
      <div class="bn-set ${open ? "open" : ""}" data-bn-si="${si}">
        <div class="bn-set-head">
          <button type="button" class="bn-toggle" data-bn="toggle" aria-expanded="${open}">
            <span class="bn-chev" aria-hidden="true">▸</span>
            <span class="bn-head-text">${headHtml(set, si)}</span>
          </button>
          <button type="button" class="bn-del" data-bn="del-set" aria-label="Remove this banner" title="Remove this banner">${BIN}</button>
          <label class="switch" title="Show this banner to customers"><input type="checkbox" data-bn-field="enabled" ${set.enabled !== false ? "checked" : ""} /><span class="track"></span></label>
        </div>
        <div class="bn-set-body" ${open ? "" : "hidden"}>${open ? bodyHtml(set, si) : ""}</div>
      </div>`;
  }

  /** Redraws one banner only (opening / closing it, or when its details arrive) - the rest of the page stays put. */
  function renderCard(id) {
    if (!host || !list) return;
    const si = list.findIndex((s) => s.id === id);
    const el = si >= 0 && host.querySelector(`.bn-set[data-bn-si="${si}"]`);
    if (!el) return render();
    const tmp = document.createElement("div");
    tmp.innerHTML = setCard(list[si], si);
    el.replaceWith(tmp.firstElementChild);
  }

  function render() {
    if (!host) return;
    if (!list) {
      host.innerHTML = listFailed
        ? `<div class="empty-state"><p>Couldn't load your banners.</p><button type="button" class="btn btn-outline btn-sm" data-bn="retry">Try again</button></div>`
        : `<div class="empty-state"><p>Loading…</p></div>`;
      return;
    }
    const focused = document.activeElement;
    const keepSearch = focused && focused.classList && focused.classList.contains("bn-search");
    const searchValue = keepSearch ? focused.value : "";
    host.innerHTML = `
      <div class="bn-bar">
        <span class="bn-count">${list.length} banner${list.length === 1 ? "" : "s"}</span>
        <button type="button" class="btn btn-gold btn-sm" data-bn="add-set">+ Add banner</button>
      </div>
      <div class="bn-sets">${list.map(setCard).join("")}</div>
      <div class="cz-savebar bn-savebar" hidden>
        <span class="cz-dirty" id="bnDirty" hidden>Unsaved changes</span>
        <button type="button" class="btn btn-ghost" data-bn="cancel" id="bnCancel">Cancel</button>
        <button type="button" class="btn btn-gold" data-bn="save" id="bnSave" disabled>Save</button>
      </div>`;
    syncBar();
    if (!list.length) host.querySelector(".bn-sets").innerHTML = `<div class="bn-muted bn-pad">No banners yet - tap "+ Add banner".</div>`;
    if (keepSearch) {
      const box = host.querySelector(".bn-search");
      if (box) {
        box.value = searchValue;
        box.focus();
      }
    }
  }

  /** Shows the Save bar only when something was changed. */
  function syncBar() {
    if (!host) return;
    const pending = anyDirty();
    const bar = host.querySelector(".bn-savebar");
    if (bar) bar.hidden = !(pending || saving);
    const dirty = host.querySelector("#bnDirty");
    if (dirty) dirty.hidden = !pending;
    const save = host.querySelector("#bnSave");
    if (save) save.disabled = saving || !pending;
    const cancel = host.querySelector("#bnCancel");
    if (cancel) cancel.disabled = saving;
  }

  const touch = (set, field) => {
    set.dirty.add(field);
    syncBar();
  };

  /** Throws away everything not saved yet and shows the banners as they are on the server - no request needed. */
  function cancelChanges() {
    if (saving || !list || !anyDirty()) return;
    if (!window.confirm("Throw away your unsaved changes?")) return;
    const free = (sl) => sl && sl.preview && sl.pending && URL.revokeObjectURL(sl.preview);
    for (const s of list) {
      if (s.isNew) (s.slides || []).forEach(free);
    }
    list = list.filter((s) => !s.isNew);
    removed.forEach((s) => list.push(s)); // deleted by mistake: back they come
    removed.clear();
    list.sort((a, b) => baseOrder.indexOf(a.id) - baseOrder.indexOf(b.id));
    for (const s of list) {
      const o = s.orig;
      if (o && s.dirty.size) {
        (s.slides || []).forEach(free);
        s.enabled = o.enabled;
        s.title = o.title;
        s.place = o.place;
        s.showIn = o.showIn.slice();
        s.slideCount = o.slideCount;
        if (o.slides) s.slides = o.slides.map((x) => ({ imageId: x.imageId, productId: x.productId || null }));
      }
      s.dirty.clear();
    }
    expanded.clear(); // back to how the tab looked when it was opened: every banner minimized
    openPicker = null;
    openCats = -1;
    render();
    Toast.show("Changes thrown away", "success");
  }

  // ---- saving -----------------------------------------------------------------------------------------------
  async function runSave() {
    if (busy > 0) {
      Toast.show("Wait a moment - a picture is still being prepared", "error");
      return;
    }
    if (saving || !list) return;
    for (const [i, s] of list.entries()) {
      if ((s.isNew || s.dirty.has("slides")) && !(s.slides && s.slides.length)) {
        expanded.add(s.id);
        render();
        Toast.show(`Banner ${i + 1} needs at least one picture`, "error");
        return;
      }
    }
    saving = true;
    const btn = host.querySelector("#bnSave");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> Saving...`;
    }
    let ok = true;
    try {
      // ONE request for everything: the banners to remove, for every other changed banner only the fields that changed (a new
      // banner is sent in full) and - when pictures were added - the new pictures themselves. A slide that uses the first new
      // picture says imageId -1, the second -2 ...; the server swaps in the real ids, writes once and tells the storefronts once.
      const changed = list.filter((x) => x.isNew || x.dirty.size > 0);
      const fresh = []; // the new pictures, in the order they are sent
      const changes = changed.map((s) => {
        const all = s.isNew;
        const body = { id: s.id };
        if (all || s.dirty.has("enabled")) body.enabled = s.enabled;
        if (all || s.dirty.has("title")) body.title = s.title;
        if (all || s.dirty.has("place")) body.place = s.place;
        if (all || s.dirty.has("showIn")) body.showIn = s.showIn;
        if (all || s.dirty.has("slides")) {
          body.slides = s.slides.map((x) => {
            if (x.pending) {
              fresh.push(x);
              return { imageId: -fresh.length, productId: x.productId || null };
            }
            return { imageId: x.imageId, productId: x.productId || null };
          });
        }
        return body;
      });
      const payload = { remove: [...removed.keys()], banners: changes };
      let res;
      if (fresh.length) {
        const form = new FormData();
        form.append("data", JSON.stringify(payload));
        fresh.forEach((x) => form.append("files", x.pending, "banner.jpg"));
        res = await Api.upload(`${API}/save`, form);
        const ids = (res && res.pictures) || [];
        if (ids.length !== fresh.length) throw new Error("A picture was not saved - please try again");
        // the picture keeps showing from this browser (no need to download it again); it now has its real id
        fresh.forEach((x, i) => {
          x.imageId = ids[i];
          x.pending = null;
        });
      } else {
        res = await Api.put(API, payload);
      }
      removed.clear();
      const saved = new Map(((res && res.banners) || []).map((b) => [b.id, b]));
      for (const s of changed) {
        const r = saved.get(s.id);
        if (r) {
          s.enabled = r.enabled !== false;
          s.title = r.title || "";
          s.place = r.place || s.place;
          s.showIn = Array.isArray(r.showIn) ? r.showIn : s.showIn;
          s.slideCount = Number(r.slides) || s.slideCount;
        }
        s.dirty.clear();
        s.isNew = false;
        snap(s);
      }
      baseOrder = list.map((x) => x.id);
      Toast.show("Saved - the customer website is updated", "success");
    } catch (err) {
      ok = false;
      Toast.show(err.message || "Couldn't save", "error");
    } finally {
      saving = false;
      render();
    }
    return ok;
  }

  // ---- uploading --------------------------------------------------------------------------------------------
  /** Shrinks a picture in the browser (longest side 1200 px, JPEG) so it is small to upload and to store. */
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("That file isn't a picture this browser can read"));
        i.src = url;
      });
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // a transparent PNG gets a white background instead of black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("Couldn't prepare that picture");
      return new File([blob], "banner.jpg", { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const MAX_PICTURE_BYTES = 40 * 1024 * 1024; // a photo bigger than this is not even tried (a phone could run out of memory)

  /** Checks one chosen file and shrinks it. Throws a plain-words error when it can't be used. */
  async function prepare(file) {
    if (file.type && !file.type.startsWith("image/")) throw new Error(`"${file.name}" isn't a picture`);
    if (file.size > MAX_PICTURE_BYTES) throw new Error(`"${file.name}" is too big (over 40 MB)`);
    return shrink(file);
  }

  /** Swaps one picture of a banner for another (the item it opens stays). Nothing is sent until Save. */
  async function replaceImage(input) {
    const slideEl = input.closest(".bn-slide");
    const si = Number(input.closest(".bn-set").dataset.bnSi);
    const ii = Number(slideEl.dataset.bnIi);
    const file = (input.files || [])[0];
    input.value = "";
    const set = list && list[si];
    if (!file || !set || !set.slides || !set.slides[ii]) return;
    busy++;
    try {
      const small = await prepare(file);
      const old = set.slides[ii];
      if (old.preview && old.pending) URL.revokeObjectURL(old.preview);
      set.slides[ii] = { imageId: null, pending: small, preview: URL.createObjectURL(small), productId: old.productId || null };
      touch(set, "slides");
      renderCard(set.id);
      Toast.show("Image changed - it is saved when you press Save", "success");
    } catch (err) {
      Toast.show(err.message || "Couldn't use that picture", "error");
    } finally {
      busy--;
    }
  }

  /** Checks and shrinks the chosen pictures and adds them to the banner. Nothing is sent to the server here. */
  async function upload(input) {
    const si = Number(input.closest(".bn-set").dataset.bnSi);
    const files = [...(input.files || [])];
    input.value = "";
    const set = list && list[si];
    if (!files.length || !set || !set.slides) return;
    busy++;
    let added = 0;
    let failed = "";
    try {
      for (const file of files) {
        try {
          const small = await prepare(file);
          set.slides.push({ imageId: null, pending: small, preview: URL.createObjectURL(small), productId: null });
          set.slideCount = set.slides.length;
          added++;
          touch(set, "slides");
          renderCard(set.id);
        } catch (err) {
          failed = err.message || "Couldn't add that picture";
        }
      }
    } finally {
      busy--;
    }
    if (failed) Toast.show(added ? `${added} added - but one was skipped: ${failed}` : failed, "error");
    else Toast.show(added === 1 ? "Banner image added - it is saved when you press Save" : `${added} banner images added - they are saved when you press Save`, "success");
  }

  // ---- events -----------------------------------------------------------------------------------------------
  function ctxOf(el) {
    const slide = el.closest(".bn-slide");
    const set = el.closest(".bn-set");
    return {
      si: set ? Number(set.dataset.bnSi) : -1,
      ii: slide ? Number(slide.dataset.bnIi) : -1,
    };
  }

  function ensureMounted() {
    if (host) return;
    host = document.getElementById("bannersRoot");
    if (!host) return;

    // While a text box is being typed in, the Save / Cancel bar steps aside (it would sit on top of the box and the keyboard).
    // It comes back as soon as the box is left: Enter / Done, or a tap anywhere that is not a text box.
    const isTyping = (el) => !!el && el.matches && el.matches('input:not([type="checkbox"]):not([type="file"]), textarea');
    host.addEventListener("focusin", (e) => {
      if (isTyping(e.target)) host.classList.add("bn-typing");
    });
    host.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!isTyping(document.activeElement)) host.classList.remove("bn-typing");
      }, 0);
    });
    host.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && isTyping(e.target) && e.target.type !== "search") e.target.blur();
    });
    host.addEventListener("touchstart", (e) => {
      const a = document.activeElement;
      if (isTyping(a) && !e.target.closest("input, textarea, label")) a.blur(); // a tap elsewhere closes the keyboard
    }, { passive: true });

    // remember which dropdown is open (the page redraws now and then)
    host.addEventListener(
      "toggle",
      (e) => {
        const d = e.target;
        if (!d.matches || !d.matches("[data-bn-cats]")) return;
        const si = ctxOf(d).si;
        if (d.open) {
          openCats = si;
          if (!categoriesKnown) {
            // the names were not ready with the list: fetch them now (once) and fill the menu in place
            loadCategories().then(() => {
              const set = list && list[si];
              const menu = d.isConnected && d.querySelector(".bn-cats-menu");
              if (set && menu) menu.innerHTML = catsItems(set);
            });
          }
        } else if (openCats === si) openCats = -1;
      },
      true
    );
    // a tap anywhere else closes an open dropdown
    document.addEventListener("click", (e) => {
      if (!host || e.target.closest("[data-bn-cats]")) return;
      host.querySelectorAll("[data-bn-cats][open]").forEach((d) => (d.open = false));
    });
    host.addEventListener("mousedown", (e) => {
      if (e.target.closest(".bn-emoji")) e.preventDefault(); // the cursor stays in the text box
    });
    host.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bn]");
      if (!btn) return;
      const act = btn.dataset.bn;
      if (act === "retry") {
        listFailed = false;
        refresh();
        return;
      }
      if (!list) return;
      const { si, ii } = ctxOf(btn);
      const set = list[si];
      if (act === "toggle" && set) {
        const open = !expanded.has(set.id);
        if (open) expanded.add(set.id);
        else expanded.delete(set.id);
        renderCard(set.id);
        if (open) ensureLoaded(set);
      } else if (act === "reload" && set) {
        set.failed = false;
        ensureLoaded(set);
      } else if (act === "save") {
        runSave();
      } else if (act === "cancel") {
        cancelChanges();
      } else if (act === "emoji") {
        const input = btn.closest(".bn-set").querySelector('input[data-bn-field="title"]');
        if (!input || !set) return;
        const em = btn.dataset.bnEmoji;
        if (input.value.length + em.length > input.maxLength) {
          Toast.show("The banner name is full - shorten it to add more", "error");
          return;
        }
        const from = input.selectionStart == null ? input.value.length : input.selectionStart;
        const to = input.selectionEnd == null ? from : input.selectionEnd;
        input.value = input.value.slice(0, from) + em + input.value.slice(to);
        const at = from + em.length;
        try {
          input.setSelectionRange(at, at);
        } catch (_) {}
        set.title = input.value;
        touch(set, "title");
        refreshHead(si);
      } else if (act === "add-set") {
        const place = list.length ? Math.min(MAX_PLACE, Math.max(...list.map((x) => Number(x.place) || 1)) + 4) : 1;
        const fresh = toLocal({ id: newId(), enabled: false, title: "", place, showIn: [], slides: 0 });
        fresh.isNew = true;
        fresh.itemsReady = true;
        fresh.slides = [];
        list.push(fresh);
        expanded.add(fresh.id); // a new banner opens so it can be filled in
        render();
        const card = host.querySelector(`.bn-set[data-bn-si="${list.length - 1}"]`);
        // the banner name box is ready to type in (the keyboard opens straight away on a phone)
        const nameBox = card && card.querySelector('input[data-bn-field="title"]');
        if (nameBox) nameBox.focus({ preventScroll: true });
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (act === "del-set" && set) {
        if (!window.confirm("Remove this banner? (Press Save to apply.)")) return;
        list.splice(si, 1);
        (set.slides || []).forEach((x) => x.preview && URL.revokeObjectURL(x.preview));
        if (!set.isNew) removed.set(set.id, set);
        openPicker = null;
        render();
      } else if (act === "del-slide" && set && set.slides) {
        const [gone] = set.slides.splice(ii, 1);
        if (gone && gone.preview) URL.revokeObjectURL(gone.preview);
        set.slideCount = set.slides.length;
        openPicker = null;
        touch(set, "slides");
        renderCard(set.id);
      } else if ((act === "up" || act === "down") && set && set.slides) {
        const j = act === "up" ? ii - 1 : ii + 1;
        if (j < 0 || j >= set.slides.length) return;
        [set.slides[ii], set.slides[j]] = [set.slides[j], set.slides[ii]];
        openPicker = null;
        touch(set, "slides");
        renderCard(set.id);
      } else if (act === "pick" && set) {
        const key = `${si}:${ii}`;
        openPicker = openPicker === key ? null : key;
        loadProducts(); // the whole item list, only now
        renderCard(set.id);
        const box = host.querySelector(".bn-search");
        if (box) box.focus();
      } else if (act === "unpick" && set && set.slides) {
        set.slides[ii].productId = null;
        touch(set, "slides");
        renderCard(set.id);
      } else if (act === "choose" && set && set.slides) {
        const id = Number(btn.dataset.bnId);
        set.slides[ii].productId = id;
        const row = products && products.get(id);
        if (row) set.items[id] = { id, n: row.n, c: row.c || "", e: !!row.e };
        openPicker = null;
        touch(set, "slides");
        renderCard(set.id);
      }
    });

    host.addEventListener("input", (e) => {
      const t = e.target;
      if (t.classList.contains("bn-search")) {
        const out = host.querySelector("[data-bn-results]");
        if (out) out.innerHTML = resultsHtml(t.value);
        return;
      }
      const field = t.dataset.bnField;
      const set = field && list ? list[ctxOf(t).si] : null;
      if (!set) return;
      if (field === "title") {
        set.title = t.value;
        touch(set, "title");
        refreshHead(ctxOf(t).si);
      } else if (field === "place") {
        const n = Number(t.value);
        if (t.value !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_PLACE) {
          set.place = n;
          touch(set, "place");
          refreshHead(ctxOf(t).si);
        }
      }
    });

    host.addEventListener("change", (e) => {
      const t = e.target;
      if (!list) return;
      if (t.dataset.bnCat !== undefined) {
        const si = ctxOf(t).si;
        const set = list[si];
        if (!set) return;
        const menu = t.closest("[data-bn-cats]");
        const value = t.dataset.bnCat;
        let cats = Array.isArray(set.showIn) ? set.showIn.slice() : [];
        if (value === "*") cats = []; // "All categories" is exclusive (and unticking it alone changes nothing)
        else if (t.checked) cats.push(value);
        else cats = cats.filter((c) => c !== value);
        set.showIn = cats;
        menu.querySelectorAll("[data-bn-cat]").forEach((cb) => {
          cb.checked = cb.dataset.bnCat === "*" ? !cats.length : cats.includes(cb.dataset.bnCat);
        });
        menu.querySelector("[data-bn-cats-summary]").textContent = catsSummary(cats);
        touch(set, "showIn");
        refreshHead(si);
        return;
      }
      if (t.dataset.bnUpload !== undefined) return upload(t);
      if (t.dataset.bnReplace !== undefined) return replaceImage(t);
      const field = t.dataset.bnField;
      if (!field) return;
      const set = list[ctxOf(t).si];
      if (!set) return;
      if (field === "enabled") {
        set.enabled = t.checked;
        touch(set, "enabled");
        refreshHead(ctxOf(t).si);
      } else if (field === "place") {
        // left the box: anything unusable (empty, 0, decimals, too big) snaps to the nearest allowed number
        const n = Math.max(1, Math.min(MAX_PLACE, Math.round(Number(t.value)) || 1));
        t.value = n;
        if (set.place !== n) {
          set.place = n;
          touch(set, "place");
        }
      }
    });

    // the page you leave while unsaved changes exist
    window.addEventListener("beforeunload", (e) => {
      if (anyDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  return {
    refresh,
    render,
    syncBar,
    isBusy: () => busy > 0,
    isDirty: anyDirty,
    /** The category names already fetched (null until known) - shared with the Featured Products section. */
    categoryNames: () => (categoriesKnown ? categories.slice() : null),
  };
})();
