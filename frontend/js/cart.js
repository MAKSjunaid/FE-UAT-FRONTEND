/* In-browser cart state, persisted to localStorage so it survives a page
 * refresh. Keyed by `${productId}:${variant}` so 500g and 1kg of the same
 * item are separate lines. */

const Cart = (() => {
  const STORAGE_KEY = "freshcutz_cart_v1";
  let items = load();
  const listeners = [];
  const catalogListeners = []; // fired only when syncWithCatalog actually changes something

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable — cart just won't survive a refresh */
    }
    listeners.forEach((fn) => fn(items));
  }

  function keyOf(productId, variant) {
    return `${productId}:${variant}`;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function onCatalogSync(fn) {
    catalogListeners.push(fn);
  }

  /** Reconciles the cart against the live product catalog (called after
   * every products fetch/poll) — so a price change or an admin disabling
   * a product shows up in the cart without the customer reloading the
   * page. Items that are no longer available (deleted / disabled / that
   * variant removed) are dropped; the rest get their name, image, label
   * and price refreshed to match what's live right now. This never
   * touches orders already placed — those keep their own snapshot. */
  function syncWithCatalog(products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    let changed = false;
    const removedNames = [];
    const kept = [];

    for (const item of items) {
      const product = byId.get(item.productId);
      const isVariant2 = item.variant === "variant2";
      const label = product ? (isVariant2 ? product.variant2Label : product.variant1Label) : null;
      const price = product ? (isVariant2 ? product.variant2Price : product.variant1Price) : null;
      const stillAvailable = product && product.enabled && !product.outOfStock && label != null && price != null;

      if (!stillAvailable) {
        changed = true;
        removedNames.push(item.name);
        continue;
      }
      if (
        item.name !== product.name ||
        item.imageUrl !== product.imageUrl ||
        item.variantLabel !== label ||
        Number(item.unitPrice) !== Number(price)
      ) {
        changed = true;
      }
      kept.push({ ...item, name: product.name, imageUrl: product.imageUrl, variantLabel: label, unitPrice: price });
    }

    if (!changed) return { changed: false, removedNames: [] };
    items = kept;
    persist();
    catalogListeners.forEach((fn) => fn({ removedNames }));
    return { changed: true, removedNames };
  }

  function getItems() {
    return items;
  }

  function findLine(productId, variant) {
    const key = keyOf(productId, variant);
    return items.find((i) => keyOf(i.productId, i.variant) === key);
  }

  function setQuantity(product, variant, quantity) {
    const variantInfo = variant === "variant2"
      ? { label: product.variant2Label, price: product.variant2Price }
      : { label: product.variant1Label, price: product.variant1Price };

    const existing = findLine(product.id, variant);
    if (quantity <= 0) {
      items = items.filter((i) => !(i.productId === product.id && i.variant === variant));
      persist();
      return;
    }

    if (existing) {
      existing.quantity = quantity;
    } else {
      items.push({
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        variant,
        variantLabel: variantInfo.label,
        unitPrice: variantInfo.price,
        quantity,
      });
    }
    persist();
  }

  function quantityOf(productId, variant) {
    const line = findLine(productId, variant);
    return line ? line.quantity : 0;
  }

  function remove(productId, variant) {
    items = items.filter((i) => !(i.productId === productId && i.variant === variant));
    persist();
  }

  function clear() {
    items = [];
    persist();
  }

  function getCount() {
    return items.reduce((sum, i) => sum + i.quantity, 0);
  }

  /** Number of distinct lines in the cart (one product+variant combo = one
   * line) — this is what the cart badge/"items" counters show. Clicking +
   * a few times on the same 500g pack keeps this at 1; adding the 1kg pack
   * or a different product is what bumps it to 2. */
  function getLineCount() {
    return items.length;
  }

  function getTotal() {
    return items.reduce((sum, i) => sum + i.quantity * Number(i.unitPrice), 0);
  }

  function toOrderItems() {
    return items.map((i) => ({
      productId: i.productId,
      variant: i.variant,
      quantity: i.quantity,
    }));
  }

  return {
    onChange,
    onCatalogSync,
    syncWithCatalog,
    getItems,
    setQuantity,
    quantityOf,
    remove,
    clear,
    getCount,
    getLineCount,
    getTotal,
    toOrderItems,
  };
})();
