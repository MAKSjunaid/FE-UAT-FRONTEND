/* Tiny toast notification helper.
 *   Toast.show("message", "success"|"error"|"info", durationMs)  — plain text
 *   Toast.msg("addedToCart", { name }, opts)                      — an admin-editable message
 * On the customer website the Customize tab decides whether pop-ups appear
 * at all, for how long, where, how many at once, and each message's wording
 * (see site-customize.js). The admin pages have no such settings, so there
 * everything behaves as it always did. */

const Toast = (() => {
  function host() {
    let el = document.getElementById("toastHost");
    if (!el) {
      el = document.createElement("div");
      el.id = "toastHost";
      document.body.appendChild(el);
    }
    return el;
  }

  const settings = () => (window.SiteCustomize && window.SiteCustomize.toastSettings ? window.SiteCustomize.toastSettings() : null);

  function show(message, type = "success", duration, force = false) {
    const S = settings();
    if (S && !S.enabled && !force) return;
    if (duration == null) duration = S ? S.seconds * 1000 : 3200;

    const hostEl = host();
    // A cart/checkout/profile sheet renders its markup into #sheetRoot, so
    // a non-empty #sheetRoot means one's currently open — its footer button
    // sits at the very bottom of the screen and varies in height sheet to
    // sheet, so the toast floats near the top instead of risking a clash
    // with it (see the .toast-above-sheet rule in components.css).
    const sheetOpen = !!document.getElementById("sheetRoot")?.childElementCount;
    hostEl.classList.toggle("toast-above-sheet", sheetOpen);

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    hostEl.appendChild(el);
    const timer = setTimeout(() => fadeOut(el), duration);
    el.dataset.timerId = timer; // so dismissAll() can cancel it instead of double-fading

    if (S && S.tap) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        clearTimeout(timer);
        fadeOut(el);
      });
    }

    // Never more pop-ups at once than the admin allows: the oldest makes room.
    const max = S ? S.max : 0;
    if (max) {
      const live = [...hostEl.querySelectorAll(".toast")].filter((t) => !t.dataset.fading);
      live.slice(0, Math.max(0, live.length - max)).forEach((old) => {
        clearTimeout(Number(old.dataset.timerId));
        fadeOut(old);
      });
    }
  }

  /** An admin-editable message: wording, on/off, duration and style come from
   * the Customize tab. `vars` fills {placeholders} in the text. */
  function msg(key, vars, opts = {}) {
    const SC = window.SiteCustomize;
    if (!SC || !SC.msg) return;
    const m = SC.msg(key);
    if (!m.enabled && !opts.force) return;
    const text = SC.text(key, vars || {});
    if (!text) return;
    show(text, m.tone, m.seconds * 1000, !!opts.force);
  }

  function fadeOut(el) {
    if (el.dataset.fading) return; // already on its way out
    el.dataset.fading = "1";
    el.style.transition = "opacity 200ms ease, transform 200ms ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    setTimeout(() => el.remove(), 220);
  }

  /** Instantly clears any toast still on screen — e.g. an "added to cart"
   *  toast that hasn't timed out yet when the customer opens the cart or
   *  checkout sheet right after. A toast belongs to the screen it was
   *  triggered from and shouldn't linger into the next one. */
  function dismissAll() {
    host()
      .querySelectorAll(".toast")
      .forEach((el) => {
        clearTimeout(Number(el.dataset.timerId));
        fadeOut(el);
      });
  }

  return { show, msg, dismissAll };
})();
