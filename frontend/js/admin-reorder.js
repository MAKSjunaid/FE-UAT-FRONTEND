/* Admin -> Banners tab -> "Buy it again" card.
 *
 * One small card (below Featured Products) with the settings of the "Buy it again" row on the customer website - a moving
 * row of small cards (picture, name, Add button) with the products the signed-in customer has ordered most:
 *  - the switch (show it or not),
 *  - Title (customers see this) and the line under it,
 *  - Items to show (how many products; 10 if never set),
 *  - Position among the products (1 = above the first product, 5 = after the first 4 ...), and
 *  - Select Category (which tabs show it - the same menu as Featured Products), and
 *  - Select Items: products fixed into the row, each with a number = its place in the customer's row (the customer's own
 *    most-ordered products fill the other places). Customers who have never ordered see no row at all, fixed items or not.
 * Everything else is automatic: which products appear is worked out per customer by the server (see CustomerItemService), and
 * customers who are not signed in see a slim sign-in strip instead.
 *
 * Asks the server for as little as possible: ONE tiny read (only when the Banners tab is opened, and again only after a long
 * wait), ONE save request, and the category names only if the Banners tab did not already fetch them. The settings belong to
 * the live website (not to a template), so Customize never touches them.
 *
 * To remove the feature completely: delete this file, css/admin-reorder.css, their tags and the reorderRoot line in
 * admin.html, and the AdminReorder line in admin-main.js. */

window.AdminReorder = (() => {
  const API = "/api/admin/site/reorder";
  const CATS_API = "/api/admin/site/banners/categories";
  const ALL_TAB = "@all";
  const MIN_COUNT = 3; // the row only shows for a customer with this many different delivered products (fewer looks empty)
  const MAX_PLACE = 500;
  const DEFAULT_TITLE = "Good Choices Deserve a Repeat!";
  const DEFAULT_LINE = "Get back to what you love with just one tap.";
  const MAX_SLOT = 1000;
  const BIN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const STALE_MS = 10 * 60 * 1000;

  let host = null;
  let saved = null; // what the server has
  let draft = null; // what the card shows now, changed by the admin until Save
  let open = false;
  let loadedAt = 0;
  let loading = null;
  let failed = false;
  let saving = false;
  let categories = [];
  let categoriesKnown = false;
  let categoriesLoading = null;
  let catsOpen = false;
  let products = null; // id -> { n, c, e }: the whole list, only needed for the search box
  let productsFrom = null;
  let productsLoading = null;

  const slot = (v) => Math.max(1, Math.min(MAX_SLOT, Math.round(Number(v)) || 1));
  const sortPins = (list) => list.map((p, i) => [p, i]).sort((a, b) => a[0].pos - b[0].pos || a[1] - b[1]).map((x) => x[0]); // (same number keeps the order it was added in)
  // (the server also keeps "banner first"; it is not changed here, but is sent back as it was)
  const toLocal = (r) => ({
    enabled: r.enabled === true,
    showGuests: r.showGuests === true,
    count: r.count == null ? 10 : Math.max(MIN_COUNT, Math.round(Number(r.count)) || 10),
    title: typeof r.title === "string" ? r.title : DEFAULT_TITLE,
    subtitle: typeof r.subtitle === "string" ? r.subtitle : DEFAULT_LINE,
    place: Math.max(1, Math.min(MAX_PLACE, Math.round(Number(r.place)) || 1)),
    bannerFirst: r.bannerFirst === true,
    showIn: Array.isArray(r.showIn) ? r.showIn.filter((c) => typeof c === "string") : [],
    pins: sortPins(
      (Array.isArray(r.pins) ? r.pins : [])
        .filter((p) => p && Number(p.id) > 0)
        .map((p) => ({ id: Number(p.id), pos: slot(p.pos), n: p.n || `Product ${p.id}`, c: p.c || "", e: p.e !== false }))
    ),
  });
  const key = (r) => JSON.stringify([r.enabled, r.showGuests, r.count, r.place, r.title, r.subtitle, r.showIn, r.pins.map((p) => [p.id, p.pos])]);
  const dirty = () => !!saved && !!draft && key(saved) !== key(draft);

  // ---- loading -----------------------------------------------------------------------------------
  function refresh() {
    ensureMounted();
    if (!host) return;
    if (saved && (dirty() || Date.now() - loadedAt < STALE_MS)) return; // what we hold is right
    if (loading) return;
    failed = false;
    if (!saved) render();
    loading = Api.get(API)
      .then((r) => {
        saved = toLocal(r || {});
        draft = toLocal(saved);
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

  // ---- "Select Category" menu (same as Featured Products): All categories / the ALL tab / chosen categories ----
  function primeCategories() {
    if (categoriesKnown) return;
    const shared = window.AdminBanners && window.AdminBanners.categoryNames && window.AdminBanners.categoryNames();
    if (Array.isArray(shared)) {
      categories = shared; // the Banners tab already fetched them: no request of our own
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

  function catsSummary(showIn) {
    if (!showIn.length) return "All categories (ALL tab + every category)";
    const parts = [];
    if (showIn.includes(ALL_TAB)) parts.push("ALL");
    showIn.filter((c) => c !== ALL_TAB).forEach((c) => parts.push(c));
    return parts.length === 1 && parts[0] === "ALL" ? "ALL tab only" : parts.join(" + ");
  }

  function catsItems(r) {
    primeCategories();
    const names = categories.slice();
    r.showIn.forEach((c) => c !== ALL_TAB && !names.includes(c) && names.push(c));
    const box = (value, checked, label, note) =>
      `<label class="bn-cat"><input type="checkbox" data-aro-cat="${esc(value)}" ${checked ? "checked" : ""} /><span>${esc(label)}${note ? ` <small>${esc(note)}</small>` : ""}</span></label>`;
    return `
          ${box("*", !r.showIn.length, "All categories", "- the ALL tab and every category")}
          ${box(ALL_TAB, r.showIn.includes(ALL_TAB), "ALL", "- the first tab, with every product")}
          ${names.map((c) => box(c, r.showIn.includes(c), c, "")).join("")}`;
  }

  function catsMenu(r) {
    primeCategories();
    return `
      <details class="bn-cats" data-aro-cats ${catsOpen ? "open" : ""}>
        <summary class="bn-cats-btn" data-aro-cats-summary>${esc(catsSummary(r.showIn))}</summary>
        <div class="bn-cats-menu">${catsItems(r)}
        </div>
      </details>`;
  }

  // ---- "Select Items": the products list (the Products tab's own, when it is already loaded) ------------------
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

  function resultsHtml(term) {
    if (draft.pins.length >= draft.count) {
      return `<div class="bn-muted bn-pad">The row shows up to ${draft.count} item${draft.count === 1 ? "" : "s"}, so at most ${draft.count} can be fixed. Raise "Items to show" to add more.</div>`;
    }
    if (!products) return `<div class="bn-muted bn-pad">Loading your products…</div>`;
    const taken = new Set(draft.pins.map((p) => p.id));
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
          `<button type="button" class="bn-result" data-aro="pin-add" data-aro-pid="${id}"><span>${esc(r.n)}</span><span class="bn-muted">${esc(r.c || "")}${r.e ? "" : " · hidden"}</span></button>`
      )
      .join("");
  }

  function paintResults() {
    if (!host || !draft) return;
    const box = host.querySelector("[data-aro-results]");
    const input = host.querySelector("[data-aro-search]");
    if (box && input && !box.hidden) box.innerHTML = resultsHtml(input.value);
  }

  function pinRows() {
    if (!draft.pins.length) return `<div class="bn-muted bn-pad">No fixed items - search below and tap a product to add it.</div>`;
    return draft.pins
      .map(
        (p, i) => `
        <div class="asp-row" data-aro-i="${i}" data-aro-pid="${p.id}">
          <input type="number" class="aro-slot" data-aro-slot inputmode="numeric" enterkeyhint="done" min="1" max="${draft.count}" step="1" value="${p.pos}" aria-label="Place of ${esc(p.n)} in the row" />
          <span class="asp-name"><b>${esc(p.n)}</b><small>${esc(p.c)}${p.e ? "" : " · hidden (customers won't see it)"}</small></span>
          <button type="button" class="bn-icon bn-bin" data-aro="pin-del" aria-label="Remove ${esc(p.n)}" title="Remove">${BIN}</button>
        </div>`
      )
      .join("");
  }

  const pinCountText = () => (draft.pins.length ? `${draft.pins.length} of ${draft.count} · the number is its place in the row` : `0 of ${draft.count}`);

  function paintPins() {
    if (!host || !draft) return;
    const list = host.querySelector("[data-aro-list]");
    if (list) list.innerHTML = pinRows();
    const count = host.querySelector("[data-aro-count]");
    if (count) count.textContent = pinCountText();
    paintHead();
    paintBar();
    paintResults();
  }

  // ---- drawing -----------------------------------------------------------------------------------
  function headHtml(r) {
    const sub = [
      r.enabled ? "ON" : "OFF",
      `Up to ${r.count} item${r.count === 1 ? "" : "s"}`,
      `Position ${r.place}`,
      r.showIn.length ? catsSummary(r.showIn) : "All categories",
      r.pins.length ? `${r.pins.length} fixed item${r.pins.length === 1 ? "" : "s"}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<b class="bn-head-name">Buy it again · past items</b><span class="bn-head-sub">${esc(sub)}</span>`;
  }

  function bodyHtml(r) {
    return `
          <label class="aro-check">
            <input type="checkbox" data-aro-field="showGuests" ${r.showGuests ? "checked" : ""} />
            <span>Also show to customers who are not signed in <small>a small "Your favorites are waiting! Sign in to reorder." strip with a Sign in button</small></span>
          </label>
          <div class="field">
            <label>Title (customers see this)</label>
            <input type="text" data-aro-field="title" enterkeyhint="done" maxlength="60" value="${esc(r.title)}" placeholder="${esc(DEFAULT_TITLE)}" autocomplete="off" />
          </div>
          <div class="field">
            <label>Line under the title</label>
            <input type="text" data-aro-field="subtitle" enterkeyhint="done" maxlength="80" value="${esc(r.subtitle)}" placeholder="${esc(DEFAULT_LINE)}" autocomplete="off" />
          </div>
          <div class="field aro-pos">
            <label>Items to show</label>
            <input type="number" data-aro-field="count" enterkeyhint="done" inputmode="numeric" min="${MIN_COUNT}" step="1" value="${r.count}" />
            <div class="bn-muted">At least ${MIN_COUNT}. A customer sees this row only after ${MIN_COUNT} or more different products have been delivered to them.</div>
          </div>
          <div class="bn-two">
            <div class="field">
              <label>Position</label>
              <input type="number" data-aro-field="place" enterkeyhint="done" inputmode="numeric" min="1" max="${MAX_PLACE}" step="1" value="${r.place}" />
            </div>
            <div class="field bn-grow">
              <label>Select Category</label>
              ${catsMenu(r)}
            </div>
          </div>
          <div class="asp-label"><label>Select Items</label><span class="bn-muted" data-aro-count>${pinCountText()}</span></div>
          <div class="asp-list" data-aro-list>${pinRows()}</div>
          <div class="bn-picker asp-picker">
            <input type="search" class="bn-search" data-aro-search placeholder="Search your products to add…" enterkeyhint="search" autocomplete="off" spellcheck="false" aria-label="Search products to add" />
            <div class="bn-results" data-aro-results hidden></div>
          </div>`;
  }

  function paintHead() {
    const el = host && host.querySelector(".bn-head-text");
    if (el && draft) el.innerHTML = headHtml(draft);
  }

  function paintBar() {
    if (!host) return;
    const actions = host.querySelector("[data-aro-actions]");
    if (!actions) return;
    actions.hidden = !dirty() && !saving;
    const save = actions.querySelector('[data-aro="save"]');
    const cancel = actions.querySelector('[data-aro="cancel"]');
    if (save) {
      save.disabled = saving || !dirty();
      save.textContent = saving ? "Saving…" : "Save";
    }
    if (cancel) cancel.disabled = saving;
  }

  function render() {
    if (!host) return;
    if (!draft) {
      host.innerHTML = `<div class="bn-set asp aro"><div class="bn-muted bn-pad">${failed ? `Couldn't load Buy it again. <button type="button" class="bn-link" data-aro="retry">Try again</button>` : "Loading Buy it again…"}</div></div>`;
      return;
    }
    host.innerHTML = `
      <div class="asp-actions" data-aro-actions hidden>
        <span class="bn-muted">Unsaved changes</span>
        <span class="asp-btns">
          <button type="button" class="bn-btn" data-aro="cancel">Cancel</button>
          <button type="button" class="btn btn-gold asp-save" data-aro="save">Save</button>
        </span>
      </div>
      <div class="bn-set asp aro ${open ? "open" : ""}">
        <div class="bn-set-head">
          <button type="button" class="bn-toggle" data-aro="toggle" aria-expanded="${open}">
            <span class="bn-chev" aria-hidden="true">▸</span>
            <span class="bn-head-text">${headHtml(draft)}</span>
          </button>
          <label class="switch" title="Show this row to customers"><input type="checkbox" data-aro-field="enabled" ${draft.enabled ? "checked" : ""} /><span class="track"></span></label>
        </div>
        <div class="bn-set-body" ${open ? "" : "hidden"}>${open ? bodyHtml(draft) : ""}</div>
      </div>
      <div class="asp-gap"></div>`;
    paintBar();
  }

  // ---- actions -----------------------------------------------------------------------------------
  async function save() {
    if (saving || !dirty()) return;
    saving = true;
    paintBar();
    try {
      const body = {
        enabled: draft.enabled,
        showGuests: draft.showGuests,
        count: draft.count,
        title: draft.title,
        subtitle: draft.subtitle,
        place: draft.place,
        bannerFirst: draft.bannerFirst,
        showIn: draft.showIn,
        pins: draft.pins.map((p) => ({ id: p.id, pos: p.pos })),
      };
      const r = await Api.put(API, body);
      // the reply holds ids and numbers only: the names are already on this page
      const names = new Map(draft.pins.map((p) => [p.id, p]));
      saved = toLocal(r ? { ...r, pins: (r.pins || []).map((p) => ({ ...(names.get(Number(p.id)) || {}), ...p })) } : draft);
      draft = toLocal(saved);
      loadedAt = Date.now();
      saving = false;
      render();
      Toast.show("Buy it again saved - live on your website", "success");
    } catch (err) {
      saving = false;
      paintBar();
      Toast.show((err && err.message) || "Couldn't save Buy it again", "error");
    }
  }

  function cancel() {
    if (saving || !dirty()) return;
    if (!window.confirm("Throw away your unsaved changes?")) return;
    draft = toLocal(saved);
    render();
  }

  function onClick(e) {
    const b = e.target.closest("[data-aro]");
    if (!b || !host.contains(b)) return;
    const what = b.dataset.aro;
    if (what === "retry") return refresh();
    if (!draft || saving) return;
    if (what === "save") return save();
    if (what === "cancel") return cancel();
    if (what === "pin-add") {
      const pid = Number(b.dataset.aroPid);
      const r = products && products.get(pid);
      if (!r || draft.pins.some((p) => p.id === pid)) return;
      if (draft.pins.length >= draft.count) return Toast.show(`You can fix at most ${draft.count} items - raise "Items to show" first`, "error");
      draft.pins.push({ id: pid, pos: slot(draft.pins.length ? Math.max(...draft.pins.map((p) => p.pos)) + 1 : 1), n: r.n, c: r.c || "", e: r.e !== false });
      const input = host.querySelector("[data-aro-search]");
      if (input) input.value = "";
      return paintPins();
    }
    if (what === "pin-del") {
      const row = b.closest(".asp-row");
      const i = row ? draft.pins.findIndex((p) => p.id === Number(row.dataset.aroPid)) : -1;
      if (i < 0) return;
      draft.pins.splice(i, 1);
      return paintPins();
    }
    if (what === "toggle") {
      open = !open;
      const card = host.querySelector(".aro");
      const body = card.querySelector(".bn-set-body");
      card.classList.toggle("open", open);
      body.hidden = !open;
      body.innerHTML = open ? bodyHtml(draft) : "";
      b.setAttribute("aria-expanded", String(open));
    }
  }

  function onInput(e) {
    const t = e.target;
    const field = t.dataset && t.dataset.aroField;
    if (draft && t.matches && t.matches("[data-aro-search]")) {
      const box = host.querySelector("[data-aro-results]");
      box.hidden = false;
      box.innerHTML = resultsHtml(t.value);
      return;
    }
    if (!draft || (field !== "title" && field !== "subtitle")) return;
    draft[field] = t.value;
    paintBar(); // (the heading above does not show these, so nothing else to redraw)
  }

  function onChange(e) {
    const t = e.target;
    if (draft && t.dataset && t.dataset.aroCat !== undefined) {
      const menu = t.closest("[data-aro-cats]");
      const value = t.dataset.aroCat;
      let cats = draft.showIn.slice();
      if (value === "*") cats = []; // "All categories" is exclusive (and unticking it alone changes nothing)
      else if (t.checked) cats.push(value);
      else cats = cats.filter((c) => c !== value);
      draft.showIn = cats;
      menu.querySelectorAll("[data-aro-cat]").forEach((cb) => {
        cb.checked = cb.dataset.aroCat === "*" ? !cats.length : cats.includes(cb.dataset.aroCat);
      });
      menu.querySelector("[data-aro-cats-summary]").textContent = catsSummary(cats);
      paintHead();
      paintBar();
      return;
    }
    if (draft && t.dataset && t.dataset.aroSlot !== undefined) {
      const row = t.closest(".asp-row");
      const pin = row && draft.pins.find((p) => p.id === Number(row.dataset.aroPid));
      const at = Math.min(slot(t.value), draft.count); // (a place past the last one shown means nothing)
      if (!pin) return;
      if (pin.pos === at) {
        t.value = at; // (nothing changed: e.g. the same change heard twice, or a too big number cut back)
        return;
      }
      pin.pos = at;
      draft.pins = sortPins(draft.pins);
      return paintPins(); // (the rows line up by number)
    }
    const field = t.dataset && t.dataset.aroField;
    if (!field || !draft) return;
    if (field === "enabled") draft.enabled = t.checked;
    else if (field === "showGuests") draft.showGuests = t.checked;
    else if (field === "count") {
      let n = Math.max(MIN_COUNT, Math.round(Number(t.value)) || MIN_COUNT);
      if (n < draft.pins.length) {
        n = draft.pins.length; // the fixed items must fit in the row
        Toast.show(`${n} items are fixed, so the row must show at least ${n} - remove one first to show fewer`, "error");
      }
      t.value = n;
      draft.count = n;
      draft.pins.forEach((p) => (p.pos = Math.min(p.pos, n)));
      draft.pins = sortPins(draft.pins);
      return paintPins(); // (the "n of N" text, the numbers and the heading follow the new count)
    } else if (field === "place") {
      // left the box: anything unusable (empty, 0, decimals, too big) snaps to the nearest allowed number
      const n = Math.max(1, Math.min(MAX_PLACE, Math.round(Number(t.value)) || 1));
      t.value = n;
      draft.place = n;
    } else return;
    paintHead();
    paintBar();
  }

  function ensureMounted() {
    if (host) return;
    host = document.getElementById("reorderRoot");
    if (!host) return;
    host.addEventListener("click", onClick);
    host.addEventListener("input", onInput);
    host.addEventListener("change", (e) => {
      if (e.target.matches('input[type="checkbox"], input[type="number"]')) onChange(e);
    });
    host.addEventListener("focusin", (e) => {
      if (!draft || !e.target.matches("[data-aro-search]")) return;
      const box = host.querySelector("[data-aro-results]");
      box.hidden = false;
      loadProducts(); // the shared product list: asked for once, only when the search box is used
      box.innerHTML = resultsHtml(e.target.value);
    });
    // remember whether the category menu is open (the card redraws now and then); fetch the names when it is first opened
    host.addEventListener(
      "toggle",
      (e) => {
        const d = e.target;
        if (!d.matches || !d.matches("[data-aro-cats]")) return;
        catsOpen = d.open;
        if (d.open && !categoriesKnown) {
          loadCategories().then(() => {
            const menu = d.isConnected && d.querySelector(".bn-cats-menu");
            if (menu && draft) menu.innerHTML = catsItems(draft);
          });
        }
      },
      true
    );
    // tapping anywhere outside the category menu closes it
    document.addEventListener("click", (e) => {
      if (!host) return;
      if (!e.target.closest(".asp-picker")) host.querySelectorAll("[data-aro-results]:not([hidden])").forEach((b) => (b.hidden = true));
      if (e.target.closest("[data-aro-cats]")) return;
      host.querySelectorAll("[data-aro-cats][open]").forEach((d) => (d.open = false));
    });
    // Enter / Done closes the keyboard
    host.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches('input[type="text"], input[type="search"], input[type="number"]')) {
        e.preventDefault();
        e.target.blur();
      }
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
