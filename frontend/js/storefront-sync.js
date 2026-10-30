/* The customer website's catalog: loads products in small pieces, keeps what it has already downloaded,
 * and keeps it up to date. (storefront.js draws the page; this file only deals with the data.)
 *
 * How little it downloads:
 *  - ONE request on page load (/api/products/start): the category tabs + the first 12 products of the tab the
 *    admin chose as the default (or of "All").
 *  - More products only when the customer scrolls near the end (/api/products/page), and only the ones that are
 *    missing: the page knows each product's place ("rank" in All, "catRank" in its category), so products
 *    downloaded for one tab are reused by every other tab.
 *  - The full list is downloaded only the first time the search box is used (/api/products/all); after that,
 *    searching is instant and makes no request.
 *  - Live updates: the server only says what changed, in the smallest form: a price/name/stock edit is just the
 *    changed fields ("patches"), a product hidden or shown is one short note (where it was) — not the product,
 *    not the shop's whole order. A page that is still showing the current version asks nothing more; otherwise
 *    it re-reads just what is on screen.
 *  - Every answer carries a version (ETag), so a browser that already has it gets a tiny "304 not modified".
 *  - The whole list is also SAVED ON THE CUSTOMER'S PHONE (IndexedDB). On the next visit the page shows it at once
 *    and only asks the live stream "is this still the current version?" — when yes (almost always), nothing at all
 *    is downloaded: no first-screen request, no pages while scrolling, no search download. When the shop changed
 *    in the meantime the stream sends just what changed and the saved list is patched. A saved list is used only
 *    when its version is confirmed (or being brought up to date), so it can never be shown as current when it isn't.
 *  - A small shop (up to ALL_LIMIT products) downloads its whole list once, in one request, instead of many pages.
 *
 * Products a customer already has in the cart (or in a past order they reorder) can be anywhere in the
 * catalog, so those are fetched by id on their own (/api/products/by-ids) and kept apart from the ranked pool. */

(() => {
  const PAGE = 12;
  const MAX_PER_REQUEST = 100; // the server's limit for one page
  const ALL_LIMIT = 200; // a shop up to this size downloads its whole list once (one request) instead of page by page
  const SNAP_DB = "fc-catalog";
  const SNAP_STORE = "kv";
  const SNAP_KEY = "snap";
  const SNAP_SCHEMA = 1; // bump when the saved shape (or the products' shape) changes: older saves are then ignored
  const SNAP_MAX_AGE = 30 * 24 * 3600 * 1000; // a save older than this is thrown away
  const CAT_TTL = 10 * 60 * 1000; // how long the admin's default tab is trusted before it is asked again (one tiny request)
  const HEAR_MS = 2500; // how long a visit with a saved list waits for the live stream to answer before showing it anyway
  const SETTLE_MS = 3500; // ...and how long it then waits for the changes the stream reported to be applied

  const catOf = (p) => (p.category || "").trim();
  // Asking with the catalog version we know (?v=) lets the browser keep each answer for good: reloading the page or
  // going back to a tab then needs no request at all, and a changed catalog simply has a new version (= new address).
  const vParam = (v) => (v ? `&v=${encodeURIComponent(v)}` : "");

  /** One consistent copy of what has been downloaded for ONE version of the catalog. */
  function makePool() {
    return {
      byId: new Map(), // id -> product
      byRank: new Map(), // rank (place in "All") -> product
      byCat: new Map(), // category -> Map(catRank -> product)
      complete: false, // every product is here (after the full list was downloaded)
    };
  }

  function addTo(pool, items) {
    for (const p of items) {
      pool.byId.set(p.id, p);
      pool.byRank.set(p.rank, p);
      const c = catOf(p);
      let m = pool.byCat.get(c);
      if (!m) pool.byCat.set(c, (m = new Map()));
      m.set(p.catRank, p);
    }
  }

  let pool = makePool();
  let tabs = []; // [{ name, count }]
  let total = 0;
  let version = null;
  const extra = new Map(); // products fetched by id (cart / reorder): NOT part of the ranked pool
  const gone = new Set(); // ids the live stream said are no longer on the shop (hidden / deleted): never asked for again
  let ui = null; // set by storefront.js: { current(), refreshed(info) }
  let started = false;
  let booting = false; // a visit that started from the saved list is still checking it against the live stream
  let snapCategory = ""; // the admin's default tab, as last known
  let snapCategoryAt = 0; // when that was last confirmed with the server

  // ---- the saved copy on this phone ---------------------------------------------
  // Everything here is best effort: when IndexedDB is missing, blocked or slow, the page simply works as before.

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        try {
          const q = indexedDB.open(SNAP_DB, 1);
          q.onupgradeneeded = () => q.result.createObjectStore(SNAP_STORE);
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
          q.onblocked = () => reject(new Error("blocked"));
        } catch (e) {
          reject(e);
        }
      });
      dbPromise.catch(() => {});
    }
    return dbPromise;
  }

  async function idbGet(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const q = d.transaction(SNAP_STORE, "readonly").objectStore(SNAP_STORE).get(key);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
  }

  async function idbPut(key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(SNAP_STORE, "readwrite");
      tx.objectStore(SNAP_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function idbDel(key) {
    const d = await db();
    return new Promise((resolve) => {
      const tx = d.transaction(SNAP_STORE, "readwrite");
      tx.objectStore(SNAP_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /** The saved copy, or null (none / unreadable / too old / from another version of this code). Never throws, never hangs. */
  async function readSnapshot() {
    try {
      const s = await Promise.race([idbGet(SNAP_KEY), wait(1200).then(() => null)]);
      const ok =
        s &&
        s.schema === SNAP_SCHEMA &&
        typeof s.version === "string" &&
        Array.isArray(s.items) &&
        s.items.length > 0 &&
        Array.isArray(s.tabs) &&
        Date.now() - s.savedAt < SNAP_MAX_AGE &&
        s.items.every((p) => p && p.id != null && Number.isInteger(p.rank) && Number.isInteger(p.catRank));
      if (!ok) {
        if (s) idbDel(SNAP_KEY).catch(() => {});
        return null;
      }
      return s;
    } catch {
      return null;
    }
  }

  let saveTimer = null;
  let savedKey = "";

  /** Saves the held list a moment from now (several changes close together are saved once). */
  function saveSoon() {
    if (!started || !version) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1500);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!started || !version || !pool.byId.size) return;
    // every edit of the shop changes the version, so this says "nothing new to save"
    const key = `${version}|${pool.byId.size}|${pool.complete}|${snapCategory}`;
    if (key === savedKey) return;
    savedKey = key;
    idbPut(SNAP_KEY, {
      schema: SNAP_SCHEMA,
      version,
      category: snapCategory,
      categoryAt: snapCategoryAt,
      tabs,
      total,
      complete: pool.complete,
      items: [...pool.byId.values()],
      savedAt: Date.now(),
    }).catch(() => {
      savedKey = ""; // (full storage, private mode...) the page works the same without it
    });
  }

  const saveData = () => !!(navigator.connection && navigator.connection.saveData);

  // ---- reading what is held -----------------------------------------------

  /** The products of a tab that are held WITHOUT a gap, from its first one on ("All" or a category name). */
  function run(category) {
    const out = [];
    if (!category || category === "All") {
      for (let r = 0; pool.byRank.has(r); r++) out.push(pool.byRank.get(r));
    } else {
      const m = pool.byCat.get(category);
      if (m) for (let r = 0; m.has(r); r++) out.push(m.get(r));
    }
    return out;
  }

  /** How many products the tab has in total (hidden products are not counted). */
  function count(category) {
    if (!category || category === "All") return total;
    const t = tabs.find((x) => x.name === category);
    return t ? t.count : 0;
  }

  function getProduct(id) {
    return pool.byId.get(id) || extra.get(id) || null;
  }

  // ---- first load -----------------------------------------------------------

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The admin's default tab for this catalog: only a tab that exists counts (else "" = "All"). */
  const normalizeCategory = (c) => (c && tabs.some((t) => t.name === c) ? c : "");

  /** Loads the first screen from the server: ONE request. Retries quietly: the backend on a free host can take a
   * minute to wake up. */
  async function bootFromServer() {
    let delay = 2000;
    let timer = setTimeout(() => {
      timer = null;
      window.Storefront?.showLoadError(
        "Having trouble loading the menu — please check your connection or try refreshing."
      );
    }, 45000);
    for (;;) {
      try {
        const r = await Api.get(`/api/products/start?limit=${PAGE}`);
        pool = makePool();
        addTo(pool, r.items || []);
        tabs = r.categories || [];
        total = r.total || 0;
        version = r.version;
        started = true;
        snapCategory = r.category || "";
        snapCategoryAt = Date.now();
        if (timer) clearTimeout(timer);
        saveSoon();
        return { category: snapCategory };
      } catch {
        await wait(delay);
        delay = Math.min(delay * 1.5, 15000);
      }
    }
  }

  // A visit that has the saved list: show it right away, and let the live stream (which is opened anyway) confirm it.
  // The stream is told which version the page holds. If that is still the current one it says so in a few bytes and
  // nothing is downloaded. If not, it sends exactly what changed, which is applied to the saved list (the same code
  // that applies live edits) BEFORE the menu is drawn. If the server does not answer in a moment (it may be waking up),
  // the saved list is shown and brought up to date as soon as the server answers.
  let heardAt = 0; // when the live stream first answered (0 = not yet)
  async function bootFromSnapshot(snap) {
    pool = makePool();
    addTo(pool, snap.items);
    pool.complete = !!snap.complete;
    tabs = snap.tabs;
    total = snap.total || snap.items.length;
    version = snap.version;
    snapCategory = snap.category || "";
    snapCategoryAt = snap.categoryAt || 0;
    started = true;
    savedKey = `${version}|${pool.byId.size}|${pool.complete}|${snapCategory}`; // (it is what is saved already)
    if (document.hidden) return { category: normalizeCategory(snapCategory) }; // a background tab: nothing to wait for
    booting = true;
    try {
      connect();
      // (the admin's default tab is not part of the catalog version: ask for it now and then — one tiny request)
      const freshCategory =
        Date.now() - snapCategoryAt > CAT_TTL
          ? Api.get("/api/store/default-category").then((r) => (r && typeof r.category === "string" ? r.category : null), () => null)
          : Promise.resolve(null);
      await Promise.race([Promise.all([heard, freshCategory]), wait(HEAR_MS)]);
      if (heardAt) {
        const settle = (async () => {
          while (refreshing || refreshTimer || inbox.length) await wait(40);
        })();
        await Promise.race([settle, wait(SETTLE_MS)]);
      }
      const c = await Promise.race([freshCategory, Promise.resolve(null)]);
      if (c !== null) {
        snapCategory = c;
        snapCategoryAt = Date.now();
      }
    } finally {
      booting = false;
    }
    saveSoon();
    return { category: normalizeCategory(snapCategory) };
  }

  let heardResolve = null;
  const heard = new Promise((resolve) => {
    heardResolve = resolve;
  });

  const ready = (async () => {
    const snap = await readSnapshot();
    if (snap) return bootFromSnapshot(snap);
    return bootFromServer();
  })();

  // ---- more products --------------------------------------------------------

  /** Downloads the next page of a tab: the products after the last one held without a gap. Returns how many
   * new products arrived (0 = nothing new, e.g. the catalog changed meanwhile and a refresh is on its way). */
  async function loadMore(category, limit = PAGE) {
    // A small shop: one request brings everything (and every later scroll, tab and search needs nothing), instead of
    // a request per 12 products.
    if (!pool.complete && total > 0 && total <= ALL_LIMIT && !saveData()) {
      const first = pool;
      const had = run(category).length;
      await loadAll();
      if (first !== pool) return 0; // (a newer catalog replaced it; the page was told to draw again)
      return Math.max(0, run(category).length - had);
    }
    const st = pool;
    const list = run(category);
    const after = list.length ? list[list.length - 1].rank : -1;
    const key = !category || category === "All" ? "" : category;
    const r = await Api.get(`/api/products/page?category=${encodeURIComponent(key)}&after=${after}&limit=${limit}${vParam(version)}`);
    if (st !== pool) return 0; // a refresh replaced everything while this was on its way
    if (r.version !== version) {
      stale = true;
      scheduleRefresh(0); // the catalog changed: these ranks no longer match what is held
      return 0;
    }
    addTo(pool, r.items || []);
    saveSoon();
    return (r.items || []).length;
  }

  // ---- a whole tab (search) --------------------------------------------------
  // Search looks inside the tab the customer is on, so it only needs THAT tab complete: a 2-product tab that is
  // already held costs nothing; a bigger one downloads just its missing products (up to 100 per request).
  // The "All" tab needs everything, which is one request for the full list.

  /** Is every product of this tab already held? */
  function tabComplete(category) {
    return pool.complete || run(category).length >= count(category);
  }

  const tabLoads = new Map();
  function loadTab(category) {
    const cat = !category || category === "All" ? "All" : category;
    if (tabComplete(cat)) return Promise.resolve();
    if (cat === "All") return loadAll();
    let p = tabLoads.get(cat);
    if (!p) {
      p = (async () => {
        for (let i = 0; i < 50 && !tabComplete(cat); i++) {
          if (!(await loadMore(cat, MAX_PER_REQUEST))) break;
        }
      })().finally(() => tabLoads.delete(cat));
      tabLoads.set(cat, p);
    }
    return p;
  }

  // ---- the full list ("All" tab search) ----------------------------------------

  let allPromise = null;

  /** Downloads every product, once. Used when the search box is used on the "All" tab. */
  function loadAll() {
    if (pool.complete) return Promise.resolve();
    if (!allPromise) {
      allPromise = (async () => {
        const r = await Api.get(`/api/products/all?${vParam(version).slice(1)}`);
        const items = r.items || [];
        let replaced = false;
        if (r.version === version) {
          addTo(pool, items); // same catalog as what is held: just fill in the rest
        } else {
          adoptCatalog(items, r.version); // a newer catalog: start from this complete copy
          replaced = true;
        }
        pool.complete = true;
        started = true;
        saveSoon();
        if (replaced && ui) ui.refreshed({ category: ui.current().category });
      })().finally(() => {
        allPromise = null;
      });
    }
    return allPromise;
  }

  /** Replaces everything with a complete copy of the catalog (tabs are worked out from it). */
  function adoptCatalog(items, newVersion) {
    const next = makePool();
    addTo(next, items);
    const counts = new Map();
    for (const p of items) {
      const c = catOf(p);
      if (c) counts.set(c, (counts.get(c) || 0) + 1);
    }
    pool = next;
    tabs = [...counts].map(([name, n]) => ({ name, count: n }));
    total = items.length;
    version = newVersion;
  }

  // ---- cart / reorder: products by id ----------------------------------------

  /** Makes sure these products are known (the ones still on sale). Products that are hidden or deleted stay unknown. */
  async function ensure(ids) {
    const missing = [...new Set(ids)].filter((id) => !getProduct(id) && !gone.has(id));
    if (pool.complete && missing.length) {
      // every product on sale is held, so one that isn't here is not on sale (hidden / deleted): nothing to ask the server
      missing.forEach((id) => gone.add(id));
      return;
    }
    for (let i = 0; i < missing.length; i += MAX_PER_REQUEST) {
      const items = await Api.get(`/api/products/by-ids?ids=${missing.slice(i, i + MAX_PER_REQUEST).join(",")}`);
      (items || []).forEach((p) => extra.set(p.id, p));
    }
  }

  /** Takes products that arrived together with another answer (the "Buy it again" row's), exactly as if they had been fetched
   * by id: the ones this page does not hold yet. Saves the extra request for them. */
  function adoptExtra(items) {
    (items || []).forEach((p) => {
      if (p && p.id && !getProduct(p.id)) extra.set(p.id, p);
    });
  }

  /** Brings the cart in line with the live catalog (a price changed, a product was hidden...). Costs one small
   * request only when the cart holds a product that isn't already on the page. */
  async function syncCart() {
    const lines = Cart.getItems();
    if (!lines.length) return;
    const ids = [...new Set(lines.map((i) => i.productId))];
    try {
      await ensure(ids);
    } catch {
      return; // offline: try again on the next change
    }
    const live = ids.map(getProduct).filter(Boolean);
    Cart.syncWithCatalog(live);
  }

  // ---- staying up to date ----------------------------------------------------

  let refreshTimer = null;
  let refreshing = false;
  let again = false;
  const inbox = []; // what the live stream said changed, oldest first (a small change carries the products themselves)
  let stale = false; // a download was thrown away because the catalog changed meanwhile: the page must look again

  /** Asks (soon) whether the catalog changed. Several changes close together become one check. */
  let refreshDue = Infinity; // when the pending check will run
  function scheduleRefresh(delay) {
    if (!started) return;
    const due = Date.now() + delay;
    if (refreshTimer && refreshDue <= due) return; // an earlier check is already waiting
    clearTimeout(refreshTimer);
    refreshDue = due;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshDue = Infinity;
      refreshNow();
    }, delay);
  }

  async function refreshNow() {
    if (!started) return;
    if (refreshing) {
      again = true;
      return;
    }
    refreshing = true;
    try {
      do {
        again = false;
        let d = inbox.shift();
        if (d && d.version === version) {
          again = inbox.length > 0; // already up to date with this one
          continue;
        }
        // Not exactly the next change after what is held (the tab was hidden, a message was missed, or the stream only
        // said which version it is): ask what changed since the held version. The answer is a few products, or
        // "re-read what is on screen".
        if (!d || d.prev !== version) d = await Api.get(`/api/products/delta?since=${encodeURIComponent(version)}&compact=1`);
        if (d.version === version) {
          if (stale) {
            stale = false;
            if (ui) ui.refreshed({ category: ui.current().category });
          }
          again = inbox.length > 0;
          continue;
        }
        if (!d.structural) await applyDelta(d);
        else if (d.order) await applyOrder(d);
        else if (d.drop) await applyEdit(d);
        else await reload(d); // (the history was too old to say what changed: re-read what is on screen)
        if (inbox.length) again = true;
      } while (again);
    } catch {
      // offline or the server is waking up: the next change signal, reconnect or tab switch tries again
    } finally {
      refreshing = false;
      saveSoon(); // (a no-op when nothing changed)
    }
  }

  /** Only some products changed (price, name, photo, stock...): fetch just those, and only the ones this page holds.
   * Everything else on the page is still exactly right. When the page holds none of them, nothing is downloaded. */
  /** Is this page holding the product (ranked pool, or the cart/reorder extras)? */
  const holds = (id) => pool.byId.has(id) || extra.has(id);

  async function applyDelta(d) {
    const given = new Map((d.items || []).map((p) => [p.id, p])); // the products that came with the message
    const patched = applyPatches(d.patches); // details-only edits: just the changed fields, merged into what is held
    const held = (d.ids || []).filter(holds);
    const missing = held.filter((id) => !given.has(id)); // (a big change only lists ids) fetch those
    for (let i = 0; i < missing.length; i += MAX_PER_REQUEST) {
      const items = await Api.get(`/api/products/by-ids?ids=${missing.slice(i, i + MAX_PER_REQUEST).join(",")}`);
      (items || []).forEach((p) => given.set(p.id, p));
    }
    for (const id of held) {
      const p = given.get(id);
      if (!p) continue;
      if (pool.byId.has(id)) addTo(pool, [p]); // same place in the shop order, new details
      if (extra.has(id)) extra.set(id, p);
    }
    version = d.version;
    if (held.length || patched || stale) {
      stale = false;
      if (ui) ui.refreshed({ category: ui.current().category });
    }
    if (held.length || patched) await syncCart();
  }

  /** Merges small "just these fields" changes ({ id, price... }) into the products this page holds. A product the page
   * does not hold is ignored (nothing to update, nothing to download). Returns how many held products changed. */
  function applyPatches(patches) {
    let n = 0;
    for (const { id, ...fields } of patches || []) {
      let hit = false;
      const p = pool.byId.get(id);
      if (p) {
        addTo(pool, [{ ...p, ...fields }]); // same place in the shop order, new details
        hit = true;
      }
      if (extra.has(id)) {
        extra.set(id, { ...extra.get(id), ...fields });
        hit = true;
      }
      if (hit) n++;
    }
    return n;
  }

  /** Products were added / hidden / moved: the message carries the new order of the whole shop (and the products that
   * are new or changed), so every place, every tab count and every product is worked out right here — no request.
   * Products this page holds keep their data; only their places change. A page that held the first 12 of a tab may
   * now hold one or two fewer in a row (e.g. one was hidden); the ordinary "load more" fills that in when the
   * customer scrolls there. */
  async function applyOrder(d) {
    const order = d.order;
    const present = new Set(order);
    const given = new Map((d.items || []).map((p) => [p.id, p])); // new / changed products that came with the message
    const patches = new Map((d.patches || []).map((x) => [x.id, x])); // details-only edits (just the changed fields)
    // (a big change only lists ids) the changed products this page holds are fetched
    const missing = (d.ids || []).filter((id) => holds(id) && !given.has(id) && present.has(id));
    for (let i = 0; i < missing.length; i += MAX_PER_REQUEST) {
      const items = await Api.get(`/api/products/by-ids?ids=${missing.slice(i, i + MAX_PER_REQUEST).join(",")}`);
      (items || []).forEach((p) => given.set(p.id, p));
    }
    const next = makePool();
    const perCategory = new Map(); // category -> products so far
    order.forEach((id, i) => {
      const name = d.names[d.cats[i]] || "";
      const n = perCategory.get(name) || 0;
      perCategory.set(name, n + 1);
      const base = given.get(id) || pool.byId.get(id);
      if (base) addTo(next, [{ ...base, ...(given.has(id) ? null : patches.get(id)), rank: i, catRank: n }]);
    });
    for (const id of [...extra.keys()]) {
      if (!present.has(id)) {
        extra.delete(id);
        gone.add(id); // the cart / reorder product was hidden or deleted
      } else if (given.has(id)) {
        extra.set(id, given.get(id));
      } else if (patches.has(id)) {
        extra.set(id, { ...extra.get(id), ...patches.get(id) });
      }
    }
    for (const id of present) gone.delete(id);
    for (const id of pool.byId.keys()) if (!present.has(id)) gone.add(id);
    next.complete = next.byId.size === order.length;
    pool = next;
    tabs = d.names.filter((n) => n).map((n) => ({ name: n, count: perCategory.get(n) }));
    total = order.length;
    version = d.version;
    stale = false;
    const view = ui ? ui.current() : { category: "All" };
    const category = view.category === "All" || tabs.some((x) => x.name === view.category) ? view.category : "All";
    if (ui) ui.refreshed({ category });
    await syncCart();
  }

  /** A few products were hidden / deleted / newly shown and nothing else moved. The message says where each
   * hidden one WAS ([id, rank, catRank, category]) and brings the new ones (with their places), so this page shifts
   * the places of what it holds itself: no request, and not the whole shop order in the message. */
  async function applyEdit(d) {
    const drops = d.drop;
    const given = new Map((d.items || []).map((p) => [p.id, p]));
    const dropped = new Set(drops.map((x) => x[0]));
    const inserts = [...given.values()].filter((p) => !pool.byId.has(p.id) && !dropped.has(p.id)).sort((a, b) => a.rank - b.rank);
    // The tabs must be able to follow: a category this page does not know is fine only when the message brought the
    // tabs' new order (d.names); otherwise work from the long form.
    const tabNames = new Set(tabs.map((t) => t.name));
    if (
      (!d.names && inserts.some((p) => catOf(p) && !tabNames.has(catOf(p)))) ||
      drops.some((x) => x[3] && !tabNames.has(x[3]))
    ) {
      const long = await Api.get(`/api/products/delta?since=${encodeURIComponent(version)}`); // (no "compact": the long form)
      if (long.order) return applyOrder(long);
      return long.structural ? reload(long) : applyDelta(long);
    }
    // (a changed product that came without its details, in a big edit, is fetched — only if this page holds it)
    const missing = (d.ids || []).filter((id) => holds(id) && !given.has(id) && !dropped.has(id));
    for (let i = 0; i < missing.length; i += MAX_PER_REQUEST) {
      const items = await Api.get(`/api/products/by-ids?ids=${missing.slice(i, i + MAX_PER_REQUEST).join(",")}`);
      (items || []).forEach((p) => given.set(p.id, p));
    }
    const patches = new Map((d.patches || []).map((x) => [x.id, x]));
    const before = ui ? ui.current() : { category: "All" };
    const wasComplete = run(before.category).length >= count(before.category);
    const lessThan = (list, x) => list.reduce((n, v) => n + (v < x ? 1 : 0), 0);
    const ranks = drops.map((x) => x[1]);
    const catRanks = new Map(); // category -> where the hidden ones were inside it
    for (const x of drops) catRanks.set(x[3], [...(catRanks.get(x[3]) || []), x[2]]);

    let touched = inserts.length > 0 || drops.some((x) => holds(x[0]));
    const kept = [];
    for (const p of pool.byId.values()) {
      if (dropped.has(p.id)) continue;
      const rank = p.rank - lessThan(ranks, p.rank);
      const catRank = p.catRank - lessThan(catRanks.get(catOf(p)) || [], p.catRank);
      if (rank !== p.rank) touched = true;
      kept.push({ ...(given.has(p.id) ? given.get(p.id) : { ...p, ...patches.get(p.id) }), rank, catRank });
      if (patches.has(p.id) || given.has(p.id)) touched = true;
    }
    for (const ins of inserts) { // (in order of place, so each one lands where the message says)
      for (const q of kept) {
        if (q.rank >= ins.rank) q.rank++;
        if (catOf(q) === catOf(ins) && q.catRank >= ins.catRank) q.catRank++;
      }
      kept.push(ins);
    }
    const next = makePool();
    addTo(next, kept);
    next.complete = pool.complete;
    pool = next;

    for (const id of [...extra.keys()]) {
      if (dropped.has(id)) {
        extra.delete(id);
        gone.add(id); // the cart / reorder product was hidden or deleted
        touched = true;
      } else if (given.has(id)) {
        extra.set(id, given.get(id));
        touched = true;
      } else if (patches.has(id)) {
        extra.set(id, { ...extra.get(id), ...patches.get(id) });
        touched = true;
      }
    }
    for (const p of inserts) {
      gone.delete(p.id); // (shown again)
      if (extra.has(p.id)) extra.set(p.id, p);
    }
    for (const id of dropped) gone.add(id);

    const counts = new Map(tabs.map((t) => [t.name, t.count]));
    for (const x of drops) if (x[3]) counts.set(x[3], counts.get(x[3]) - 1);
    for (const p of inserts) if (catOf(p)) counts.set(catOf(p), (counts.get(catOf(p)) || 0) + 1);
    // the tabs' order: as held, unless the message says the categories now come in another order
    const order = d.names ? d.names.filter((n) => n) : tabs.map((t) => t.name);
    const nextTabs = order.filter((n) => counts.get(n) > 0).map((n) => ({ name: n, count: counts.get(n) }));
    const tabsChanged = nextTabs.map((t) => t.name).join("\u0001") !== tabs.map((t) => t.name).join("\u0001");
    tabs = nextTabs;
    total = total - drops.length + inserts.length;
    version = d.version;
    stale = false;
    const view = ui ? ui.current() : { category: "All" };
    const category = view.category === "All" || tabs.some((x) => x.name === view.category) ? view.category : "All";
    const isComplete = run(category).length >= count(category);
    // Only redraw when something the page shows could have changed (a held product moved / went / came, a tab came
    // or went, or the tab just became complete / incomplete): hiding a product far down the shop touches nothing.
    if (ui && (touched || tabsChanged || category !== view.category || wasComplete !== isComplete)) ui.refreshed({ category });
    if (touched) await syncCart();
  }

  /** The catalog changed: read again only what the customer is looking at, then drop everything else held. */
  async function reload(t) {
    const view = ui ? ui.current() : { category: "All", shown: PAGE, full: false };
    if (pool.complete || (view.full && view.category === "All")) {
      // the search box downloaded everything earlier: get the complete current list
      const r = await Api.get(`/api/products/all?${vParam(t.version).slice(1)}`);
      adoptCatalog(r.items || [], r.version);
      pool.complete = true;
      stale = false;
      extra.clear(); // cart/reorder products are looked up again against the new catalog
      gone.clear();
      if (ui) ui.refreshed({ category: tabs.some((x) => x.name === view.category) ? view.category : "All" });
      await syncCart();
      return;
    }
    const category = view.category !== "All" && !t.categories.some((x) => x.name === view.category) ? "All" : view.category;
    const key = category === "All" ? "" : category;
    // while the customer is searching, the whole tab is kept (search looks through all of it)
    const tabCount = category === "All" ? t.total : (t.categories.find((x) => x.name === category) || {}).count || 0;
    const want = Math.max(PAGE, view.full ? tabCount : view.shown || PAGE);
    const next = makePool();
    let after = -1;
    for (;;) {
      const need = Math.min(MAX_PER_REQUEST, want - (after === -1 ? 0 : countIn(next, category)));
      if (need <= 0) break;
      const r = await Api.get(`/api/products/page?category=${encodeURIComponent(key)}&after=${after}&limit=${need}${vParam(t.version)}`);
      if (r.version !== t.version) {
        again = true; // it changed again while reading: start over
        return;
      }
      addTo(next, r.items || []);
      if (!r.items || !r.items.length || !r.hasMore) break;
      after = r.items[r.items.length - 1].rank;
    }
    pool = next;
    tabs = t.categories || [];
    total = t.total || 0;
    version = t.version;
    stale = false;
    extra.clear();
    gone.clear();
    if (ui) ui.refreshed({ category });
    await syncCart();
  }

  function countIn(p, category) {
    if (category === "All") return p.byRank.size;
    const m = p.byCat.get(category);
    return m ? m.size : 0;
  }

  // The live stream tells every open page the catalog's version when it connects, and exactly what changed after
  // every edit. A page that already has that version does nothing at all; a small change (a price...) arrives WITH
  // the changed products, so nothing is requested; a bigger one (hidden / added / moved) re-reads what is on screen.
  // A page that comes back after being hidden (or reconnects) tells the stream which version it holds, and the stream
  // sends what changed since then — so even catching up needs no separate request.
  let eventSource = null;
  let reconnectTimer = null;
  let reconnectDelay = 2000;

  const versionNum = (v) => parseInt(v, 36);

  function connect() {
    if (eventSource) return;
    clearTimeout(reconnectTimer);
    const es = (eventSource = new EventSource(
      Api.streamUrl(`/api/products/changes?since=${encodeURIComponent(version || "")}&compact=1`)
    ));
    const announced = (e) => {
      reconnectDelay = 2000;
      if (!heardAt) {
        heardAt = Date.now();
        heardResolve();
      }
      let d = null;
      try {
        d = JSON.parse(e.data);
      } catch {
        // not understood: just check what changed since the held version
      }
      if (d && d.version) {
        const tail = inbox.length ? inbox[inbox.length - 1].version : version;
        if (d.version === tail || versionNum(d.version) < versionNum(tail)) return; // already known / an old message
        inbox.push(d);
        // A small change that carries its products (everything this page holds is included) is applied at once, with
        // no request. Anything that needs a download waits a moment, spread out so many customers online at once
        // don't all ask in the same instant.
        const instant =
          (!d.structural || !!d.order || !!d.drop) &&
          d.prev === tail &&
          (d.ids || []).every((id) => !holds(id) || (d.items || []).some((p) => p.id === id));
        scheduleRefresh(instant || booting ? 0 : 300 + Math.random() * 1500);
      } else {
        scheduleRefresh(booting ? 0 : 300 + Math.random() * 1500); // check what changed since the held version
      }
    };
    es.addEventListener("state", announced);
    es.addEventListener("changed", announced);
    es.addEventListener("error", () => {
      // The connection dropped. Reconnect ourselves (not the browser's automatic retry) so the new connection asks
      // from the version held NOW.
      if (eventSource !== es) return;
      es.close();
      eventSource = null;
      if (document.hidden) return;
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 20000);
    });
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    clearTimeout(reconnectTimer);
    clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshDue = Infinity;
    inbox.length = 0; // coming back, the stream is asked for everything since the version held
  }

  // Only stay connected while this tab is visible: a hidden or minimised tab holds no connection.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      disconnect();
      saveNow(); // (the page may be closed from here: keep what it holds)
    } else connect();
  });
  window.addEventListener("pagehide", saveNow);

  /** Runs when the browser has nothing else to do (or soon). */
  const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));

  ready.then(() => {
    if (!document.hidden) connect();
    syncCart(); // a cart saved on the last visit may hold products that changed since
    // A small shop: fetch the whole list once, quietly, while the customer looks at the first screen. From then on
    // scrolling, tabs and search need no request — and the next visit needs none at all (it is saved on the phone).
    if (!pool.complete && total > 0 && total <= ALL_LIMIT && !saveData()) {
      whenIdle(() => {
        if (!document.hidden) loadAll().catch(() => {});
      });
    }
  });

  window.CatalogStore = {
    PAGE,
    ready, // resolves with { category } once the first screen's data is here
    run,
    count,
    tabs: () => tabs,
    tabComplete,
    loadTab,
    getProduct,
    pooled: () => [...pool.byId.values()],
    loadMore,
    loadAll,
    ensure,
    adopt: adoptExtra,
    syncCart,
    bindUi: (hooks) => {
      ui = hooks;
    },
  };
})();
