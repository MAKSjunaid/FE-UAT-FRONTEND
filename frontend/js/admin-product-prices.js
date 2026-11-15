/* Products tab -> Catalog tools -> "Update prices": change many prices on ONE screen, with a daily base rate and an Excel round trip.
 *
 * Kept light on purpose (the shop runs on a free server and database):
 *  - Nothing new is asked for just to open it. The products of a category are the same list the Products tab asks for when you
 *    open that category (and a category that is already open is taken from there, so it costs nothing).
 *  - Saving is ONE request for any number of products (POST /api/admin/products/prices), written by the server in one batch.
 *  - The Excel file is made and read right here in the browser - the server is not involved until you press Save.
 *  - "Today's rates" (base rates) are read once, only if you open that strip (or download / upload a file); they are kept in
 *    one small note on the server.
 * How the base rate works: a category has one rate per kg (say Chicken 400). Linking an item remembers how far each size sits
 * from it: price = rate x kg + a small difference, so 500g moves half as much as 1kg when the rate changes. The MRP follows the
 * same way. Typing a box by hand on a linked item just moves that item's own difference.
 *
 * To remove the feature completely: delete this file and its <script> tag in admin.html (the menu button goes with it), and
 * on the server the files ProductPriceService.java and AdminProductPriceController.java. */
(() => {
  if (typeof Api === "undefined" || !window.AdminProducts) return;
  const menu = document.getElementById("piMenu");
  const menuGrid = menu && menu.querySelector(".pt-grid");
  if (!menuGrid) return;

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const BY_CAT = (name) => `/api/admin/products/by-category?name=${encodeURIComponent(name)}`;
  try { localStorage.removeItem("fc_price_undo_v1"); } catch { /* an older version kept an undo copy here */ }
  const JUMP = 0.2; // a change of more than 20% gets a warning in the review

  // ---------------------------------------------------------------- styles
  const style = document.createElement("style");
  style.textContent = `
    .pp-ov{position:fixed;inset:0;z-index:700;overscroll-behavior:contain;background:var(--bg-page,#f6f2e8);display:flex;flex-direction:column;color:#1c1c1c}
    .pp-ov[hidden]{display:none}
    html.pp-lock{overflow:hidden}
    .pp-ov,.pp-ov input,.pp-ov button,.pp-sheet,.pp-sheet button,.pp-bar,.pp-bar button{font-family:var(--font-body,Inter,system-ui,sans-serif)}
    .pp-ov h2,.pp-sheet h3{font-family:inherit;letter-spacing:0}
    .pp-in,.pp-base input{font-variant-numeric:tabular-nums}
    .pp-hd{flex:0 0 auto;background:#fff;border-bottom:1px solid #ececec;padding:10px 14px 8px}
    .pp-hd-row{display:flex;align-items:center;gap:8px}
    .pp-hd h2{flex:1;margin:0;font-weight:600;font-size:16px}
    .pp-x{width:32px;height:32px;border:0;border-radius:50%;background:transparent;font-size:18px;cursor:pointer;color:inherit}
    .pp-tools{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
    .pp-tools button{border:1px solid #dcdcdc;background:#fff;color:#333;border-radius:999px;padding:5px 12px;font-weight:500;font-size:12px;cursor:pointer}
    .pp-tools button:not(.pp-off){border-color:#c9a13b;background:#fbf4de;color:#7a5a08}
    .pp-pick{flex:0 0 auto;position:relative;padding:8px 14px;background:#fff;border-bottom:1px solid #ececec}
    .pp-dd{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #dcdcdc;border-radius:12px;padding:9px 12px;background:#fff;color:#222;font-size:13px;font-weight:500;cursor:pointer;text-align:left}
    .pp-dd span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pp-dd em{font-style:normal;font-size:11.5px;font-weight:500;color:#7a5a08;background:#fbf4de;border-radius:999px;padding:2px 8px}
    .pp-dd b{font-weight:400;font-size:11px;color:#8a8a8a;transition:transform .12s}
    .pp-dd[aria-expanded="true"]{border-color:#c9a13b}.pp-dd[aria-expanded="true"] b{transform:rotate(180deg)}
    .pp-menu{position:absolute;z-index:5;left:14px;right:14px;top:calc(100% - 4px);background:#fff;border:1px solid #e4e4e4;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.14);padding:8px;display:flex;flex-direction:column;gap:6px;max-height:min(70vh,460px)}
    .pp-menu[hidden]{display:none}
    .pp-q{width:100%;box-sizing:border-box;border:1px solid #dcdcdc;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:400;background:#fff;color:#222;outline:none}
    .pp-q:focus{border-color:#c9a13b}
    .pp-qa{display:flex;align-items:center;gap:6px;font-size:12px;color:#8a8a8a}
    .pp-qa button{border:0;background:transparent;color:#7a5a08;font-size:12px;font-weight:500;cursor:pointer;padding:3px 6px;border-radius:8px}
    .pp-qa span{margin-left:auto}
    .pp-dlist{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;min-height:0;flex:1 1 auto;contain:content}
    .pp-opt{display:flex;align-items:center;gap:9px;padding:8px 8px;border-radius:9px;font-size:13px;color:#2a2a2a;cursor:pointer}
    .pp-opt[hidden]{display:none}
    .pp-opt:hover{background:#f6f2e8}
    .pp-opt input{accent-color:#1c1c1c;width:16px;height:16px;margin:0;flex:none}
    .pp-opt span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pp-opt i{font-style:normal;font-size:11.5px;color:#8a8a8a}
    .pp-none{padding:14px 8px;text-align:center;font-size:12.5px;color:#8a8a8a}
    .pp-none[hidden]{display:none}
    .pp-ddone{border:0;border-radius:10px;background:#1c1c1c;color:#fff;padding:9px;font-size:13px;font-weight:500;cursor:pointer}
    .pp-body{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:4px 12px 84px}
    .pp-empty{padding:32px 22px;text-align:center;color:#8a8a8a;font-size:13px}
    .pp-cat{position:sticky;top:-4px;z-index:2;padding:14px 0 6px;background:var(--bg-page,#f6f2e8)}
    .pp-ch{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 12px;border-radius:12px;background:#1c1c1c;color:#fff;font-weight:600;font-size:13.5px}
    .pp-ch b{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pp-ch span{flex:none;font-weight:400;font-size:11.5px;color:rgba(255,255,255,.72)}
    .pp-base{margin:0 0 8px;padding:9px 12px;border-radius:var(--r-md,14px);background:var(--bg-card,#fff);box-shadow:var(--shadow-sm,0 1px 6px rgba(0,0,0,.06));display:flex;align-items:center;gap:8px}
    .pp-base label{font-size:12.5px;flex:1;min-width:0;color:#333}
    .pp-base input{width:76px;height:30px;border:1px solid #dcdcdc;border-radius:8px;background:#fff;text-align:center;font-size:13px;color:#1c1c1c}
    .pp-base small{font-size:11px;color:#8a8a8a;white-space:nowrap}
    .pp-base button{border:1px solid #dcdcdc;background:#fff;color:#333;border-radius:999px;padding:4px 10px;font-weight:500;font-size:11.5px;cursor:pointer;white-space:nowrap}
    .pp-row{margin:8px 0;padding:12px 12px 10px;border-radius:var(--r-md,14px);background:var(--bg-card,#fff);box-shadow:var(--shadow-sm,0 1px 6px rgba(0,0,0,.06))}
    .pp-row.pp-chg{background:#fffdf5;box-shadow:0 0 0 1px #e8d9a0}
    .pp-nm{font-weight:500;font-size:14px;line-height:1.25;color:#1c1c1c}
    .pp-nm small{margin-left:6px;font-weight:400;font-size:10.5px;color:#8a8a8a}
    .pp-nm small.pp-hid{color:#b3261e}
    .pp-link{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:#f3f3f3;color:#555;font-weight:400;font-size:10px;cursor:pointer;border:0}
    .pp-ln{display:grid;grid-template-columns:42px minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:center;margin-top:6px}
    .pp-sz{font-size:12px;color:#555;white-space:nowrap}
    .pp-ln.pp-long{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .pp-ln.pp-long .pp-sz{grid-column:1/-1;white-space:normal;margin-bottom:-2px}
    .pp-old{flex:0 0 auto;font-size:10.5px;color:#9a9a9a;text-decoration:line-through;white-space:nowrap}
    .pp-old:empty{display:none}
    .pp-fld{display:flex;align-items:center;gap:6px;min-width:0}
    .pp-lb{flex:0 0 30px;font-size:10.5px;color:#8a8a8a}
    .pp-in{flex:1 1 auto;width:100%;min-width:0;height:30px;border:1px solid #dcdcdc;border-radius:8px;background:#fff;text-align:center;font-weight:400;font-size:13.5px;color:#1c1c1c;padding:0 4px;-webkit-appearance:none;appearance:none}
    .pp-in.pp-m{background:#fff;color:#1c1c1c}
    .pp-in.pp-up{border-color:#c9a13b;background:#fbf4de;color:#6b4e06}
    .pp-in.pp-bad{border-color:#c0392b;background:#fdecea;color:#c0392b}
    .pp-in:focus{outline:none;border-color:#c9a13b;box-shadow:0 0 0 3px rgba(201,161,59,.2)}
    .pp-bar{position:fixed;left:0;right:0;bottom:0;z-index:710;background:#fff;border-top:1px solid #e5e5e5;box-shadow:0 -4px 14px rgba(0,0,0,.06);padding:8px 14px calc(8px + env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:8px}
    .pp-bar[hidden]{display:none}
    .pp-bar .pp-n{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#444}
    .pp-bar .pp-n b{font-weight:600;color:#1c1c1c}
    .pp-bar button{border:0;border-radius:999px;padding:8px 16px;font-weight:500;font-size:13px;cursor:pointer;white-space:nowrap}
    .pp-go{background:#1c1c1c;color:#fff}
    .pp-go[disabled]{background:#dcdcdc;color:#8a8a8a;pointer-events:none}
    .pp-ghost{background:#fff;color:#333;border:1px solid #dcdcdc !important}
    .pp-done{background:#eef8f1;border-top-color:#cfe8d8;color:#1f7a42}
    .pp-done .pp-n,.pp-done .pp-n b{color:#1f7a42}
    .pp-sheet-bg{position:fixed;inset:0;z-index:720;overscroll-behavior:contain;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center}
    .pp-sheet{width:100%;max-width:480px;max-height:70vh;overflow:hidden;display:flex;flex-direction:column;background:#fff;border-radius:16px 16px 0 0;padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px))}
    .pp-sheet h3{margin:0 0 6px;font-weight:600;font-size:15px}
    .pp-list{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;flex:1 1 auto}
    .pp-li{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:12.5px}
    .pp-li b{font-weight:500;white-space:nowrap}
    .pp-li.pp-lwarn b{color:#b36b00}
    .pp-note{margin-top:8px;padding:6px 10px;border-radius:8px;font-size:12px}
    .pp-note.pp-nbad{background:#fdecea;color:#c0392b}
    .pp-note.pp-nwarn{background:#fff3d6;color:#8a5a00}
    .pp-btns{display:flex;gap:8px;margin-top:12px}
    .pp-btns button{flex:1;border:0;border-radius:999px;padding:10px;font-weight:500;font-size:13.5px;cursor:pointer}
    .pp-b1{background:#1c1c1c;color:#fff}.pp-b1[disabled]{background:#dcdcdc;color:#8a8a8a;pointer-events:none}
    .pp-b2{background:#f3f3f3;color:#333}
    .pp-tools button[disabled],.pp-base button[disabled]{opacity:.4;pointer-events:none}
    html.night .pp-hd,html.night .pp-pick,html.night .pp-menu,html.night .pp-dd,html.night .pp-sheet,html.night .pp-row,html.night .pp-bar{background:#1d1a14;color:#f0e8d2;border-color:#3a3427}
    html.night .pp-q{background:#26221a;color:#f0e8d2;border-color:#3a3427}
    html.night .pp-opt{color:#f0e8d2}html.night .pp-opt:hover{background:#2a2517}
    html.night .pp-in,html.night .pp-base input{background:#26221a;color:#f0e8d2;border-color:#3a3427}
    html.night .pp-cat{background:#14110c}
    html.night .pp-ch{background:#3a3427;color:#f0e8d2}
    html.night .pp-base{background:#2a2517;color:#e8d9a8;border-color:#3a3427}
    html.night .pp-base label{color:#e8d9a8}html.night .pp-base button{background:#26221a;color:#e8d9a8;border-color:#5a4d2a}
    html.night .pp-nm,html.night .pp-bar .pp-n b{color:#f0e8d2}
  `;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- state
  const data = new Map(); // category -> [ { id, name, cat, l1, p1, m1, l2, p2, m2, has2, enabled, out } ]  (the saved values)
  const loading = new Set();
  const inflight = new Map(); // category -> the read in progress (asking twice shares it)
  let ddOpen = false; // the category dropdown
  let ddQ = ""; // its search text
  let ddKey = ""; // what was chosen when it was opened
  const meta = new Map(); // category -> { n: item count when read, ref: the Products tab's list it was copied from (or null) }
  const sel = new Set(); // chosen categories
  const cur = new Map(); // product id -> { p1, m1, p2, m2 } as typed (strings); only for products touched
  let links = null; // the saved note: { b: {category: base}, d: {id: [diff1, diff2|null]} }; null = not read yet
  let linksJson = ""; // the note as it was when read ("" = none)
  let draft = { b: {}, d: {} }; // links being changed
  let ov = null;
  let showBase = false;
  let busy = false;
  let fileInput = null;

  const num = (s) => {
    if (s == null) return null;
    const t = String(s).replace(/[₹,\s]/g, "");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  const fmt = (n) => (n == null || Number.isNaN(n) ? "" : String(r2(n)));
  /** How many kg a size label stands for ("500g" = 0.5, "1kg" = 1). Pieces / trays / unknown labels count as 1. */
  const kgOf = (label) => {
    const m = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|grams?|gms?|g)\b/i.exec(label || "");
    if (!m) return 1;
    return m[2].toLowerCase().startsWith("k") ? Number(m[1]) : Number(m[1]) / 1000;
  };
  const fac = (r, n) => kgOf(n === 1 ? r.l1 : r.l2);
  const money = (n) => (n == null ? "–" : "₹" + Number(r2(n)).toLocaleString("en-IN"));

  const rowById = (id) => {
    for (const rows of data.values()) for (const r of rows) if (r.id === id) return r;
    return null;
  };
  const toRow = (p) => ({
    id: p.id, name: p.name, cat: p.category || "", l1: p.variant1Label || "", p1: p.variant1Price == null ? null : Number(p.variant1Price),
    m1: p.variant1Mrp == null ? null : Number(p.variant1Mrp), l2: p.variant2Label || "",
    p2: p.variant2Price == null ? null : Number(p.variant2Price), m2: p.variant2Mrp == null ? null : Number(p.variant2Mrp),
    has2: !!p.variant2Label && p.variant2Price != null, enabled: p.enabled !== false, out: !!p.outOfStock,
  });
  const vals = (r) => cur.get(r.id) || { p1: fmt(r.p1), m1: fmt(r.m1), p2: fmt(r.p2), m2: fmt(r.m2) };

  // ---------------------------------------------------------------- loading
  /** The products of a category. Asked for again only when something changed:
   *  - the Products tab holds the list (it keeps it current after every add / edit / delete): taken from there, no request;
   *  - otherwise the copy from the last visit is kept while the category still has the same number of items;
   *  - a new / removed item (or a list the Products tab dropped) reads that one category again - one request. */
  function loadCat(name) {
    if (inflight.has(name)) return inflight.get(name);
    const p = loadCatNow(name).finally(() => inflight.delete(name));
    inflight.set(name, p);
    return p;
  }
  async function loadCatNow(name) {
    const held = window.AdminProducts.rowsOf && window.AdminProducts.rowsOf(name);
    const n = (window.AdminProducts.categories().find((c) => c.name === name) || {}).n;
    const m = meta.get(name);
    if (data.has(name)) {
      if (held) {
        if (m && m.ref === held) return;
        data.set(name, held.map(toRow));
        meta.set(name, { n, ref: held });
        upgradeLegacy(data.get(name));
        return;
      }
      if (m && !m.ref && m.n === n) return;
    }
    loading.add(name);
    try {
      const rows = held || (await Api.get(BY_CAT(name)));
      if (!held && window.AdminProducts.prime) window.AdminProducts.prime(name, rows); // the Products tab can show it without asking again
      data.set(name, (rows || []).map(toRow));
      meta.set(name, { n, ref: held || (window.AdminProducts.rowsOf && window.AdminProducts.rowsOf(name) === rows ? rows : null) });
      upgradeLegacy(data.get(name));
    } catch (err) {
      Toast.show(err.message || "Could not load that category.", "error");
      sel.delete(name);
    } finally {
      loading.delete(name);
    }
  }
  async function loadLinks() {
    if (links) return true;
    try {
      const r = await Api.get("/api/admin/products/prices/links");
      let o = null;
      try { o = r && r.links ? JSON.parse(r.links) : null; } catch { o = null; }
      links = { b: (o && o.b) || {}, d: (o && o.d) || {} };
      linksJson = r && r.links ? JSON.stringify(links) : "";
      draft = JSON.parse(JSON.stringify(links));
      data.forEach((rows) => upgradeLegacy(rows));
      return true;
    } catch (err) {
      Toast.show(err.message || "Could not read the base rates.", "error");
      return false;
    }
  }
  /** Differences saved by the first version (fixed rupees, price only) become per-kg ones: price - base x kg, and MRP the same way. */
  function upgradeLegacy(rows) {
    if (!links) return;
    rows.forEach((r) => {
      const d = links.d[r.id];
      const b = links.b[r.cat];
      if (!d || d.length !== 2 || b == null) return;
      const f1 = fac(r, 1), f2 = fac(r, 2);
      const nd = [r2(d[0] + b * (1 - f1)), r.has2 && d[1] != null ? r2(d[1] + b * (1 - f2)) : null, r.m1 > 0 ? r2(r.m1 - b * f1) : null, r.has2 && r.m2 > 0 ? r2(r.m2 - b * f2) : null, 2];
      links.d[r.id] = nd;
      if (draft.d[r.id] && draft.d[r.id].length === 2) draft.d[r.id] = nd.slice();
    });
    healGaps(rows);
  }
  /** The saved prices are the truth: a linked item's gap to the rate is measured again from them whenever the list is read, so a price
   *  changed elsewhere (the Products tab, an earlier file) never leaves an old gap behind. Items being edited here are left alone. */
  function healGaps(rows) {
    if (!links) return;
    rows.forEach((r) => {
      const d = links.d[r.id];
      const b = links.b[r.cat];
      if (!d || d.length !== 5 || b == null || cur.has(r.id)) return;
      if (JSON.stringify(draft.d[r.id]) !== JSON.stringify(d)) return;
      const f1 = fac(r, 1), f2 = fac(r, 2);
      const nd = [
        r2(r.p1 - b * f1),
        r.has2 && r.p2 != null ? r2(r.p2 - b * f2) : null,
        r.m1 > 0 ? r2(r.m1 - b * f1) : null,
        r.has2 && r.m2 > 0 ? r2(r.m2 - b * f2) : null,
        2,
      ];
      links.d[r.id] = nd;
      draft.d[r.id] = nd.slice();
    });
  }
  const linksDirty = () => !!links && JSON.stringify(draft) !== JSON.stringify(links);

  // ---------------------------------------------------------------- the sheet
  // While the sheet (or its popup) is open the page behind must not move: it is pinned in place and put back where it was on close.
  let lockY = null;
  function lockPage() {
    if (lockY != null) return;
    lockY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const b = document.body.style;
    b.position = "fixed"; b.top = `-${lockY}px`; b.left = "0"; b.right = "0"; b.width = "100%";
    document.documentElement.classList.add("pp-lock");
  }
  function unlockPage() {
    if (lockY == null) return;
    const b = document.body.style;
    b.position = ""; b.top = ""; b.left = ""; b.right = ""; b.width = "";
    document.documentElement.classList.remove("pp-lock");
    window.scrollTo(0, lockY);
    lockY = null;
  }
  function open() {
    if (ov) return;
    lockPage();
    cur.clear();
    if (links) draft = JSON.parse(JSON.stringify(links));
    const names = window.AdminProducts.categories().map((c) => c.name);
    names.forEach((n) => { if (window.AdminProducts.isOpen(n)) sel.add(n); });
    ov = document.createElement("div");
    ov.className = "pp-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    document.body.appendChild(ov);
    Promise.all([...sel].map(loadCat)).then(draw);
    draw();
    document.addEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key !== "Escape" || !ov || document.querySelector(".pp-sheet-bg")) return;
    if (ddOpen) closeDd();
    else close();
  }
  function close() {
    if (!ov) return;
    if (changedRows().length || linksDirty()) {
      if (!confirm("Discard unsaved prices?")) return;
    }
    cur.clear();
    if (links) draft = JSON.parse(JSON.stringify(links));
    ov.remove();
    ov = null;
    unlockPage();
    sel.clear();
    ddOpen = false;
    ddQ = "";
    document.removeEventListener("keydown", onKey);
  }

  function draw() {
    if (!ov) return;
    const cats = window.AdminProducts.categories();
    const opts = cats
      .map((c) => `<label class="pp-opt" data-n="${esc(c.name)}" data-q="${esc(c.name.toLowerCase())}"><input type="checkbox" data-cat="${esc(c.name)}"${sel.has(c.name) ? " checked" : ""} /><span>${esc(c.name)}</span><i>${c.n}</i></label>`)
      .join("");
    ov.innerHTML = `
      <div class="pp-hd">
        <div class="pp-hd-row"><h2>Update prices</h2><button class="pp-x" type="button" data-pp="close" aria-label="Close">✕</button></div>
        <div class="pp-tools">
          <button type="button" class="${showBase ? "" : "pp-off"}" data-pp="base">Rates ${showBase ? "▴" : "▾"}</button>
          <button type="button" class="pp-off" data-pp="down">⬇ Download</button>
          <button type="button" class="pp-off" data-pp="up">⬆ Upload</button>
        </div>
      </div>
      <div class="pp-pick">
        <button type="button" class="pp-dd" data-pp="dd" aria-haspopup="listbox" aria-expanded="${ddOpen}"><span data-dd="label"></span><em data-dd="count"></em><b>▾</b></button>
        <div class="pp-menu" data-dd="menu"${ddOpen ? "" : " hidden"}>
          <input class="pp-q" data-pp="ddq" type="search" placeholder="Search categories" autocomplete="off" spellcheck="false" aria-label="Search categories" value="${esc(ddQ)}" />
          <div class="pp-qa"><button type="button" data-pp="ddall">Select all</button><button type="button" data-pp="ddclear">Clear</button><span data-dd="shown"></span></div>
          <div class="pp-dlist" role="listbox" aria-multiselectable="true" data-dd="list">${opts}<div class="pp-none" data-dd="none" hidden>No category matches</div></div>
          <button type="button" class="pp-ddone" data-pp="dddone">Done</button>
        </div>
      </div>
      <div class="pp-body" data-pp="body"></div>
      <div class="pp-bar" data-pp="bar" hidden></div>`;
    ddFilter();
    ddLabel();
    drawBody();
    updateBar();
    if (ddOpen && ov.contains(document.activeElement) === false) { const q = ov.querySelector('[data-pp="ddq"]'); if (q) q.focus({ preventScroll: true }); }
  }

  // ---------------------------------------------------------------- category dropdown (multi-select + search)
  // The rows are built once; searching only hides / shows them (no re-drawing), choosing only ticks a box and updates the count.
  // The products are read when the dropdown is closed - but each tick starts that category's read in the background, so it is usually ready by then.
  function ddLabel() {
    if (!ov) return;
    const names = new Set(window.AdminProducts.categories().map((c) => c.name));
    const k = [...sel].filter((n) => names.has(n));
    const lab = ov.querySelector('[data-dd="label"]');
    const cnt = ov.querySelector('[data-dd="count"]');
    if (!lab) return;
    lab.textContent = !k.length ? "Choose categories" : k.length === 1 ? k[0] : k.length === names.size ? "All categories" : k.slice(0, 2).join(", ") + (k.length > 2 ? "…" : "");
    cnt.textContent = k.length ? `${k.length} selected` : "";
    cnt.hidden = !k.length;
    const sh = ov.querySelector('[data-dd="shown"]');
    if (sh) sh.dataset.sel = String(k.length);
  }
  let ddRaf = 0;
  function ddFilter() {
    if (!ov) return;
    const list = ov.querySelector('[data-dd="list"]');
    if (!list) return;
    const toks = ddQ.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    const rows = list.querySelectorAll(".pp-opt");
    rows.forEach((r) => {
      const q = r.dataset.q;
      const hit = !toks.length || toks.every((t) => q.includes(t));
      if (r.hidden === hit) r.hidden = !hit;
      if (hit) shown++;
    });
    list.querySelector('[data-dd="none"]').hidden = shown > 0 || !rows.length;
    ov.querySelector('[data-dd="shown"]').textContent = toks.length ? `${shown} of ${rows.length}` : `${rows.length} categories`;
  }
  const ddKeyNow = () => [...sel].sort().join("\u0001");
  function openDd() {
    if (!ov || ddOpen) return;
    ddOpen = true;
    ddKey = ddKeyNow();
    const m = ov.querySelector('[data-dd="menu"]');
    m.hidden = false;
    ov.querySelector('[data-pp="dd"]').setAttribute("aria-expanded", "true");
    const q = ov.querySelector('[data-pp="ddq"]');
    q.focus({ preventScroll: true });
    q.select();
  }
  async function closeDd() {
    if (!ov || !ddOpen) return;
    ddOpen = false;
    ddQ = "";
    const m = ov.querySelector('[data-dd="menu"]');
    m.hidden = true;
    const q = ov.querySelector('[data-pp="ddq"]');
    q.value = "";
    ddFilter();
    ov.querySelector('[data-pp="dd"]').setAttribute("aria-expanded", "false");
    if (ddKeyNow() === ddKey && [...sel].every((n) => data.has(n))) return; // nothing changed: leave the sheet as it is
    drawBody();
    await Promise.all([...[...sel].map(loadCat), showBase && !links && sel.size ? loadLinks() : null]); // the rates open with no category: read now that there is one
    if (!ov) return;
    ddLabel();
    ov.querySelectorAll(".pp-opt input").forEach((c) => { c.checked = sel.has(c.dataset.cat); });
    drawBody();
    updateBar();
  }
  function ddSetShown(on) {
    ov.querySelectorAll(".pp-opt:not([hidden]) input").forEach((c) => {
      if (c.checked === on) return;
      c.checked = on;
      if (on) { sel.add(c.dataset.cat); loadCat(c.dataset.cat); } else sel.delete(c.dataset.cat);
    });
    ddLabel();
  }

  function drawBody() {
    const body = ov.querySelector('[data-pp="body"]');
    const picked = [...sel].filter((n) => window.AdminProducts.categories().some((c) => c.name === n));
    if (!picked.length) {
      body.innerHTML = `<div class="pp-empty">Pick a category above.</div>`;
      return;
    }
    body.innerHTML = picked
      .map((name) => {
        const rows = data.get(name);
        if (!rows) return `<div class="pp-cat"><div class="pp-ch"><b>${esc(name)}</b><span>loading…</span></div></div>`;
        const base = showBase ? baseStripHtml(name, rows) : "";
        return `<div class="pp-cat" data-catname="${esc(name)}"><div class="pp-ch"><b>${esc(name)}</b><span>${rows.length} item${rows.length === 1 ? "" : "s"}</span></div></div>${base}${rows.map(rowHtml).join("")}`;
      })
      .join("");
    // re-check everything that is already typed
    picked.forEach((n) => (data.get(n) || []).forEach((r) => paintRow(r.id)));
  }

  function baseStripHtml(name, rows) {
    if (!links) return `<div class="pp-base"><small>Loading…</small></div>`;
    const linked = rows.filter((r) => draft.d[r.id]).length;
    const b = draft.b[name];
    return `<div class="pp-base" data-base="${esc(name)}">
      <label>Rate ₹</label>
      <input type="text" inputmode="decimal" data-pp="baseval" value="${b == null ? "" : fmt(b)}" placeholder="" aria-label="Today's base rate for ${esc(name)}" />
      ${linked
        ? `<button type="button" data-pp="unlinkcat">Unlink all</button>`
        : `<button type="button" data-pp="linkcat">Link items</button>`}
      ${linked ? `<small>${linked}/${rows.length} linked</small>` : ""}
    </div>`;
  }

  function lineHtml(r, n) {
    const lab = n === 1 ? r.l1 : r.l2;
    return `<div class="pp-ln${lab.length > 6 ? " pp-long" : ""}"><span class="pp-sz">${esc(lab)}</span>
      <label class="pp-fld"><span class="pp-lb">Price</span><input class="pp-in" type="text" inputmode="decimal" data-id="${r.id}" data-f="p${n}" aria-label="${esc(r.name)} ${esc(lab)} price" /><span class="pp-old" data-oldf="p${n}"></span></label>
      <label class="pp-fld"><span class="pp-lb">MRP</span><input class="pp-in pp-m" type="text" inputmode="decimal" data-id="${r.id}" data-f="m${n}" aria-label="${esc(r.name)} ${esc(lab)} MRP" /><span class="pp-old" data-oldf="m${n}"></span></label></div>`;
  }
  function rowHtml(r) {
    const flag = !r.enabled ? `<small class="pp-hid">Hidden</small>` : r.out ? `<small class="pp-hid">Out of stock</small>` : "";
    return `<div class="pp-row" data-row="${r.id}"><div class="pp-nm">${esc(r.name)}${flag}<span data-linkwrap></span></div>${lineHtml(r, 1)}${r.has2 ? lineHtml(r, 2) : ""}</div>`;
  }

  /** Writes a product's values into its inputs and marks what changed / what is wrong. */
  function paintRow(id, skipInputs) {
    const r = rowById(id);
    const el = ov && ov.querySelector(`[data-row="${id}"]`);
    if (!r || !el) return;
    const v = vals(r);
    ["p1", "m1", "p2", "m2"].forEach((f) => {
      const inp = el.querySelector(`input[data-f="${f}"]`);
      if (!inp) return;
      if (!skipInputs && document.activeElement !== inp) inp.value = v[f];
      const typed = num(inp.value);
      const was = r[f];
      const bad = isBad(r, f, v);
      const changed = !Number.isNaN(typed) && (typed ?? null) !== (was ?? null) && !(typed == null && was == null);
      inp.classList.toggle("pp-up", changed && !bad);
      inp.classList.toggle("pp-bad", bad);
    });
    // the saved value, struck through right beside any box that was changed
    ["p1", "m1", "p2", "m2"].forEach((f) => {
      const old = el.querySelector(`[data-oldf="${f}"]`);
      if (!old) return;
      const was = r[f];
      const now = num(v[f]);
      old.textContent = now != null && !Number.isNaN(now) && was != null && r2(now) !== r2(was) ? money(was) : "";
    });
    el.classList.toggle("pp-chg", changedFields(r).length > 0);
    const lw = el.querySelector("[data-linkwrap]");
    if (lw) {
      const d = draft.d[r.id];
      lw.innerHTML = showBase && d ? `<button type="button" class="pp-link" data-pp="unlinkitem" data-id="${r.id}" title="Take out of the rate (back to the saved price)"> ${d[0] >= 0 ? "+" : "−"}₹${Math.abs(r2(d[0]))}${r.has2 && d[1] != null ? " / " + (d[1] >= 0 ? "+" : "−") + "₹" + Math.abs(r2(d[1])) : ""} ✕</button>` : "";
    }
  }

  /** A box is wrong when its price is empty / zero / not a number, or the price is above a MRP that is filled in. */
  function isBad(r, f, v) {
    const n = f.slice(1);
    if (n === "2" && !r.has2) return false;
    const p = num(v["p" + n]);
    const m = num(v["m" + n]);
    if (f[0] === "p") return p == null || Number.isNaN(p) || p <= 0 || (m != null && !Number.isNaN(m) && m > 0 && p > m);
    return Number.isNaN(m) || (m != null && m > 0 && p != null && !Number.isNaN(p) && p > m);
  }
  function changedFields(r) {
    if (!cur.has(r.id)) return [];
    const v = cur.get(r.id);
    const out = [];
    ["p1", "m1", "p2", "m2"].forEach((f) => {
      if (f[1] === "2" && !r.has2) return;
      const t = num(v[f]);
      const w = r[f];
      if (Number.isNaN(t)) out.push(f);
      else if ((t ?? null) !== (w ?? null) && !(t != null && w != null && r2(t) === r2(w))) out.push(f);
    });
    return out;
  }
  const changedRows = () => [...data.values()].flat().filter((r) => changedFields(r).length);

  function setVal(r, f, text) {
    const v = cur.get(r.id) || { p1: fmt(r.p1), m1: fmt(r.m1), p2: fmt(r.p2), m2: fmt(r.m2) };
    v[f] = text;
    cur.set(r.id, v);
    if (!changedFields(r).length) cur.delete(r.id);
  }

  function updateBar() {
    const bar = ov && ov.querySelector('[data-pp="bar"]');
    if (!bar) return;
    const rows = changedRows();
    const dirty = rows.length > 0 || linksDirty();
    bar.hidden = !dirty;
    if (!dirty) return;
    const prices = rows.reduce((n, r) => n + changedFields(r).filter((f) => f[0] === "p").length, 0);
    const bad = rows.some((r) => changedFields(r).some((f) => isBad(r, f, vals(r))));
    bar.className = "pp-bar";
    bar.innerHTML = `
      <div class="pp-n"><b>${prices} changed</b> · ${rows.length} item${rows.length === 1 ? "" : "s"}${bad ? " · fix red" : ""}</div>
      <button type="button" class="pp-ghost" data-pp="reset">Reset</button>
      <button type="button" class="pp-go" data-pp="review"${bad ? " disabled" : ""}>Review</button>`;
  }

  // ---------------------------------------------------------------- base rates
  /** price = base x kg + its difference, and the MRP the same way; `skip` = boxes that were typed and must not move. */
  function followBase(r, base, d, skip) {
    const f1 = fac(r, 1), f2 = fac(r, 2);
    if (!skip.has("p1") && d[0] != null) setVal(r, "p1", fmt(r2(base * f1 + d[0])));
    if (r.has2 && !skip.has("p2") && d[1] != null) setVal(r, "p2", fmt(r2(base * f2 + d[1])));
    if (!skip.has("m1") && d[2] != null) setVal(r, "m1", fmt(r2(base * f1 + d[2])));
    if (r.has2 && !skip.has("m2") && d[3] != null) setVal(r, "m2", fmt(r2(base * f2 + d[3])));
  }
  function applyBase(name, base) {
    const rows = data.get(name) || [];
    draft.b[name] = base;
    rows.forEach((r) => {
      const d = draft.d[r.id];
      if (!d) return;
      followBase(r, base, d, new Set());
      paintRow(r.id);
    });
    updateBar();
  }
  function linkCat(name, base) {
    (data.get(name) || []).forEach((r) => {
      const v = vals(r);
      const p1 = num(v.p1);
      if (p1 == null || Number.isNaN(p1)) return;
      const p2 = r.has2 ? num(v.p2) : null;
      const m1 = num(v.m1), m2 = r.has2 ? num(v.m2) : null;
      const f1 = fac(r, 1), f2 = fac(r, 2);
      draft.d[r.id] = [
        r2(p1 - base * f1),
        p2 == null || Number.isNaN(p2) ? null : r2(p2 - base * f2),
        m1 > 0 ? r2(m1 - base * f1) : null,
        m2 > 0 ? r2(m2 - base * f2) : null,
        2,
      ];
    });
    draft.b[name] = base;
  }
  function unlinkCat(name) {
    (data.get(name) || []).forEach((r) => { if (draft.d[r.id]) cur.delete(r.id); delete draft.d[r.id]; }); // they go back to their saved prices
    delete draft.b[name];
  }
  /** A box typed by hand on a linked item moves that item's own difference (it stays linked). */
  function relink(r, f) {
    const d = draft.d[r.id];
    const b = draft.b[r.cat];
    if (!d || b == null) return;
    const p = num(vals(r)[f]);
    const k = f[1] === "1" ? 1 : 2;
    if (k === 2 && !r.has2) return;
    const idx = { p1: 0, p2: 1, m1: 2, m2: 3 }[f];
    if (p == null || Number.isNaN(p) || (f[0] === "m" && !(p > 0))) { if (f[0] === "m") d[idx] = null; return; }
    d[idx] = r2(p - b * fac(r, k));
  }

  // ---------------------------------------------------------------- events
  document.addEventListener("click", async (e) => {
    if (!ov) return;
    if (ddOpen && !e.target.closest(".pp-pick") && ov.contains(e.target)) closeDd(); // a tap anywhere else closes it (and shows what was chosen)
    const btn = e.target.closest("[data-pp]");
    if (!btn || !ov.contains(btn)) return;
    const act = btn.dataset.pp;
    if (act === "dd") { if (ddOpen) closeDd(); else openDd(); }
    else if (act === "dddone") closeDd();
    else if (act === "ddall") ddSetShown(true);
    else if (act === "ddclear") ddSetShown(false);
    else if (act === "ddq") return;
    else if (act === "close") close();
    else if (act === "base") {
      if (!showBase && !sel.size) { Toast.show("Please select a category first.", "info"); return; } // the rates belong to a category: the button stays as it is
      showBase = !showBase;
      draw();
      if (showBase && !links && sel.size) { await loadLinks(); drawBody(); updateBar(); } // nothing to show rates for until a category is chosen: no request yet
    } else if (act === "reset") {
      cur.clear();
      if (links) draft = JSON.parse(JSON.stringify(links));
      draw();
    } else if (act === "review") review();
    else if (act === "down") downloadXlsx();
    else if (act === "up") pickFile();
    else if (act === "linkcat") {
      const strip = btn.closest("[data-base]");
      const name = strip.dataset.base;
      const b = num(strip.querySelector("input").value);
      if (b == null || Number.isNaN(b) || b < 0) { Toast.show("Type the rate first.", "error"); return; }
      linkCat(name, b);
      drawBody();
      updateBar();
    } else if (act === "unlinkcat") {
      unlinkCat(btn.closest("[data-base]").dataset.base);
      drawBody();
      updateBar();
    } else if (act === "unlinkitem") {
      // take this item out of the rate: it stops following it and goes back to its saved price / MRP (type a price after that to set it by hand)
      const id = Number(btn.dataset.id);
      delete draft.d[id];
      cur.delete(id);
      paintRow(id);
      updateBar();
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!ov || !t.matches || !t.matches(".pp-opt input") || !ov.contains(t)) return;
    const name = t.dataset.cat;
    if (t.checked) { sel.add(name); loadCat(name); } // start reading it now, so it is ready when the dropdown closes
    else sel.delete(name);
    ddLabel();
  });

  document.addEventListener("input", (e) => {
    if (!ov || !ov.contains(e.target)) return;
    const t = e.target;
    if (t.dataset.pp === "ddq") {
      ddQ = t.value;
      cancelAnimationFrame(ddRaf);
      ddRaf = requestAnimationFrame(ddFilter);
      return;
    }
    if (t.dataset.pp === "baseval") {
      const name = t.closest("[data-base]").dataset.base;
      const b = num(t.value);
      if (b != null && !Number.isNaN(b) && b >= 0 && (data.get(name) || []).some((r) => draft.d[r.id])) applyBase(name, b);
      return;
    }
    const id = Number(t.dataset.id);
    if (!id || !t.dataset.f) return;
    const r = rowById(id);
    if (!r) return;
    setVal(r, t.dataset.f, t.value);
    relink(r, t.dataset.f);
    paintRow(id, true);
    updateBar();
  });

  // ---------------------------------------------------------------- review + save
  function review() {
    const rows = changedRows();
    if (!rows.length && !linksDirty()) return;
    const lines = [];
    let warn = 0;
    rows.forEach((r) => {
      const v = vals(r);
      [1, 2].forEach((n) => {
        if (n === 2 && !r.has2) return;
        const p = num(v["p" + n]);
        const m = num(v["m" + n]);
        const pw = r["p" + n];
        const mw = r["m" + n];
        const lab = n === 1 ? r.l1 : r.l2;
        if (p !== pw && r2(p) !== r2(pw)) {
          const big = pw > 0 && Math.abs(p - pw) / pw > JUMP;
          if (big) warn++;
          lines.push({ big, text: `${r.name} · ${lab}`, val: `${money(pw)} → ${money(p)}${big ? " ⚠" : ""}` });
        }
        if ((m ?? null) !== (mw ?? null) && r2(m || 0) !== r2(mw || 0)) lines.push({ big: false, text: `${r.name} · ${lab} MRP`, val: `${money(mw)} → ${money(m)}` });
      });
    });
    const sheet = document.createElement("div");
    sheet.className = "pp-sheet-bg";
    const tooBig = linksDirty() && JSON.stringify(draft).length > 3800;
    sheet.innerHTML = `<div class="pp-sheet" role="dialog" aria-modal="true">
      <h3>Save ${lines.length} change${lines.length === 1 ? "" : "s"}?</h3>
      <div class="pp-list">${lines.map((l) => `<div class="pp-li ${l.big ? "pp-lwarn" : ""}"><span>${esc(l.text)}</span><b>${esc(l.val)}</b></div>`).join("") || `<div class="pp-li"><span>Rates only</span></div>`}</div>
      ${warn ? `<div class="pp-note pp-nwarn">⚠ ${warn} over 20%</div>` : ""}
      ${tooBig ? `<div class="pp-note pp-nbad">Too many linked items</div>` : ""}
      <div class="pp-btns"><button type="button" class="pp-b2" data-x="back">Back</button><button type="button" class="pp-b1" data-x="save"${tooBig ? " disabled" : ""}>Save now</button></div></div>`;
    document.body.appendChild(sheet);
    // a finger on the dimmed area (or the title / buttons) must not drag the page: only the list inside may scroll
    sheet.addEventListener("touchmove", (e) => { if (!e.target.closest(".pp-list")) e.preventDefault(); }, { passive: false });
    sheet.addEventListener("click", async (e) => {
      if (e.target === sheet || e.target.dataset.x === "back") { sheet.remove(); return; }
      if (e.target.dataset.x === "save") {
        e.target.disabled = true;
        e.target.textContent = "Saving…";
        const ok = await save();
        sheet.remove();
        if (ok) showDone(ok);
      }
    });
  }

  function payload(rows) {
    return rows.map((r) => {
      const v = vals(r);
      const o = { id: r.id, p1: num(v.p1), m1: num(v.m1) || null };
      if (r.has2) { o.p2 = num(v.p2); o.m2 = num(v.m2) || null; }
      return o;
    });
  }

  async function save() {
    if (busy) return null;
    busy = true;
    const rows = changedRows();
    const sendLinks = linksDirty() ? JSON.stringify(draft) : null;
    try {
      const res = await Api.post("/api/admin/products/prices", { changes: payload(rows), links: sendLinks });
      const cats = [...new Set(rows.map((r) => r.cat))];
      rows.forEach((r) => {
        const v = vals(r);
        r.p1 = num(v.p1); r.m1 = num(v.m1) || null;
        if (r.has2) { r.p2 = num(v.p2); r.m2 = num(v.m2) || null; }
      });
      if (sendLinks) { links = JSON.parse(sendLinks); linksJson = sendLinks; draft = JSON.parse(sendLinks); }
      cur.clear();
      // the Products tab re-reads only the open categories that changed (the same thing editing one product does)
      if (cats.length && window.AdminProducts.refresh) window.AdminProducts.refresh(true, cats, false);
      return { n: res && res.changed != null ? res.changed : rows.length };
    } catch (err) {
      Toast.show(err.message || "Could not save the prices.", "error");
      return null;
    } finally {
      busy = false;
    }
  }

  function showDone(r) {
    draw();
    const bar = ov.querySelector('[data-pp="bar"]');
    bar.hidden = false;
    bar.className = "pp-bar pp-done";
    bar.innerHTML = `<div class="pp-n"><b>✓ ${r.n} item${r.n === 1 ? "" : "s"} updated</b></div>`;
  }

  // ---------------------------------------------------------------- Excel: writing
  const enc = new TextEncoder();
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

  /** A zip file with the files stored (not compressed) - plenty for a few kilobytes and opens everywhere. */
  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += local.length + name.length + data.length;
    });
    const cdStart = offset;
    central.forEach((c) => {
      const h = new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)]);
      parts.push(h, c.name);
      offset += h.length + c.name.length;
    });
    parts.push(new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(central.length), ...u16(central.length), ...u32(offset - cdStart), ...u32(cdStart), 0, 0]));
    return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  // cell = value | { v, s }  (s = style: 1 header, 2 grey text, 3 gold number, 4 gold +/- number, 5 title, 6 note, 7 gold text)
  function sheetXml(rows, widths, freezeRow) {
    const rs = rows.map((row, ri) => {
      const cs = row.map((cell, ci) => {
        if (cell == null) return "";
        const o = typeof cell === "object" ? cell : { v: cell };
        if (o.v == null || o.v === "") return o.s ? `<c r="${colName(ci)}${ri + 1}" s="${o.s}"/>` : "";
        const ref = `${colName(ci)}${ri + 1}`;
        const st = o.s ? ` s="${o.s}"` : "";
        return typeof o.v === "number"
          ? `<c r="${ref}"${st}><v>${o.v}</v></c>`
          : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(o.v)}</t></is></c>`;
      }).join("");
      return `<row r="${ri + 1}">${cs}</row>`;
    }).join("");
    const pane = freezeRow ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rs}</sheetData></worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="+#,##0.##;-#,##0.##;0"/></numFmts><fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFF3DD8C"/><name val="Arial"/></font><font><b/><sz val="13"/><name val="Arial"/></font><font><i/><sz val="9"/><color rgb="FF7A6F55"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17140F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3C4"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EEDE"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9CFA8"/></left><right style="thin"><color rgb="FFD9CFA8"/></right><top style="thin"><color rgb="FFD9CFA8"/></top><bottom style="thin"><color rgb="FFD9CFA8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  function buildXlsx(rowsByCat) {
    const H = ["Category", "Item", "Size 1", "Current price 1", "New price 1", "Current MRP 1", "New MRP 1", "Size 2", "Current price 2", "New price 2", "Current MRP 2", "New MRP 2"].map((v) => ({ v, s: 1 }));
    const prices = [H];
    const baseCats = [];
    rowsByCat.forEach(([cat, rows]) => {
      if (draft.b[cat] != null && rows.some((r) => draft.d[r.id])) baseCats.push(cat);
      rows.forEach((r) => {
        prices.push([
          { v: cat, s: 2 }, { v: r.name, s: 2 }, { v: r.l1, s: 2 }, { v: r.p1, s: 2 }, { v: null, s: 3 }, { v: r.m1, s: 2 }, { v: null, s: 3 },
          { v: r.has2 ? r.l2 : "", s: 2 }, { v: r.has2 ? r.p2 : null, s: 2 }, { v: r.has2 ? null : null, s: r.has2 ? 3 : 2 }, { v: r.has2 ? r.m2 : null, s: 2 }, { v: null, s: r.has2 ? 3 : 2 },
        ]);
      });
    });
    const rates = [[{ v: "Category", s: 1 }, { v: "Current rate", s: 1 }, { v: "New rate", s: 1 }]];
    baseCats.forEach((c) => rates.push([{ v: c, s: 2 }, { v: links.b[c], s: 2 }, { v: null, s: 3 }]));
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/><sheet name="Rates" sheetId="2" r:id="rId2"/></sheets></workbook>`;
    return zip([
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: wb },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: STYLES },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml(prices, [16, 28, 10, 11, 11, 11, 11, 10, 11, 11, 11, 11], 1) },
      { name: "xl/worksheets/sheet2.xml", data: sheetXml(rates, [18, 13, 13], 1) },
    ]);
  }

  async function downloadXlsx() {
    const picked = [...sel].filter((n) => data.has(n));
    if (!picked.length) { Toast.show("Pick a category first.", "error"); return; }
    if (!(await loadLinks())) return;
    const blob = buildXlsx(picked.map((n) => [n, data.get(n)]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `FreshCutz-prices-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    Toast.show("Excel downloaded.", "success");
  }

  // ---------------------------------------------------------------- Excel: reading
  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read Excel files. Please use a recent Chrome.");
    const ds = new DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(buf);
    let e = b.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("That is not an Excel (.xlsx) file.");
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = new Map();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const raw = b.subarray(start, start + csize);
      out.set(name, method === 0 ? raw : await inflate(raw));
    }
    return out;
  }
  const parseXml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  /** -> { sheets: { name: [[cell,...],...] } } with every cell a string or number (or null). */
  async function readXlsx(buf) {
    const files = await unzip(buf);
    const wb = files.get("xl/workbook.xml");
    if (!wb) throw new Error("That is not an Excel (.xlsx) file.");
    const shared = [];
    if (files.has("xl/sharedStrings.xml")) {
      parseXml(files.get("xl/sharedStrings.xml")).querySelectorAll("si").forEach((si) => shared.push([...si.querySelectorAll("t")].map((t) => t.textContent).join("")));
    }
    const rels = {};
    parseXml(files.get("xl/_rels/workbook.xml.rels")).querySelectorAll("Relationship").forEach((r) => { rels[r.getAttribute("Id")] = r.getAttribute("Target"); });
    const out = {};
    parseXml(wb).querySelectorAll("sheet").forEach((s) => {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let target = rels[rid] || "";
      target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
      const bytes = files.get(target);
      if (!bytes) return;
      const rows = [];
      parseXml(bytes).querySelectorAll("sheetData > row").forEach((row) => {
        const arr = [];
        row.querySelectorAll("c").forEach((c) => {
          const idx = colIndex(c.getAttribute("r") || "A1");
          const t = c.getAttribute("t");
          let v = null;
          if (t === "inlineStr") v = [...c.querySelectorAll("t")].map((x) => x.textContent).join("");
          else {
            const ve = c.querySelector("v");
            if (ve) v = t === "s" ? shared[Number(ve.textContent)] : t === "str" || t === "e" ? ve.textContent : Number(ve.textContent);
          }
          arr[idx] = v;
        });
        rows[Number(row.getAttribute("r")) - 1] = arr;
      });
      out[s.getAttribute("name")] = rows;
    });
    return out;
  }

  function pickFile() {
    if (!fileInput) {
      fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".xlsx";
      fileInput.hidden = true;
      document.body.appendChild(fileInput);
      fileInput.addEventListener("change", async () => {
        const f = fileInput.files[0];
        fileInput.value = "";
        if (f) await importFile(f);
      });
    }
    fileInput.click();
  }

  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();

  async function importFile(file) {
    if (busy) return;
    busy = true;
    try {
      const wb = await readXlsx(await file.arrayBuffer());
      const rows = wb["Prices"] || Object.values(wb)[0];
      if (!rows) throw new Error("The file has no Prices sheet.");
      // find the header row
      let h = -1;
      for (let i = 0; i < Math.min(rows.length, 12); i++) {
        const r = (rows[i] || []).map(norm);
        if (r.includes("item") && r.includes("category")) { h = i; break; }
      }
      if (h < 0) throw new Error("Could not find the Category / Item columns. Use a file downloaded from Update prices.");
      const head = (rows[h] || []).map(norm);
      const col = (name) => head.indexOf(name);
      const pick = (a, b) => (col(a) >= 0 ? col(a) : col(b)); // "New price 1" (or the older "Price 1" files)
      const C = { cat: col("category"), item: col("item"), p1: pick("new price 1", "price 1"), m1: pick("new mrp 1", "mrp 1"), p2: pick("new price 2", "price 2"), m2: pick("new mrp 2", "mrp 2") };
      const wanted = [];
      const body = rows.slice(h + 1).filter((r) => r && r[C.item] != null && String(r[C.item]).trim());
      body.forEach((r) => { const c = String(r[C.cat] || "").trim(); if (c && !wanted.includes(c)) wanted.push(c); });
      const known = window.AdminProducts.categories().map((c) => c.name);
      const use = wanted.filter((c) => known.includes(c));
      await Promise.all(use.map(loadCat));
      use.forEach((c) => sel.add(c));
      // today's rates sheet
      const rateRows = wb["Rates"] || wb["Today's rates"] || [];
      const fileBase = {};
      rateRows.forEach((r) => {
        if (!r || typeof r[0] !== "string") return;
        const v = typeof r[2] === "number" ? r[2] : typeof r[1] === "number" ? r[1] : null; // "New rate" if filled, else the current one
        if (v != null) fileBase[r[0].trim()] = v;
      });
      if (Object.keys(fileBase).length ) await loadLinks();

      let applied = 0;
      const missing = [];
      const touchedBase = new Set();
      // 1) base rates that changed in the file: linked items follow (unless their own price is typed in the file)
      Object.keys(fileBase).forEach((cat) => {
        if (!links || !use.includes(cat)) return;
        if (draft.b[cat] != null && r2(draft.b[cat]) === r2(fileBase[cat])) return;
        if (!(data.get(cat) || []).some((r) => draft.d[r.id])) return;
        touchedBase.add(cat);
      });
      // from here on the file's rates are the current ones: a price typed in the file is measured against them
      touchedBase.forEach((cat) => { draft.b[cat] = fileBase[cat]; });
      body.forEach((rw) => {
        const cat = String(rw[C.cat] || "").trim();
        const name = String(rw[C.item] || "").trim();
        const list = data.get(cat);
        const r = list && list.find((x) => norm(x.name) === norm(name));
        if (!r) { missing.push(`${name}${cat ? " (" + cat + ")" : ""}`); return; }
        let hit = false;
        const read = (ci) => (ci < 0 ? undefined : rw[ci]);
        const setIf = (f, v) => {
          if (v === undefined || v === null || v === "") return;
          const n = typeof v === "number" ? v : num(v);
          if (n == null || Number.isNaN(n)) return;
          const was = r[f];
          if (was != null && r2(n) === r2(was)) return;
          if (was == null && n === 0) return;
          setVal(r, f, fmt(n));
          relink(r, f); // a linked item keeps its place under the rate: its own difference moves to the price from the file (same as typing it)
          hit = true;
        };
        setIf("p1", read(C.p1));
        setIf("m1", read(C.m1));
        if (r.has2) {
          setIf("p2", read(C.p2));
          setIf("m2", read(C.m2));
        }
        // a linked item follows a changed base rate, except for the boxes that were typed (in the file or earlier)
        if (touchedBase.has(cat) && draft.d[r.id]) {
          followBase(r, fileBase[cat], draft.d[r.id], new Set(changedFields(r)));
          hit = true;
        }
        if (hit) applied++;
      });
      touchedBase.forEach((cat) => { draft.b[cat] = fileBase[cat]; });
      if (touchedBase.size) showBase = true;
      draw();
      const msg = `${applied} item${applied === 1 ? "" : "s"} changed.`;
      if (missing.length) {
        Toast.show(`${msg} Not found: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " +" + (missing.length - 3) : ""}`, "info", 9000);
      } else {
        Toast.show(applied ? msg : "No differences.", applied ? "success" : "info", 5000);
      }
    } catch (err) {
      Toast.show(err.message || "Could not read that file.", "error", 7000);
    } finally {
      busy = false;
    }
  }

  // ---------------------------------------------------------------- the menu button
  const item = document.createElement("button");
  item.className = "pi-item";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.id = "ppOpenBtn";
  item.innerHTML = `<span class="pi-ico">₹</span><b>Update prices</b><span class="pi-sub">Sheet · base rate · Excel</span>`;
  menuGrid.appendChild(item);
  item.addEventListener("click", () => {
    const toggle = document.getElementById("piBulkBtn");
    if (toggle && !menu.hidden) toggle.click(); // closes the Catalog tools menu
    if (!window.AdminProducts.hasProducts()) { Toast.show("There are no products yet.", "error"); return; }
    open();
  });
  document.addEventListener("freshcutz:logout", () => {
    if (ov) { ov.remove(); ov = null; unlockPage(); }
    cur.clear(); data.clear(); meta.clear(); sel.clear(); links = null;
  });

  // for testing / other scripts
  window.ProductPrices = { open, _state: () => ({ data, cur, draft, links }) };
})();
