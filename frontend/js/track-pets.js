/* A tiny hen and egg that play along the top edge of the opened "Track order" panel - a bit like the VS Code pets: the hen walks left and
 * right, stops, pecks; the egg rolls, hops and follows her; now and then she chases it and gives it a kick.
 *
 * They stand ON the panel's top edge, outside it, with no background. Only runs while the panel is opened out (nothing moves, and nothing is drawn each frame, while it is folded). Off when the phone is set
 * to reduce motion, in calm mode, or when the admin switched the shop's animations off. They never take a tap (pointer-events: none).
 * Pairs with css/track-pets.css. To remove: delete both files and their two lines in index.html. */
(() => {
  const trk = document.getElementById("trackBar");
  if (!trk) return;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || window.FC_CALM) return;
  const allowed = () => { try { return !window.SiteCustomize || SiteCustomize.on("showTrackPets"); } catch (e) { return true; } }; // admin Customize switch (default on)
  const animationsOff = () => {
    try { const c = window.SiteCustomize && SiteCustomize.cfg && SiteCustomize.cfg(); return !!(c && c.animationsOff === true); } catch (e) { return false; }
  };

  // the little song (three floating notes, CSS only, running only while she sings - see css/track-pets.css)
  const NOTE1 = (c) => '<svg viewBox="0 0 10 12"><g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.6 9.2V1.4c.8 1.6 3.2 2 3.2 4.6"/><ellipse cx="3.3" cy="9.6" rx="2.4" ry="1.8" transform="rotate(-20 3.3 9.6)"/></g><path d="M5.6 9.2V1.4c.8 1.6 3.2 2 3.2 4.6" fill="none" stroke="' + c + '" stroke-width="1.15" stroke-linecap="round"/><ellipse cx="3.3" cy="9.6" rx="2.4" ry="1.8" transform="rotate(-20 3.3 9.6)" fill="' + c + '"/></svg>';
  const NOTE2 = (c) => '<svg viewBox="0 0 14 12"><g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.4 9.2V2.2l7-1.4v7.4M5.4 4.4l7-1.4"/><ellipse cx="3.1" cy="9.6" rx="2.4" ry="1.8" transform="rotate(-20 3.1 9.6)"/><ellipse cx="10.1" cy="8.6" rx="2.4" ry="1.8" transform="rotate(-20 10.1 8.6)"/></g><path d="M5.4 9.2V2.2l7-1.4v7.4M5.4 4.4l7-1.4" fill="none" stroke="' + c + '" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="3.1" cy="9.6" rx="2.4" ry="1.8" transform="rotate(-20 3.1 9.6)" fill="' + c + '"/><ellipse cx="10.1" cy="8.6" rx="2.4" ry="1.8" transform="rotate(-20 10.1 8.6)" fill="' + c + '"/></svg>';
  const SONG_HTML = '<div class="pt-song" aria-hidden="true"><i>' + NOTE1("#d9467a") + "</i><i>" + NOTE2("#2f86d6") + "</i><i>" + NOTE1("#e28a12") + "</i></div>";
  const songEnded = (e) => !!(e.target && e.target.matches && e.target.matches(".pt-song i:last-child")); // (the last note has floated away: the song is over)
  // The little dance that goes with the song (poses change 10 times a second, so it is a chunky 6-step beat of 0.6 s): a hop on every beat, a sway from side to side every
  // two beats, the legs stepping in place, the wing fluttering and the tail wagging. k = how far into the dance she is (0..1, eased), f = the frame count (+ her own offset).
  const danceOf = (f, k) => { const b = f % 6, h = Math.floor(f / 6) & 1;
    return { hop: [0, 1, 2, 1, 0, 0][b] * k, sway: 6 * Math.sin(f * Math.PI / 6) * k, leg: (h ? 18 : -18) * k, wing: b === 1 || b === 2, wag: (b < 3 ? 9 : -9) * k, nod: 3 * Math.sin(f * Math.PI / 3) * k }; };
  const SING_HEAD = 26, SING_LEAN = 5; // (singing: how far the head lifts up, and how far she leans back, in degrees)
  const HEN_W = 26, EGG_W = 12, G = 260; // sizes in px; gravity in px/s^2
  const HEN_SVG =
    "<svg viewBox=\"0 0 28 26\" aria-hidden=\"true\" focusable=\"false\">" +
    "<defs><clipPath id=\"ptbc\"><ellipse cx=\"13.6\" cy=\"15\" rx=\"9\" ry=\"6.6\"/></clipPath></defs>" +
    "<g class=\"pt-all\">" +
    "<g class=\"pt-leg pt-l1\"><path d=\"M11.6 20v4.2M10 24.8l1.6-.9 1.6.9\" fill=\"none\" stroke=\"#e8921a\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>" +
    "<g class=\"pt-leg pt-l2\"><path d=\"M15.8 20v4.2M14.2 24.8l1.6-.9 1.6.9\" fill=\"none\" stroke=\"#e8921a\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>" +
    "<g class=\"pt-tail\" fill=\"#f6e6c2\" stroke=\"#9b7440\" stroke-width=\"1\">" +
    "<ellipse cx=\"4.3\" cy=\"11.4\" rx=\"1.6\" ry=\"4.7\" transform=\"rotate(-52 4.3 11.4)\"/>" +
    "<ellipse cx=\"5.4\" cy=\"9.3\" rx=\"1.6\" ry=\"4.7\" transform=\"rotate(-22 5.4 9.3)\"/>" +
    "<ellipse cx=\"7.4\" cy=\"8.5\" rx=\"1.5\" ry=\"4.2\" transform=\"rotate(8 7.4 8.5)\"/>" +
    "</g>" +
    "<ellipse cx=\"13.6\" cy=\"15\" rx=\"9\" ry=\"6.6\" fill=\"#fffaf0\" stroke=\"#9b7440\" stroke-width=\"1\"/>" +
    // the black riding jacket (sits on her back and belly, under the wing; clipped to her body)
    "<g class=\"pt-jack\" transform=\"scale(.001)\"><g clip-path=\"url(#ptbc)\"><polygon points=\"4,8 15.6,8 18.8,12.4 17.4,15.6 18.6,22 4,22\" fill=\"#1b1b20\"/><path d=\"M16.2 9.4l1.5 11.8\" stroke=\"#9a9aa8\" stroke-width=\".5\" fill=\"none\"/><path d=\"M15.4 8.4l3.2 3.6-3 .7Z\" fill=\"#34343d\"/><path d=\"M5.4 13.2h8.6M5.6 18.6h8.2\" stroke=\"#6c6c7a\" stroke-width=\".45\" fill=\"none\"/><circle cx=\"7.4\" cy=\"11.2\" r=\".5\" fill=\"#b9b9c6\"/><circle cx=\"10\" cy=\"10.5\" r=\".5\" fill=\"#b9b9c6\"/></g></g>" +
    "<g class=\"pt-wing\">" +
    "<path d=\"M8.6 14.2c1.6-2.2 6.4-2.5 8.9.6-1.6 3.2-6.6 3.5-8.9-.6Z\" fill=\"#f2dbab\" stroke=\"#9b7440\" stroke-width=\".8\" stroke-linejoin=\"round\"/>" +
    "<path d=\"M10.4 14.9c1.3-.5 2.7-.5 3.9.1M11.3 16.6c1.1-.3 2.2-.3 3.1.1\" fill=\"none\" stroke=\"#c9a56a\" stroke-width=\".6\" stroke-linecap=\"round\"/>" +
    "</g>" +
    "<ellipse cx=\"22.8\" cy=\"12.4\" rx=\".95\" ry=\"1.5\" fill=\"#e0412f\" stroke=\"#a82518\" stroke-width=\".5\"/>" +
    "<g class=\"pt-head\">" +
    "<g fill=\"#e0412f\" stroke=\"#a82518\" stroke-width=\".7\"><circle cx=\"18.1\" cy=\"5.2\" r=\"1.45\"/><circle cx=\"20.1\" cy=\"4.2\" r=\"1.55\"/><circle cx=\"22\" cy=\"5.2\" r=\"1.4\"/></g>" +
    "<circle cx=\"20\" cy=\"8.7\" r=\"4.3\" fill=\"#fffaf0\" stroke=\"#9b7440\" stroke-width=\"1\"/>" +
    "<path d=\"M24 8.1l2.8.9-2.8 1.1Z\" fill=\"#f5a623\" stroke=\"#c9801a\" stroke-width=\".6\" stroke-linejoin=\"round\"/>" +
    // the open beak (shown only while she sings, flickering open / closed): a dark mouth between a raised upper and a lowered lower beak
    "<g class=\"pt-sb\"><path d=\"M23.8 8.3L27 8.6 26.3 10.9 23.8 10.7Z\" fill=\"#9c2f1f\"/><path d=\"M24 8.1L26.9 7.6 24 9.3Z\" fill=\"#f5a623\" stroke=\"#c9801a\" stroke-width=\".5\" stroke-linejoin=\"round\"/><path d=\"M24 10.3L26.6 11 24 11.9Z\" fill=\"#f5a623\" stroke=\"#c9801a\" stroke-width=\".5\" stroke-linejoin=\"round\"/></g>" +
    "<circle cx=\"20.3\" cy=\"10.4\" r=\".95\" fill=\"#f7b9a6\" opacity=\".8\"/>" +
    "<g class=\"pt-eye\"><circle cx=\"21.4\" cy=\"8.2\" r=\"1\" fill=\"#2b1d0e\"/><circle cx=\"21.7\" cy=\"7.9\" r=\".35\" fill=\"#fff\"/></g>" +
    "<path class=\"pt-eyez\" opacity=\"0\" d=\"M20.3 8.4q1.2 1.1 2.4 0\" fill=\"none\" stroke=\"#2b1d0e\" stroke-width=\".8\" stroke-linecap=\"round\"/>" +
    // the "getting ready" outfit (shown only while the order is Packed, one piece at a time): sunglasses, a little delivery cap, a styled comb, a scarf, a riding jacket and a satchel
    "<g class=\"pt-gl\" transform=\"scale(.001)\"><path d=\"M19.5 7.3h4.1v2c0 .6-.5 1-1 1h-2.1c-.6 0-1-.4-1-1Z\" fill=\"#15151a\" stroke=\"#000\" stroke-width=\".4\" stroke-linejoin=\"round\"/><path d=\"M19.6 7.8L16.9 7.2\" stroke=\"#15151a\" stroke-width=\".7\" stroke-linecap=\"round\"/><path d=\"M20.3 8.1l1.2-.7\" stroke=\"#fff\" stroke-width=\".4\" stroke-linecap=\"round\" opacity=\".75\"/></g>" +
    "<g class=\"pt-cap\" transform=\"scale(.001)\"><path d=\"M15.7 6.9a4.3 4.3 0 0 1 8.6 0Z\" fill=\"#2f6fd6\" stroke=\"#1f4fa8\" stroke-width=\".7\" stroke-linejoin=\"round\"/><path d=\"M23.4 6.9h3.2\" stroke=\"#1f4fa8\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><circle cx=\"20\" cy=\"2.9\" r=\".6\" fill=\"#fff\"/></g>" +
    "<g class=\"pt-tool\" transform=\"scale(.001)\"><path d=\"M-2.4 0h4.8v1.2h-4.8Z\" fill=\"#2a2a30\"/><path d=\"M-2 1.2v1.1M-1 1.2v1.1M0 1.2v1.1M1 1.2v1.1M2 1.2v1.1\" stroke=\"#2a2a30\" stroke-width=\".45\"/></g>" +
    "</g>" +
    "<g class=\"pt-scarf\" transform=\"scale(.001)\"><path d=\"M15.4 11.7q3.4 3.2 7.1.5\" fill=\"none\" stroke=\"#d9433a\" stroke-width=\"1.9\" stroke-linecap=\"round\"/><path d=\"M16.4 13l-1.3 3.4 2.1-.7Z\" fill=\"#d9433a\" stroke=\"#a82518\" stroke-width=\".4\" stroke-linejoin=\"round\"/></g>" +
    "<g class=\"pt-bag\" transform=\"scale(.001)\"><path d=\"M10.6 16.3L16.6 10\" stroke=\"#8a5a1c\" stroke-width=\".9\" stroke-linecap=\"round\" fill=\"none\"/><rect x=\"8.6\" y=\"16.2\" width=\"6.4\" height=\"4.8\" rx=\"1.1\" fill=\"#c98a3d\" stroke=\"#8a5a1c\" stroke-width=\".7\"/><path d=\"M8.8 17.9h6\" stroke=\"#8a5a1c\" stroke-width=\".5\"/><circle cx=\"11.8\" cy=\"18.6\" r=\".55\" fill=\"#f5d27a\"/></g>" +
    "</g></svg>";
  const EGG_SVG =
    '<svg viewBox="0 0 12 15" aria-hidden="true" focusable="false">' +
    '<path d="M6 .8C3.4.8 1 5 1 8.6 1 11.7 3.2 14 6 14s5-2.3 5-5.4C11 5 8.6.8 6 .8Z" fill="#f3dcb4" stroke="#9b7440" stroke-width="1" stroke-linejoin="round"/>' +
    '<circle cx="4.2" cy="9.6" r=".7" fill="#c9a06a"/><circle cx="7.6" cy="7.4" r=".6" fill="#c9a06a"/><circle cx="7.4" cy="11.2" r=".6" fill="#c9a06a"/>' +
    '<path d="M3.6 6.2c.3-1.3 1-2.4 1.8-3" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".8"/>' +
    "</svg>";

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // TEST SWITCH (temporary): true = everything happens much sooner and more often (climbing, flying, napping, the egg game, the walks over the
  // corners), so each part can be tried out quickly. false = the normal, calm pace. Only this one line decides.
  const FAST = false;
  const P = FAST
    ? { cool0: 1, climbCool: [3, 6], climbP: 0.7, flyCool0: 6, flyCool: [12, 20], flyP: 0.25, sideCool0: 3, sideCool: [5, 9], sleepCool0: 3, sleepCool: 12, singCool0: 3, singCool: [10, 16], sing: [4.6, 5.6], nap: [9, 11], eggHop: [3, 6], eggT0: [2, 4], modeT: [5, 8], modes: ["wander", "follow", "chase"], spawn0: 6, spawn: [5, 9], modesR: ["wander", "follow", "chase"], kickWait: [6, 9], thr: [0.3, 0.4, 0.55, 0.75, 0.92] }
    : { cool0: 20, climbCool: [40, 65], climbP: 0.6, flyCool0: 25, flyCool: [40, 70], flyP: 0.2, sideCool0: 35, sideCool: [50, 80], sleepCool0: 30, sleepCool: 70, singCool0: 22, singCool: [45, 90], sing: [4.6, 6.2], nap: [12, 20], eggHop: [18, 35], eggT0: [15, 25], modeT: [9, 15], modes: ["wander", "wander", "wander", "wander", "wander", "wander", "wander", "follow", "chase"], spawn0: 50, spawn: [124, 186], modesR: ["wander", "wander", "wander", "follow", "follow", "chase"], kickWait: [14, 22], thr: [0.5, 0.72, 0.84, 0.92, 0.98] };

  // ---- the little world: one strip of pets, fixed on screen, standing on the top edge of the opened panel ----
  const LAYER_H = 28;
  const layer = document.createElement("div");
  layer.className = "trk-pets";
  layer.setAttribute("aria-hidden", "true");
  const henEl = document.createElement("div");
  henEl.className = "pt-hen";
  henEl.innerHTML = HEN_SVG + '<div class="pt-zzz" aria-hidden="true"><i>z</i><i>Z</i><i>z</i></div>' + SONG_HTML;
  henEl.addEventListener("animationend", (e) => { if (songEnded(e)) { world.h.song = false; henEl.classList.remove("is-song", "song-l"); } });
  const eggEl = document.createElement("div");
  eggEl.className = "pt-egg";
  eggEl.innerHTML = EGG_SVG;
  layer.append(eggEl, henEl);
  document.body.appendChild(layer);

  const world = {
    hen: henEl, egg: eggEl, henSvg: henEl.firstChild, eggSvg: eggEl.firstChild, W: 300, frames: 0, r: 20, roomL: 0, roomR: 0, topY: 200,
    h: { x: 100, dir: 1, act: "idle", t: 0.4, speed: 24, y: 0, vy: 0, vx: 0, air: false, flap: 0, ph: "", side: -1, px: 0, px0: 0, rot: 0, rotT: 0, out: false, H: 60, slip: false, slipT: 0, graze: false, vcur: 0, afterHide: false, dip0: 0, slide: 0, sleepAge: 0, dt: 0, ditem: 0, toSide: false, xfer: null, sideCool: P.sideCool0, flyCool: P.flyCool0, cool: P.cool0, sleepCool: P.sleepCool0, toCorner: false, sing: false, song: false, songL: false, singCool: P.singCool0 },
    e: { x: 134, y: 0, vx: 0, vy: 0, rot: 0, t: rand(P.eggT0[0], P.eggT0[1]), kick: 0 },
    mode: "wander", modeT: rand(3, 6),
    naps: 0, napsSince: 0, eggNeed: 5, rest: 0, wait: 0, layEgg: false, spawnCool: P.spawn0, deep: false, wakeAt: 0, sm: { sit: 0, tl: 0, lie: 0, leg: 1, hd: 0, eye: 0, walk: 0, cap: 0, scarf: 0, bag: 0, jack: 0, gl: 0, tool: 0, sg: 0, settled: true },
    anchorCode: "", anchorIdx: 0, carry: false, domSince: 0, n: 0, chk: false, // (which order's panel they stand on: they ride along with it, and when the other order takes over the screen they fly across to it, the egg in her feet)
    ready: false, wasReady: false, since: 0, readyT: 0, dressStep: 0, dressGap: 1.2, // (the order on screen is Packed / "getting ready": she gets dressed for it)
    pose: {}, // (the last pose drawn, so a part is only touched when it actually changed)
    parts: {
      all: henEl.querySelector(".pt-all"), l1: henEl.querySelector(".pt-l1"), l2: henEl.querySelector(".pt-l2"),
      wing: henEl.querySelector(".pt-wing"), tail: henEl.querySelector(".pt-tail"), head: henEl.querySelector(".pt-head"),
      eye: henEl.querySelector(".pt-eye"), eyez: henEl.querySelector(".pt-eyez"),
      cap: henEl.querySelector(".pt-cap"), scarf: henEl.querySelector(".pt-scarf"), bag: henEl.querySelector(".pt-bag"),
      jack: henEl.querySelector(".pt-jack"), gl: henEl.querySelector(".pt-gl"), tool: henEl.querySelector(".pt-tool"),
    },
  };

  // The panel's top corners are rounded. She walks ALONG them: sinking and leaning with the curve, and on past the corner a little way
  // down the side, where she fades out of sight, waits a moment, and comes walking back in. (surface* work on her centre x, in the strip's px.)
  const EXTRA = 16; // how far down the side she may go (hidden there)
  // She only ever leaves the panel's own width on a side where the panel reaches the edge of the screen (a phone): there she can walk over the corner and
  // down the side, and the screen edge hides her. Where there is room outside the panel (a computer screen) she stays ON the panel: turns round at its ends.
  const CLIMB = true; // she climbs up the panel's side from a left / right corner, then jumps off and floats down onto the panel
  const EDGE_TRIPS = true; // true = now and then she walks right over a corner and down the side, out of sight, and comes back later (false = she would always stay on the panel's top)
  const sideOpen = (w, side) => EDGE_TRIPS;
  const surfaceDip = (w, cx) => {
    const d = Math.min(cx, w.W - cx), r = w.r;
    if (!(r > 0) || d >= r) return 0;
    return d >= 0 ? r - Math.sqrt(r * r - (r - d) * (r - d)) : r - d;
  };
  const surfaceTilt = (w, cx) => { // degrees: along the curve (0 on the flat top, +-90 on the side)
    const d = Math.min(cx, w.W - cx), r = w.r, side = cx < w.W / 2 ? -1 : 1;
    if (!(r > 0) || d >= r) return 0;
    if (d <= 0) return side * 90;
    return side * (90 - Math.acos((r - d) / r) * 180 / Math.PI);
  };

  const DRESS_N = 6, DRESS_DUR = [3.2, 3.2, 3.2, 4.6, 3.4, 4.2]; // pieces, in this order: scarf, jacket, satchel, then the comb, the sunglasses and last the cap (about a minute in all, with breaks between)
  const DRESS_KEYS = ["scarf", "jack", "bag", "comb", "gl", "cap"]; // ("comb" has nothing to keep on: the tool just comes and goes)
  const DRESS_AT = [0.8, 0.9, 0.8, 1.8, 1, 1]; // when in its step each piece appears
  // a little flapping flight (up, a short way on, down again onto the panel): the rare "excited" move; far more often while the order is Packed
  function smallFly(h) { h.act = "fly"; h.air = true; h.y = 0; h.vy = 90; h.vx = h.dir * 22; h.flap = 0.7; }

  // ---- more of them, over time ----
  // After every third nap the hen lays one more egg as she walks (it stays where it fell), and now and then another hen walks in over a corner of the panel and wanders about.
  // The new hens are light: they only walk, stand, eat and (together with the first hen) sleep - they never fly or climb, they ride in the same loop, and when the first hen
  // sleeps (or is out of sight) the others just stand still, and each one naps on her own now and then. The extra eggs are plain still pictures: no work.
  const MAX_XHEN = Infinity, MAX_EGGS = Infinity; // (no limit: they keep coming. Put a number here to cap them - then the oldest hen walks off / the oldest egg fades away)
  const extras = [], layEggs = [];
  let xSeq = 0;
  function spawnHen(w) {
    const id = "ptbx" + (++xSeq);
    const el = document.createElement("div");
    el.className = "pt-hen pt-xhen";
    el.innerHTML = HEN_SVG.split("ptbc").join(id) + SONG_HTML; // (the very same hen, with the same little song)
    el.style.opacity = "0";
    layer.insertBefore(el, henEl);
    el.addEventListener("animationend", (e) => { if (!songEnded(e)) return; const o = extras.find((q) => q.el === el); if (o) { o.song = false; o.snc = 0; } el.classList.remove("is-song", "song-l"); });
    const q = (s) => el.querySelector(s), left = Math.random() < 0.5;
    extras.push({
      el, svg: el.firstChild, x: (left ? -4 : w.W + 4) - HEN_W / 2, dir: left ? 1 : -1, act: "walk", t: 2, speed: 22, vcur: 14, s: 0, a: 0, enter: true, leave: false, graze: false,
      sd: Math.floor(Math.random() * 4), ph: Math.random() * 6, nc: rand(20, 50), sing: false, song: false, songL: false, snc: 0, sg: 0, sgc: false, sc: rand(14, 40), dn: 0, dg: rand(2, 7), dd: 0, di: 0, pm: false, dm: { scarf: 0, jack: 0, bag: 0, gl: 0, cap: 0, tool: 0 }, // (her own costume: the same pieces in the same order as the first hen's, but at her own time)
      moving: false, pt: -1, flip: "", tf: "", op: "0", ez: "0", pose: {},
      parts: { l1: q(".pt-l1"), l2: q(".pt-l2"), head: q(".pt-head"), tail: q(".pt-tail"), eye: q(".pt-eye"), eyez: q(".pt-eyez"), all: q(".pt-all"), wing: q(".pt-wing"), cap: q(".pt-cap"), scarf: q(".pt-scarf"), bag: q(".pt-bag"), jack: q(".pt-jack"), gl: q(".pt-gl"), tool: q(".pt-tool") },
    });
  }
  function extrasStep(w, dt, quiet) {
    const W = w.W;
    for (let i = extras.length - 1; i >= 0; i--) {
      const x = extras[i];
      if (x.a < 1) x.a = Math.min(1, x.a + dt * 1.6);
      x.nc -= dt; x.sc -= dt;
      if (x.sing && x.act !== "idle") x.sing = false; // (the song only belongs to a stand-still)
      const dressing = w.ready && x.dn < DRESS_N; // (Packed: she gets dressed like the first hen - she stops walking for each piece - but at her own time)
      if (!w.ready) { x.dn = 0; x.dg = rand(2, 7); if (x.act === "dress") { x.act = "idle"; x.t = 0.5; } }
      else if (dressing && x.act !== "dress" && !x.enter && !x.leave && x.act !== "sleep") x.dg -= dt;
      if (x.act === "sleep") { // (her own nap, whenever she likes: not together with the others)
        x.t -= dt; if (x.t <= 0) { x.act = "idle"; x.t = rand(0.6, 1.5); }
        if (x.vcur > 0.3) { x.vcur -= x.vcur * Math.min(1, dt * 4.5); x.x += x.dir * x.vcur * dt; } else x.vcur = 0;
        continue;
      }
      if (x.enter) { const c = x.x + HEN_W / 2; if (c > 12 && c < W - 12) x.enter = false; }
      const cxd = x.x + HEN_W / 2;
      if (dressing && x.act !== "dress" && x.dg <= 0 && x.vcur < 6 && !x.enter && !x.leave && cxd > w.r + 2 && cxd < W - w.r - 2) { x.act = "dress"; x.dd = 0; x.di = x.dn; x.vcur = 0; x.graze = false; }
      if (x.act === "dress") { // (ONE piece, with the same little show as the first hen's, then she goes about her business again)
        x.dd += dt;
        if (x.dd >= DRESS_DUR[x.di]) { x.act = "idle"; x.t = rand(0.5, 1.2); x.dn = x.di + 1; x.dg = rand(3, 8); }
        continue;
      }
      x.t -= dt;
      if (x.t <= 0) {
        x.sing = false;
        if (x.enter || x.leave) x.t = 1;
        else if (x.nc <= 0 && !dressing && Math.random() < 0.1) { x.act = "sleep"; x.graze = false; x.t = rand(10, 18); x.nc = rand(50, 90); } // (now and then she has a nap of her own)
        else if (Math.random() < 0.5) { x.act = "walk"; x.graze = Math.random() < 0.3; x.speed = x.graze ? rand(8, 13) : rand(14, 26); x.t = rand(1.6, 4); if (Math.random() < 0.4) x.dir = -x.dir; }
        else { x.act = "idle"; x.graze = false; x.t = rand(1, 3); if (x.sc <= 0 && !dressing && Math.random() < 0.5) { x.sing = true; x.song = true; x.songL = x.dir < 0; x.t = rand(P.sing[0], P.sing[1]); x.sc = rand(P.singCool[0], P.singCool[1]); } } // (now and then she lifts her head and sings a little song, at her own time)
      }
      const vt = x.act === "walk" || x.enter || x.leave ? x.speed : 0;
      x.vcur += (vt - x.vcur) * Math.min(1, dt * 5);
      if (vt === 0 && x.vcur < 0.4) x.vcur = 0;
      x.x += x.dir * x.vcur * dt;
      const cx = x.x + HEN_W / 2;
      if (x.leave) { if (cx < -EXTRA || cx > W + EXTRA) { x.el.remove(); extras.splice(i, 1); } continue; }
      if (!x.enter) {
        if ((x.dir < 0 && cx <= 4) || (x.dir > 0 && cx >= W - 4)) x.dir = -x.dir; // (turns round at the end of the panel)
        x.x = Math.min(Math.max(2 - HEN_W / 2, x.x), W - 2 - HEN_W / 2);
      }
    }
    w.spawnCool -= dt;
    if (w.spawnCool <= 0 && w.layerOn && !quiet && !w.h.xfer && w.W >= 160 && (extras.length > 0 || (w.rest >= 1 && w.wait >= 90 && (!w.ready || w.dressStep >= DRESS_N)))) { // (the SECOND hen only comes when the first one has had a little time to herself: one nap AND at least 90 seconds - about a minute and a half to two minutes - and, if the order is Packed, once she has put on her whole costume; after that, more come at random) // (now and then: one more hen walks in; when there are plenty, the oldest one walks off)
      w.spawnCool = rand(P.spawn[0], P.spawn[1]) * (1 + 0.01 * extras.length); // (never stops: about 20 hens in the first hour, some 18 more in the next, and the wait for the next one keeps getting a little longer)
      const live = extras.filter((x) => !x.leave);
      if (live.length >= MAX_XHEN) { const o = live[0]; o.leave = true; o.enter = false; o.act = "walk"; o.speed = 24; o.graze = false; o.dir = o.x + HEN_W / 2 < W / 2 ? -1 : 1; }
      else spawnHen(w);
    }
  }
  // While the loop is stopped (a short stand-still, deep sleep, waiting out of sight) the extra hens' clocks give them the time that went by - each keeps her OWN schedule,
  // so they do not all lie down or wake up together; the ones whose time ran out meanwhile start again a little apart from each other.
  function extrasCatchUp(sk) {
    egT -= sk;
    for (const x of extras) {
      x.nc -= sk; x.sc -= sk;
      if (x.act === "sleep" || (x.act === "idle" && x.vcur === 0)) { const rest = x.t - sk; x.t = rest > 0.05 ? rest : rand(0.1, x.act === "sleep" ? 4 : 2.5); }
    }
  }
  // The laid eggs lie still (nothing runs) - but now and then one of them, picked at random, hops a little (and may roll a bit), just like the first egg. Only that one is worked on;
  // while it is in the air the loop runs, and when it has landed everything is still again.
  let egT = rand(8, 14), egActive = 0;
  function eggsStep(w, dt) {
    if (egActive) for (const g of layEggs) {
      if (!g.hop) continue;
      g.y += g.vy * dt; g.vy -= G * dt;
      let nx = g.x + g.dx + g.vx * dt;
      if (nx < 2) { nx = 2; g.vx = Math.abs(g.vx) * 0.7; } else if (nx > w.W - EGG_W - 2) { nx = w.W - EGG_W - 2; g.vx = -Math.abs(g.vx) * 0.7; }
      g.dx = nx - g.x;
      g.spin += g.vx * dt / (EGG_W / 2) * 57.3;
      if (g.y <= 0) { g.y = 0; if (Math.abs(g.vy) > 24) g.vy = -g.vy * 0.42; else { g.vy = 0; g.vx *= Math.max(0, 1 - 3.6 * dt); } }
      const tf = "translate3d(" + g.dx.toFixed(1) + "px," + (-g.y).toFixed(1) + "px,0)";
      if (g.tf !== tf) { g.tf = tf; g.el.style.transform = tf; }
      const rt = "rotate(" + Math.round((g.rb + g.spin) / 2) * 2 + "deg)";
      if (g.rt !== rt) { g.rt = rt; g.svg.style.transform = rt; }
      if (g.y <= 0 && g.vy === 0 && Math.abs(g.vx) < 2) { // landed and stopped: it stays where it is now
        g.x += g.dx; g.dx = 0; g.rb += g.spin; g.spin = 0; g.hop = false; egActive--;
        g.f = g.x / Math.max(1, w.W - EGG_W); g.el.style.left = g.x.toFixed(1) + "px"; g.el.style.transform = ""; g.tf = ""; g.vx = 0;
        saveEggs();
      }
    }
    egT -= dt;
    if (egT <= 0 && !egActive && layEggs.length && w.h.act !== "sleep" && !w.deep && w.layerOn) {
      egT = rand(7, 14) * (w.ready ? 0.45 : 1); // (more lively while the order is Packed)
      const t = performance.now(), cand = layEggs.filter((g) => t - g.born > 1200);
      if (cand.length) { const g = pick(cand); g.hop = true; g.y = 0; g.vy = rand(20, 28) * (w.ready ? 1.3 : 1); g.vx = (Math.random() < 0.5 ? -1 : 1) * rand(0, 16); g.dx = 0; g.spin = 0; g.tf = ""; g.rt = ""; egActive++; }
    }
  }
  const extrasDown = () => !egActive && extras.every((x) => x.vcur === 0 && !x.enter && !x.leave && x.a >= 1 && !x.pm && ((x.act === "idle" && !x.sing) || (x.act === "sleep" && x.s >= 0.999))); // (nobody is walking: the ones standing or lying just stay as they are while the loop is stopped) // (everyone lying still: the loop may stop altogether)
  const extrasIdle = () => !egActive && extras.every((x) => x.vcur === 0 && x.a >= 1 && !x.enter && !x.leave && !x.pm && ((x.act === "idle" && x.t > 0.4 && !x.sing && x.sg === 0) || (x.act === "sleep" && x.s >= 0.999)));
  function drawExtras(w, now, dt) {
    const a = 1 - Math.exp(-dt * 3), ap = 1 - Math.exp(-dt * 1.4), pt = Math.floor(now / 100), tn = pt * 100;
    for (const x of extras) {
      const cx = x.x + HEN_W / 2, sl = x.act === "sleep", d = (sl ? 1 : 0) - x.s;
      x.moving = Math.abs(d) > 0.02; x.s = x.moving ? x.s + d * a : (sl ? 1 : 0);
      const sg = x.act === "idle" && x.sing ? 1 : 0, dg = sg - x.sg; // (singing: the head lifts up smoothly, and eases back down)
      if (Math.abs(dg) > 0.02) { x.sg += dg * a; x.moving = true; } else x.sg = sg;
      if (x.sgc !== !!sg) { x.sgc = !!sg; x.el.classList.toggle("is-sing", !!sg); }
      const sn = x.song ? (x.songL ? 2 : 1) : 0; // (the notes stay on the side she sang towards, even if she turns round while they float away)
      if (x.snc !== sn) { x.snc = sn; x.el.classList.toggle("is-song", sn > 0); x.el.classList.toggle("song-l", sn === 2); }
      x.pm = false; // (the costume pieces ease on slowly, like the first hen's)
      for (const k in x.dm) {
        const ix = DRESS_KEYS.indexOf(k === "tool" ? "comb" : k), dr = x.act === "dress" && x.di === ix;
        const tg = k === "tool" ? (dr && x.dd > 0.2 && x.dd < 4 ? 1 : 0) : (ix < x.dn || (dr && x.dd >= DRESS_AT[ix])) ? 1 : 0, dd = tg - x.dm[k];
        if (Math.abs(dd) > 0.02) { x.dm[k] += dd * ap; x.pm = true; } else x.dm[k] = tg;
      }
      if (x.pm) x.moving = true;
      const walking = x.act === "walk" && x.vcur > 0.5;
      const bob = walking ? Math.abs(Math.sin(now / 90 + x.ph)) * 1.1 : 0;
      const tf = "translate3d(" + x.x.toFixed(1) + "px," + (surfaceDip(w, cx) - bob + x.s * 3.6).toFixed(1) + "px,0) rotate(" + surfaceTilt(w, cx).toFixed(1) + "deg)";
      if (x.tf !== tf) { x.tf = tf; x.el.style.transform = tf; }
      const o = Math.min(x.a, Math.max(0, Math.min(1, (Math.min(cx, w.W - cx) + 14) / 10))), os = o >= 0.97 ? "" : o.toFixed(1);
      if (x.op !== os) { x.op = os; x.el.style.opacity = os; }
      const fl = x.dir < 0 ? "scaleX(-1)" : "";
      if (x.flip !== fl) { x.flip = fl; x.svg.style.transform = fl; x.el.classList.toggle("face-l", !!fl); }
      if (!x.moving && x.pt === pt) continue; // (the poses change 10 times a second, like the first hen's)
      x.pt = pt;
      const k = Math.min(1, x.vcur / 12), stride = walking ? [1, 0, -1, 0][(pt + x.sd) & 3] * 24 * k : 0;
      let head = 13 * x.s - SING_HEAD * x.sg, dy = 0, tilt = -SING_LEAN * x.sg, wing = 0, hop = 0, wag = 0, dl = 0;
      if (x.act === "dress") { // (the little show for each piece: the same moves as the first hen's)
        const t = x.dd, it = x.di;
        if (it === 0) { if (t < 0.8) { wing = pt & 1; tilt = -3; } else if (t < 1.5) head += 12; }
        else if (it === 1) { if (t < 0.9) { wing = pt & 1; tilt = -4; } else if (t < 1.6) tilt = 4; }
        else if (it === 2) { if (t < 0.8) head += 22; else if (t < 1.5) head += 8; }
        else if (it === 3) { if (t < 4.2) head += 12 + 5 * Math.sin(t * 8); else head += 3; }
        else if (it === 4) { if (t < 1) head += 16; else { head -= 6; tilt = -4; } }
        else if (t < 1) head -= 10; else if (t < 1.7) head += 12; else if (t < 2.6) head += 8; else { head -= 8; tilt = -6; wing = t < 3.2 ? pt & 1 : 0; }
      }
      else if (x.sg > 0.02) { const d = danceOf(pt + x.sd * 2, x.sg); dl = d.leg; wing = d.wing ? 1 : 0; hop = -d.hop; tilt += d.sway; head += d.nod; wag = d.wag; } // (singing: she dances too, in her own beat)
      else if (x.act === "walk" && x.graze) { const g = eatK(tn + x.sd * 300, 1200); head += 40 * g; dy = 4 * g; tilt = 30 * g; } // (eats as she goes on)
      setPart(x, "l1", legTf(stride + dl, 11.6, 1 - x.s));
      setPart(x, "l2", legTf(-stride - dl, 15.8, 1 - x.s));
      setPart(x, "tail", x.s < 0.01 && !wag ? "" : "rotate(" + R(-TAIL_DROP * x.s + wag) + " 8.5 12.5)");
      setPart(x, "head", "translate(0 " + R(dy) + ") rotate(" + R(head) + " 18 11)");
      setPart(x, "all", (hop ? "translate(0 " + R(hop) + ") " : "") + "rotate(" + R(tilt) + " 14 24.5)");
      setPart(x, "wing", "translate(16.5 13) rotate(" + (wing ? 52 : 0) + ") scale(" + (wing ? 1.2 : 1) + ") translate(-16.5 -13)");
      setPart(x, "eye", "translate(21.4 8.2) scale(1 " + Math.max(0.05, 1 - x.s).toFixed(2) + ") translate(-21.4 -8.2)");
      const m = x.dm; // (her own costume)
      setPart(x, "cap", "translate(0 " + R(-(1 - m.cap) * 8) + ") translate(20 6.9) scale(" + Math.max(0.001, m.cap).toFixed(2) + ") translate(-20 -6.9)");
      setPart(x, "jack", "translate(13.6 15) scale(" + Math.max(0.001, m.jack).toFixed(2) + ") translate(-13.6 -15)");
      setPart(x, "gl", "translate(0 " + R(-(1 - m.gl) * 4) + ") translate(21.4 8.6) scale(" + Math.max(0.001, m.gl).toFixed(2) + ") translate(-21.4 -8.6)");
      setPart(x, "tool", m.tool < 0.01 ? "scale(0.001)" : "translate(" + R(18.6 + 3.4 * Math.sin(tn / 90) * m.tool + 1.5) + " " + R(1.6 + 1.2 * Math.cos(tn / 150)) + ") rotate(-22) scale(" + Math.max(0.001, m.tool).toFixed(2) + ")");
      setPart(x, "scarf", "translate(19 12.5) scale(" + Math.max(0.001, m.scarf).toFixed(2) + ") translate(-19 -12.5)");
      setPart(x, "bag", "translate(12 18.5) scale(" + Math.max(0.001, m.bag).toFixed(2) + ") translate(-12 -18.5)");
      const ez = x.s > 0.5 ? "1" : "0";
      if (x.ez !== ez) { x.ez = ez; x.parts.eyez.setAttribute("opacity", ez); }
    }
  }
  function layEgg(w, h) { // one more egg, dropped just behind her on the flat top of the panel
    const ex = h.x + HEN_W / 2 - EGG_W / 2 - h.dir * 15, c = ex + EGG_W / 2;
    if (c < w.r + 6 || c > w.W - w.r - 6) return false;
    const near = (o) => Math.abs(o - ex) < EGG_W + 3, crowded = layEggs.length >= (w.W - 2 * w.r) / (EGG_W + 3) - 2; // (the row is full: then they pile up a little over each other)
    if (!crowded && (near(w.e.x) || layEggs.some((g) => near(g.x)))) return false; // (not on top of another egg: she lays it a few steps on)
    const el = document.createElement("div");
    el.className = "pt-egg pt-egg2";
    el.style.left = ex.toFixed(1) + "px";
    el.innerHTML = EGG_SVG;
    const rb = Math.round(rand(-16, 16));
    el.firstChild.style.transform = "rotate(" + rb + "deg)";
    layer.insertBefore(el, layer.firstChild);
    layEggs.push({ el, svg: el.firstChild, x: ex, f: ex / Math.max(1, w.W - EGG_W), rb, hop: false, born: performance.now() });
    if (layEggs.length > MAX_EGGS) { const o = layEggs.shift(); o.el.classList.add("is-out"); setTimeout(() => o.el.remove(), 700); }
    saveEggs();
    return true;
  }
  // The laid eggs are kept (in this browser) and are back after a reload / the next visit: they never disappear. (Their places are saved as a share of the panel's width.)
  const EGG_KEY = "freshcutz_pets_eggs";
  function saveEggs() { try { localStorage.setItem(EGG_KEY, JSON.stringify(layEggs.map((g) => +g.f.toFixed(3)))); } catch (e) {} }
  function restoreEggs(w) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(EGG_KEY) || "[]"); } catch (e) {}
    if (!Array.isArray(list)) return;
    for (const f of list) {
      if (typeof f !== "number" || !isFinite(f)) continue;
      const el = document.createElement("div"), x = Math.max(2, Math.min(f, 1) * Math.max(1, w.W - EGG_W));
      el.className = "pt-egg pt-egg2"; el.style.left = x.toFixed(1) + "px"; el.style.animation = "none"; // (already lying there: no drop-in)
      const rb = Math.round(rand(-16, 16));
      el.innerHTML = EGG_SVG; el.firstChild.style.transform = "rotate(" + rb + "deg)";
      layer.insertBefore(el, layer.firstChild);
      layEggs.push({ el, svg: el.firstChild, x, f, rb, hop: false, born: 0 });
    }
  }
  function fitExtras(w) { // (the panel got narrower / wider)
    for (const g of layEggs) { const nx = Math.max(2, Math.min(g.f * Math.max(1, w.W - EGG_W), w.W - EGG_W - 2)); if (nx !== g.x) { g.x = nx; g.el.style.left = nx.toFixed(1) + "px"; } }
    for (const x of extras) if (!x.enter && !x.leave) x.x = Math.min(Math.max(2 - HEN_W / 2, x.x), w.W - 2 - HEN_W / 2);
  }
  function newAct(w) { // (the order is Packed: she is more lively - shorter stand-stills; see also her speed and the egg)
    newAct0(w);
    if (w.ready && w.h.act === "idle" && !w.h.sing) w.h.t *= 0.55;
  }
  function trySing(h) { // (now and then, instead of a plain stand-still, she lifts her head and sings a little song: the head up, the beak open and shut, notes floating up)
    if (h.singCool > 0 || Math.random() > 0.6) return;
    h.sing = true; h.song = true; h.songL = h.dir < 0; h.t = rand(P.sing[0], P.sing[1]); h.singCool = rand(P.singCool[0], P.singCool[1]);
  }
  function newAct0(w) {
    const h = w.h;
    h.toCorner = false; h.toSide = false; h.sing = false;
    const cxNow = h.x + HEN_W / 2;
    if (h.afterHide || Math.min(cxNow, w.W - cxNow) < w.r + 6) { // (coming back from over the edge, or still on the curve: walk back onto the flat top)
      h.afterHide = false; h.dir = cxNow < w.W / 2 ? 1 : -1; h.graze = false;
      h.act = "walk"; h.t = rand(1.2, 2.2); h.speed = 22; return;
    }
    const r = Math.random();
    const room = h.dir > 0 ? w.W - HEN_W - h.x : h.x;
    if (w.ready && w.dressStep < DRESS_N) { // (getting dressed, between two pieces: a short walk, a peck, a little jump, or just standing - no naps, no climbing)
      const cxf = h.x + HEN_W / 2, flat = cxf > w.r + 16 && cxf < w.W - w.r - 16;
      if (r < 0.4) { if (room < w.r + 40 || Math.random() < 0.25) h.dir = -h.dir; h.graze = false; h.act = "walk"; h.t = rand(1.2, 2.4); h.speed = rand(18, 28); }
      else if (r < 0.58) { h.act = "walk"; h.graze = true; h.t = rand(1.4, 2.4); h.speed = rand(8, 13); if (room < w.r + 30 || Math.random() < 0.25) h.dir = -h.dir; } // (eats while she goes on, slowly: she does not stand still)
      else if (r < 0.8 && flat) smallFly(h); // (the order is Packed: she is excited, she flaps up and flies a little way on)
      else { h.act = "idle"; h.t = rand(0.8, 1.8); }
      return;
    }
    const canCorner = w.W >= 160 && h.cool <= 0;
    if (w.ready && h.flyCool <= 0 && Math.random() < 0.3 && cxNow > w.r + 16 && cxNow < w.W - w.r - 16) { smallFly(h); h.flyCool = rand(7, 13); return; } // (Packed, all dressed: she keeps flying up in her excitement, every ten seconds or so)
    if (r < P.thr[0]) { // walk (turning back if there is hardly any room that way)
      if (room < 30 || Math.random() < 0.22) h.dir = -h.dir;
      h.graze = Math.random() < 0.2; // (only some walks are spent pecking at the ground)
      h.act = "walk"; h.t = rand(1.4, 4); h.speed = h.graze ? rand(11, 18) : rand(18, 30);
    } else if (r < P.thr[1]) { h.act = "idle"; h.t = rand(0.7, 2); trySing(h); }
    else if (r < P.thr[2]) { h.act = "walk"; h.graze = true; h.t = rand(1.8, 3.4); h.speed = rand(8, 13); if (room < w.r + 30 || Math.random() < 0.25) h.dir = -h.dir; } // (eats for a good while, but moves on slowly while she does: she does not stop there)
    else if (r < P.thr[3] && ((CLIMB && canCorner) || (EDGE_TRIPS && sideOpen(w, h.x + HEN_W / 2 < w.W / 2 ? -1 : 1) && h.sideCool <= 0 && w.W >= 160))) { // (rare) off to the nearest end of the panel: to try climbing up its side, or to walk on over the corner and down it (out of sight), coming back later
      h.dir = h.x + HEN_W / 2 < w.W / 2 ? -1 : 1;
      h.act = "walk"; h.t = 12; h.speed = 28;
      if (CLIMB && canCorner && (!EDGE_TRIPS || h.sideCool > 0 || Math.random() < 0.5)) h.toCorner = true;
      else { h.toSide = true; h.sideCool = rand(P.sideCool[0], P.sideCool[1]); }
    } else if (r < P.thr[4] && h.sleepCool <= 0) { // (rare) a nap, with z z z
      if (++w.napsSince >= w.eggNeed) { w.layEgg = true; w.napsSince = 0; } /* nothing new at first: the first extra egg - and the second hen - only after five naps, so the customer has time to watch her; after that, a different number of naps each time, and it takes longer and longer */ h.lie = Math.random() < 0.67; h.act = "sleep"; h.t = rand(P.nap[0], P.nap[1]) + 1.2; h.sleepCool = P.sleepCool; h.sleepAge = -1.2; // (she first slows down and stands still for a moment, then settles down: see posture)
    } else if (r > 0.985 && cxNow > w.r + 16 && cxNow < w.W - w.r - 16) { smallFly(h); // (very rarely: she flaps up and flies a short way on, then floats down onto the panel)
    } else { h.act = "idle"; h.t = rand(0.7, 1.6); trySing(h); }
  }

  // The hen at the left / right end of the panel: she hops onto the side line of the panel, turns upright against it (on a phone, where the panel
  // fills the screen, she stands against the screen edge; on a wider screen she is outside the panel), climbs UP it for about 10% of the screen
  // height (sometimes slipping back once), and at the top she jumps off, floating back down onto the panel.
  function startCorner(w, side) {
    const h = w.h;
    h.cool = rand(P.climbCool[0], P.climbCool[1]); h.sideCool = Math.max(h.sideCool, rand(25, 40)); // (a climb and a trip over the corner never come close together)
    if (!h.toCorner && Math.random() > P.climbP) return;
    h.toCorner = false;
    h.act = "corner"; h.ph = "grab"; h.side = side; h.t = 0; h.y = 0; h.px0 = h.x + HEN_W / 2; h.px = h.px0; h.dip0 = surfaceDip(w, h.px0); // (px must be set at once: the very next draw uses it)
    h.out = (side < 0 ? w.roomL : w.roomR) >= 30; // room outside the panel? then she is outside it
    h.rotT = (h.out ? side : -side) * 90; // (the way she leans: body outwards, or inwards when there is no room outside)
    h.dir = h.rotT > 0 ? -1 : 1; // (so that "forward" is up the wall)
    h.H = Math.max(30, Math.min(0.1 * window.innerHeight, w.topY - 40)); // how high she climbs: 10% of the screen height (kept on screen)
    h.slip = Math.random() < 0.6; h.slipT = 0;
  }
  // Over the corner and DOWN the side: she walks along the round corner (sinking and leaning with the curve, as always), and when she gets to the end of it she goes on
  // DOWN the panel's side, her feet on its edge, leaning outwards, until she is out of sight (she fades at the bottom of the way, a computer screen shows her all the
  // way down; a phone's edge hides her). She waits there a moment (nothing moves, nothing is drawn), then climbs back up the side and over the corner onto the top.
  function startDown(w, side) {
    const h = w.h;
    h.cool = Math.max(h.cool, rand(25, 40)); h.sideCool = rand(P.sideCool[0], P.sideCool[1]);
    h.act = "corner"; h.ph = "down"; h.side = side; h.toSide = false; h.toCorner = false; h.graze = false; h.afterHide = true;
    h.px = side < 0 ? 0 : w.W; h.px0 = h.px; h.y = -w.r; h.vcur = 0; h.out = true;
    h.rotT = side * 90; h.dir = side < 0 ? -1 : 1; // (forward is down the wall)
    h.D = Math.max(70, Math.min(rand(120, 190), window.innerHeight - w.topY - 40)); // how far down she goes (measured from the panel's top edge)
  }
  const sideHidden = (w, side) => (side < 0 ? w.roomL : w.roomR) < 1; // (the panel reaches the edge of the screen on that side: what happens down its side is out of sight)
  function cornerStep(w, dt) {
    const h = w.h, wallX = h.side < 0 ? 0 : w.W;
    if (h.ph === "down") {
      if (sideHidden(w, h.side)) { h.y = -h.D; h.ph = "hold"; h.t = rand(2.5, 5) + h.D / 13; return; } // (nobody can see her down there: no walking is drawn, she is simply "down there" for the time it would take - and nothing runs at all)
      h.y -= 26 * dt;
      if (-h.y >= h.D) { h.y = -h.D; h.ph = "hold"; h.t = rand(2.5, 5); }
      return;
    }
    if (h.ph === "hold") { h.t -= dt; if (h.t <= 0) { h.ph = "up"; h.dir = -h.dir; } return; } // (out of sight: waits)
    if (h.ph === "up") {
      if (sideHidden(w, h.side)) h.y = -w.r; // (still out of sight: she is back at the corner at once)
      h.y += 26 * dt;
      if (h.y >= -w.r) { // back at the end of the round corner: walks on, up the curve and onto the flat top
        const side = h.side;
        h.act = "walk"; h.ph = ""; h.afterHide = false; h.y = 0; h.x = side < 0 ? -HEN_W / 2 : w.W - HEN_W / 2; h.dir = side < 0 ? 1 : -1; h.vcur = 12; h.speed = 22; h.t = rand(1.8, 2.8); h.graze = false; h.rot = side * 90;
      }
      return;
    }
    if (h.ph === "grab") {
      h.t += dt / 0.4;
      const u = Math.min(1, h.t), k = u * u * (3 - 2 * u);
      h.px = h.px0 + (wallX - h.px0) * k;
      if (u >= 1) { h.ph = "wall"; h.px = wallX; }
    } else {
      if (h.slipT > 0) { h.slipT -= dt; h.y = Math.max(0, h.y - 55 * dt); } // slips back a little
      else {
        h.y += 24 * dt;
        if (h.slip && h.y > h.H * 0.55) { h.slip = false; h.slipT = 0.35; }
      }
      if (h.y >= h.H) { // at the top: jump off the wall, back towards the panel
        h.act = "fly"; h.air = true; h.ph = ""; h.dir = -h.side; // (the climb ends in a flight: she spreads her wings and glides down, back across to the panel)
        h.x = h.px - HEN_W / 2; h.slide = -h.side * HEN_W / 2; // (she leaves from exactly where she was, then slides in as she turns upright)
        h.vx = -h.side * 34; h.vy = 34; h.flap = 1.1; h.flyCool = rand(P.flyCool[0], P.flyCool[1]);
      }
    }
  }
  function airStep(w, dt) {
    const h = w.h, W = w.W;
    h.x += h.vx * dt; h.y += h.vy * dt;
    if (h.slide) { const d = h.slide * Math.min(1, dt * 9); h.x += d; h.slide -= d; if (Math.abs(h.slide) < 0.3) h.slide = 0; }
    if (h.act === "fly" && h.flap > 0) { h.flap -= dt; h.vy += (22 - h.vy) * Math.min(1, 6 * dt); } // (the flapping holds her up)
    else h.vy -= (h.act === "fly" ? 150 : 260) * dt; // (then she floats down; a jump just falls)
    if (!h.slide) {
      if (h.x <= 0) { h.x = 0; h.vx = Math.abs(h.vx); h.dir = 1; }
      else if (h.x >= W - HEN_W) { h.x = W - HEN_W; h.vx = -Math.abs(h.vx); h.dir = -1; }
    }
    if (h.y <= 0 && h.vy < 0) { h.y = 0; h.vy = 0; h.vx = 0; h.air = false; h.act = "idle"; h.t = rand(0.4, 1); }
  }

  function step(w, dt) {
    const h = w.h, e = w.e, W = w.W, r = w.r;
    w.modeT -= dt;
    if (w.modeT <= 0) { w.mode = pick(w.ready ? P.modesR : P.modes); w.modeT = rand(P.modeT[0], P.modeT[1]) * (w.ready ? 0.65 : 1); if (h.act !== "sleep" && h.act !== "dress" && !h.toSide && !h.toCorner && !h.sing) h.t = 0; }
    e.kick -= dt;
    h.cool -= dt; h.sleepCool -= dt; h.singCool -= dt; h.flyCool -= dt; h.sideCool -= dt;
    if (h.sing && h.act !== "idle") h.sing = false; // (the song only belongs to a stand-still)
    { const cq = h.x + HEN_W / 2; // (the other hens rest while she sleeps or is out of sight down the side)
      eggsStep(w, dt);
      extrasStep(w, dt, h.act === "sleep" || (h.act === "corner" && (h.ph === "down" || h.ph === "hold")) || (h.afterHide && h.act === "idle" && (cq <= -7 || cq >= W + 7))); }
    if (!w.ready) { // (not Packed: no outfit; if the order moved on while she wore it, it comes off)
      w.dressGap = 1.2;
      if (w.dressStep > 0 || h.act === "dress") { w.dressStep = 0; if (h.act === "dress") { h.act = "idle"; h.t = 0.5; } }
    } else if (w.dressStep < DRESS_N && h.act !== "dress" && !h.air && h.act !== "corner" && h.act !== "sleep") w.dressGap -= dt;
    w.since += dt; w.wait += dt;
    if (w.ready && !w.wasReady) { // the order is Packed: if the panel was just opened (a reload, or opened again) she is already wearing the first few pieces - a different start every time
      const n = w.since < 2.5 ? pick([0, 0, 1, 2, 2, 3, 3, 4]) : 0; // (a status that turns Packed while she is on screen: she starts from nothing)
      w.dressStep = n; w.dressGap = n ? rand(1.5, 4) : 1.2;
      DRESS_KEYS.forEach((k, i) => { if (i < n && k in w.sm) w.sm[k] = 1; });
    }
    if (w.ready !== w.wasReady) { w.rest = 0; w.wait = 0; } // (the order turned Packed / is no longer: the waiting for the second hen starts again)
    w.wasReady = w.ready;
    const dressNow = w.ready && w.dressStep < DRESS_N && (w.dressGap <= 0 || h.act === "sleep" && w.dressGap < 0.6);

    // the hen
    if (h.xfer) xferStep(w, dt);
    else if (h.act === "sleep") {
      h.t -= dt; h.sleepAge += dt;
      if (h.vcur > 0.3) { h.vcur -= h.vcur * Math.min(1, dt * 4.5); h.x += h.dir * h.vcur * dt; } else h.vcur = 0; // (she does not stop dead: she slows down on the spot)
      if (w.ready && w.dressStep < DRESS_N) { w.dressGap -= dt; if (w.dressGap <= 0) h.t = 0; } // (the order is getting ready: she wakes up to get dressed)
      if (h.t <= 0) { h.act = "idle"; h.t = 0.9; h.sleepAge = 0; w.deep = false; if (++w.rest === 1) w.spawnCool = Math.max(w.spawnCool, rand(3, 8)); } // wakes: the pose eases back (see posture)
      else if (!w.deep && h.sleepAge > 4.7 && w.sm.settled && e.y <= 0 && Math.abs(e.vy) < 1 && Math.abs(e.vx) < 2 && extrasDown()) w.deep = true; // deep sleep: nothing moves, nothing is drawn
    } else if (h.air) airStep(w, dt);
    else if (h.act === "corner") cornerStep(w, dt);
    else {
      h.x = Math.min(Math.max(h.toSide ? -HEN_W / 2 - EXTRA : 2 - HEN_W / 2, h.x), h.toSide ? W - HEN_W / 2 + EXTRA : W - 2 - HEN_W / 2); // (where the panel has room outside it she stays fully ON it)
      h.t -= dt;
      const cx0 = h.x + HEN_W / 2;
      if (dressNow && h.act !== "dress" && h.vcur < 6 && cx0 > r + 2 && cx0 < W - r - 2) { h.act = "dress"; h.dt = 0; h.ditem = w.dressStep; h.vcur = 0; h.graze = false; h.toCorner = false; }
      if (h.act === "dress") { // ONE piece of the outfit per turn; then she goes about her business for a while (walks, pecks, hops) before the next one
        h.dt += dt;
        if (h.dt >= DRESS_DUR[h.ditem]) { h.act = "idle"; h.t = 0.7; w.dressStep = h.ditem + 1; w.dressGap = rand(3, 4.5); }
      } else if (w.mode === "chase" && !h.toSide && !h.toCorner) {
        const dx = e.x + EGG_W / 2 - (h.x + HEN_W / 2);
        if (Math.abs(dx) > 11) { h.act = "walk"; h.graze = false; h.dir = dx > 0 ? 1 : -1; h.speed = 38; }
        else if (e.kick <= 0 && e.y < 1) { // a kick: the egg flies off and rolls away
          e.vx = h.dir * rand(34, 52); e.vy = rand(22, 32); e.kick = 3; // (one gentle kick, then the game is over for a while)
          h.act = "idle"; h.t = 0.55; w.mode = "wander"; w.modeT = rand(P.kickWait[0], P.kickWait[1]) * (w.ready ? 0.6 : 1);
        } else if (h.act === "walk") { h.act = "idle"; h.t = 0.3; }
      } else if (h.t <= 0) newAct(w);
      // she speeds up and slows down smoothly (no instant start / stop)
      const vt = h.act === "walk" ? h.speed * (w.ready ? 1.35 : 1) : 0; // (Packed: she walks a little faster)
      h.vcur += (vt - h.vcur) * Math.min(1, dt * 5);
      if (vt === 0 && h.vcur < 0.4) h.vcur = 0;
      h.x += h.dir * h.vcur * dt;
      const cx = h.x + HEN_W / 2;
      if (w.layEgg && h.act === "walk" && !h.toSide && !h.toCorner && h.vcur > 8 && layEgg(w, h)) { w.layEgg = false; w.eggNeed = Math.floor(rand(4, 7 + 2 * layEggs.length)); } // (every third nap: she lays an egg as she walks)
      if (h.act === "walk" && W >= 160 && w.mode !== "chase") {
        const towardEdge = (h.dir < 0 && cx <= 4) || (h.dir > 0 && cx >= W - 4); // (she walks right on to the rounded corners, sinking and leaning with the curve)
        if (CLIMB && towardEdge && !h.toSide && (h.cool <= 0 || h.toCorner)) startCorner(w, h.dir < 0 ? -1 : 1);
        else if (towardEdge && !h.toSide && !h.air) { // (she turns round at the end of the panel, or hops off it back inwards: she does not leave it)
          h.dir = -h.dir;
        }
      }
      if (h.act === "walk" && h.toSide && (cx <= 0 || cx >= W)) startDown(w, cx <= 0 ? -1 : 1); // (the end of the round corner: on down the side)
      if (h.act !== "corner" && !h.air) {
        const gone = cx <= -EXTRA || cx >= W + EXTRA; // all the way down the side, out of sight: waits a moment, then walks back in
        if (gone) {
          h.x = cx <= -EXTRA ? -EXTRA - HEN_W / 2 : W + EXTRA - HEN_W / 2;
          h.dir = cx <= -EXTRA ? 1 : -1; h.vcur = 0; h.act = "idle"; h.t = rand(2.5, 5); h.afterHide = true; h.toSide = false; // (out of sight: she waits a while)
        }
      }
    }

    // all the way down the side and out of sight: the egg settles and then nothing moves or is drawn until she walks back (like deep sleep: no frames at all)
    { const cxh = h.x + HEN_W / 2;
      if (h.afterHide && h.act === "idle" && !h.air && (cxh <= -7 || cxh >= W + 7) && e.y <= 0 && Math.abs(e.vy) < 1 && Math.abs(e.vx) < 2 && extrasDown()) w.hidePause = true;
      if (h.act === "corner" && h.ph === "hold" && e.y <= 0 && Math.abs(e.vy) < 1 && Math.abs(e.vx) < 2 && extrasDown()) w.hidePause = true; } // (waiting out of sight down the side: nothing moves)
    // lean smoothly (upright on the ground, along the wall when climbing, nose up / down in the air)
    h.rotT = h.act === "corner" ? h.rotT : h.air ? Math.max(-14, Math.min(14, -h.vy * 0.1 * h.dir)) : surfaceTilt(w, h.x + HEN_W / 2);
    h.rot += Math.max(-dt * 520, Math.min(dt * 520, h.rotT - h.rot));

    // flying across to another order's panel she carries the egg in her feet; she lets it go when she lands
    if (h.xfer) return; // (the egg is flying across too, see xferStep)
    if (w.carry) {
      if (h.air) { // (it comes up to her feet smoothly, and stays there)
        const f = Math.min(1, dt * 12);
        e.x += (h.x + HEN_W / 2 - EGG_W / 2 + h.dir * 1.5 - e.x) * f; e.y += ((h.xfer ? h.y - 12 : Math.max(0, h.y - 12)) - e.y) * f; e.vx = 0; e.vy = 0; e.rot += dt * 30 * h.dir; return;
      }
      w.carry = false; e.y = 0; e.vy = 0; e.vx = h.dir * 14;
    }
    // the egg (calm: it mostly just sits; a small hop only now and then)
    const ground = e.y <= 0 && Math.abs(e.vy) < 1;
    if (!ground || Math.abs(e.vx) > 2) {
      e.x += e.vx * dt;
      if (e.x <= 0) { e.x = 0; e.vx = Math.abs(e.vx) * 0.7; }
      else if (e.x >= W - EGG_W) { e.x = W - EGG_W; e.vx = -Math.abs(e.vx) * 0.7; }
    }
    if (e.y > 0 || e.vy > 0) {
      e.y += e.vy * dt; e.vy -= G * dt;
      if (e.y <= 0) { e.y = 0; if (Math.abs(e.vy) > 24) e.vy = -e.vy * 0.42; else e.vy = 0; }
    } else {
      e.vx *= Math.max(0, 1 - 3.6 * dt); // rolling slows down quickly
    }
    e.rot += (e.vx * dt / (EGG_W / 2)) * 57.3;
    if (ground && Math.abs(e.vx) < 6 && h.act !== "sleep") {
      e.t -= dt;
      if (w.mode === "follow") { // it rolls slowly after the hen, only when she has got well away from it
        const goal = h.x + (h.dir > 0 ? -EGG_W - 6 : HEN_W + 6);
        const d = goal - e.x;
        if (Math.abs(d) > (w.ready ? 30 : 50)) e.vx = Math.sign(d) * (w.ready ? 22 : 14);
      }
      if (e.t <= 0) { // a small hop, rarely
        e.vy = rand(20, 28) * (w.ready ? 1.3 : 1); e.vx = 0; e.t = rand(P.eggHop[0], P.eggHop[1]) * (w.ready ? 0.4 : 1); // (a tiny hop, very rarely)
      }
    }
  }

  // The hen's moving parts (legs, wing, head, body lean) are set here from the clock, one small change per frame, instead of CSS animations
  // (which each cost a style recalculation every frame). A part is only touched when its value actually changed.
  const R = (v) => Math.round(v * 2) / 2;
  function setPart(w, key, tf) {
    if (w.pose[key] === tf) return;
    w.pose[key] = tf;
    w.parts[key].setAttribute("transform", tf);
  }
  // an "eating" bob: the head and body dip until the beak touches the ground, then come back up (k goes 0 -> 1 -> 0)
  function eatK(now, period) {
    const p = (now % period) / period;
    if (p < 0.3) return 0;
    if (p < 0.45) { const u = (p - 0.3) / 0.15; return u * u * (3 - 2 * u); }
    if (p < 0.6) return 1;
    if (p < 0.78) { const u = (0.78 - p) / 0.18; return u * u * (3 - 2 * u); }
    return 0;
  }
  const LIE_HEAD = 38, LIE_DY = 3, TAIL_DROP = 88;
  const SLEEPK = { sit: 1, tl: 1, lie: 1, leg: 1, hd: 1, eye: 1 };
  const PROPS = { cap: 1, scarf: 1, bag: 1, jack: 1, gl: 1, tool: 1 };
  const legTf = (ang, x, k) => "rotate(" + R(ang) + " " + x + " 20)" + (k < 0.995 ? " translate(" + x + " 20) scale(1 " + k.toFixed(2) + ") translate(-" + x + " -20)" : "");
  function posture(w, now, dt) {
    const h = w.h, sm = w.sm;
    // the slow, smooth changes: sitting down, folding the legs, head drooping, eyes closing, and starting / stopping the walking stride
    const slp = h.act === "sleep", sl = slp && h.sleepAge >= 0, wk = h.act === "walk" || h.act === "corner" || (slp && !sl && h.vcur > 1.5);
    const dr = h.act === "dress", on = (i) => i < w.dressStep || (dr && h.ditem === i && h.dt >= DRESS_AT[i]) ? 1 : 0;
    const a = 1 - Math.exp(-dt * 8), ap = 1 - Math.exp(-dt * 1.4), as = 1 - Math.exp(-dt * 3); // (the outfit eases on slowly; so does settling down to sleep)
    const T = { sit: sl ? 1 : 0, tl: sl ? 1 : 0, lie: sl && h.lie ? 1 : 0, leg: sl ? 0 : 1, hd: sl ? 13 : 0, eye: sl ? 1 : 0, walk: wk ? 1 : 0, scarf: on(0), jack: on(1), bag: on(2), gl: on(4), cap: on(5), tool: dr && h.ditem === 3 && h.dt > 0.2 && h.dt < 4 ? 1 : 0, sg: h.act === "idle" && h.sing ? 1 : 0 };
    let moving = false;
    for (const k in T) {
      const d = T[k] - sm[k];
      if (Math.abs(d) > 0.02) { sm[k] += d * (PROPS[k] ? ap : sl && SLEEPK[k] ? as : a); moving = true; } else sm[k] = T[k];
    }
    if (sm.sg > 0.02) moving = true; // (dancing: the poses keep changing, so the loop keeps running)
    sm.settled = !moving;
    // otherwise the poses change in small steps, 10 times a second (a chunky little "pixel pet" feel, and each change costs a bit)
    const pt = Math.floor(now / 100), tn = pt * 100;
    if (!moving && w.poseTick === pt) return;
    w.poseTick = pt;
    let l1 = 0, l2 = 0, wing = 0, hop = 0, wag = 0, head = sm.hd + LIE_HEAD * sm.lie - SING_HEAD * sm.sg, dy = LIE_DY * sm.lie, tilt = -SING_LEAN * sm.sg; // (sometimes she sleeps with her head right down on the ground)
    const stride = [1, 0, -1, 0][pt & 3] * 24 * sm.walk;
    if (sl) head += 3 * Math.max(0, Math.min(1, (4.2 - h.sleepAge) / 0.8)) * Math.sin(tn / 413); // (nods while the z z z are showing, then is still)
    else if (dr) { // (the getting-dressed show: a different little move for each piece)
      const t = h.dt, it = h.ditem;
      if (it === 0) { if (t < 0.8) { wing = pt & 1; tilt = -3; } else if (t < 1.5) head += 12; } // the scarf
      else if (it === 1) { if (t < 0.9) { wing = pt & 1; tilt = -4; } else if (t < 1.6) tilt = 4; } // shakes her wings out, wiggles into the jacket
      else if (it === 2) { if (t < 0.8) head += 22; else if (t < 1.5) head += 8; } // looks down, the satchel goes on
      else if (it === 3) { if (t < 4.2) head += 12 + 5 * Math.sin(t * 8); else head += 3; } // the comb: the head dips and she combs the crest
      else if (it === 4) { if (t < 1) head += 16; else { head -= 6; tilt = -4; } } // sunglasses, then the cool pose
      else if (t < 1) head -= 10; else if (t < 1.7) head += 12; else if (t < 2.6) head += 8; else { head -= 8; tilt = -6; wing = t < 3.2 ? pt & 1 : 0; } // the cap drops on, then she is done - proud
    }
    else if (sm.sg > 0.02) { const d = danceOf(pt, sm.sg); l1 = d.leg; l2 = -d.leg; wing = d.wing ? 1 : 0; hop = -d.hop; tilt += d.sway; head += d.nod; wag = d.wag; } // (singing: she dances too)
    else if (h.air) { l1 = 38; l2 = -28; wing = pt & 1; }
    else if (h.act === "corner") {
      l1 = stride; l2 = -stride;
      if (h.ph === "wall") wing = pt & 1;
    } else if (h.act === "walk" || h.act === "peck" || sm.walk > 0.02) {
      l1 = stride; l2 = -stride;
      if (h.act === "peck" || (h.act === "walk" && h.graze)) { // eating: the head and body dip until the beak touches the ground
        const k = eatK(tn, h.act === "peck" ? 900 : 1200);
        head += 40 * k; dy = 4 * k; tilt = 30 * k;
      }
    }
    setPart(w, "l1", legTf(l1, 11.6, sm.leg));
    setPart(w, "l2", legTf(l2, 15.8, sm.leg));
    setPart(w, "tail", sm.tl < 0.01 && !wag ? "" : "rotate(" + R(-TAIL_DROP * sm.tl + wag) + " 8.5 12.5)"); // (asleep, the back feathers droop down)
    setPart(w, "wing", "translate(16.5 13) rotate(" + (wing ? 52 : 0) + ") scale(" + (wing ? 1.2 : 1) + ") translate(-16.5 -13)");
    setPart(w, "head", "translate(0 " + R(dy) + ") rotate(" + R(head) + " 18 11)");
    setPart(w, "cap", "translate(0 " + R(-(1 - sm.cap) * 8) + ") translate(20 6.9) scale(" + Math.max(0.001, sm.cap).toFixed(2) + ") translate(-20 -6.9)");
    setPart(w, "jack", "translate(13.6 15) scale(" + Math.max(0.001, sm.jack).toFixed(2) + ") translate(-13.6 -15)");
    setPart(w, "gl", "translate(0 " + R(-(1 - sm.gl) * 4) + ") translate(21.4 8.6) scale(" + Math.max(0.001, sm.gl).toFixed(2) + ") translate(-21.4 -8.6)");
    setPart(w, "tool", sm.tool < 0.01 ? "scale(0.001)" : "translate(" + R(18.6 + 3.4 * Math.sin(tn / 90) * sm.tool + 1.5) + " " + R(1.6 + 1.2 * Math.cos(tn / 150)) + ") rotate(-22) scale(" + Math.max(0.001, sm.tool).toFixed(2) + ")"); // (the comb: only wiggles while it is in use, otherwise one fixed hidden pose - nothing to redraw)
    setPart(w, "scarf", "translate(19 12.5) scale(" + Math.max(0.001, sm.scarf).toFixed(2) + ") translate(-19 -12.5)");
    setPart(w, "bag", "translate(12 18.5) scale(" + Math.max(0.001, sm.bag).toFixed(2) + ") translate(-12 -18.5)");
    setPart(w, "all", (hop ? "translate(0 " + R(hop) + ") " : "") + "rotate(" + R(tilt) + " 14 24.5)");
    setPart(w, "eye", "translate(21.4 8.2) scale(1 " + Math.max(0.05, 1 - sm.eye).toFixed(2) + ") translate(-21.4 -8.2)");
    const ez = sm.eye > 0.5 ? "1" : "0";
    if (w.eyez !== ez) { w.eyez = ez; w.parts.eyez.setAttribute("opacity", ez); }
  }

  function draw(w, now, dt) {
    const h = w.h, e = w.e;
    const bob = h.act === "walk" && !h.air ? Math.abs(Math.sin(now / 90)) * 1.1 : 0;
    // the panel's top corners are rounded: near them the edge dips, so the pets sink with it instead of hovering
    const dip = (cx) => surfaceDip(w, cx);
    let tx = h.x, ty;
    if (h.act === "corner") { tx = h.px - HEN_W / 2; ty = -h.y + (h.ph === "grab" ? h.dip0 * (1 - Math.min(1, h.t)) : 0); } // (climbing: her feet on the wall line)
    else ty = dip(h.x + HEN_W / 2) * (h.air ? Math.max(0, Math.min(1, 1 - h.y / 12)) : 1) - h.y - bob + w.sm.sit * 3.6; // (asleep she sits right down: the folded legs are gone, so the body is lowered by their length and really touches the panel; in the air she is measured from the top level of the panel, not from the dipping corner)
    const ht = "translate3d(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px,0) rotate(" + h.rot.toFixed(1) + "deg)";
    if (w.henT !== ht) { w.henT = ht; w.hen.style.transform = ht; }
    // fades out of sight as she goes down over the corner, and back in as she returns
    const dd = Math.min(h.x + HEN_W / 2, w.W - h.x - HEN_W / 2);
    const down = h.act === "corner" && (h.ph === "down" || h.ph === "hold" || h.ph === "up");
    const op = down ? Math.max(0, Math.min(1, (h.D + h.y) / 40)) : h.act === "corner" || h.air ? 1 : Math.max(0, Math.min(1, (dd + 14) / 10)); // (only at the bottom of the way down the side does she fade out) // (no dulling on the corners: fully solid until she is mostly past the screen's edge)
    const ops = op >= 0.97 ? "" : op.toFixed(1);
    if (w.henOp !== ops) { w.henOp = ops; w.hen.style.opacity = ops; }
    const flip = h.dir < 0 ? "scaleX(-1)" : "";
    if (w.flip !== flip) { w.henSvg.style.transform = flip; w.flip = flip; }
    let cls = "pt-hen";
    if (h.act === "sleep") cls += " is-sleep" + (h.sleepAge > 0.6 && h.sleepAge < 4.4 ? " is-zzz" : "");
    if (h.act === "idle" && h.sing) cls += " is-sing";
    if (h.song) cls += h.songL ? " is-song song-l" : " is-song"; // (the notes keep floating away until the last one is gone, even after the song itself is over)
    if (h.dir < 0) cls += " face-l";
    if (w.cls !== cls) { w.hen.className = cls; w.cls = cls; }
    posture(w, now, dt);
    drawExtras(w, now, dt);
    const et = "translate3d(" + e.x.toFixed(1) + "px," + (dip(e.x + EGG_W / 2) - e.y).toFixed(1) + "px,0)";
    if (w.eggT !== et) { w.eggT = et; w.egg.style.transform = et; }
    const er = "rotate(" + Math.round((e.rot % 360) / 2) * 2 + "deg)";
    if (w.eggR !== er) { w.eggR = er; w.eggSvg.style.transform = er; }
  }

  // ---- the loop: only while the panel is opened out (or still folding) ----
  // Light on the phone: the movement runs every frame (so the movement stays smooth), with the poses only changing 10 times a second, and the panel's position is only measured now and then
  // (every frame only while the panel is sliding open / folding or a finger is dragging it).
    let raf = 0, last = 0, stopTimer = 0, tick = 0, touching = false, touchTimer = 0, rects = null;
  const touchOn = () => { world.slow = false; touching = true; clearTimeout(touchTimer); if (!raf && trk.classList.contains("is-open")) start(); }; // (a finger on the panel while she sleeps: the loop runs again so she goes with the panel)
  const touchOff = () => { clearTimeout(touchTimer); touchTimer = setTimeout(() => { touching = false; }, 500); };
  trk.addEventListener("touchstart", touchOn, { passive: true });
  trk.addEventListener("touchend", touchOff, { passive: true });
  trk.addEventListener("touchcancel", touchOff, { passive: true });
  function measure(w) {
    const slides = [...trk.querySelectorAll(".trk-slide")];
    let sl = w.anchorCode ? slides.find((x) => x.dataset.code === w.anchorCode) : null; // (the order's panel they stand on - it carries them along while it is swiped)
    if (!sl) { sl = trk.querySelector(".trk-slide.is-cur") || slides[0]; if (sl) { w.anchorCode = sl.dataset.code || ""; } }
    const det = sl && sl.querySelector(".trk-detail");
    const tr = trk.getBoundingClientRect();
    const dr = det ? det.getBoundingClientRect() : null;
    if (!dr || dr.height < 8 || tr.width < 80) { rects = null; return false; }
    const sr = sl.getBoundingClientRect();
    w.anchorIdx = slides.indexOf(sl);
    rects = { left: sr.left, right: sr.right, width: sr.width, top: dr.top }; // (the panel's corner radius: she walks along the curve)
    w.rN = (w.rN || 0) + 1;
    if (w.rSl !== sl || !(w.r > 0) || !(w.rN % 8)) { w.rSl = sl; w.r = Math.max(parseFloat(getComputedStyle(sl || trk).borderTopLeftRadius) || 0, parseFloat(getComputedStyle(trk).borderTopLeftRadius) || 0); } // (the corner radius: read again for another order's panel, while it is still 0 - the panel may not have its round corners yet when it is first measured - and every few measures)
    if (Math.abs(w.W - sr.width) > 0.5) { w.W = sr.width; layer.style.width = sr.width + "px"; fitExtras(w); }
    if (!w.placed) restoreEggs(w);
    if (!w.placed) { // (first time she is shown after a page load: a different spot, direction and egg place every time)
      w.placed = true;
      const W = w.W, hs = Math.max(0, W - HEN_W - 40);
      w.h.x = 20 + Math.random() * hs; w.h.dir = Math.random() < 0.5 ? -1 : 1;
      let ex = 0, tries = 0;
      do { ex = 20 + Math.random() * Math.max(0, W - EGG_W - 40); } while (Math.abs(ex - w.h.x) < 50 && ++tries < 12);
      w.e.x = ex;
      w.h.t = 0.2 + Math.random() * 1.2;
    }
    w.ready = sl.classList.contains("is-ready"); // (the order she stands on is Packed)
    w.roomL = tr.left; w.roomR = window.innerWidth - tr.right; w.topY = dr.top;
    return true;
  }
  // Several orders: the pets stand on one order's panel and ride along while it is swiped. As soon as another order takes over the screen (more than half of
  // it is showing) the hen flies across to that one, the egg in her feet - so they are always on a panel that is on screen, never gone.
  function checkDominant(w, now) {
    const h = w.h;
    if (h.xfer || h.air || (h.act === "corner" && h.ph !== "down" && h.ph !== "hold" && h.ph !== "up")) { w.chk = true; return; } // (not while she is in the air / on the wall: looked at again after she has landed)
    const sc = trk.querySelector(".trk-scroll"), slides = [...trk.querySelectorAll(".trk-slide")];
    if (!sc || !sc.clientWidth || slides.length < 2) return;
    const idx = Math.max(0, Math.min(slides.length - 1, Math.round(sc.scrollLeft / sc.clientWidth)));
    const to = slides[idx], from = slides.find((x) => x.dataset.code === w.anchorCode);
    if (!to || !to.dataset.code || to.dataset.code === w.anchorCode) { w.domSince = 0; return; }
    if (!w.domSince) { w.domSince = now; return; }
    if (now - w.domSince < 90) return; // (it must stay the main one for a moment)
    w.domSince = 0;
    startXfer(w, to, from);
  }
  function startXfer(w, to, from) {
    const h = w.h, e = w.e, W = w.W;
    const dT = to.querySelector(".trk-detail").getBoundingClientRect();
    let x0, y0, ex, ey;
    if (h.act === "corner") { h.x = h.px - HEN_W / 2; h.ph = ""; } // (taken off the wall: flies from where she is)
    if (from && from.querySelector(".trk-detail")) { // (she takes off from where she stands, the egg from where it lies: the same spot on the screen)
      const dF = from.querySelector(".trk-detail").getBoundingClientRect(), dx = dT.left - dF.left, dy = dT.top - dF.top;
      x0 = h.x - dx; y0 = h.y + dy; ex = w.e.x - dx; ey = w.e.y + dy;
    } else { const left = [...trk.querySelectorAll(".trk-slide")].indexOf(to) > w.anchorIdx; x0 = left ? -HEN_W - 6 : W + 6; y0 = 10; ex = x0; ey = 0; }
    const dir = x0 < W / 2 ? 1 : -1; // (flies on towards the middle of the new panel)
    const x1 = dir > 0 ? 34 + Math.random() * 40 : W - HEN_W - 34 - Math.random() * 40;
    clearTimeout(wakeTimer); w.wakeAt = 0; w.deep = false; w.hidePause = false;
    h.act = "fly"; h.air = true; h.toCorner = false; h.toSide = false; h.afterHide = false; h.graze = false; h.slide = 0; h.vcur = 0; h.vx = 0; h.vy = 0; h.sleepAge = 0; h.t = 0; h.dir = dir;
    h.x = x0; h.y = y0;
    // straight over, from exactly where they are: she flies in a straight line to the new panel's top edge, the egg flies on its own from where it lies to just beside her landing place
    const dist = Math.hypot(x1 - x0, y0), ex1 = Math.max(2, Math.min(W - EGG_W - 2, x1 + HEN_W / 2 - EGG_W / 2 - dir * 22));
    h.xfer = { t: 0, dur: Math.max(0.7, Math.min(1.5, 0.5 + dist / 380)), x0, y0, x1, ex0: ex, ey0: ey, ex1 };
    e.x = ex; e.y = ey; e.vx = 0; e.vy = 0;
    w.anchorCode = to.dataset.code; w.anchorIdx = [...trk.querySelectorAll(".trk-slide")].indexOf(to);
    if (measure(w)) { w.layerT = ""; placeLayer(w); } // (the strip of pets now stands on the new panel, the same frame)
  }
  const ease = (u) => u * u * (3 - 2 * u);
  function xferStep(w, dt) {
    const h = w.h, e = w.e, x = h.xfer;
    x.t += dt;
    const u = Math.min(1, x.t / x.dur), k = ease(u);
    h.x = x.x0 + (x.x1 - x.x0) * k;
    h.y = x.y0 * (1 - k) + 5 * Math.sin(Math.PI * u); // (straight, with a little lift from the flapping)
    e.x = x.ex0 + (x.ex1 - x.ex0) * k; e.y = x.ey0 * (1 - k) + 6 * Math.sin(Math.PI * u); e.vx = 0; e.vy = 0; e.rot += dt * 200 * (x.ex1 > x.ex0 ? 1 : -1) * (1 - u);
    h.vy = 0;
    if (u >= 1) { h.xfer = null; h.air = false; h.act = "idle"; h.t = rand(0.5, 1); h.y = 0; h.vx = 0; h.flap = 0; e.x = x.ex1; e.y = 0; e.vx = 0; e.vy = 0; }
  }
  function placeLayer(w) {
    const lt = "translate3d(" + rects.left.toFixed(1) + "px," + (rects.top - LAYER_H + 2.5).toFixed(1) + "px,0)";
    if (w.layerT !== lt) { w.layerT = lt; layer.style.transform = lt; }
  }
  let scrollAt = -1e9;
  trk.addEventListener("scroll", (ev) => { if (!ev.target.classList || !ev.target.classList.contains("trk-scroll")) return; scrollAt = performance.now(); world.slow = false; world.chk = true; if (!raf && trk.classList.contains("is-open")) start(); }, { capture: true, passive: true });
  let slowT = 0;
  function killLoop() { cancelAnimationFrame(raf); clearTimeout(slowT); raf = 0; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const w = world;
    if (!allowed()) { layer.classList.remove("is-on"); w.layerOn = false; killLoop(); return; } // switched off by the admin
    const scrolling = now - scrollAt < 260; // (the orders are being swiped sideways)
    if (!(++w.n % 45)) w.chk = true; // (now and then, to be sure they are on an order that is on screen)
    if (scrolling || w.domSince || w.chk) { if (!scrolling) w.chk = false; checkDominant(w, now); }
    const moving = touching || scrolling || trk.classList.contains("is-opening") || trk.classList.contains("is-closing");
    if (moving || !rects || !(tick++ % 30)) { // (the panel's place: every frame while it moves, otherwise about twice a second)
      if (!measure(w)) { layer.classList.remove("is-on"); return; }
    }
    const dt = Math.min(0.06, Math.max(0, (now - last) / 1000));
    last = now;
    placeLayer(w);
    const on = trk.classList.contains("is-open");
    if (w.layerOn !== on) { w.layerOn = on; layer.classList.toggle("is-on", on); }
    step(w, dt);
    draw(w, now, dt);
    const still = w.h.act === "sleep"; // (while she sleeps the panel's own looping pulses hold still too: nothing on the page keeps the browser busy)
    if (still !== w.stillOn) { w.stillOn = still; if (still) trk.setAttribute("data-pets-still", ""); else trk.removeAttribute("data-pets-still"); }
    w.slow = !moving && !egActive && !w.h.air && !w.h.xfer && w.h.act !== "corner" && w.h.act !== "jump" && w.h.act !== "fly" && w.e.y < 0.05 && !w.e.vy && Math.abs(w.e.vx) < 1;
    if ((w.deep || w.hidePause) && !moving && trk.classList.contains("is-open")) pauseForSleep(w); // fast asleep and everything still: stop the loop altogether, until she wakes (not while the panel is being moved)
    else if (!moving && w.slow && w.h.act === "idle" && w.sm.settled && w.h.t > 0.4 && !w.domSince && !w.chk && extrasIdle() && trk.classList.contains("is-open")) pauseIdle(w); // standing still, nothing changing: the loop stops until she is due to move
    else if (w.slow && raf > 0) { cancelAnimationFrame(raf); raf = -1; clearTimeout(slowT); slowT = setTimeout(() => { raf = requestAnimationFrame(frame); }, w.h.act === "sleep" ? 55 : 24); } // (calm things - standing, pecking, a slow walk, settling down to sleep - are drawn 30 (sleep: 15) times a second, and between two frames nothing at all wakes the page up: a quarter to half the style work, the same look at that slow speed)
  }
  let wakeTimer = 0;
  function pauseForSleep(w) {
    killLoop();
    if (!w.pauseAt) w.pauseAt = performance.now();
    trk.setAttribute("data-pets-still", ""); // (nothing moves: the panel's own looping pulse stops too, so the page does no work at all until she wakes)
    if (!w.wakeAt) w.wakeAt = performance.now() + Math.max(0, w.h.t) * 1000;
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      w.wakeAt = 0; w.deep = false; w.hidePause = false; w.h.t = 0; // (the next frame wakes her)
      if (trk.classList.contains("is-open")) start();
    }, Math.max(0, w.wakeAt - performance.now()) + 20);
  }
  // A short stand-still (she just stands there, the egg lies still, nothing is changing): the loop stops completely - no frames, no style work - and a timer
  // starts it again when she is due to move. The clocks (her wait, the cool-downs) are given the time that went by.
  let idleTimer = 0;
  function pauseIdle(w) {
    killLoop();
    w.napAt = performance.now(); w.napDur = w.h.t;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (trk.classList.contains("is-open")) start(); else w.napAt = 0; }, Math.max(0, w.h.t - 0.05) * 1000);
  }
  function endNap(w) {
    clearTimeout(idleTimer);
    if (!w.napAt) return false;
    const sk = Math.max(0, Math.min((performance.now() - w.napAt) / 1000, w.napDur + 0.1)), h = w.h;
    w.napAt = 0;
    h.t -= sk; w.e.t -= sk; h.sideCool -= sk; h.flyCool -= sk; h.cool -= sk; h.sleepCool -= sk; h.singCool -= sk; w.modeT -= sk; w.dressGap -= sk; w.since += sk; w.wait += sk; w.spawnCool -= sk; extrasCatchUp(sk);
    return true;
  }
  function start() {
    clearTimeout(stopTimer);
    if (raf || animationsOff() || !allowed()) return;
    trk.removeAttribute("data-pets-still"); world.stillOn = false;
    if (world.pauseAt) { extrasCatchUp(Math.min(30, (performance.now() - world.pauseAt) / 1000)); world.pauseAt = 0; }
    const napped = endNap(world);
    last = performance.now(); rects = null; if (!napped) world.since = 0;
    raf = requestAnimationFrame(frame);
  }
  const w0 = world;
  function stopSoon() {
    layer.classList.remove("is-on"); w0.layerOn = false; // (they fade away as the panel folds)
    clearTimeout(stopTimer); clearTimeout(idleTimer); w0.napAt = 0; trk.removeAttribute("data-pets-still");
    stopTimer = setTimeout(() => {
      killLoop();
      const sm = w0.sm; w0.ready = false; w0.wasReady = false; w0.dressStep = 0; w0.dressGap = 1.2; sm.cap = sm.scarf = sm.bag = sm.jack = sm.gl = sm.tool = 0; // (folded: the outfit is off; she gets dressed again next time it opens)
      if (w0.h.act === "dress") { w0.h.act = "idle"; w0.h.t = 0.5; }
      for (const x of extras) { x.dn = 0; x.dg = rand(2, 7); if (x.act === "dress") { x.act = "idle"; x.t = 0.5; } for (const k in x.dm) x.dm[k] = 0; } // (folded: the extra hens' costumes come off too)
    }, 450);
  }

  // Signing out: the extra hens and the laid eggs are cleared (and their counting starts again), so the next customer starts with just the first hen and egg.
  // (Noticed from the website's own "who is signed in" events: the saved phone number was there and is gone.)
  const phoneNow = () => { try { return localStorage.getItem("freshcutz_profile_phone") || ""; } catch (e) { return ""; } };
  let hadPhone = !!phoneNow();
  function clearAll() {
    for (const x of extras) x.el.remove();
    extras.length = 0;
    for (const g of layEggs) g.el.remove();
    layEggs.length = 0; egActive = 0; egT = rand(8, 14);
    try { localStorage.removeItem(EGG_KEY); } catch (e) {}
    const w = world;
    w.naps = 0; w.napsSince = 0; w.eggNeed = 5; w.rest = 0; w.wait = 0; w.layEgg = false; w.spawnCool = P.spawn0;
  }
  function checkSignOut() { const has = !!phoneNow(); if (hadPhone && !has) clearAll(); hadPhone = has; }
  ["freshcutz:who", "freshcutz:name", "freshcutz:profile"].forEach((ev) => window.addEventListener(ev, checkSignOut));

  if (window.MutationObserver) {
    new MutationObserver(() => { if (trk.classList.contains("is-open")) start(); else { if (!raf && w0.layerOn) { last = performance.now(); raf = requestAnimationFrame(frame); } stopSoon(); } }).observe(trk, { attributes: true, attributeFilter: ["class"] }); // (folding while she sleeps: the loop runs again for a moment so they sink with the panel)
  }
  if (window.MutationObserver) { // the strip was drawn again (the order's status changed) while she is fast asleep: wake her up to see it
    new MutationObserver(() => {
      if ((w0.deep || w0.hidePause || w0.napAt) && trk.classList.contains("is-open")) { clearTimeout(wakeTimer); w0.wakeAt = 0; w0.deep = false; w0.hidePause = false; w0.h.t = 0; start(); }
    }).observe(trk, { childList: true });
  }
  if (trk.classList.contains("is-open")) start();
})();
