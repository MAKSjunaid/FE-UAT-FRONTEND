/* Store-wide Online/Offline toggle in the admin topbar, plus the "Store hours"
 * panel (⏰) for opening and closing automatically.
 *
 * When offline, customers see a banner and can't place orders (enforced
 * server-side in OrderService.placeOrder()). With automatic hours on, the
 * SERVER flips the store at the right moment and pushes the change over the
 * same /api/store/status/stream connection the storefront uses — so this page
 * never polls: it opens that one stream while the tab is visible and only
 * re-reads the details when the open/closed answer actually changes. */

window.AdminStore = (() => {
  const toggle = document.getElementById("storeOnlineToggle");
  const label = document.getElementById("storeToggleLabel");
  const schedBtn = document.getElementById("storeScheduleBtn");
  const sheetRoot = document.getElementById("sheetRoot");

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const ZONES = [
    ["Asia/Kolkata", "India (IST)"],
    ["Asia/Dubai", "Dubai"],
    ["Asia/Singapore", "Singapore"],
    ["Europe/London", "London"],
    ["America/New_York", "New York"],
    ["America/Los_Angeles", "Los Angeles"],
    ["Australia/Sydney", "Sydney"],
    ["UTC", "UTC"],
  ];

  let info = null; // last AdminStoreResponse
  let eventSource = null;
  let loggedIn = false;

  const esc = (s) => Utils.escapeHtml(s == null ? "" : String(s));

  /** "09:00:00" -> "09:00" (the time boxes only ever deal in hours and minutes). */
  function hhmm(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  }

  /** Three drop-downs (hour, minute, AM/PM) instead of the browser's time box,
   * so there are never any seconds to see or pick. `value` is "HH:mm" (24-hour). */
  function timePicker(id, value) {
    const [h24, m] = (hhmm(value) || "09:00").split(":").map(Number);
    const h12 = ((h24 + 11) % 12) + 1;
    const pm = h24 >= 12;
    const hours = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((h) => `<option value="${h}" ${h === h12 ? "selected" : ""}>${h}</option>`).join("");
    const mins = Array.from({ length: 60 }, (_, i) => i)
      .map((x) => `<option value="${x}" ${x === m ? "selected" : ""}>${String(x).padStart(2, "0")}</option>`).join("");
    return `<div class="sched-time" id="${id}">
      <select data-part="h" aria-label="Hour">${hours}</select>
      <span class="sched-colon">:</span>
      <select data-part="m" aria-label="Minute">${mins}</select>
      <select data-part="p" aria-label="AM or PM"><option value="AM" ${pm ? "" : "selected"}>AM</option><option value="PM" ${pm ? "selected" : ""}>PM</option></select>
    </div>`;
  }

  /** Reads a timePicker back as "HH:mm" (24-hour). */
  function readTime(id) {
    const box = sheetRoot.querySelector("#" + id);
    const h = Number(box.querySelector('[data-part="h"]').value) % 12;
    const m = Number(box.querySelector('[data-part="m"]').value);
    const pm = box.querySelector('[data-part="p"]').value === "PM";
    return `${String(h + (pm ? 12 : 0)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function to12h(t) {
    const [h, m] = String(hhmm(t) || "00:00").split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }

  function summary(i) {
    if (!i || !i.schedule || !i.schedule.autoEnabled) return "Opening hours: not set (switch is manual)";
    const s = i.schedule;
    const days = s.days.length === 7 ? "every day" : s.days.map((d) => DAYS[d - 1]).join(", ");
    return `Opens ${to12h(s.openTime)} – ${to12h(s.closeTime)}, ${days}`;
  }

  function render(i) {
    info = i;
    toggle.checked = i.online;
    label.textContent = i.online ? "Online" : "Offline";
    label.style.color = i.online ? "" : "#ff9d90";
    const auto = !!(i.schedule && i.schedule.autoEnabled);
    schedBtn.classList.toggle("is-active", auto);
    schedBtn.title = summary(i) + (i.manualOverride ? " — switch is overriding it for now" : "");
    schedBtn.textContent = "⏰";
    schedBtn.classList.toggle("has-override", !!i.manualOverride);
    if (sheetRoot.querySelector("#storeSchedForm")) paintStatus();
  }

  async function refresh() {
    loggedIn = true;
    connect();
    try {
      render(await Api.get("/api/admin/store"));
    } catch {
      // leave the toggle as-is — a background refresh failure shouldn't
      // yank control away from whatever the admin is looking at
    }
  }

  // ---- live updates: one SSE connection, only while the tab is visible ----------
  function connect() {
    if (eventSource || !loggedIn || document.hidden || !window.EventSource) return;
    eventSource = new EventSource(Api.streamUrl("/api/store/status/stream"));
    eventSource.addEventListener("status", (e) => {
      try {
        const s = JSON.parse(e.data);
        // Our own toggle/save already updated the screen; only a real change
        // (e.g. the clock reached opening time) needs the details re-read.
        if (!info || !!s.online !== info.online) refresh();
      } catch {
        /* ignore a malformed push; the next one will fix it */
      }
    });
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      disconnect();
    } else if (loggedIn) {
      connect();
      refresh(); // pick up anything that changed while the tab was hidden
    }
  });
  document.addEventListener("freshcutz:logout", () => {
    loggedIn = false;
    info = null;
    disconnect();
  });

  // ---- the topbar switch ---------------------------------------------------------
  toggle.addEventListener("change", async () => {
    const online = toggle.checked;
    try {
      const i = await Api.patch("/api/admin/store/online", { online });
      render(i);
      let msg = i.online ? "Store is now online and accepting orders" : "Store is now offline — customers can't place orders";
      if (i.manualOverride && i.nextChangeText) msg += ` (until the schedule changes at ${i.nextChangeText})`;
      Toast.show(msg, "success");
    } catch (err) {
      toggle.checked = !online;
      Toast.show(err.message, "error");
    }
  });

  // ---- the "Store hours" panel ---------------------------------------------------
  function paintStatus() {
    const box = sheetRoot.querySelector("#storeSchedStatus");
    if (!box || !info) return;
    const s = info.schedule;
    let html;
    if (!s.autoEnabled) {
      html = `Right now the store is <b>${info.online ? "open" : "closed"}</b> — controlled by the Online/Offline switch only.`;
    } else if (info.manualOverride) {
      html = `Right now the store is <b>${info.online ? "open" : "closed"}</b> because you used the switch. The schedule takes over again at <b>${esc(info.nextChangeText)}</b>.
        <button type="button" class="btn btn-ghost btn-sm" data-act="follow">Back to schedule now</button>`;
    } else {
      html = `Right now the store is <b>${info.online ? "open" : "closed"}</b>` +
        (info.nextChangeText ? ` — it ${info.nextChangeOpens ? "opens" : "closes"} <b>${esc(info.nextChangeText)}</b>.` : ".");
    }
    box.innerHTML = html;
  }

  function openSheet() {
    if (!info) return;
    const s = info.schedule;
    const zones = ZONES.some(([z]) => z === s.timezone) ? ZONES : [[s.timezone, s.timezone], ...ZONES];
    const days = s.days.length ? s.days : [1, 2, 3, 4, 5, 6, 7];
    sheetRoot.innerHTML = `
      <div class="overlay" data-role="overlay"></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-header"><h2>⏰ Store hours</h2><button class="sheet-close" data-role="close">✕</button></div>
        <form class="sheet-body" id="storeSchedForm">
          <div class="sched-status" id="storeSchedStatus"></div>
          <label class="sched-auto">
            <span><b>Open and close automatically</b><small>The store opens and closes by itself at these times.</small></span>
            <span class="switch"><input type="checkbox" id="schedAuto" ${s.autoEnabled ? "checked" : ""} /><span class="track"></span></span>
          </label>
          <div class="sched-fields" id="schedFields">
            <div class="sched-times">
              <div class="field"><label>Opens at</label>${timePicker("schedOpen", s.openTime)}</div>
              <div class="field"><label>Closes at</label>${timePicker("schedClose", s.closeTime)}</div>
            </div>
            <p class="sched-hint">A closing time earlier than the opening time means after midnight (e.g. 6:00 PM – 2:00 AM).</p>
            <div class="field">
              <label>Open on</label>
              <div class="sched-days">
                ${DAYS.map((d, i) => `<button type="button" class="sched-day ${days.includes(i + 1) ? "on" : ""}" data-day="${i + 1}" aria-pressed="${days.includes(i + 1)}">${d}</button>`).join("")}
              </div>
            </div>
            <div class="field">
              <label for="schedZone">Time zone</label>
              <select id="schedZone">${zones.map(([z, n]) => `<option value="${esc(z)}" ${z === s.timezone ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
            </div>
          </div>
          <p class="sched-hint">You can still use the Online/Offline switch at the top to open late or close early — the schedule takes over again at its next opening or closing time.</p>
        </form>
        <div class="sheet-footer"><button class="btn btn-gold btn-block" id="schedSave" type="button">Save hours</button></div>
      </div>`;
    paintStatus();
    syncDim();
  }

  function syncDim() {
    const on = sheetRoot.querySelector("#schedAuto").checked;
    sheetRoot.querySelector("#schedFields").classList.toggle("is-dim", !on);
  }

  function close() {
    sheetRoot.innerHTML = "";
  }

  async function save() {
    const btn = sheetRoot.querySelector("#schedSave");
    const body = {
      autoEnabled: sheetRoot.querySelector("#schedAuto").checked,
      openTime: readTime("schedOpen"),
      closeTime: readTime("schedClose"),
      days: [...sheetRoot.querySelectorAll(".sched-day.on")].map((b) => Number(b.dataset.day)),
      timezone: sheetRoot.querySelector("#schedZone").value,
    };
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Saving...`;
    try {
      const i = await Api.put("/api/admin/store/schedule", body);
      render(i);
      Toast.show(body.autoEnabled ? "Store hours saved — the store will open and close automatically" : "Automatic hours are off", "success");
      close();
    } catch (err) {
      Toast.show(err.message, "error");
      btn.disabled = false;
      btn.textContent = "Save hours";
    }
  }

  schedBtn.addEventListener("click", openSheet);

  // One delegated listener for everything inside the panel.
  sheetRoot.addEventListener("click", async (e) => {
    if (!sheetRoot.querySelector("#storeSchedForm")) return; // some other sheet (e.g. product form) is open
    if (e.target.closest('[data-role="overlay"], [data-role="close"]')) return close();
    const day = e.target.closest(".sched-day");
    if (day) {
      day.classList.toggle("on");
      day.setAttribute("aria-pressed", day.classList.contains("on"));
    } else if (e.target.closest("#schedSave")) {
      save();
    } else if (e.target.closest('[data-act="follow"]')) {
      try {
        render(await Api.patch("/api/admin/store/follow-schedule"));
        Toast.show("Back on the schedule", "success");
      } catch (err) {
        Toast.show(err.message, "error");
      }
    }
  });
  sheetRoot.addEventListener("change", (e) => {
    if (e.target.id === "schedAuto") syncDim();
  });

  return { refresh };
})();
