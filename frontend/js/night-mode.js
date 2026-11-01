/* Night mode: the moon / sun button in the header. The choice is remembered on this phone (the page's <head> applies it
 * before anything is painted, so a customer who chose night mode never sees a flash of the light page).
 *
 * Tapping the button plays a short scene over the whole screen (css/night-mode.css, ".nm-fx"):
 *   turning night ON  -> a dark circle grows out of the button, stars twinkle, a moon rises and an owl swoops in and blinks
 *   turning night OFF -> a golden circle grows out of the button, the sun rises with its rays and little birds fly past
 * The page itself switches while the scene covers the screen, then the scene fades away. */
(() => {
  const KEY = "freshcutz_night";
  const root = document.documentElement;
  const btn = document.getElementById("nightBtn");

  let busy = false;
  const isNight = () => root.classList.contains("night");
  const label = () => {
    if (!btn) return;
    btn.setAttribute("aria-pressed", isNight() ? "true" : "false");
    btn.setAttribute("aria-label", isNight() ? "Turn night mode off" : "Turn night mode on");
    btn.title = isNight() ? "Night mode: on" : "Night mode: off";
  };
  if (!btn) return;

  /** The shop can switch the whole feature off (Customize tab > Night mode): then there is no button, and the website is always
   * in its normal (day) look. A customer's own choice stays remembered, so it is back if the shop switches the feature on again. */
  const allowed = () => !window.SiteCustomize || window.SiteCustomize.on("showNightMode");
  function sync() {
    if (busy) return; // (the scene is playing: it settles things itself when it ends)
    const ok = allowed();
    btn.hidden = !ok;
    let want = false;
    if (ok) { try { want = localStorage.getItem(KEY) === "1"; } catch (e) {} }
    if (want !== isNight()) root.classList.toggle("night", want);
    label();
  }
  document.addEventListener("freshcutz:site", sync);

  const OWL = `
    <svg class="nm-owl-svg" viewBox="0 0 140 160" aria-hidden="true" focusable="false">
      <g class="nm-wing nm-wing-l"><path d="M34 68 C6 82 0 112 20 144 C34 128 42 108 44 86 Z" fill="#241d12"/><path d="M30 92 C18 104 16 118 22 132" stroke="#3b3019" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M36 84 C26 98 24 110 28 122" stroke="#3b3019" stroke-width="3" fill="none" stroke-linecap="round"/></g>
      <g class="nm-wing nm-wing-r"><path d="M106 68 C134 82 140 112 120 144 C106 128 98 108 96 86 Z" fill="#241d12"/><path d="M110 92 C122 104 124 118 118 132" stroke="#3b3019" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M104 84 C114 98 116 110 112 122" stroke="#3b3019" stroke-width="3" fill="none" stroke-linecap="round"/></g>
      <ellipse cx="70" cy="98" rx="34" ry="42" fill="#2f2615"/>
      <ellipse cx="70" cy="108" rx="21" ry="29" fill="#4d3f25"/>
      <g stroke="#6a5733" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M58 92 q4 4 8 0"/><path d="M66 92 q4 4 8 0"/><path d="M54 104 q4 4 8 0"/><path d="M62 104 q4 4 8 0"/><path d="M70 104 q4 4 8 0"/><path d="M58 116 q4 4 8 0"/><path d="M66 116 q4 4 8 0"/></g>
      <path d="M36 54 L40 22 L58 40 Z" fill="#2f2615"/><path d="M104 54 L100 22 L82 40 Z" fill="#2f2615"/>
      <ellipse cx="70" cy="58" rx="36" ry="30" fill="#2f2615"/>
      <ellipse cx="54" cy="58" rx="15" ry="15" fill="#4d3f25"/><ellipse cx="86" cy="58" rx="15" ry="15" fill="#4d3f25"/>
      <g class="nm-eye"><circle cx="54" cy="58" r="11.5" fill="#f0d98a"/><circle cx="54" cy="58" r="5.2" fill="#17140f"/><circle cx="51.5" cy="55.5" r="1.8" fill="#fff"/></g>
      <g class="nm-eye"><circle cx="86" cy="58" r="11.5" fill="#f0d98a"/><circle cx="86" cy="58" r="5.2" fill="#17140f"/><circle cx="83.5" cy="55.5" r="1.8" fill="#fff"/></g>
      <path d="M65 64 L75 64 L70 76 Z" fill="#c9a13b"/>
      <path d="M58 138 l-3 10 M63 138 l0 11 M68 138 l3 10 M76 138 l-3 10 M81 138 l0 11 M86 138 l3 10" stroke="#c9a13b" stroke-width="3" stroke-linecap="round"/>
    </svg>`;

  const SUN = `
    <svg class="nm-sun-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs><radialGradient id="nmSunG" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset="0.55" stop-color="#ffd24a"/><stop offset="1" stop-color="#f0a21e"/></radialGradient></defs>
      <g class="nm-rays" stroke="#ffc83d" stroke-width="7" stroke-linecap="round">
        ${Array.from({ length: 12 }, (_, i) => `<line x1="100" y1="14" x2="100" y2="${i % 2 ? 30 : 38}" transform="rotate(${i * 30} 100 100)"/>`).join("")}
      </g>
      <circle cx="100" cy="100" r="52" fill="url(#nmSunG)"/>
      <circle cx="83" cy="92" r="4.2" fill="#8a5a0c"/><circle cx="117" cy="92" r="4.2" fill="#8a5a0c"/>
      <path d="M82 112 q18 16 36 0" stroke="#8a5a0c" stroke-width="4.5" fill="none" stroke-linecap="round"/>
      <circle cx="74" cy="106" r="6" fill="#ff9d5c" opacity="0.45"/><circle cx="126" cy="106" r="6" fill="#ff9d5c" opacity="0.45"/>
    </svg>`;

  const BIRD = `<svg class="nm-bird-svg" viewBox="0 0 40 20" aria-hidden="true" focusable="false"><path class="nm-bird-wing" d="M2 14 Q10 0 20 12 Q30 0 38 14" stroke="#7a5a1c" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function stars(n) {
    let out = "";
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 100).toFixed(1), y = (Math.random() * 78).toFixed(1);
      const s = (1.5 + Math.random() * 2.6).toFixed(1), d = (Math.random() * 1.2).toFixed(2), t = (0.9 + Math.random() * 1.1).toFixed(2);
      out += `<i class="nm-star" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-delay:${d}s;animation-duration:${t}s"></i>`;
    }
    return out;
  }

  /** the scene for turning night on / off, over the whole screen */
  function scene(toNight) {
    const r = btn.getBoundingClientRect();
    const fx = document.createElement("div");
    fx.className = "nm-fx " + (toNight ? "nm-to-night" : "nm-to-day");
    fx.setAttribute("aria-hidden", "true");
    fx.style.setProperty("--cx", Math.round(r.left + r.width / 2) + "px");
    fx.style.setProperty("--cy", Math.round(r.top + r.height / 2) + "px");
    fx.innerHTML = toNight
      ? `<div class="nm-wash"></div>
         <div class="nm-stuff">
           ${stars(34)}
           <div class="nm-moon"><i></i><i></i><i></i></div>
           <div class="nm-owl">${OWL}</div>
           <div class="nm-say">The moon says hi!</div>
         </div>`
      : `<div class="nm-wash"></div>
         <div class="nm-stuff">
           <div class="nm-glow"></div>
           <div class="nm-sun">${SUN}</div>
           <div class="nm-bird nm-b1">${BIRD}</div><div class="nm-bird nm-b2">${BIRD}</div><div class="nm-bird nm-b3">${BIRD}</div>
           <div class="nm-say">Good morning, sunshine!</div>
         </div>`;
    document.body.appendChild(fx);
    return fx;
  }

  const SWITCH_AT = 560;   // ms: the page changes behind the scene, once the growing circle has covered the screen
  const END_AT = 3000;     // ms: the scene is removed

  btn.addEventListener("click", () => {
    if (busy) return;
    const toNight = !isNight();
    const apply = () => {
      root.classList.toggle("night", toNight);
      try { localStorage.setItem(KEY, toNight ? "1" : "0"); } catch (e) {}
      label();
    };
    const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) { apply(); return; }
    busy = true;
    const fx = scene(toNight);
    setTimeout(apply, SWITCH_AT);
    setTimeout(() => { fx.remove(); busy = false; sync(); }, END_AT);
  });

  sync();
})();
