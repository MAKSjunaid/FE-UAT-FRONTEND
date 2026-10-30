/* Service worker for FreshCutz Admin — handles Web Push notifications.
 * Registered only from admin.html (see admin-push.js); the customer
 * storefront never registers this, so customers are never asked to
 * allow notifications. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "FreshCutz Admin", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(handlePush(data));
});

/** "Order delivered" / "Order packed" is something the admin just did themselves from this
 * same panel, so skip the popup if a tab has the site open and visible —
 * no need to tell them something they already just watched happen. A new
 * order always shows regardless, since that's the one thing they must
 * not miss, whether the site is open or not. */
async function handlePush(data) {
  // Tell any open admin page to refresh itself right away (it no longer polls
  // the server every few seconds — see admin-main.js).
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  open.forEach((c) => c.postMessage({ type: "freshcutz-push", kind: data.type }));

  if (data.type === "order-delivered" || data.type === "order-packed" || data.type === "order-cancelled") {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const siteIsOpen = clients.some((c) => c.visibilityState === "visible");
    // iPhone requires EVERY push to show a notification — skipping one can
    // get the whole subscription cancelled — so only skip on other devices.
    const isIos = /iphone|ipad|ipod/i.test(self.navigator.userAgent || "");
    if (siteIsOpen && !isIos) return;
  }

  await self.registration.showNotification(data.title || "FreshCutz Admin", {
    body: data.body || "",
    icon: "images/logo.jpg",
    badge: "images/logo.jpg",
    // one tag PER ORDER: a shared tag makes a new order silently replace the
    // previous notification on the phone instead of alerting again.
    tag: (data.type || "freshcutz") + "-" + (data.orderId || Date.now()),
    data,
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusAdmin());
});

async function focusAdmin() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = clients.find((c) => c.url.includes("admin.html"));
  if (existing) {
    existing.focus();
  } else {
    self.clients.openWindow("admin.html");
  }
}
