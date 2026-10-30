/* Admin -> Banners tab -> "Featured Products" section.
 *
 * Works like the banners below it: "+ Add featured row" makes another row, every row has its own switch, delete button,
 * title, line under the title, Position (1 = above the first product, 5 = after the first 4 products ...), Select
 * Category (where it shows) and ANY number of products in the order customers should see them. The customer website shows
 * each row as a swipeable strip among the products (see site-specials.js).
 *
 * Built to ask the server for as little as possible:
 *  - the section is read ONCE (one tiny request: the rows and the names of their products - from memory on the server) and
 *    only again if the page was left unused for a long time;
 *  - the list of all products is only needed when a "search to add" box is used, and it is the same list the Products
 *    search and the Banners tab use, so it is asked for once for all of them;
 *  - the category names are the same short list the Banners tab uses (asked for once, only when a menu is opened);
 *  - Save is ONE request carrying the rows.
 * The rows belong to the live website, not to a template, so Customize never touches them.
 *
 * To remove the feature completely: delete this file, css/admin-specials.css, their tags and the specialsRoot line in
 * admin.html, and the AdminSpecials line in admin-main.js. */

window.AdminSpecials = (() => {
  const API = "/api/admin/site/specials";
  const CATS_API = "/api/admin/site/banners/categories";
  const ALL_TAB = "@all";
  const MAX_PLACE = 500;
  const STALE_MS = 10 * 60 * 1000;
  const BIN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const newId = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, "a").padEnd(8, "x");

  let host = null;
  let saved = null; // what the server has: [{ id, enabled, title, subtitle, place, showIn, items:[{id,n,c,e}] }]
  let draft = null; // what the section shows now (the same shape), changed by the admin until Save
  let expanded = new Set();
  let openCats = ""; // id of the row whose category menu is open
  let loadedAt = 0;
  let loading = null;
  let failed = false;
  let saving = false;
  let products = null; // id -> { n, c, e }: the whole list, only needed for the search boxes
  let productsFrom = null;
  let productsLoading = null;
  let categories = [];
  let categoriesKnown = false;
  let categoriesLoading = null;

  const toLocal = (s) => ({
    id: String(s.id || newId()),
    enabled: s.enabled !== false,
    title: s.title || "",
    subtitle: s.subtitle || "",
    place: Math.max(1, Math.min(MAX_PLACE, Number(s.place) || 1)),
    bannerFirst: s.bannerFirst === true,
    showIn: Array.isArray(s.showIn) ? s.showIn.slice() : [],
    items: (s.items || []).map((i) => ({ id: i.id, n: i.n, c: i.c || "", e: i.e !== false })),
  });
  const cloneSet = (s) => ({ ...s, showIn: s.showIn.slice(), items: s.items.map((i) => ({ ...i })) });
  const key = (list) =>
    JSON.stringify(list.map((s) => [s.id, s.enabled, s.title, s.subtitle, s.place, s.bannerFirst, s.showIn, s.items.map((i) => i.id)]));
  const dirty = () => !!saved && !!draft && key(saved) !== key(draft);
  const find = (id) => (draft || []).find((s) => s.id === id);
  const indexOf = (id) => (draft || []).findIndex((s) => s.id === id);

  // ---- loading -----------------------------------------------------------------------------------
  function refresh() {
    ensureMounted();
    if (!host) return;
    if (saved && (dirty() || Date.now() - loadedAt < STALE_MS)) return; // nothing to ask: what we hold is right
    if (loading) return;
    failed = false;
    if (!saved) render();
    loading = Api.get(API)
      .then((r) => {
        saved = ((r && r.sets) || []).map(toLocal);
        draft = saved.map(cloneSet);
        loadedAt = Date.now();
      })
      .catch(() => {
        failed = !saved;
      })
      .finally(() => {
        loading = null;
        render();
      });
  }

  function loadProducts() {
    if (products || productsLoading) return productsLoading;
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
        paintResults();
      });
    return productsLoading;
  }

  /** The category names the Banners tab already fetched (it gets them together with its list): used as they are, so no
   * request of our own is needed in the usual case. */
  function primeCategories() {
    if (categoriesKnown) return;
    const shared = window.AdminBanners && window.AdminBanners.categoryNames && window.AdminBanners.categoryNames();
    if (Array.isArray(shared)) {
      categories = shared;
      categoriesKnown = true;
    }
  }

  function loadCategories() {
    primeCategories();
    if (categoriesKnown) return Promise.resolve();
    if (!categoriesLoading) {
      categoriesLoading = Api.get(CATS_API)
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

  // ---- "Select Category" dropdown (same as the banners): All categories / the ALL tab / chosen categories ---------
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
    primeCategories();
    const box = (value, checked, label, note) =>
      `<label class="bn-cat"><input type="checkbox" data-asp-cat="${esc(value)}" ${checked ? "checked" : ""} /><span>${esc(label)}${note ? ` <small>${esc(note)}</small>` : ""}</span></label>`;
    return `
          ${box("*", !set.showIn.length, "All categories", "- the ALL tab and every category")}
          ${box(ALL_TAB, set.showIn.includes(ALL_TAB), "ALL", "- the first tab, with every product")}
          ${categoryNames(set.showIn).map((c) => box(c, set.showIn.includes(c), c, "")).join("")}`;
  }

  function catsMenu(set) {
    primeCategories();
    return `
      <details class="bn-cats" data-asp-cats ${openCats === set.id ? "open" : ""}>
        <summary class="bn-cats-btn" data-asp-cats-summary>${esc(catsSummary(set.showIn))}</summary>
        <div class="bn-cats-menu">${catsItems(set)}
        </div>
      </details>`;
  }

  // ---- drawing -----------------------------------------------------------------------------------
  function headHtml(set, i) {
    const label = (set.title || "").trim();
    const n = set.items.length;
    const sub = [
      set.enabled ? null : "OFF",
      `Position ${set.place}${set.bannerFirst ? " (below banner)" : ""}`,
      n ? `${n} product${n === 1 ? "" : "s"}` : "no products yet",
      set.showIn.length ? catsSummary(set.showIn) : "All categories",
    ].filter(Boolean);
    return `<b class="bn-head-name">Featured ${i + 1}${label ? ` · ${esc(label)}` : ""}</b><span class="bn-head-sub">${esc(sub.join(" · "))}</span>`;
  }

  function itemRows(set) {
    if (!set.items.length) return `<div class="bn-muted bn-pad">No products yet - search below and tap a product to add it.</div>`;
    return set.items
      .map(
        (it, i) => `
        <div class="asp-row" data-asp-i="${i}">
          <span class="asp-num">${i + 1}</span>
          <span class="asp-name"><b>${esc(it.n)}</b><small>${esc(it.c)}${it.e ? "" : " · hidden (customers won't see it)"}</small></span>
          <button type="button" class="bn-icon" data-asp="up" aria-label="Move up" ${i === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="bn-icon" data-asp="down" aria-label="Move down" ${i === set.items.length - 1 ? "disabled" : ""}>▼</button>
          <button type="button" class="bn-icon bn-bin" data-asp="del" aria-label="Remove ${esc(it.n)}" title="Remove">${BIN}</button>
        </div>`
      )
      .join("");
  }

  function resultsHtml(set, term) {
    if (!products) return `<div class="bn-muted bn-pad">Loading your products…</div>`;
    const taken = new Set(set.items.map((i) => i.id));
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const [id, r] of products) {
      if (taken.has(id)) continue;
      const h = `${r.n} ${r.c || ""}`.toLowerCase();
      if (words.every((w) => h.includes(w))) hits.push([id, r]);
      if (hits.length >= 8) break;
    }
    if (!hits.length) return `<div class="bn-muted bn-pad">No product matches.</div>`;
    return hits
      .map(
        ([id, r]) =>
          `<button type="button" class="bn-result" data-asp="add" data-asp-id="${id}"><span>${esc(r.n)}</span><span class="bn-muted">${esc(r.c || "")}${r.e ? "" : " · hidden"}</span></button>`
      )
      .join("");
  }

  const countText = (n) => `${n} selected`;

  function bodyHtml(set) {
    return `
          <div class="field">
            <label>Title (customers see this)</label>
            <input type="text" data-asp-field="title" enterkeyhint="done" maxlength="60" value="${esc(set.title)}" placeholder="e.g. Featured Products (leave empty for no title)" autocomplete="off" />
          </div>
          <div class="field">
            <label>Line under the title</label>
            <input type="text" data-asp-field="subtitle" enterkeyhint="done" maxlength="80" value="${esc(set.subtitle)}" placeholder="e.g. Handpicked for you." autocomplete="off" />
          </div>
          <div class="bn-two">
            <div class="field">
              <label>Position</label>
              <input type="number" data-asp-field="place" enterkeyhint="done" inputmode="numeric" min="1" max="${MAX_PLACE}" step="1" value="${set.place}" />
            </div>
            <div class="field bn-grow">
              <label>Select Category</label>
              ${catsMenu(set)}
            </div>
          </div>
          <div class="field">
            <label>If a banner has the same Position</label>
            <select data-asp-field="bannerFirst">
              <option value="no" ${set.bannerFirst ? "" : "selected"}>Featured items on top, banner below</option>
              <option value="yes" ${set.bannerFirst ? "selected" : ""}>Banner on top, featured items below</option>
            </select>
          </div>
          <div class="asp-label"><label>Select Items</label><span class="bn-muted" data-asp-count>${countText(set.items.length)}</span></div>
          <div class="asp-list" data-asp-list>${itemRows(set)}</div>
          <div class="bn-picker asp-picker">
            <input type="search" class="bn-search" data-asp-search placeholder="Search your products to add…" enterkeyhint="search" autocomplete="off" spellcheck="false" aria-label="Search products to add" />
            <div class="bn-results" data-asp-results hidden></div>
          </div>`;
  }

  function setCard(set, i) {
    const open = expanded.has(set.id);
    return `
      <div class="bn-set asp ${open ? "open" : ""}" data-asp-id="${esc(set.id)}">
        <div class="bn-set-head">
          <button type="button" class="bn-toggle" data-asp="toggle" aria-expanded="${open}">
            <span class="bn-chev" aria-hidden="true">▸</span>
            <span class="bn-head-text">${headHtml(set, i)}</span>
          </button>
          <button type="button" class="bn-del" data-asp="del-set" aria-label="Remove this featured slider" title="Remove this featured slider">${BIN}</button>
          <label class="switch" title="Show this row to customers"><input type="checkbox" data-asp-field="enabled" ${set.enabled ? "checked" : ""} /><span class="track"></span></label>
        </div>
        <div class="bn-set-body" ${open ? "" : "hidden"}>${open ? bodyHtml(set) : ""}</div>
      </div>`;
  }

  const cardOf = (id) => host && [...host.querySelectorAll(".asp[data-asp-id]")].find((c) => c.dataset.aspId === id);

  function paintHead(id) {
    const i = indexOf(id);
    const el = i >= 0 && cardOf(id) && cardOf(id).querySelector(".bn-head-text");
    if (el) el.innerHTML = headHtml(draft[i], i);
  }

  const totalText = () => `${draft.length} featured slider${draft.length === 1 ? "" : "s"}`;

  function paintBar() {
    if (!host) return;
    const count = host.querySelector("[data-asp-total]");
    if (count) count.textContent = totalText();
    const actions = host.querySelector("[data-asp-actions]");
    if (actions) {
      actions.hidden = !dirty() && !saving;
      const save = actions.querySelector('[data-asp="save"]');
      const cancel = actions.querySelector('[data-asp="cancel"]');
      if (save) {
        save.disabled = saving || !dirty();
        save.textContent = saving ? "Saving…" : "Save";
      }
      if (cancel) cancel.disabled = saving;
    }
  }

  function paintList(id) {
    const set = find(id);
    const card = cardOf(id);
    if (!set || !card) return;
    const list = card.querySelector("[data-asp-list]");
    if (list) list.innerHTML = itemRows(set);
    const count = card.querySelector("[data-asp-count]");
    if (count) count.textContent = countText(set.items.length);
    paintHead(id);
    paintBar();
    paintResults();
  }

  function paintResults() {
    if (!host) return;
    host.querySelectorAll(".asp[data-asp-id]").forEach((card) => {
      const box = card.querySelector("[data-asp-results]");
      const input = card.querySelector("[data-asp-search]");
      const set = find(card.dataset.aspId);
      if (box && input && set && !box.hidden) box.innerHTML = resultsHtml(set, input.value);
    });
  }

  function render() {
    if (!host) return;
    if (!draft) {
      host.innerHTML = `<div class="bn-set asp"><div class="bn-muted bn-pad">${failed ? `Couldn't load Featured Products. <button type="button" class="bn-link" data-asp="retry">Try again</button>` : "Loading Featured Products…"}</div></div>`;
      return;
    }
    host.innerHTML = `
      <div class="bn-bar">
        <span class="bn-count" data-asp-total>${totalText()}</span>
        <button type="button" class="btn btn-gold btn-sm" data-asp="add-set">+ Add featured items</button>
      </div>
      <div class="asp-actions" data-asp-actions hidden>
        <span class="bn-muted">Unsaved changes</span>
        <span class="asp-btns">
          <button type="button" class="bn-btn" data-asp="cancel">Cancel</button>
          <button type="button" class="btn btn-gold asp-save" data-asp="save">Save</button>
        </span>
      </div>
      <div class="asp-sets">${draft.length ? draft.map(setCard).join("") : `<div class="bn-muted bn-pad">Nothing here yet - tap "+ Add featured items".</div>`}</div>
      <div class="asp-gap"></div>`;
    paintBar();
  }

  // ---- actions -----------------------------------------------------------------------------------
  async function save() {
    if (saving || !dirty()) return;
    saving = true;
    paintBar();
    try {
      const sets = draft.map((s) => ({
        id: s.id,
        enabled: s.enabled,
        title: s.title,
        subtitle: s.subtitle,
        place: s.place,
        bannerFirst: s.bannerFirst,
        showIn: s.showIn,
        productIds: s.items.map((i) => i.id),
      }));
      const r = await Api.put(API, { sets });
      // the reply holds ids only (no names again): the names are already on this page, in what was just saved
      const names = new Map();
      draft.forEach((s) => s.items.forEach((i) => names.set(i.id, i)));
      saved = ((r && r.sets) || []).map((x) =>
        toLocal({ ...x, items: (x.productIds || []).map((pid) => names.get(pid)).filter(Boolean) })
      );
      draft = saved.map(cloneSet);
      const ids = new Set(draft.map((s) => s.id));
      expanded = new Set([...expanded].filter((x) => ids.has(x)));
      loadedAt = Date.now();
      saving = false;
      render();
      Toast.show("Featured Products saved - live on your website", "success");
    } catch (err) {
      saving = false;
      paintBar();
      Toast.show((err && err.message) || "Couldn't save Featured Products", "error");
    }
  }

  function cancel() {
    if (saving || !dirty()) return;
    if (!window.confirm("Throw away your unsaved changes?")) return;
    draft = saved.map(cloneSet);
    expanded = new Set([...expanded].filter((x) => draft.some((s) => s.id === x)));
    render();
  }

  function onClick(e) {
    const b = e.target.closest("[data-asp]");
    if (!b || !host.contains(b)) return;
    const what = b.dataset.asp;
    if (what === "retry") return refresh();
    if (!draft || saving) return;
    if (what === "save") return save();
    if (what === "cancel") return cancel();
    if (what === "add-set") {
      const place = draft.length ? Math.min(MAX_PLACE, Math.max(...draft.map((x) => x.place)) + 4) : 1;
      const fresh = toLocal({ id: newId(), enabled: false, title: "", subtitle: "", place, bannerFirst: false, showIn: [], items: [] });
      draft.push(fresh);
      expanded.add(fresh.id); // opens so it can be filled in
      render();
      const card = cardOf(fresh.id);
      // the title box is ready to type in (the keyboard opens straight away on a phone)
      const titleBox = card && card.querySelector('input[data-asp-field="title"]');
      if (titleBox) titleBox.focus({ preventScroll: true });
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const card = b.closest(".asp[data-asp-id]");
    const id = card && card.dataset.aspId;
    const set = id && find(id);
    if (!set) return;
    if (what === "toggle") {
      const open = !expanded.has(id);
      if (open) expanded.add(id);
      else expanded.delete(id);
      card.classList.toggle("open", open);
      const body = card.querySelector(".bn-set-body");
      body.hidden = !open;
      body.innerHTML = open ? bodyHtml(set) : "";
      b.setAttribute("aria-expanded", String(open));
      return;
    }
    if (what === "del-set") {
      const label = (set.title || "").trim();
      if (!window.confirm(`Remove ${label ? `"${label}"` : "this featured slider"}? It disappears from your website when you tap Save.`)) return;
      draft.splice(indexOf(id), 1);
      expanded.delete(id);
      render();
      return;
    }
    if (what === "add") {
      const pid = Number(b.dataset.aspId);
      const r = products && products.get(pid);
      if (!r || set.items.some((i) => i.id === pid)) return;
      set.items.push({ id: pid, n: r.n, c: r.c || "", e: r.e !== false });
      const input = card.querySelector("[data-asp-search]");
      if (input) input.value = "";
      paintList(id);
      return;
    }
    const row = b.closest(".asp-row");
    const i = row ? Number(row.dataset.aspI) : -1;
    if (i < 0) return;
    if (what === "del") set.items.splice(i, 1);
    else if (what === "up" && i > 0) [set.items[i - 1], set.items[i]] = [set.items[i], set.items[i - 1]];
    else if (what === "down" && i < set.items.length - 1) [set.items[i + 1], set.items[i]] = [set.items[i], set.items[i + 1]];
    paintList(id);
  }

  function onInput(e) {
    const t = e.target;
    const card = t.closest && t.closest(".asp[data-asp-id]");
    const set = card && find(card.dataset.aspId);
    if (!set) return;
    if (t.matches("[data-asp-search]")) {
      const box = card.querySelector("[data-asp-results]");
      box.hidden = false;
      box.innerHTML = resultsHtml(set, t.value);
      return;
    }
    const field = t.dataset && t.dataset.aspField;
    if (!field) return;
    if (field === "enabled") set.enabled = t.checked;
    else if (field === "place") return; // applied when the box is left (see "change")
    else if (field === "bannerFirst") return; // applied on "change"
    else set[field] = t.value;
    paintHead(set.id);
    paintBar();
  }

  function onChange(e) {
    const t = e.target;
    const card = t.closest && t.closest(".asp[data-asp-id]");
    const set = card && find(card.dataset.aspId);
    if (!set) return;
    if (t.dataset.aspCat !== undefined) {
      const menu = t.closest("[data-asp-cats]");
      const value = t.dataset.aspCat;
      let cats = set.showIn.slice();
      if (value === "*") cats = []; // "All categories" is exclusive (and unticking it alone changes nothing)
      else if (t.checked) cats.push(value);
      else cats = cats.filter((c) => c !== value);
      set.showIn = cats;
      menu.querySelectorAll("[data-asp-cat]").forEach((cb) => {
        cb.checked = cb.dataset.aspCat === "*" ? !cats.length : cats.includes(cb.dataset.aspCat);
      });
      menu.querySelector("[data-asp-cats-summary]").textContent = catsSummary(cats);
      paintHead(set.id);
      paintBar();
      return;
    }
    const field = t.dataset && t.dataset.aspField;
    if (field === "enabled") return onInput(e);
    if (field === "bannerFirst") {
      set.bannerFirst = t.value === "yes";
      paintHead(set.id);
      paintBar();
      return;
    }
    if (field === "place") {
      // left the box: anything unusable (empty, 0, decimals, too big) snaps to the nearest allowed number
      const n = Math.max(1, Math.min(MAX_PLACE, Math.round(Number(t.value)) || 1));
      t.value = n;
      set.place = n;
      paintHead(set.id);
      paintBar();
    }
  }

  function ensureMounted() {
    if (host) return;
    host = document.getElementById("specialsRoot");
    if (!host) return;
    host.addEventListener("click", onClick);
    host.addEventListener("input", onInput);
    // the switches, ticks and the position box (NOT the text boxes: a text box fires "change" when it loses focus, and
    // redrawing the results at that moment would swallow the tap on a result)
    host.addEventListener("change", (e) => {
      if (e.target.matches('input[type="checkbox"], input[type="number"], select')) onChange(e);
    });
    host.addEventListener("focusin", (e) => {
      if (!e.target.matches("[data-asp-search]")) return;
      const card = e.target.closest(".asp[data-asp-id]");
      const set = card && find(card.dataset.aspId);
      if (!set) return;
      const box = card.querySelector("[data-asp-results]");
      box.hidden = false;
      loadProducts(); // the shared product list: asked for once, only when a search box is used
      box.innerHTML = resultsHtml(set, e.target.value);
    });
    // remember which category menu is open (the section redraws now and then) and fetch the names when first opened
    host.addEventListener(
      "toggle",
      (e) => {
        const d = e.target;
        if (!d.matches || !d.matches("[data-asp-cats]")) return;
        const card = d.closest(".asp[data-asp-id]");
        const id = card && card.dataset.aspId;
        if (d.open) {
          openCats = id;
          if (!categoriesKnown) {
            loadCategories().then(() => {
              const set = find(id);
              const menu = d.isConnected && d.querySelector(".bn-cats-menu");
              if (set && menu) menu.innerHTML = catsItems(set);
            });
          }
        } else if (openCats === id) openCats = "";
      },
      true
    );
    // Enter / Done closes the keyboard
    host.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches('input[type="text"], input[type="search"], input[type="number"]')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    // tapping anywhere outside a search area folds its results away; outside a category menu closes it
    document.addEventListener("click", (e) => {
      if (!host) return;
      if (!e.target.closest(".asp-picker")) host.querySelectorAll("[data-asp-results]:not([hidden])").forEach((b) => (b.hidden = true));
      if (!e.target.closest("[data-asp-cats]")) host.querySelectorAll("[data-asp-cats][open]").forEach((d) => (d.open = false));
    });
    window.addEventListener("beforeunload", (e) => {
      if (dirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  return { refresh, isDirty: dirty };
})();
