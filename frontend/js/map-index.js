/* Builds the "address search" list from the offline map file - in the admin's browser, once per map upload.
 *
 * Customers can type an area, a street or a landmark in the map's search box. There is no outside search service, so the
 * list they search is made from the map itself: the names of the places, streets and landmarks that are drawn in it, each with
 * a position. This file reads the map's most detailed tiles (a tile is a small vector picture of one square of the city),
 * collects those names and returns them as compact JSON. The admin page stores that JSON in the shop's own database.
 *
 * Needs the pmtiles library (the map engine loader brings it). */

window.MapIndex = (() => {
  "use strict";

  const MAX_ITEMS = 24000;
  const SKIP_PLACE = new Set(["country", "region", "county", "macroregion"]);
  const SKIP_POI = new Set(["bench", "bicycle_parking", "parking", "toilets", "drinking_water", "waste_basket", "post_box", "atm", "bus_stop", "tram_stop", "recycling", "picnic_table", "shelter"]);
  const SKIP_ROAD = new Set(["path", "other", "rail", "ferry"]);

  // ---- a very small reader for Mapbox vector tiles (protobuf) -------------------------

  function reader(buf) {
    return { buf, pos: 0, end: buf.length };
  }
  function varint(r) {
    let v = 0, mul = 1, b;
    do {
      b = r.buf[r.pos++];
      v += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80 && r.pos < r.end);
    return v;
  }
  function skip(r, wire) {
    if (wire === 0) varint(r);
    else if (wire === 1) r.pos += 8;
    else if (wire === 2) r.pos += varint(r);
    else if (wire === 5) r.pos += 4;
    else throw new Error("bad map tile");
  }
  const td = new TextDecoder();
  function str(r) {
    const n = varint(r);
    const s = td.decode(r.buf.subarray(r.pos, r.pos + n));
    r.pos += n;
    return s;
  }
  function sub(r) {
    const n = varint(r);
    const s = { buf: r.buf, pos: r.pos, end: r.pos + n };
    r.pos += n;
    return s;
  }

  function readValue(r) { // only text values matter here
    let out = null;
    while (r.pos < r.end) {
      const key = varint(r), field = key >> 3, wire = key & 7;
      if (field === 1 && wire === 2) out = str(r);
      else skip(r, wire);
    }
    return out;
  }

  function readFeature(r) {
    const f = { tags: [], type: 0, geom: [] };
    while (r.pos < r.end) {
      const key = varint(r), field = key >> 3, wire = key & 7;
      if (field === 2 && wire === 2) { const s = sub(r); while (s.pos < s.end) f.tags.push(varint(s)); }
      else if (field === 3 && wire === 0) f.type = varint(r);
      else if (field === 4 && wire === 2) { const s = sub(r); while (s.pos < s.end) f.geom.push(varint(s)); }
      else skip(r, wire);
    }
    return f;
  }

  function readLayer(r) {
    const l = { name: "", keys: [], values: [], features: [], extent: 4096 };
    while (r.pos < r.end) {
      const key = varint(r), field = key >> 3, wire = key & 7;
      if (field === 1 && wire === 2) l.name = str(r);
      else if (field === 2 && wire === 2) l.features.push(readFeature(sub(r)));
      else if (field === 3 && wire === 2) l.keys.push(str(r));
      else if (field === 4 && wire === 2) l.values.push(readValue(sub(r)));
      else if (field === 5 && wire === 0) l.extent = varint(r);
      else skip(r, wire);
    }
    return l;
  }

  function readTile(bytes) {
    const r = reader(bytes);
    const layers = {};
    while (r.pos < r.end) {
      const key = varint(r), field = key >> 3, wire = key & 7;
      if (field === 3 && wire === 2) { const l = readLayer(sub(r)); layers[l.name] = l; }
      else skip(r, wire);
    }
    return layers;
  }

  /** Point features: the first point. Line features: the middle vertex of the longest piece. Others: nothing. */
  function geometryPoint(f) {
    const g = f.geom;
    const parts = [];
    let cur = null, x = 0, y = 0, i = 0;
    while (i < g.length) {
      const cmd = g[i] & 7, count = g[i] >> 3;
      i++;
      if (cmd === 1 || cmd === 2) {
        for (let k = 0; k < count; k++) {
          const dx = g[i++], dy = g[i++];
          x += (dx >> 1) ^ -(dx & 1);
          y += (dy >> 1) ^ -(dy & 1);
          if (cmd === 1) { cur = []; parts.push(cur); }
          if (cur) cur.push([x, y]);
        }
      }
    }
    if (!parts.length) return null;
    if (f.type === 1) return parts[0][0];
    if (f.type === 2) {
      let best = parts[0];
      for (const p of parts) if (p.length > best.length) best = p;
      return best[Math.floor(best.length / 2)];
    }
    return null;
  }

  function props(layer, f) {
    const out = {};
    for (let i = 0; i + 1 < f.tags.length; i += 2) {
      const v = layer.values[f.tags[i + 1]];
      if (typeof v === "string") out[layer.keys[f.tags[i]]] = v;
    }
    return out;
  }

  function lngLat(z, tx, ty, px, py, extent) {
    const n = Math.pow(2, z);
    const lng = ((tx + px / extent) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / extent)) / n))) * 180) / Math.PI;
    return [lng, lat];
  }

  const lon2x = (lon, z) => Math.min((1 << z) - 1, Math.max(0, Math.floor(((lon + 180) / 360) * (1 << z))));
  const lat2y = (lat, z) => {
    const r = (lat * Math.PI) / 180;
    return Math.min((1 << z) - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z))));
  };

  // ---- the list --------------------------------------------------------------------------

  /** @param source a File (the map file just chosen) or the address of a stored map file
   *  @param onProgress (done, total) => void
   *  @returns {Promise<{json: string, count: number}>} */
  async function build(source, onProgress) {
    if (typeof pmtiles === "undefined") throw new Error("The map engine is not loaded");
    const archive = new pmtiles.PMTiles(typeof source === "string" ? source : new pmtiles.FileSource(source));
    const header = await archive.getHeader();
    const z = Math.min(header.maxZoom, 15);
    const x0 = lon2x(header.minLon, z), x1 = lon2x(header.maxLon, z);
    const y0 = lat2y(header.maxLat, z), y1 = lat2y(header.minLat, z);
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);

    const kinds = [];
    const kindIdx = new Map();
    const kindOf = (k) => {
      if (!kindIdx.has(k)) { kindIdx.set(k, kinds.length); kinds.push(k); }
      return kindIdx.get(k);
    };
    const seen = new Set();
    const items = []; // [name, type(0 place, 1 street, 2 landmark), kind, lng, lat]

    const add = (name, type, kind, ll) => {
      if (!name || !/[A-Za-z]/.test(name) || name.length > 70) return;
      // the same name within ~1 km is one entry (a street is cut into many tiles)
      const cell = type === 0 ? 0.004 : type === 1 ? 0.012 : 0.003;
      const key = type + "|" + name.toLowerCase() + "|" + Math.round(ll[0] / cell) + "|" + Math.round(ll[1] / cell);
      if (seen.has(key)) return;
      seen.add(key);
      items.push([name, type, kindOf(kind || ""), Math.round(ll[0] * 1e5) / 1e5, Math.round(ll[1] * 1e5) / 1e5]);
    };

    let next = 0, done = 0, failed = null;
    const worker = async () => {
      while (!failed) {
        const i = next++;
        if (i >= jobs.length) return;
        const [tx, ty] = jobs[i];
        try {
          const res = await archive.getZxy(z, tx, ty);
          if (res && res.data && res.data.byteLength) {
            const layers = readTile(new Uint8Array(res.data));
            for (const lname of ["places", "roads", "pois"]) {
              const layer = layers[lname];
              if (!layer) continue;
              for (const f of layer.features) {
                const p = props(layer, f);
                const name = p["name:en"] || p.name;
                if (!name) continue;
                const kind = p.kind || "";
                if (lname === "places" && SKIP_PLACE.has(kind)) continue;
                if (lname === "pois" && SKIP_POI.has(kind)) continue;
                if (lname === "roads" && SKIP_ROAD.has(kind)) continue;
                const pt = geometryPoint(f);
                if (!pt) continue;
                const ll = lngLat(z, tx, ty, pt[0], pt[1], layer.extent);
                add(name, lname === "places" ? 0 : lname === "roads" ? 1 : 2, lname === "roads" ? p.kind_detail || kind : kind, ll);
              }
            }
          }
        } catch (e) {
          failed = e;
          return;
        }
        done++;
        if (onProgress && (done % 10 === 0 || done === jobs.length)) onProgress(done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    if (failed) throw failed;

    // keep the list a sensible size: places first, then streets, then landmarks
    let list = items;
    if (list.length > MAX_ITEMS) {
      list = items.filter((r) => r[1] === 0).concat(items.filter((r) => r[1] === 1), items.filter((r) => r[1] === 2)).slice(0, MAX_ITEMS);
    }
    const json = JSON.stringify({ v: 1, kinds, items: list });
    return { json, count: list.length };
  }

  return { build, readTile };
})();
