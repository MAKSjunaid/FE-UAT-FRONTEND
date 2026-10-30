/* Sliding banners on the customer website.
 *
 * The admin sets them up in the "Banners" tab: up to 10 sliders, each with up to 5 pictures and an optional line of text
 * above it (e.g. "Diwali offer"). A slider slides by itself every few seconds, can be swiped with a finger, and has
 * dots to jump to a picture. A picture can open an item (a sheet with its photo, price and Add to cart) when tapped.
 * Each slider has a position typed in by the admin: 1 is above the first product, N comes right after the first N-1
 * products (so 5 = after the 4th product). Size (width / height) and speed are set in Customize -> Sliding banners.
 *
 * Quiet by design: a slider only slides while it is on screen and the page is in front, and not while a finger is on
 * it; nothing is asked from the server beyond the pictures themselves (small, cached for a year by the browser).
 *
 * storefront.js calls SiteBanners.place({ grid, hidden, finished }) whenever the product grid changes, and this file
 * moves the sliders into the right spot (moving only a slider that is in the wrong spot, so one being swiped never
 * jumps back to the first picture). */

window.SiteBanners = (() => {
  const apiBase = () => window.FRESHCUTZ_API_BASE || "";
  const imageUrl = (id) => `${apiBase()}/api/store/site/banner/${encodeURIComponent(id)}`;

  const nodes = new Map(); // slider id -> { el, sig, place, destroy }
  let lastCtx = null;
  let order = []; // slider ids, in the admin's order

  const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const animationsOff = (cfg) => !!(cfg && cfg.animationsOff === true) || reduceMotion();

  function config() {
    return (window.SiteCustomize && window.SiteCustomize.cfg && window.SiteCustomize.cfg()) || null;
  }

  // ---- one slider --------------------------------------------------------------------------------

  function build(set, seconds, still, size) {
    const el = document.createElement("section");
    el.className = "sb";
    el.dataset.set = set.id;
    el.setAttribute("aria-roledescription", "carousel");
    el.setAttribute("aria-label", set.title || set.name || "Offers");
    el.innerHTML = `<div class="sb-inner"><div class="sb-box"><div class="sb-track" tabindex="-1"></div><span class="sb-badge" hidden></span><div class="sb-dots" role="tablist"></div></div></div>`;
    const badge = el.querySelector(".sb-badge");
    // the name pops in once, when the banner first appears - not again each time the banner is put back in the page
    badge.addEventListener("animationend", () => badge.classList.add("sb-badge-settled"), { once: true });
    if (set.title) {
      // the banner name sits on the banner itself, like the "% OFF" tag on an item
      badge.textContent = set.title;
      badge.hidden = false;
    }
    // size settings from Customize: width in %, height in px (0 = automatic, follows the picture shape)
    el.style.setProperty("--sb-w", `${size.width}%`);
    if (size.height > 0) {
      el.classList.add("sb-h");
      el.style.setProperty("--sb-h", `${size.height}px`);
    }
    if (size.heightDesktop > 0) {
      el.classList.add("sb-hd");
      el.style.setProperty("--sb-hd", `${size.heightDesktop}px`);
    }
    const track = el.querySelector(".sb-track");
    const dots = el.querySelector(".sb-dots");

    set.slides.forEach((s, i) => {
      const slide = document.createElement("div");
      slide.className = "sb-slide";
      slide.dataset.i = String(i);
      if (s.productId) {
        slide.dataset.product = String(s.productId);
        slide.classList.add("sb-link");
        slide.setAttribute("role", "button");
        slide.tabIndex = 0;
        slide.setAttribute("aria-label", `Offer ${i + 1} of ${set.slides.length} - tap to open the item`);
      } else {
        slide.setAttribute("aria-label", `Offer ${i + 1} of ${set.slides.length}`);
      }
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      img.loading = "lazy"; // nothing is downloaded until the slider is on screen (see `watcher` below)
      img.src = imageUrl(s.imageId);
      img.addEventListener("error", () => dropSlide(slide));
      slide.appendChild(img);
      track.appendChild(slide);

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "sb-dot" + (i === 0 ? " on" : "");
      dot.dataset.i = String(i);
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", `Show picture ${i + 1}`);
      dots.appendChild(dot);
    });

    const count = () => track.children.length;
    let current = 0;
    let timer = null;
    let onScreen = false;
    let touching = false;
    let hovering = false;

    // After the last picture the slider glides back to the first one, in the opposite direction
    // (quick: about half a second, however many pictures there are).
    let animating = false;
    let animFrame = 0;
    function cancelGlide() {
      if (!animating) return;
      cancelAnimationFrame(animFrame);
      animating = false;
      track.style.scrollSnapType = "";
    }
    function glide(to, ms) {
      const from = track.scrollLeft;
      const dist = to - from;
      if (!dist) return;
      cancelGlide();
      animating = true;
      track.style.scrollSnapType = "none"; // snapping would fight the animation
      const t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        track.scrollLeft = from + dist * ease(t);
        if (t < 1) {
          animFrame = requestAnimationFrame(step);
        } else {
          animating = false;
          track.style.scrollSnapType = "";
          track.scrollLeft = to;
          markDots();
        }
      };
      animFrame = requestAnimationFrame(step);
    }

    function go(i, smooth = true) {
      const n = count();
      if (!n) return;
      cancelGlide();
      const idx = ((i % n) + n) % n;
      if (smooth && idx === 0 && current === n - 1 && n > 1 && !reduceMotion()) {
        setActive(0); // the dots jump straight to the first one instead of flickering past the middle ones
        glide(0, 560);
        return;
      }
      track.scrollTo({ left: idx * track.clientWidth, behavior: smooth && !reduceMotion() ? "smooth" : "auto" });
    }

    function setActive(idx) {
      current = idx;
      [...dots.children].forEach((d, k) => {
        d.classList.toggle("on", k === idx);
        d.setAttribute("aria-selected", k === idx ? "true" : "false");
      });
    }

    function markDots() {
      if (animating) return;
      const w = track.clientWidth || 1;
      setActive(Math.max(0, Math.min(count() - 1, Math.round(track.scrollLeft / w))));
    }

    function dropSlide(slide) {
      const i = Number(slide.dataset.i);
      slide.remove();
      const dot = dots.querySelector(`.sb-dot[data-i="${i}"]`);
      if (dot) dot.remove();
      [...track.children].forEach((c, k) => (c.dataset.i = String(k)));
      [...dots.children].forEach((d, k) => (d.dataset.i = String(k)));
      if (!count()) {
        el.remove();
        return;
      }
      dots.hidden = count() < 2;
      markDots();
      sync();
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    /** Slides on by itself only while it is worth it: visible, page in front, no finger / mouse on it, 2+ pictures. */
    function sync() {
      stop();
      if (still || count() < 2 || !onScreen || touching || hovering || document.hidden) return;
      timer = setInterval(() => go(current + 1), Math.max(2, seconds) * 1000);
    }

    let ticking = false;
    track.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          markDots();
        });
      },
      { passive: true }
    );
    track.addEventListener("pointerdown", () => ((touching = true), cancelGlide(), sync()), { passive: true });
    track.addEventListener("touchstart", cancelGlide, { passive: true });
    track.addEventListener("wheel", cancelGlide, { passive: true });
    const release = () => {
      if (!touching) return;
      touching = false;
      sync(); // a fresh full wait before the next automatic slide
    };
    track.addEventListener("pointerup", release, { passive: true });
    track.addEventListener("pointercancel", release, { passive: true });
    track.addEventListener("touchend", release, { passive: true });
    // a real mouse resting on the slider pauses it; a finger never counts as "hovering" (phones keep a fake hover after a tap)
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") {
        hovering = true;
        sync();
      }
    });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") {
        hovering = false;
        sync();
      }
    });

    dots.addEventListener("click", (e) => {
      const dot = e.target.closest(".sb-dot");
      if (!dot) return;
      go(Number(dot.dataset.i));
      sync();
    });
    const open = (slide) => {
      const id = Number(slide.dataset.product);
      if (id && window.Storefront && window.Storefront.openItem) window.Storefront.openItem(id);
    };
    track.addEventListener("click", (e) => {
      const slide = e.target.closest(".sb-slide[data-product]");
      if (slide) open(slide);
    });
    track.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const slide = e.target.closest(".sb-slide[data-product]");
      if (slide) {
        e.preventDefault();
        open(slide);
      }
    });

    let watcher = null;
    let warmed = false;
    if (typeof IntersectionObserver !== "undefined") {
      watcher = new IntersectionObserver(
        (entries) => {
          onScreen = entries.some((en) => en.isIntersecting);
          if (onScreen && !warmed) {
            warmed = true; // first time in view: fetch all its pictures now, so the first slide-over never shows a blank
            track.querySelectorAll("img").forEach((im) => (im.loading = "eager"));
          }
          sync();
        },
        { threshold: 0.4 }
      );
      watcher.observe(el);
    } else {
      onScreen = true;
      track.querySelectorAll("img").forEach((im) => (im.loading = "eager"));
    }
    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    // after a turn of the phone or a resize, stay on the same picture
    const onResize = () => go(current, false);
    window.addEventListener("resize", onResize);

    dots.hidden = count() < 2;
    return {
      el,
      /** Which picture it is on (0 = the first). */
      index: () => current,
      /** A rebuilt banner carries on from the picture the old one was on (when that picture still exists). */
      resumeAt(i) {
        const k = Math.max(0, Math.min(count() - 1, Number(i) || 0));
        if (k > 0) setActive(k);
      },
      /** Taking a banner out of the page and putting it back resets its scroll position to the first picture:
       * call this right after it is put back, so it is still on the picture it was showing. */
      reattached() {
        if (current > 0) go(current, false);
      },
      destroy() {
        stop();
        cancelGlide();
        if (watcher) watcher.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("resize", onResize);
        el.remove();
      },
    };
  }

  // ---- keeping the sliders in line with the settings ------------------------------------------------

  /** Builds / rebuilds / removes sliders so they match the admin's current settings. */
  function refresh() {
    const cfg = config();
    const seconds = Number(cfg && cfg.bannerSeconds) || 4;
    const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) && Number(v) >= lo ? Math.min(hi, Math.round(Number(v))) : dflt);
    const size = {
      width: num(cfg && cfg.bannerWidth, 30, 100, 100),
      height: num(cfg && cfg.bannerHeight, 60, 600, 0),
      heightDesktop: num(cfg && cfg.bannerHeightDesktop, 60, 800, 0),
    };
    const sets = ((cfg && Array.isArray(cfg.banners) && cfg.banners) || []).filter(
      (s) => s && s.enabled !== false && Array.isArray(s.slides) && s.slides.some((x) => x && x.imageId)
    );
    order = sets.map((s) => s.id);
    const keep = new Set(order);
    for (const [id, n] of nodes) {
      if (!keep.has(id)) {
        n.destroy();
        nodes.delete(id);
      }
    }
    const still = animationsOff(cfg);
    sets.forEach((set) => {
      const clean = { ...set, slides: set.slides.filter((x) => x && x.imageId) };
      const sig = JSON.stringify([clean, seconds, still, size, apiBase()]);
      const have = nodes.get(set.id);
      if (have && have.sig === sig) return;
      const was = have ? have.index() : 0;
      if (have) have.destroy();
      const made = build(clean, seconds, still, size);
      made.resumeAt(was);
      nodes.set(set.id, { ...made, sig, place: Math.max(1, Math.min(500, Math.round(Number(set.place)) || 1)), cats: Array.isArray(set.showIn) ? set.showIn.filter((c) => typeof c === "string") : [] });
    });
    if (lastCtx) place(lastCtx);
  }

  const cardsBefore = (grid, el) => {
    let n = 0;
    for (const c of grid.children) {
      if (c === el) break;
      if (c.classList.contains("product-card") && c.dataset.id) n++;
    }
    return n;
  };

  /** Is a banner with these "show in" choices meant for this tab? Empty = every tab; "@all" = the All tab. */
  function shownIn(cats, category) {
    if (!cats || !cats.length) return true;
    return !category || category === "All" ? cats.includes("@all") : cats.includes(category);
  }

  /** Featured Products rows that were set to go BELOW the banners at the same place (see site-specials.js): a banner goes in
   * front of them. (null = the end of the grid.) */
  function beforeLowRows(grid, ref) {
    let x = ref ? ref.previousElementSibling : grid.lastElementChild;
    while (x && x.classList.contains("sp") && x.dataset.below === "1") {
      ref = x;
      x = x.previousElementSibling;
    }
    return ref;
  }

  /** Moves each slider to its place among the product cards (or takes them all off the page). */
  function place(ctx) {
    lastCtx = ctx;
    const { grid, hidden, finished, category } = ctx;
    if (!grid) return;
    if (hidden) {
      nodes.forEach((n) => n.el.isConnected && n.el.remove());
      grid.classList.remove("has-sb");
      return;
    }
    const cards = [...grid.children].filter((c) => c.classList.contains("product-card") && c.dataset.id);
    order.forEach((id) => {
      const n = nodes.get(id);
      if (!n || !n.el.firstChild) return;
      if (!shownIn(n.cats, category)) {
        if (n.el.isConnected) n.el.remove(); // this banner is not meant for this tab
        return;
      }
      const after = n.place - 1; // products above this slider
      let ref;
      let ok = true;
      if (after === 0) {
        ref = [...grid.children].find((c) => !c.classList.contains("sb") && !c.classList.contains("sp")) || null; // the very top (a Featured Products row at the same place stays above the banner)
      } else if (cards.length > after) {
        ref = cards[after];
      } else if (finished) {
        ref = null; // fewer products than that: put it at the very end
      } else {
        ok = false; // not enough cards yet - wait for more to load
      }
      if (!ok) {
        if (n.el.isConnected) n.el.remove();
        return;
      }
      ref = beforeLowRows(grid, ref); // Featured rows meant to be below the banners sit between the banners and the next card
      const wanted = after === 0 ? 0 : Math.min(after, cards.length);
      const right = n.el.parentNode === grid && cardsBefore(grid, n.el) === wanted;
      if (right) return;
      grid.insertBefore(n.el, ref);
      n.reattached(); // (moving an element resets its scroll position: put it back on the picture it was showing)
    });
    // on wide screens a full-row banner can leave a gap in the row above it; "dense" lets the next products fill it
    grid.classList.toggle("has-sb", [...nodes.values()].some((n) => n.el.parentNode === grid));
  }

  document.addEventListener("freshcutz:site", refresh);
  document.addEventListener("DOMContentLoaded", refresh);

  return { place, refresh };
})();
