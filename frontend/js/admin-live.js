/* The live line to the server (Server-Sent Events): every order change (a new order, Delivered, Cancelled,
 * Reopened) is pushed to this page as one small numbered message, so the Orders lists can be kept current with
 * nothing to fetch. When the line is re-opened it says "the last number I applied" and is sent what it missed.
 *
 * Opened with fetch() instead of EventSource so the normal sign-in header is used (EventSource can't send
 * one, and the token must not go in the web address). It reconnects by itself, and only runs while this
 * tab is visible. It is a convenience on top of the 15-second check in admin-main.js, which stays as the
 * safety net — if the line drops, the order simply turns up on the next check. */

window.AdminLive = (() => {
  const TOKEN_KEY = "freshcutz_admin_token";
  let generation = 0; // bumped on every start/stop, so an old loop never keeps going
  let controller = null;
  let timer = null;
  let delay = 1000;
  let connected = false;
  let everOpened = false;
  let handlers = {};
  let lastData = 0; // when anything (even a keep-alive) last arrived: a silent line is treated as dead
  let watchdog = null;

  const base = () => window.FRESHCUTZ_API_BASE || "";

  function parse(block) {
    let name = "message";
    const data = [];
    block.split("\n").forEach((line) => {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    });
    if (!data.length) return; // a ": ping" keep-alive
    let payload = null;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    if (handlers.onMessage && (name === "order" || name === "status" || name === "payment" || name === "reset")) handlers.onMessage(name, payload);
  }

  function retry(gen) {
    if (gen !== generation) return;
    clearTimeout(timer);
    timer = setTimeout(() => run(gen), delay);
    delay = Math.min(delay * 2, 30000);
  }

  async function run(gen) {
    if (gen !== generation) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    controller = new AbortController();
    let res;
    try {
      const since = handlers.getSince ? handlers.getSince() : null;
      res = await fetch(`${base()}/api/admin/orders/stream${since != null ? `?since=${since}` : ""}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return retry(gen);
    }
    // Not signed in / no Orders access: nothing to retry — the normal check deals with a sign-out.
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok || !res.body) return retry(gen);
    if (!(res.headers.get("content-type") || "").includes("text/event-stream")) return retry(gen); // not the live line (an older server)

    delay = 1000;
    connected = true;
    const isReconnect = everOpened;
    everOpened = true;
    if (handlers.onOpen) handlers.onOpen(isReconnect);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    lastData = Date.now();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || gen !== generation) break;
        lastData = Date.now();
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          parse(block);
        }
      }
    } catch {
      /* the line dropped */
    }
    connected = false;
    retry(gen);
  }

  /** handlers: { onMessage(type, message), onOpen(isReconnect), getSince() } */
  function start(h) {
    stop();
    handlers = h || {};
    everOpened = false;
    const gen = generation;
    delay = 1000;
    run(gen);
    // The server sends a keep-alive every 20 s; 50 s of nothing means the line died silently (a phone that went
    // to sleep, a proxy that dropped it) — cut it and reconnect, which also catches up on anything missed.
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (connected && Date.now() - lastData > 50000 && controller) controller.abort();
    }, 10000);
  }

  function stop() {
    generation++;
    clearTimeout(timer);
    clearInterval(watchdog);
    if (controller) controller.abort();
    controller = null;
    connected = false;
  }

  return { start, stop, isConnected: () => connected };
})();
