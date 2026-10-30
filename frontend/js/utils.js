/* Small shared helpers used by both the storefront and admin scripts. */

const Utils = (() => {
  const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  function formatMoney(value) {
    const num = Number(value || 0);
    return currencyFormatter.format(num);
  }

  function formatDateTime(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function discountPercent(price, mrp) {
    const p = Number(price);
    const m = Number(mrp);
    if (!m || m <= p) return 0;
    return Math.round(((m - p) / m) * 100);
  }

  function resolveImageUrl(imageUrl) {
    if (!imageUrl) return "";
    if (imageUrl.startsWith("http")) return imageUrl;
    return `${window.FRESHCUTZ_API_BASE}${imageUrl}`;
  }

  /** The ~25 KB card-size copy of a product photo (the customer website's product cards and cart use this instead
   * of the full-size original). Photos that aren't served by this backend (old disk paths) are left as they are. */
  function mediumImageUrl(imageUrl) {
    const url = resolveImageUrl(imageUrl);
    if (!url.includes("/api/products/") || !url.includes("/image") || /[?&]s=/.test(url)) return url;
    return url + (url.includes("?") ? "&" : "?") + "s=m";
  }

  function validatePhone(value) {
    const digits = (value || "").replace(/\D/g, "");
    return digits.length >= 10;
  }

  /** Digits only, everything else (spaces, dashes, +91, brackets...)
   * stripped out. Used everywhere a phone number is saved or looked up,
   * so "9876543210" and "+91 98765-43210" are treated as the same
   * customer instead of two different strings that happen to fail to
   * match each other. */
  function normalizePhone(value) {
    return (value || "").replace(/\D/g, "");
  }

  // ---- "Building name / Address": catches made-up text such as "xyz", "abcd", "asdf", "test" or "aaaa" ----------------------------
  const JUNK_WORDS = new Set([
    "xyz", "xyzz", "abc", "abcd", "abcde", "abcdef", "abcdefg", "asd", "asdf", "asdfg", "asdfgh", "asdfghj", "asdfghjkl", "sdf", "dfg", "fgh", "ghj", "ghjk",
    "qwe", "qwer", "qwert", "qwerty", "qwertyu", "qwertyuiop", "qaz", "wsx", "zxc", "zxcv", "zxcvb", "zxcvbn", "zxcvbnm",
    "test", "tests", "testing", "tester", "tst", "tet", "demo", "dummy", "fake", "sample", "example", "random", "rubbish", "junk", "garbage", "nonsense",
    "na", "nil", "none", "null", "nothing", "nope", "idk", "hmm", "lol", "hello", "hi", "hey", "okay", "ok", "yes", "no", "address", "xxx", "yyy", "zzz",
  ]);
  const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz"];

  function isJunkWord(t) {
    if (JUNK_WORDS.has(t)) return true;
    if (t.length >= 3 && t.split("").every((c) => c === t[0])) return true; // aaaa, 1111
    for (const unit of [2, 3]) { // xyxyxy, abcabc
      const min = unit === 2 ? 4 : 6;
      if (t.length >= min && t.length % unit === 0 && t === t.slice(0, unit).repeat(t.length / unit)) return true;
    }
    if (t.length >= 4) {
      const rev = t.split("").reverse().join("");
      if (KEY_ROWS.some((row) => row.includes(t) || row.includes(rev))) return true; // abcd, 1234, asdf, wxyz, dcba
    }
    return false;
  }

  /** True when the address is clearly made up: fewer than 3 letters/digits, or every word in it is junk ("xyz", "abcd asdf", "aaaa").
   * A real word next to a junk one passes ("Test Block B"): only an address with nothing real in it is turned down. */
  function isJunkAddress(value) {
    const text = String(value || "").toLowerCase();
    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.join("").length < 3) return true;
    return words.every(isJunkWord) || isJunkWord(words.join("")); // ("x y z", "a s d f": spaced out letters)
  }

  const JUNK_ADDRESS_MESSAGE = "That doesn't look like a real address. Please enter your building name and street so we can find you.";

  return {
    isJunkAddress,
    JUNK_ADDRESS_MESSAGE,
    formatMoney,
    formatDateTime,
    debounce,
    escapeHtml,
    discountPercent,
    resolveImageUrl,
    mediumImageUrl,
    validatePhone,
    normalizePhone,
  };
})();
