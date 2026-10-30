/**
 * ONE setting you need to touch: where the FreshCutz backend is running.
 *
 * - Testing on your own laptop (backend started with `mvn spring-boot:run`)?
 *   Leave this as http://localhost:8080
 * - Deployed the backend somewhere (Render, Railway, a VPS, etc.)?
 *   Replace it with that URL, e.g. "https://freshcutz-api.onrender.com"
 *   (no trailing slash).
 */
window.FRESHCUTZ_API_BASE = "http://localhost:8080";

/** WhatsApp number shown around the site, in international format. */
window.FRESHCUTZ_WHATSAPP = "+91 97048 90039";
