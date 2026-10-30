/* ==========================================================================
   Delivery slots as times of day (shared by the admin's Customize tab and the customer website).

   A slot is { start, end } in minutes after midnight, India time (IST, UTC+5:30, no daylight saving).
   - fmt / label  : 480 -> "8 AM", 510 -> "8:30 AM", { 480, 540 } -> "8 AM – 9 AM"
   - parse        : reads the old text options ("8 AM – 9 AM", "8:30 AM to 9:30 AM", "10-11 AM") back into times
   - plan         : which slots a customer may pick, for today / tomorrow / the day after, from the clock in India
   ========================================================================== */
window.SlotTime = (() => {
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /** 480 -> "8 AM", 510 -> "8:30 AM", 1440 -> "12 AM". */
  function fmt(min) {
    const m0 = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(m0 / 60);
    const m = m0 % 60;
    const h12 = h % 12 || 12;
    return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
  }

  /** The same with the minutes always shown, for the admin's drop-downs: "8:00 AM". */
  function fmtFull(min) {
    const m0 = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(m0 / 60);
    return `${h % 12 || 12}:${String(m0 % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }

  const label = (w) => `${fmt(w.start)} – ${fmt(w.end)}`;

  /** "8 AM – 9 AM" and the usual ways of writing it -> { start, end }; null when it can't be read. */
  function parse(text) {
    const m = String(text || "")
      .trim()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m?\.?)?\s*(?:[-–—~]|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$/i);
    if (!m) return null;
    const h1 = Number(m[1]), m1 = Number(m[2] || 0), h2 = Number(m[4]), m2 = Number(m[5] || 0);
    if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12 || m1 > 59 || m2 > 59) return null;
    const ap2 = m[6].toLowerCase();
    const to24 = (h, ap) => (h % 12) + (ap === "p" ? 12 : 0);
    const end = to24(h2, ap2) * 60 + m2;
    let ap1 = m[3] ? m[3].toLowerCase() : ap2; // "10 - 11 AM": the first time shares the second one's AM / PM
    let start = to24(h1, ap1) * 60 + m1;
    if (!m[3] && start >= end && ap2 === "p") start = to24(h1, "a") * 60 + m1; // "11 - 1 PM": 11 AM to 1 PM
    return start < end ? { start, end: end } : null;
  }

  /** Now in India: { y, m (1-12), d, minutes (since midnight, with seconds as a fraction) }. */
  function istNow() {
    const t = new Date(Date.now() + IST_OFFSET_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60 };
  }

  /** The date `offset` days after the given India date: { d, month, short ("29 Oct"), long ("29 October"), weekday ("Thursday") }. */
  function dayInfo(now, offset) {
    const t = new Date(Date.UTC(now.y, now.m - 1, now.d + offset));
    const month = MONTHS[t.getUTCMonth()];
    return { d: t.getUTCDate(), month, short: `${t.getUTCDate()} ${month.slice(0, 3)}`, long: `${t.getUTCDate()} ${month}`, weekday: DAYS[t.getUTCDay()] };
  }

  /**
   * What the customer may pick. A slot is offered when it starts at least `notice` minutes from now.
   * Tomorrow (and the day after, only when the notice is long) are offered in full.
   * Returns [{ key: "today" | "tomorrow" | "day2", name: "Today", date, short, weekday, slots: [{ value, time, start, end }] }]
   * for the days that have at least one slot; `value` is what is saved with the order, e.g. "Today, 28 Oct · 9 AM – 10 AM".
   */
  function plan(windows, notice, now) {
    now = now || istNow();
    const list = (windows || []).filter((w) => w && w.start < w.end).slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const names = ["Today", "Tomorrow", null];
    const keys = ["today", "tomorrow", "day2"];
    const out = [];
    let tomorrowFull = false;
    for (let day = 0; day < 3; day++) {
      let slots = list.filter((w) => day * 1440 + w.start >= now.minutes + notice);
      if (day === 1) tomorrowFull = slots.length === list.length;
      if (day === 2 && tomorrowFull) continue; // (the day after is only needed when a long notice cuts into tomorrow)
      if (!slots.length) continue;
      const info = dayInfo(now, day);
      const name = names[day] || info.weekday;
      out.push({
        key: keys[day],
        name,
        date: info.long,
        short: info.short,
        slots: slots.map((w) => ({ start: w.start, end: w.end, time: label(w), value: `${name}, ${info.short} · ${label(w)}` })),
      });
    }
    return out;
  }

  const SAVED = /^(Today|Tomorrow|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{1,2}) ([A-Z][a-z]{2}) \u00b7 (.+)$/;

  /**
   * The delivery time of an order, as it should read TODAY. Orders keep the text they were placed with ("Tomorrow, 29 Oct ·
   * 5 PM – 6 PM"), so "Today" / "Tomorrow" are worked out again from the date in it, in India time:
   *   open order, 29 Oct is today  -> "Today, 29 Oct · 5 PM – 6 PM";  tomorrow -> "Tomorrow, ...";  later -> "Friday, 30 Oct · ..."
   *   Delivered / Cancelled, or the day has passed -> "29 Oct · 5 PM – 6 PM" (a record of what was planned, no relative word)
   * Any other text (old plain options such as "8 AM – 9 AM") is returned as it is.
   */
  function display(text, status) {
    const m = SAVED.exec(text || "");
    if (!m) return text;
    const mon = MONTHS.findIndex((n) => n.slice(0, 3) === m[3]);
    if (mon < 0) return text;
    const d = Number(m[2]);
    const date = `${d} ${m[3]}`;
    if (status === "DELIVERED" || status === "CANCELLED") return `${date} \u00b7 ${m[4]}`;
    const now = istNow();
    const today = Date.UTC(now.y, now.m - 1, now.d) / 86400000;
    // (the text has no year: take the one that puts the date nearest to today)
    let day = null;
    for (const y of [now.y - 1, now.y, now.y + 1]) {
      const v = Date.UTC(y, mon, d) / 86400000;
      if (day === null || Math.abs(v - today) < Math.abs(day - today)) day = v;
    }
    const diff = day - today;
    if (diff < 0) return `${date} \u00b7 ${m[4]}`;
    const name = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : DAYS[new Date(day * 86400000).getUTCDay()];
    return `${name}, ${date} \u00b7 ${m[4]}`;
  }

  return { fmt, fmtFull, label, parse, istNow, dayInfo, plan, display };
})();
