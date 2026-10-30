/* A short chime when a new order arrives, so the screen can be left on and watched by ear.
 *
 * - Played for each NEW order that comes in on the live line (admin-live.js), or that the background check finds
 *   when the live line is down. Never for orders already on screen, or for an order's own Delivered / Cancel / Reopen.
 * - The 🔊 / 🔇 button at the top right (beside the ☰) turns it on and off. The choice is saved on the server for each
 *   login account (the owner, and every staff / second-admin login), so it is the same after signing out and in again,
 *   on any device. This device also keeps a copy so the page opens right without waiting for anything.
 * - Browsers only allow sound after the page has been tapped / clicked once. Signing in is such a tap; after a plain
 *   page reload the button shows "Tap to activate" until the first tap anywhere.
 * - With sound on, admin-main.js keeps the live line open even while this browser tab is in the background, so the
 *   chime still plays when you are on another tab. (A phone that locks its screen pauses the page: nothing can play.)
 * - The chime is made in the browser (no sound file to download). */

window.AdminSound = (() => {
  const PREFIX = "freshcutz_admin_sound_";
  const MIN_GAP_MS = 1500; // two orders arriving together chime once
  const btn = document.getElementById("orderSoundBtn");
  let ctx = null;
  let on = true;
  let lastAt = 0;
  let runningAtTap = false; // whether sound was already active when the current tap began

  const who = () => String((window.AdminAccess && window.AdminAccess.get().username) || "owner").toLowerCase();
  const mine = () => (window.AdminAccess ? window.AdminAccess.get() : {});
  const running = () => !!ctx && ctx.state === "running";

  /** Reads this login's switch: what the server told us at sign-in, else this device's own copy, else on. */
  function load() {
    const server = mine().soundOn;
    if (typeof server === "boolean") {
      on = server;
    } else {
      try {
        on = localStorage.getItem(PREFIX + who()) !== "off";
      } catch (e) {
        on = true;
      }
    }
    render();
  }

  function save() {
    if (window.AdminAccess && window.AdminAccess.setSoundOn) window.AdminAccess.setSoundOn(on);
    try {
      localStorage.setItem(PREFIX + who(), on ? "on" : "off");
    } catch (e) {
      /* private mode: it just won't be remembered here */
    }
    // The server keeps it for this login account (one tiny request, only when the button is tapped).
    if (typeof Api !== "undefined" && Api.put) Api.put("/api/admin/auth/sound", { on }).catch(() => {});
  }

  /** Creates / wakes the audio engine. Only works from inside a tap or key press. */
  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      try {
        ctx = new AC();
        ctx.onstatechange = render;
      } catch (e) {
        return false;
      }
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    return true;
  }

  function chime() {
    const t0 = ctx.currentTime + 0.03;
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    // "ding-dong": G5 then C6, each a soft bell (a sine plus a quieter octave above)
    [[784, 0], [1046.5, 0.24]].forEach(([freq, at]) => {
      [[1, 1], [2, 0.25]].forEach(([mult, vol]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq * mult;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.0);
        o.connect(g);
        g.connect(master);
        o.start(t0 + at);
        o.stop(t0 + at + 1.05);
      });
    });
  }

  function render() {
    if (!btn) return;
    const waiting = on && !running();
    btn.classList.toggle("is-off", !on);
    btn.classList.toggle("is-waiting", waiting);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    const ico = btn.querySelector(".sound-ico");
    const glyph = on ? "🔊" : "🔇";
    if (ico.textContent !== glyph) ico.textContent = glyph;   // only touch it when it really changes, so a tap is never lost
    const tip = !on
      ? "New-order sound is off. Tap to turn it on."
      : waiting
        ? "Tap once to activate sound (your browser needs a tap first)."
        : "New-order sound is on. Tap to turn it off.";
    btn.title = tip;
    btn.setAttribute("aria-label", tip);
  }

  /** Called for every new order (admin-main.js). */
  function newOrder() {
    if (!on) return;
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    if (!running()) {
      render(); // still locked by the browser: the button says "Tap to activate"
      return;
    }
    chime();
  }

  // Any tap / key press is the browser's permission to make sound: wake the engine on the first one.
  const wake = () => {
    runningAtTap = running();
    if (!runningAtTap) ensure();
  };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, wake, { capture: true, passive: true }));

  if (btn) {
    btn.addEventListener("click", () => {
      if (on && !runningAtTap) {
        // The tap that was only needed to activate sound: keep it on, and play the chime so it is heard working.
        ensure();
        setTimeout(() => running() && chime(), 150);
        return;
      }
      on = !on;
      save();
      render();
      if (on) {
        ensure();
        setTimeout(() => running() && chime(), 150); // switching it on plays the chime once
      }
    });
  }

  // Where the button sits: phones — top right beside the ☰; wider screens — in the top bar beside the Online switch.
  const phone = window.matchMedia ? window.matchMedia("(max-width: 640px)") : null;
  function place() {
    if (!btn) return;
    if (phone && phone.matches) {
      const menu = document.getElementById("topMenuBtn");
      if (menu && btn.nextElementSibling !== menu) menu.parentNode.insertBefore(btn, menu);
    } else {
      const label = document.getElementById("storeToggleLabel");
      if (label && btn.nextElementSibling !== label) label.parentNode.insertBefore(btn, label);
    }
  }
  if (phone) (phone.addEventListener ? phone.addEventListener("change", place) : phone.addListener(place));
  place();

  document.addEventListener("freshcutz:login", load); // another login name: its own saved choice
  document.addEventListener("freshcutz:access", load);
  load();

  return { newOrder, isOn: () => on };
})();
