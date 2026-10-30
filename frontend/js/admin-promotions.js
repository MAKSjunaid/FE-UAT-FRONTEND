/* More -> Push notifications: write an offer / announcement and send it to every customer who turned
 * notifications on. Shows a live preview (with a real customer's first name), asks for a final OK that says
 * how many devices it goes to, can send a test to your own phone first, has no limit on how many you send,
 * and keeps a history.
 *
 * Who sees what is the "Push notifications" permission (Users & access): View = this page + history,
 * Edit = also write and send. The server checks every request again. Talks to /api/admin/promotions. */

window.AdminPromotions = (() => {
  const root = document.getElementById("promotionsRoot");
  const sheetRoot = document.getElementById("sheetRoot");
  if (!root) return { refresh() {} };
  const Kit = window.AdminNotifyKit;
  const esc = Kit.esc;

  let ov = null;            // overview from the server
  let fetchedAt = 0;        // when (browser clock) it arrived
  let loading = false;
  let built = false;
  let builtEdit = false;    // whether the composer was shown when the page was built
  let sending = false;
  let testBusy = false;
  let pollLeft = 0;
  let pollTimer = null;
  const STALE_MS = 60 * 1000;

  const canView = () => !window.AdminAccess || AdminAccess.can("promotions", "VIEW");
  const canEdit = () => !window.AdminAccess || AdminAccess.can("promotions", "EDIT");
  const sampleName = () => (ov && ov.sampleName) || "Kalam";

  const when = (iso) => {
    try {
      return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit" });
    } catch (e) { return iso; }
  };

  // ---- page ------------------------------------------------------------------
  function build() {
    const edit = canEdit();
    root.innerHTML = `
      <div class="pn-wrap">
        <div class="us-head"><div>
          <h2 class="us-title">Push notifications</h2>
          <p class="us-sub">Send an offer or announcement to every customer who turned notifications on.</p>
        </div></div>
        <div class="pn-stat" data-stat></div>
        ${edit ? `
        <section class="pn-card" data-composer>
          <label class="nm-field">Title
            <input type="text" data-f="title" maxlength="${(ov && ov.maxTitle) || 60}" autocomplete="off" placeholder="e.g. Sunday Special 🍗" />
          </label>
          <label class="nm-field">Message
            <textarea data-f="body" rows="3" maxlength="${(ov && ov.maxBody) || 200}" placeholder="e.g. {name}, fresh chicken at ₹20 off today only!"></textarea>
          </label>
          <div class="nk-tools nm-tools" data-field='[data-composer] [data-f="body"]'>
            <button type="button" class="nm-chip" data-nk-emoji>😀 Emoji</button>
            <button type="button" class="nm-chip" data-ins="{name}" title="Each customer sees their own first name here">＋ Customer name</button>
            ${Kit.paletteHtml()}
          </div>
          <p class="nm-hint">Tap in the Title or Message first, then use the buttons. <span data-count></span><br>
            <b>{name}</b> becomes each customer's first name — or “there” if we don't know it.</p>
          <h4 class="pn-ph">Preview</h4>
          <div data-preview></div>
          <div class="pn-actions">
            <button type="button" class="btn btn-ghost" data-test>📱 Send test to my phone first</button>
            <button type="button" class="btn btn-gold" data-review>Review &amp; send</button>
          </div>
          <p class="pn-reason" data-reason aria-live="polite"></p>
          <p class="pn-test" data-teststatus aria-live="polite"></p>
        </section>` : `
        <p class="pn-viewonly">👀 You can see this page and the history, but you don't have permission to send promotions.</p>`}
        <div class="pn-histhead"><h3>Past promotions</h3><button type="button" class="nm-chip" data-refresh>↻ Refresh</button></div>
        <div data-history></div>
      </div>`;
    Kit.wirePalettes(root, (wrap) => lastField || wrap.closest("[data-composer]").querySelector('[data-f="body"]'));
    built = true;
    builtEdit = edit;
    paintAll();
  }

  let lastField = null;
  root.addEventListener("focusin", (e) => {
    const f = e.target.closest("[data-f]");
    if (f) lastField = f;
  });

  const fieldVal = (n) => {
    const el = root.querySelector(`[data-composer] [data-f="${n}"]`);
    return el ? el.value : "";
  };

  function paintAll() {
    paintStat();
    paintPreview();
    paintHistory();
  }

  function paintStat() {
    const el = root.querySelector("[data-stat]");
    if (!el || !ov) return;
    el.innerHTML = !ov.configured
      ? `⚠️ Notifications aren't set up on the server yet (push keys missing).`
      : ov.devices > 0
        ? `📱 <b>${ov.devices}</b> customer device${ov.devices === 1 ? "" : "s"} will receive your promotion.`
        : `📱 Nobody has turned on notifications yet. Customers are asked when they open the shop, and again after they order.`;
  }

  function paintPreview() {
    const box = root.querySelector("[data-preview]");
    if (!box) return;
    const n = sampleName();
    const t = Kit.fill(fieldVal("title"), n);
    const b = Kit.fill(fieldVal("body"), n);
    box.innerHTML = Kit.previewHtml(t, b);
    const cnt = root.querySelector("[data-count]");
    if (cnt) cnt.textContent = `Message: ${fieldVal("body").length}/${(ov && ov.maxBody) || 200}`;
    updateButtons();
  }

  function updateButtons() {
    const review = root.querySelector("[data-review]");
    const test = root.querySelector("[data-test]");
    if (!review) return;
    const filled = fieldVal("title").trim() && fieldVal("body").trim();
    const ready = !!(ov && ov.configured && ov.devices > 0);
    review.disabled = !(filled && ready) || sending;
    if (test) test.disabled = !filled || testBusy;
    // say WHY Send is off, so it never looks broken
    const why = root.querySelector("[data-reason]");
    if (why) {
      why.textContent = !ov ? ""
        : !ov.configured ? "Send is off: notifications aren't set up on the server yet."
        : ov.devices === 0 ? "Send is off: nobody has turned on notifications yet, so there's no one to send to."
        : !filled ? "Write a title and a message to send."
        : "";
    }
  }

  function paintHistory() {
    const el = root.querySelector("[data-history]");
    if (!el || !ov) return;
    const rows = ov.history || [];
    if (!rows.length) {
      el.innerHTML = `<div class="pn-empty">No promotions sent yet.</div>`;
      return;
    }
    const old = Date.now() - 15 * 60 * 1000;
    el.innerHTML = rows.map((h) => {
      const running = !h.finished && Date.parse(h.sentAt) > old;
      const result = running
        ? `⏳ Sending to ${h.devices} device${h.devices === 1 ? "" : "s"}…`
        : h.finished
          ? `✅ ${h.delivered} delivered${h.failed ? ` · ⚠️ ${h.failed} failed` : ""} <span class="pn-of">(of ${h.devices})</span>`
          : `⚠️ Not finished (sent to ${h.devices})`;
      return `<article class="pn-hist">
        <div class="pn-hist-top"><b>${esc(h.title)}</b><span>${esc(when(h.sentAt))}</span></div>
        <div class="pn-hist-body">${esc(h.body)}</div>
        <div class="pn-hist-meta">${result}${h.sentBy ? ` · by ${esc(h.sentBy)}` : ""}</div>
      </article>`;
    }).join("");
  }

  // ---- talking to the server ---------------------------------------------------
  async function load(force) {
    if (!canView() || loading) return;
    if (ov && !force && Date.now() - fetchedAt < STALE_MS) { if (!built) build(); return; }
    loading = true;
    if (!ov) root.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;
    try {
      ov = await Api.get("/api/admin/promotions");
      fetchedAt = Date.now();
      if (!built) build(); else paintAll();
    } catch (e) {
      if (!ov) root.innerHTML = `<div class="empty-state"><p>${esc(e.message || "Couldn't load")}</p></div>`;
    } finally {
      loading = false;
    }
  }

  /** After sending: check back a few times so "Sending…" turns into the delivered count. */
  function pollForResult() {
    clearTimeout(pollTimer);
    pollLeft = 6;
    const step = async () => {
      if (pollLeft-- <= 0) return;
      await load(true);
      const running = ov && (ov.history || []).some((h) => !h.finished && Date.now() - Date.parse(h.sentAt) < 15 * 60 * 1000);
      if (running) pollTimer = setTimeout(step, 6000);
    };
    pollTimer = setTimeout(step, 3000);
  }

  async function myEndpoint() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      return sub ? sub.endpoint : null;
    } catch (e) { return null; }
  }

  async function sendTest() {
    const st = root.querySelector("[data-teststatus]");
    testBusy = true; updateButtons();
    st.className = "pn-test";
    st.textContent = "Sending a test…";
    try {
      const res = await Api.post("/api/admin/promotions/test", {
        title: fieldVal("title"), body: fieldVal("body"), endpoint: await myEndpoint(),
      });
      const results = res.results || [];
      if (res.configured === false) {
        st.textContent = "Notifications aren't set up on the server yet.";
        st.classList.add("is-bad");
      } else if (!res.subscriptions) {
        st.textContent = "This phone isn't signed up for alerts yet. Tap the 🔔 at the top of the page to turn order alerts on here, then try again.";
        st.classList.add("is-bad");
      } else if (results.some((r) => r.status >= 200 && r.status < 300)) {
        st.textContent = "✅ Test sent — it should appear on your phone in a moment (shown with the name “" + sampleName() + "”).";
        st.classList.add("is-ok");
      } else {
        st.textContent = "The test didn't go through" + (results[0] && results[0].detail ? " (" + results[0].detail + ")" : "") + ".";
        st.classList.add("is-bad");
      }
    } catch (e) {
      st.textContent = e.message || "Couldn't send the test";
      st.classList.add("is-bad");
    } finally {
      setTimeout(() => { testBusy = false; updateButtons(); }, 4000);
    }
  }

  // ---- final OK -----------------------------------------------------------------
  function confirmSheet() {
    const title = fieldVal("title").trim();
    const body = fieldVal("body").trim();
    const n = ov.devices;
    sheetRoot.innerHTML = `
      <div class="us-overlay" data-role="us-overlay">
        <div class="us-sheet us-sheet-small" role="dialog" aria-modal="true" aria-label="Send promotion">
          <div class="us-sheet-head">
            <h3>Send to customers?</h3>
            <button type="button" class="us-x" data-role="us-close" aria-label="Close">✕</button>
          </div>
          <div class="us-sheet-body">
            ${Kit.previewHtml(Kit.fill(title, sampleName()), Kit.fill(body, sampleName()))}
            <p class="pn-confirm">This will go to <b>${n} device${n === 1 ? "" : "s"}</b>. It can't be taken back,.</p>
            <p class="us-error" data-pn-error hidden></p>
          </div>
          <div class="us-sheet-foot">
            <button type="button" class="btn btn-ghost" data-role="us-close">Cancel</button>
            <button type="button" class="btn btn-gold" data-pn-go>Send now</button>
          </div>
        </div>
      </div>`;
    const go = sheetRoot.querySelector("[data-pn-go]");
    go.addEventListener("click", async () => {
      if (sending) return;
      sending = true; go.disabled = true; go.textContent = "Sending…";
      try {
        const res = await Api.post("/api/admin/promotions/send", { title, body });
        sheetRoot.innerHTML = "";
        Toast.show(`Sending to ${res.devices} device${res.devices === 1 ? "" : "s"}…`, "success");
        root.querySelector('[data-composer] [data-f="title"]').value = "";
        root.querySelector('[data-composer] [data-f="body"]').value = "";
        sending = false;
        await load(true);
        paintPreview();
        pollForResult();
      } catch (e) {
        sending = false;
        go.disabled = false; go.textContent = "Send now";
        const err = sheetRoot.querySelector("[data-pn-error]");
        if (err) { err.hidden = false; err.textContent = e.message || "Couldn't send"; }
        load(true);
      }
    });
  }

  // ---- events ---------------------------------------------------------------------
  root.addEventListener("input", (e) => { if (e.target.closest("[data-composer]")) paintPreview(); });
  root.addEventListener("click", (e) => {
    const ins = e.target.closest("[data-ins]");
    if (ins) {
      const target = lastField || root.querySelector('[data-composer] [data-f="body"]');
      Kit.insertAtCursor(target, ins.dataset.ins);
      return;
    }
    if (e.target.closest("[data-review]")) { if (ov) confirmSheet(); return; }
    if (e.target.closest("[data-test]")) { sendTest(); return; }
    if (e.target.closest("[data-refresh]")) { load(true); }
  });

  document.addEventListener("freshcutz:access", () => {
    if (!built) return;
    if (!canView()) { root.innerHTML = ""; built = false; ov = null; return; }
    if (canEdit() !== builtEdit) build(); // the permission changed (View <-> Edit); otherwise leave a draft alone
  });

  // A different person signing in must never see the previous page.
  document.addEventListener("freshcutz:logout", () => {
    ov = null; built = false; fetchedAt = 0; lastField = null;
    clearTimeout(pollTimer);
    root.innerHTML = "";
  });

  return { refresh: () => load(false) };
})();
