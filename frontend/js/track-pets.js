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

  const HEN_W = 26, EGG_W = 12, G = 260; // sizes in px; gravity in px/s^2
  const HEN_SVG =
    "<svg viewBox=\"0 0 28 26\" aria-hidden=\"true\" focusable=\"false\">" +
    "<g class=\"pt-all\">" +
    "<g class=\"pt-leg pt-l1\"><path d=\"M11.6 20v4.2M10 24.8l1.6-.9 1.6.9\" fill=\"none\" stroke=\"#e8921a\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>" +
    "<g class=\"pt-leg pt-l2\"><path d=\"M15.8 20v4.2M14.2 24.8l1.6-.9 1.6.9\" fill=\"none\" stroke=\"#e8921a\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g>" +
    "<g fill=\"#f6e6c2\" stroke=\"#9b7440\" stroke-width=\"1\">" +
    "<ellipse cx=\"4.3\" cy=\"11.4\" rx=\"1.6\" ry=\"4.7\" transform=\"rotate(-52 4.3 11.4)\"/>" +
    "<ellipse cx=\"5.4\" cy=\"9.3\" rx=\"1.6\" ry=\"4.7\" transform=\"rotate(-22 5.4 9.3)\"/>" +
    "<ellipse cx=\"7.4\" cy=\"8.5\" rx=\"1.5\" ry=\"4.2\" transform=\"rotate(8 7.4 8.5)\"/>" +
    "</g>" +
    "<ellipse cx=\"13.6\" cy=\"15\" rx=\"9\" ry=\"6.6\" fill=\"#fffaf0\" stroke=\"#9b7440\" stroke-width=\"1\"/>" +
    "<g class=\"pt-wing\">" +
    "<path d=\"M8.6 14.2c1.6-2.2 6.4-2.5 8.9.6-1.6 3.2-6.6 3.5-8.9-.6Z\" fill=\"#f2dbab\" stroke=\"#9b7440\" stroke-width=\".8\" stroke-linejoin=\"round\"/>" +
    "<path d=\"M10.4 14.9c1.3-.5 2.7-.5 3.9.1M11.3 16.6c1.1-.3 2.2-.3 3.1.1\" fill=\"none\" stroke=\"#c9a56a\" stroke-width=\".6\" stroke-linecap=\"round\"/>" +
    "</g>" +
    "<ellipse cx=\"22.8\" cy=\"12.4\" rx=\".95\" ry=\"1.5\" fill=\"#e0412f\" stroke=\"#a82518\" stroke-width=\".5\"/>" +
    "<g class=\"pt-head\">" +
    "<g fill=\"#e0412f\" stroke=\"#a82518\" stroke-width=\".7\"><circle cx=\"18.1\" cy=\"5.2\" r=\"1.45\"/><circle cx=\"20.1\" cy=\"4.2\" r=\"1.55\"/><circle cx=\"22\" cy=\"5.2\" r=\"1.4\"/></g>" +
    "<circle cx=\"20\" cy=\"8.7\" r=\"4.3\" fill=\"#fffaf0\" stroke=\"#9b7440\" stroke-width=\"1\"/>" +
    "<path d=\"M24 8.1l2.8.9-2.8 1.1Z\" fill=\"#f5a623\" stroke=\"#c9801a\" stroke-width=\".6\" stroke-linejoin=\"round\"/>" +
    "<circle cx=\"20.3\" cy=\"10.4\" r=\".95\" fill=\"#f7b9a6\" opacity=\".8\"/>" +
    "<g class=\"pt-eye\"><circle cx=\"21.4\" cy=\"8.2\" r=\"1\" fill=\"#2b1d0e\"/><circle cx=\"21.7\" cy=\"7.9\" r=\".35\" fill=\"#fff\"/></g>" +
    "<path class=\"pt-eyez\" opacity=\"0\" d=\"M20.3 8.4q1.2 1.1 2.4 0\" fill=\"none\" stroke=\"#2b1d0e\" stroke-width=\".8\" stroke-linecap=\"round\"/>" +
    "</g></g></svg>";
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
    ? { cool0: 1, climbCool: [3, 6], climbP: 0.7, flyCool0: 6, flyCool: [12, 20], flyP: 0.25, sleepCool0: 3, sleepCool: 12, nap: [9, 11], eggHop: [3, 6], eggT0: [2, 4], modeT: [5, 8], modes: ["wander", "follow", "chase"], kickWait: [6, 9], thr: [0.3, 0.4, 0.55, 0.75, 0.92] }
    : { cool0: 8, climbCool: [14, 26], climbP: 0.6, flyCool0: 25, flyCool: [30, 55], flyP: 0.2, sleepCool0: 45, sleepCool: 90, nap: [12, 20], eggHop: [18, 35], eggT0: [15, 25], modeT: [9, 15], modes: ["wander", "wander", "wander", "wander", "wander", "wander", "wander", "follow", "chase"], kickWait: [14, 22], thr: [0.5, 0.68, 0.85, 0.91, 0.96] };

  // ---- the little world: one strip of pets, fixed on screen, standing on the top edge of the opened panel ----
  const LAYER_H = 28;
  const layer = document.createElement("div");
  layer.className = "trk-pets";
  layer.setAttribute("aria-hidden", "true");
  const henEl = document.createElement("div");
  henEl.className = "pt-hen";
  henEl.innerHTML = HEN_SVG + '<div class="pt-zzz" aria-hidden="true"><i>z</i><i>Z</i><i>z</i></div>';
  const eggEl = document.createElement("div");
  eggEl.className = "pt-egg";
  eggEl.innerHTML = EGG_SVG;
  layer.append(eggEl, henEl);
  document.body.appendChild(layer);

  const world = {
    hen: henEl, egg: eggEl, henSvg: henEl.firstChild, eggSvg: eggEl.firstChild, W: 300, frames: 0, r: 20, roomL: 0, roomR: 0, topY: 200,
    h: { x: 100, dir: 1, act: "idle", t: 0.4, speed: 24, y: 0, vy: 0, vx: 0, air: false, flap: 0, ph: "", side: -1, px: 0, px0: 0, rot: 0, rotT: 0, out: false, H: 60, slip: false, slipT: 0, graze: false, vcur: 0, afterHide: false, dip0: 0, slide: 0, sleepAge: 0, flyCool: P.flyCool0, cool: P.cool0, sleepCool: P.sleepCool0, toCorner: false },
    e: { x: 134, y: 0, vx: 0, vy: 0, rot: 0, t: rand(P.eggT0[0], P.eggT0[1]), kick: 0 },
    mode: "wander", modeT: rand(3, 6),
    deep: false, wakeAt: 0, sm: { sit: 0, leg: 1, hd: 0, eye: 0, walk: 0, settled: true },
    pose: {}, // (the last pose drawn, so a part is only touched when it actually changed)
    parts: {
      all: henEl.querySelector(".pt-all"), l1: henEl.querySelector(".pt-l1"), l2: henEl.querySelector(".pt-l2"),
      wing: henEl.querySelector(".pt-wing"), head: henEl.querySelector(".pt-head"),
      eye: henEl.querySelector(".pt-eye"), eyez: henEl.querySelector(".pt-eyez"),
    },
  };

  // The panel's top corners are rounded. She walks ALONG them: sinking and leaning with the curve, and on past the corner a little way
  // down the side, where she fades out of sight, waits a moment, and comes walking back in. (surface* work on her centre x, in the strip's px.)
  const EXTRA = 16; // how far down the side she may go (hidden there)
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

  function newAct(w) {
    const h = w.h;
    h.toCorner = false;
    const cxNow = h.x + HEN_W / 2;
    if (h.afterHide || Math.min(cxNow, w.W - cxNow) < w.r + 6) { // (coming back from over the edge, or still on the curve: walk back onto the flat top)
      h.afterHide = false; h.dir = cxNow < w.W / 2 ? 1 : -1; h.graze = false;
      h.act = "walk"; h.t = rand(1.2, 2.2); h.speed = 22; return;
    }
    const r = Math.random();
    const room = h.dir > 0 ? w.W - HEN_W - h.x : h.x;
    const canCorner = w.W >= 160 && h.cool <= 0;
    if (r < P.thr[0]) { // walk (turning back if there is hardly any room that way)
      if (room < 30 || Math.random() < 0.22) h.dir = -h.dir;
      h.graze = Math.random() < 0.35; // (only some walks are spent pecking at the ground)
      h.act = "walk"; h.t = rand(1.4, 4); h.speed = h.graze ? rand(11, 18) : rand(18, 30);
    } else if (r < P.thr[1]) { h.act = "idle"; h.t = rand(0.7, 2); }
    else if (r < P.thr[2]) { h.act = "peck"; h.t = rand(2.6, 5); } // (stands and eats for a good while)
    else if (r < P.thr[3] && canCorner) { // (rare) off to the nearest end of the panel to try climbing up its side
      h.dir = h.x + HEN_W / 2 < w.W / 2 ? -1 : 1;
      h.act = "walk"; h.t = 12; h.speed = 30; h.toCorner = true;
    } else if (r < P.thr[4] && h.sleepCool <= 0) { // (rare) a nap, with z z z
      h.act = "sleep"; h.t = rand(P.nap[0], P.nap[1]); h.sleepCool = P.sleepCool; h.sleepAge = 0;
    } else { h.act = "idle"; h.t = rand(0.7, 1.6); }
  }

  // The hen at the left / right end of the panel: she hops onto the side line of the panel, turns upright against it (on a phone, where the panel
  // fills the screen, she stands against the screen edge; on a wider screen she is outside the panel), climbs UP it for about 10% of the screen
  // height (sometimes slipping back once), and at the top she jumps off, floating back down onto the panel.
  function startCorner(w, side) {
    const h = w.h;
    h.cool = rand(P.climbCool[0], P.climbCool[1]);
    if (!h.toCorner && Math.random() > P.climbP) return;
    h.toCorner = false;
    h.act = "corner"; h.ph = "grab"; h.side = side; h.t = 0; h.y = 0; h.px0 = h.x + HEN_W / 2; h.px = h.px0; h.dip0 = surfaceDip(w, h.px0); // (px must be set at once: the very next draw uses it)
    h.out = (side < 0 ? w.roomL : w.roomR) >= 30; // room outside the panel? then she is outside it
    h.rotT = (h.out ? side : -side) * 90; // (the way she leans: body outwards, or inwards when there is no room outside)
    h.dir = h.rotT > 0 ? -1 : 1; // (so that "forward" is up the wall)
    h.H = Math.max(30, Math.min(0.1 * window.innerHeight, w.topY - 40)); // how high she climbs: 10% of the screen height (kept on screen)
    h.slip = Math.random() < 0.6; h.slipT = 0;
  }
  function cornerStep(w, dt) {
    const h = w.h, wallX = h.side < 0 ? 0 : w.W;
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
        h.act = "jump"; h.air = true; h.ph = ""; h.dir = -h.side;
        h.x = h.px - HEN_W / 2; h.slide = -h.side * HEN_W / 2; // (she leaves from exactly where she was, then slides in as she turns upright)
        h.vx = -h.side * 46; h.vy = 70;
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
    if (w.modeT <= 0) { w.mode = pick(P.modes); w.modeT = rand(P.modeT[0], P.modeT[1]); if (h.act !== "sleep") h.t = 0; }
    e.kick -= dt;
    h.cool -= dt; h.sleepCool -= dt; h.flyCool -= dt;

    // the hen
    if (h.act === "sleep") {
      h.t -= dt; h.sleepAge += dt;
      if (h.t <= 0) { h.act = "idle"; h.t = 0.9; h.sleepAge = 0; w.deep = false; } // wakes: the pose eases back (see posture)
      else if (!w.deep && h.sleepAge > 4.7 && w.sm.settled && e.y <= 0 && Math.abs(e.vy) < 1 && Math.abs(e.vx) < 2) w.deep = true; // deep sleep: nothing moves, nothing is drawn
    } else if (h.air) airStep(w, dt);
    else if (h.act === "corner") cornerStep(w, dt);
    else {
      h.x = Math.min(Math.max(-HEN_W / 2 - EXTRA, h.x), W - HEN_W / 2 + EXTRA);
      h.t -= dt;
      if (w.mode === "chase") {
        const dx = e.x + EGG_W / 2 - (h.x + HEN_W / 2);
        if (Math.abs(dx) > 11) { h.act = "walk"; h.graze = false; h.dir = dx > 0 ? 1 : -1; h.speed = 38; }
        else if (e.kick <= 0 && e.y < 1) { // a kick: the egg flies off and rolls away
          e.vx = h.dir * rand(34, 52); e.vy = rand(22, 32); e.kick = 3; // (one gentle kick, then the game is over for a while)
          h.act = "idle"; h.t = 0.55; w.mode = "wander"; w.modeT = rand(P.kickWait[0], P.kickWait[1]);
        } else if (h.act === "walk") { h.act = "idle"; h.t = 0.3; }
      } else if (h.t <= 0) newAct(w);
      // she speeds up and slows down smoothly (no instant start / stop)
      const vt = h.act === "walk" ? h.speed : 0;
      h.vcur += (vt - h.vcur) * Math.min(1, dt * 5);
      if (vt === 0 && h.vcur < 0.4) h.vcur = 0;
      h.x += h.dir * h.vcur * dt;
      const cx = h.x + HEN_W / 2;
      if (h.act === "walk" && W >= 160 && w.mode !== "chase") {
        const towardEdge = (h.dir < 0 && cx <= 15) || (h.dir > 0 && cx >= W - 15);
        if (towardEdge && (h.cool <= 0 || h.toCorner)) startCorner(w, h.dir < 0 ? -1 : 1); // reached an end of the panel: maybe climb up its side
        else if (towardEdge && h.flyCool <= 0 && (h.dir < 0 ? cx <= 6 : cx >= W - 6) && Math.random() < P.flyP) { // (she only ever flies at the ends of the panel)
          h.act = "fly"; h.air = true; h.y = 0; h.vy = 95; h.vx = -h.dir * 32; h.dir = -h.dir; h.flap = 0.5; h.flyCool = rand(P.flyCool[0], P.flyCool[1]);
        }
      }
      if (h.act !== "corner" && !h.air) {
        const gone = cx <= -EXTRA || cx >= W + EXTRA; // all the way down the side, out of sight: waits a moment, then walks back in
        if (gone) {
          h.x = cx <= -EXTRA ? -EXTRA - HEN_W / 2 : W + EXTRA - HEN_W / 2;
          h.dir = cx <= -EXTRA ? 1 : -1; h.vcur = 0; h.act = "idle"; h.t = rand(0.8, 2); h.afterHide = true;
        }
      }
    }

    // lean smoothly (upright on the ground, along the wall when climbing, nose up / down in the air)
    h.rotT = h.act === "corner" ? h.rotT : h.air ? Math.max(-14, Math.min(14, -h.vy * 0.1 * h.dir)) : surfaceTilt(w, h.x + HEN_W / 2);
    h.rot += Math.max(-dt * 520, Math.min(dt * 520, h.rotT - h.rot));

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
        if (Math.abs(d) > 50) e.vx = Math.sign(d) * 14;
      }
      if (e.t <= 0) { // a small hop, rarely
        e.vy = rand(20, 28); e.vx = 0; e.t = rand(P.eggHop[0], P.eggHop[1]); // (a tiny hop, very rarely)
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
  const legTf = (ang, x, k) => "rotate(" + R(ang) + " " + x + " 20)" + (k < 0.995 ? " translate(" + x + " 20) scale(1 " + k.toFixed(2) + ") translate(-" + x + " -20)" : "");
  function posture(w, now, dt) {
    const h = w.h, sm = w.sm;
    // the slow, smooth changes: sitting down, folding the legs, head drooping, eyes closing, and starting / stopping the walking stride
    const sl = h.act === "sleep", wk = h.act === "walk" || h.act === "corner";
    const a = 1 - Math.exp(-dt * 8);
    const T = { sit: sl ? 1 : 0, leg: sl ? 0 : 1, hd: sl ? 13 : 0, eye: sl ? 1 : 0, walk: wk ? 1 : 0 };
    let moving = false;
    for (const k in T) {
      const d = T[k] - sm[k];
      if (Math.abs(d) > 0.02) { sm[k] += d * a; moving = true; } else sm[k] = T[k];
    }
    sm.settled = !moving;
    // otherwise the poses change in small steps, 10 times a second (a chunky little "pixel pet" feel, and each change costs a bit)
    const pt = Math.floor(now / 100), tn = pt * 100;
    if (!moving && w.poseTick === pt) return;
    w.poseTick = pt;
    let l1 = 0, l2 = 0, wing = 0, head = sm.hd, dy = 0, tilt = 0;
    const stride = [1, 0, -1, 0][pt & 3] * 24 * sm.walk;
    if (sl) head += 3 * Math.max(0, Math.min(1, (4.2 - h.sleepAge) / 0.8)) * Math.sin(tn / 413); // (nods while the z z z are showing, then is still)
    else if (h.air) { l1 = 38; l2 = -28; wing = pt & 1; }
    else if (h.act === "corner") {
      l1 = stride; l2 = -stride;
      if (h.ph === "wall") wing = pt & 1;
    } else if (h.act === "walk" || h.act === "peck" || sm.walk > 0.02) {
      l1 = stride; l2 = -stride;
      if (h.act === "peck" || (h.act === "walk" && h.graze)) { // eating: the head and body dip until the beak touches the ground
        const k = eatK(tn, h.act === "peck" ? 700 : 1000);
        head += 40 * k; dy = 4 * k; tilt = 30 * k;
      }
    }
    setPart(w, "l1", legTf(l1, 11.6, sm.leg));
    setPart(w, "l2", legTf(l2, 15.8, sm.leg));
    setPart(w, "wing", "translate(16.5 13) rotate(" + (wing ? 52 : 0) + ") scale(" + (wing ? 1.2 : 1) + ") translate(-16.5 -13)");
    setPart(w, "head", "translate(0 " + R(dy) + ") rotate(" + R(head) + " 18 11)");
    setPart(w, "all", "rotate(" + R(tilt) + " 14 24.5)");
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
    else ty = dip(h.x + HEN_W / 2) * (h.air ? Math.max(0, 1 - h.y / 12) : 1) - h.y - bob + w.sm.sit; // (in the air she is measured from the top level of the panel, not from the dipping corner)
    const ht = "translate3d(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px,0) rotate(" + h.rot.toFixed(1) + "deg)";
    if (w.henT !== ht) { w.henT = ht; w.hen.style.transform = ht; }
    // fades out of sight as she goes down over the corner, and back in as she returns
    const dd = Math.min(h.x + HEN_W / 2, w.W - h.x - HEN_W / 2);
    const op = h.act === "corner" || h.air ? 1 : Math.max(0, Math.min(1, (dd + 7) / 11));
    const ops = op >= 0.97 ? "" : op.toFixed(1);
    if (w.henOp !== ops) { w.henOp = ops; w.hen.style.opacity = ops; }
    const flip = h.dir < 0 ? "scaleX(-1)" : "";
    if (w.flip !== flip) { w.henSvg.style.transform = flip; w.flip = flip; }
    let cls = "pt-hen";
    if (h.act === "sleep") cls += " is-sleep" + (h.sleepAge > 0.6 && h.sleepAge < 4.4 ? " is-zzz" : "");
    if (h.dir < 0) cls += " face-l";
    if (w.cls !== cls) { w.hen.className = cls; w.cls = cls; }
    posture(w, now, dt);
    const et = "translate3d(" + e.x.toFixed(1) + "px," + (dip(e.x + EGG_W / 2) - e.y).toFixed(1) + "px,0)";
    if (w.eggT !== et) { w.eggT = et; w.egg.style.transform = et; }
    const er = "rotate(" + Math.round((e.rot % 360) / 2) * 2 + "deg)";
    if (w.eggR !== er) { w.eggR = er; w.eggSvg.style.transform = er; }
  }

  // ---- the loop: only while the panel is opened out (or still folding) ----
  // Light on the phone: the movement runs every frame (so the movement stays smooth), with the poses only changing 10 times a second, and the panel's position is only measured now and then
  // (every frame only while the panel is sliding open / folding or a finger is dragging it).
    let raf = 0, last = 0, stopTimer = 0, tick = 0, touching = false, touchTimer = 0, rects = null;
  const touchOn = () => { touching = true; clearTimeout(touchTimer); };
  const touchOff = () => { clearTimeout(touchTimer); touchTimer = setTimeout(() => { touching = false; }, 500); };
  trk.addEventListener("touchstart", touchOn, { passive: true });
  trk.addEventListener("touchend", touchOff, { passive: true });
  trk.addEventListener("touchcancel", touchOff, { passive: true });
  function measure(w) {
    const det = trk.querySelector(".trk-slide.is-cur .trk-detail") || trk.querySelector(".trk-detail");
    const tr = trk.getBoundingClientRect();
    const dr = det ? det.getBoundingClientRect() : null;
    if (!dr || dr.height < 8 || tr.width < 80) { rects = null; return false; }
    rects = { left: tr.left, right: tr.right, width: tr.width, top: dr.top };
    const sl = det.closest(".trk-slide"); // (the panel's corner radius: she walks along the curve)
    w.r = Math.max(parseFloat(getComputedStyle(sl || trk).borderTopLeftRadius) || 0, parseFloat(getComputedStyle(trk).borderTopLeftRadius) || 0);
    if (Math.abs(w.W - tr.width) > 0.5) { w.W = tr.width; layer.style.width = tr.width + "px"; }
    if (!w.placed) { // (first time she is shown after a page load: a different spot, direction and egg place every time)
      w.placed = true;
      const W = w.W, hs = Math.max(0, W - HEN_W - 40);
      w.h.x = 20 + Math.random() * hs; w.h.dir = Math.random() < 0.5 ? -1 : 1;
      let ex = 0, tries = 0;
      do { ex = 20 + Math.random() * Math.max(0, W - EGG_W - 40); } while (Math.abs(ex - w.h.x) < 50 && ++tries < 12);
      w.e.x = ex;
      w.h.t = 0.2 + Math.random() * 1.2;
    }
    w.roomL = tr.left; w.roomR = window.innerWidth - tr.right; w.topY = dr.top;
    return true;
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const w = world;
    if (!allowed()) { layer.classList.remove("is-on"); w.layerOn = false; cancelAnimationFrame(raf); raf = 0; return; } // switched off by the admin
    const moving = touching || trk.classList.contains("is-opening") || trk.classList.contains("is-closing");
    if (moving || !rects || !(tick++ % 12)) {
      if (!measure(w)) { layer.classList.remove("is-on"); return; }
    }
    const dt = Math.min(0.06, Math.max(0, (now - last) / 1000));
    last = now;
    const lt = "translate3d(" + rects.left.toFixed(1) + "px," + (rects.top - LAYER_H + 2.5).toFixed(1) + "px,0)";
    if (w.layerT !== lt) { w.layerT = lt; layer.style.transform = lt; }
    const on = trk.classList.contains("is-open");
    if (w.layerOn !== on) { w.layerOn = on; layer.classList.toggle("is-on", on); }
    step(w, dt);
    draw(w, now, dt);
    if (w.deep) pauseForSleep(w); // fast asleep and everything still: stop the loop altogether, until she wakes
  }
  let wakeTimer = 0;
  function pauseForSleep(w) {
    cancelAnimationFrame(raf); raf = 0;
    if (!w.wakeAt) w.wakeAt = performance.now() + Math.max(0, w.h.t) * 1000;
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => {
      w.wakeAt = 0; w.deep = false; w.h.t = 0; // (the next frame wakes her)
      if (trk.classList.contains("is-open")) start();
    }, Math.max(0, w.wakeAt - performance.now()) + 20);
  }
  function start() {
    clearTimeout(stopTimer);
    if (raf || animationsOff() || !allowed()) return;
    last = performance.now(); rects = null;
    raf = requestAnimationFrame(frame);
  }
  const w0 = world;
  function stopSoon() {
    layer.classList.remove("is-on"); w0.layerOn = false; // (they fade away as the panel folds)
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => { cancelAnimationFrame(raf); raf = 0; }, 450);
  }

  if (window.MutationObserver) {
    new MutationObserver(() => { if (trk.classList.contains("is-open")) start(); else if (raf) stopSoon(); }).observe(trk, { attributes: true, attributeFilter: ["class"] });
  }
  if (trk.classList.contains("is-open")) start();
})();
