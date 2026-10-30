/* "No internet" strip for the customer page.
 *
 *  - The phone loses its connection  -> a thin red line at the top: "No internet connection ...".
 *  - The connection comes back       -> the line turns green: "Back online ...", and a few seconds later it is gone.
 *
 * It only listens to the browser's own online/offline signals - it makes no request of its own. The strip is already in the
 * page (#netBar); showing it adds the class html.net-on, which makes room for it above the header (see storefront-header.css). */
(() => {
  const bar = document.getElementById("netBar");
  const text = document.getElementById("netBarText");
  if (!bar || !text) return;
  const root = document.documentElement;

  const OFFLINE_TEXT = "No internet connection. Please check your network and try again.";
  const BACK_TEXT = "Back online — connected to the internet";
  const BACK_SHOWN_MS = 3000;

  let timer = null;
  let shown = false;

  function show(isBack) {
    clearTimeout(timer);
    text.textContent = isBack ? BACK_TEXT : OFFLINE_TEXT;
    bar.classList.toggle("is-back", isBack);
    bar.hidden = false;
    root.classList.add("net-on");
    shown = true;
    fit();
  }

  /** The sentence is long: on a narrow phone it first gets a little smaller, and only if it still does not fit on one line it
   * goes on two lines (the strip is then taller; the header follows because everything is measured from --net-line). */
  function fit() {
    bar.classList.remove("is-wrap");
    root.style.removeProperty("--net-line");
    text.style.fontSize = "";
    let size = 12;
    while (text.scrollWidth > text.clientWidth + 1 && size > 10.5) {
      size -= 0.5;
      text.style.fontSize = size + "px";
    }
    if (text.scrollWidth > text.clientWidth + 1) {
      text.style.fontSize = "11.5px";
      bar.classList.add("is-wrap");
      root.style.setProperty("--net-line", "34px");
    }
  }

  function hide() {
    clearTimeout(timer);
    bar.hidden = true;
    bar.classList.remove("is-back", "is-wrap");
    root.style.removeProperty("--net-line");
    root.classList.remove("net-on");
    shown = false;
  }

  function offline() {
    show(false);
  }

  function online() {
    if (!shown) return; // it was never reported as gone: nothing to announce
    show(true);
    timer = setTimeout(hide, BACK_SHOWN_MS);
  }

  window.addEventListener("resize", () => { if (shown) fit(); });
  window.addEventListener("offline", offline);
  window.addEventListener("online", online);
  // the page opened (or came back from the background) while there was no connection
  if (navigator.onLine === false) offline();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (navigator.onLine === false) offline();
    else if (shown && !bar.classList.contains("is-back")) online();
  });
})();
