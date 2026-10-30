/* The list of every individual piece of the customer website that the admin
 * can fine-tune in the Customize tab, plus the settings each one accepts and
 * the code that turns the saved settings into CSS.
 *
 * Shared by the storefront (site-customize.js builds the stylesheet from it)
 * and the admin form (admin-customize.js builds the editor from it), so the
 * two can never disagree about what exists.
 *
 * Safety: the CSS is assembled only from this fixed list of selectors and
 * property names; a saved value is re-checked here against the same patterns
 * the server uses, so nothing but plain colors, lengths and keywords can ever
 * reach a stylesheet. */

window.SiteElements = (() => {
  // [key, label, CSS selector]
  const GROUPS = [
    {
      title: "Whole page",
      items: [
        ["page", "Page (background & default text)", "body.storefront"],
        ["catalog", "Product area", ".catalog"],
      ],
    },
    {
      title: "Header",
      items: [
        ["header", "Header bar", ".site-header"],
        ["logo", "Logo circle", ".brand-logo"],
        ["logoImage", "Logo picture", ".brand-logo img"],
        ["brandName", "Brand name", ".brand-text .name"],
        ["tagline", "Tagline", ".brand-text .tag"],
        ["headerButtons", "Header buttons (both)", ".header-actions .icon-btn"],
        ["whatsappButton", "WhatsApp button", "#whatsappLink"],
        ["accountButton", "My Account button", "#profileIconBtn"],
      ],
    },
    {
      title: "Announcement & offline notices",
      items: [
        ["announceBar", "Announcement bar", "#announceBar"],
        ["offlineBanner", "Store-offline banner", ".store-offline-banner"],
      ],
    },
    {
      title: "Hero banner",
      items: [
        ["hero", "Hero banner (whole section)", ".hero"],
        ["heroHeading", "Hero heading", ".hero h1"],
        ["heroHighlight", "Highlighted words", "#heroHighlight"],
        ["heroText", "Line under the heading", "#heroText"],
        ["heroBadgeRow", "Badge row", ".hero-badges"],
        ["heroBadge", "Each badge", ".hero-badges .chip"],
        ["heroButton", "Hero button", "#heroCta"],
      ],
    },
    {
      title: "Sliding banners",
      items: [
        ["bannerBadge", "Banner name - the glass tag on the banner", ".sb-badge"],
        ["bannerBox", "Banner pictures box", ".sb-box"],
      ],
    },
    {
      title: "Category bar",
      items: [
        ["categoryBar", "Category bar", ".category-bar"],
        ["categoryChip", "Category chips", ".cat-chip"],
        ["categoryChipActive", "Selected category chip", ".cat-chip.active"],
      ],
    },
    {
      title: "Search",
      items: [
        ["searchWrap", "Search area (around the box)", ".search-bar-wrap"],
        ["searchBox", "Search box", ".search-bar"],
        ["searchInput", "Search typing area", ".search-bar-input"],
        ["searchIcon", "Search magnifier icon", ".search-bar-icon"],
        ["searchClear", "Search clear (✕) button", ".search-clear-x"],
      ],
    },
    {
      title: "Product cards",
      items: [
        ["productGrid", "Grid of cards", ".product-grid"],
        ["productCard", "Each card", ".product-card"],
        ["productPhoto", "Photo area", ".product-media-frame"],
        ["productImage", "Photo itself", ".product-media-frame img"],
        ["discountBadge", "“% OFF” badge", ".discount-badge"],
        ["outOfStockBadge", "“Out of stock” badge", ".out-of-stock-badge"],
        ["productBody", "Text area under the photo", ".product-body"],
        ["productFooter", "Row holding Add to cart / quantity control", ".product-footer"],
        ["cartControl", "★ Add to cart + − 1 + control (both together)", ".add-btn, .qty-stepper", ".qty-stepper button, .qty-stepper .qty-value"],
        ["productName", "Product name", ".product-name"],
        ["productDesc", "Product description", ".product-desc"],
        ["variantRow", "Weight/size options row", ".variant-toggle"],
        ["variantButton", "Weight/size option buttons", ".variant-toggle button"],
        ["variantButtonActive", "Selected weight/size option", ".variant-toggle button.active"],
        ["priceNow", "Price", ".price-now"],
        ["priceMrp", "Crossed-out price", ".price-mrp"],
        ["addButton", "“Add to cart” button", ".add-btn:not(.out-of-stock-btn)"],
        ["outOfStockButton", "“Out of stock” button", ".out-of-stock-btn"],
        ["qtyStepper", "Quantity − 1 + control", ".qty-stepper"],
        ["qtyButton", "Quantity − and + buttons", ".qty-stepper button"],
        ["qtyValue", "Quantity number", ".qty-stepper .qty-value"],
        ["emptyState", "“No products” message", "#emptyState"],
      ],
    },
    {
      title: "Cart bar (bottom of screen)",
      items: [
        ["cartBar", "Cart bar", "#cartBar"],
        ["cartBarCount", "Item count", ".cart-bar-info .count"],
        ["cartBarTotal", "Total amount", ".cart-bar-info .total"],
        ["cartBarButton", "View cart button", "#viewCartBtn"],
      ],
    },
    {
      title: "Cart, checkout & account panels",
      items: [
        ["sheet", "Panel itself", ".sheet"],
        ["sheetHeader", "Panel title bar", ".sheet-header"],
        ["sheetTitle", "Panel title text", ".sheet-header h2"],
        ["sheetClose", "Panel close (✕) button", ".sheet-close"],
        ["sheetBody", "Panel content area", ".sheet-body"],
        ["sheetFooter", "Panel bottom area (totals & button)", ".sheet-footer"],
        ["cartItem", "Each cart item", ".cart-item"],
        ["cartItemImage", "Cart item photo", ".cart-item img"],
        ["cartItemName", "Cart item name", ".cart-item-name"],
        ["cartItemVariant", "Cart item weight/size", ".cart-item-variant"],
        ["cartItemPrice", "Cart item price", ".cart-item-price"],
        ["cartItemDelete", "Cart item delete (bin) button", ".cart-item-delete"],
        ["summaryRow", "Total / summary rows", ".summary-row"],
        ["summaryTotal", "Final total row", ".summary-row.total"],
        ["formLabel", "Form labels (name, phone, address…)", ".sheet .field label"],
        ["formInput", "Form text boxes", ".sheet .field input, .sheet .field textarea"],
        ["goldButton", "Main buttons in panels (gold)", ".sheet .btn-gold"],
        ["darkButton", "Dark buttons in panels", ".sheet .btn-dark"],
        ["ghostButton", "Light buttons in panels", ".sheet .btn-ghost"],
        ["successTitle", "“Order placed” heading", ".order-success h2"],
        ["successCheck", "“Order placed” tick circle", ".success-check"],
        ["orderIdChip", "Order ID box", ".order-id-chip"],
        ["profileOrderCard", "Each past order in My Account", ".profile-order-card"],
      ],
    },
    {
      title: "Pop-up messages",
      items: [
        ["toastHost", "Pop-up area (all pop-ups together)", "#toastHost"],
        ["toast", "Every pop-up", ".toast"],
        ["toastSuccess", "Success pop-ups (green edge)", ".toast.success"],
        ["toastError", "Error pop-ups (red edge)", ".toast.error"],
        ["toastInfo", "Info pop-ups", ".toast.info"],
      ],
    },
    {
      title: "Footer",
      items: [
        ["footer", "Footer", ".site-footer"],
        ["footerBrand", "Footer brand name", ".site-footer .footer-brand"],
        ["footerLinks", "Footer links", ".site-footer a"],
        ["footerCopy", "Copyright line", ".site-footer .footer-copy"],
      ],
    },
  ];

  // ---- editable messages & texts ---------------------------------------------------
  // kind "toast": a pop-up (text, on/off, seconds, style). kind "text": plain wording only.
  // `vars` lists the {placeholders} the text may use.
  const MESSAGE_GROUPS = [
    {
      title: "Pop-up messages",
      items: [
        { key: "addedToCart", label: "Added to cart", def: "{name} added to cart", tone: "success", kind: "toast", vars: "{name}" },
        { key: "itemRemoved", label: "Item removed from cart (no longer available)", def: "{name} was removed from your cart — no longer available", tone: "error", kind: "toast", vars: "{name}" },
        { key: "reorderAdded", label: "Reorder added to cart", def: "Good choices deserve a repeat! 😍 Added to your cart.", tone: "success", kind: "toast" },
        { key: "reorderUnavailable", label: "Reorder: some items unavailable", def: "{names} {isAre} currently unavailable and couldn't be added", tone: "error", kind: "toast", vars: "{names} {isAre}" },
        { key: "loggedOut", label: "Signed out", def: "Signed out", tone: "success", kind: "toast" },
        { key: "detailsUpdated", label: "Details updated", def: "Details updated successfully", tone: "success", kind: "toast" },
        { key: "serverError", label: "Errors from the server (order failed, wrong phone…)", def: "{message}", tone: "error", kind: "toast", vars: "{message}" },
      ],
    },
    {
      title: "Form messages (shown under a box)",
      items: [
        { key: "errName", label: "Name missing", def: "Please enter your name", kind: "text" },
        { key: "errPhone", label: "Mobile number not valid", def: "Enter a valid 10-digit mobile number", kind: "text" },
        { key: "errFlat", label: "Flat / house number missing", def: "Please enter your flat / house no.", kind: "text" },
        { key: "errAddress", label: "Address missing", def: "Please enter your address", kind: "text" },
      ],
    },
    {
      title: "Buttons, titles & other wording",
      items: [
        { key: "clearCartText", label: "“Clear cart” button", def: "Clear cart", kind: "text" },
        { key: "nextButtonText", label: "“Next” button (details step)", def: "Next →", kind: "text" },
        { key: "placingOrderText", label: "Text while the order is being placed", def: "Placing order...", kind: "text" },
        { key: "continueShoppingText", label: "“Continue Shopping” button", def: "Continue Shopping", kind: "text" },
        { key: "loginButtonText", label: "“Sign in” button", def: "Sign in", kind: "text" },
        { key: "logoutButtonText", label: "“Sign out” button", def: "Sign out", kind: "text" },
        { key: "updateDetailsText", label: "“Update Details” button", def: "Update Details", kind: "text" },
        { key: "reorderButtonText", label: "“Reorder” button on past orders", def: "↺ Reorder", kind: "text" },
        { key: "myAddressTitle", label: "“My Address” heading", def: "My Address", kind: "text" },
        { key: "myOrdersTitle", label: "“My Orders” heading", def: "My Orders", kind: "text" },
        { key: "noOrdersText", label: "Message when there are no past orders", def: "No orders yet.", kind: "text" },
        { key: "orderIdLabel", label: "“Order ID:” label", def: "Order ID:", kind: "text" },
        { key: "itemsLabel", label: "“Items” label", def: "Items", kind: "text" },
        { key: "totalLabel", label: "“Total” label", def: "Total", kind: "text" },
        { key: "codTotalLabel", label: "Checkout total label", def: "Total (Cash on Delivery)", kind: "text" },
        { key: "yourNoteLabel", label: "“Your note:” label", def: "Your note:", kind: "text" },
        { key: "yourSlotLabel", label: "“Delivery time:” label (order-placed screen)", def: "Delivery time:", kind: "text" },
        { key: "screenshotHintText", label: "Screenshot reminder on the order-placed screen", def: "📸 Take a screenshot of this page to keep for your reference.", kind: "text" },
        { key: "loadingAccountText", label: "“Loading your account” text", def: "Loading your account…", kind: "text" },
        { key: "loadingDetailsText", label: "“Loading your details” text", def: "Loading your details…", kind: "text" },
      ],
    },
  ];
  const MESSAGES = {};
  MESSAGE_GROUPS.forEach((g) => g.items.forEach((m) => (MESSAGES[m.key] = m)));

  const SELECTORS = {};
  // Some entries style several places at once (the 4th value is a second selector
  // that only receives the text settings — so one text color / size reaches the
  // − and + signs and the number too, not just the outer box).
  const TEXT_SELECTORS = {};
  // These apply first, so an element-specific setting (e.g. just the Add button) can still win.
  const SHARED = new Set(["cartControl"]);
  GROUPS.forEach((g) =>
    g.items.forEach(([key, , selector, textSelector]) => {
      SELECTORS[key] = selector;
      if (textSelector) TEXT_SELECTORS[key] = textSelector;
    })
  );

  // Fonts the admin can pick. Inter and Playfair Display are already part of the website; the others are fetched from
  // Google Fonts only when some element actually uses them (see fontFamilies() / site-customize.js).
  // key -> [label, CSS font stack, Google Fonts family or null]
  const FONTS = {
    inter: ["Inter - clean, modern (website text)", '"Inter",-apple-system,"Segoe UI",Roboto,Arial,sans-serif', null],
    playfair: ["Playfair Display - elegant serif (website headings)", '"Playfair Display",Georgia,"Times New Roman",serif', null],
    poppins: ["Poppins - friendly, rounded", '"Poppins","Inter",sans-serif', "Poppins:wght@400;600;700;800"],
    montserrat: ["Montserrat - bold, stylish", '"Montserrat","Inter",sans-serif', "Montserrat:wght@400;600;700;800"],
    oswald: ["Oswald - tall, strong (great for offers)", '"Oswald","Arial Narrow",sans-serif', "Oswald:wght@400;500;600;700"],
    lobster: ["Lobster - fun script", '"Lobster","Brush Script MT",cursive', "Lobster"],
    pacifico: ["Pacifico - handwritten", '"Pacifico","Brush Script MT",cursive', "Pacifico"],
    dancing: ["Dancing Script - elegant handwriting", '"Dancing Script","Brush Script MT",cursive', "Dancing+Script:wght@500;700"],
    georgia: ["Georgia - classic serif", 'Georgia,"Times New Roman",serif', null],
    arial: ["Arial - plain", 'Arial,Helvetica,sans-serif', null],
    courier: ["Courier - typewriter", '"Courier New",Courier,monospace', null],
  };

  // type: color | length | box | number | select
  const PROP_GROUPS = [
    {
      title: "Text",
      props: [
        { key: "color", label: "Text color", type: "color" },
        { key: "fontFamily", label: "Font", type: "select", options: Object.entries(FONTS).map(([k, f]) => [k, f[0]]) },
        { key: "fontSize", label: "Text size", type: "length", hint: "e.g. 18 (pixels), 1.2rem" },
        {
          key: "fontWeight",
          label: "Boldness",
          type: "select",
          options: [["400", "Normal"], ["500", "Medium"], ["600", "Semi-bold"], ["700", "Bold"], ["800", "Extra bold"], ["900", "Black"]],
        },
        { key: "lineHeight", label: "Line spacing", type: "number", hint: "e.g. 1.4" },
        { key: "letterSpacing", label: "Letter spacing", type: "length", hint: "e.g. 1 or 0.05em" },
        { key: "textAlign", label: "Text alignment", type: "select", options: [["left", "Left"], ["center", "Center"], ["right", "Right"]] },
      ],
    },
    {
      title: "Size & spacing",
      props: [
        { key: "width", label: "Width", type: "length", hint: "e.g. 200, 80%, auto" },
        { key: "height", label: "Height", type: "length", hint: "e.g. 56, 50vh" },
        { key: "minHeight", label: "Minimum height", type: "length", hint: "e.g. 44" },
        { key: "maxWidth", label: "Maximum width", type: "length", hint: "e.g. 420" },
        { key: "padding", label: "Inner space (padding)", type: "box", hint: "1–4 numbers: 12 or 8 16" },
        { key: "margin", label: "Outer space (margin)", type: "box", hint: "1–4 numbers: 10 or 0 auto" },
        { key: "gap", label: "Space between the items inside", type: "length", hint: "e.g. 12" },
        { key: "zoom", label: "Overall size (%) — scales the whole element", type: "number", hint: "100 = normal, 50 = half size, 150 = one and a half" },
      ],
    },
    {
      title: "Position",
      props: [
        { key: "moveX", label: "Move right (+) / left (−)", type: "length", hint: "e.g. 10 or -20" },
        { key: "moveY", label: "Move down (+) / up (−)", type: "length", hint: "e.g. 8 or -12" },
        {
          key: "justify",
          label: "Where the items inside sit (rows)",
          type: "select",
          options: [["start", "Start (left)"], ["center", "Center"], ["end", "End (right)"], ["between", "Spread apart"], ["around", "Spread evenly"]],
        },
      ],
    },
    {
      title: "Look",
      props: [
        { key: "background", label: "Background color", type: "color" },
        { key: "borderRadius", label: "Corner roundness", type: "length", hint: "e.g. 12, 999 for pill, 50% circle" },
        { key: "borderWidth", label: "Border thickness", type: "length", hint: "e.g. 2" },
        { key: "borderColor", label: "Border color", type: "color" },
        {
          key: "boxShadow",
          label: "Shadow",
          type: "select",
          options: [["none", "None"], ["soft", "Soft"], ["medium", "Medium"], ["strong", "Strong"]],
        },
        { key: "opacity", label: "Opacity (0–100)", type: "number", hint: "100 = solid, 50 = half see-through" },
        { key: "blur", label: "Background blur (glass effect, pixels)", type: "number", hint: "0 = clear, 5 = frosted, 20 = very frosted" },
        {
          key: "objectFit",
          label: "Picture fit",
          type: "select",
          options: [["cover", "Fill & crop"], ["contain", "Show whole picture"], ["fill", "Stretch"]],
        },
      ],
    },
    {
      title: "Motion & visibility",
      props: [
        {
          key: "animation",
          label: "Animation",
          type: "select",
          options: [
            ["none", "None"], ["fadeIn", "Fade in"], ["slideUp", "Slide up"], ["slideDown", "Slide down"],
            ["zoomIn", "Zoom in"], ["pulse", "Pulse (repeats)"], ["bounce", "Bounce (repeats)"],
            ["shake", "Shake"], ["glow", "Glow (repeats)"], ["float", "Float (repeats)"],
          ],
        },
        { key: "animationSpeed", label: "Animation length (seconds)", type: "number", hint: "e.g. 0.6" },
        {
          key: "scope",
          label: "Apply these settings on",
          type: "select",
          options: [["all", "All screens"], ["phone", "Phones only"], ["desktop", "Tablets & computers only"]],
        },
        { key: "hidden", label: "Hide this element", type: "select", options: [["1", "Yes, hide it"]] },
      ],
    },
  ];

  const PROPS = {};
  PROP_GROUPS.forEach((g) => g.props.forEach((p) => (PROPS[p.key] = p)));

  // ---- value checking (mirrors SiteCustomizationService.styleValue) ----------
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const LENGTH = /^(auto|0|-?\d{1,4}(\.\d{1,2})?(px|%|rem|em|vw|vh)?)$/;
  const DECIMAL = /^\d{1,3}(\.\d{1,2})?$/;

  function isValid(prop, value) {
    const def = PROPS[prop];
    const v = String(value == null ? "" : value).trim();
    if (!def || !v || v.length > 60) return false;
    switch (def.type) {
      case "color":
        return v.toLowerCase() === "transparent" || HEX.test(v);
      case "length":
        return LENGTH.test(v);
      case "box": {
        const parts = v.split(/\s+/);
        return parts.length <= 4 && parts.every((p) => LENGTH.test(p));
      }
      case "number":
        if (prop === "opacity") return /^\d{1,3}$/.test(v) && Number(v) <= 100;
        if (prop === "blur") return /^\d{1,2}(\.\d)?$/.test(v) && Number(v) <= 40;
        if (prop === "zoom") return DECIMAL.test(v) && Number(v) >= 10 && Number(v) <= 500;
        return DECIMAL.test(v);
      case "select":
        return def.options.some(([val]) => val === v);
      default:
        return false;
    }
  }

  /** A bare number means pixels. */
  function px(token) {
    return /^-?\d+(\.\d+)?$/.test(token) && token !== "0" ? `${token}px` : token;
  }
  const lengthCss = (v) => v.split(/\s+/).map(px).join(" ");

  const SHADOWS = {
    none: "none",
    soft: "0 2px 8px rgba(0,0,0,.15)",
    medium: "0 6px 16px rgba(0,0,0,.25)",
    strong: "0 12px 30px rgba(0,0,0,.4)",
  };

  const KEYFRAMES = `
@keyframes scFadeIn{from{opacity:0}to{opacity:1}}
@keyframes scSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes scSlideDown{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:none}}
@keyframes scZoomIn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
@keyframes scPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes scBounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-9px)}60%{transform:translateY(-4px)}}
@keyframes scShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
@keyframes scGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.25) drop-shadow(0 0 8px rgba(255,214,102,.7))}}
@keyframes scFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`;

  const ANIMATIONS = {
    fadeIn: ["scFadeIn", false],
    slideUp: ["scSlideUp", false],
    slideDown: ["scSlideDown", false],
    zoomIn: ["scZoomIn", false],
    pulse: ["scPulse", true],
    bounce: ["scBounce", true],
    shake: ["scShake", false],
    glow: ["scGlow", true],
    float: ["scFloat", true],
  };

  /** The declarations (without braces) for one element's saved settings. */
  function declarations(settings) {
    const out = [];
    const get = (k) => (isValid(k, settings[k]) ? String(settings[k]).trim() : null);
    const add = (prop, value) => out.push(`${prop}:${value} !important`);

    let v;
    if ((v = get("hidden"))) add("display", "none");
    if ((v = get("color"))) add("color", v);
    if ((v = get("background"))) {
      add("background", v);
      add("background-image", "none");
    }
    if ((v = get("fontFamily")) && FONTS[v]) add("font-family", FONTS[v][1]);
    if ((v = get("fontSize"))) add("font-size", lengthCss(v));
    if ((v = get("fontWeight"))) add("font-weight", v);
    if ((v = get("lineHeight"))) add("line-height", v);
    if ((v = get("letterSpacing"))) add("letter-spacing", lengthCss(v));
    if ((v = get("textAlign"))) add("text-align", v);
    if ((v = get("width"))) {
      add("width", lengthCss(v));
      add("flex", "0 0 auto"); // so a fixed width isn't stretched back by a flex row
    }
    if ((v = get("height"))) {
      add("height", lengthCss(v));
      add("min-height", "0"); // buttons carry a 44px minimum that would otherwise win
    }
    if ((v = get("minHeight"))) add("min-height", lengthCss(v));
    if ((v = get("maxWidth"))) add("max-width", lengthCss(v));
    if ((v = get("padding"))) add("padding", lengthCss(v));
    if ((v = get("margin"))) add("margin", lengthCss(v));
    if ((v = get("gap"))) add("gap", lengthCss(v));
    if ((v = get("zoom"))) add("zoom", `${v}%`);
    const mx = get("moveX");
    const my = get("moveY");
    if (mx || my) add("translate", `${mx ? lengthCss(mx) : "0"} ${my ? lengthCss(my) : "0"}`);
    if ((v = get("justify"))) {
      add("justify-content", { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around" }[v]);
    }
    if ((v = get("borderRadius"))) add("border-radius", lengthCss(v));
    const bw = get("borderWidth");
    const bc = get("borderColor");
    if (bw || bc) {
      add("border-style", "solid");
      add("border-width", bw ? lengthCss(bw) : "1px");
      if (bc) add("border-color", bc);
    }
    if ((v = get("boxShadow"))) add("box-shadow", SHADOWS[v]);
    if ((v = get("opacity"))) add("opacity", String(Number(v) / 100));
    if ((v = get("blur"))) {
      add("-webkit-backdrop-filter", `blur(${v}px) saturate(1.4)`);
      add("backdrop-filter", `blur(${v}px) saturate(1.4)`);
    }
    if ((v = get("objectFit"))) add("object-fit", v);

    const anim = get("animation");
    if (anim && anim !== "none" && ANIMATIONS[anim]) {
      const [name, loops] = ANIMATIONS[anim];
      const secs = get("animationSpeed") || "0.8";
      add("animation-name", name);
      add("animation-duration", `${secs}s`);
      add("animation-timing-function", "ease-in-out");
      add("animation-fill-mode", "both");
      add("animation-iteration-count", loops ? "infinite" : "1");
    } else if (anim === "none") {
      add("animation", "none");
    }
    return out.join(";");
  }

  /** The complete stylesheet for a saved config's `styles` (and animationsOff). */
  function toCss(styles, animationsOff) {
    const parts = [];
    let usesAnimation = false;
    const wrap = (rule, scope) =>
      scope === "phone" ? `@media (max-width:719px){${rule}}` : scope === "desktop" ? `@media (min-width:720px){${rule}}` : rule;
    const TEXT_PROPS = ["color", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight", "textAlign"];
    const keys = Object.keys(styles || {}).sort((a, b) => (SHARED.has(a) ? 0 : 1) - (SHARED.has(b) ? 0 : 1));
    keys.forEach((key) => {
      const selector = SELECTORS[key];
      const settings = styles[key];
      if (!selector || !settings || typeof settings !== "object") return;
      const body = declarations(settings);
      if (!body) return;
      if (/animation-name/.test(body)) usesAnimation = true;
      parts.push(wrap(`${selector}{${body}}`, settings.scope));
      if (TEXT_SELECTORS[key]) {
        const textOnly = {};
        TEXT_PROPS.forEach((p) => settings[p] != null && (textOnly[p] = settings[p]));
        const textBody = declarations(textOnly);
        if (textBody) parts.push(wrap(`${TEXT_SELECTORS[key]}{${textBody}}`, settings.scope));
      }
    });
    if (animationsOff) {
      parts.push("*,*::before,*::after{animation:none !important;transition:none !important;scroll-behavior:auto !important}");
    }
    return (usesAnimation ? KEYFRAMES : "") + parts.join("\n");
  }

  /** The Google Fonts families (not already part of the website) that the saved settings use. */
  function fontFamilies(styles) {
    const out = new Set();
    Object.keys(styles || {}).forEach((key) => {
      const st = styles[key];
      if (!SELECTORS[key] || !st || typeof st !== "object") return;
      const f = FONTS[st.fontFamily];
      if (f && f[2]) out.add(f[2]);
    });
    return [...out];
  }

  return { GROUPS, SELECTORS, PROP_GROUPS, PROPS, MESSAGE_GROUPS, MESSAGES, FONTS, isValid, toCss, fontFamilies };
})();
