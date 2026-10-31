/* Orders tab: for every order the customer pinned on the map, shows whether that spot is inside the delivery areas the owner
 * drew (Settings -> Delivery map), and an "Open on map" screen with the areas and the pin.
 *
 * Almost no requests: the orders list already carries each order's pin (data-pin on the card), so the badges are worked out here
 * from the areas, which are fetched ONCE and kept for a few minutes (and for "Open on map" too). While the Delivery map is off,
 * or while no order on screen has a pin, this file makes no request at all. The areas are for the owner only. */

window.AdminOrderMap = (() => {
  const list = document.getElementById("ordersList");
  if (!list) return { setOn() {}, reset() {}, invalidate() {}, view() {} };

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const TTL = 10 * 60 * 1000;
  let on = false;
  let timer = null;
  let cfg = null;      // { at, zones, tilesUrl }
  let cfgReq = null;   // the request in flight (so two callers share one)

  /** The areas and the map file address - one request, then reused. */
  function getZones() {
    if (cfg && Date.now() - cfg.at < TTL) return Promise.resolve(cfg);
    if (cfgReq) return cfgReq;
    cfgReq = Api.get("/api/admin/orders/map-info?viewer=1")
      .then((res) => {
        if (!res || res.enabled === false) return null;
        cfg = { at: Date.now(), zones: Array.isArray(res.zones) ? res.zones : [], tilesUrl: res.tilesUrl || "" };
        return cfg;
      })
      .finally(() => { cfgReq = null; });
    return cfgReq;
  }

  function setOn(v) {
    const was = on;
    on = !!v;
    if (on && !was) schedule();
    if (!on && was) { clearBadges(); cfg = null; }
  }

  /** The areas or the map file changed: forget what was fetched (nothing is requested until a badge or the viewer needs it). */
  function invalidate() { cfg = null; }

  function reset() {
    invalidate();
    clearBadges();
    if (on) schedule();
  }

  function clearBadges() {
    list.querySelectorAll(".om-line, .om-mini").forEach((n) => n.remove());
    list.querySelectorAll("[data-om]").forEach((n) => n.removeAttribute("data-om"));
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, 120);
  }

  /** This card's pin, from the order the list gave: { lat, lng } or null. */
  function pinOf(card) {
    const v = card && card.dataset.pin;
    if (!v) return null;
    const [lat, lng] = v.split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function infoOf(card, zones) {
    const p = pinOf(card);
    if (!p) return null;
    if (!zones || !zones.length) return { lat: p.lat, lng: p.lng, area: null };
    const z = DeliveryMap.zoneAt(zones, p.lat, p.lng);
    return z ? { lat: p.lat, lng: p.lng, area: "in", zone: z.name } : { lat: p.lat, lng: p.lng, area: "out" };
  }

  /** Outside the areas: a warning line. Inside them (or no areas drawn): nothing to warn about, so only a small "Open on map" link beside the address. */
  function badgeHtml(it) {
    if (!it) return ""; // no pin on this order: nothing is shown
    if (it.area === "out") return `<div class="om-line om-out"><span>⚠ Outside your delivery area</span><button type="button" class="om-open" data-om-open>Open on map</button></div>`;
    return "";
  }
  const MINI = `<button type="button" class="om-mini" data-om-open>Open on map</button>`;

  function paint(card, zones) {
    if (card.dataset.om === "1") return;
    const it = infoOf(card, zones);
    if (!it) return; // no pin on this order: nothing is shown
    card.dataset.om = "1";
    card.querySelectorAll(".om-line, .om-mini").forEach((n) => n.remove());
    const line = badgeHtml(it);
    if (line) {
      const anchor = card.querySelector(".order-customer");
      if (anchor) anchor.insertAdjacentHTML("afterend", line);
    } else {
      const addr = card.querySelector(".oc-addr");
      if (addr) addr.insertAdjacentHTML("afterend", MINI);
    }
  }

  async function flush() {
    if (!on) return;
    const cards = Array.from(list.querySelectorAll(".order-card[data-pin]")).filter((c) => c.dataset.om !== "1");
    if (!cards.length) return; // nothing pinned on screen: no request
    try {
      const c = await getZones();
      if (!c) { on = false; clearBadges(); return; } // the map was switched off meanwhile
      if (!on) return;
      cards.forEach((card) => { if (card.isConnected) paint(card, c.zones); });
    } catch (_) {
      /* the badges are a bonus: the order list works without them */
    }
  }

  new MutationObserver(() => { if (on && list.querySelector(".order-card[data-pin]:not([data-om])")) schedule(); }).observe(list, { childList: true, subtree: true });

  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-om-open]");
    if (!b) return;
    const card = b.closest(".order-card");
    if (card) view(Number(card.dataset.id), card);
  });

  // ---- "Open on map" ------------------------------------------------------------------

  async function view(id, card) {
    if (!pinOf(card)) return;
    const name = card && card.querySelector(".order-customer strong") ? card.querySelector(".order-customer strong").textContent : "";
    const code = card && card.querySelector(".order-code-lbl") ? card.querySelector(".order-code-lbl").textContent : "";
    const el = document.createElement("div");
    el.className = "mp-editor om-viewer";
    el.innerHTML = `
      <div class="mp-ed-top">
        <button type="button" class="mp-ed-x" data-a="x" aria-label="Close">✕</button>
        <div class="mp-ed-title">${esc(code)}${name ? " · " + esc(name) : ""}</div>
        <span></span>
      </div>
      <div class="mp-ed-map" data-a="map"><div class="mp-ed-loading" data-a="loading"><span class="spinner"></span> Loading map…</div></div>
      <div class="mp-ed-bar om-bar" data-a="bar"></div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add("mp-ed-open");
    let map = null;
    let closed = false;
    const q = (n) => el.querySelector(`[data-a="${n}"]`);
    const close = () => {
      if (closed) return;
      closed = true;
      try { map && map.remove(); } catch (_) { /* gone */ }
      el.remove();
      document.documentElement.classList.remove("mp-ed-open");
    };
    q("x").addEventListener("click", close);
    try {
      const [, res] = await Promise.all([DeliveryMap.engine(), getZones()]); // the areas are usually already here: no request
      if (closed) return;
      if (!res) throw new Error("The Delivery map is switched off");
      const zones = res.zones;
      const now = infoOf(card, zones);
      const label = now.area === "in" ? `<b class="om-in-t">✓ Inside your delivery area${now.zone ? " · " + esc(now.zone) : ""}</b>`
        : now.area === "out" ? `<b class="om-out-t">⚠ Outside your delivery area</b>` : `<b>📍 Pinned on the map</b>`;
      // Navigate: Google Maps with driving directions to the pin. Android opens the installed Google Maps app from this link; an iPhone
      // is sent straight to the Google Maps app (comgooglemaps://) and, if it is not installed, to the same directions on the web.
      const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${now.lat},${now.lng}&travelmode=driving`;
      q("bar").innerHTML = `${label}<a class="btn btn-gold btn-sm" data-a="nav" href="${webUrl}" target="_blank" rel="noopener">Navigate</a>`;
      const nav = q("nav");
      if (nav) {
        nav.addEventListener("click", (ev) => {
          const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
          if (!ios) return; // Android and desktop: the link itself
          ev.preventDefault();
          let left = false;
          const gone = () => { left = true; };
          document.addEventListener("visibilitychange", gone, { once: true });
          window.addEventListener("pagehide", gone, { once: true });
          window.location.href = `comgooglemaps://?daddr=${now.lat},${now.lng}&directionsmode=driving`;
          setTimeout(() => { // the app did not take over (not installed): open the web directions instead
            document.removeEventListener("visibilitychange", gone);
            window.removeEventListener("pagehide", gone);
            if (!left && !document.hidden) window.location.href = webUrl;
          }, 1600);
        });
      }
      map = new maplibregl.Map({
        container: q("map"),
        style: DeliveryMap.styleFor(res.tilesUrl ? { url: res.tilesUrl } : null),
        center: [now.lng, now.lat],
        zoom: 15.5,
        minZoom: 8,
        maxZoom: 19,
        attributionControl: false,
        dragRotate: false,
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (zones.length) {
          map.addSource("zones", {
            type: "geojson",
            data: { type: "FeatureCollection", features: zones.map((z) => ({ type: "Feature", properties: { name: z.name }, geometry: { type: "Polygon", coordinates: [z.ring.concat([z.ring[0]])] } })) },
          });
          map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#c9a13b", "fill-opacity": 0.17 } });
          map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#9c7a26", "line-width": 2.4 } });
        }
        const pin = document.createElement("div");
        pin.className = "om-pin-dot " + (now.area === "out" ? "is-out" : now.area === "in" ? "is-in" : "");
        new maplibregl.Marker({ element: pin }).setLngLat([now.lng, now.lat]).addTo(map);
        const l = q("loading");
        if (l) l.hidden = true;
        // the whole picture: the pin and the areas together when the pin is outside (so the distance is visible)
        const b = DeliveryMap.zonesBounds(zones);
        if (b && now.area === "out") {
          const w = Math.min(b[0], now.lng), s = Math.min(b[1], now.lat), e = Math.max(b[2], now.lng), n = Math.max(b[3], now.lat);
          map.fitBounds([[w, s], [e, n]], { padding: 50, animate: false, maxZoom: 15.5 });
        }
      });
      map.on("error", () => { const l = q("loading"); if (l) l.hidden = true; });
      setTimeout(() => { if (!closed && map) map.resize(); }, 260);
    } catch (err) {
      const l = q("loading");
      if (l) l.innerHTML = `<span>${esc(err.message || "Could not open the map")}</span>`;
    }
  }

  return { setOn, reset, invalidate, view };
})();
