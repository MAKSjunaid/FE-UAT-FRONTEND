/* The opening animation: for a few seconds after the customer website is opened, a dark brand screen shows the logo
 * with soft smoke drifting in from the left and the right. Everything about it (on/off, how long, how fast, which
 * picture) is set by the admin in Customize and arrives with the site settings.
 *
 *  - It starts the moment this script runs (right at the top of <body>), using the settings saved from the last
 *    visit; the site loads behind it, so it never delays anything.
 *  - The smoke is drawn on two small canvases (half resolution - smoke is soft anyway) from a handful of cloud-like
 *    pictures made once at the start. It stops, and everything is freed, when the screen closes.
 *  - A tap or Esc closes it early. With "reduce motion" switched on in the phone, there is no moving smoke.
 *  - Inside the admin's live preview it never plays on its own; the admin's "Play it now" button calls FCSplash.play(). */

(() => {
  "use strict";

  const CACHE_KEY = "freshcutz_site_v2";
  const DEFAULT_LOGO = "images/logo.jpg";
  const root = document.documentElement;

  let inPreview = false;
  try {
    inPreview = window.parent !== window && /[?&]preview=1(&|$)/.test(location.search);
  } catch (e) {
    inPreview = false;
  }

  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /** What the splash needs from a copy of the site settings ({config, logoUrl}). */
  function settingsOf(site) {
    const c = (site && site.config) || {};
    const own = typeof c.splashImageUrl === "string" && c.splashImageUrl ? c.splashImageUrl : null;
    const logo = site && typeof site.logoUrl === "string" && site.logoUrl ? site.logoUrl : null;
    return {
      on: c.showSplash !== false,
      seconds: clamp(num(c.splashSeconds, 3), 1, 10),
      speed: clamp(num(c.splashSpeed, 100), 50, 200) / 100,
      image: own || logo, // null = the built-in logo
      framed: !(own || logo),
    };
  }

  function readCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return saved && saved.site && saved.site.config ? saved.site : null;
    } catch (e) {
      return null;
    }
  }

  // ---- smoke pictures ------------------------------------------------------------------------------
  function hash(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, seed);
    const b = hash(ix + 1, iy, seed);
    const c = hash(ix, iy + 1, seed);
    const d = hash(ix + 1, iy + 1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, seed) {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < 4; i++) {
      sum += amp * vnoise(x * f, y * f, seed + i * 31);
      amp *= 0.5;
      f *= 2;
    }
    return sum / 0.9375;
  }

  /** A few soft, wispy cloud puffs (white-grey, one warm gold) drawn once and reused for every particle. */
  function makeSprites() {
    const N = 80;
    const out = [];
    for (let s = 0; s < 4; s++) {
      const c = document.createElement("canvas");
      c.width = c.height = N;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(N, N);
      const seed = 11 + s * 53;
      const tint = s === 3 ? [238, 206, 122] : [236, 231, 222];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const u = ((x + 0.5) / N) * 2 - 1;
          const v = ((y + 0.5) / N) * 2 - 1;
          const d2 = u * u + v * v;
          const i = (y * N + x) * 4;
          if (d2 >= 1) continue;
          const fall = Math.pow(1 - d2, 1.7);
          const px = (x / N) * 3.4;
          const py = (y / N) * 3.4;
          // the coordinates are bent by a second noise so the edges curl like real smoke
          const w = fbm(px + 7.3, py + 1.9, seed + 5);
          const n = fbm(px + 1.6 * w, py + 1.6 * w, seed);
          const a = clamp(0.3 * fall * fall + (n - 0.3) * 1.9 * fall, 0, 1);
          const shade = 0.8 + 0.2 * n;
          img.data[i] = tint[0] * shade;
          img.data[i + 1] = tint[1] * shade;
          img.data[i + 2] = tint[2] * shade;
          img.data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      out.push(c);
    }
    return out;
  }

  // ---- the screen ----------------------------------------------------------------------------------
  let active = null;

  function play(opts) {
    if (active) active.destroy();
    let st = opts.settings;
    const forced = !!opts.forced;
    const host = opts.host || document.body;
    let known = opts.known !== false;
    const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    const el = document.createElement("div");
    el.className = "fc-splash";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<div class="fc-glow"></div><canvas class="fc-back"></canvas>' +
      '<div class="fc-stage"><div class="fc-logo"><img alt="" decoding="async" draggable="false"></div></div>' +
      '<canvas class="fc-front"></canvas>';
    host.insertBefore(el, host.firstChild);
    root.classList.remove("fc-splash-pre"); // the screen itself now covers the page

    const logoBox = el.querySelector(".fc-logo");
    const img = el.querySelector("img");
    const back = el.querySelector(".fc-back");
    const front = el.querySelector(".fc-front");
    const bctx = back.getContext("2d");
    const fctx = front.getContext("2d");

    const t0 = performance.now();
    let ended = false;
    let outStarted = false;
    let raf = 0;
    let fadeTimer = 0;
    let endTimer = 0;
    let knownTimer = 0;
    let shown = false;
    let shownSrc = null;
    let triedDefault = false;
    let W = 0;
    let H = 0;
    const CS = 0.5; // canvas pixels per screen pixel
    let sprites = null;
    let particles = [];
    let accL = 0;
    let accR = 0;
    let frameNo = 0;
    let lastT = 0;
    let slowFrames = 0;
    let density = 1;

    function size() {
      W = el.clientWidth || window.innerWidth;
      H = el.clientHeight || window.innerHeight;
      for (const c of [back, front]) {
        c.width = Math.max(2, Math.round(W * CS));
        c.height = Math.max(2, Math.round(H * CS));
      }
    }

    // -- picture --
    function apiBase() {
      return typeof window.FRESHCUTZ_API_BASE === "string" ? window.FRESHCUTZ_API_BASE : null;
    }
    function reveal() {
      if (shown || ended) return;
      shown = true;
      el.classList.add("show");
    }
    function setImage() {
      if (ended) return;
      logoBox.classList.toggle("framed", st.framed);
      let src = DEFAULT_LOGO;
      if (st.image && !triedDefault) {
        const base = apiBase();
        if (base === null) {
          // config.js (which knows the API address) runs a little later - try again once the page has loaded
          document.addEventListener("DOMContentLoaded", setImage, { once: true });
          return;
        }
        src = base + st.image;
      }
      if (src === shownSrc) return;
      shownSrc = src;
      img.onload = () => {
        const done = () => reveal();
        if (img.decode) img.decode().then(done, done);
        else done();
      };
      img.onerror = () => {
        if (shownSrc !== DEFAULT_LOGO) {
          triedDefault = true;
          st = { ...st, framed: true };
          setImage();
        } else {
          reveal();
        }
      };
      img.src = src;
    }

    // -- timing --
    function total() {
      return reduced ? Math.min(st.seconds, 2.5) : st.seconds;
    }
    function startOut(fade) {
      if (outStarted || ended) return;
      outStarted = true;
      el.style.setProperty("--fc-out", fade.toFixed(2) + "s");
      el.classList.add("out");
    }
    function schedule() {
      clearTimeout(fadeTimer);
      clearTimeout(endTimer);
      const secs = total();
      const fade = Math.min(0.5, secs * 0.28);
      const now = performance.now();
      fadeTimer = setTimeout(() => startOut(fade), Math.max(0, t0 + (secs - fade) * 1000 - now));
      endTimer = setTimeout(destroy, Math.max(0, t0 + secs * 1000 - now) + 120);
    }
    function applySettings() {
      const k = st.speed;
      el.style.setProperty("--fc-in", (0.9 / k).toFixed(2) + "s");
      el.style.setProperty("--fc-pulse", (2.6 / k).toFixed(2) + "s");
      setImage();
      schedule();
    }

    // -- smoke --
    function spawn(dirn) {
      const m = Math.min(W, H);
      particles.push({
        dir: dirn,
        x: dirn > 0 ? -W * 0.1 : W * 1.1,
        y: H * (0.5 + (Math.random() - 0.5) * 0.55) + H * 0.04,
        vx0: W * (0.15 + Math.random() * 0.13),
        ph: Math.random() * 6.28,
        ph2: Math.random() * 6.28,
        f1: 1.3 + Math.random() * 1.4,
        f2: 0.9 + Math.random() * 1.2,
        life: 2.6 + Math.random() * 1.4,
        age: 0,
        r0: m * (0.16 + Math.random() * 0.14),
        rot: Math.random() * 6.28,
        rv: (Math.random() - 0.5) * 0.7,
        spr: Math.random() < 0.2 ? 3 : (Math.random() * 3) | 0,
        peak: 0.16 + Math.random() * 0.16,
        front: Math.random() < 0.22,
      });
    }
    /** ds = smoke-seconds (real seconds x the speed setting). */
    function step(ds) {
      const rate = 15 * density;
      accL += rate * ds;
      accR += rate * ds;
      while (accL >= 1 && particles.length < 130) {
        accL -= 1;
        spawn(1);
      }
      while (accR >= 1 && particles.length < 130) {
        accR -= 1;
        spawn(-1);
      }
      accL = Math.min(accL, 1);
      accR = Math.min(accR, 1);
      const cx = W / 2;
      const cy = H / 2;
      let w = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.age += ds;
        const frac = p.age / p.life;
        if (frac >= 1) continue;
        const dist = Math.abs(p.x - cx);
        const slow = 0.35 + 0.65 * clamp(dist / (W * 0.3), 0, 1); // it slows down and curls up where the two sides meet
        const vx = p.dir * p.vx0 * slow + Math.cos(p.age * p.f2 + p.ph2) * 14;
        const vy = -(6 + 30 * frac) + Math.sin(p.age * p.f1 + p.ph) * 34 + (cy - p.y) * 0.35;
        p.x += vx * ds;
        p.y += vy * ds;
        p.rot += p.rv * ds;
        particles[w++] = p;
      }
      particles.length = w;
    }
    function draw() {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, back.width, back.height);
      fctx.clearRect(0, 0, front.width, front.height);
      const cx = W / 2;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const frac = p.age / p.life;
        const env = smooth(0, 0.18, frac) * (1 - smooth(0.55, 1, frac));
        if (env <= 0.01) continue;
        const near = 1 - clamp(Math.abs(p.x - cx) / (W * 0.28), 0, 1);
        const a = p.peak * env * (1 + 0.5 * near) * (p.front ? 0.55 : 1);
        const s = 2 * p.r0 * (0.55 + 1.45 * frac);
        const ctx = p.front ? fctx : bctx;
        const cos = Math.cos(p.rot) * CS;
        const sin = Math.sin(p.rot) * CS;
        ctx.globalAlpha = Math.min(a, 0.55);
        ctx.setTransform(cos, sin, -sin, cos, p.x * CS, p.y * CS);
        ctx.drawImage(sprites[p.spr], -s / 2, -s / 2, s, s);
      }
    }
    function frame(now) {
      if (ended) return;
      raf = requestAnimationFrame(frame);
      frameNo++;
      if (frameNo === 1) return; // let the first paint of the dark screen happen before any work
      if (!sprites) {
        sprites = makeSprites();
        for (let i = 0; i < 24; i++) step(0.05); // already some smoke in view when the logo appears
        lastT = now;
        return;
      }
      const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
      lastT = now;
      if (dt > 0.045) {
        if (++slowFrames > 12) density = 0.5; // an old phone: half the smoke keeps it smooth
      } else {
        slowFrames = 0;
      }
      step(dt * st.speed);
      draw();
    }

    function destroy() {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      clearTimeout(fadeTimer);
      clearTimeout(endTimer);
      clearTimeout(knownTimer);
      window.removeEventListener("resize", size);
      document.removeEventListener("keydown", onKey);
      particles = [];
      sprites = null;
      back.width = back.height = front.width = front.height = 0;
      if (el.parentNode) el.parentNode.removeChild(el);
      root.classList.remove("fc-splash-pre");
      if (active === ctl) active = null;
    }
    function skip() {
      startOut(0.25);
      clearTimeout(endTimer);
      endTimer = setTimeout(destroy, 300);
    }
    function onKey(e) {
      if (e.key === "Escape") skip();
    }

    const ctl = {
      forced,
      destroy,
      update(next) {
        if (ended) return;
        known = true;
        clearTimeout(knownTimer);
        if (!next.on && !forced) {
          st = next;
          skip();
          return;
        }
        st = next;
        applySettings();
      },
    };

    size();
    window.addEventListener("resize", size);
    el.addEventListener("pointerdown", skip);
    document.addEventListener("keydown", onKey);

    if (known) {
      applySettings();
    } else {
      // first ever visit: the settings are not known yet. Show the smoke and wait (briefly) for them before the
      // logo appears, so the right picture is shown from the start.
      el.style.setProperty("--fc-in", (0.9 / st.speed).toFixed(2) + "s");
      schedule();
      knownTimer = setTimeout(() => {
        known = true;
        setImage();
      }, 1200);
    }
    if (!reduced) raf = requestAnimationFrame(frame);
    active = ctl;
    return ctl;
  }

  window.FCSplash = { play, settingsOf };

  // Only the customer website opens with it (this file is also loaded in the admin app, which just uses play() for "Play it now").
  if (inPreview || !document.body || !document.body.classList.contains("storefront")) {
    root.classList.remove("fc-splash-pre");
    return;
  }

  const site = readCache();
  const first = settingsOf(site);
  if (site && !first.on) {
    root.classList.remove("fc-splash-pre");
  } else if (document.body) {
    play({ settings: first, known: !!site });
    // fresh settings arrive (or change) a moment later: follow them
    document.addEventListener("freshcutz:site", () => {
      if (!active || active.forced) return;
      const sc = window.SiteCustomize;
      const cfg = sc && sc.cfg && sc.cfg();
      if (!cfg) return;
      active.update(settingsOf({ config: cfg, logoUrl: sc.logoUrl && sc.logoUrl() }));
    });
  }
})();
