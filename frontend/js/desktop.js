/* Desktop-only extras for the customer website (screens 1024px wide and up). Pairs with css/desktop.css.
 *
 *  - Header buttons: Orders, Cart (with the number of items) and Help. They press the phone's bottom-menu buttons (which exist but are
 *    not shown on a computer), so they do exactly what those do and follow the admin's switches (no account button = no Orders; no
 *    WhatsApp button = no Help).
 *  - The list / grid switch beside the search box ("by line" or "grid"). Its own remembered choice (fc-desk-view): the phone's switch
 *    and its saved choice are not touched.
 *  - The categories as a list down the left side (the category bar, search row and items go into one two-column box).
 *  - A "back to top" button, and "/" to jump to the search box.
 *
 * Nothing is built on a phone or small tablet (it waits until the window is 1024px wide). To remove: delete this file and its <script> line. */
(() => {
  const mq = window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
  if (!mq) return;
  let built = false;
  const changeFns = [];
  const mqChange = (f) => changeFns.push(f);

  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const ICON = {
    orders: svg('<path d="M6 3.5h12a1 1 0 0 1 1 1V21l-3-1.8-2 1.8-2-1.8-2 1.8-3-1.8V4.5a1 1 0 0 1 1-1Z" transform="translate(-1 0)"/><path d="M8.5 8.5h6M8.5 12h6"/>'),
    cart: svg('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.6l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6"/>'),
    help: svg('<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19v.5a2.5 2.5 0 0 1-2.5 2.5H13"/>'),
    grid: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    list: svg('<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="7" rx="1.5"/>'),
    up: svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
  };

  function press(tab) {
    const b = document.querySelector('#bottomNav [data-tab="' + tab + '"]');
    if (b) b.click();
  }

  function buildHeader() {
    const actions = document.querySelector(".header-actions");
    if (!actions || !document.getElementById("bottomNav")) return;
    const mk = (tab, label, icon) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dk-nav-btn";
      b.dataset.dk = tab;
      b.innerHTML = icon + "<span>" + label + "</span>" + (tab === "cart" ? '<span class="dk-nav-badge" hidden></span>' : "");
      b.addEventListener("click", () => press(tab));
      return b;
    };
    const orders = mk("orders", "Orders", ICON.orders);
    const cart = mk("cart", "Cart", ICON.cart);
    const help = mk("help", "Help", ICON.help);
    const sep = document.createElement("span");
    sep.className = "dk-hdr-sep";
    sep.setAttribute("aria-hidden", "true");
    actions.prepend(orders, cart, help, sep);

    // the admin's switches
    const wa = document.getElementById("whatsappLink");
    const acct = document.getElementById("profileIconBtn");
    const sync = () => {
      help.hidden = !!(wa && wa.hidden);
      orders.hidden = !!(acct && acct.hidden);
    };
    sync();
    if (window.MutationObserver) {
      const mo = new MutationObserver(sync);
      [wa, acct].forEach((el) => el && mo.observe(el, { attributes: true, attributeFilter: ["hidden"] }));
    }

    // the number on Cart
    const badge = cart.querySelector(".dk-nav-badge");
    const CartRef = typeof Cart !== "undefined" ? Cart : null;
    let shown = 0;
    const paint = () => {
      const n = CartRef ? CartRef.getLineCount() : 0;
      badge.hidden = n <= 0;
      badge.textContent = n > 9 ? "9+" : String(n);
      if (n > shown && n > 0) {
        badge.classList.remove("is-bump");
        void badge.offsetWidth;
        badge.classList.add("is-bump");
      }
      shown = n;
    };
    if (CartRef) CartRef.onChange(paint);
    paint();
  }

  function buildViewSwitch() {
    const wrap = document.getElementById("searchWrap");
    const grid = document.getElementById("productGrid");
    if (!wrap || !grid) return;
    const KEY = "fc-desk-view";
    let mode = "grid";
    try {
      if (localStorage.getItem(KEY) === "list") mode = "list";
    } catch (e) {}
    const box = document.createElement("div");
    box.className = "dk-vt";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "How to show the items");
    box.innerHTML =
      '<button type="button" data-mode="grid" title="Grid view" aria-label="Grid view">' + ICON.grid + "<span>Grid</span></button>" +
      '<button type="button" data-mode="list" title="List view, one item per line" aria-label="List view">' + ICON.list + "<span>List</span></button>";
    const apply = () => {
      grid.classList.toggle("dk-list", mq.matches && mode === "list");
      box.querySelectorAll("button").forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    };
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b || b.dataset.mode === mode) return;
      mode = b.dataset.mode;
      try {
        localStorage.setItem(KEY, mode);
      } catch (e2) {}
      apply();
    });
    // the admin can switch the view switch off for customers (Customize > Shop page)
    const refresh = () => {
      const shown = !window.SiteCustomize || SiteCustomize.on("showViewSwitch");
      box.hidden = !shown;
      grid.classList.toggle("dk-list", mq.matches && shown && mode === "list");
    };
    document.addEventListener("freshcutz:site", refresh);
    mqChange(refresh);
    wrap.appendChild(box);
    apply();
    refresh();
  }

  function buildExtras() {
    const top = document.createElement("button");
    top.type = "button";
    top.className = "dk-top";
    top.setAttribute("aria-label", "Back to top");
    top.title = "Back to top";
    top.innerHTML = ICON.up;
    top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.appendChild(top);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        top.classList.toggle("is-on", window.scrollY > 700);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // "/" jumps to the search box (unless the customer is already typing somewhere)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const input = document.getElementById("searchInput");
      if (!input || !mq.matches) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  // The categories become a list down the left side: the category bar, the search row and the items are put into one two-column box
  // (the same elements, just moved, so every script that holds them keeps working).
  function buildShell() {
    const bar = document.getElementById("categoryBar");
    const search = document.getElementById("searchWrap");
    const catalog = document.getElementById("catalog");
    if (!bar || !search || !catalog || document.getElementById("dkShell")) return;
    if (bar.parentNode !== document.body || search.parentNode !== document.body || catalog.parentNode !== document.body) return;
    const shell = document.createElement("div");
    shell.className = "dk-shell";
    shell.id = "dkShell";
    document.body.insertBefore(shell, bar);
    shell.append(bar, search, catalog);
  }

  // The window got narrower than 1024px again (phone turned upright, desktop view switched off, zoomed in): put the three parts back
  // exactly where they were, so the phone layout is the untouched one.
  function unbuildShell() {
    const shell = document.getElementById("dkShell");
    if (!shell) return;
    while (shell.firstChild) document.body.insertBefore(shell.firstChild, shell);
    shell.remove();
  }

  // After sign-in the account button shows the customer's name (the phone's Account tab does the same) instead of the word "Account".
  function buildAccountName() {
    const acct = document.getElementById("profileIconBtn");
    if (!acct) return;
    const paint = () => {
      let name = "";
      try { name = window.ProfileSheet && ProfileSheet.getName ? String(ProfileSheet.getName() || "").trim() : ""; } catch (e) {}
      if (name && document.documentElement.classList.contains("signed-in")) {
        acct.dataset.dkName = name;
        acct.title = name;
        acct.setAttribute("aria-label", "Your account: " + name);
      } else {
        delete acct.dataset.dkName;
        acct.removeAttribute("title");
      }
    };
    ["freshcutz:name", "freshcutz:who", "storage"].forEach((ev) => window.addEventListener(ev, paint));
    paint();
    setTimeout(paint, 1500); // (the name can arrive a moment after the page opens)
    setTimeout(paint, 4000);
  }

  // Everything this file adds is hidden again whenever the window is narrower than 1024px (their styles only exist at 1024px and up, so
  // without this they would show unstyled after the window shrinks - e.g. a phone turned upright after landscape, or desktop view switched off).
  function addGuardStyle() {
    const st = document.createElement("style");
    st.setAttribute("data-dk", "guard");
    st.textContent = "@media (max-width:1023.98px){.dk-vt,.dk-nav-btn,.dk-hdr-sep,.dk-top{display:none !important}}";
    document.head.appendChild(st);
  }

  function build() {
    if (built || !mq.matches) return;
    built = true;
    addGuardStyle();
    buildHeader();
    buildAccountName();
    buildViewSwitch();
    buildShell();
    buildExtras();
  }

  // follow the window crossing the 1024px line, in both directions, for as long as the page is open
  function onCross() {
    if (mq.matches) {
      if (!built) build();
      else buildShell();
    } else {
      unbuildShell();
    }
    changeFns.forEach((f) => f());
  }

  const start = () => {
    build();
    if (mq.addEventListener) mq.addEventListener("change", onCross); else mq.addListener(onCross);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
