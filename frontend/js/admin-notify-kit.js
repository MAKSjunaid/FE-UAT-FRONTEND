/* Small shared pieces for the two customer-notification screens (Customize -> Customer notifications, and
 * More -> Push notifications): the emoji palette, "insert at the cursor", and the phone-notification preview. */

window.AdminNotifyKit = (() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Food, delivery and feel-good emojis first: what a chicken shop actually uses.
  const EMOJIS = ["🍗", "🍖", "🥩", "🔥", "🥚", "🍳", "🥘", "🍛", "🌶️", "🍋", "🛵", "🚚", "📦", "🏠", "✅", "❌",
    "😋", "🤤", "😍", "😎", "🤩", "🥳", "🎉", "🎁", "💥", "✨", "⭐", "💯", "👍", "🙏", "❤️", "💛",
    "😭", "😢", "🥲", "😅", "🙈", "😴", "🤝", "👋", "⏰", "🕐", "💸", "🏷️", "🛍️", "📣", "🔔", "💪"];

  /** Puts `text` at the cursor of an <input>/<textarea>, keeps within its maxlength, tells listeners. */
  function insertAtCursor(field, text) {
    if (!field) return false;
    const max = Number(field.getAttribute("maxlength")) || 0;
    if (max && field.value.length + text.length > max) {
      field.classList.add("nk-shake");
      setTimeout(() => field.classList.remove("nk-shake"), 400);
      return false;
    }
    const start = field.selectionStart == null ? field.value.length : field.selectionStart;
    const end = field.selectionEnd == null ? field.value.length : field.selectionEnd;
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    const pos = start + text.length;
    try { field.setSelectionRange(pos, pos); } catch (e) { /* not all inputs allow it */ }
    field.focus();
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  /** The emoji button's pop-over markup (put it inside a position:relative wrapper). */
  function paletteHtml() {
    return `<div class="nk-palette" role="listbox" aria-label="Emoji" hidden>${
      EMOJIS.map((e) => `<button type="button" class="nk-emo" data-emoji="${e}">${e}</button>`).join("")}</div>`;
  }

  /** Wires every [data-nk-emoji] button inside `root`: opens its palette and inserts into the field chosen by
   * pickField(toolsElement), else the one named in data-field (a CSS selector inside root). One document click closes open palettes. */
  function wirePalettes(root, pickField) {
    if (root.__nkWired) return;   // build() can run again; wire once
    root.__nkWired = true;
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-nk-emoji]");
      if (btn) {
        const wrap = btn.closest(".nk-tools");
        const pal = wrap.querySelector(".nk-palette");
        const open = pal.hidden;
        root.querySelectorAll(".nk-palette").forEach((p) => { p.hidden = true; });
        pal.hidden = !open;
        return;
      }
      const emo = e.target.closest(".nk-emo");
      if (emo) {
        const wrap = emo.closest(".nk-tools");
        const field = (pickField && pickField(wrap)) || root.querySelector(wrap.dataset.field);
        insertAtCursor(field, emo.dataset.emoji);
        // the palette stays open so several emojis can be added in a row
        return;
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") root.querySelectorAll(".nk-palette").forEach((p) => { p.hidden = true; });
    });
    document.addEventListener("click", (e) => {
      if (!root.isConnected) return;
      if (e.target.closest(".nk-tools")) return;
      root.querySelectorAll(".nk-palette").forEach((p) => { p.hidden = true; });
    });
  }

  /** How a notification looks on a phone. `title`/`body` are already filled with the sample name. */
  function previewHtml(title, body) {
    return `<div class="nk-phone" aria-label="Preview">
      <img class="nk-phone-ico" src="images/icons/icon-192.png" alt="" />
      <div class="nk-phone-txt">
        <div class="nk-phone-title">${esc(title) || "<i>Title</i>"}</div>
        <div class="nk-phone-body">${esc(body) || "<i>Your message appears here</i>"}</div>
      </div>
    </div>`;
  }

  /** {name} / {code} -> sample values. */
  function fill(text, name, code) {
    return String(text || "").split("{name}").join(name).split("{code}").join(code || "");
  }

  return { esc, insertAtCursor, paletteHtml, wirePalettes, previewHtml, fill };
})();
