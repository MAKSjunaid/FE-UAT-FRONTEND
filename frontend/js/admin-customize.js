/* Admin "Customize" tab: edit how the customer website looks — logo, brand
 * name, tagline, hero text, the badge row, which header parts are shown,
 * and the main colors — and save it. Saving (PUT /api/admin/site) is pushed
 * to every open customer tab within about a second (see site-customize.js).
 *
 * The form keeps its own copy of the settings (`cfg`) and only sends it on
 * Save, so half-finished edits never reach customers. The logo is the one
 * exception: choosing/removing a logo is an upload, so it takes effect
 * immediately (and says so on screen). */

window.AdminCustomize = (() => {
  const root = document.getElementById("customizeRoot");
  const DEFAULT_LOGO = "images/logo.jpg";
  const MAX_BADGES = 8;
  const MAX_LOGO_BYTES = 1024 * 1024;

  let cfg = null; // working copy of the settings (SiteConfig on the server)
  const loadedKeys = new Set(); // the settings read from the server so far (a section reads only its own)
  let fullLoaded = false; // every setting is here (the live preview needs them all)
  let baseline = null; // the settings as the server last gave them (or accepted them): Save sends only what differs from this
  let logoUrl = null; // custom logo path from the server, or null for the built-in one
  let dirty = false;
  let loading = false;

  // Saved designs ("templates"): up to four; customers see the one marked LIVE (primary).
  let templates = []; // [{slot, name, saved, primary}]
  let slot = 0; // the template being edited
  let tplName = "";
  let tplPrimary = false;
  let tplSaved = true; // false for a slot that has never been saved (it starts as a copy of the live design)
  let tplVersion = null; // which saved copy of this template the page holds (sent back with Save: if someone else saved meanwhile, the server refuses); null = unknown
  let tplLoadedName = ""; // the name as the server has it

  const COLOR_GROUPS = [
    {
      title: "Header",
      fields: [
        ["headerBg", "Header background"],
        ["brandNameColor", "Brand name"],
        ["taglineColor", "Tagline"],
      ],
    },
    {
      title: "Hero banner",
      fields: [
        ["heroBgStart", "Background (glow)"],
        ["heroBgEnd", "Background (edge)"],
        ["heroHeadingColor", "Heading"],
        ["heroHighlightColor", "Highlighted words"],
        ["heroTextColor", "Hero line"],
      ],
    },
    {
      title: "Badges",
      fields: [
        ["badgeBg", "Badge background"],
        ["badgeText", "Badge text"],
      ],
    },
    {
      title: "Announcement bar",
      fields: [
        ["announcementBg", "Background"],
        ["announcementColor", "Text"],
      ],
    },
    {
      title: "Page, products & cart",
      fields: [
        ["pageBg", "Page background"],
        ["textColor", "Main text"],
        ["cardBg", "Product card background"],
        ["priceColor", "Prices"],
        ["categoryActiveBg", "Selected category"],
        ["accentColor", "Buttons & accents"],
        ["cartBarBg", "Cart bar at the bottom"],
      ],
    },
    {
      title: "Footer",
      fields: [
        ["footerBg", "Background"],
        ["footerTextColor", "Text"],
      ],
    },
  ];

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));

  // ---- markup ------------------------------------------------------------
  function toggleRow(key, label, hint) {
    return `
      <div class="cz-row">
        <div><div class="cz-row-label">${label}</div>${hint ? `<div class="cz-hint">${hint}</div>` : ""}</div>
        <label class="switch"><input type="checkbox" data-bool="${key}" /><span class="track"></span></label>
      </div>`;
  }

  function textField(key, label, max, hint) {
    return `
      <div class="field">
        <label>${label}</label>
        <input type="text" data-text="${key}" maxlength="${max}" autocomplete="off" />
        ${hint ? `<div class="hint">${hint}</div>` : ""}
      </div>`;
  }

  const TEXT_SIZES = [
    ["sizeBrandName", "Brand name"],
    ["sizeTagline", "Tagline"],
    ["sizeAnnouncement", "Announcement bar"],
    ["sizeHeroHeading", "Hero heading"],
    ["sizeHeroText", "Hero line"],
    ["sizeBadges", "Badges"],
    ["sizeCategories", "Category chips"],
    ["sizeSearch", "Search box", "Can only get bigger — phones need at least this size to avoid zooming in."],
    ["sizeProductName", "Product name"],
    ["sizeProductDesc", "Product description"],
    ["sizePrice", "Prices"],
    ["sizePhotoBadge", "Labels on photos (% OFF, Out of stock)"],
    ["sizeButtons", "Buttons (Add to cart, checkout…)"],
    ["sizeCartBar", "Cart bar at the bottom"],
    ["sizeFooter", "Footer"],
  ];
  const IMAGE_SIZES = [
    ["sizeLogo", "Logo"],
    ["sizeHeaderIcons", "Header buttons (WhatsApp, account)"],
    ["sizeProductImage", "Product photo height"],
  ];

  function sizeField([key, label, hint]) {
    return `
      <div class="cz-size">
        <div class="cz-size-top">
          <label for="cz-s-${key}">${label}</label>
          <span class="cz-size-input"><input type="number" inputmode="numeric" id="cz-s-${key}" data-size="${key}" min="10" max="1000" step="1" /> %</span>
        </div>
        ${hint ? `<div class="cz-hint">${hint}</div>` : ""}
      </div>`;
  }

  // ---- pop-up messages & editable texts ---------------------------------------------------
  function numField(key, label, min, max, step, hint) {
    return `
      <div class="field">
        <label for="cz-n-${key}">${label}</label>
        <input type="number" id="cz-n-${key}" data-num="${key}" min="${min}" max="${max}" step="${step}" inputmode="decimal" />
        ${hint ? `<div class="hint">${hint}</div>` : ""}
      </div>`;
  }

  function messagesSection() {
    const groups = SiteElements.MESSAGE_GROUPS.map(
      (g) => `
        <div class="cz-mgroup">
          <div class="cz-mgroup-title">${esc(g.title)}</div>
          ${g.items
            .map(
              (m) => `
            <div class="cz-msg" data-msg-box="${m.key}">
              <button type="button" class="cz-mel-head" data-action="msg-toggle"><span>${esc(m.label)}</span><span class="cz-mel-count" hidden>edited</span></button>
              <div class="cz-mel-body" hidden></div>
            </div>`
            )
            .join("")}
        </div>`
    ).join("");
    return `
      <div class="cz-hint" style="margin-bottom:8px;">
        Pop-up messages are the little notes that appear briefly on the customer website — for example
        “Chicken added to cart”. Set them all here, then open any message below to change its wording,
        how long it stays, its style, or switch just that one off. Colors, size and shadow of the pop-ups are under
        <b>Fine-tune → Pop-up messages</b>.
      </div>
      ${toggleRow("toastsEnabled", "Show pop-up messages", "Turn this off to hide every pop-up message on the customer website.")}
      ${numField("toastSeconds", "How long each pop-up stays (seconds)", 0.5, 60, 0.1, "Original: 3.2. A message can have its own time below.")}
      ${selectField("toastPosition", "Where pop-ups appear", [
        ["auto", "Automatic (original — bottom, above the cart bar)"],
        ["top-left", "Top left"],
        ["top-center", "Top center"],
        ["top-right", "Top right"],
        ["middle-center", "Middle of the screen"],
        ["bottom-left", "Bottom left"],
        ["bottom-center", "Bottom center"],
        ["bottom-right", "Bottom right"],
      ])}
      ${numField("toastOffsetX", "Nudge sideways (pixels)", -500, 500, 1, "Positive moves right, negative moves left.")}
      ${numField("toastOffsetY", "Nudge up / down (pixels)", -500, 500, 1, "Positive moves down, negative moves up.")}
      ${numField("toastMax", "Most pop-ups on screen at once", 1, 10, 1, "When more arrive, the oldest one goes.")}
      ${toggleRow("toastTapDismiss", "Tap a pop-up to close it")}
      <div class="cz-mfilter-gap"></div>
      ${groups}`;
  }

  function msgBody(key) {
    const m = SiteElements.MESSAGES[key];
    const o = (cfg.messages && cfg.messages[key]) || {};
    const id = `cz-msg-${key}`;
    const toast = m.kind === "toast";
    return `
      <div class="cz-mfield" style="margin-top:8px;">
        <label for="${id}-text">Wording</label>
        <input type="text" id="${id}-text" data-msg="${key}" data-mfield="text" maxlength="200" placeholder="${esc(m.def)}" value="${esc(o.text || "")}" autocomplete="off" />
        <div class="cz-hint">${m.vars ? `You can use ${esc(m.vars)} — they are replaced automatically. ` : ""}Leave empty to keep the original wording.</div>
      </div>
      ${
        toast
          ? `
      <div class="cz-row">
        <div><div class="cz-row-label">Show this message</div></div>
        <label class="switch"><input type="checkbox" data-msg="${key}" data-mfield="enabled" ${o.enabled === "0" ? "" : "checked"} /><span class="track"></span></label>
      </div>
      <div class="cz-mgrid" style="margin-top:6px;">
        <div class="cz-mfield">
          <label for="${id}-seconds">Stays on screen (seconds)</label>
          <input type="text" inputmode="decimal" id="${id}-seconds" data-msg="${key}" data-mfield="seconds" maxlength="5" placeholder="same as all (${cfg.toastSeconds ?? 3.2})" value="${esc(o.seconds || "")}" autocomplete="off" />
        </div>
        <div class="cz-mfield">
          <label for="${id}-tone">Style</label>
          <select id="${id}-tone" data-msg="${key}" data-mfield="tone">
            <option value="">Original (${esc(m.tone)})</option>
            ${["success", "error", "info"].map((t) => `<option value="${t}" ${o.tone === t ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}${t === "success" ? " (green edge)" : t === "error" ? " (red edge)" : " (blue edge)"}</option>`).join("")}
          </select>
        </div>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-action="msg-show" data-msg="${key}" style="margin-top:10px;">▶ Show it on the live preview</button>`
          : ""
      }
      <button type="button" class="btn btn-ghost btn-sm" data-action="msg-reset" data-msg="${key}" style="margin-top:10px;">Back to original</button>`;
  }

  function setMsg(key, field, raw, input) {
    const v = String(raw).trim();
    if (!cfg.messages) cfg.messages = {};
    const entry = cfg.messages[key] || (cfg.messages[key] = {});
    if (field === "enabled") {
      if (raw === false) entry.enabled = "0";
      else delete entry.enabled;
    } else if (!v) {
      delete entry[field];
      input.classList.remove("bad");
    } else if (field === "seconds" && !(/^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) >= 0.5 && Number(v) <= 60)) {
      input.classList.add("bad");
      if (!Object.keys(entry).length) delete cfg.messages[key];
      return;
    } else {
      entry[field] = v;
      input.classList.remove("bad");
    }
    if (!Object.keys(entry).length) delete cfg.messages[key];
    updateMsgBadges();
    edited();
  }

  function updateMsgBadges() {
    root.querySelectorAll("[data-msg-box]").forEach((box) => {
      const on = !!(cfg.messages && cfg.messages[box.dataset.msgBox]);
      box.querySelector(".cz-mel-count").hidden = !on;
      box.classList.toggle("changed", on);
    });
  }

  let pendingToast = null;
  function postToast(key) {
    const frame = document.getElementById("czLiveFrame");
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: "freshcutz-preview-toast", key }, location.origin);
  }

  function showToastOnPreview(key) {
    const live = document.getElementById("czLive");
    live.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!live.open) {
      pendingToast = key; // the frame loads first, then shows it (see the "ready" message below)
      live.open = true;
    } else {
      postPreview();
      setTimeout(() => postToast(key), 200);
    }
  }

  // ---- fine-tune: one expandable panel per element of the website ----------------
  function microSection() {
    const groups = SiteElements.GROUPS.map(
      (g) => `
        <div class="cz-mgroup">
          <div class="cz-mgroup-title">${esc(g.title)}</div>
          ${g.items
            .map(
              ([key, label]) => `
            <div class="cz-mel" data-el="${key}" data-label="${esc(label.toLowerCase())}">
              <button type="button" class="cz-mel-head" data-action="mel-toggle"><span>${esc(label)}</span><span class="cz-mel-count" hidden></span></button>
              <div class="cz-mel-body" hidden></div>
            </div>`
            )
            .join("")}
        </div>`
    ).join("");
    return `
      <div class="cz-hint" style="margin-bottom:8px;">
        Pick any piece of the customer website and change its colors, size, spacing, borders, shadow, animation
        or hide it completely. Leave a box empty to keep the original. Numbers without a unit mean pixels
        (type <b>50%</b> or <b>2rem</b> to use another unit). Open the live preview above to watch the changes.
      </div>
      ${toggleRow("animationsOff", "Turn off all animations & transitions", "Every movement on the website stops — cards appear instantly, buttons don't animate.")}
      <input type="search" id="czMFilter" class="cz-mfilter" placeholder="🔎 Find an element (e.g. search, price, button)" autocomplete="off" />
      <label class="cz-mchanged"><input type="checkbox" id="czMChanged" /> Show only the ones I've changed</label>
      ${groups}`;
  }

  function microField(key, p, val) {
    const id = `cz-m-${key}-${p.key}`;
    let input;
    if (p.type === "select") {
      input = `<select id="${id}" data-mel="${key}" data-mprop="${p.key}"><option value="">Default</option>${p.options
        .map(([v, l]) => `<option value="${v}" ${v === val ? "selected" : ""}>${esc(l)}</option>`)
        .join("")}</select>`;
    } else if (p.type === "color") {
      const ok = /^#[0-9a-f]{6}$/i.test(val);
      input = `<div class="cz-mcolor"><input type="color" data-mpick value="${ok ? val : "#000000"}" aria-label="${esc(p.label)} picker" /><input type="text" id="${id}" data-mel="${key}" data-mprop="${p.key}" maxlength="11" placeholder="default" spellcheck="false" autocomplete="off" value="${esc(val)}" /></div>`;
    } else {
      input = `<input type="text" id="${id}" data-mel="${key}" data-mprop="${p.key}" maxlength="40" placeholder="${esc(p.hint || "default")}" spellcheck="false" autocomplete="off" value="${esc(val)}" />`;
    }
    return `<div class="cz-mfield"><label for="${id}">${esc(p.label)}</label>${input}</div>`;
  }

  function microBody(key) {
    const st = (cfg.styles && cfg.styles[key]) || {};
    return (
      SiteElements.PROP_GROUPS.map(
        (pg) => `
        <div class="cz-mprop-group">
          <div class="cz-color-group-title">${esc(pg.title)}</div>
          <div class="cz-mgrid">${pg.props.map((p) => microField(key, p, st[p.key] ?? "")).join("")}</div>
        </div>`
      ).join("") +
      `<button type="button" class="btn btn-ghost btn-sm" data-action="mel-clear" data-el="${key}">Clear everything set for this element</button>`
    );
  }

  // ---- quick controls for the banner name's look (they edit cfg.styles.bannerBadge - the glass tag on a banner) ----
  const BADGE = "bannerBadge";
  const LOOK_DEFAULT_TEXT = "#e4e4e4";
  const LOOK_DEFAULT_BG = "#ffffff";
  const LOOK_DEFAULT_BORDER = "#ffffff";
  const SHAPES = [["", "Default (pill)"], ["0", "Square"], ["6", "Slightly rounded"], ["12", "Rounded"], ["22", "Very rounded"], ["999", "Pill / capsule"]];

  function lookField(prop, label, hint, fallback) {
    const key = BADGE;
    const val = (cfg.styles && cfg.styles[key] && cfg.styles[key][prop]) || "";
    const id = `cz-q-${key}-${prop}`;
    let input;
    if (prop === "color" || prop === "background" || prop === "borderColor") {
      const ok = /^#[0-9a-f]{6}$/i.test(val);
      input = `<div class="cz-mcolor"><input type="color" data-mpick value="${ok ? val : fallback}" aria-label="${esc(label)} picker" /><input type="text" id="${id}" data-mel="${key}" data-mprop="${prop}" maxlength="11" placeholder="default" spellcheck="false" autocomplete="off" value="${esc(val)}" /></div>`;
    } else if (prop === "borderRadius" || prop === "fontFamily" || prop === "fontWeight") {
      const base = prop === "borderRadius" ? SHAPES : [["", "Default"], ...SiteElements.PROPS[prop].options];
      const opts = base.some(([v]) => v === val) || !val ? base : [...base, [val, `Custom (${val})`]];
      input = `<select id="${id}" data-mel="${key}" data-mprop="${prop}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    } else {
      input = `<input type="text" id="${id}" data-mel="${key}" data-mprop="${prop}" maxlength="40" placeholder="${esc(hint)}" spellcheck="false" autocomplete="off" value="${esc(val)}" />`;
    }
    return `<div class="cz-mfield"><label for="${id}">${esc(label)}</label>${input}</div>`;
  }

  function renderBannerLook() {
    const box = document.getElementById("czBannerLook");
    if (!box || !cfg) return;
    box.innerHTML =
      lookField("fontFamily", "Font", "", "") +
      lookField("fontSize", "Text size (pixels)", "default 10.5", "") +
      lookField("fontWeight", "Text boldness", "", "") +
      lookField("color", "Text color", "", LOOK_DEFAULT_TEXT) +
      lookField("background", "Background color", "", LOOK_DEFAULT_BG) +
      lookField("blur", "Background blur (0 = clear, 20 = very frosted)", "default 2.5", "") +
      lookField("borderColor", "Border color", "", LOOK_DEFAULT_BORDER) +
      lookField("borderWidth", "Border thickness (pixels)", "default 0 (none)", "") +
      lookField("borderRadius", "Shape (corners)", "", "");
  }

  function setMicro(el, prop, raw, input) {
    const v = String(raw).trim();
    if (!cfg.styles) cfg.styles = {};
    if (!v) {
      if (cfg.styles[el]) {
        delete cfg.styles[el][prop];
        if (!Object.keys(cfg.styles[el]).length) delete cfg.styles[el];
      }
      input.classList.remove("bad");
    } else if (SiteElements.isValid(prop, v)) {
      (cfg.styles[el] = cfg.styles[el] || {})[prop] = SiteElements.PROPS[prop].type === "color" ? v.toLowerCase() : v;
      input.classList.remove("bad");
    } else {
      input.classList.add("bad"); // not stored until it is a value the website can use
      return;
    }
    updateMicroCounts();
    // the same setting can be shown in the quick "banner name look" block and in Fine-tune: keep both in step
    if (el === BADGE) {
      if (input.closest("#czBannerLook")) {
        // typed in the quick block: refresh the open Fine-tune fields of that element
        root.querySelectorAll(`.cz-mel[data-el="${el}"] .cz-mel-body`).forEach((b) => {
          if (!b.hidden) b.innerHTML = microBody(el);
        });
      } else {
        renderBannerLook();
      }
    }
    edited();
  }

  function updateMicroCounts() {
    root.querySelectorAll(".cz-mel").forEach((box) => {
      const n = Object.keys((cfg.styles && cfg.styles[box.dataset.el]) || {}).length;
      const badge = box.querySelector(".cz-mel-count");
      badge.hidden = n === 0;
      badge.textContent = `${n} set`;
      box.classList.toggle("changed", n > 0);
    });
  }

  function applyMicroFilter() {
    const filter = document.getElementById("czMFilter");
    const only = document.getElementById("czMChanged");
    if (!filter || !only) return;
    const q = filter.value.trim().toLowerCase();
    root.querySelectorAll(".cz-mgroup").forEach((group) => {
      let any = false;
      group.querySelectorAll(".cz-mel").forEach((box) => {
        const show =
          (!q || box.dataset.label.includes(q) || box.dataset.el.toLowerCase().includes(q)) &&
          (!only.checked || box.classList.contains("changed"));
        box.hidden = !show;
        if (show) any = true;
      });
      group.hidden = !any;
    });
  }

  // ---- live preview: the real storefront in a frame --------------------------------------
  let previewTimer = null;
  let liveWidth = 390;

  function sizeLiveFrame() {
    const wrap = document.getElementById("czLiveWrap");
    const frame = document.getElementById("czLiveFrame");
    if (!wrap || !frame) return;
    const height = 640;
    const scale = Math.min(1, (wrap.clientWidth || liveWidth) / liveWidth);
    frame.style.width = `${liveWidth}px`;
    frame.style.height = `${height / scale}px`;
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = `${height}px`;
  }

  function postPreview() {
    const frame = document.getElementById("czLiveFrame");
    if (!frame || !frame.contentWindow || !cfg || !fullLoaded) return;
    frame.contentWindow.postMessage(
      { type: "freshcutz-preview", site: { config: { ...cfg, heroHeading: (cfg.heroHeading || "").replace(/\s+$/, "") }, logoUrl } },
      location.origin
    );
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(postPreview, 120);
  }

  function openLive() {
    const wrap = document.getElementById("czLiveWrap");
    if (!wrap || wrap.firstElementChild) return;
    wrap.innerHTML = `<iframe id="czLiveFrame" title="Live preview of the customer website" src="index.html?preview=1"></iframe>`;
    sizeLiveFrame();
  }

  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data && e.data.type === "freshcutz-preview-ready") {
      postPreview();
      if (pendingToast) {
        const key = pendingToast;
        pendingToast = null;
        setTimeout(() => postToast(key), 700);
      }
    }
  });
  window.addEventListener("resize", sizeLiveFrame);
  // <details> "toggle" doesn't bubble, so listen in the capture phase
  root.addEventListener(
    "toggle",
    (e) => {
      const card = e.target;
      if (card.id === "czLive" && card.open) {
        openLive();
        sizeLiveFrame();
      }
      // Nothing is read from the server until a section is opened.
      // (the notifications card has its own request, and may already be replaced by now - so look at the event's own path)
      if (!card.open || !card.matches || !card.matches("details.cz-card") || e.composedPath().some((n) => n.id === "orderMsgRoot")) return;
      if (card.querySelector("#czBackupMount")) {
        if (window.AdminBackup && window.AdminBackup.open) window.AdminBackup.open(); // (its own small status call)
        return;
      }
      // Each section reads only what it shows: the Templates card the list of templates, every other one the design itself.
      if (card.id === "czTplCard") ensureList();
      else ensureDetail(card);
    },
    true
  );

  function selectField(key, label, options, hint) {
    return `
      <div class="field">
        <label>${label}</label>
        <select data-select="${key}">${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        ${hint ? `<div class="hint">${hint}</div>` : ""}
      </div>`;
  }

  function section(title, inner, open = false) {
    return `<details class="cz-card" ${open ? "open" : ""}><summary><h3>${title}</h3></summary><div class="cz-card-body">${inner}</div></details>`;
  }

  function colorField(key, label) {
    return `
      <div class="cz-color">
        <label for="cz-c-${key}">${label}</label>
        <div class="cz-color-inputs">
          <input type="color" id="cz-c-${key}" data-color="${key}" />
          <input type="text" class="cz-hex" data-hex="${key}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${label} hex code" />
        </div>
      </div>`;
  }

  function build() {
    root.innerHTML = `
      <details class="cz-card cz-tpl" id="czTplCard">
        <summary><h3>Templates</h3></summary>
        <div class="cz-card-body">
        <div class="cz-hint">
          Keep up to 4 designs. Pick one to edit it — customers only ever see the one marked <b>LIVE</b>, so you can
          experiment on the others safely. Press <b>Save &amp; make live</b> to switch customers to the design you are editing.
        </div>
        <div class="cz-tpl-tabs" id="czTplTabs"></div>
        <div class="cz-tpl-edit">
          <label for="czTplName">Name of this template</label>
          <input type="text" id="czTplName" maxlength="30" autocomplete="off" />
        </div>
        <div class="cz-tpl-status" id="czTplStatus"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="tpl-clear" id="czTplClear" hidden>Clear this template</button>
        </div>
      </details>

      <div class="cz-loadnote" id="czLoadNote" hidden></div>

      <details class="cz-card" id="czLive">
        <summary><h3>🔴 Live preview of the real website</h3></summary>
        <div class="cz-card-body">
          <div class="cz-live-bar">
            <button type="button" class="btn btn-outline btn-sm" data-action="live-size" data-w="390">📱 Phone</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="live-size" data-w="768">Tablet</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="live-size" data-w="1200">💻 Computer</button>
            <a class="btn btn-ghost btn-sm" href="index.html" target="_blank" rel="noopener">Open site ↗</a>
          </div>
          <div class="cz-live-wrap" id="czLiveWrap"></div>
          <div class="cz-hint">This is the actual customer website, showing your changes as you make them. Nothing is public until you press Save.</div>
        </div>
      </details>

      ${section(
        "Brand & header",
        `
        <div class="cz-logo-row">
          <div class="cz-logo-box"><img id="czLogoImg" alt="Logo" /></div>
          <div class="cz-logo-actions">
            <label class="btn btn-outline btn-sm file-btn">
              ⬆ Upload logo
              <input type="file" id="czLogoFile" accept="image/png,image/jpeg,image/webp" hidden />
            </label>
            <button type="button" class="btn btn-ghost btn-sm" data-action="logo-remove" id="czLogoRemove">Use original logo</button>
            <div class="cz-hint">PNG, JPG or WEBP, up to 1 MB. A square image works best. Applies immediately.</div>
          </div>
        </div>
        ${toggleRow("showLogo", "Show logo")}
        ${textField("brandName", "Brand name", 40)}
        ${textField("tagline", "Tagline (under the name, on larger screens)", 80)}
        ${toggleRow("showTagline", "Show tagline")}
        ${textField("pageTitle", "Browser tab title", 80, "Leave empty to build it from the brand name and tagline.")}
        ${toggleRow("showWhatsapp", "Show WhatsApp button")}
        ${textField("whatsappNumber", "WhatsApp number (customers are taken to this chat)", 20, "Include the country code, e.g. +91 98765 43210. Leave empty to use the default number.")}
        ${toggleRow("showAccount", "Show My Account button", "Customers use this to see their past orders.")}
      `,
        false
      )}

      ${section(
        "Opening animation",
        `
        ${toggleRow("showSplash", "Show an opening animation", "A short full-screen logo animation with smoke, each time someone opens your website. Customers can tap it to skip.")}
        <div class="cz-logo-row">
          <div class="cz-logo-box cz-splash-box"><img id="czSplashImg" alt="Opening animation picture" /></div>
          <div class="cz-logo-actions">
            <label class="btn btn-outline btn-sm file-btn">
              ⬆ Upload your own picture
              <input type="file" id="czSplashFile" accept="image/png,image/jpeg,image/webp" hidden />
            </label>
            <button type="button" class="btn btn-ghost btn-sm" data-action="splash-remove" id="czSplashRemove">Use the shop logo</button>
            <div class="cz-hint" id="czSplashHint"></div>
          </div>
        </div>
        ${numField("splashSeconds", "How long it stays on screen (seconds)", 1, 10, 0.5, "From 1 to 10 seconds. Half seconds are fine, like 2.5.")}
        <div class="field">
          <label for="cz-range-splashSpeed">Animation speed: <b id="czSplashSpeedVal"></b></label>
          <input type="range" id="cz-range-splashSpeed" class="cz-range" data-range="splashSpeed" min="50" max="200" step="10" />
          <div class="cz-range-ends"><span>Slow</span><span>Normal</span><span>Fast</span></div>
          <div class="hint">How quickly the logo appears and the smoke moves. It does not change how long the screen stays.</div>
        </div>
        <button type="button" class="btn btn-outline btn-sm" data-action="splash-play">▶ Play it now</button>
        <div class="cz-hint" style="margin-top:6px;">Plays with the settings on this page (even if not saved yet). Tap the screen to close it.</div>
      `
      )}

      ${section(
        "Announcement bar",
        `
        ${toggleRow("showAnnouncement", "Show the announcement bar", "A thin colored strip under the header — good for offers, holiday timings or delivery news.")}
        <div class="field">
          <label>Announcement</label>
          <textarea data-text="announcementText" maxlength="200" rows="2" placeholder="e.g. 🎉 Free delivery on orders above ₹500 this week!"></textarea>
        </div>
      `
      )}

      ${section(
        "Hero banner",
        `
        ${toggleRow("showHero", "Show the hero banner", "The dark section at the top with the heading and badges.")}
        ${textField("heroHeading", "Heading", 60, "e.g. “Fresh Chicken,”")}
        ${textField("heroHighlight", "Highlighted words (shown in the highlight color)", 40, "e.g. “Cut to Order”")}
        <div class="field">
          <label>Line under the heading</label>
          <textarea data-text="heroText" maxlength="200" rows="2"></textarea>
        </div>
        ${toggleRow("showHeroText", "Show the line under the heading")}
        ${selectField("heroAlign", "Text alignment", [["center", "Centered"], ["left", "Left"]])}
        ${toggleRow("showHeroButton", "Show a button in the banner", "Takes customers straight down to the products.")}
        ${textField("heroButtonText", "Button text", 30)}
      `
      )}

      ${section(
        "Sliding banners - size & speed",
        `
        <div class="cz-hint" style="margin-bottom:10px">
          The pictures, the banner name and where each banner shows are in the
          <button type="button" class="bn-link" data-action="goto-banners">Banners tab</button>.
          The look of the banner name (the glass tag on a banner) is just below the speed setting.
        </div>
        ${numField("bannerWidth", "Banner width (length) - % of the page width", 30, 100, 1, "100 = the full width. A smaller number leaves empty space on the sides and keeps the banner centered.")}
        ${numField("bannerHeight", "Banner height on phones (pixels)", 0, 600, 5, "0 = automatic (follows the shape of your picture). Typical: 140 - 220. The picture is trimmed to fit, so keep the important part in the middle.")}
        ${numField("bannerHeightDesktop", "Banner height on computers / tablets (pixels)", 0, 800, 5, "0 = automatic. Typical: 200 - 320.")}
        ${numField("bannerSeconds", "Slide to the next picture every (seconds)", 2, 30, 1, "")}
        <div class="cz-color-group-title" style="margin-top:14px">Look of the banner name (the glass tag on a banner)</div>
        <div id="czBannerLook" class="cz-mgrid"></div>
        <div class="cz-hint" style="margin-top:8px">
          Leave a box empty to keep the default look. Even more (spacing, position, opacity, shadow) is in
          <button type="button" class="bn-link" data-action="goto-banner-style">Fine-tune → banner name</button>.
          <button type="button" class="bn-link" data-action="banner-look-reset">Reset the look</button>
        </div>
      `
      )}

      ${section(
        "Badges",
        `
        ${toggleRow("showBadges", "Show the badge row")}
        <div id="czBadges" class="cz-badges"></div>
        <button type="button" class="btn btn-outline btn-sm" data-action="badge-add" id="czBadgeAdd">+ Add badge</button>
      `
      )}

      ${section(
        "Shop page",
        `
        ${toggleRow("showSearch", "Show the search box")}
        ${textField("searchPlaceholder", "Search box hint text", 60)}
        ${toggleRow("showCategories", "Show the category bar")}
        ${toggleRow("compactItemCards", "Item panels: two per row on phones", "On = compact two-per-row panels. Off = one big panel per row. This is what customers see until they pick a view themselves.")}
        ${toggleRow("showViewSwitch", "Show the view switch to customers", "The little icon next to the search box. Off = everyone gets the view chosen above.")}
        ${toggleRow("showProductDescription", "Show product descriptions")}
        ${toggleRow("showMrp", "Show the crossed-out original price")}
        ${toggleRow("showDiscountBadge", "Show the “% OFF” badge on photos")}
        ${textField("addToCartText", "“Add to cart” button text", 24)}
        ${textField("outOfStockText", "“Out of stock” label", 24)}
        ${textField("emptyProductsText", "Message when there are no products", 160)}
        ${textField("noSearchResultsText", "Message when a search finds nothing", 160)}
      `
      )}

      ${section(
        "Cart & checkout",
        `
        ${textField("viewCartText", "Cart bar button (bottom of the screen)", 30)}
        ${textField("cartTitle", "Cart title", 40)}
        ${textField("cartEmptyText", "Message when the cart is empty", 160)}
        ${textField("checkoutButtonText", "Checkout button text", 40)}
        ${textField("placeOrderText", "Place-order button text", 30)}
        ${toggleRow("showCartAnimations", "Cart animations", "Item flies into the cart, the cart bar bounces, and the order-placed tick draws itself")}
        ${toggleRow("showLandmarkField", "Ask for a landmark in the address form")}
        ${toggleRow("showNotesField", "Ask for special instructions")}
        ${textField("notesLabel", "Special-instructions label", 60)}
        ${textField("successTitle", "Order-placed heading", 60)}
        ${toggleRow("showSuccessMessage", "Show a message under that heading")}
        ${textField("successMessage", "Order-placed message", 200)}
        ${toggleRow("showScreenshotHint", "Show the “take a screenshot” reminder")}
      `
      )}

      ${section(
        "Delivery time choices",
        `
        ${toggleRow("showDeliverySlots", "Let customers pick a delivery time", "On the Final Step page, between the items and the special instructions. Customers can also leave it empty - it is never required.")}
        ${textField("deliverySlotsLabel", "Heading above the choices", 60)}
        <div class="cz-sched" id="czSched">
          <div class="cz-sched-title">Delivery slot availability</div>
          ${toggleRow("slotSchedule", "Today / Tomorrow with advance notice", "On: customers choose Today or Tomorrow, and a slot that starts sooner than the notice below is hidden for today (it is offered for tomorrow). Off: every slot below is always shown as a plain button, with no day.")}
          <div class="cz-sched-rules" id="czSchedRules">
            <div class="cz-sched-label">Minimum advance notice</div>
            <div class="cz-notice">
              <div class="cz-notice-slider">
                <input type="range" id="czNoticeRange" class="cz-range" min="0" max="180" step="5" aria-label="Minimum advance notice in minutes" />
                <div class="cz-range-ends"><span>0 min</span><span>90 min</span><span>180 min</span></div>
              </div>
              <div class="cz-notice-boxes">
                <label><input type="number" id="czNoticeH" min="0" max="48" inputmode="numeric" aria-label="Notice hours" /><span>hours</span></label>
                <label><input type="number" id="czNoticeM" min="0" inputmode="numeric" aria-label="Notice minutes" /><span>minutes</span></label>
              </div>
            </div>
            <div class="cz-hint">Slots starting sooner than this are hidden from customers for today. Any hours and minutes, up to 48 hours.</div>
          </div>
        </div>
        <div class="cz-sched-head"><div class="cz-sched-title">Configured delivery slots</div><span class="cz-count" id="czSlotCount"></span></div>
        <div id="czSlotNote" class="cz-hint cz-slot-note" hidden></div>
        <div id="czSlots" class="cz-slots"></div>
        <button type="button" class="btn btn-outline btn-sm btn-block" data-action="slot-add" id="czSlotAdd">+ Add delivery slot</button>
      `
      )}

      ${section(
        "Payment options",
        `
        ${toggleRow("showPaymentOptions", "Show payment choices on the Final Step", "Radio buttons after the special instructions: Cash on delivery and UPI. You choose below which one (if any) is already selected.")}
        ${selectField("defaultPayment", "Which choice is already selected", [["NONE", "None — the customer must choose"], ["COD", "Cash on delivery"], ["UPI", "UPI"]], "With “None”, the customer has to pick Cash on delivery or UPI before they can place the order.")}
        ${textField("paymentLabel", "Heading above the choices", 60)}
        ${textField("codLabel", "Cash on delivery text", 40)}
        ${toggleRow("upiEnabled", "Let customers pay by UPI", "Switch off to offer cash on delivery only (the whole payment section is then hidden).")}
        ${toggleRow("askPaymentProof", "Ask UPI customers for a payment screenshot", "Shown on the Order Placed screen and in My Orders, with “This will help us serve you better and quicker.” You see it on the order (📎 button). Screenshots are removed 30 days after they are uploaded - except those of orders you mark as Fraud, which are kept.")}
        ${textField("upiLabel", "UPI text", 40)}
        ${textField("upiId", "Your UPI ID", 80, "Like name@bank. Customers are shown this ID, and their UPI app opens with it and the order total already filled in.")}
        ${textField("upiName", "Name customers see in their UPI app", 40, "Usually your shop name.")}
        <div class="cz-hint" style="margin-top:6px;">The website can't see whether a UPI payment really arrived - check your own UPI app. Each order shows the customer's choice (Cash on delivery or UPI).</div>
      `
      )}

      <div id="orderMsgRoot"></div>

      ${section(
        "Store-offline messages",
        `
        <div class="cz-hint" style="margin-bottom:6px;">Shown when you switch the store offline from the Orders tab.</div>
        ${textField("offlineBannerText", "Banner at the top", 200)}
        ${textField("offlineSheetText", "Message when someone tries to check out", 200)}
      `
      )}

      ${section(
        "Footer",
        `
        ${toggleRow("showFooter", "Show a footer at the bottom of the page", "Each line below only appears when you fill it in.")}
        <div class="field">
          <label>About text</label>
          <textarea data-text="footerAbout" maxlength="300" rows="2" placeholder="e.g. Freshly cut chicken delivered to your door every morning."></textarea>
        </div>
        ${textField("footerAddress", "Address", 200)}
        ${textField("footerHours", "Opening hours", 120, "e.g. Orders open 6 AM – 10 PM")}
        ${textField("footerPhone", "Phone number", 24, "Customers can tap it to call.")}
        ${textField("footerEmail", "Email", 100)}
        ${textField("instagramUrl", "Instagram link", 200, "Full address, e.g. https://instagram.com/yourshop")}
        ${textField("facebookUrl", "Facebook link", 200, "Full address, e.g. https://facebook.com/yourshop")}
        ${textField("footerCopyright", "Copyright line", 120, "{year} becomes the current year and {brand} your brand name. Empty hides the line.")}
      `
      )}

      ${section(
        "Sizes",
        `
        <div class="cz-hint" style="margin-bottom:8px;">Type a number: 100 is the original size, 50 is half, 200 is double, 400 is four times — anything from 10 to 1000. The preview updates as you type.</div>
        <div class="cz-color-group-title">Images & icons</div>
        ${IMAGE_SIZES.map(sizeField).join("")}
        <div class="cz-color-group-title" style="margin-top:14px;">Text</div>
        ${TEXT_SIZES.map(sizeField).join("")}
        <button type="button" class="btn btn-ghost btn-sm" data-action="sizes-reset" style="margin-top:10px;">Reset all sizes to 100%</button>
      `
      )}

      ${section(
        "Look & feel",
        `
        ${selectField("fontStyle", "Font style", [["classic", "Classic (original)"], ["modern", "Modern — clean sans-serif everywhere"], ["elegant", "Elegant — serif everywhere"]])}
        ${selectField("cornerStyle", "Corners", [["default", "Rounded (original)"], ["sharp", "Sharp — square, minimal"], ["round", "Extra round — soft and bubbly"]])}
      `
      )}

      ${section("Pop-up messages & texts", messagesSection())}

      ${section("Fine-tune any element (advanced)", microSection())}

      ${section(
        "Colors",
        COLOR_GROUPS.map(
          (g) => `
          <div class="cz-color-group">
            <div class="cz-color-group-title">${g.title}</div>
            <div class="cz-color-grid">${g.fields.map(([k, l]) => colorField(k, l)).join("")}</div>
          </div>`
        ).join("")
      )}

      ${section("Email backup", '<div id="czBackupMount"></div>')}

      <div class="cz-savebar">
        <span class="cz-dirty" id="czDirty" hidden>Unsaved changes</span>
        <button type="button" class="btn btn-ghost btn-sm" data-action="reset" id="czReset" disabled>Reset to original</button>
        <button type="button" class="btn btn-gold" data-action="save" id="czSave" disabled>Save template</button>
        <button type="button" class="btn btn-dark" data-action="publish" id="czPublish" disabled>Save &amp; make live</button>
      </div>`;
    // The Email backup section is built by admin-backup.js (its settings are saved by Save below).
    if (window.AdminBackup) window.AdminBackup.mount(document.getElementById("czBackupMount"));
  }

  // ---- filling the form from cfg ------------------------------------------
  function fill(keepDirty) {
    root.querySelectorAll("[data-text]").forEach((el) => (el.value = cfg[el.dataset.text] ?? ""));
    root.querySelectorAll("[data-bool]").forEach((el) => (el.checked = cfg[el.dataset.bool] !== false));
    root.querySelectorAll("[data-size]").forEach((el) => (el.value = sizeOf(el.dataset.size)));
    root.querySelectorAll("[data-num]").forEach((el) => (el.value = cfg[el.dataset.num] ?? ""));
    root.querySelectorAll("[data-range]").forEach((el) => (el.value = cfg[el.dataset.range] ?? 100));
    root.querySelectorAll("[data-select]").forEach((el) => (el.value = cfg[el.dataset.select] ?? el.options[0].value));
    root.querySelectorAll("[data-color]").forEach((el) => (el.value = cfg[el.dataset.color] || "#000000"));
    root.querySelectorAll("[data-hex]").forEach((el) => (el.value = cfg[el.dataset.hex] || ""));
    // (a part is drawn only once its own settings were read - never from settings that are not here yet)
    if (loadedKeys.has("badges")) renderBadges();
    if (loadedKeys.has("slotWindows")) renderSlots();
    if (loadedKeys.has("logoUrl")) renderLogo();
    if (loadedKeys.has("splashImageUrl")) renderSplash();
    if (loadedKeys.has("bannerSeconds")) renderBannerLook();
    root.querySelectorAll(".cz-mel").forEach((box) => {
      const body = box.querySelector(".cz-mel-body");
      if (!body.hidden) body.innerHTML = microBody(box.dataset.el);
    });
    root.querySelectorAll("[data-msg-box]").forEach((box) => {
      const body = box.querySelector(".cz-mel-body");
      if (!body.hidden) body.innerHTML = msgBody(box.dataset.msgBox);
    });
    updateMsgBadges();
    updateMicroCounts();
    applyMicroFilter();
    renderPreview();
    markDirty(keepDirty ? dirty : false);
  }

  function sizeOf(key) {
    const n = Number(cfg[key]);
    return Number.isFinite(n) && n >= 10 ? Math.min(1000, n) : 100;
  }

  function renderLogo() {
    const img = document.getElementById("czLogoImg");
    img.src = logoUrl ? Utils.resolveImageUrl(logoUrl) : DEFAULT_LOGO;
    document.getElementById("czLogoRemove").hidden = !logoUrl;
  }

  /** The opening-animation picture box and the speed label. */
  function renderSplash() {
    const img = document.getElementById("czSplashImg");
    if (!img) return;
    const own = cfg && cfg.splashImageUrl;
    img.src = own ? Utils.resolveImageUrl(own) : logoUrl ? Utils.resolveImageUrl(logoUrl) : DEFAULT_LOGO;
    document.getElementById("czSplashRemove").hidden = !own;
    document.getElementById("czSplashHint").textContent = own
      ? "Your picture is shown on the opening screen exactly as uploaded. Applies immediately."
      : "Showing your shop logo. Upload a picture to use a different one: PNG, JPG or WEBP up to 2 MB. A transparent PNG, at least 1000 px wide, looks best. Applies immediately.";
    const speed = Number(cfg && cfg.splashSpeed) || 100;
    const val = document.getElementById("czSplashSpeedVal");
    if (val) val.textContent = `${speed}%${speed === 100 ? " (normal)" : speed < 100 ? " (slower)" : " (faster)"}`;
  }

  function renderBadges() {
    const host = document.getElementById("czBadges");
    const list = cfg.badges || [];
    host.innerHTML = list
      .map(
        (b, i) => `
        <div class="cz-badge-row" data-index="${i}">
          <input type="text" class="cz-badge-icon" data-badge="icon" value="${esc(b.icon)}" maxlength="12" placeholder="😀" aria-label="Badge icon" />
          <input type="text" class="cz-badge-text" data-badge="text" value="${esc(b.text)}" maxlength="40" placeholder="Badge text" aria-label="Badge text" />
          <label class="switch" title="Show this badge"><input type="checkbox" data-badge="enabled" ${b.enabled !== false ? "checked" : ""} /><span class="track"></span></label>
          <div class="cz-badge-tools">
            <button type="button" data-action="badge-up" aria-label="Move up" ${i === 0 ? "disabled" : ""}>▲</button>
            <button type="button" data-action="badge-down" aria-label="Move down" ${i === list.length - 1 ? "disabled" : ""}>▼</button>
            <button type="button" data-action="badge-del" aria-label="Delete badge">🗑</button>
          </div>
        </div>`
      )
      .join("");
    document.getElementById("czBadgeAdd").disabled = list.length >= MAX_BADGES;
  }

  const MAX_SLOTS = 24;
  let slotUnparsed = []; // old text options that could not be read as times (shown to the admin once)

  /** The slots as times (cfg.slotWindows); the old text options in cfg.deliverySlots are always kept in step with them. */
  function slotList() {
    return (cfg.slotWindows = Array.isArray(cfg.slotWindows) ? cfg.slotWindows : []);
  }
  function syncSlotLabels() {
    cfg.deliverySlots = slotList().map((w) => SlotTime.label(w));
  }
  /** First time after the old text options: read them as times. */
  function migrateSlots() {
    if (Array.isArray(cfg.slotWindows)) return;
    cfg.slotWindows = [];
    slotUnparsed = [];
    (Array.isArray(cfg.deliverySlots) ? cfg.deliverySlots : ["8 AM – 9 AM", "9 AM – 10 AM"]).forEach((t) => {
      const w = SlotTime.parse(t);
      if (w) cfg.slotWindows.push(w);
      else if (String(t).trim()) slotUnparsed.push(String(t).trim());
    });
    syncSlotLabels();
  }

  function timeOptions(selected, forEnd) {
    const vals = [];
    for (let m = forEnd ? 30 : 0; m <= (forEnd ? 1440 : 1410); m += 30) vals.push(m);
    if (!vals.includes(selected)) vals.push(selected); // (a time that is not on the half hour, e.g. from an old option)
    vals.sort((a, b) => a - b);
    return vals.map((m) => `<option value="${m}"${m === selected ? " selected" : ""}>${m === 1440 ? "12:00 AM (midnight)" : SlotTime.fmtFull(m)}</option>`).join("");
  }

  /** The delivery slots: Start and End drop-downs for each, a delete button, and "Add delivery slot". */
  function renderSlots() {
    const host = document.getElementById("czSlots");
    if (!host) return;
    const list = slotList();
    host.innerHTML = list
      .map(
        (w, i) => `
        <div class="cz-slot-card" data-index="${i}">
          <div class="cz-slot-top"><b>Slot ${i + 1}</b><button type="button" data-action="slot-del" aria-label="Delete slot ${i + 1}">🗑</button></div>
          <div class="cz-slot-times">
            <label><span>Start</span><select data-slot-start aria-label="Slot ${i + 1} start">${timeOptions(w.start, false)}</select></label>
            <span class="cz-slot-arrow" aria-hidden="true">→</span>
            <label><span>End</span><select data-slot-end aria-label="Slot ${i + 1} end">${timeOptions(w.end, true)}</select></label>
          </div>
          ${w.start >= w.end ? `<div class="cz-slot-err">The end must be after the start.</div>` : ""}
        </div>`
      )
      .join("");
    document.getElementById("czSlotAdd").disabled = list.length >= MAX_SLOTS;
    document.getElementById("czSlotCount").textContent = `${list.length} slot${list.length === 1 ? "" : "s"}`;
    const note = document.getElementById("czSlotNote");
    if (note) {
      note.hidden = !slotUnparsed.length;
      note.textContent = slotUnparsed.length ? `These older options could not be read as times and are not in the list: ${slotUnparsed.join(", ")}. Add them again below with a Start and End time.` : "";
    }
    renderNotice();
  }

  /** Minimum advance notice (slider, hours, minutes), from cfg. */
  function renderNotice(except) {
    const n = Number(cfg.slotNoticeMinutes) || 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el && el !== except) el.value = v; };
    set("czNoticeRange", Math.min(180, n));
    set("czNoticeH", Math.floor(n / 60));
    set("czNoticeM", n % 60);
    const rules = document.getElementById("czSchedRules");
    if (rules) rules.classList.toggle("is-off", cfg.slotSchedule === false);
    root.querySelectorAll("#czSchedRules input, #czSchedRules button").forEach((el) => (el.disabled = cfg.slotSchedule === false));
  }

  function setNotice(total, except) {
    cfg.slotNoticeMinutes = Math.max(0, Math.min(2880, Math.round(total)));
    renderNotice(except);
    edited();
  }

  /** The small built-in preview was removed (the live preview of the real website does the job). */
  function renderPreview() {
    schedulePreview();
  }

  function rgba(hex, a) {
    const n = parseInt((hex || "#000000").slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /** Unsaved changes in the Email backup section (admin-backup.js). */
  function emailDirty() {
    return !!(window.AdminBackup && window.AdminBackup.isDirty());
  }

  function markDirty(value = true) {
    dirty = value;
    const pending = dirty || emailDirty();
    document.getElementById("czSave").disabled = !(pending || !tplSaved);
    document.getElementById("czDirty").hidden = !pending;
  }

  function edited() {
    markDirty(true);
    renderPreview();
  }

  // ---- events --------------------------------------------------------------
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "czMFilter") return applyMicroFilter();
    if (t.id === "czTplName") {
      tplName = t.value;
      markDirty(true);
      const label = root.querySelector(".cz-tpl-tab.on .cz-tpl-name");
      if (label) label.textContent = tplName.trim() || `Template ${slot}`;
      return;
    }
    if (t.dataset.mpick !== undefined) {
      const text = t.parentElement.querySelector("[data-mprop]");
      text.value = t.value;
      return setMicro(text.dataset.mel, text.dataset.mprop, t.value, text);
    }
    if (t.dataset.mprop) return setMicro(t.dataset.mel, t.dataset.mprop, t.value, t);
    if (t.dataset.msg && t.dataset.mfield && t.type !== "checkbox") return setMsg(t.dataset.msg, t.dataset.mfield, t.value, t);
    if (t.dataset.range) {
      cfg[t.dataset.range] = Number(t.value);
      renderSplash();
      edited();
      return;
    }
    if (t.dataset.num) {
      const n = Number(t.value);
      const min = Number(t.min);
      const max = Number(t.max);
      if (t.value !== "" && Number.isFinite(n) && n >= min && n <= max) {
        cfg[t.dataset.num] = n;
        edited();
      }
      return;
    }
    if (t.dataset.text) {
      cfg[t.dataset.text] = t.value;
      edited();
    } else if (t.dataset.size) {
      // typing: accept any whole number from 10 to 1000; anything else waits
      // until the box is left (see the change handler) instead of fighting the typist
      const n = Number(t.value);
      if (t.value !== "" && Number.isFinite(n) && n >= 10 && n <= 1000) {
        cfg[t.dataset.size] = Math.round(n);
        edited();
      }
    } else if (t.dataset.color) {
      cfg[t.dataset.color] = t.value;
      root.querySelector(`[data-hex="${t.dataset.color}"]`).value = t.value;
      edited();
    } else if (t.dataset.hex) {
      let v = t.value.trim();
      if (v && v[0] !== "#") v = `#${v}`;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        cfg[t.dataset.hex] = v.toLowerCase();
        root.querySelector(`[data-color="${t.dataset.hex}"]`).value = v;
        edited();
      }
    } else if (t.dataset.badge === "icon" || t.dataset.badge === "text") {
      const i = Number(t.closest(".cz-badge-row").dataset.index);
      cfg.badges[i][t.dataset.badge] = t.value;
      edited();
    }
  });

  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "czMChanged") return applyMicroFilter();
    if (t.dataset.msg && t.dataset.mfield) {
      if (t.type === "checkbox") return setMsg(t.dataset.msg, "enabled", t.checked ? true : false, t);
      if (t.tagName === "SELECT") return setMsg(t.dataset.msg, t.dataset.mfield, t.value, t);
      return;
    }
    if (t.dataset.num) {
      // left empty or out of range: back to the last good value
      const n = Number(t.value);
      if (t.value === "" || !Number.isFinite(n) || n < Number(t.min) || n > Number(t.max)) t.value = cfg[t.dataset.num] ?? "";
      return;
    }
    if (t.dataset.mprop) {
      if (t.tagName === "SELECT") return setMicro(t.dataset.mel, t.dataset.mprop, t.value, t);
      {
        // leaving a box holding something unusable: put the last good value back
        const saved = (cfg.styles && cfg.styles[t.dataset.mel] && cfg.styles[t.dataset.mel][t.dataset.mprop]) || "";
        if (t.value.trim() !== saved && !SiteElements.isValid(t.dataset.mprop, t.value)) {
          t.value = saved;
          t.classList.remove("bad");
        }
      }
      return;
    }
    if (t.dataset.bool) {
      cfg[t.dataset.bool] = t.checked;
      edited();
    } else if (t.dataset.size) {
      t.value = sizeOf(t.dataset.size); // empty / out-of-range → back to the last good value
      cfg[t.dataset.size] = Number(t.value);
      edited();
    } else if (t.dataset.select) {
      cfg[t.dataset.select] = t.value;
      edited();
    } else if (t.dataset.badge === "enabled") {
      const i = Number(t.closest(".cz-badge-row").dataset.index);
      cfg.badges[i].enabled = t.checked;
      edited();
    } else if (t.id === "czLogoFile") {
      uploadLogo(t);
    } else if (t.id === "czSplashFile") {
      uploadSplash(t);
    } else if (t.dataset.hex) {
      // leaving the hex box with something invalid: put the last good value back
      t.value = cfg[t.dataset.hex] || "";
    }
  });

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const row = btn.closest(".cz-badge-row");
    const i = row ? Number(row.dataset.index) : -1;

    if (action === "retry-load") {
      if (btn.dataset.what === "list") ensureList();
      else ensureDetail(null);
      return;
    }
    if (action === "reload-design") {
      reloadDesign();
      return;
    }
    if (action === "tpl-pick") {
      pickTemplate(Number(btn.dataset.slot));
      return;
    }
    if (!cfg) return; // (nothing is loaded until a section is opened)
    if (action === "splash-remove") {
      removeSplash();
    } else if (action === "splash-play") {
      playSplash();
    } else if (action === "slot-add") {
      const list = slotList();
      if (list.length >= MAX_SLOTS) return;
      const last = list[list.length - 1];
      const start = last ? Math.min(last.end, 1380) : 480;
      list.push({ start, end: Math.min(start + 60, 1440) }); // (an hour after the last one)
      syncSlotLabels();
      renderSlots();
      edited();
      root.querySelector(`.cz-slot-card[data-index="${list.length - 1}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (action === "slot-del") {
      slotList().splice(Number(btn.closest(".cz-slot-card").dataset.index), 1);
      syncSlotLabels();
      renderSlots();
      edited();
    } else if (action === "badge-add") {
      if (cfg.badges.length >= MAX_BADGES) return;
      cfg.badges.push({ icon: "⭐", text: "", enabled: true });
      renderBadges();
      edited();
      const inputs = root.querySelectorAll('[data-badge="text"]');
      inputs[inputs.length - 1]?.focus();
    } else if (action === "badge-del") {
      cfg.badges.splice(i, 1);
      renderBadges();
      edited();
    } else if (action === "badge-up" && i > 0) {
      [cfg.badges[i - 1], cfg.badges[i]] = [cfg.badges[i], cfg.badges[i - 1]];
      renderBadges();
      edited();
    } else if (action === "badge-down" && i < cfg.badges.length - 1) {
      [cfg.badges[i + 1], cfg.badges[i]] = [cfg.badges[i], cfg.badges[i + 1]];
      renderBadges();
      edited();
    } else if (action === "mel-toggle") {
      const box = btn.closest(".cz-mel");
      const body = box.querySelector(".cz-mel-body");
      if (body.hidden) {
        body.innerHTML = microBody(box.dataset.el);
        body.hidden = false;
      } else {
        body.hidden = true;
      }
      box.classList.toggle("open", !body.hidden);
    } else if (action === "msg-toggle") {
      const box = btn.closest("[data-msg-box]");
      const body = box.querySelector(".cz-mel-body");
      if (body.hidden) {
        body.innerHTML = msgBody(box.dataset.msgBox);
        body.hidden = false;
      } else {
        body.hidden = true;
      }
      box.classList.toggle("open", !body.hidden);
    } else if (action === "msg-show") {
      showToastOnPreview(btn.dataset.msg);
    } else if (action === "msg-reset") {
      if (cfg.messages) delete cfg.messages[btn.dataset.msg];
      btn.closest(".cz-mel-body").innerHTML = msgBody(btn.dataset.msg);
      updateMsgBadges();
      edited();
    } else if (action === "mel-clear") {
      const key = btn.dataset.el;
      if (cfg.styles) delete cfg.styles[key];
      btn.closest(".cz-mel-body").innerHTML = microBody(key);
      updateMicroCounts();
      applyMicroFilter();
      edited();
    } else if (action === "live-size") {
      liveWidth = Number(btn.dataset.w) || 390;
      sizeLiveFrame();
    } else if (action === "sizes-reset") {
      root.querySelectorAll("[data-size]").forEach((el) => {
        cfg[el.dataset.size] = 100;
        el.value = 100;
      });
      edited();
    } else if (action === "banner-look-reset") {
      if (cfg.styles) {
        delete cfg.styles[BADGE];
        delete cfg.styles.bannerTitle; // older settings from the removed line above a banner
        delete cfg.styles.bannerTitleBox;
      }
      renderBannerLook();
      root.querySelectorAll('.cz-mel[data-el="bannerBadge"] .cz-mel-body').forEach((b) => {
        if (!b.hidden) b.innerHTML = microBody(b.closest(".cz-mel").dataset.el);
      });
      updateMicroCounts();
      applyMicroFilter();
      edited();
    } else if (action === "goto-banner-style") {
      openElement(BADGE);
    } else if (action === "goto-banners") {
      const tab = document.querySelector('.admin-tab[data-view="banners"]');
      if (tab) tab.click();
    } else if (action === "save") {
      save();
    } else if (action === "reset") {
      reset();
    } else if (action === "publish") {
      publish();
    } else if (action === "tpl-pick") {
      pickTemplate(Number(btn.dataset.slot));
    } else if (action === "tpl-clear") {
      clearTemplate();
    } else if (action === "logo-remove") {
      removeLogo();
    }
  });

  // ---- delivery slots: notice, start / end times -----------------------------
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "czNoticeRange") setNotice(Number(t.value), t);
    else if (t.id === "czNoticeH" || t.id === "czNoticeM") {
      const h = Math.max(0, Math.min(48, Math.floor(Number(document.getElementById("czNoticeH").value) || 0)));
      const m = Math.max(0, Math.floor(Number(document.getElementById("czNoticeM").value) || 0)); // (75 minutes carries over: 1 h 15 min)
      setNotice(h * 60 + m, t);
    }
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "czNoticeH" || t.id === "czNoticeM") renderNotice(); // (tidy what was typed: 75 minutes becomes 1 h 15 min)
    if (t.hasAttribute && (t.hasAttribute("data-slot-start") || t.hasAttribute("data-slot-end"))) {
      const w = slotList()[Number(t.closest(".cz-slot-card").dataset.index)];
      if (!w) return;
      if (t.hasAttribute("data-slot-start")) {
        const keep = w.end - w.start;
        w.start = Number(t.value);
        if (w.end <= w.start) w.end = Math.min(w.start + (keep > 0 ? keep : 60), 1440); // (the end follows when it would fall before the start)
      } else {
        w.end = Number(t.value);
      }
      syncSlotLabels();
      renderSlots();
      edited();
    }
    if (t.dataset && t.dataset.bool === "slotSchedule") renderNotice();
  });

  // ---- server calls ----------------------------------------------------------
  /** The same value written the same way whatever order its keys were added in, for comparing. */
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
    return JSON.stringify(v === undefined ? null : v);
  }
  /** Remembers what the server holds for these settings (the next Save sends only what differs from this). */
  function snapshotKeys(keys) {
    baseline = baseline || {};
    keys.forEach((k) => {
      if (k !== "banners" && k !== "logoUrl" && cfg && k in cfg) baseline[k] = canon(cfg[k]);
    });
  }
  function snapshot() {
    baseline = {};
    snapshotKeys(loadedKeys);
  }
  /** Only the settings that differ from what the server has: { setting: newValue }. A setting never read from the server
   *  can't have been changed (unless the whole design was replaced, e.g. Reset to original - then every one counts). */
  function changedSettings(payload) {
    const out = {};
    Object.keys(payload).forEach((k) => {
      if (!loadedKeys.has(k)) return;
      if (!baseline || baseline[k] !== canon(payload[k])) out[k] = payload[k];
    });
    return out;
  }

  /** Tidies the settings that were just read (only those: the rest isn't here yet). */
  function normalizeKeys(keys) {
    const has = (k) => keys.has(k);
    // (these three are always there as empty holders, so the screens that show them never fail; they only count as read when asked for)
    cfg.badges = (Array.isArray(cfg.badges) ? cfg.badges : []).map((b) => ({ icon: b.icon || "", text: b.text || "", enabled: b.enabled !== false }));
    cfg.styles = cfg.styles && typeof cfg.styles === "object" ? cfg.styles : {};
    cfg.messages = cfg.messages && typeof cfg.messages === "object" ? cfg.messages : {};
    if (has("deliverySlots") || has("slotWindows")) {
      cfg.deliverySlots = Array.isArray(cfg.deliverySlots) ? cfg.deliverySlots.map((s) => String(s)) : ["8 AM – 9 AM", "9 AM – 10 AM"];
      migrateSlots(); // (the delivery slots as times; the old text options are read once, then kept in step with them)
    }
    if (has("slotNoticeMinutes") && typeof cfg.slotNoticeMinutes !== "number") cfg.slotNoticeMinutes = 60;
    if (has("slotSchedule") && typeof cfg.slotSchedule !== "boolean") cfg.slotSchedule = true;
    delete cfg.banners; // banners live in the Banners tab (their own small calls), never in a template
    if (has("splashSeconds")) cfg.splashSeconds = Number(cfg.splashSeconds) || 3;
    if (has("splashSpeed")) cfg.splashSpeed = Number(cfg.splashSpeed) || 100;
    if (has("bannerSeconds")) cfg.bannerSeconds = Number(cfg.bannerSeconds) || 4;
    if (has("bannerWidth")) cfg.bannerWidth = Number(cfg.bannerWidth) || 100;
    if (has("bannerHeight")) cfg.bannerHeight = Number(cfg.bannerHeight) || 0;
    if (has("bannerHeightDesktop")) cfg.bannerHeightDesktop = Number(cfg.bannerHeightDesktop) || 0;
  }

  /** The whole design arrived (Reset to original, or a Save answer that changed something): it replaces everything here. */
  function applyResponse(res) {
    cfg = res.config;
    loadedKeys.clear();
    Object.keys(cfg).forEach((k) => loadedKeys.add(k));
    loadedKeys.add("badges");
    loadedKeys.add("styles");
    loadedKeys.add("messages");
    normalizeKeys(loadedKeys);
    loadedKeys.delete("banners");
    fullLoaded = true;
    logoUrl = res.logoUrl || null;
    loadedKeys.add("logoUrl");
  }

  /** Part of a design arrived (a section's own settings): put them on top of what is here, never touching the others. */
  function adoptPart(detail, keys) {
    const part = detail.config || {};
    cfg = cfg || {};
    const got = new Set();
    keys.forEach((k) => {
      if (k === "logoUrl") {
        logoUrl = detail.logoUrl || null;
        loadedKeys.add("logoUrl");
        return;
      }
      cfg[k] = part[k];
      got.add(k);
    });
    normalizeKeys(got);
    got.forEach((k) => loadedKeys.add(k));
    snapshotKeys(got);
  }

  const saveLabel = () => (tplPrimary ? "Save (updates live website)" : "Save template");

  function applyDetail(d) {
    // A Save reply leaves the design out when the server kept it exactly as
    // sent — then the copy already on this page is the right one, so it is
    // not replaced (and nothing had to travel back).
    if (d.config) applyResponse({ config: d.config, logoUrl: d.logoUrl });
    snapshot(); // (what the server holds now: the next Save sends only what is changed from here)
    applyMeta(d);
  }

  /** The name and flags of a template (live? saved?) - these come with every answer, whatever else was asked for. */
  function applyMeta(d) {
    slot = d.slot;
    tplName = d.name || `Template ${d.slot}`;
    tplPrimary = !!d.primary;
    tplSaved = !!d.saved;
    tplVersion = d.version === undefined || d.version === null ? null : String(d.version);
    tplLoadedName = tplName;
    detailAt = Date.now();
    try {
      localStorage.setItem(SLOT_KEY, String(slot)); // (the next visit starts on the same template, without asking the server which is live)
    } catch (e) {}
  }

  async function loadTemplates() {
    templates = await Api.get("/api/admin/site/templates");
    listAt = Date.now();
  }

  function renderTemplates() {
    const tabs = document.getElementById("czTplTabs");
    if (!tabs) return;
    tabs.innerHTML = templates
      .map(
        (t) => `
        <button type="button" class="cz-tpl-tab ${cfg && t.slot === slot ? "on" : ""}" data-action="tpl-pick" data-slot="${t.slot}">
          <span class="cz-tpl-name">${esc(cfg && t.slot === slot ? tplName : t.name)}</span>
          ${t.primary ? `<span class="cz-tpl-badge live">LIVE</span>` : t.saved ? "" : `<span class="cz-tpl-badge empty">empty</span>`}
        </button>`
      )
      .join("");
    // Until a template's design is read (tap one, or open any other section) there is nothing to rename, clear or save.
    root.querySelector(".cz-tpl-edit").hidden = !cfg;
    document.getElementById("czTplStatus").hidden = !cfg;
    const name = document.getElementById("czTplName");
    if (name && cfg && document.activeElement !== name) name.value = tplName;
    document.getElementById("czTplStatus").innerHTML = tplPrimary
      ? `<b>This is the LIVE design.</b> Saving it updates your customer website straight away.`
      : `Customers <b>can't see</b> this template. Save it to keep your changes, or press <b>Save &amp; make live</b> to show it to customers.${
          tplSaved ? "" : " (Not saved yet — it started as a copy of your live design.)"
        }`;
    document.getElementById("czTplClear").hidden = !cfg || !(tplSaved && !tplPrimary);
    document.getElementById("czPublish").hidden = tplPrimary;
    document.getElementById("czPublish").disabled = !cfg;
    const resetBtn = document.getElementById("czReset");
    if (resetBtn) resetBtn.disabled = !cfg;
    if (cfg && !busy) setNote(editingNote());
    const save = document.getElementById("czSave");
    if (!save.querySelector(".spinner")) save.textContent = saveLabel();
    markDirty(dirty);
  }

  // Settings that are saved by their own buttons (upload / remove), never as part of a section Save.
  const NOT_SPREAD = new Set(["banners", "logoUrl", "splashImageUrl"]);
  const isRealCard = (card) => !(card.id === "czTplCard" || card.closest("#orderMsgRoot") || card.querySelector("#czBackupMount"));

  /** Whole sections: when anything in a section changed, ALL of that section's settings (those read from the server) are sent, and the
   *  server replaces them completely - so what is stored is always exactly what the section shows, never a mix of old and new.
   *  everySection = nothing differs but the form was touched (e.g. a slot added then removed): send every section that is loaded (a republish). */
  function wholeSections(changes, everySection) {
    const out = { ...changes };
    root.querySelectorAll("details.cz-card").forEach((card) => {
      if (!isRealCard(card)) return;
      const keys = keysFor(card);
      if (!everySection && ![...keys].some((k) => k in changes)) return;
      keys.forEach((k) => {
        if (!NOT_SPREAD.has(k) && loadedKeys.has(k) && cfg && k in cfg) out[k] = cfg[k];
      });
    });
    return out;
  }

  const isConflict = (err) => !!err && (err.status === 409 || /was changed since you opened it/.test(err.message || ""));

  /** Someone else (another page, another admin) saved this template after this page read it: the save was refused, nothing was overwritten. */
  function showConflict() {
    setNote(
      `<b>This design was changed somewhere else after you opened it</b>, so your save was not applied (nothing was overwritten). ` +
        `<button type="button" class="btn btn-outline btn-sm" data-action="reload-design">Reload the latest</button> ` +
        `<span class="cz-hint">Your unsaved edits here will be replaced; make them again after reloading.</span>`
    );
  }

  /** Throws away what is on this page for the template and reads the latest from the server (only what the open sections show). */
  async function reloadDesign() {
    try {
      await loadTemplates();
      const keys = openKeys();
      adoptTemplate(await readDesign(slot, keys), keys);
      Toast.show("Latest design loaded", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  async function save() {
    const btn = document.getElementById("czSave");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Saving...`;
    try {
      // Email backup settings are saved together with the template (they are not part of it).
      if (emailDirty()) {
        if (!(await window.AdminBackup.save())) {
          btn.disabled = false;
          return false;
        }
        if (!dirty && tplSaved) {
          markDirty(dirty); // nothing else to save
          return true;
        }
      }
      const payload = { ...cfg, heroHeading: (cfg.heroHeading || "").replace(/\s+$/, "") };
      delete payload.banners; // not part of a template - keeps this request small
      // Only what was changed since this template was loaded / last saved travels; the server puts it on top of the saved design.
      const diff = changedSettings(cfg);
      delete diff.banners;
      const nameOnly = !Object.keys(diff).length && tplName.trim() !== tplLoadedName.trim();
      const touched = !Object.keys(diff).length && dirty && tplSaved && !nameOnly;
      const changes = wholeSections(diff, touched);
      if ("heroHeading" in changes) changes.heroHeading = payload.heroHeading; // (the trailing space tidied away)
      // The slot times are enough: the server writes the matching text labels itself (about half the request).
      if ("slotWindows" in changes) delete changes.deliverySlots;
      const body = { name: tplName, changes: changes };
      if (tplVersion !== null) body.version = tplVersion;
      const res = await Api.patch(`/api/admin/site/templates/${slot}`, body);
      // The server says what it really stored for those settings: that (not what was typed) is what this page now shows.
      if (res.stored && cfg) {
        Object.keys(res.stored).forEach((k) => {
          if (res.stored[k] === null || res.stored[k] === undefined) delete cfg[k];
          else cfg[k] = res.stored[k];
        });
        normalizeKeys(new Set(Object.keys(res.stored)));
      }
      applyDetail(res);
      fill();
      // the save answer already says what changed for this slot - no need to fetch the whole list again
      templates = templates.map((t) => (t.slot === res.slot ? { ...t, name: res.name, saved: true, primary: !!res.primary } : t));
      btn.textContent = saveLabel();
      renderTemplates();
      Toast.show(
        res.primary ? "Saved — the customer website is updated" : `“${res.name}” saved — customers still see your live design`,
        "success"
      );
      return true;
    } catch (err) {
      Toast.show(err.message, "error");
      if (isConflict(err)) showConflict();
      btn.disabled = false;
      return false;
    } finally {
      btn.textContent = saveLabel();
    }
  }

  /** Opens the Fine-tune panel of one element of the website (e.g. "bannerBadge") and scrolls to it. */
  function openElement(key) {
    const box = root.querySelector(`.cz-mel[data-el="${key}"]`);
    if (!box) return;
    const card = box.closest("details");
    if (card) card.open = true;
    const filter = document.getElementById("czMFilter");
    if (filter) filter.value = "";
    const only = document.getElementById("czMChanged");
    if (only) only.checked = false;
    applyMicroFilter();
    const body = box.querySelector(".cz-mel-body");
    if (body.hidden) {
      body.innerHTML = microBody(key);
      body.hidden = false;
      box.classList.add("open");
    }
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** Saves the template being edited (if needed) and makes it the one customers see. */
  async function publish() {
    if (tplPrimary) return;
    if (!window.confirm(`Show “${tplName.trim() || `Template ${slot}`}” to your customers now?`)) return;
    const btn = document.getElementById("czPublish");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Publishing...`;
    try {
      if ((dirty || !tplSaved || emailDirty()) && !(await save())) return;
      const res = await Api.post(`/api/admin/site/templates/${slot}/primary`);
      applyMeta(res); // (only the name and flags matter: the design on this page is the one that was just saved)
      await loadTemplates();
      renderTemplates();
      Toast.show(`“${res.name}” is now your live design`, "success");
    } catch (err) {
      Toast.show(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "Save &amp; make live";
    }
  }

  async function pickTemplate(n) {
    if (!n || (n === slot && cfg)) return;
    if (dirty && !window.confirm("You have unsaved changes in this template. Switch anyway and lose them?")) return;
    try {
      const keys = openKeys(); // (only what the open sections show)
      adoptTemplate(await readDesign(n, keys), keys);
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  async function clearTemplate() {
    if (!window.confirm(`Clear “${tplName.trim() || `Template ${slot}`}”? Its saved look is reset (your live design and your banners are not affected).`)) return;
    try {
      templates = await Api.del(`/api/admin/site/templates/${slot}`);
      const keys = openKeys();
      adoptTemplate(await readDesign(slot, keys), keys);
      Toast.show("Template cleared", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  /** Puts the template being edited back to the original look. Nothing is saved until you press Save. */
  async function reset() {
    if (!window.confirm("Put this template back to the original look? Nothing changes for customers until you save it. Your logo and your banners are not touched.")) return;
    try {
      const def = await Api.get("/api/admin/site/templates/defaults");
      applyResponse({ config: { ...def, splashImageUrl: cfg.splashImageUrl || null }, logoUrl }); // the opening-animation picture is shared by all templates
      fill();
      markDirty(true);
      Toast.show("Original look loaded — press Save to keep it", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  async function uploadLogo(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      Toast.show("The logo must be a PNG, JPG or WEBP image", "error");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      Toast.show("That logo is too large (max 1 MB) — use a smaller image", "error");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await Api.upload("/api/admin/site/logo", form);
      logoUrl = res.logoUrl || null; // text edits in the form stay as they are
      renderLogo();
      renderPreview();
      Toast.show("Logo updated on the customer website", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  const MAX_SPLASH_BYTES = 2 * 1024 * 1024;

  async function uploadSplash(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      Toast.show("The picture must be a PNG, JPG or WEBP image", "error");
      return;
    }
    if (file.size > MAX_SPLASH_BYTES) {
      Toast.show("That picture is too large (max 2 MB) — export it a little smaller", "error");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await Api.upload("/api/admin/site/splash", form);
      cfg.splashImageUrl = (res.config && res.config.splashImageUrl) || null; // other edits in the form stay as they are
      renderSplash();
      Toast.show("Opening-animation picture updated on the customer website", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  async function removeSplash() {
    try {
      const res = await Api.del("/api/admin/site/splash");
      cfg.splashImageUrl = (res.config && res.config.splashImageUrl) || null;
      renderSplash();
      Toast.show("Back to the shop logo on the opening screen", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  /** "Play it now": the real opening screen, with the settings as they are in this form (saved or not). */
  function playSplash() {
    if (!window.FCSplash || !cfg) {
      Toast.show("The animation could not be loaded — refresh the page and try again", "error");
      return;
    }
    window.FCSplash.play({ settings: { ...window.FCSplash.settingsOf({ config: cfg, logoUrl }), on: true }, forced: true });
  }

  async function removeLogo() {
    try {
      const res = await Api.del("/api/admin/site/logo");
      logoUrl = res.logoUrl || null;
      renderLogo();
      renderPreview();
      Toast.show("Back to the original logo", "success");
    } catch (err) {
      Toast.show(err.message, "error");
    }
  }

  /** Opening the Customize tab only draws the closed sections - no request at all. The templates and the chosen design are
   *  read the first time a section is opened (and again, after 10 minutes away, the next time one is opened). It never
   *  overwrites edits that haven't been saved yet. */
  const STALE_MS = 10 * 60 * 1000;
  const SLOT_KEY = "freshcutz_cz_slot";
  let listAt = 0; // when the list of templates was last read
  let detailAt = 0; // when the design being edited was last read
  let listPromise = null;
  let detailPromise = null;
  let busy = 0; // requests of this tab in flight
  const fresh = (t) => t && Date.now() - t < STALE_MS;

  function setNote(html) {
    const note = document.getElementById("czLoadNote");
    if (!note) return;
    note.innerHTML = html;
    note.hidden = !html;
  }

  /** Which template to read when the server hasn't been asked which one is live: the live one if the list is known, else the one edited last time. */
  function guessSlot() {
    const known = templates.find((t) => t.primary) || templates[0];
    if (known) return known.slot;
    let n = 1;
    try {
      n = Number(localStorage.getItem(SLOT_KEY)) || 1;
    } catch (e) {}
    return n >= 1 && n <= 4 ? n : 1;
  }

  function editingNote() {
    return `Editing <b>${esc(tplName.trim() || `Template ${slot}`)}</b> — ${tplPrimary ? "the <b>LIVE</b> design customers see" : "not live (customers can't see it)"}.`;
  }

  /** Runs one read from the server with the "Loading…" note; a failure leaves a note with a Try again button. */
  async function tracked(what, work) {
    busy++;
    root.classList.add("cz-loading");
    setNote(`<span class="spinner"></span> Loading…`);
    try {
      await work();
      setNote(cfg ? editingNote() : "");
    } catch (err) {
      setNote(
        `Couldn't load ${what === "list" ? "the templates" : "the design"}: ${esc(err.message || "error")}. <button type="button" class="btn btn-outline btn-sm" data-action="retry-load" data-what="${what}">Try again</button>` +
          `<br><span class="cz-hint">If you just updated the website, copy the new backend files and restart the backend.</span>`
      );
    } finally {
      busy--;
      if (!busy) root.classList.remove("cz-loading");
    }
  }

  /** Templates card opened: only the list of templates (GET /api/admin/site/templates). */
  function ensureList() {
    if (templates.length && fresh(listAt)) return Promise.resolve();
    if (listPromise) return listPromise;
    listPromise = tracked("list", async () => {
      await loadTemplates();
      renderTemplates();
    }).finally(() => (listPromise = null));
    return listPromise;
  }

  // What each section shows besides its fields marked data-text / data-bool / data-size / data-num / data-range / data-select /
  // data-color / data-hex (those are found in the section itself): the settings it draws in other ways.
  const SECTION_EXTRA = {
    "Brand & header": ["logoUrl"],
    "Opening animation": ["splashImageUrl", "logoUrl"],
    "Sliding banners - size & speed": ["bannerSeconds", "bannerWidth", "bannerHeight", "bannerHeightDesktop"],
    Badges: ["badges", "showBadges"],
    "Delivery time choices": ["showDeliverySlots", "deliverySlotsLabel", "deliverySlots", "slotSchedule", "slotNoticeMinutes", "slotWindows"],
    "Pop-up messages & texts": ["messages", "toastsEnabled", "toastSeconds", "toastPosition", "toastOffsetX", "toastOffsetY", "toastMax", "toastTapDismiss"],
    "Fine-tune any element (advanced)": ["styles"],
  };
  const FIELD_ATTRS = ["text", "bool", "size", "num", "range", "select", "color", "hex"];

  /** The settings one section shows: its marked fields plus the extras above. */
  function keysFor(card) {
    const keys = new Set();
    card.querySelectorAll("[data-text],[data-bool],[data-size],[data-num],[data-range],[data-select],[data-color],[data-hex]").forEach((el) =>
      FIELD_ATTRS.forEach((a) => {
        if (el.dataset[a]) keys.add(el.dataset[a]);
      })
    );
    const title = card.querySelector("summary h3");
    ((title && SECTION_EXTRA[title.textContent.trim()]) || []).forEach((k) => keys.add(k));
    return keys;
  }

  /** What the sections open right now need - null = everything (the live preview shows the whole site). */
  function openKeys() {
    const live = document.getElementById("czLive");
    if (live && live.open) return null;
    const keys = new Set();
    root.querySelectorAll("details.cz-card[open]").forEach((card) => {
      if (!isRealCard(card)) return;
      keysFor(card).forEach((k) => keys.add(k));
    });
    return keys;
  }

  /** Reads a template's design - only `keys` of it (null = all of it). GET /api/admin/site/templates/{n}?fields=... */
  function readDesign(n, keys) {
    if (!keys) return Api.get(`/api/admin/site/templates/${n}`);
    return Api.get(`/api/admin/site/templates/${n}?fields=${encodeURIComponent([...keys].join(","))}`);
  }

  /** Puts a whole template that was just read (another one picked, or this one cleared) in place of what is here. */
  function adoptTemplate(detail, keys) {
    cfg = null;
    loadedKeys.clear();
    baseline = null;
    fullLoaded = false;
    if (keys) {
      adoptPart(detail, keys);
      applyMeta(detail);
    } else {
      applyDetail(detail);
    }
    fill();
    renderTemplates();
  }

  /** A section opened: read the settings it shows that are not here yet (GET /api/admin/site/templates/{slot}?fields=...) - nothing else. */
  function ensureDetail(card) {
    const stale = !!cfg && !dirty && !fresh(detailAt);
    const wantAll = !card || card.id === "czLive" || (stale && openKeys() === null);
    if (cfg && fullLoaded && !stale) return Promise.resolve(); // (the whole design is already here)
    let need = null; // null = everything
    if (!wantAll) {
      need = keysFor(card);
      if (stale) openKeys()?.forEach((k) => need.add(k));
      else need = new Set([...need].filter((k) => !loadedKeys.has(k)));
    } else if (cfg && fullLoaded && !stale) {
      need = new Set(); // already have it all
    }
    if (need && need.size === 0 && cfg && !stale) return Promise.resolve();
    if (detailPromise) return detailPromise.then(() => ensureDetail(card)); // (one read at a time; then see what is still missing)
    loading = true;
    detailPromise = tracked("detail", async () => {
      if (!cfg) slot = guessSlot();
      let detail = await readDesign(slot, wantAll ? null : need);
      let all = wantAll;
      let want = need;
      let reread = false;
      // Someone saved this template after this page read the sections it already shows: those are out of date.
      const behind = !stale && !!cfg && tplVersion !== null && detail.version !== undefined && detail.version !== null && detail.slot === slot && String(detail.version) !== tplVersion;
      const keepVersion = tplVersion;
      if (behind && !dirty) {
        // nothing edited here: read everything the open sections show again, from the latest copy
        const keys = openKeys();
        detail = await readDesign(slot, keys);
        all = keys === null;
        want = keys;
        reread = true;
      }
      if (stale || reread) {
        cfg = null;
        loadedKeys.clear();
        baseline = null;
        fullLoaded = false;
      }
      if (all) {
        // everything not read yet arrives now; what is already here (and may have been edited) stays as it is
        const part = detail.config || {};
        const got = new Set(Object.keys(part).filter((k) => k !== "banners" && !loadedKeys.has(k)));
        cfg = cfg || {};
        got.forEach((k) => (cfg[k] = part[k]));
        normalizeKeys(got);
        got.forEach((k) => loadedKeys.add(k));
        snapshotKeys(got);
        logoUrl = detail.logoUrl || null;
        loadedKeys.add("logoUrl");
        fullLoaded = true;
      } else {
        adoptPart(detail, want);
      }
      applyMeta(detail);
      if (behind && dirty) tplVersion = keepVersion; // edits were made on the older copy: keep its version, so Save is refused instead of overwriting the newer one
      fill(true);
      renderTemplates();
    }).finally(() => {
      loading = false;
      detailPromise = null;
    });
    return detailPromise;
  }

  async function refresh() {
    if (!root.firstElementChild) {
      build();
      // admin-order-messages.js draws the (closed) "Customer notifications" card that build() left a spot for
      document.dispatchEvent(new CustomEvent("freshcutz:customize-built"));
    }
  }

  return {
    refresh,
    openElement,
    // admin-backup.js calls this when its (unsaved) settings change, to light up the Save button.
    refreshSaveState: () => {
      if (document.getElementById("czSave")) markDirty(dirty);
    },
  };
})();
