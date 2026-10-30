/* Email backup.
 *
 * 1) The "Email backup now" button in the top bar (inside the ☰ menu on phones), which also
 *    shows when the last backup happened and when the next one is due.
 * 2) The "Email backup" section in the Customize tab (mounted by admin-customize.js): the
 *    automatic-backup switch, how often, and the period for the "Email backup now" button. Like every other Customize section, nothing is
 *    saved until you press Save template / Save & make live — admin-customize.js calls
 *    AdminBackup.save() then.
 *
 * Costs nothing while idle: the status is fetched when you sign in, when you open the
 * Email backup section of Customize or the phone menu (at most once every 30 s), and after you press a
 * button — never on a timer. The server answers it from memory. The Excel file is
 * built and e-mailed by the server; nothing is downloaded here. */
(() => {
  if (typeof Api === "undefined") return;

  const TOKEN_KEY = "freshcutz_admin_token";
  const topBtn = document.getElementById("backupNowBtn");
  const topLabel = topBtn && topBtn.querySelector(".bk-label");
  const topSub = document.getElementById("backupNowSub");

  // How-often choices, in hours.
  const CHOICES = [
    [1, "Every hour"],
    [6, "Every 6 hours"],
    [12, "Every 12 hours"],
    [24, "Every day"],
    [72, "Every 3 days"],
    [168, "Every 7 days"],
    [240, "Every 10 days"],
    [720, "Every 30 days"],
  ];

  // How much data goes into the file: orders / order items / daily sales of these calendar days
  // (0 = everything, 1 = today, -1 = yesterday only). Customers, products and settings are always
  // included in full.
  const RANGES = [
    [0, "Everything"],
    [1, "Today"],
    [-1, "Yesterday"],
    [7, "Last 7 days"],
    [10, "Last 10 days"],
    [15, "Last 15 days"],
    [30, "Last 30 days"],
    [60, "Last 60 days"],
    [90, "Last 90 days"],
  ];

  let status = null;      // what the server has saved
  let draft = null;       // what the form currently shows: { enabled, intervalHours, rangeDays }
  let loadedAt = 0;
  let sending = false;
  let saving = false;
  let host = null;        // the Customize section's body, once mounted

  // ---- helpers ----------------------------------------------------------
  function fmt(ms) {
    try {
      return new Date(ms).toLocaleString("en-US", {
        timeZone: "Asia/Kolkata", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
    } catch (_) {
      return new Date(ms).toLocaleString();
    }
  }

  const lastText = (s) => (s && s.lastSuccessAt ? fmt(s.lastSuccessAt) : "not yet");

  // Always the exact time. If it has already passed, say so (the server sends it as soon as it is
  // awake and the database / Resend are reachable).
  function nextText(s, short) {
    if (!s || !s.configured) return "";
    if (!s.autoEnabled) return "off";
    if (!s.nextAt) return "when the server next starts";
    const overdue = s.nextAt < Date.now() - 60000;
    return fmt(s.nextAt) + (overdue ? (short ? " (overdue)" : " (overdue — sends as soon as the server is active)") : "");
  }

  function freqOptions(current) {
    const list = CHOICES.slice();
    if (current && !list.some((c) => c[0] === current)) {
      list.push([current, `Every ${current} hours`]);
      list.sort((a, b) => a[0] - b[0]);
    }
    return list.map(([h, label]) => `<option value="${h}">${label}</option>`).join("");
  }

  function rangeOptions(current) {
    const list = RANGES.slice();
    if (current && !list.some((c) => c[0] === current)) {
      list.push([current, `Last ${current} days`]);
    }
    return list.map(([d, label]) => `<option value="${d}">${label}</option>`).join("");
  }

  function isDirty() {
    return !!(status && status.configured && draft &&
      (draft.enabled !== !!status.autoEnabled ||
        draft.intervalHours !== status.intervalHours ||
        draft.rangeDays !== (status.rangeDays || 0)));
  }

  function fromStatus() {
    return { enabled: !!status.autoEnabled, intervalHours: status.intervalHours, rangeDays: status.rangeDays || 0 };
  }

  function syncDraft() {
    if (status && !isDirty()) draft = fromStatus();
  }

  function tellCustomize() {
    if (window.AdminCustomize && window.AdminCustomize.refreshSaveState) window.AdminCustomize.refreshSaveState();
  }

  // ---- painting ---------------------------------------------------------
  function paintTop() {
    if (!topBtn) return;
    const s = status;
    if (!s) {
      topSub.innerHTML = "";
      topBtn.title = "Email a backup now";
    } else if (!s.configured) {
      topSub.innerHTML = `<span class="bk-line">Not set up yet</span>`;
      topBtn.title = "Backup e-mail isn't set up yet";
    } else {
      const last = `Last: ${lastText(s)}`;
      const next = `Next: ${nextText(s, true)}`;
      // two lines (Last / Next) in the phone menu; side by side in the wide top bar
      topSub.innerHTML = `<span class="bk-line">${last}</span><span class="bk-line">${next}</span>`;
      topBtn.title = "Email a backup now — " + last + " · " + next;
    }
    topBtn.classList.toggle("is-busy", sending);
    if (topLabel) topLabel.innerHTML = sending ? `<span class="spinner"></span> Sending…` : "Email backup now";
  }

  function paintCard() {
    if (!host) return;
    const s = status;
    const info = host.querySelector("#bkInfo");
    const controls = host.querySelector("#bkControls");
    if (!s) {
      info.textContent = "Checking…";
      controls.hidden = true;
      host.querySelector("#bkTimes").hidden = true;
      return;
    }
    const err = host.querySelector("#bkErr");
    if (!s.configured) {
      info.textContent = "Not set up yet. On Render, add RESEND_API_KEY and BACKUP_EMAIL_TO, then redeploy.";
      controls.hidden = true;
      host.querySelector("#bkTimes").hidden = true;
    } else {
      info.innerHTML = `Sends an Excel file with all your data to <b>${s.to}</b>. Use <b>Email backup now</b> at the top of the screen to send one right away.`;
      controls.hidden = false;
      const tog = host.querySelector("#bkToggle");
      const freq = host.querySelector("#bkFreq");
      tog.checked = !!draft.enabled;
      tog.disabled = saving;
      freq.innerHTML = freqOptions(draft.intervalHours);
      freq.value = String(draft.intervalHours);
      freq.disabled = saving || !draft.enabled;
      const range = host.querySelector("#bkRange");
      range.innerHTML = rangeOptions(draft.rangeDays);
      range.value = String(draft.rangeDays);
      range.disabled = saving;
      host.querySelector("#bkTimes").hidden = false;
      host.querySelector("#bkLast").innerHTML = `<b>Last backup:</b> ${lastText(s)}`;
      host.querySelector("#bkNext").innerHTML = `<b>Next backup:</b> ${nextText(s)}` + (isDirty() ? " <i>(changes apply after you save)</i>" : "");
    }
    if (s.lastError) { err.textContent = `Last problem: ${s.lastError}`; err.hidden = false; } else { err.hidden = true; }
  }

  function paint() {
    paintTop();
    paintCard();
  }

  // ---- server -----------------------------------------------------------
  async function load(force) {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    if (window.AdminAccess && !AdminAccess.can("backup")) return;   // this login may not use e-mail backup
    const now = Date.now();
    if (!force && status && now - loadedAt < 180000) { paint(); return; }
    loadedAt = now;
    try {
      status = await Api.get("/api/admin/backup/status");
      syncDraft();
      paint();
      tellCustomize();
    } catch (e) {
      if (host && !status) host.querySelector("#bkInfo").textContent = "Couldn't read the backup status.";
    }
  }

  async function sendNow() {
    if (sending) return;
    if (status && !status.configured) {
      Toast.show("Backup e-mail isn't set up yet — add RESEND_API_KEY and BACKUP_EMAIL_TO on Render.", "error");
      return;
    }
    sending = true;
    paint();
    try {
      const res = await Api.post("/api/admin/backup/send");
      Toast.show(res.message || "Backup sent", "success");
    } catch (e) {
      Toast.show(e.message || "Backup failed", "error");
    } finally {
      sending = false;
      await load(true);
      paint();
    }
  }

  /** Called by admin-customize.js when Save template / Save & make live is pressed. */
  async function save() {
    if (!isDirty()) return true;
    saving = true;
    paint();
    try {
      status = await Api.put("/api/admin/backup/settings", { enabled: draft.enabled, intervalHours: draft.intervalHours, rangeDays: draft.rangeDays });
      loadedAt = Date.now();
      draft = fromStatus();
      Toast.show(status.autoEnabled ? "Email backup settings saved" : "Automatic email backups are off", "success");
      return true;
    } catch (e) {
      Toast.show(e.message || "Couldn't save the email backup settings", "error");
      return false;
    } finally {
      saving = false;
      paint();
      tellCustomize();
    }
  }

  // ---- the Customize section -------------------------------------------
  function mount(el) {
    if (!el) return;
    host = el;
    host.innerHTML = `
      <div class="cz-hint" id="bkInfo">Checking…</div>
      <div id="bkControls" hidden>
        <div class="cz-row">
          <div>
            <div class="cz-row-label">Automatic backups</div>
            <div class="cz-hint">Switch off to stop the automatic e-mails. The top-bar button still works.</div>
          </div>
          <label class="switch"><input type="checkbox" id="bkToggle" /><span class="track"></span></label>
        </div>
        <div class="cz-row">
          <div>
            <div class="cz-row-label">Send</div>
            <div class="cz-hint">Each automatic e-mail holds exactly this much data: every 10 days = the last 10 days, every 6 hours = the last 6 hours. One after another, with nothing missed and nothing repeated. If the server was off for a while, the next e-mail has one file for each missed period.</div>
          </div>
          <select class="bk-select" id="bkFreq" aria-label="How often"></select>
        </div>
        <div class="cz-row">
          <div>
            <div class="cz-row-label">Data to include</div>
            <div class="cz-hint">Only for the <b>Email backup now</b> button at the top of the screen: which days of orders, order items and daily sales it sends (customers, products and settings are always included in full). Automatic backups ignore this and follow <b>Send</b>.</div>
          </div>
          <select class="bk-select" id="bkRange" aria-label="How much data"></select>
        </div>
      </div>
      <div class="bk-times" id="bkTimes" hidden>
        <div id="bkLast"></div>
        <div id="bkNext"></div>
      </div>
      <div class="cz-hint bk-err" id="bkErr" hidden></div>
      <div class="cz-hint" style="margin-top:8px">Changes are saved when you press <b>Save template</b> or <b>Save &amp; make live</b> below. Automatic backups go out when the server is awake — if it was asleep, the next visit sends the overdue one within a few minutes.</div>
    `;
    host.querySelector("#bkToggle").addEventListener("change", (e) => {
      if (!draft) return;
      draft.enabled = e.target.checked;
      paintCard();
      tellCustomize();
    });
    host.querySelector("#bkFreq").addEventListener("change", (e) => {
      if (!draft) return;
      draft.intervalHours = Number(e.target.value);
      paintCard();
      tellCustomize();
    });
    host.querySelector("#bkRange").addEventListener("change", (e) => {
      if (!draft) return;
      draft.rangeDays = Number(e.target.value);
      paintCard();
      tellCustomize();
    });
    paintCard();
    // (no request here: the status is read when the Email backup section is opened - see open())
  }

  /** The Email backup section of Customize was opened: show the latest status (a request only if it is older than 3 minutes). */
  function open() {
    load(false);
  }

  // ---- wiring -----------------------------------------------------------
  if (topBtn) topBtn.addEventListener("click", sendNow);

  const menuBtn = document.getElementById("topMenuBtn");
  if (menuBtn) menuBtn.addEventListener("click", () => load(false));

  document.addEventListener("freshcutz:login", () => load(true));
  document.addEventListener("freshcutz:logout", () => {
    status = null;
    draft = null;
    loadedAt = 0;
    paint();
  });
  const app = document.getElementById("adminApp");
  if (localStorage.getItem(TOKEN_KEY) && app && !app.hidden) load(true);
  else if (localStorage.getItem(TOKEN_KEY)) setTimeout(() => load(false), 300);

  window.AdminBackup = { mount, open, isDirty, save };
})();
