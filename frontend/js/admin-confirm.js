/* A confirmation box in the app's own look (instead of the browser's plain dialog), used before something that is easy to tap by mistake:
 *   const ok = await AdminConfirm.ask({ title, message, confirmText, cancelText, tone });   // tone: "ok" (green), "danger" (red), "gold" (amber) or "teal" (blue-green)
 * Resolves true only when the person taps the confirm button. Backdrop tap, Cancel, Esc and the Back key all mean "no".
 * With `choices: [{value, label, note: "required"|"optional"}]` the box also asks him to pick one (and writes a few words when that choice has a note);
 * it then resolves {value, note} instead of true, and the confirm button waits until a choice is picked. `notePlaceholder` is the hint in the note box.
 * Only one box is open at a time; asking again while one is open answers "no" to the new one. */
window.AdminConfirm = (function () {
  let open = null;
  let styled = false;
  const html = document.documentElement;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function injectStyle() {
    if (styled) return;
    styled = true;
    const st = document.createElement("style");
    st.textContent = `
.acf-back{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;background:rgba(23,20,15,.55);animation:acf-fade .15s ease-out}
.acf-box{width:100%;max-width:420px;margin:auto;padding:22px 20px 18px;background:var(--bg-card,#fff);border-radius:18px;box-shadow:0 18px 48px rgba(23,20,15,.35);font-family:var(--font-body,inherit);color:var(--ink,#17140f);animation:acf-up .18s ease-out}
.acf-ico{width:44px;height:44px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;background:#e9f3e6}
.acf-box.is-danger .acf-ico{background:#fbe4df}
.acf-box.is-gold .acf-ico{background:#fff0c9}
.acf-box.is-teal .acf-ico{background:#d8f1ef}
.acf-box{text-align:center}
.acf-box h3{margin:0 0 6px;font-family:inherit;font-size:18px;font-weight:700;letter-spacing:0;line-height:1.3;overflow-wrap:anywhere}
.acf-box p{margin:0 0 18px;font-family:inherit;font-size:14.5px;font-weight:400;line-height:1.45;color:var(--text-muted,#7a7260);overflow-wrap:anywhere}
.acf-choices{display:grid;gap:8px;margin:0 0 14px;text-align:left}
.acf-ch{display:flex;align-items:center;gap:10px;min-height:46px;padding:0 14px;border:1.5px solid #e3d9bb;border-radius:12px;background:#fff;font-family:inherit;font-size:14.5px;font-weight:600;color:var(--ink,#17140f);text-align:left;cursor:pointer}
.acf-ch::before{content:"";flex:0 0 auto;width:18px;height:18px;border:2px solid #cdbf93;border-radius:50%;box-sizing:border-box}
.acf-ch.is-on{border-color:var(--gold,#c9a13b);background:#fff8e1}
.acf-ch.is-on::before{border-color:#9a7410;background:radial-gradient(circle,#9a7410 0 4px,transparent 5px)}
.acf-note{display:block;width:100%;min-height:64px;margin:0 0 14px;padding:10px 12px;border:1.5px solid #e3d9bb;border-radius:12px;box-sizing:border-box;font-family:inherit;font-size:16px;color:var(--ink,#17140f);resize:none}
.acf-note[hidden]{display:none}
.acf-yes:disabled{opacity:.45;cursor:not-allowed}
.acf-btns{display:flex;gap:10px}
html.acf-lock,html.acf-lock body{overflow:hidden}
.acf-btns button{flex:1 1 0;min-height:48px;padding:0 12px;border-radius:12px;font-family:inherit;font-size:15px;font-weight:600;cursor:pointer}
.acf-no{border:1.5px solid #e3d9bb;background:#fff;color:var(--ink,#17140f)}
.acf-yes{border:0;background:#2f7d32;color:#fff}
.acf-box.is-danger .acf-yes{background:#c0392b}
.acf-box.is-gold .acf-yes{background:var(--gold,#c9a13b);color:#17140f}
.acf-box.is-teal .acf-yes{background:#0e7470}
.acf-btns button:focus-visible{outline:2px solid rgba(23,20,15,.28);outline-offset:2px}
@keyframes acf-fade{from{opacity:0}to{opacity:1}}
@keyframes acf-up{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.acf-back,.acf-box{animation:none}}`;
    document.head.appendChild(st);
  }

  function ask(opts) {
    opts = opts || {};
    if (open) return Promise.resolve(false);
    injectStyle();
    const tone = opts.tone === "danger" || opts.tone === "gold" || opts.tone === "teal" ? opts.tone : "ok";
    const icon = opts.icon || (tone === "danger" ? "⚠️" : tone === "gold" ? "↺" : "✓");
    const choices = Array.isArray(opts.choices) && opts.choices.length ? opts.choices : null;
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "acf-back";
      back.innerHTML = `<div class="acf-box is-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="acfT"${opts.message ? ' aria-describedby="acfM"' : ""}>
        <div class="acf-ico" aria-hidden="true">${esc(icon)}</div>
        <h3 id="acfT">${esc(opts.title || "Are you sure?")}</h3>
        ${opts.message ? `<p id="acfM"${choices ? ' style="margin-bottom:14px"' : ""}>${esc(opts.message)}</p>` : ""}
        ${choices ? `<div class="acf-choices" role="radiogroup" aria-labelledby="acfT">${choices.map((c, i) => `<button type="button" class="acf-ch" role="radio" aria-checked="false" data-i="${i}">${esc(c.label)}</button>`).join("")}</div><textarea class="acf-note" maxlength="160" hidden placeholder="${esc(opts.notePlaceholder || "A few words about what happened")}" aria-label="${esc(opts.notePlaceholder || "Note")}"></textarea>` : ""}
        <div class="acf-btns"><button type="button" class="acf-no">${esc(opts.cancelText || "Cancel")}</button><button type="button" class="acf-yes">${esc(opts.confirmText || "Yes")}</button></div></div>`;
      const prevFocus = document.activeElement;
      let done = false;
      let picked = null;
      const yes = back.querySelector(".acf-yes");
      const noteBox = back.querySelector(".acf-note");
      const sync = () => { // the confirm button waits for a choice (and for the note, when that choice needs one)
        if (!choices) return;
        const c = picked == null ? null : choices[picked];
        back.querySelectorAll(".acf-ch").forEach((b) => { const on = Number(b.dataset.i) === picked; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
        noteBox.hidden = !(c && c.note);
        yes.disabled = !c || (c.note === "required" && noteBox.value.trim().length < 2);
      };
      sync();
      // The phone's keyboard covers the bottom of the screen without telling the page (the page keeps its full height), so the box is kept inside
      // the part of the screen that is really visible (visualViewport) and scrolled to the note field: it is not hidden behind the keyboard,
      // on the first tap too.
      const vv = window.visualViewport;
      const fit = () => {
        if (!vv) return;
        back.style.top = vv.offsetTop + "px";
        back.style.bottom = "auto";
        back.style.height = vv.height + "px";
        if (noteBox && document.activeElement === noteBox) noteBox.scrollIntoView({ block: "center" });
      };
      if (vv && choices) { vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }
      const finish = (answer) => {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("popstate", onPop);
        if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
        html.classList.remove("acf-lock");
        back.remove();
        open = null;
        if (prevFocus && prevFocus.focus && prevFocus.isConnected) { try { prevFocus.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
        resolve(answer);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === "Tab") { // keep the focus inside the box
          const b = back.querySelectorAll("button:not(:disabled)");
          const first = b[0];
          const last = b[b.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      const onPop = () => finish(false);
      back.addEventListener("click", (e) => {
        if (e.target === back) finish(false);
        else if (e.target.closest(".acf-no")) finish(false);
        else if (e.target.closest(".acf-ch")) { picked = Number(e.target.closest(".acf-ch").dataset.i); sync(); if (choices[picked].note) { noteBox.focus(); fit(); setTimeout(fit, 350); } }
        else if (e.target.closest(".acf-yes")) {
          if (!choices) finish(true);
          else if (!yes.disabled) finish({ value: choices[picked].value, note: choices[picked].note ? noteBox.value.trim() : "" });
        }
      });
      if (noteBox) noteBox.addEventListener("input", sync);
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("popstate", onPop);
      document.body.appendChild(back);
      // The page behind must not scroll while the box is open. overflow:hidden does it on desktop and Android; iPhone also needs the touch
      // moves that would drag the page stopped (they are let through only when the box itself has to scroll, e.g. above the keyboard).
      html.classList.add("acf-lock");
      back.addEventListener("touchmove", (e) => { if (back.scrollHeight <= back.clientHeight + 1) e.preventDefault(); }, { passive: false });
      open = { finish };
      back.querySelector(".acf-no").focus({ preventScroll: true }); // the safe choice has the focus
    });
  }

  return { ask };
})();
