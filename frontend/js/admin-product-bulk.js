/* Products tab "Select products": tick many products, then change them all at once —
 * show / hide, out of stock / back in stock, category, or delete.
 *
 * While selecting, categories still open and close by tapping them, so products from several categories can
 * be ticked in one go (the round tick on a category tile ticks all of its products). A slim bar covers the top of
 * the bottom of the screen (over the bottom menu): ✕ · "N selected" · Select all · Actions, all on one line.
 * Actions turns on as soon as one product is ticked; it opens a list of everything you can do.
 *
 * It works on products that are already loaded (no extra fetch to select),
 * sends ONE request per action (POST /api/admin/products/bulk), then refreshes the list once. */
(() => {
  if (typeof Api === "undefined" || !window.AdminProducts) return;
  const view = document.getElementById("view-products");
  const list = document.getElementById("productsList");
  const sheetRoot = document.getElementById("sheetRoot");
  if (!view || !list || !sheetRoot) return;

  const style = document.createElement("style");
  style.textContent = `
    #view-products.pb-on #addProductFab,#view-products.pb-on .pt-actions,#view-products.pb-on .pt-tools,#view-products.pb-on .pi-panel{display:none}
    #view-products.pb-on{padding-bottom:calc(var(--sp-4,16px) + var(--pb-extra,0px))}
    /* product rows while selecting: tick · photo · name · price · status */
    #view-products.pb-on .admin-product-card{position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent;align-items:center;padding:10px 12px 10px 10px;gap:10px;border:2px solid transparent}
    #view-products.pb-on .admin-product-card::before,#view-products.pb-on .ap-cat-tick{content:"";flex:0 0 auto;box-sizing:border-box;width:24px;height:24px;border-radius:50%;border:2px solid #c9c2ac;background:#fff;color:#fff;font-weight:800;font-size:14px;line-height:20px;text-align:center}
    #view-products.pb-on .ap-cat-tick{display:inline-block}
    #view-products.pb-on .ap-cat-tick::after{content:""}
    #view-products.pb-on .admin-product-thumb{width:56px;height:56px}
    #view-products.pb-on .admin-product-card .thumb-upload-btn,#view-products.pb-on .admin-product-card .switch,#view-products.pb-on .admin-product-card .admin-product-actions,#view-products.pb-on .admin-product-card .admin-product-main>.name-row:nth-child(2),#view-products.pb-on .ap-cat-pos{display:none}
    #view-products.pb-on .admin-product-card.pb-sel{border-color:var(--gold,#c9a13b);background:#fffaf0}
    #view-products.pb-on .admin-product-card.pb-sel::before{content:"✓";background:var(--gold,#c9a13b);border-color:var(--gold,#c9a13b)}
    #view-products.pb-on .ap-cat.pb-sel .ap-cat-tick{background:var(--gold,#c9a13b);border-color:var(--gold,#c9a13b)}
    #view-products.pb-on .ap-cat.pb-sel .ap-cat-tick::after{content:"✓"}
    #view-products.pb-on .ap-cat.pb-part .ap-cat-tick{background:var(--gold-light,#f0d98a);border-color:var(--gold,#c9a13b);color:var(--ink,#17140f)}
    #view-products.pb-on .ap-cat.pb-part .ap-cat-tick::after{content:"–"}
    .ap-cat-tick{display:none}
    .pb-bar{position:fixed;bottom:0;left:0;right:0;z-index:620;display:flex;align-items:center;gap:8px;padding:8px 10px calc(8px + var(--safe-bottom,0px)) 6px;background:#f8f1dc;color:var(--text-main,#201c14);border-top:1px solid #eadfb8;box-shadow:0 -6px 16px rgba(20,16,8,.12)}
    @media (max-width:640px){.pb-bar{min-height:calc(var(--admin-nav-h,60px) + var(--safe-bottom,0px))}}
    .pb-bar[hidden]{display:none}
    .pb-bar[data-busy="1"]{opacity:.6;pointer-events:none}
    .pb-cancel{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:50%;background:transparent;color:var(--text-main,#201c14);font-size:18px;line-height:1;cursor:pointer}
    .pb-cancel:active{background:rgba(127,127,127,.18)}
    .pb-sum{flex:1 1 70px;min-width:0}
    .pb-sum b{display:block;font-size:16px;line-height:1.15;white-space:nowrap}
    .pb-sum small{display:block;margin-top:1px;font-size:11.5px;line-height:1.2;color:var(--text-muted,#6f6656);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pb-bar .btn{flex:0 0 auto;height:38px;padding:0 12px;border-radius:11px;font-size:13.5px;white-space:nowrap}
    .pb-bar .btn[disabled]{opacity:.45;pointer-events:none}
    .pb-sheet .sheet-header h2{font-family:inherit;font-size:17px;font-weight:700}
    .pb-menu{display:flex;flex-direction:column;gap:6px}
    .pb-sep{height:1px;margin:6px 2px;background:var(--border,#e4dfd3)}
    .pb-item{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px;border:1px solid var(--border,#e4dfd3);border-radius:12px;background:var(--surface,#fff);color:inherit;font:inherit;cursor:pointer}
    .pb-item:active{transform:scale(.99)}
    .pb-item .pb-ico{flex:0 0 auto;width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;background:rgba(127,127,127,.14)}
    .pb-item b{display:block;font-size:15px}
    .pb-item small{display:block;margin-top:1px;font-size:12.5px;color:var(--text-muted,#777)}
    .pb-item.pb-danger{border-color:rgba(179,38,30,.4)}
    .pb-item.pb-danger b{color:#b3261e}
    .pb-item.pb-danger .pb-ico{background:rgba(179,38,30,.12)}
  `;
  document.head.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "pb-bar";
  bar.hidden = true;
  bar.innerHTML = `
    <button class="pb-cancel" type="button" data-pb="cancel" aria-label="Cancel selection">✕</button>
    <div class="pb-sum"><b data-pb="count">0 selected</b><small data-pb="sub">Tap a product to select it</small></div>
    <button class="btn btn-outline btn-sm" type="button" data-pb="all">Select all</button>
    <button class="btn btn-gold btn-sm" type="button" data-pb="actions" disabled>Actions ▾</button>`;
  document.body.appendChild(bar);
  const countEl = bar.querySelector('[data-pb="count"]');
  const subEl = bar.querySelector('[data-pb="sub"]');
  const allBtn = bar.querySelector('[data-pb="all"]');
  const actionsBtn = bar.querySelector('[data-pb="actions"]');

  const esc = (s) => Utils.escapeHtml(String(s));
  const selected = new Map(); // product id -> its category name
  let on = false;
  let busy = false;
  let observer = null;

  const all = () => window.AdminProducts.getAll() || []; // products of the categories that are open now
  const byId = (id) => window.AdminProducts.find(id);

  // ---- select mode on / off ------------------------------------------
  function start() {
    if (on) return;
    if (!window.AdminProducts.hasProducts()) {
      Toast.show("There are no products to select yet.", "error");
      return;
    }
    on = true;
    selected.clear();
    view.classList.add("pb-on");
    bar.hidden = false;
    fitBar();
    paint();
    // the list is rebuilt after every refresh; tick the right cards again each time
    // (also when a category is opened, its cards are new and need their ticks)
    observer = new MutationObserver(() => paint());
    observer.observe(list, { childList: true, subtree: true });
  }

  /** On phones the bar sits exactly over the bottom menu (same height) while selecting. On wider screens there is no
   * bottom menu, so the list gets extra room at its end so the last product is never hidden under the bar. */
  function fitBar() {
    const phone = window.matchMedia("(max-width:640px)").matches;
    view.style.setProperty("--pb-extra", (phone ? 0 : bar.offsetHeight) + "px");
  }
  window.addEventListener("resize", () => { if (on) fitBar(); });

  function stop() {
    if (!on) return;
    on = false;
    selected.clear();
    if (observer) observer.disconnect();
    observer = null;
    view.classList.remove("pb-on");
    view.style.removeProperty("--pb-extra");
    bar.hidden = true;
    sheetRoot.innerHTML = "";
    list.querySelectorAll(".pb-sel").forEach((c) => c.classList.remove("pb-sel"));
    window.AdminProducts.setPicked(new Map());
  }

  document.addEventListener("freshcutz:logout", stop);
  // leaving the Products tab (e.g. with the bottom bar) ends selecting, so the bar never covers another tab
  document.addEventListener("click", (e) => {
    if (on && e.target.closest(".admin-tab")) stop();
  });

  function updateBar() {
    const n = selected.size;
    const perCategory = new Map();
    for (const name of selected.values()) perCategory.set(name, (perCategory.get(name) || 0) + 1);
    countEl.textContent = `${n} selected`;
    subEl.textContent = n
      ? perCategory.size === 1 ? "in 1 category" : `in ${perCategory.size} categories`
      : "Tap a product to select it";
    actionsBtn.disabled = n === 0;
    allBtn.textContent = allShownSelected() ? "Clear" : "Select all";
    window.AdminProducts.setPicked(perCategory);
    // category tiles: ticked when all of their products are ticked, half-ticked when only some are
    list.querySelectorAll(".ap-cat").forEach((tile) => {
      const name = tile.dataset.cat;
      const k = perCategory.get(name) || 0;
      const total = window.AdminProducts.categoryTotal(name);
      tile.classList.toggle("pb-sel", k > 0 && k >= total);
      tile.classList.toggle("pb-part", k > 0 && k < total);
    });
    fitBar();
  }

  /** True when there are products on screen and every one of them is ticked. */
  function allShownSelected() {
    const shown = all();
    return shown.length > 0 && shown.every((p) => selected.has(p.id));
  }

  const catOf = (p) => (p.category || "").trim();

  /** Re-applies the ticks to the cards on screen. */
  function paint() {
    list.querySelectorAll(".admin-product-card").forEach((card) => {
      card.classList.toggle("pb-sel", selected.has(Number(card.dataset.id)));
    });
    updateBar();
  }

  function toggle(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.set(id, catOf(byId(id) || {}));
    const card = list.querySelector(`.admin-product-card[data-id="${id}"]`);
    if (card) card.classList.toggle("pb-sel", selected.has(id));
    updateBar();
  }

  /** The round tick on a category tile: ticks (or unticks) every product of that category, opening it first if needed. */
  async function tickCategory(name) {
    if (busy) return;
    let rows = window.AdminProducts.rowsOf(name);
    if (!rows) {
      setBusy(true);
      try { rows = await window.AdminProducts.openCategory(name); } finally { setBusy(false); }
    }
    if (!on || !rows.length) return;
    const every = rows.every((p) => selected.has(p.id));
    rows.forEach((p) => (every ? selected.delete(p.id) : selected.set(p.id, catOf(p))));
    paint();
  }

  // Clicks on a card only tick it while selecting — the card's own buttons and switches are switched off.
  list.addEventListener(
    "click",
    (e) => {
      if (!on) return;
      const tick = e.target.closest(".ap-cat-tick");
      if (tick) {
        e.preventDefault();
        e.stopPropagation();
        return tickCategory(tick.closest(".ap-cat").dataset.cat);
      }
      const card = e.target.closest(".admin-product-card");
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      toggle(Number(card.dataset.id));
    },
    true
  );
  list.addEventListener(
    "change",
    (e) => {
      if (on) e.stopPropagation();
    },
    true
  );

  // ---- running an action ---------------------------------------------
  function setBusy(b) {
    busy = b;
    bar.dataset.busy = b ? "1" : "0";
  }

  const DONE = {
    ENABLE: "now visible", DISABLE: "now hidden", OUT_OF_STOCK: "marked out of stock", IN_STOCK: "back in stock",
    CATEGORY: "moved to the category", DELETE: "deleted",
  };

  async function run(action, value) {
    const ids = [...selected.keys()];
    setBusy(true);
    try {
      const r = await Api.post("/api/admin/products/bulk", { action, ids, value: value == null ? null : String(value) });
      const n = r.changed;
      Toast.show(n ? `${n} product${n === 1 ? "" : "s"} ${DONE[action]}` : "Nothing to change — they were already like that.", "success");
      if (action === "DELETE") selected.clear();
      if (n) await window.AdminProducts.afterBulk(action, ids, value);
      paint();
    } catch (err) {
      Toast.show(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function names(max) {
    const ns = [...selected.keys()].map((id) => byId(id)?.name).filter(Boolean);
    return ns.slice(0, max).join(", ") + (ns.length > max ? `, … and ${ns.length - max} more` : "");
  }

  function confirmDelete() {
    const n = selected.size;
    if (!confirm(`Delete ${n} product${n === 1 ? "" : "s"}?\n\n${names(5)}\n\nTheir photos are deleted too. This can't be undone.`)) return false;
    if (n >= 10) {
      const typed = prompt(`You are deleting ${n} products. Type DELETE to confirm.`);
      if (!typed || typed.trim().toUpperCase() !== "DELETE") {
        Toast.show("Nothing was deleted.", "error");
        return false;
      }
    }
    return true;
  }

  // ---- sheets --------------------------------------------------------
  function showSheet(title, bodyHtml, footerHtml) {
    sheetRoot.innerHTML = `
      <div class="overlay" data-role="overlay"></div>
      <div class="sheet pb-sheet" role="dialog" aria-modal="true">
        <div class="sheet-header"><h2>${esc(title)}</h2><button class="sheet-close" data-role="close">✕</button></div>
        <div class="sheet-body" data-role="body">${bodyHtml}</div>
        ${footerHtml ? `<div class="sheet-footer">${footerHtml}</div>` : ""}
      </div>`;
    const close = () => { sheetRoot.innerHTML = ""; };
    sheetRoot.querySelector('[data-role="overlay"]').addEventListener("click", close);
    sheetRoot.querySelector('[data-role="close"]').addEventListener("click", close);
    return { close, body: sheetRoot.querySelector('[data-role="body"]') };
  }

  const ACTIONS = [
    { key: "ENABLE", icon: "👁", title: "Show on shop", sub: "Make them visible to customers" },
    { key: "DISABLE", icon: "🙈", title: "Hide from shop", sub: "Customers won't see them" },
    { key: "OUT_OF_STOCK", icon: "🚫", title: "Mark out of stock", sub: "Shown, but can't be ordered" },
    { key: "IN_STOCK", icon: "✅", title: "Mark back in stock", sub: "Can be ordered again" },
    { key: "CATEGORY", icon: "🏷", title: "Change category…", sub: "Move them to another category" },
    { key: "DELETE", icon: "🗑", title: "Delete…", sub: "Remove them for good", danger: true },
  ];

  function actionsSheet() {
    const n = selected.size;
    const { close, body } = showSheet(
      `${n} product${n === 1 ? "" : "s"} selected`,
      `<div class="pb-menu">${ACTIONS.map((a) => `${a.danger ? '<div class="pb-sep"></div>' : ""}
        <button type="button" class="pb-item${a.danger ? " pb-danger" : ""}" data-act="${a.key}">
          <span class="pb-ico">${a.icon}</span><span><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></span>
        </button>`).join("")}</div>`
    );
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || busy) return;
      const key = btn.dataset.act;
      if (key === "CATEGORY") return categorySheet();
      close();
      if (key === "DELETE") {
        if (!confirmDelete()) return;
        return run("DELETE");
      }
      run(key);
    });
  }

  function categorySheet() {
    const n = selected.size;
    const { close, body } = showSheet(
      "Change category",
      `<p class="hint">${n} product${n === 1 ? "" : "s"} will be moved to:</p>
       <div class="field"><label>Category</label>${window.AdminProducts.categoryFieldHtml("", false)}</div>`,
      `<button class="btn btn-gold btn-block" type="button" data-role="ok">Move products</button>`
    );
    window.AdminProducts.bindCategoryField(body);
    sheetRoot.querySelector('[data-role="ok"]').addEventListener("click", async () => {
      const name = window.AdminProducts.readCategory(body);
      if (!name) {
        Toast.show("Pick a category or type a new one.", "error");
        return;
      }
      close();
      await run("CATEGORY", name);
    });
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pb]");
    if (!btn || busy) return;
    const key = btn.dataset.pb;
    if (key === "cancel") return stop();
    if (key === "all") {
      if (allShownSelected() && selected.size) selected.clear();
      else if (!all().length) Toast.show("Open a category first (or search), then tap its products.", "error");
      else all().forEach((p) => selected.set(p.id, catOf(p)));
      return paint();
    }
    if (key === "actions" && selected.size) return actionsSheet();
  });

  window.ProductBulk = { start, stop };
})();
