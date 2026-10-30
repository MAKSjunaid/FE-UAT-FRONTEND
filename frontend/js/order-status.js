/* What a customer reads as their order's status. The shop's own statuses stay New / Packed / Delivered / Cancelled; the customer
 * website tells it in four steps:
 *   New (the first 5 seconds after it was placed on this phone) -> "Order Placed"
 *   New (after that, nothing the admin has to do)                -> "Confirmed"
 *   Packed                                                       -> "Getting Ready"
 *   Delivered / Cancelled                                        -> as they are
 * Nothing is written anywhere: the 5 seconds are counted on the phone that placed the order (kept in this browser for a day, so
 * a reload within the 5 seconds keeps counting). Orders seen on another phone, or later, simply read "Confirmed". */
window.OrderStatus = (() => {
  const KEY = "freshcutz_placed_at";
  const HOLD_MS = 5000; // how long a new order reads "Order Placed" before it reads "Confirmed"
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LABEL = { placed: "Order Placed", confirmed: "Confirmed", ready: "Getting Ready" };

  let placedAt = {}; // orderCode -> when it was placed here (ms)
  try {
    placedAt = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    placedAt = {};
  }
  const save = () => {
    const now = Date.now();
    Object.keys(placedAt).forEach((k) => {
      if (!(now - placedAt[k] < DAY_MS)) delete placedAt[k];
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(placedAt));
    } catch {
      /* storage unavailable: the order just reads "Confirmed" after a reload */
    }
  };

  /** Tells the screens (Track order strip, My Orders) that this order has moved on from "Order Placed". */
  function schedule(code) {
    const left = placedAt[code] + HOLD_MS - Date.now();
    if (left <= 0) return;
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("freshcutz:orderstage", { detail: { orderCode: code } }));
      } catch {
        /* ignore */
      }
    }, left + 40);
  }

  /** A new order was just placed here: it reads "Order Placed" for the next 5 seconds. */
  function markPlaced(code) {
    if (!code) return;
    placedAt[code] = Date.now();
    save();
    schedule(code);
  }

  /** "placed" | "confirmed" | "ready" | "delivered" | "cancelled" for an order with this status and code. */
  function stage(status, code) {
    if (status === "NEW") return placedAt[code] && Date.now() - placedAt[code] < HOLD_MS ? "placed" : "confirmed";
    if (status === "PACKED") return "ready";
    return String(status || "").toLowerCase();
  }

  /** The words for the badge and the Track order strip ("Delivered" / "Cancelled" keep their own wording). */
  function label(status, code) {
    const st = stage(status, code);
    return LABEL[st] || status;
  }

  Object.keys(placedAt).forEach(schedule); // (the page was reloaded within 5 seconds of placing an order)

  return { markPlaced, stage, label };
})();
