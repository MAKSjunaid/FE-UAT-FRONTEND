/* The location map of the customer website: the customer finds or searches their spot, drags the pin to the doorstep and the
 * street / area under the pin is offered as their address. (The delivery areas the owner draws are NOT shown here - they are
 * for the owner, who sees on every order whether it is inside them.)
 *
 * Everything here is OURS: the map engine (vendor/map/), the fonts, and the map itself, which comes out of the shop's own
 * database through the shop's own server (an offline PMTiles file the admin uploaded). Nothing calls another company.
 *
 * Switched off in the admin's Map tab? Then this file does nothing at all: the header button stays hidden, the map code is
 * never downloaded and no map request is ever made. The switch arrives with the site settings the page already has
 * (config.mapEnabled), so even finding out costs no extra request.
 *
 * Two ways in (the same screen, with a "Confirm this location" button):
 *   - the "Delivery area" button at the top right: the pin is kept on this phone and used at checkout;
 *   - "Pick location on map" in the address form: the pin goes straight into that form.
 * The pin stays in the middle of the screen and the map moves under it, so it works with one thumb. */

window.DeliveryMap = (() => {
  "use strict";

  const VENDOR = "vendor/map/";
  const VENDOR_V = "2";
  const HYDERABAD = [78.4867, 17.385]; // [lng, lat]
  const DEFAULT_START = [78.39312, 17.40062]; // where the map opens for a customer who has no pin yet: [lng, lat]
  const NEAR_AREA_METERS = 3000;

  let enabled = false;
  let vendorPromise = null;
  let proto = null;
  let current = null; // the open screen: { el, close }

  const $ = (id) => document.getElementById(id);
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]); // (Utils is a const, not a window property)
  const abs = (url) => new URL(url, document.baseURI).href;
  const apiBase = () => window.FRESHCUTZ_API_BASE || "";
  const isPreview = () => window.parent !== window && /[?&]preview=1(&|$)/.test(location.search);

  // ---- on / off -----------------------------------------------------------

  /** Shows or hides the header button (and every map entry point) to match the admin's switch. */
  function sync(on) {
    const was = enabled;
    enabled = !!on && !isPreview();
    if (was && !enabled) forgetConfig(); // switched off while this page was open: the map file may be different when it is switched on again (page loads do not count)
    const btn = $("areaBtn");
    if (btn) btn.hidden = !enabled;
    document.documentElement.classList.toggle("dm-on", enabled);
    if (!enabled && current) current.close(null);
    document.dispatchEvent(new CustomEvent("freshcutz:map", { detail: { enabled } }));
  }

  const isEnabled = () => enabled;

  // ---- reuse: the settings, the map's byte ranges and the search list are fetched once and kept ------------------

  const CFG_KEY = "freshcutz_map_cfg";
  const CFG_TTL = 10 * 60 * 1000;      // the settings (map file address, search file address) are reused for 10 minutes
  const CFG_TTL_NOFILE = 2 * 60 * 1000; // ... or 2 minutes while no map file is uploaded yet (so a new upload shows up soon)
  let cfgMem = null; // { at, cfg }
  let cfgReq = null;

  function fresh(c) { return c && c.cfg && Date.now() - c.at < (c.cfg.tiles && c.cfg.tiles.url ? CFG_TTL : CFG_TTL_NOFILE); }

  /** The map settings (/api/store/map/config): one request for every screen, address form and reload within a few minutes. */
  function getConfig() {
    if (fresh(cfgMem)) return Promise.resolve(cfgMem.cfg);
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (fresh(c)) { cfgMem = c; return Promise.resolve(c.cfg); }
      }
    } catch (_) { /* no storage: just ask */ }
    if (cfgReq) return cfgReq; // somebody is asking right now: share that answer
    cfgReq = Api.get("/api/store/map/config")
      .then((cfg) => {
        if (cfg && cfg.enabled !== false) {
          cfgMem = { at: Date.now(), cfg };
          try { localStorage.setItem(CFG_KEY, JSON.stringify(cfgMem)); } catch (_) { /* fine */ }
        } else {
          forgetConfig();
        }
        return cfg;
      })
      .finally(() => { cfgReq = null; });
    return cfgReq;
  }

  function forgetConfig() {
    cfgMem = null;
    try { localStorage.removeItem(CFG_KEY); } catch (_) { /* fine */ }
  }

  /** Where the map file's bytes come from. pmtiles reads the file in small pieces (a header, directories, tiles). Every piece is
   * kept: in memory (so a second map on the same page asks for nothing), and in the browser's Cache API (so the next visit asks
   * for nothing either - the file's address carries its version, so a kept piece never goes stale). The same piece asked for twice
   * at once is fetched once. (The stock source skips the browser cache on Windows Chrome, which is why it was asking every time.) */
  const RANGE_CACHE = "fc-map-ranges-v1";
  const RANGE_MAX_ENTRIES = 400;
  const MEM_MAX_BYTES = 24 * 1024 * 1024;

  class CachedSource {
    constructor(url) {
      this.url = url;
      this.mem = new Map();      // key -> ArrayBuffer (oldest first)
      this.memBytes = 0;
      this.flying = new Map();   // key -> promise of the piece being fetched
      this.puts = 0;
      this.cachePromise = null;
    }
    getKey() { return this.url; }
    store() {
      if (!this.cachePromise) {
        // (the admin panel keeps nothing on the phone for the map: its "Open on map" view is rare, and the panel's own sign-in
        // is what the phone must hold on to)
        const keep = typeof caches !== "undefined" && caches.open && !document.getElementById("adminApp");
        this.cachePromise = (keep ? caches.open(RANGE_CACHE) : Promise.resolve(null)).catch(() => null);
      }
      return this.cachePromise;
    }
    reqFor(key) { return new Request(this.url + (this.url.indexOf("?") < 0 ? "?" : "&") + "fcr=" + key); }
    remember(key, buf) {
      if (buf.byteLength > MEM_MAX_BYTES / 4) return;
      this.mem.set(key, buf);
      this.memBytes += buf.byteLength;
      while (this.memBytes > MEM_MAX_BYTES && this.mem.size > 1) {
        const first = this.mem.keys().next().value;
        this.memBytes -= this.mem.get(first).byteLength;
        this.mem.delete(first);
      }
    }
    async load(offset, length, key) {
      const store = await this.store();
      if (store) {
        try {
          const hit = await store.match(this.reqFor(key));
          if (hit) return await hit.arrayBuffer();
        } catch (_) { /* the network answers instead */ }
      }
      const res = await fetch(this.url, { headers: { range: `bytes=${offset}-${offset + length - 1}` } });
      if (res.status >= 300) {
        if (res.status === 404) { forgetConfig(); pieces.delete(this.url); } // the file was replaced: start from fresh settings
        throw new Error(`Bad response code: ${res.status}`);
      }
      const clen = res.headers.get("Content-Length");
      if (res.status === 200 && (!clen || +clen > length)) throw new Error("The map server does not support partial downloads");
      const buf = await res.arrayBuffer();
      if (store) {
        try {
          await store.put(this.reqFor(key), new Response(buf.slice(0), { headers: { "content-type": "application/octet-stream" } }));
          if (++this.puts % 150 === 1) this.prune(store);
        } catch (_) { /* full or blocked: the piece is still used from memory */ }
      }
      return buf;
    }
    /** Keeps the stored pieces to a sensible size, and drops those of older versions of the map file. */
    async prune(store) {
      try {
        const keys = await store.keys();
        const mine = this.url + (this.url.indexOf("?") < 0 ? "?" : "&") + "fcr=";
        const stale = keys.filter((k) => k.url.indexOf("/tiles/") >= 0 && k.url.indexOf(mine) !== 0);
        const own = keys.filter((k) => k.url.indexOf(mine) === 0);
        const over = own.slice(0, Math.max(0, own.length - RANGE_MAX_ENTRIES));
        await Promise.all(stale.concat(over).map((k) => store.delete(k)));
      } catch (_) { /* tidy-up only */ }
    }
    getBytes(offset, length, signal) {
      const key = `${offset}-${length}`;
      let p;
      const held = this.mem.get(key);
      if (held) {
        this.mem.delete(key); this.mem.set(key, held); // most recently used goes last
        p = Promise.resolve(held);
      } else {
        p = this.flying.get(key);
        if (!p) {
          p = this.load(offset, length, key)
            .then((buf) => { this.remember(key, buf); return buf; })
            .finally(() => { this.flying.delete(key); });
          this.flying.set(key, p);
        }
      }
      const out = p.then((buf) => ({ data: buf.slice(0) })); // (the reader may take the bytes apart: it gets its own copy)
      if (!signal) return out;
      return new Promise((resolve, reject) => {
        const gone = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        if (signal.aborted) return gone();
        signal.addEventListener("abort", gone, { once: true }); // (the piece still finishes and is kept for the next ask)
        out.then(resolve, reject);
      });
    }
  }

  const pieces = new Map(); // map file address -> its one PMTiles reader (headers and directories stay in memory)

  function tilesReader(url) {
    let pm = pieces.get(url);
    if (!pm) {
      pm = new pmtiles.PMTiles(new CachedSource(url));
      pieces.set(url, pm);
    }
    proto.add(pm);
    return pm;
  }

  const indexes = new Map(); // search file address -> promise of its parsed list (the same file is read and parsed once)

  // ---- loading the map engine (only when somebody opens the map) -------------

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the map. Please check your connection and try again."));
      document.head.appendChild(s);
    });
  }

  function loadCss(href) {
    return new Promise((resolve) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = resolve;
      l.onerror = resolve; // the map still works, just unstyled controls
      document.head.appendChild(l);
    });
  }

  function loadVendor() {
    if (!vendorPromise) {
      const q = `?v=${VENDOR_V}`;
      vendorPromise = Promise.all([
        loadCss(`${VENDOR}maplibre-gl.css${q}`),
        loadScript(`${VENDOR}maplibre-gl.js${q}`),
        loadScript(`${VENDOR}pmtiles.js${q}`),
        loadScript(`${VENDOR}basemaps.js${q}`),
        loadScript(`${VENDOR}glyphs.js${q}`).catch(() => {}), // the label fonts; without them the map falls back to the glyphs/ folder
      ]).then(registerGlyphs).catch((err) => {
        vendorPromise = null; // let the next try start over
        throw err;
      });
    }
    return vendorPromise;
  }

  // ---- label fonts --------------------------------------------------------------

  let glyphsRegistered = false;

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  /** The map asks for its label fonts as "fcg://<font>/<range>.pbf". The ones an English map needs are packed in
   * vendor/map/glyphs.js (so they load the same way on every server, from a folder or from IntelliJ's preview server);
   * any other range is read from vendor/map/glyphs/ when that is reachable, and otherwise simply left out. */
  function registerGlyphs() {
    if (glyphsRegistered || !window.maplibregl) return;
    glyphsRegistered = true;
    maplibregl.addProtocol("fcg", async (params) => {
      const m = /^fcg:\/\/(.+)\/(\d+-\d+)\.pbf/.exec(params.url);
      if (!m) return { data: new ArrayBuffer(0) };
      const font = decodeURIComponent(m[1]).split(",")[0].trim();
      const packed = window.FC_GLYPHS && window.FC_GLYPHS[`${font}/${m[2]}`];
      if (packed) return { data: b64ToBuffer(packed) };
      try {
        const res = await fetch(abs(`${VENDOR}glyphs/${encodeURIComponent(font)}/${m[2]}.pbf`));
        if (res.ok) return { data: await res.arrayBuffer() };
      } catch (_) { /* not reachable: no glyphs for this range */ }
      return { data: new ArrayBuffer(0) };
    });
  }

  // ---- geometry ---------------------------------------------------------------

  /** Is the point inside this ring of [lng, lat] points? */
  function inRing(ring, lat, lng) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function zoneAt(zones, lat, lng) {
    for (const z of zones) if (inRing(z.ring, lat, lng)) return z;
    return null;
  }

  function metersBetween(lat1, lng1, lat2, lng2) {
    const k = 111320;
    const dx = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const dy = (lat2 - lat1) * k;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function zonesBounds(zones) {
    let b = null;
    zones.forEach((z) =>
      z.ring.forEach(([lng, lat]) => {
        if (!b) b = [lng, lat, lng, lat];
        else {
          b[0] = Math.min(b[0], lng); b[1] = Math.min(b[1], lat);
          b[2] = Math.max(b[2], lng); b[3] = Math.max(b[3], lat);
        }
      })
    );
    return b;
  }

  // ---- the map style ------------------------------------------------------------

  /** Roads, water, parks, buildings and place names from the shop's own tiles file; or, when none is uploaded yet, a plain
   * background (the delivery area is drawn on top either way). */
  function buildStyle(tiles) {
    const style = {
      version: 8,
      name: "freshcutz",
      glyphs: "fcg://{fontstack}/{range}.pbf",
      sources: {},
      layers: [],
    };
    if (!tiles) {
      style.layers.push({ id: "plain", type: "background", paint: { "background-color": "#f1ecde" } });
      return style;
    }
    if (!proto) {
      proto = new pmtiles.Protocol();
      maplibregl.addProtocol("pmtiles", proto.tile);
    }
    const url = abs(apiBase() + tiles.url);
    tilesReader(url);
    style.sources.base = {
      type: "vector",
      url: `pmtiles://${url}`,
      attribution: "© Kalam's Map",
    };
    const layers = basemaps.layers("base", basemaps.namedFlavor("light"), { lang: "en" });
    layers.forEach((l) => {
      if (l.id === "roads_oneway" || l.id === "roads_shields") return; // they need icon pictures we do not ship
      if (l.layout) {
        Object.keys(l.layout).filter((k) => k.indexOf("icon-") === 0).forEach((k) => delete l.layout[k]);
      }
      if (l.type === "symbol" && l.id !== "pois" && l.paint) {
        // street, area and water names: darker, with a thicker white outline (the stock greys fade into the ground colour)
        const DARKER = { "#91888b": "#4a4347", "#938a8d": "#3f393c", "#8f8f8f": "#444444", "#5c5c5c": "#2f2f2f", "#b3b3b3": "#666666", "#a3a3a3": "#555555", "#728dd4": "#3a5aa8" };
        const c = l.paint["text-color"];
        if (typeof c === "string" && DARKER[c.toLowerCase()]) l.paint["text-color"] = DARKER[c.toLowerCase()];
        if (l.id.indexOf("water") !== 0) { l.paint["text-halo-color"] = "#ffffff"; l.paint["text-halo-width"] = 1.6; }
      }
      if (l.id === "pois") {
        // shops, hospitals, schools, temples ...: no icon pictures are shipped, so each is a small dot with its name under it
        l.filter = ["all", ["has", "name"], [">=", ["zoom"], ["+", ["get", "min_zoom"], 0]]];
        const keep = ["text-field", "text-font", "text-justify", "text-max-width"];
        Object.keys(l.layout).filter((k) => keep.indexOf(k) < 0).forEach((k) => delete l.layout[k]);
        l.layout["text-anchor"] = "top";
        l.layout["text-offset"] = [0, 0.55];
        l.layout["text-size"] = 12;
        l.layout["text-optional"] = true;
        l.minzoom = 14.5;
        // the stock colours of the names are pale (a shop of an unlisted kind even had the map's own background colour, so it was
        // invisible): every kind gets a dark colour and a thick white outline so each name reads on any background
        l.paint["text-color"] = [
          "case",
          ["in", ["get", "kind"], ["literal", ["beach", "forest", "marina", "park", "peak", "zoo", "garden", "bench"]]], "#14653a",
          ["in", ["get", "kind"], ["literal", ["aerodrome", "station", "bus_stop", "ferry_terminal"]]], "#1f43a0",
          ["in", ["get", "kind"], ["literal", ["stadium", "university", "library", "school", "animal", "toilets", "drinking_water", "post_office", "building", "townhall"]]], "#4a3d70",
          ["in", ["get", "kind"], ["literal", ["supermarket", "convenience", "books", "beauty", "electronics", "clothes"]]], "#0f5f85",
          ["in", ["get", "kind"], ["literal", ["restaurant", "fast_food", "cafe", "bar"]]], "#9a4a00",
          ["in", ["get", "kind"], ["literal", ["attraction", "museum", "theatre", "artwork"]]], "#b0227f",
          "#3d3320",
        ];
        l.paint["text-halo-color"] = "#ffffff";
        l.paint["text-halo-width"] = 1.8;
        style.layers.push({
          id: "pois_dot", type: "circle", source: "base", "source-layer": "pois", minzoom: 14.5,
          filter: l.filter,
          paint: { "circle-radius": 3.2, "circle-color": "#9c7a26", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 },
        });
      }
      style.layers.push(l);
    });
    return style;
  }

  // ---- the screen -------------------------------------------------------------------

  const PIN_SVG =
    '<svg viewBox="0 0 40 52" width="40" height="52" aria-hidden="true"><path d="M20 1C9.5 1 1 9.4 1 19.8 1 33.5 20 51 20 51s19-17.5 19-31.2C39 9.4 30.5 1 20 1z" fill="#17140f" stroke="#c9a13b" stroke-width="2"/><circle cx="20" cy="19.5" r="7" fill="#c9a13b"/></svg>';

  /** The map screen. Full screen (the guest's "Delivery area" button) or {@code inline}: a small map that sits inside an address form,
   * with its search box above it and no back / confirm buttons (the form's own button saves). */
  /** A generic, zoomed-in street picture (no places, no requests) shown in an address form's map box until the customer taps it. */
  const PLACEHOLDER_SVG =
    '<svg class="dm-ph-img" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<rect width="400" height="300" fill="#efe9dc"/>' +
    '<g fill="#e4dcc9"><rect x="14" y="14" width="96" height="70"/><rect x="130" y="14" width="84" height="70"/><rect x="236" y="18" width="70" height="66"/><rect x="326" y="14" width="80" height="70"/>' +
    '<rect x="14" y="108" width="70" height="60"/><rect x="104" y="108" width="110" height="60"/><rect x="236" y="104" width="70" height="64"/><rect x="326" y="104" width="80" height="64"/>' +
    '<rect x="14" y="196" width="100" height="90"/><rect x="134" y="196" width="80" height="90"/><rect x="236" y="196" width="170" height="90"/></g>' +
    '<path d="M236 18h70v66h-70z M14 196h100v90H14z" fill="#d5e3c2"/>' +
    '<path d="M300 196c30-10 70 0 100 8v82H300z" fill="#cde0ea"/>' +
    '<g stroke="#e0d6b8" stroke-width="15" fill="none"><path d="M0 96H400M0 182H400M120 0V300M222 0V300M316 0V300"/></g>' +
    '<g stroke="#fff" stroke-width="11" fill="none"><path d="M0 96H400M0 182H400M120 0V300M222 0V300M316 0V300"/></g>' +
    '<path d="M-10 250L410 60" stroke="#e8c96a" stroke-width="19" fill="none"/><path d="M-10 250L410 60" stroke="#fbeab0" stroke-width="13" fill="none"/>' +
    '</svg>';

  const SNAP_KEY = "freshcutz_map_snap";

  function sheetHtml(inline, lazy, snap) {
    const back = inline ? "" : `<button type="button" class="dm-back" data-dm="close" aria-label="Close">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>`;
    const search = `<div class="dm-search" data-dm="search">
          <div class="dm-search-row">
            ${back}
            <div class="dm-search-field">
              <svg class="dm-search-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
              <input type="text" data-dm="q" placeholder="${inline ? "Search area or street" : "Search area, street or landmark"}" autocomplete="off" autocapitalize="words" enterkeyhint="search" aria-label="Search area, street or landmark" />
              <button type="button" class="dm-search-clear" data-dm="clear" aria-label="Clear" hidden>✕</button>
              <button type="button" class="dm-search-go" data-dm="go">Search</button>
            </div>
          </div>
          <div class="dm-results" data-dm="results" hidden></div>
        </div>`;
    const stage = `<div class="dm-map" data-dm="map"></div>
        ${inline ? '<button type="button" class="dm-sleep" data-dm="wake"><span class="dm-sleep-a">Tap to move the map</span><span class="dm-sleep-b">Drag to move · pinch to zoom</span></button>' : search}
        <div class="dm-pin" data-dm="pin">
          <div class="dm-tip"><b>Your order will be delivered here</b><span>Move the map to adjust the pin</span></div>
          ${PIN_SVG}<span class="dm-pin-shadow"></span>
        </div>
        ${lazy ? `<button type="button" class="dm-ph" data-dm="ph" aria-label="Tap to open the map">${snap ? `<img class="dm-ph-img dm-ph-snap" alt="" src="${snap}" />` : PLACEHOLDER_SVG}<span class="dm-ph-chip">Tap to open the map</span></button>` : ""}
        <div class="dm-finding" data-dm="finding" role="status" aria-live="polite" hidden><span class="dm-finding-t">Finding your location</span><span class="dm-finding-d" data-dm="dots" aria-hidden="true"></span></div>
        <div class="dm-loading" data-dm="loading"${lazy ? " hidden" : ""}><span class="spinner"></span><span>Loading map…</span></div>
        <button type="button" class="dm-fab" data-dm="locate2" aria-label="Use my current location" title="Use my current location">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v3.2M12 19.3v3.2M1.5 12h3.2M19.3 12h3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span>Use current location</span>
        </button>`;
    const status = `<div class="dm-status" data-dm="status" data-state="wait">
          <span class="dm-status-icon" data-dm="icon">…</span>
          <div class="dm-status-text">
            <div class="dm-status-title" data-dm="title">Loading the map…</div>
            <div class="dm-status-sub" data-dm="sub"></div>
          </div>
        </div>`;
    if (inline) return `${search}<div class="dm-mapwrap${lazy ? " is-ph" : ""}">${stage}</div>${status}`;
    return `
      <div class="dm-mapwrap">${stage}</div>
      <div class="dm-card">
        <div class="dm-title">Your delivery location</div>
        ${status}
        <button type="button" class="btn btn-gold btn-block dm-confirm" data-dm="confirm" disabled>Confirm this location</button>
      </div>`;
  }

  /** Opens the map. Resolves with {lat, lng, area, inside} when a location is confirmed ("pick"), or null when it is closed. */
  function open(opts = {}) {
    return new Promise((resolve) => {
      if (!enabled) { resolve(null); return; }
      const inline = opts.inline instanceof Element;
      const lazy = inline && opts.lazy === true; // a picture first; the real map (and every request it needs) only after a tap
      if (!inline && current) current.close(null);

      let el;
      if (inline) {
        el = opts.inline;
        el.classList.add("dm-inline");
        // the picture: a snapshot of the real map taken the last time it was opened on this very spot, else a generic street picture
        let snap = "";
        if (lazy && opts.point) {
          try {
            const v = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
            if (v && v.url && Date.now() - v.t < 14 * 864e5 && metersBetween(v.lat, v.lng, opts.point.lat, opts.point.lng) < 20) snap = v.url;
          } catch (_) { /* no snapshot */ }
        }
        el.innerHTML = sheetHtml(true, lazy, snap);
      } else {
        el = document.createElement("div");
        el.className = "dm-sheet";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-label", "Your delivery location");
        el.innerHTML = sheetHtml(false);
        document.body.appendChild(el);
        document.documentElement.classList.add("dm-open");
        requestAnimationFrame(() => el.classList.add("dm-in"));
      }

      const q = (name) => el.querySelector(`[data-dm="${name}"]`);
      let findTimer = 0; // ("Finding your location" dots)
      const st = { map: null, hasTiles: false, lat: null, lng: null, zone: null, area: "", road: "", addr: "", dot: null, closed: false, searchUrl: "", index: null, indexState: "idle", touched: false, userFly: false, reread: false, started: false, then: [] };

      const onKey = (e) => { if (e.key === "Escape" && !inline) close(null); };
      document.addEventListener("keydown", onKey);

      function close(result) {
        if (st.closed) return;
        st.closed = true;
        if (findTimer) clearInterval(findTimer);
        document.removeEventListener("keydown", onKey);
        try { if (st.map) st.map.remove(); } catch (_) { /* already gone */ }
        if (!inline) {
          document.documentElement.classList.remove("dm-open");
          el.classList.remove("dm-in");
          setTimeout(() => el.remove(), 220);
          if (current && current.el === el) current = null;
        }
        resolve(result);
      }
      if (!inline) current = { el, close };
      /** An inline map whose form has been replaced by another screen lets go of itself. */
      const gone = () => { if (inline && !el.isConnected) { close(null); return true; } return false; };

      if (q("close")) q("close").addEventListener("click", () => close(null));
      if (opts.confirmText && q("confirm")) q("confirm").textContent = opts.confirmText;
      q("locate2").addEventListener("click", () => { if (!st.map) findingOn(); ensure(locate); }); // (shown at once, also while the map itself is still loading)

      function setStatus(state, title, sub) {
        const box = q("status");
        box.dataset.state = state;
        q("icon").textContent = { free: "📍", wait: "…", warn: "!" }[state] || "…";
        q("title").textContent = title;
        q("sub").textContent = sub || "";
        if (q("confirm")) q("confirm").disabled = state !== "free";
        if (opts.onStatus) opts.onStatus({ state, title, sub: sub || "", addr: st.addr || "", touched: st.touched });
      }

      /** An inline map reports the spot to its form once the customer has moved it (never for the map's starting position). */
      function emit() {
        if (!opts.onChange || !st.touched || st.lat == null) return;
        opts.onChange({ lat: round(st.lat), lng: round(st.lng), area: st.area, road: st.road, addr: st.addr || st.area });
      }

      function refreshStatus() {
        if (st.lat == null) return;
        if (st.addr) setStatus("free", st.addr, "Not exactly right? Move the map until the pin is on your doorstep.");
        else if (st.area) setStatus("free", `Near ${st.area}`, "Move the map until the pin is on your doorstep.");
        else setStatus("free", "Move the map to your doorstep", "Or search for your area, street or landmark above.");
      }

      /** Squared-metre distance from a point to a line (list of [lng, lat]), flat-earth maths - fine over a few hundred metres. */
      function metersToLine(lat, lng, coords) {
        const k = 111320;
        const cos = Math.cos(lat * (Math.PI / 180));
        let best = Infinity;
        for (let i = 0; i + 1 < coords.length; i++) {
          const ax = (coords[i][0] - lng) * k * cos, ay = (coords[i][1] - lat) * k;
          const bx = (coords[i + 1][0] - lng) * k * cos, by = (coords[i + 1][1] - lat) * k;
          const dx = bx - ax, dy = by - ay;
          const len = dx * dx + dy * dy;
          let t = len ? -(ax * dx + ay * dy) / len : 0;
          t = Math.max(0, Math.min(1, t));
          const px = ax + t * dx, py = ay + t * dy;
          best = Math.min(best, Math.sqrt(px * px + py * py));
        }
        return best;
      }

      /** What is under the pin, from the map tiles the screen already holds (so: offline, instant, free):
       * the nearest named street within ~90 m and the nearest named area (suburb / neighbourhood) within 3 km. */
      function findPlace() {
        const out = { area: "", road: "" };
        if (!st.map || !st.hasTiles || st.lat == null) return out;
        try {
          let bestD = NEAR_AREA_METERS;
          st.map.querySourceFeatures("base", { sourceLayer: "places" }).forEach((f) => {
            const p = f.properties || {};
            const name = p["name:en"] || p.name;
            if (!name || !f.geometry || f.geometry.type !== "Point") return;
            if (p.kind === "country" || p.kind === "region" || p.kind === "county") return;
            const [lng, lat] = f.geometry.coordinates;
            const d = metersBetween(st.lat, st.lng, lat, lng);
            if (d < bestD) { bestD = d; out.area = name; }
          });
          let roadD = 90;
          st.map.querySourceFeatures("base", { sourceLayer: "roads" }).forEach((f) => {
            const p = f.properties || {};
            const name = p["name:en"] || p.name;
            if (!name || !f.geometry) return;
            if (p.kind === "path" || p.kind === "other" || p.kind === "rail") return;
            const g = f.geometry;
            const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
            lines.forEach((c) => {
              const d = metersToLine(st.lat, st.lng, c);
              if (d < roadD) { roadD = d; out.road = name; }
            });
          });
        } catch (_) { /* tiles not ready: no street / area line */ }
        return out;
      }

      function readPlace() {
        const p = findPlace();
        st.area = p.area;
        st.road = p.road;
        st.addr = [p.road, p.area].filter(Boolean).join(", ");
      }

      function onMoved() {
        const c = st.map.getCenter();
        st.lat = c.lat;
        st.lng = c.lng;
        readPlace();
        refreshStatus();
        emit();
      }

      /** "Finding your location" with one, two, three dots, on the map itself, while the phone is being asked where it is. */
      function findingOn() {
        const box = q("finding");
        if (!box || findTimer) return;
        let n = 1;
        q("dots").textContent = ".";
        box.hidden = false;
        findTimer = setInterval(() => { n = n % 3 + 1; q("dots").textContent = ".".repeat(n); }, 420);
      }
      function findingOff() {
        if (findTimer) { clearInterval(findTimer); findTimer = 0; }
        const box = q("finding");
        if (box) box.hidden = true;
      }

      function locate() {
        if (!st.map) { findingOff(); return; }
        if (!navigator.geolocation) { findingOff(); setStatus("warn", "This phone can't share its location", "Move the map to your spot instead."); return; }
        if (window.isSecureContext === false) { findingOff(); setStatus("warn", "Location needs a secure (https) connection", "Move the map to your spot instead."); return; }
        findingOn();
        const btns = [q("locate2")];
        btns.forEach((b) => { b.disabled = true; });
        setStatus("wait", "Finding your location…", "");
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            findingOff();
            btns.forEach((b) => { b.disabled = false; });
            const ll = [pos.coords.longitude, pos.coords.latitude];
            if (!st.dot) {
              const dot = document.createElement("div");
              dot.className = "dm-me";
              st.dot = new maplibregl.Marker({ element: dot }).setLngLat(ll).addTo(st.map);
            } else {
              st.dot.setLngLat(ll);
            }
            st.userFly = true;
            // straight there (no flight): a flight passes over every place in between and loads their map tiles on the way
            st.map.jumpTo({ center: ll, zoom: Math.max(st.map.getZoom(), 16.5) });
          },
          (err) => {
            findingOff();
            btns.forEach((b) => { b.disabled = false; });
            const denied = err && err.code === 1;
            setStatus(
              "warn",
              denied ? "Location is blocked for this site" : "Couldn't find your location",
              denied ? "Allow location in your browser settings, or move the map to your spot." : "Move the map to your spot instead."
            );
            onMoved();
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
        );
      }

      // ---- search box: area / street / landmark, answered from the shop's own stored map list ----

      const qBox = q("q"), resBox = q("results"), goBtn = q("go"), clearBtn = q("clear");
      const KIND_LABEL = { neighbourhood: "Area", suburb: "Area", locality: "Area", city: "City", town: "Town", village: "Village", hamlet: "Village", subplace: "Area" };
      const pretty = (k) => (k || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      const kindText = (it) => (it.t === 0 ? KIND_LABEL[it.kind] || "Area" : it.t === 1 ? "Street" : pretty(it.kind) || "Landmark");
      const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let searchSeq = 0;

      function loadIndex() {
        if (st.indexState !== "idle") return;
        if (!st.searchUrl) { st.indexState = "none"; return; }
        st.indexState = "loading";
        const url = st.searchUrl;
        let pr = indexes.get(url);
        if (!pr) {
          pr = fetch(abs(apiBase() + url))
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
              if (!j || !Array.isArray(j.items)) return null;
              const kinds = j.kinds || [];
              return j.items.map((r) => ({ name: r[0], t: r[1], kind: kinds[r[2]] || "", lng: r[3], lat: r[4], n: norm(r[0]) }));
            })
            .catch(() => null);
          indexes.set(url, pr);
          pr.then((ix) => { if (!ix) indexes.delete(url); }); // (a failed read is tried again next time)
        }
        pr
          .then((ix) => {
            if (!ix) { st.indexState = "none"; return; }
            st.index = ix;
            st.indexState = "ready";
          })
          .catch(() => { st.indexState = "none"; })
          .then(() => { if (!st.closed && document.activeElement === qBox) showResults(); });
      }

      function runSearch(text) {
        const tokens = norm(text).split(" ").filter(Boolean);
        if (!tokens.length || !st.index) return [];
        const c = st.map ? st.map.getCenter() : { lat: DEFAULT_START[1], lng: DEFAULT_START[0] };
        const joined = tokens.join(" ");
        const out = [];
        for (const it of st.index) {
          let ok = true;
          for (const t of tokens) if (it.n.indexOf(t) < 0) { ok = false; break; }
          if (!ok) continue;
          let score = it.n === joined ? 100 : it.n.indexOf(joined) === 0 ? 80 : (" " + it.n).indexOf(" " + tokens[0]) >= 0 ? 55 : 35;
          score += it.t === 0 ? 12 : it.t === 1 ? 6 : 0;
          const km = metersBetween(c.lat, c.lng, it.lat, it.lng) / 1000;
          score -= Math.min(25, km);
          out.push({ it, score, km });
        }
        out.sort((a, b) => b.score - a.score);
        return out.slice(0, 8);
      }

      const meRow = `<button type="button" class="dm-res dm-res-me" data-dm-res="me"><span class="dm-res-ico">◎</span><span class="dm-res-txt"><b>Use my current location</b><small>Find me with this phone's GPS</small></span></button>`;

      function showResults() {
        const text = qBox.value.trim();
        let html = meRow;
        if (text.length >= 2) {
          if (st.indexState === "loading" || st.indexState === "idle") {
            html += `<div class="dm-res-note">Searching…</div>`;
          } else if (st.indexState === "none") {
            html += `<div class="dm-res-note">Search isn't available yet - move the map to your spot, or use your current location.</div>`;
          } else {
            const found = runSearch(text);
            st.found = found;
            if (!found.length) html += `<div class="dm-res-note">No match for “${esc(text)}”. Try another spelling, or move the map to your spot.</div>`;
            else html += found.map((f, i) => `<button type="button" class="dm-res" data-dm-res="${i}"><span class="dm-res-ico">${f.it.t === 1 ? "≡" : f.it.t === 2 ? "★" : "📍"}</span><span class="dm-res-txt"><b>${esc(f.it.name)}</b><small>${esc(kindText(f.it))}${f.km >= 1 ? " · " + f.km.toFixed(f.km < 10 ? 1 : 0) + " km from the map centre" : ""}</small></span></button>`).join("");
          }
        }
        resBox.innerHTML = html;
        resBox.hidden = false;
      }

      function hideResults() { resBox.hidden = true; }

      function goTo(f) {
        hideResults();
        qBox.value = f.it.name;
        clearBtn.hidden = false;
        qBox.blur();
        if (st.map) { st.userFly = true; st.map.jumpTo({ center: [f.it.lng, f.it.lat], zoom: f.it.t === 1 ? 16.2 : 17 }); }
      }

      qBox.addEventListener("focus", () => ensure(() => { loadIndex(); if (document.activeElement === qBox) showResults(); }));
      qBox.addEventListener("input", () => {
        clearBtn.hidden = !qBox.value;
        const seq = ++searchSeq;
        setTimeout(() => { if (seq === searchSeq && !st.closed) showResults(); }, 90);
      });
      qBox.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); doSearch(); }
        else if (e.key === "Escape" && !resBox.hidden) { e.stopPropagation(); hideResults(); qBox.blur(); }
      });
      function doSearch() {
        loadIndex();
        showResults();
        const found = st.found || [];
        if (qBox.value.trim().length >= 2 && st.indexState === "ready" && found.length === 1) goTo(found[0]);
      }
      goBtn.addEventListener("click", () => ensure(doSearch));
      clearBtn.addEventListener("click", () => { qBox.value = ""; clearBtn.hidden = true; showResults(); qBox.focus(); });
      resBox.addEventListener("click", (e) => {
        const b = e.target.closest("[data-dm-res]");
        if (!b) return;
        const k = b.getAttribute("data-dm-res");
        if (k === "me") { hideResults(); qBox.blur(); locate(); return; }
        const f = (st.found || [])[Number(k)];
        if (f) goTo(f);
      });
      // a tap on the map (or anywhere outside the search box) closes the suggestions
      el.addEventListener("pointerdown", (e) => { if (!e.target.closest('[data-dm="search"]')) hideResults(); });

      const confirm = q("confirm");
      if (confirm) {
        confirm.addEventListener("click", () => {
          if (st.lat == null) return;
          readPlace();
          close({ lat: round(st.lat), lng: round(st.lng), area: st.area, road: st.road, addr: st.addr || st.area });
        });
      }

      // ---- start: engine + settings (the only requests this screen ever makes) ----
      /** Runs {@code fn} once the map exists; in a form that still shows the picture, the first call loads the map. */
      function ensure(fn) {
        if (st.map) { if (fn) fn(); return; }
        if (fn) st.then.push(fn);
        if (!st.started) start();
      }

      function start() {
        if (st.started) return;
        st.started = true;
        if (lazy) q("loading").hidden = false;
        (async () => {
          try {
            const [, cfg] = await Promise.all([loadVendor(), getConfig()]);
            if (st.closed) return;
            if (!cfg || cfg.enabled === false) { // switched off since this page loaded
              sync(false);
              close(null);
              return;
            }
            st.hasTiles = !!(cfg.tiles && cfg.tiles.url);
            st.searchUrl = cfg.search && cfg.search.url ? cfg.search.url : "";
            createMap(cfg);
          } catch (err) {
            if (st.closed) return;
            q("loading").hidden = false;
            q("loading").innerHTML = `<span>${esc(err.message || "Could not open the map.")}</span><button type="button" class="btn btn-gold btn-sm" data-dm="retry">Try again</button>`;
            const retry = q("retry");
            if (retry) retry.addEventListener("click", () => { close(null); open(Object.assign({}, opts, { lazy: false })).then(resolve); });
          }
        })();
      }
      if (lazy) {
        const ph = q("ph");
        ph.addEventListener("click", () => ensure(null));
        const phFingers = new Set(); // a squeeze on the picture loads the map too
        ph.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") { phFingers.add(e.pointerId); if (phFingers.size >= 2) ensure(null); } });
        ["pointerup", "pointercancel"].forEach((t) => ph.addEventListener(t, (e) => phFingers.delete(e.pointerId)));
      } else {
        start();
      }

      /** Keeps a small picture of the map the customer was just shown (still on the spot the form opened with), so the next time this
       * form opens it can show that instead of loading the map: it costs no request at all. */
      function snapshot() {
        if (!lazy || st.snapped || st.touched || !st.hasTiles || st.lat == null || !opts.point || !st.map) return;
        if (metersBetween(st.lat, st.lng, opts.point.lat, opts.point.lng) > 20) return;
        st.snapped = true;
        const lat = st.lat, lng = st.lng;
        st.map.once("render", () => {
          try {
            const c = st.map.getCanvas();
            const w = 480, h = Math.max(1, Math.round((c.height * w) / c.width));
            const t = document.createElement("canvas");
            t.width = w; t.height = h;
            t.getContext("2d").drawImage(c, 0, 0, w, h);
            localStorage.setItem(SNAP_KEY, JSON.stringify({ lat, lng, t: Date.now(), url: t.toDataURL("image/jpeg", 0.6) }));
          } catch (_) { /* private mode / too big: the generic picture is used next time */ }
        });
        st.map.triggerRepaint();
      }

      function createMap(cfg) {
        const start = opts.point && isFinite(opts.point.lat) && isFinite(opts.point.lng) ? [opts.point.lng, opts.point.lat] : null;
        const centre = start || DEFAULT_START;
        const map = new maplibregl.Map({
          container: q("map"),
          style: buildStyle(cfg.tiles),
          center: centre,
          zoom: 16.5,
          minZoom: 8,
          maxZoom: 19,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          fadeDuration: 0,
        });
        st.map = map;
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right"); // sits under the search box (see the CSS)

        map.on("load", () => {
          if (st.closed) return;
          q("loading").hidden = true;
          if (lazy) { const ph = q("ph"); if (ph) ph.remove(); q("map").parentElement.classList.remove("is-ph"); }
          onMoved();
          const todo = st.then.splice(0);
          todo.forEach((fn) => { try { fn(); } catch (_) { /* a queued action must never break the map */ } });
        });
        map.on("movestart", () => q("pin").classList.add("dm-lift"));
        map.on("moveend", (e) => {
          if (gone()) return;
          q("pin").classList.remove("dm-lift");
          if (e && e.originalEvent) st.touched = true; // the customer moved it by hand
          else if (st.userFly) { st.touched = true; st.userFly = false; } // search result / "use current location"
          st.reread = true;
          onMoved();
        });
        map.on("idle", () => {
          if (gone()) return;
          // the map has stopped and its tiles are in: read the street / area again (right after a jump the tiles of the new place were not there yet)
          if (st.hasTiles && (st.reread || !st.addr)) {
            const had = st.reread;
            st.reread = false;
            const before = st.addr;
            readPlace();
            if (st.addr && (had || !before)) { refreshStatus(); emit(); }
          }
          snapshot();
        });
        map.on("error", (e) => {
          // a missing tile or a hiccup must never leave the screen stuck on "loading"
          if (e && e.error && /pmtiles|tile|Failed to fetch/i.test(String(e.error.message || e.error))) q("loading").hidden = true;
        });
        // a phone's browser bar changing size resizes the map area
        window.addEventListener("resize", () => { if (!st.closed && !gone()) map.resize(); });
        if (inline) {
          map.scrollZoom.disable(); // the plain mouse wheel scrolls the form (zoom with + / - or a squeeze)
          // A squeeze on a laptop trackpad arrives as Ctrl + wheel (Chrome / Edge / Firefox) or as a "gesture" (Safari): it zooms the MAP,
          // around the finger, instead of letting the browser zoom the whole page.
          const mapWrap = q("map").parentElement;
          mapWrap.addEventListener("wheel", (e) => {
            if (!e.ctrlKey) return; // (a normal scroll goes on scrolling the form)
            e.preventDefault();
            const r = q("map").getBoundingClientRect();
            const px = [e.clientX - r.left, e.clientY - r.top];
            const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            const z = Math.max(8, Math.min(19, map.getZoom() - dy * 0.018));
            map.easeTo({ zoom: z, around: map.unproject(px), duration: 0 });
          }, { passive: false });
          let gz = 0;
          mapWrap.addEventListener("gesturestart", (e) => { e.preventDefault(); gz = map.getZoom(); });
          mapWrap.addEventListener("gesturechange", (e) => { e.preventDefault(); map.jumpTo({ zoom: Math.max(8, Math.min(19, gz + Math.log2(e.scale || 1))) }); });
          mapWrap.addEventListener("gestureend", (e) => e.preventDefault());
          // On a touch screen a finger on the map would move the map whenever the customer only wants to scroll the form. So the map
          // is "asleep" (the page scrolls under the finger) until it is tapped; then one finger moves it, and it falls asleep again
          // as soon as the customer touches anything else.
          if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
            const wrap = q("map").parentElement;
            const live = (on) => {
              wrap.classList.toggle("is-live", on);
              const m = ["dragPan", "touchZoomRotate", "doubleClickZoom"];
              m.forEach((h) => { try { map[h][on ? "enable" : "disable"](); } catch (_) { /* already so */ } });
              if (on) map.touchZoomRotate.disableRotation();
            };
            live(lazy); // (a map the customer just asked for by tapping it starts awake)
            let down = null;
            const fingers = new Set();
            wrap.addEventListener("pointerdown", (e) => {
              down = { x: e.clientX, y: e.clientY, t: Date.now() };
              if (e.pointerType === "touch") {
                fingers.add(e.pointerId);
                if (fingers.size >= 2 && !wrap.classList.contains("is-live")) live(true); // two fingers on the map: the customer is zooming it
              }
            });
            const lift = (e) => fingers.delete(e.pointerId);
            wrap.addEventListener("pointercancel", lift);
            wrap.addEventListener("pointerup", (e) => { lift(e); // a tap (not a swipe that scrolled the page) wakes the map
              if (down && !wrap.classList.contains("is-live") && Math.abs(e.clientX - down.x) < 16 && Math.abs(e.clientY - down.y) < 16 && Date.now() - down.t < 900 && !e.target.closest("button, .maplibregl-ctrl")) live(true);
              down = null;
            });
            q("wake").addEventListener("click", () => live(true)); // (the label itself is a button too)
            document.addEventListener("pointerdown", (e) => {
              if (st.closed) return;
              if (gone()) return;
              if (wrap.classList.contains("is-live") && !wrap.contains(e.target)) live(false);
            }, true);
          }
        }
        setTimeout(() => { if (!st.closed) map.resize(); }, 260);
      }
    });
  }

  const round = (n) => Math.round(n * 1e6) / 1e6;

  // ---- the customer's saved pin: ONE place on this phone, used by every screen ------------------------
  // It is written only when an address or an order is SAVED with it (or read back from the saved address on the server), so what every
  // screen and the top-right button show is always the saved location. A spot chosen on the map is only "pending": it travels to the
  // address form that follows (see pickThen / pickerHtml) and is saved, or dropped, with that form.

  const PIN_KEY = "freshcutz_map_pin";
  function storedPin() {
    try {
      const v = JSON.parse(localStorage.getItem(PIN_KEY) || "null");
      return v && isFinite(v.lat) && isFinite(v.lng) ? v : null;
    } catch (_) { return null; }
  }
  function storePin(res) {
    const rec = { lat: res.lat, lng: res.lng, addr: res.addr || res.area || "", area: res.area || res.road || "" };
    try { localStorage.setItem(PIN_KEY, JSON.stringify(rec)); } catch (_) { /* private mode: not kept */ }
    try { document.dispatchEvent(new CustomEvent("freshcutz:pin", { detail: rec })); } catch (_) { /* ignore */ }
  }
  /** Signing out: the saved location belonged to that customer's address, so the top-right button goes back to "Select Location". */
  function clearPin() {
    try { localStorage.removeItem(PIN_KEY); } catch (_) { /* ignore */ }
    try { document.dispatchEvent(new CustomEvent("freshcutz:pin", { detail: null })); } catch (_) { /* ignore */ }
    paintPill();
  }
  const pinOf = (o) => {
    const lat = o ? parseFloat(o.deliveryLat) : NaN, lng = o ? parseFloat(o.deliveryLng) : NaN;
    return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
  };

  /** An address / order was saved: its pin (when it has one) is now the saved location of this phone. */
  function pinSaved(saved) {
    const sv = pinOf(saved);
    if (!sv) return;
    const sp = storedPin();
    const same = sp && Math.abs(sp.lat - sv.lat) < 1e-6 && Math.abs(sp.lng - sv.lng) < 1e-6;
    const named = saved && saved.deliveryArea ? String(saved.deliveryArea) : "";
    storePin({ lat: sv.lat, lng: sv.lng, addr: named || (same ? sp.addr : ""), area: same ? sp.area : "" });
  }

  // ---- leaving an address form without pressing its save button ----------------------------------------------------------
  /** True when the form holds a spot the customer moved the pin to (it differs from the one the form opened with, i.e. the saved one). */
  function isUnsaved(form) {
    const box = form && form.querySelector("[data-dm-pick]");
    if (!box || box.dataset.init == null) return false;
    const lat = parseFloat((box.querySelector('[name="deliveryLat"]') || {}).value);
    const lng = parseFloat((box.querySelector('[name="deliveryLng"]') || {}).value);
    if (!(isFinite(lat) && isFinite(lng))) return false;
    const [a, b] = box.dataset.init.split(",").map(parseFloat);
    return !(isFinite(a) && isFinite(b) && Math.abs(a - lat) < 1e-5 && Math.abs(b - lng) < 1e-5);
  }

  /** "Are you sure you want to cancel this?": No stays on the form, Yes, cancel leaves it (and says nothing was saved). */
  function askLeave(btnText, onLeave) {
    if (document.querySelector(".dm-lv")) return;
    const box = document.createElement("div");
    box.className = "dm-lv";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `<div class="dm-lv-card">
      <div class="dm-lv-t"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3 1.8 20.5h20.4L12 3z" fill="none" stroke="#e5a100" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5" stroke="#e5a100" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.7" r="1.1" fill="#e5a100"/></svg><span>Are you sure you want to cancel this?</span></div>
      <p class="dm-lv-p">Your selected location has not been saved yet.</p>
      <div class="dm-lv-b"><button type="button" class="btn btn-ghost" data-lv="leave">Yes, cancel</button><button type="button" class="btn btn-gold" data-lv="stay">No</button></div>
    </div>`;
    document.body.appendChild(box);
    const done = (leave) => {
      document.removeEventListener("keydown", onKey, true);
      box.remove();
      if (leave) {
        if (typeof Toast !== "undefined") Toast.show("Location not saved", "info");
        onLeave();
      }
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", onKey, true);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lv]");
      if (b) done(b.dataset.lv === "leave");
      else if (e.target === box) done(false);
    });
    const ok = box.querySelector('[data-lv="stay"]');
    if (ok) ok.focus();
  }

  /** Back / ✕ / the dark area of an address form: asks first when a chosen spot would be lost. Returns true when it asked (the
   * move then waits for the answer), false when there is nothing to lose and the caller just goes on. */
  function guardLeave(form, btnText, go) {
    if (!isUnsaved(form)) return false;
    askLeave(btnText, go);
    return true;
  }

  /** The pin an address form / checkout should start with: the one on the address, else the last saved one on this phone.
   * (deliveryArea = the map's name for that spot, "Road No 96, Venkateswara Colony".) */
  function withPin(prefill) {
    const own = pinOf(prefill);
    const sp = own ? null : storedPin();
    const use = own || sp;
    const area = own ? (prefill && prefill.deliveryArea ? String(prefill.deliveryArea) : "") : sp ? sp.addr || "" : "";
    return Object.assign({}, prefill || {}, use ? { deliveryLat: use.lat, deliveryLng: use.lng, deliveryArea: area } : {});
  }

  // ---- the address is two parts: the spot chosen on the map (street, area) and what the customer types (building / apartment) ----
  // What is saved and shown everywhere (orders, admin, exports) is the whole line "<building>, <street, area>"; the map part is also
  // kept on its own (deliveryArea) so it can be changed on the map without touching what the customer typed.

  const LABEL_FULL = "Building name / Address";
  const LABEL_BLD = LABEL_FULL; // the same name everywhere; the box is always required
  const stripArea = (addr, area) => {
    addr = String(addr || "").trim();
    area = String(area || "").trim();
    if (!area) return addr;
    if (addr.toLowerCase() === area.toLowerCase()) return "";
    const suf = ", " + area.toLowerCase();
    return addr.toLowerCase().endsWith(suf) ? addr.slice(0, addr.length - suf.length).trim() : addr;
  };
  const joinArea = (building, area) => {
    building = String(building || "").trim();
    area = String(area || "").replace(/\s+/g, " ").trim();
    if (!area) return building;
    if (!building) return area;
    return building.toLowerCase().indexOf(area.toLowerCase()) >= 0 ? building : `${building}, ${area}`;
  };
  const hasPinFor = (prefill) => !!(enabled && pinOf(withPin(prefill)));
  /** The text for the "Building / Apartment" box of a saved address (the map part taken off the end). */
  const buildingOf = (prefill) => (enabled && prefill ? stripArea(prefill.addressLine, prefill.deliveryArea) : String((prefill && prefill.addressLine) || ""));
  const addrLabel = (prefill) => (hasPinFor(prefill) ? LABEL_BLD : LABEL_FULL);
  const addrPlaceholder = (prefill) => (hasPinFor(prefill) ? "e.g. Sunrise Apartments, Block B" : "Building, street, area");
  /** The whole address line of a saved address, with the map part of the pin that is going to be used. */
  const composedFor = (prefill) => {
    if (!enabled || !prefill) return String((prefill && prefill.addressLine) || "");
    const w = withPin(prefill);
    return pinOf(w) ? joinArea(buildingOf(prefill), w.deliveryArea) : String(prefill.addressLine || "");
  };
  /** The address line to save from a form: what was typed + the map part. */
  function addressFrom(formData) {
    const building = String(formData.get("addressLine") || "").trim();
    if (!enabled) return building;
    const lat = parseFloat(formData.get("deliveryLat")), lng = parseFloat(formData.get("deliveryLng"));
    if (!(isFinite(lat) && isFinite(lng))) return building;
    return joinArea(building, formData.get("deliveryArea"));
  }
  /** The building / address box is always required (a spot on the map does not replace it). */
  function addressOptional() { return false; }

  /** "Change address" / "Update address" used to open a full-screen map first. The map is now part of the address page itself (see
   * pickerHtml), so there is nothing to ask first: {@code go} just opens that page. */
  function pickThen(prefill, go) { go(); }

  // ---- the map inside the address forms ------------------------------------------

  /** The location part of an address form: a small map with a search box (the pin stays in the middle, move the map under it), and
   * under it the street / area of that spot in its own titled box, plus the hidden fields the order carries. It all sits on the
   * same page as the name / flat / building / landmark boxes. Nothing at all while the map is switched off. The spot is only
   * saved when the form is saved. */
  function pickerHtml(prefill) {
    if (!enabled) return "";
    const w = withPin(prefill);
    const p = pinOf(w);
    const has = !!p;
    const area = has ? String(w.deliveryArea || "").trim() : "";
    return `
      <div class="field dm-pick" data-dm-pick>
        <input type="hidden" name="deliveryLat" value="${has ? p.lat : ""}" />
        <input type="hidden" name="deliveryLng" value="${has ? p.lng : ""}" />
        <input type="hidden" name="deliveryArea" value="${esc(area)}" />
        <div class="dm-pick-label">Pin your delivery location</div>
        <div data-dm-inline></div>
        <div class="dm-pick-label dm-pick-label2">Delivery location</div>
        <div class="dm-loc${has ? " is-set" : ""}" data-dm-loc>
          <span class="dm-loc-ico" aria-hidden="true">📍</span>
          <span class="dm-loc-text" data-dm-loc-text>${has ? esc(area || "Pinned on the map") : "Move the map to set your location"}</span>
        </div>
        <div class="dm-pick-note" data-dm-pick-note>${has ? "" : "Move the map to your spot, then add your building details below."}</div>
      </div>`;
  }

  /** Starts the map inside {@code root}'s location part and keeps the spot (and its name) in the form's hidden fields. */
  function wirePicker(root) {
    if (!enabled || !root) return;
    const box = root.querySelector("[data-dm-pick]");
    if (!box) return;
    const host = box.querySelector("[data-dm-inline]");
    const note = box.querySelector("[data-dm-pick-note]");
    const loc = box.querySelector("[data-dm-loc]");
    const locText = box.querySelector("[data-dm-loc-text]");
    const latEl = box.querySelector('input[name="deliveryLat"]');
    const lngEl = box.querySelector('input[name="deliveryLng"]');
    const areaEl = box.querySelector('input[name="deliveryArea"]');
    const addr = root.querySelector('[name="addressLine"]');
    const addrLabel_ = root.querySelector("[data-dm-addr-label]");
    const hasPin = () => isFinite(parseFloat(latEl.value)) && isFinite(parseFloat(lngEl.value));
    const show = (text) => { locText.textContent = text; loc.classList.add("is-set"); };

    box.dataset.init = latEl.value + "," + lngEl.value; // (what the form opened with: moving the pin away from it is an unsaved change)
    const lat = parseFloat(latEl.value), lng = parseFloat(lngEl.value);
    open({
      inline: host,
      lazy: true,
      point: isFinite(lat) && isFinite(lng) ? { lat, lng } : null,
      onChange(res) {
        // the customer moved the pin: the form now holds that spot (it becomes the saved one when the form is saved)
        latEl.value = res.lat;
        lngEl.value = res.lng;
        areaEl.value = res.addr || res.area || "";
        show(areaEl.value || "Pinned on the map");
        note.textContent = "";
        // with a spot on the map the building box is only for the building / apartment
        if (addrLabel_) addrLabel_.textContent = LABEL_BLD;
        if (addr) addr.placeholder = "e.g. Sunrise Apartments, Block B";
      },
      onStatus(s) {
        if (s.state === "warn") note.textContent = s.title + (s.sub ? ". " + s.sub : "");
        else if (s.state === "wait") note.textContent = ""; // (the map itself says "Finding your location...")
        else if (!hasPin()) note.textContent = "Move the map to your spot, then add your building details below.";
        else {
          note.textContent = "";
          // a saved pin that has no name yet: the map names it (the pin itself does not move)
          if (!areaEl.value && s.addr) { areaEl.value = s.addr; show(s.addr); }
        }
      },
    });
  }

  /** {deliveryLat, deliveryLng, deliveryArea} from a FormData, or {} when there is no pin (or the map is off). */
  function pinFrom(formData) {
    if (!enabled) return {};
    const lat = parseFloat(formData.get("deliveryLat"));
    const lng = parseFloat(formData.get("deliveryLng"));
    if (!(isFinite(lat) && isFinite(lng))) return {};
    const area = String(formData.get("deliveryArea") || "").trim();
    return area ? { deliveryLat: lat, deliveryLng: lng, deliveryArea: area } : { deliveryLat: lat, deliveryLng: lng };
  }

  // ---- start ------------------------------------------------------------------------

  /** The top-right button says "Select Location" until a location is set, then the whole address of that location (street, area).
   * It shows 12 characters at a time: a longer one scrolls from right to left, round and round. */
  const PILL_CHARS = 12;
  function paintPill() {
    const btn = $("areaBtn");
    if (!btn) return;
    const txt = btn.querySelector(".area-txt");
    const sp = storedPin();
    const name = sp && sp.addr ? String(sp.addr).replace(/\s+/g, " ").trim() : "";
    const label = name || "Select Location";
    if (txt && txt.dataset.shown !== label) {
      txt.dataset.shown = label;
      const scroll = name.length > PILL_CHARS;
      txt.classList.toggle("is-marquee", scroll);
      txt.textContent = "";
      const inner = document.createElement("span");
      inner.className = "area-marq";
      if (scroll) {
        // two copies with a small gap between them, moved left by exactly one copy: the text follows itself with no empty stretch
        const one = `<span class="area-t"></span><i class="area-sep"></i>`;
        inner.innerHTML = one + one.replace("area-t", "area-t area-dup").replace("area-sep", "area-sep area-dup");
        inner.querySelectorAll(".area-t").forEach((n) => { n.textContent = label; });
        inner.querySelectorAll(".area-dup").forEach((n) => n.setAttribute("aria-hidden", "true"));
        inner.style.animationDuration = Math.max(5, Math.round(label.length * 0.3)) + "s"; // (refined below, once its width is known)
        requestAnimationFrame(() => {
          const half = inner.scrollWidth / 2;
          if (half > 20) inner.style.animationDuration = Math.max(5, half / 32).toFixed(1) + "s"; // ~32 px a second
        });
      } else {
        inner.textContent = label;
      }
      txt.appendChild(inner);
    }
    btn.setAttribute("aria-label", name ? `Delivery location: ${name}. Tap to change` : "Select Location");
    if (name) btn.title = name; else btn.removeAttribute("title");
  }

  function init() {
    const btn = $("areaBtn");
    paintPill();
    document.addEventListener("freshcutz:pin", paintPill);
    window.addEventListener("storage", (e) => { if (!e.key || e.key === PIN_KEY) paintPill(); });
    if (btn) {
      btn.addEventListener("click", async () => {
        const ps = window.ProfileSheet;
        const phone = ps && ps.getSavedPhone ? ps.getSavedPhone() : "";
        // (the address page reads the customer's saved address itself, once, and reuses what the account already holds)
        const signedIn = !!(phone && ps && ps.editAddress);
        if (signedIn) {
          // the address page: the map, the spot's name and the name / flat / building / landmark boxes on one screen
          const opened = await ps.editAddress({ fromMap: true });
          if (!opened && typeof Toast !== "undefined") Toast.show("Couldn't open your address page. Please try again.", "error");
          return;
        }
        // not signed in: there is no address page to continue to, so the spot is kept on this phone for the order
        const sp = storedPin();
        const res = await open({ point: sp ? { lat: sp.lat, lng: sp.lng } : null, confirmText: "Save location" });
        if (!res) return;
        storePin(res);
        if (typeof Toast !== "undefined") Toast.show("Location saved - it will be used when you order", "success");
      });
    }
    const cfg = window.SiteCustomize && window.SiteCustomize.cfg ? window.SiteCustomize.cfg() : null;
    sync(!!(cfg && cfg.mapEnabled));
    // the switch is part of the site settings: it follows them live (admin turns it on/off, an open page follows within a second)
    document.addEventListener("freshcutz:site", () => {
      const c = window.SiteCustomize && window.SiteCustomize.cfg ? window.SiteCustomize.cfg() : null;
      sync(!!(c && c.mapEnabled));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { isEnabled, open, guardLeave, isUnsaved, pickerHtml, wirePicker, pinFrom, pinSaved, clearPin, withPin, pickThen, buildingOf, composedFor, addressFrom, addressOptional, addrLabel, addrPlaceholder, sync, engine: loadVendor, styleFor: buildStyle, zoneAt, zonesBounds, HYDERABAD };
})();
