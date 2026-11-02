/* ONE live connection for the whole customer page.
 *
 * The page used to hold three Server-Sent-Events connections open at once - the website's look (site-customize.js), whether
 * the shop is taking orders (store-status.js) and the catalog's changes (storefront-sync.js) - each with its own keep-alive,
 * so even a phone that was only showing the shop never got to go quiet. They now share this connection
 * (/api/live/stream): every part says what it wants to hear, the server sends exactly the same messages as before, and this
 * file hands each message to the part it belongs to.
 *
 *   FreshcutzLive.attach(name, { query, on, open, legacyStart, legacyStop })
 *       query()  - the part's query-string pieces ("site=1&have=...") - asked again every time a connection is opened, so a
 *                  reconnect always says what the page holds NOW
 *       on       - { eventName: handler } for the messages of that part
 *       open()   - called each time the connection is open
 *       legacyStart / legacyStop - the part's own old connection, used only if this server does not have /api/live/stream yet
 *                  (the website and the server are updated separately, so the page must work with either order)
 *   FreshcutzLive.detach(name)    - the part stops listening (a hidden tab: when no part is left the connection is closed)
 *   FreshcutzLive.restart(name)   - connect again now (the part's query changed: someone signed in, a list must be asked again)
 *
 * Parts that attach in the same moment (the page becoming visible, or loading) share one connection: opening waits a
 * moment for the others. A part that attaches later gets its own small connection - a connection that is already open (or
 * still connecting) is never closed just to add it - and the next time everything connects again (the tab coming back, a
 * drop) the parts are merged into one again.
 */
(() => {
  const SETTLE_MS = 100; // how long to wait for the other parts before connecting
  const parts = new Map();
  const conns = new Set(); // { source, names: Set of part names it carries }
  let timer = null;
  let delay = 2000; // reconnect back-off after a drop (reset by any message)
  let legacy = false; // this server has no /api/live/stream: every part runs its own connection
  let opens = 0; // consecutive connections that never opened

  function base() {
    return window.FRESHCUTZ_API_BASE || "";
  }

  function drop(conn) {
    if (!conns.delete(conn)) return;
    conn.source.close();
  }

  function closeAll() {
    clearTimeout(timer);
    timer = null;
    for (const conn of [...conns]) drop(conn);
  }

  /** Closes the connection(s) that carry this part (what they were asked for is out of date). */
  function dropCarrying(name) {
    for (const conn of [...conns]) if (conn.names.has(name)) drop(conn);
  }

  function carried(name) {
    for (const conn of conns) if (conn.names.has(name)) return true;
    return false;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(open, ms === undefined ? SETTLE_MS : ms);
  }

  function url(names) {
    const bits = [];
    for (const name of names) {
      try {
        const part = parts.get(name);
        const q = part && part.query && part.query();
        if (q) bits.push(q);
      } catch {
        /* a part that cannot say what it wants just is not asked for */
      }
    }
    return `${base()}/api/live/stream?${bits.join("&")}`;
  }

  /** Connects the parts that no open connection carries yet - all of them in one connection. */
  function open() {
    timer = null;
    if (legacy || !parts.size || document.hidden) return;
    if (!window.EventSource || document.readyState === "loading") return; // (DOMContentLoaded below connects)
    const names = new Set();
    for (const name of parts.keys()) if (!carried(name)) names.add(name);
    if (!names.size) return;
    const link = url(names); // (the parts' queries are asked first: they may note what they sent)
    const source = new EventSource(link);
    const conn = { source, names };
    conns.add(conn);
    let opened = false;
    const events = new Set();
    for (const name of names) for (const event of Object.keys((parts.get(name) || {}).on || {})) events.add(event);
    for (const event of events) {
      // one listener per message name; it is passed to every part of this connection that wants that name
      source.addEventListener(event, (e) => {
        if (!conns.has(conn)) return;
        delay = 2000;
        for (const name of conn.names) {
          const part = parts.get(name);
          const handler = part && part.on && part.on[event];
          if (handler) handler(e);
        }
      });
    }
    source.addEventListener("open", () => {
      if (!conns.has(conn)) return;
      opened = true;
      opens = 0;
      for (const name of conn.names) {
        try {
          const part = parts.get(name);
          if (part && part.open) part.open();
        } catch {
          /* one part's trouble does not touch the others */
        }
      }
    });
    source.addEventListener("error", () => {
      if (!conns.has(conn)) return;
      // The connection dropped (or never came up). Reconnect ourselves - not the browser's automatic retry - so the new
      // connection says what the page holds NOW (the catalog version, the saved look). Whatever was dropped is connected
      // again together, in one connection.
      drop(conn);
      if (document.hidden) return; // coming back to the tab connects again
      if (!opened) {
        opens++;
        if (opens >= 2) {
          // is this server just too old to have the endpoint (-> each part keeps its own connection), or is it only unreachable?
          probe(link).then((status) => {
            if (status === 404 || status === 405) useLegacy();
            else if (!legacy && parts.size && !document.hidden) schedule(delay);
          });
          delay = Math.min(delay * 1.5, 20000);
          return;
        }
      }
      schedule(delay);
      delay = Math.min(delay * 1.5, 20000);
    });
  }

  /** Asks the server for the stream once and reads only the status line. */
  function probe(link) {
    try {
      const controller = new AbortController();
      return fetch(link, { signal: controller.signal, cache: "no-store", headers: { Accept: "text/event-stream" } })
        .then((r) => {
          controller.abort();
          return r.status;
        })
        .catch(() => 0);
    } catch {
      return Promise.resolve(0);
    }
  }

  function useLegacy() {
    if (legacy) return;
    legacy = true;
    closeAll();
    for (const part of parts.values()) startLegacy(part);
  }

  function startLegacy(part) {
    try {
      if (part.legacyStart) part.legacyStart();
    } catch {
      /* ignore */
    }
  }

  function stopLegacy(part) {
    try {
      if (part.legacyStop) part.legacyStop();
    } catch {
      /* ignore */
    }
  }

  window.FreshcutzLive = {
    attach(name, part) {
      const had = parts.get(name);
      if (had && legacy) stopLegacy(had);
      parts.set(name, part);
      if (legacy) startLegacy(part);
      else {
        dropCarrying(name); // (only when this part was already being carried: its connection holds an old query)
        schedule(); // a part nothing carries yet gets a connection of its own; the ones already open are left alone
      }
    },
    detach(name) {
      const part = parts.get(name);
      if (!part) return;
      parts.delete(name);
      if (legacy) stopLegacy(part);
      else {
        for (const conn of [...conns]) {
          let live = false;
          for (const n of conn.names) if (parts.has(n)) live = true;
          if (!live) drop(conn); // nobody on it is listening any more
        }
        if (!parts.size) closeAll();
      }
    },
    restart(name) {
      const part = parts.get(name);
      if (!part) return;
      if (legacy) {
        stopLegacy(part);
        startLegacy(part);
      } else {
        dropCarrying(name);
        schedule(0);
      }
    },
    /** true while the parts share one connection (false: this server is older, each part has its own). */
    shared: () => !legacy,
  };

  // config.js (which defines the API address) loads late in the page: nothing connects before everything has run.
  document.addEventListener("DOMContentLoaded", () => {
    if (parts.size && !legacy) schedule(0);
  });
})();
