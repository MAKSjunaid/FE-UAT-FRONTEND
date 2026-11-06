/* The slow, always-running movements (the featured rows drifting, the order tracker's pulse and sweep, the scrolling menu and
 * location text) move at 30 frames a second instead of 60 (or 120 on some phones). They are all slow (the rows drift at about 22 px
 * per second), so each step is under one pixel and the eye cannot tell - but the screen is then redrawn half as often (a quarter
 * on 120 Hz phones), which is what keeps the phone cool. Only slow, endless movements are touched: anything quick (a spinner, a
 * button press, a page sliding in) and anything that plays once keeps running at full speed.
 *
 * How: each endless animation is given a stepped clock (30 steps a second), and all of them are lined up so their steps fall on
 * the same instants (if they were out of step with each other the screen would still be redrawn 60 times a second).
 *
 * Rests: a movement that never stops keeps the phone drawing pictures all day, even when it is only 'holding' at the end of its keyframes. So
 * (1) the pulse and sweep on the order tracker run once and then stand still for a few seconds before the next one, and (2) the running
 * text (menu name, location) stands still - truly paused, not just holding - during the rest at the end of each pass. The featured rows glide
 * in short bursts (see site-specials.js). Same look, the screen is simply not redrawn between the movements.
 *
 * Switch (for comparing on a phone): open the site with ?fps=60 to go back to full smoothness everywhere, ?fps=30 to turn this
 * on again. (?calm=1 stops all movement, see index.html.) */
(() => {
  const STEP = 1000 / 30;
  const MIN_MS = 1500;       // only endless movements that take at least this long for one round
  try {
    const q = /[?&]fps=(30|60)\b/.exec(location.search);
    if (q) {
      if (q[1] === "60") localStorage.setItem("fc_fps", "60");
      else localStorage.removeItem("fc_fps");
    }
    if (localStorage.getItem("fc_fps") === "60") return;
  } catch (e) { /* private mode: keep going */ }
  if (window.FC_CALM || typeof document.getAnimations !== "function") return;

  let timer = 0;
  function pass() {
    if (document.hidden) return;
    let list;
    try { list = document.getAnimations(); } catch (e) { return; }
    for (const a of list) rest(a);
    for (const a of list) {
      try {
        const eff = a.effect;
        if (!eff || typeof eff.getTiming !== "function" || a.pending) continue;
        const t = eff.getTiming();
        const d = Number(t.duration);
        if (t.iterations !== Infinity || !(d >= MIN_MS) || !(a.playbackRate === 1)) continue;
        const n = Math.max(1, Math.round(d / STEP));
        const upd = {};
        if (t.easing === "linear") upd.easing = "steps(" + n + ", end)";
        else if (!/^steps\(/.test(t.easing)) continue; // some other clock of its own: leave it alone
        // a round lasts a whole number of steps exactly (a change of a few thousandths of a percent), so the steps of one round
        // and of the next never drift away from the steps of the other movements
        if (Math.abs(n * STEP - d) > 0.02) upd.duration = n * STEP;
        if (upd.easing || upd.duration) eff.updateTiming(upd);
        // line the steps up with every other animation's: a step begins when (start + delay) is a whole number of 1/30 seconds
        if (a.playState === "running" && typeof a.startTime === "number") {
          const delay = Number(t.delay) || 0;
          const first = a.startTime + delay;
          const aligned = Math.round(first / STEP) * STEP;
          if (Math.abs(aligned - first) > 0.5) a.startTime = aligned - delay;
        }
      } catch (e) { /* an animation that cannot be changed is simply left as it is */ }
    }
  }
  // ---- rests ---------------------------------------------------------------------------------
  // (1) tracker pulse and sweep: after each round, stand still for REST ms. Their rounds are 1.6 s and 2.4 s; with these rests both start
  // again together every 4.8 s, so their pictures are drawn in the same moments.
  const REST = { trkRing: 3200, trkSweep: 2400 };
  const own = (a) => (a && a.animationName) || "";
  document.addEventListener("animationiteration", (e) => {
    const ms = REST[e.animationName];
    if (!ms || !e.target || typeof e.target.getAnimations !== "function") return;
    // (the tracker's pulse and sweep live on ::after, which element.getAnimations() does not list - so look at all of them)
    const a = document.getAnimations().find((x) => own(x) === e.animationName && x.effect && x.effect.target === e.target && (x.effect.pseudoElement || "") === (e.pseudoElement || ""));
    if (!a || a.playState !== "running") return;
    a.pause();
    setTimeout(() => { if (a.playState === "paused" && !window.FC_IDLE) a.play(); }, ms);
  }, true);

  // (2) running text: its keyframes stop at 45% and hold until the end of the round. Pause for exactly that hold, and carry on after it.
  const HOLDERS = { bnavRun: 1, "area-marq": 1 };
  function rest(a) {
    try {
      if (!HOLDERS[own(a)] || a.playState !== "running" || a.pending) return;
      const eff = a.effect, d = Number(eff.getTiming().duration);
      const kf = eff.getKeyframes();
      if (!(d > 0) || kf.length < 3) return;
      const t = ((Number(a.currentTime) % d) + d) % d / d;
      for (let i = 0; i < kf.length - 1; i++) {
        const lo = kf[i].computedOffset, hi = kf[i + 1].computedOffset;
        if (kf[i].transform === kf[i + 1].transform && t >= lo && t < hi - 0.01) {
          const wait = (hi - t) * d / Math.abs(a.playbackRate || 1);
          a.pause();
          // after the wait it carries on from the END of the hold (the picture is the same all through the hold, so nothing shows)
          setTimeout(() => { if (a.playState === "paused" && !window.FC_IDLE) { try { a.currentTime = hi * d; } catch (e) { /* carry on from where it is */ } a.play(); } }, wait);
          return;
        }
      }
    } catch (e) { /* leave it as it is */ }
  }

  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(pass, 60);
  };
  document.addEventListener("animationstart", later, true);
  document.addEventListener("visibilitychange", later);
  setInterval(pass, 1500);
  later();
})();
