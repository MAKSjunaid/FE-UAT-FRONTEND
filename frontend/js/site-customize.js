/* Applies the look the admin chose in the Customize tab to the customer
 * website: logo, brand name, tagline, hero text, badges, which parts are
 * shown, and the colors.
 *
 * How it stays fast and flicker-free:
 *  - the last settings received are kept in localStorage and applied the
 *    moment this script runs (it sits right after the header/hero in
 *    index.html), so a returning customer never sees the default look
 *    flash before the saved one;
 *  - at DOMContentLoaded it opens ONE Server-Sent Events connection to
 *    /api/store/site/stream. The server sends the current settings straight
 *    away and again whenever an admin presses Save — so open tabs update
 *    within about a second, with no polling (same pattern as store-status.js);
 *  - the page's own HTML is still the original look, so if the server can't
 *    be reached, customers simply see that. */

(() => {
  const CACHE_KEY = "freshcutz_site_v1"; // (older copies: just the settings)
  const CACHE_KEY_V2 = "freshcutz_site_v2"; // the settings together with the fingerprint the server gave them
  const DEFAULT_BRAND = "FRESHCUTZ";
  const DEFAULT_TAGLINE = "Freshly Cut. Naturally Juicy.";
  const DEFAULT_ACCENT = "#c9a13b";
  const DEFAULT_LOGO = "images/logo.jpg";

  const ORIGINAL_TITLE = document.title;
  const BODY_FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  const SERIF_FONT = '"Playfair Display", Georgia, "Times New Roman", serif';

  // Mirrors the defaults in SiteConfig.java, so t() still has the original
  // wording before (or without) a response from the server.
  const DEFAULTS = {
    searchPlaceholder: "Search chicken, eggs…",
    addToCartText: "Add to cart",
    outOfStockText: "Out of Stock",
    emptyProductsText: "No products available right now. Please check back soon.",
    noSearchResultsText: "We checked the whole farm. Nothing matched!",
    viewCartText: "View Cart →",
    cartTitle: "Your Cart",
    cartEmptyText: "Your cart is empty. Add something delicious!",
    checkoutButtonText: "Proceed to Checkout →",
    placeOrderText: "Place Order",
    notesLabel: "Special instructions (optional)",
    deliverySlotsLabel: "Preferred delivery time (optional)",
    paymentLabel: "Payment mode",
    codLabel: "Cash on delivery",
    upiLabel: "UPI",
    successTitle: "Order Placed!",
    successMessage: "We'll call you to confirm delivery timing.",
    offlineBannerText: "🔴 We're currently offline and not accepting new orders right now.",
    offlineSheetText: "We're currently offline and not accepting new orders. Please check back soon!",
    heroButtonText: "Order now",
  };

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  let lastApplied = null; // JSON string of the last settings applied, to skip no-op updates
  let lastLogoUrl = null;
  let eventSource = null;
  let current = null; // the config last applied — read by the storefront via SiteCustomize

  /** The admin-set text for `key` (or the original wording). Blank text the
   * admin deliberately cleared stays blank. */
  function t(key) {
    if (current && typeof current[key] === "string") return current[key];
    return DEFAULTS[key] ?? "";
  }
  /** A show/hide switch; everything is shown unless the admin turned it off. */
  function on(key, fallback = true) {
    return current && typeof current[key] === "boolean" ? current[key] : fallback;
  }

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
  }

  /** One editable message: its wording, whether it is on, how long it stays and
   * its style — the admin's override if there is one, else the original. */
  function msg(key) {
    const def = (window.SiteElements && window.SiteElements.MESSAGES[key]) || { def: "", tone: "success" };
    const over = (current && current.messages && current.messages[key]) || {};
    const secs = Number(over.seconds);
    return {
      text: typeof over.text === "string" && over.text !== "" ? over.text : def.def,
      enabled: over.enabled !== "0",
      seconds: Number.isFinite(secs) && secs > 0 ? secs : toastSettings().seconds,
      tone: over.tone || def.tone || "success",
    };
  }

  /** Wording for a label / button / form message, with {placeholders} filled in. */
  function text(key, vars) {
    return fill(msg(key).text, vars);
  }

  function toastSettings() {
    const c = current || {};
    const secs = Number(c.toastSeconds);
    return {
      enabled: c.toastsEnabled !== false,
      seconds: Number.isFinite(secs) && secs > 0 ? secs : 3.2,
      max: Number(c.toastMax) > 0 ? Number(c.toastMax) : 5,
      tap: c.toastTapDismiss === true,
    };
  }

  /** Same as text(), made safe for putting inside HTML. */
  function html(key, vars) {
    return text(key, vars).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  /** The Final Step's delivery time choices: { show, label, slots }. Mirrors SiteConfig's defaults until the server answers;
   * switched off by the admin, or with no options left, nothing is shown. */
  function deliverySlots() {
    const c = current || {};
    const list = Array.isArray(c.deliverySlots) ? c.deliverySlots : ["8 AM – 9 AM", "9 AM – 10 AM"];
    const slots = list.filter((s) => typeof s === "string" && s.trim() !== "");
    // The slots as times of day: what the admin set (slotWindows) or, for settings saved before that existed, the text options read as times.
    // When any old option can't be read, the plain buttons are shown as before (no Today / Tomorrow).
    let windows = null;
    if (Array.isArray(c.slotWindows)) {
      windows = c.slotWindows.filter((w) => w && Number(w.start) < Number(w.end)).map((w) => ({ start: Number(w.start), end: Number(w.end) }));
    } else if (window.SlotTime) {
      const read = slots.map((s) => SlotTime.parse(s));
      windows = read.every(Boolean) ? read : null;
    }
    const count = windows ? windows.length : slots.length;
    return {
      show: c.showDeliverySlots !== false && count > 0,
      label: t("deliverySlotsLabel"),
      slots: windows ? windows.map((w) => SlotTime.label(w)) : slots,
      schedule: c.slotSchedule !== false && !!windows && !!window.SlotTime, // Today / Tomorrow with advance notice
      windows,
      notice: Number.isFinite(Number(c.slotNoticeMinutes)) && c.slotNoticeMinutes !== null && c.slotNoticeMinutes !== undefined ? Number(c.slotNoticeMinutes) : 60,
    };
  }

  /** The Final Step's payment choice: { show, label, cod, upi, id, name }. Mirrors SiteConfig's defaults until the server
   * answers. Nothing is shown when the admin switched it off or has no UPI ID (then there is nothing to choose between). */
  function payment() {
    const c = current || {};
    const id = typeof c.upiId === "string" ? c.upiId.trim() : "farhanshahi@ybl";
    const name = (typeof c.upiName === "string" && c.upiName.trim()) || c.brandName || "FreshCutz";
    return {
      show: c.showPaymentOptions !== false && c.upiEnabled !== false && id !== "",
      label: t("paymentLabel"),
      cod: t("codLabel"),
      upi: t("upiLabel"),
      proof: c.askPaymentProof !== false, // ask UPI customers for a screenshot of the payment
      def: c.defaultPayment === "COD" ? "COD" : c.defaultPayment === "UPI" && id !== "" ? "UPI" : "", // what starts ticked ("" = nothing: the customer must choose)
      id,
      name,
    };
  }

  // cfg() = the whole settings object last applied (the sliding banners read their list from it)
  window.SiteCustomize = { t, on, msg, text, html, toastSettings, deliverySlots, payment, cfg: () => current, logoUrl: () => lastLogoUrl };

  // ---- colour helpers ----------------------------------------------------
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, alpha) {
    const [r, g, b] = rgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /** Mixes a colour toward white (amount > 0) or black (amount < 0). */
  function mix(hex, amount) {
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    const [r, g, b] = rgb(hex).map((c) => Math.round(c + (target - c) * t));
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  function isHex(v) {
    return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  function setVar(name, value) {
    root.style.setProperty(name, value);
  }

  function clearVar(name) {
    root.style.removeProperty(name);
  }

  // ---- applying ----------------------------------------------------------
  function applyColors(c) {
    const pairs = [
      ["--site-header-bg", c.headerBg],
      ["--site-brand-color", c.brandNameColor],
      ["--site-tagline-color", c.taglineColor],
      ["--site-hero-start", c.heroBgStart],
      ["--site-hero-end", c.heroBgEnd],
      ["--site-hero-heading", c.heroHeadingColor],
      ["--site-hero-highlight", c.heroHighlightColor],
      ["--site-hero-text", c.heroTextColor],
      ["--site-badge-text", c.badgeText],
      ["--bg-page", c.pageBg],
      ["--text-main", c.textColor],
      ["--bg-card", c.cardBg],
      ["--site-price", c.priceColor],
      ["--site-cat-active", c.categoryActiveBg],
      ["--site-cartbar-bg", c.cartBarBg],
      ["--site-announce-bg", c.announcementBg],
      ["--site-announce-color", c.announcementColor],
      ["--site-footer-bg", c.footerBg],
      ["--site-footer-text", c.footerTextColor],
    ];
    pairs.forEach(([name, value]) => (isHex(value) ? setVar(name, value) : clearVar(name)));

    if (isHex(c.badgeBg)) {
      setVar("--site-badge-bg", rgba(c.badgeBg, 0.14));
      setVar("--site-badge-border", rgba(c.badgeBg, 0.4));
    }

    // The accent drives every gold button/highlight on the site. Left alone
    // when it is the original gold, so the default look is byte-for-byte
    // what the stylesheet already says.
    if (isHex(c.accentColor) && c.accentColor.toLowerCase() !== DEFAULT_ACCENT) {
      setVar("--gold", c.accentColor);
      setVar("--gold-light", mix(c.accentColor, 0.4));
      setVar("--gold-dark", mix(c.accentColor, -0.25));
      setVar("--shadow-gold", `0 8px 20px ${rgba(c.accentColor, 0.35)}`);
    } else {
      ["--gold", "--gold-light", "--gold-dark", "--shadow-gold"].forEach(clearVar);
    }
  }

  function applyBrand(c, logoUrl) {
    const name = $("brandName");
    const tag = $("brandTag");
    const logoBox = $("brandLogo");
    const logoImg = $("brandLogoImg");

    if (name) name.textContent = c.brandName || DEFAULT_BRAND;
    if (tag) {
      tag.textContent = c.tagline || "";
      tag.hidden = c.showTagline === false || !c.tagline;
    }

    if (logoBox && logoImg) {
      logoBox.hidden = c.showLogo === false;
      const custom = !!logoUrl;
      logoBox.classList.toggle("custom-logo", custom);
      // config.js (the API address) isn't loaded yet when the saved copy is
      // applied at page start — leave the logo alone until it is; the
      // DOMContentLoaded re-apply below sets it.
      const baseKnown = typeof window.FRESHCUTZ_API_BASE === "string";
      const src = custom ? `${window.FRESHCUTZ_API_BASE || ""}${logoUrl}` : DEFAULT_LOGO;
      if ((!custom || baseKnown) && logoImg.getAttribute("src") !== src) logoImg.setAttribute("src", src);
      logoImg.alt = `${c.brandName || "Shop"} logo`;
      const icon = document.querySelector('link[rel="icon"]');
      if (icon && custom && baseKnown) icon.setAttribute("href", src);
    }

    if (c.pageTitle) {
      document.title = c.pageTitle;
    } else if (c.brandName !== DEFAULT_BRAND || c.tagline !== DEFAULT_TAGLINE) {
      document.title = c.showTagline === false || !c.tagline ? c.brandName : `${c.brandName} — ${c.tagline}`;
    } else {
      document.title = ORIGINAL_TITLE;
    }
  }

  function applyHero(c) {
    const hero = $("heroSection");
    const heading = $("heroHeading");
    const text = $("heroText");
    const badges = $("heroBadges");
    if (!hero) return;

    hero.hidden = c.showHero === false;
    hero.classList.toggle("hero-left", c.heroAlign === "left");

    const cta = $("heroCta");
    if (cta) {
      cta.textContent = c.heroButtonText || DEFAULTS.heroButtonText;
      cta.hidden = c.showHeroButton !== true || !c.heroButtonText;
    }

    if (heading) {
      heading.textContent = (c.heroHeading || "").replace(/\s+$/, "");
      if (c.heroHighlight) {
        if (heading.textContent) heading.appendChild(document.createTextNode(" "));
        const span = document.createElement("span");
        span.id = "heroHighlight";
        span.textContent = c.heroHighlight;
        heading.appendChild(span);
      }
    }

    if (text) {
      text.textContent = c.heroText || "";
      text.hidden = c.showHeroText === false || !c.heroText;
    }

    if (badges) {
      badges.textContent = "";
      (c.badges || [])
        .filter((b) => b && b.enabled !== false && b.text)
        .forEach((b) => {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = b.icon ? `${b.icon} ${b.text}` : b.text;
          badges.appendChild(chip);
        });
      badges.hidden = c.showBadges === false || badges.childElementCount === 0;
    }
  }

  function applyHeaderButtons(c) {
    const wa = $("whatsappLink");
    const account = $("profileIconBtn");
    if (wa) {
      wa.hidden = c.showWhatsapp === false;
      // Admin-set number; blank keeps the default that storefront.js sets
      // from config.js. dataset.custom stops storefront.js overwriting it.
      const digits = String(c.whatsappNumber || "").replace(/\D/g, "");
      if (digits) {
        wa.href = `https://wa.me/${digits}`;
        wa.dataset.custom = "1";
      } else if (wa.dataset.custom) {
        const def = String(window.FRESHCUTZ_WHATSAPP || "").replace(/\D/g, "");
        if (def) wa.href = `https://wa.me/${def}`;
        delete wa.dataset.custom;
      }
    }
    if (account) account.hidden = c.showAccount === false;
  }

  /** Announcement strip, search box, category bar, cart-bar button, offline
   * banner, which parts of a product card show, fonts and corners. */
  function applyShop(c) {
    const bar = $("announceBar");
    if (bar) {
      bar.textContent = c.announcementText || "";
      bar.hidden = c.showAnnouncement !== true || !c.announcementText;
    }

    // cart animations on/off (css/cart-fx.css reads this class)
    document.documentElement.classList.toggle("no-cart-fx", c.showCartAnimations === false);

    const searchWrap = $("searchWrap");
    const searchInput = $("searchInput");
    if (searchWrap) searchWrap.hidden = c.showSearch === false;
    if (searchInput) searchInput.placeholder = t("searchPlaceholder");
    const categoryBar = $("categoryBar");
    if (categoryBar) categoryBar.hidden = c.showCategories === false;

    const viewCart = $("viewCartBtn");
    if (viewCart) viewCart.textContent = t("viewCartText");

    const offline = $("storeOfflineBanner");
    if (offline) offline.textContent = t("offlineBannerText");

    root.classList.toggle("sc-hide-discount", c.showDiscountBadge === false);
    root.classList.toggle("sc-hide-mrp", c.showMrp === false);
    root.classList.toggle("sc-hide-desc", c.showProductDescription === false);

    // Fonts
    if (c.fontStyle === "modern") {
      setVar("--font-display", BODY_FONT);
      clearVar("--font-body");
    } else if (c.fontStyle === "elegant") {
      setVar("--font-display", SERIF_FONT);
      setVar("--font-body", SERIF_FONT);
    } else {
      clearVar("--font-display");
      clearVar("--font-body");
    }

    // Corners
    const radii = {
      sharp: { "--r-sm": "4px", "--r-md": "6px", "--r-lg": "8px", "--r-xl": "0px" },
      round: { "--r-sm": "14px", "--r-md": "24px", "--r-lg": "32px", "--r-xl": "44px" },
    }[c.cornerStyle];
    ["--r-sm", "--r-md", "--r-lg", "--r-xl"].forEach((name) => (radii ? setVar(name, radii[name]) : clearVar(name)));
  }

  // config key -> the CSS multiplier it drives (see the calc(… var(--sz-x, 1)) rules)
  const SIZE_VARS = [
    ["sizeLogo", "logo"],
    ["sizeHeaderIcons", "hicon"],
    ["sizeBrandName", "brand"],
    ["sizeTagline", "tagline"],
    ["sizeHeroHeading", "heroh"],
    ["sizeHeroText", "herop"],
    ["sizeBadges", "badges"],
    ["sizeAnnouncement", "announce"],
    ["sizeCategories", "cats"],
    ["sizeSearch", "search"],
    ["sizeProductName", "pname"],
    ["sizeProductDesc", "pdesc"],
    ["sizePrice", "price"],
    ["sizePhotoBadge", "pbadge"],
    ["sizeButtons", "buttons"],
    ["sizeCartBar", "cartbar"],
    ["sizeFooter", "footer"],
  ];

  function pct(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.max(10, Math.min(1000, n)) / 100 : 1;
  }

  /** Text, image and icon sizes — every one a percentage of the original. */
  function applySizes(c) {
    SIZE_VARS.forEach(([key, name]) => {
      const m = pct(c[key]);
      if (m === 1) clearVar(`--sz-${name}`);
      else setVar(`--sz-${name}`, m.toFixed(2));
    });

    // The header grows with a bigger logo / buttons so nothing gets clipped.
    const headerH = Math.max(54, Math.round(34 * pct(c.sizeLogo)) + 20, Math.round(34 * pct(c.sizeHeaderIcons)) + 20);
    if (headerH > 54) setVar("--header-h", `${headerH}px`);
    else clearVar("--header-h");

    // Product photo height: the original shapes are 4:3 (phones) and square
    // (wider screens); a taller photo just makes the second number bigger.
    const img = pct(c.sizeProductImage);
    if (img === 1) {
      clearVar("--site-img-ratio-m");
      clearVar("--site-img-ratio-d");
    } else {
      setVar("--site-img-ratio-m", `4 / ${(3 * img).toFixed(3)}`);
      setVar("--site-img-ratio-d", `1 / ${img.toFixed(3)}`);
    }
  }

  /** Where pop-up messages appear (see the #toastHost[data-pos] rules in components.css). */
  function applyToasts(c) {
    const host = $("toastHost");
    if (host) {
      if (c.toastPosition && c.toastPosition !== "auto") host.dataset.pos = c.toastPosition;
      else delete host.dataset.pos;
    }
    const dx = Number(c.toastOffsetX) || 0;
    const dy = Number(c.toastOffsetY) || 0;
    if (dx || dy) {
      setVar("--toast-dx", `${dx}px`);
      setVar("--toast-dy", `${dy}px`);
    } else {
      clearVar("--toast-dx");
      clearVar("--toast-dy");
    }
  }

  /** Per-element fine-tuning (the "Fine-tune" part of the Customize tab):
   * one <style> element, rebuilt from the saved settings every time. */
  function applyMicro(c) {
    if (!window.SiteElements) return;
    let tag = $("siteMicroStyles");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "siteMicroStyles";
      document.head.appendChild(tag);
    }
    tag.textContent = window.SiteElements.toCss(c.styles, c.animationsOff === true);
    // a font that is not already part of the website is fetched only when something uses it
    const families = window.SiteElements.fontFamilies(c.styles);
    let link = $("siteFontLink");
    if (!families.length) {
      if (link) link.remove();
    } else {
      const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join("&")}&display=swap`;
      if (!link) {
        link = document.createElement("link");
        link.id = "siteFontLink";
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    }
  }

  function footerLine(parent, className, text) {
    const div = document.createElement("div");
    if (className) div.className = className;
    div.textContent = text;
    parent.appendChild(div);
    return div;
  }

  function footerLink(parent, href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    parent.appendChild(a);
    return a;
  }

  function applyFooter(c) {
    const footer = $("siteFooter");
    if (!footer) return;
    footer.textContent = "";

    const inner = document.createElement("div");
    inner.className = "container footer-inner";
    footerLine(inner, "footer-brand", c.brandName || DEFAULT_BRAND);
    if (c.footerAbout) footerLine(inner, "", c.footerAbout);
    if (c.footerAddress) footerLine(inner, "", `📍 ${c.footerAddress}`);
    if (c.footerHours) footerLine(inner, "", `🕒 ${c.footerHours}`);

    const phoneDigits = String(c.footerPhone || "").replace(/[^\d+]/g, "");
    if (phoneDigits) footerLink(footerLine(inner, "", "📞 "), `tel:${phoneDigits}`, c.footerPhone);
    if (c.footerEmail) footerLink(footerLine(inner, "", "✉️ "), `mailto:${c.footerEmail}`, c.footerEmail);

    const social = document.createElement("div");
    social.className = "footer-social";
    [
      ["Instagram", c.instagramUrl],
      ["Facebook", c.facebookUrl],
    ].forEach(([label, url]) => {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        const a = footerLink(social, url, label);
        a.target = "_blank";
        a.rel = "noopener";
      }
    });
    if (social.childElementCount) inner.appendChild(social);

    if (c.footerCopyright) {
      const text = c.footerCopyright
        .replace(/\{year\}/g, String(new Date().getFullYear()))
        .replace(/\{brand\}/g, c.brandName || DEFAULT_BRAND);
      footerLine(inner, "footer-copy", text);
    }

    footer.appendChild(inner);
    footer.hidden = c.showFooter !== true;
  }

  /** Which settings differ between two copies (their names), so the parts of the page that only care about some of
   * them can leave everything else alone. null = not known (the first copy applied): treat as "everything". */
  function changedSettings(before, after, logoBefore, logoAfter) {
    if (!before) return null;
    const changed = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
    }
    if (logoBefore !== logoAfter) changed.push("logoUrl");
    return changed;
  }

  function apply(site) {
    if (!site || !site.config) return;
    const json = JSON.stringify(site);
    if (json === lastApplied) return;
    lastApplied = json;
    const changed = changedSettings(current, site.config, lastLogoUrl, site.logoUrl);
    lastLogoUrl = site.logoUrl;
    try {
      applyColors(site.config);
      applyBrand(site.config, site.logoUrl);
      applyHero(site.config);
      applyHeaderButtons(site.config);
      current = site.config;
      applyShop(site.config);
      applySizes(site.config);
      applyMicro(site.config);
      applyToasts(site.config);
      applyFooter(site.config);
      document.dispatchEvent(new CustomEvent("freshcutz:site", { detail: { changed } }));
    } catch (err) {
      // A bad value must never take the storefront down — keep the page as it is.
      console.warn("Could not apply site customization", err);
    }
  }

  /** Saves the settings (and the server's fingerprint of them) for the next visit, in ONE write so they always match. */
  function remember(site, version) {
    try {
      localStorage.setItem(CACHE_KEY_V2, JSON.stringify({ v: version || null, site }));
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* private mode / storage full — the live copy still applies */
    }
  }

  /** What was saved last visit: { v, site } (v is null for a copy saved by an older version of this script). */
  function loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY_V2) || "null");
      if (saved && saved.site) return saved;
      const old = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return old ? { v: null, site: old } : null;
    } catch {
      return null;
    }
  }

  // ---- live updates ------------------------------------------------------
  // The stream sends the whole look only when this page does not have it yet ("sitefull"), and after that only what an
  // admin changed ("sitepatch"): a banner switched off is a few bytes, not the whole design again. `held` is the whole
  // look as this page has it now, and `heldVersion` the server's fingerprint of it. A returning visitor tells the
  // stream the fingerprint of what it saved last time; if that is still current the stream just says so ("sitesame"),
  // so coming back to the shop, or to this tab, costs a few bytes. A patch is only applied on top of the exact copy it
  // was made from — otherwise (a missed message) the page reconnects and gets the whole look again.
  let held = null;
  let heldVersion = null;
  {
    const saved = loadSaved();
    if (saved && saved.v) {
      held = saved.site;
      heldVersion = saved.v;
    }
  }

  /** Puts a patch (see SiteDiff.java) on top of an object: changed values replace, objects merge, "$del" removes keys,
   * and lists of things with an id ({"$arr":true, order, set}) are rebuilt from the ones held plus their changes. */
  function mergePatch(base, patch) {
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "$del") {
        for (const name of value) delete out[name];
        continue;
      }
      const before = base[key];
      const isObj = value && typeof value === "object" && !Array.isArray(value);
      if (isObj && value.$arr === true) {
        if (!Array.isArray(before)) throw new Error("list patch without a list");
        out[key] = mergeList(before, value);
      } else if (isObj && before && typeof before === "object" && !Array.isArray(before)) {
        out[key] = mergePatch(before, value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  function mergeList(list, patch) {
    const byId = new Map(list.map((el) => [el.id, el]));
    const ids = patch.order || list.map((el) => el.id);
    return ids.map((id) => {
      const el = byId.get(id);
      const change = patch.set && patch.set[id];
      const next = el ? (change ? mergePatch(el, change) : el) : change; // (a new one comes whole)
      if (!next) throw new Error("list patch refers to something not held");
      return next;
    });
  }

  function showSite(site, version) {
    apply(site);
    remember(site, version);
  }

  /** Starts again from the whole look (the page got out of step with the server). */
  function resync() {
    held = null;
    heldVersion = null;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    connect();
  }

  // A signed-in customer's page also tells the stream who it is (and which version of its "Buy it again" list it holds, see
  // site-specials.js): the server then sends that list when the stream connects (or says it is unchanged) and again whenever an
  // order of that customer is placed, cancelled or reopened - only when the list really changed - so the page never asks for it.
  let streamPhone = "";
  function who() {
    try {
      return (window.BuyAgain && window.BuyAgain.who && window.BuyAgain.who()) || null;
    } catch {
      return null;
    }
  }
  function tell(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch {
      /* ignore */
    }
  }
  function usualsMessage(kind) {
    return (e) => {
      try {
        tell("freshcutz:usuals", { ...JSON.parse(e.data), kind, phone: streamPhone });
      } catch {
        /* malformed push — the page asks for the list itself if nothing better arrives */
      }
    };
  }

  function connect() {
    if (eventSource || !window.EventSource) return;
    const base = window.FRESHCUTZ_API_BASE || "";
    const have = heldVersion ? `&have=${encodeURIComponent(heldVersion)}` : "";
    const me = who();
    streamPhone = me ? me.phone : "";
    const customer = me ? `&phone=${encodeURIComponent(me.phone)}${me.v ? `&uv=${encodeURIComponent(me.v)}` : ""}` : "";
    eventSource = new EventSource(`${base}/api/store/site/stream?compact=1${have}${customer}`);
    window.FreshcutzStream = { phone: streamPhone };
    eventSource.addEventListener("open", () => tell("freshcutz:stream", { phone: streamPhone }));
    eventSource.addEventListener("usuals", usualsMessage("usuals"));
    eventSource.addEventListener("usame", usualsMessage("usame"));
    eventSource.addEventListener("usoff", usualsMessage("usoff")); // (the server handles lists; the row is switched off)
    // the admin changed the status of one of this customer's orders: just that is sent (a few bytes), see profile.js
    eventSource.addEventListener("orderstatus", (e) => {
      try {
        tell("freshcutz:orderstatus", JSON.parse(e.data));
      } catch {
        /* malformed push — the account page asks for its orders when it is next opened */
      }
    });
    // the wording of the "Cancel order" screens (set in Customize); sent once when a signed-in customer connects
    eventSource.addEventListener("cancelui", (e) => {
      try {
        tell("freshcutz:cancelui", JSON.parse(e.data));
      } catch {
        /* malformed push — the standard wording stays */
      }
    });
    eventSource.addEventListener("sitesame", () => {
      if (held) apply(held); // what this page saved is still current (nothing more was sent)
    });
    eventSource.addEventListener("sitefull", (e) => {
      try {
        const m = JSON.parse(e.data);
        held = m.site;
        heldVersion = m.v;
        showSite(held, heldVersion);
      } catch {
        /* malformed push — keep what is showing and wait for the next one */
      }
    });
    eventSource.addEventListener("sitepatch", (e) => {
      try {
        const m = JSON.parse(e.data);
        if (!held || m.prev !== heldVersion) return resync();
        held = mergePatch(held, m.patch);
        heldVersion = m.v;
        showSite(held, heldVersion);
      } catch {
        resync(); // could not be applied: ask for the whole look again
      }
    });
    // EventSource reconnects by itself after a drop (and then the whole look arrives again).
  }

  function disconnect() {
    window.FreshcutzStream = null;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    // (what is held is kept: the next connection says which copy it has, and gets "sitesame" if it is still current)
  }

  // ---- admin live preview ----------------------------------------------------
  // The Customize tab can show this very page in a frame (index.html?preview=1)
  // and send it the settings being edited, unsaved, so the admin sees the real
  // site change as they type. Only a same-origin parent is listened to; in that
  // mode the page ignores the saved copy and the live stream so nothing
  // overwrites what is being previewed, and never stores what it receives.
  let inPreview = false;
  let previewBanners = null;
  let previewBannersAsked = false;
  let lastPreview = null;
  try {
    inPreview = window.parent !== window && /[?&]preview=1(&|$)/.test(location.search);
  } catch {
    inPreview = false;
  }
  if (inPreview) {
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === "freshcutz-preview") {
        // The admin's Customize form no longer carries the banners (they live in the Banners tab),
        // so the preview borrows the live banners once and keeps them for later updates.
        const site = e.data.site;
        const cfgIn = site && site.config;
        if (cfgIn && !(Array.isArray(cfgIn.banners) && cfgIn.banners.length)) {
          if (previewBanners) {
            site.config = { ...cfgIn, banners: previewBanners };
          } else if (!previewBannersAsked) {
            previewBannersAsked = true;
            fetch(`${window.FRESHCUTZ_API_BASE || ""}/api/store/site`)
              .then((r) => (r.ok ? r.json() : null))
              .then((live) => {
                previewBanners = (live && live.config && live.config.banners) || [];
                if (previewBanners.length && lastPreview) apply({ ...lastPreview, config: { ...lastPreview.config, banners: previewBanners } });
              })
              .catch(() => {
                previewBanners = [];
              });
          }
        }
        lastPreview = e.data.site;
        apply(site);
      } else if (e.data.type === "freshcutz-preview-toast" && typeof Toast !== "undefined" && Toast.msg) {
        // "Show it" button in the admin: display that message right now, even if switched off
        Toast.msg(
          String(e.data.key || ""),
          { name: "Chicken Curry Cut", names: "Country Eggs", isAre: "is", message: "Something went wrong" },
          { force: true }
        );
      }
    });
    try {
      window.parent.postMessage({ type: "freshcutz-preview-ready" }, location.origin);
    } catch {
      /* no parent to tell */
    }
    document.addEventListener("DOMContentLoaded", () => {
      try {
        window.parent.postMessage({ type: "freshcutz-preview-ready" }, location.origin);
      } catch {
        /* no parent to tell */
      }
    });
    return;
  }

  // Same reasoning as store-status.js / storefront-sync.js: no live
  // connection for a backgrounded tab; reconnect (which re-sends the
  // current settings) once it is visible again.
  document.addEventListener("visibilitychange", () => (document.hidden ? disconnect() : connect()));
  // a customer signed in or out: reconnect so the stream knows who this page is now (the look held is kept, so that costs a few bytes)
  // the page wants the stream asked again (a number it was not told, e.g. the admin raised the count): reconnect - the answer is
  // the list or "unchanged", a few bytes - instead of a separate request
  window.addEventListener("freshcutz:refresh", () => {
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
    connect();
  });
  window.addEventListener("freshcutz:who", () => {
    if (!eventSource) return; // (hidden tab: the next connection says who)
    const me = who();
    if ((me ? me.phone : "") === streamPhone) return;
    eventSource.close();
    eventSource = null;
    connect();
  });

  const savedLook = loadSaved();
  const cached = savedLook && savedLook.site;
  if (cached) apply(cached);

  // config.js (which defines the API address) loads later in the page, so
  // the connection waits until everything has run.
  document.addEventListener("DOMContentLoaded", () => {
    if (cached) {
      lastApplied = null; // re-apply now that the API address is known (custom logo URL)
      apply(cached);
    }
    if (!document.hidden) connect();
  });
})();
