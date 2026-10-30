/* Settings -> Delivery map (owner only).
 *
 *   1. the on/off switch - off means the customer website never loads or asks for any map data;
 *   2. the delivery areas: drawn on a full-screen map editor (tap to add corners, drag corners to move them);
 *   3. the offline map file (.pmtiles) of Hyderabad, uploaded in pieces into the database so the map never depends on anyone else.
 * Everything talks to /api/admin/map. The map engine and its style are the very same files the customer website uses. */

window.AdminMap = (() => {
  const root = document.getElementById("mapRoot");
  if (!root) return { refresh() {} };

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));
  const apiBase = () => window.FRESHCUTZ_API_BASE || "";
  const PARALLEL = 3;
  const MAX_MB = 200;

  let data = null; // { enabled, zones:[{id,name,ring}], tiles:{version,size,uploadedAt,url}|null }
  let loading = false;
  let uploading = false;
  let fetchedAt = 0; // when /api/admin/map was last read - the tab is not re-read every time it is opened
  const FRESH_MS = 5 * 60 * 1000;

  // ---- page -------------------------------------------------------------------

  async function refresh() {
    if (loading || uploading) return;
    if (data && Date.now() - fetchedAt < FRESH_MS) return; // shown already and recent: nothing to ask the server
    loading = true;
    if (!data) root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;
    try {
      data = await Api.get("/api/admin/map");
      fetchedAt = Date.now();
      paint();
    } catch (e) {
      root.innerHTML = `<div class="empty-state"><p>${esc(e.message || "Couldn't load the map settings")}</p></div>`;
    } finally {
      loading = false;
    }
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
  const when = (iso) => {
    try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); } catch (_) { return ""; }
  };

  function paint() {
    const zones = data.zones || [];
    const t = data.tiles;
    root.innerHTML = `
      <div class="mp-wrap">
        <div class="mp-card">
          <div class="mp-row">
            <div class="mp-row-text">
              <strong>Delivery area map</strong>
              <small>Customers get a “Delivery area” button at the top right, can search or pin their location, and the pin comes with their order. The areas you draw below are for you only: on every order you see whether its pin is inside them.</small>
            </div>
            <label class="mp-switch" aria-label="Delivery area map on or off">
              <input type="checkbox" id="mpEnabled" ${data.enabled ? "checked" : ""} />
              <span></span>
            </label>
          </div>
          <p class="mp-note" id="mpState">${data.enabled
            ? "ON - customers can see the map."
            : "OFF - the customer website does not show the map, never loads it and never asks for any map data."}</p>
        </div>

        <div class="mp-card">
          <h3 class="mp-h">Delivery areas</h3>
          <p class="mp-sub">Draw the places you deliver to. Customers never see these areas and no order is ever refused because of them. On each order in the Orders tab you'll see “Inside” or “Outside your delivery area” and can open the pin on the map.</p>
          <div class="mp-zones" id="mpZones">
            ${zones.length ? zones.map((z) => `<div class="mp-zone"><span class="mp-zone-dot"></span><span class="mp-zone-name">${esc(z.name)}</span><span class="mp-zone-n">${z.ring.length} points</span></div>`).join("")
              : `<p class="mp-empty">No delivery area drawn yet.</p>`}
          </div>
          <button type="button" class="btn btn-gold btn-block" id="mpEdit">${zones.length ? "✏️ Edit delivery areas on the map" : "＋ Draw your first delivery area"}</button>
        </div>

        <div class="mp-card">
          <h3 class="mp-h">Offline map of Hyderabad</h3>
          <p class="mp-sub">The map pictures live in your own database, so nothing depends on another company. Until you upload the file, customers see your delivery areas on a plain background.</p>
          <div class="mp-tiles ${t ? "is-set" : ""}">
            ${t ? `<strong>✓ Map file uploaded</strong><span>${mb(t.size)} · ${esc(when(t.uploadedAt))}</span>` : `<strong>No map file yet</strong><span>Plain background in use</span>`}
          </div>
          ${t ? `<div class="mp-tiles mp-search ${t.searchCount != null ? "is-set" : ""}">
            ${t.searchCount != null ? `<strong>✓ Address search ready</strong><span>${t.searchCount} areas, streets and landmarks customers can search</span>`
              : `<strong>Address search not prepared</strong><span>Customers can't type an area or street into the map yet</span>`}
          </div>
          <button type="button" class="btn btn-ghost btn-block" id="mpIndex">${t.searchCount != null ? "Rebuild the address search" : "Prepare the address search now"}</button>` : ""}
          <input type="file" id="mpFile" accept=".pmtiles" hidden />
          <button type="button" class="btn btn-gold btn-block" id="mpUpload">${t ? "Replace the map file" : "Upload the map file (.pmtiles)"}</button>
          <div class="mp-progress" id="mpProgress" hidden><div class="mp-bar"><i id="mpBar"></i></div><span id="mpProgressText"></span></div>
          ${t ? `<button type="button" class="btn btn-ghost btn-block" id="mpRemoveTiles">Remove the map file</button>` : ""}
          <details class="mp-help">
            <summary>How do I make the map file?</summary>
            <p>You only need one file called <b>hyderabad.pmtiles</b> (about 30 MB: the free OpenStreetMap data for Hyderabad). Upload it here. The address search is prepared automatically right after the upload. <b>MAP-SETUP.md</b> in the project explains how the file is made.</p>
          </details>
        </div>
      </div>`;

    root.querySelector("#mpEnabled").addEventListener("change", onToggle);
    root.querySelector("#mpEdit").addEventListener("click", openEditor);
    root.querySelector("#mpUpload").addEventListener("click", () => root.querySelector("#mpFile").click());
    root.querySelector("#mpFile").addEventListener("change", onFile);
    const ix = root.querySelector("#mpIndex");
    if (ix) ix.addEventListener("click", () => prepareSearchFromStored());
    const rm = root.querySelector("#mpRemoveTiles");
    if (rm) rm.addEventListener("click", removeTiles);
  }

  async function onToggle(e) {
    const box = e.target;
    box.disabled = true;
    try {
      data = await Api.put("/api/admin/map", { enabled: box.checked });
      fetchedAt = Date.now();
      if (window.AdminOrderMap) AdminOrderMap.invalidate();
      Toast.show(data.enabled ? "Delivery map is ON" : "Delivery map is OFF", "success");
      paint();
    } catch (err) {
      box.checked = !box.checked;
      box.disabled = false;
      Toast.show(err.message || "Could not change the switch", "error");
    }
  }

  async function removeTiles() {
    if (!window.confirm("Remove the stored map file? Customers will see the plain background until you upload one again.")) return;
    try {
      data = await Api.del("/api/admin/map/tiles");
      fetchedAt = Date.now();
      if (window.AdminOrderMap) AdminOrderMap.invalidate();
      paint();
      Toast.show("Map file removed", "success");
    } catch (err) {
      Toast.show(err.message || "Could not remove it", "error");
    }
  }

  // ---- uploading the map file ------------------------------------------------------

  async function putPart(upload, index, blob) {
    const token = localStorage.getItem("freshcutz_admin_token");
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${apiBase()}/api/admin/map/tiles/${upload}/parts/${index}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
          body: blob,
        });
        if (res.ok) return;
        if (res.status === 401) throw new Error("Your admin login expired. Sign in again, then upload again.");
        let msg = "Upload failed";
        try { msg = (await res.json()).message || msg; } catch (_) { /* not JSON */ }
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(msg), { fatal: true });
        lastErr = new Error(msg);
      } catch (err) {
        if (err.fatal || /expired/.test(err.message)) throw err;
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw lastErr || new Error("Upload failed");
  }

  // ---- the address-search list (made from the map file, in this browser) --------------------------

  async function sendSearch(version, built) {
    const token = localStorage.getItem("freshcutz_admin_token");
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${apiBase()}/api/admin/map/tiles/${version}/search?count=${built.count}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: built.json,
        });
        if (res.ok) return await res.json();
        let msg = "Could not save the address search";
        try { msg = (await res.json()).message || msg; } catch (_) { /* not JSON */ }
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(msg), { fatal: true });
        lastErr = new Error(msg);
      } catch (err) {
        if (err.fatal) throw err;
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    throw lastErr || new Error("Could not save the address search");
  }

  async function prepareSearch(source, version, say) {
    await DeliveryMap.engine();
    say("Preparing the address search… 0%");
    const built = await MapIndex.build(source, (d, t) => say(`Preparing the address search… ${Math.round((d / t) * 100)}%`));
    if (!built.count) throw new Error("no names were found in this map file");
    say("Saving the address search…");
    data = await sendSearch(version, built);
  }

  async function prepareSearchFromStored() {
    if (uploading || !data || !data.tiles) return;
    uploading = true;
    const prog = root.querySelector("#mpProgress");
    const bar = root.querySelector("#mpBar");
    const text = root.querySelector("#mpProgressText");
    const btn = root.querySelector("#mpIndex");
    if (btn) btn.disabled = true;
    prog.hidden = false;
    bar.style.width = "100%";
    try {
      const url = new URL(apiBase() + data.tiles.url, document.baseURI).href;
      await prepareSearch(url, data.tiles.version, (m) => { text.textContent = m; });
      Toast.show("Address search is ready", "success");
    } catch (err) {
      Toast.show(err.message || "Could not prepare the address search", "error", 7000);
    } finally {
      uploading = false;
      paint();
    }
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file || uploading) return;
    if (!/\.pmtiles$/i.test(file.name)) { Toast.show("Choose a .pmtiles file", "error"); return; }
    if (file.size > MAX_MB * 1024 * 1024) { Toast.show(`That file is ${mb(file.size)} - the limit is ${MAX_MB} MB. Make a smaller area or fewer zoom levels.`, "error", 7000); return; }

    uploading = true;
    const prog = root.querySelector("#mpProgress");
    const bar = root.querySelector("#mpBar");
    const text = root.querySelector("#mpProgressText");
    const btn = root.querySelector("#mpUpload");
    prog.hidden = false;
    btn.disabled = true;
    try {
      const start = await Api.post("/api/admin/map/tiles/start");
      const partSize = start.partSize;
      const total = Math.ceil(file.size / partSize);
      let next = 0;
      let done = 0;
      const show = () => {
        const pct = Math.round((done / total) * 100);
        bar.style.width = pct + "%";
        text.textContent = `Uploading… ${pct}% (${mb(Math.min(file.size, done * partSize))} of ${mb(file.size)}). Keep this page open.`;
      };
      show();
      const worker = async () => {
        while (next < total) {
          const i = next++;
          await putPart(start.upload, i, file.slice(i * partSize, (i + 1) * partSize));
          done++;
          show();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, total) }, worker));
      text.textContent = "Checking the file…";
      data = await Api.post(`/api/admin/map/tiles/${start.upload}/finish`, { size: file.size });
      fetchedAt = Date.now();
      if (window.AdminOrderMap) AdminOrderMap.invalidate();
      Toast.show("Map file uploaded", "success");
      try {
        await prepareSearch(file, start.upload, (m) => { text.textContent = m; });
        Toast.show("Address search is ready", "success");
      } catch (err) {
        Toast.show("The map is uploaded, but the address search could not be prepared: " + (err.message || "error") + ". Use “Prepare the address search now”.", "error", 9000);
      }
    } catch (err) {
      Toast.show(err.message || "Upload failed", "error", 7000);
    } finally {
      uploading = false;
      paint();
    }
  }

  // ---- the delivery-area editor (full screen) ---------------------------------------------------

  function openEditor() {
    const zones = (data.zones || []).map((z) => ({ id: z.id, name: z.name, ring: z.ring.map((p) => [p[0], p[1]]) }));
    const el = document.createElement("div");
    el.className = "mp-editor";
    el.innerHTML = `
      <div class="mp-ed-top">
        <button type="button" class="mp-ed-x" data-a="cancel" aria-label="Close without saving">✕</button>
        <div class="mp-ed-title">Delivery areas</div>
        <button type="button" class="btn btn-gold btn-sm" data-a="save">Save</button>
      </div>
      <div class="mp-ed-map" data-a="map"><div class="mp-ed-loading" data-a="loading"><span class="spinner"></span> Loading map…</div></div>
      <div class="mp-ed-bar" data-a="bar"></div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add("mp-ed-open");
    const q = (n) => el.querySelector(`[data-a="${n}"]`);

    const st = { map: null, zones, selected: null, draft: null, tool: "move", markers: [], dirty: false, saving: false, closed: false, confirmCancel: false };

    const uid = () => "z" + Math.random().toString(36).slice(2, 8);

    function close() {
      if (st.closed) return;
      st.closed = true;
      document.removeEventListener("keydown", onKey);
      st.markers.forEach((m) => m.remove());
      try { st.map && st.map.remove(); } catch (_) { /* gone */ }
      el.remove();
      document.documentElement.classList.remove("mp-ed-open");
    }

    // -- the picture on the map --
    function features() {
      const f = st.zones.map((z) => ({
        type: "Feature",
        properties: { name: z.name, sel: z.id === st.selected ? 1 : 0 },
        geometry: { type: "Polygon", coordinates: [z.ring.concat([z.ring[0]])] },
      }));
      if (st.draft && st.draft.ring.length >= 2) {
        const r = st.draft.ring;
        f.push({
          type: "Feature",
          properties: { name: "", sel: 1 },
          geometry: r.length >= 3 ? { type: "Polygon", coordinates: [r.concat([r[0]])] } : { type: "LineString", coordinates: r },
        });
      }
      return { type: "FeatureCollection", features: f };
    }

    function redraw() {
      const src = st.map && st.map.getSource("zones");
      if (src) src.setData(features());
    }

    function editingRing() {
      if (st.draft) return st.draft.ring;
      const z = st.zones.find((x) => x.id === st.selected);
      return z ? z.ring : null;
    }

    function rebuildMarkers() {
      st.markers.forEach((m) => m.remove());
      st.markers = [];
      const ring = editingRing();
      if (!ring || !st.map) return;
      ring.forEach((p, i) => {
        const dot = document.createElement("div");
        dot.className = "mp-vtx" + (st.draft && i === 0 ? " is-first" : "");
        const m = new maplibregl.Marker({ element: dot, draggable: st.tool === "move" || st.draft }).setLngLat(p).addTo(st.map);
        m.on("drag", () => { const ll = m.getLngLat(); ring[i] = [ll.lng, ll.lat]; st.dirty = true; redraw(); });
        m.on("dragend", () => { const ll = m.getLngLat(); ring[i] = [ll.lng, ll.lat]; st.dirty = true; redraw(); });
        dot.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (st.draft) return;
          if (st.tool === "remove") {
            if (ring.length <= 3) { Toast.show("An area needs at least 3 points", "error"); return; }
            ring.splice(i, 1);
            st.dirty = true;
            rebuildMarkers();
            redraw();
            paintBar();
          }
        });
        st.markers.push(m);
      });
    }

    // -- the toolbar at the bottom --
    function paintBar() {
      const bar = q("bar");
      const z = st.zones.find((x) => x.id === st.selected);
      if (st.draft) {
        const n = st.draft.ring.length;
        bar.innerHTML = `
          <div class="mp-ed-hint">Tap the map to add the corners of the area (${n} so far). Drag a corner to move it.</div>
          <input class="mp-ed-name" data-a="name" placeholder="Name, e.g. Gachibowli" value="${esc(st.draft.name)}" maxlength="60" />
          <div class="mp-ed-btns">
            <button type="button" class="btn btn-ghost btn-sm" data-a="undo" ${n ? "" : "disabled"}>↶ Undo point</button>
            <button type="button" class="btn btn-ghost btn-sm" data-a="discard">Cancel</button>
            <button type="button" class="btn btn-gold btn-sm" data-a="finish" ${n >= 3 ? "" : "disabled"}>Finish area</button>
          </div>`;
      } else if (z) {
        bar.innerHTML = `
          <div class="mp-ed-seg" role="tablist">
            <button type="button" class="${st.tool === "move" ? "on" : ""}" data-tool="move">Move</button>
            <button type="button" class="${st.tool === "add" ? "on" : ""}" data-tool="add">Add point</button>
            <button type="button" class="${st.tool === "remove" ? "on" : ""}" data-tool="remove">Remove point</button>
          </div>
          <div class="mp-ed-hint">${{ move: "Drag the white dots to reshape the area.", add: "Tap next to an edge to add a corner there.", remove: "Tap a dot to remove that corner." }[st.tool]}</div>
          <input class="mp-ed-name" data-a="name" value="${esc(z.name)}" maxlength="60" />
          <div class="mp-ed-btns">
            <button type="button" class="btn btn-ghost btn-sm mp-danger" data-a="delete">🗑 Delete area</button>
            <button type="button" class="btn btn-gold btn-sm" data-a="done">Done</button>
          </div>`;
      } else {
        bar.innerHTML = `
          <div class="mp-ed-hint">${st.zones.length ? "Tap an area on the map or in the list to change its shape, or draw a new one." : "Draw the first area you deliver to."}</div>
          ${st.zones.length ? `<div class="mp-ed-list">${st.zones.map((x) => `<button type="button" class="mp-ed-item" data-zone="${esc(x.id)}"><span class="mp-zone-dot"></span><span class="mp-zone-name">${esc(x.name)}</span><span class="mp-zone-n">${x.ring.length} points</span></button>`).join("")}</div>` : ""}
          <div class="mp-ed-btns">
            <button type="button" class="btn btn-gold btn-sm" data-a="new">＋ New area</button>
          </div>
          <ol class="mp-ed-how"><li>Press <b>New area</b> and give it a name.</li><li>Click the map to drop a corner at a time around the place you deliver to (at least 3). Drag a corner to move it.</li><li>Press <b>Finish area</b>, then <b>Save</b> at the top.</li></ol>`;
      }
      q("map").classList.toggle("is-drawing", !!st.draft || (!!z && st.tool === "add"));
      const name = bar.querySelector('[data-a="name"]');
      if (name) name.addEventListener("input", () => {
        const target = st.draft || st.zones.find((x) => x.id === st.selected);
        if (target) { target.name = name.value; st.dirty = true; redraw(); }
      });
    }

    {
      q("bar").addEventListener("click", (e) => {
        const tool = e.target.closest("[data-tool]");
        if (tool) { st.tool = tool.dataset.tool; rebuildMarkers(); paintBar(); return; }
        const pick = e.target.closest("[data-zone]");
        if (pick) {
          const z = st.zones.find((x) => x.id === pick.dataset.zone);
          if (!z) return;
          st.selected = z.id;
          st.tool = "move";
          rebuildMarkers(); paintBar(); redraw();
          const b = DeliveryMap.zonesBounds([z]);
          if (b && st.map) st.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, maxZoom: 16, duration: 500 });
          return;
        }
        const a = e.target.closest("[data-a]");
        if (!a) return;
        const act = a.dataset.a;
        if (act === "new") { st.selected = null; st.draft = { id: uid(), name: "", ring: [] }; st.tool = "move"; rebuildMarkers(); paintBar(); redraw(); }
        else if (act === "undo" && st.draft) { st.draft.ring.pop(); rebuildMarkers(); paintBar(); redraw(); }
        else if (act === "discard") { st.draft = null; rebuildMarkers(); paintBar(); redraw(); }
        else if (act === "finish" && st.draft && st.draft.ring.length >= 3) {
          const name = (st.draft.name || "").trim() || `Area ${st.zones.length + 1}`;
          st.zones.push({ id: st.draft.id, name, ring: st.draft.ring });
          st.selected = st.draft.id;
          st.draft = null;
          st.dirty = true;
          st.tool = "move";
          rebuildMarkers(); paintBar(); redraw();
        }
        else if (act === "done") { st.selected = null; rebuildMarkers(); paintBar(); redraw(); }
        else if (act === "delete") {
          st.zones = st.zones.filter((x) => x.id !== st.selected);
          st.selected = null;
          st.dirty = true;
          rebuildMarkers(); paintBar(); redraw();
        }
      });
    }

    q("cancel").addEventListener("click", () => {
      if (st.dirty && !st.confirmCancel) {
        st.confirmCancel = true;
        q("cancel").textContent = "Discard?";
        q("cancel").classList.add("is-warn");
        setTimeout(() => { st.confirmCancel = false; q("cancel").textContent = "✕"; q("cancel").classList.remove("is-warn"); }, 3500);
        Toast.show("You have unsaved changes. Tap again to discard them, or Save.", "info", 3500);
        return;
      }
      close();
    });

    const onKey = (e) => {
      if (e.key !== "Escape" || st.closed) return;
      if (st.draft) { st.draft = null; rebuildMarkers(); paintBar(); redraw(); return; }
      if (st.selected) { st.selected = null; rebuildMarkers(); paintBar(); redraw(); return; }
      q("cancel").click();
    };
    document.addEventListener("keydown", onKey);

    q("save").addEventListener("click", async () => {
      if (st.saving) return;
      if (st.draft) { Toast.show("Finish or cancel the area you are drawing first", "error"); return; }
      st.saving = true;
      const btn = q("save");
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        data = await Api.put("/api/admin/map", { zones: st.zones });
        if (window.AdminOrderMap) AdminOrderMap.reset(); // the Orders tab compares against the new areas
        Toast.show("Delivery areas saved", "success");
        close();
        paint();
      } catch (err) {
        Toast.show(err.message || "Could not save", "error", 5000);
        st.saving = false;
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });

    // -- the map itself --
    (async () => {
      try {
        await DeliveryMap.engine();
        if (st.closed) return;
        const bounds = DeliveryMap.zonesBounds(st.zones);
        const centre = bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : DeliveryMap.HYDERABAD;
        const map = new maplibregl.Map({
          container: q("map"),
          style: DeliveryMap.styleFor(data.tiles),
          center: centre,
          zoom: 11.5,
          minZoom: 6,
          maxZoom: 19,
          attributionControl: false,
          dragRotate: false,
          touchPitch: false,
          fadeDuration: 0,
        });
        st.map = map;
        map.touchZoomRotate.disableRotation();
        map.doubleClickZoom.disable(); // two quick taps while drawing must add two corners, not zoom
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => {
          if (st.closed) return;
          map.addSource("zones", { type: "geojson", data: features() });
          map.addLayer({ id: "z-fill", type: "fill", source: "zones", paint: { "fill-color": ["case", ["==", ["get", "sel"], 1], "#c9a13b", "#c9a13b"], "fill-opacity": ["case", ["==", ["get", "sel"], 1], 0.3, 0.16] } });
          map.addLayer({ id: "z-line", type: "line", source: "zones", paint: { "line-color": "#9c7a26", "line-width": ["case", ["==", ["get", "sel"], 1], 3.2, 2] } });
          map.addLayer({ id: "z-label", type: "symbol", source: "zones", filter: ["!=", ["get", "name"], ""], layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 13 }, paint: { "text-color": "#17140f", "text-halo-color": "#fff", "text-halo-width": 1.6 } });
          if (bounds) map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 50, animate: false, maxZoom: 15 });
          q("loading").remove();
          paintBar();
        });
        map.on("click", (e) => {
          const pt = [e.lngLat.lng, e.lngLat.lat];
          if (st.draft) { st.draft.ring.push(pt); st.dirty = true; rebuildMarkers(); paintBar(); redraw(); return; }
          const sel = st.zones.find((x) => x.id === st.selected);
          if (sel && st.tool === "add") { insertPoint(sel.ring, pt); st.dirty = true; rebuildMarkers(); paintBar(); redraw(); return; }
          // select the area under the tap (the smallest one when areas overlap), or nothing
          const hit = st.zones.filter((z) => DeliveryMap.zoneAt([z], pt[1], pt[0])).sort((a, b) => area(a.ring) - area(b.ring))[0];
          st.selected = hit ? hit.id : null;
          st.tool = "move";
          rebuildMarkers(); paintBar(); redraw();
        });
      } catch (err) {
        const l = q("loading");
        if (l) l.textContent = err.message || "Could not open the map";
      }
    })();
  }

  /** Adds a corner at {@code pt}, between the two corners whose edge is nearest to it. */
  function insertPoint(ring, pt) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const d = distToSegment(pt, a, b);
      if (d < bestD) { bestD = d; best = i; }
    }
    ring.splice(best + 1, 0, pt);
  }

  function distToSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx, y = a[1] + t * dy;
    return Math.hypot(p[0] - x, p[1] - y);
  }

  /** Rough size of a ring (for picking the smaller of two overlapping areas). */
  function area(ring) {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return Math.abs(s / 2);
  }

  return { refresh };
})();
