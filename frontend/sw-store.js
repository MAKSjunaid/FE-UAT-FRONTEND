/* Service worker for the CUSTOMER website — only used for "tell me when my order is delivered / cancelled"
 * and shop offers. It is registered with its own scope (see js/customer-push.js) so it never mixes with the
 * admin panel's sw.js: a customer's phone can never receive an admin alert.
 *
 * iPhone rule: every push MUST show a notification, so this always does. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

let seq = 0; // makes two messages arriving in the same instant still differ

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "FreshCutz", body: event.data ? event.data.text() : "" };
  }
  const icon = new URL("images/icons/icon-192.png", self.location.href).href;
  event.waitUntil(
    self.registration.showNotification(data.title || "FreshCutz", {
      body: data.body || "",
      icon,
      badge: icon,
      // every message gets its own tag, so a second one (e.g. Cancelled, reopened, Cancelled again) never
      // silently replaces the first
      tag: (data.type || "freshcutz") + "-" + (data.orderId || "x") + "-" + Date.now() + "-" + seq++,
      data,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openShop());
});

async function openShop() {
  const home = new URL("index.html", self.location.href).href;
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of all) {
    // reuse a tab that already has the shop open
    if (c.url && c.url.startsWith(new URL("./", self.location.href).href) && "focus" in c) {
      return c.focus();
    }
  }
  if (self.clients.openWindow) return self.clients.openWindow(home);
}
