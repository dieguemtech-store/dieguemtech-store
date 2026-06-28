let products = [];

let cart = JSON.parse(localStorage.getItem("dt-cart") || "[]");
let wishlist = JSON.parse(localStorage.getItem("dt-wishlist") || "[]");
let activeFilter = "Tous";
let visibleCount = 8;

const orderStatuses = {
  pending: "En attente",
  paid: "Payee",
  preparing: "En preparation",
  shipped: "Expediee",
  delivered: "Livree",
  cancelled: "Annulee"
};

const paymentStatuses = {
  pending: "En attente",
  paid: "Paye",
  failed: "Echoue",
  refunded: "Rembourse"
};

const deliveryOptions = {
  Dakar: { label: "Dakar", fee: 1500 },
  Pikine: { label: "Pikine", fee: 2000 },
  Guediawaye: { label: "Guediawaye", fee: 2000 },
  Rufisque: { label: "Rufisque", fee: 2500 },
  Thies: { label: "Thies", fee: 4000 },
  Mbour: { label: "Mbour", fee: 4000 },
  "Autre zone Senegal": { label: "Autre zone au Senegal", fee: 5000 }
};
const PAYDUNYA_MINIMUM_AMOUNT = 6000;
const CASH_ON_DELIVERY_PROVIDER = "Paiement livraison";
const WAVE_PROVIDER = "Wave";
const WAVE_PAYMENT_URL = "https://pay.wave.com/m/M_sn_Y0u8_bUZ_dN-/c/sn/";
const paymentGuides = {
  PayDunya: {
    title: "Paiement en ligne securise",
    text: "Apres confirmation, vous serez redirige vers PayDunya pour payer. L'email de commande part seulement apres confirmation du paiement.",
    steps: ["Verifiez le total", "Validez la commande", "Payez sur PayDunya"]
  },
  [WAVE_PROVIDER]: {
    title: "Paiement Wave manuel",
    text: "La commande est enregistree, puis le bouton Wave s'affiche. Payez avec Wave et envoyez la preuve au support WhatsApp.",
    steps: ["Creez la commande", "Payez avec Wave", "Envoyez la preuve"]
  },
  [CASH_ON_DELIVERY_PROVIDER]: {
    title: "Paiement a la livraison",
    text: "Notre equipe confirme le stock et la livraison. L'email de commande part apres validation du paiement.",
    steps: ["Commande enregistree", "Confirmation WhatsApp", "Paiement a la reception"]
  }
};

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const formatPrice = value => `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
}[character]));
const ANALYTICS_SESSION_KEY = "dt-analytics-session";
let marketingConfig = null;
let marketingTrackingReady = false;

function getAnalyticsSessionId(){
  let sessionId = sessionStorage.getItem(ANALYTICS_SESSION_KEY);
  if (!sessionId) {
    sessionId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(ANALYTICS_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function trackAnalytics(eventName, data = {}){
  try {
    const payload = {
      eventName,
      path: `${window.location.pathname}${window.location.search}`,
      referrer: document.referrer,
      sessionId: getAnalyticsSessionId(),
      ...data,
      metadata: data.metadata || {}
    };
    trackMarketingEvent(payload);
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
      if (sent) return;
    }
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  } catch (error) {
    // Analytics should never interrupt a customer action.
  }
}

function trackProductAnalytics(eventName, product, extra = {}){
  if (!product) return;
  trackAnalytics(eventName, {
    productId: product.id,
    productName: product.name,
    category: product.category,
    value: extra.value ?? product.price ?? 0,
    metadata: {
      subcategory: product.subcategory || "",
      ...extra.metadata
    }
  });
}

async function initializeMarketingTracking(){
  try {
    const response = await fetch("/api/marketing/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Configuration marketing indisponible.");
    marketingConfig = await response.json();
    loadMetaPixel(marketingConfig.metaPixelId);
    loadTikTokPixel(marketingConfig.tiktokPixelId);
    loadGoogleMarketing(marketingConfig);
    marketingTrackingReady = true;
  } catch (error) {
    marketingConfig = { configured: {} };
    marketingTrackingReady = false;
  }
}

function loadMetaPixel(pixelId){
  if (!pixelId || window.fbq) return;
  window.fbq = function(){ window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments); };
  if (!window._fbq) window._fbq = window.fbq;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = "2.0";
  window.fbq.queue = [];
  insertMarketingScript("https://connect.facebook.net/en_US/fbevents.js");
  window.fbq("init", pixelId);
}

function loadTikTokPixel(pixelId){
  if (!pixelId || window.ttq) return;
  window.TiktokAnalyticsObject = "ttq";
  const ttq = window.ttq = window.ttq || [];
  ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
  ttq.setAndDefer = function(target, method){
    target[method] = function(){
      target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
    };
  };
  ttq.methods.forEach(method => ttq.setAndDefer(ttq, method));
  ttq.load = function(id){
    ttq._i = ttq._i || {};
    ttq._i[id] = [];
    ttq._i[id]._u = "https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._t = ttq._t || {};
    ttq._t[id] = Date.now();
    ttq._o = ttq._o || {};
    ttq._o[id] = {};
    insertMarketingScript("https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=" + encodeURIComponent(id) + "&lib=ttq");
  };
  ttq.load(pixelId);
}

function loadGoogleMarketing(config = {}){
  window.dataLayer = window.dataLayer || [];
  if (config.googleTagManagerId && !window.dtGtmLoaded) {
    window.dtGtmLoaded = true;
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    insertMarketingScript("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(config.googleTagManagerId));
  }
  if (config.googleAdsId && !window.dtGoogleAdsLoaded) {
    window.dtGoogleAdsLoaded = true;
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    insertMarketingScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(config.googleAdsId));
    window.gtag("js", new Date());
    window.gtag("config", config.googleAdsId);
  }
}

function insertMarketingScript(src){
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  const firstScript = document.getElementsByTagName("script")[0];
  firstScript?.parentNode ? firstScript.parentNode.insertBefore(script, firstScript) : document.head.appendChild(script);
}

function trackMarketingEvent(payload){
  if (!marketingTrackingReady || !marketingConfig) return;
  const mapped = mapMarketingEvent(payload);
  if (!mapped) return;
  const data = buildMarketingEventData(payload);

  if (marketingConfig.metaPixelId && window.fbq && mapped.meta) {
    window.fbq("track", mapped.meta, data.meta);
  }
  if (marketingConfig.tiktokPixelId && window.ttq && mapped.tiktok) {
    if (payload.eventName === "page_view" && typeof window.ttq.page === "function") {
      window.ttq.page();
    } else {
      window.ttq.track(mapped.tiktok, data.tiktok);
    }
  }
  if (window.dataLayer) {
    window.dataLayer.push({ event: `dt_${payload.eventName}`, ...data.gtm });
  }
  if (marketingConfig.googleAdsId && window.gtag && mapped.google) {
    window.gtag("event", mapped.google, data.google);
  }
  if (payload.eventName === "order_created" && marketingConfig.googleAdsId && marketingConfig.googleAdsLeadLabel && window.gtag) {
    window.gtag("event", "conversion", {
      send_to: `${marketingConfig.googleAdsId}/${marketingConfig.googleAdsLeadLabel}`,
      value: data.google.value || 0,
      currency: "XOF",
      transaction_id: payload.metadata?.orderId || ""
    });
  }
}

function mapMarketingEvent(payload){
  return {
    page_view: { meta: "PageView", tiktok: "PageView", google: "page_view" },
    product_view: { meta: "ViewContent", tiktok: "ViewContent", google: "view_item" },
    search: { meta: "Search", tiktok: "Search", google: "search" },
    add_to_cart: { meta: "AddToCart", tiktok: "AddToCart", google: "add_to_cart" },
    wishlist_toggle: { meta: "AddToWishlist", tiktok: "AddToWishlist", google: "add_to_wishlist" },
    checkout_open: { meta: "InitiateCheckout", tiktok: "InitiateCheckout", google: "begin_checkout" },
    checkout_submit: { meta: "InitiateCheckout", tiktok: "InitiateCheckout", google: "begin_checkout" },
    order_created: { meta: "Lead", tiktok: "SubmitForm", google: "generate_lead" }
  }[payload.eventName];
}

function buildMarketingEventData(payload){
  const metadata = payload.metadata || {};
  const value = Number(payload.value || 0);
  const productId = payload.productId ? String(payload.productId) : undefined;
  const items = productId ? [{
    item_id: productId,
    item_name: payload.productName || "",
    item_category: payload.category || "",
    price: value || undefined,
    quantity: Number(metadata.quantity || metadata.itemCount || 1)
  }] : [];
  const common = {
    value,
    currency: "XOF",
    content_ids: productId ? [productId] : undefined,
    content_name: payload.productName || metadata.query || document.title,
    content_category: payload.category || "",
    search_string: metadata.query || "",
    num_items: Number(metadata.itemCount || metadata.quantity || 0) || undefined,
    order_id: metadata.orderId || ""
  };
  return {
    meta: common,
    tiktok: {
      content_id: productId,
      content_name: common.content_name,
      content_category: common.content_category,
      value,
      currency: "XOF",
      query: metadata.query || ""
    },
    google: {
      value,
      currency: "XOF",
      search_term: metadata.query || "",
      transaction_id: metadata.orderId || "",
      items
    },
    gtm: {
      event_name: payload.eventName,
      value,
      currency: "XOF",
      product_id: productId || "",
      product_name: payload.productName || "",
      category: payload.category || "",
      query: metadata.query || "",
      order_id: metadata.orderId || "",
      item_count: Number(metadata.itemCount || metadata.quantity || 0) || 0
    }
  };
}

function slugify(value){
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "produit";
}

function productUrl(product){
  return `/produit/${product.id}/${slugify(product.name)}`;
}

function getProductDescription(product){
  return product.description || "Produit selectionne par DieguemTech Store pour offrir un bon rapport qualite-prix et une experience fiable au quotidien.";
}

function getProductImages(product){
  const candidates = [];
  if (product.image) candidates.push(product.image);
  if (Array.isArray(product.images)) candidates.push(...product.images);
  return [...new Set(
    candidates
      .map(image => String(image || "").trim())
      .filter(Boolean)
  )].slice(0, 8);
}

function getProductMainImage(product){
  return getProductImages(product)[0] || "";
}

function formatPaymentProviderLabel(provider){
  const value = String(provider || "").trim();
  if (value === CASH_ON_DELIVERY_PROVIDER) return "Paiement a la livraison";
  if (value === WAVE_PROVIDER) return "Wave";
  return value || "A confirmer";
}

function getProductCategoryLabel(product){
  return product.subcategory ? `${product.category} / ${product.subcategory}` : product.category;
}

function sortProductsForStore(list){
  return [...list].sort((left, right) => Number(right.featured === true) - Number(left.featured === true) || Number(left.id || 0) - Number(right.id || 0));
}

function productVisual(product, className = "product-emoji"){
  const image = getProductMainImage(product);
  if (image) {
    return `<img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">`;
  }
  return `<span class="${className}">${product.emoji}</span>`;
}

function productCard(product){
  const liked = wishlist.includes(product.id);
  const badgeClass = product.badge.includes("%") ? "discount-badge" : "new-badge";
  const description = getProductDescription(product);
  return `<article class="product-card" data-product-page-card="${productUrl(product)}" data-product-id="${product.id}" tabindex="0" role="link" aria-label="Ouvrir la page de ${escapeHtml(product.name)}">
    <div class="product-visual">
      <span class="${badgeClass}">${escapeHtml(product.badge)}</span>
      ${product.featured === true ? `<span class="featured-badge">Vedette</span>` : ""}
      <button class="wishlist-toggle ${liked ? "active" : ""}" data-wishlist="${product.id}" aria-label="Ajouter aux favoris">
        <svg><use href="#icon-heart"></use></svg>
      </button>
      ${productVisual(product)}
    </div>
    <div class="product-info">
      <span class="product-category">${escapeHtml(getProductCategoryLabel(product))}</span>
      <h3 title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
      <p class="product-description">${escapeHtml(description)}</p>
      <div class="product-rating"><span class="stars">★★★★★</span> ${product.rating} (${product.reviews})</div>
      <div class="product-bottom">
        <span class="price"><strong>${formatPrice(product.price)}</strong>${product.oldPrice ? `<del>${formatPrice(product.oldPrice)}</del>` : ""}</span>
        <div class="product-actions">
          <a class="product-page-link" href="${productUrl(product)}" data-product-page data-product-id="${product.id}" aria-label="Voir la page de ${escapeHtml(product.name)}">Voir</a>
          <button class="add-cart" data-cart="${product.id}" aria-label="Ajouter ${escapeHtml(product.name)} au panier"><svg><use href="#icon-cart"></use></svg></button>
        </div>
      </div>
    </div>
  </article>`;
}

function renderProducts(search = ""){
  const query = search.trim().toLowerCase();
  const filtered = products.filter(product => {
    const matchesCategory = activeFilter === "Tous" || product.category === activeFilter;
    const matchesSearch = !query || `${product.name} ${product.category} ${product.subcategory || ""} ${getProductDescription(product)}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  $("#productsGrid").innerHTML = sortProductsForStore(filtered).slice(0, visibleCount).map(productCard).join("");
  $("#emptyState").style.display = filtered.length ? "none" : "block";
  $("#showAllProducts").style.display = filtered.length > visibleCount ? "inline-flex" : "none";
}

function updateSearchUrl(query){
  const url = new URL(window.location.href);
  const cleanQuery = String(query || "").trim();
  if (cleanQuery) {
    url.searchParams.set("q", cleanQuery);
  } else {
    url.searchParams.delete("q");
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function persist(){
  localStorage.setItem("dt-cart", JSON.stringify(cart));
  localStorage.setItem("dt-wishlist", JSON.stringify(wishlist));
  $("#cartCount").textContent = cart.reduce((sum, item) => sum + item.qty, 0);
  $("#wishlistCount").textContent = wishlist.length;
}

function showToast(title = "Produit ajouté", text = "Votre panier a été mis à jour."){
  const toast = $("#toast");
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = text;
  toast.classList.add("active");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("active"), 2600);
}

function addToCart(id){
  const product = products.find(entry => entry.id === id);
  if (!product) return;
  const item = cart.find(entry => entry.id === id);
  item ? item.qty++ : cart.push({ id, qty: 1 });
  persist();
  renderCart();
  showToast("Produit ajouté", `${product.name} est dans votre panier.`);
  trackProductAnalytics("add_to_cart", product, {
    value: product.price,
    metadata: { quantity: cart.find(entry => entry.id === id)?.qty || 1 }
  });
}

function toggleWishlist(id){
  const product = products.find(entry => entry.id === id);
  const wasInWishlist = wishlist.includes(id);
  wishlist = wishlist.includes(id) ? wishlist.filter(item => item !== id) : [...wishlist, id];
  persist();
  renderProducts($("#searchInput").value);
  renderWishlist();
  showToast(
    wishlist.includes(id) ? "Ajouté aux favoris" : "Retiré des favoris",
    wishlist.includes(id) ? "Vous pourrez le retrouver facilement." : "Votre liste de souhaits a été mise à jour."
  );
  if (product) {
    trackProductAnalytics("wishlist_toggle", product, {
      metadata: { action: wasInWishlist ? "remove" : "add" }
    });
  }
}

function cartItemVisual(product){
  const image = getProductMainImage(product);
  if (image) {
    return `<img class="drawer-item-image" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">`;
  }
  return product.emoji;
}

function renderCart(){
  const container = $("#cartItems");
  if (!cart.length) {
    container.innerHTML = `<div class="empty-drawer"><span>🛒</span><h3>Votre panier est vide</h3><p>Découvrez nos produits et trouvez votre prochain coup de cœur tech.</p></div>`;
    $("#cartFooter").style.display = "none";
    renderCheckoutSummary();
    return;
  }
  $("#cartFooter").style.display = "block";
  container.innerHTML = cart.map(entry => {
    const product = products.find(item => item.id === entry.id);
    if (!product) return "";
    return `<div class="drawer-item">
      <div class="drawer-item-visual">${cartItemVisual(product)}</div>
      <div>
        <h4>${escapeHtml(product.name)}</h4>
        <strong>${formatPrice(product.price)}</strong>
        <div class="quantity">
          <button data-qty="${product.id}" data-delta="-1">−</button>
          <span>${entry.qty}</span>
          <button data-qty="${product.id}" data-delta="1">+</button>
        </div>
      </div>
      <button class="remove-item" data-remove="${product.id}">×</button>
    </div>`;
  }).join("");
  const total = cart.reduce((sum, entry) => {
    const product = products.find(item => item.id === entry.id);
    return product ? sum + product.price * entry.qty : sum;
  }, 0);
  $("#cartTotal").textContent = formatPrice(total);
  if ($("#checkoutTotal")) $("#checkoutTotal").textContent = formatPrice(total);
  renderCheckoutSummary();
}

function getCartDetails(){
  const items = cart
    .map(entry => {
      const product = products.find(item => item.id === entry.id);
      if (!product) return null;
      const quantity = Number(entry.qty || 0);
      return {
        product,
        quantity,
        lineTotal: Number(product.price || 0) * quantity
      };
    })
    .filter(Boolean);
  return {
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    count: items.reduce((sum, item) => sum + item.quantity, 0)
  };
}

function getDeliveryOption(zone){
  return deliveryOptions[String(zone || "").trim()] || null;
}

function getSelectedDeliveryOption(){
  const select = $("#checkoutForm select[name='deliveryZone']");
  return getDeliveryOption(select?.value);
}

function getSelectedPaymentProvider(){
  return $(".payment-options button.selected")?.dataset.payment || "PayDunya";
}

function renderPaymentGuide(total){
  const provider = getSelectedPaymentProvider();
  const guide = paymentGuides[provider] || paymentGuides.PayDunya;
  const guideBox = $("#paymentGuide");
  const paymentLabel = $("#checkoutPaymentMethod");
  if (paymentLabel) paymentLabel.textContent = formatPaymentProviderLabel(provider);
  if (!guideBox) return;
  const minimumText = provider === "PayDunya" && total > 0 && total < PAYDUNYA_MINIMUM_AMOUNT
    ? `<p class="payment-guide-alert">PayDunya est disponible a partir de ${formatPrice(PAYDUNYA_MINIMUM_AMOUNT)}. Pour ce panier, choisissez Wave, A la livraison ou WhatsApp.</p>`
    : "";
  guideBox.innerHTML = `
    <strong>${escapeHtml(guide.title)}</strong>
    <p>${escapeHtml(guide.text)}</p>
    <div>
      ${guide.steps.map((step, index) => `<span><b>${index + 1}</b>${escapeHtml(step)}</span>`).join("")}
    </div>
    ${minimumText}
  `;
}

function renderCheckoutSummary(){
  const itemsBox = $("#checkoutItems");
  if (!itemsBox) return;
  const details = getCartDetails();
  const delivery = getSelectedDeliveryOption();
  const deliveryFee = delivery ? delivery.fee : 0;
  const total = details.total + deliveryFee;
  const label = `${details.count} article${details.count > 1 ? "s" : ""}`;
  $("#checkoutItemCount").textContent = label;
  $("#checkoutSubtotal").textContent = formatPrice(details.total);
  $("#checkoutDeliveryLabel").textContent = delivery ? `Livraison ${delivery.label}` : "Livraison";
  $("#checkoutDeliveryFee").textContent = delivery ? formatPrice(deliveryFee) : "Choisir zone";
  $("#checkoutGrandTotal").textContent = formatPrice(total);
  if ($("#checkoutTotal")) $("#checkoutTotal").textContent = formatPrice(total);
  renderPaymentGuide(total);
  const minimumNotice = $("#paydunyaMinimumNotice");
  if (minimumNotice) {
    const showMinimumNotice = total > 0 && total < PAYDUNYA_MINIMUM_AMOUNT;
    minimumNotice.classList.toggle("active", showMinimumNotice);
    minimumNotice.innerHTML = showMinimumNotice
      ? `Commande inferieure a ${formatPrice(PAYDUNYA_MINIMUM_AMOUNT)} : choisissez <strong>Wave</strong>, <strong>A la livraison</strong> ou commandez directement sur <a href="https://wa.me/221772177176?text=${encodeURIComponent("Bonjour DieguemTech Store, je veux commander un produit de moins de 6000 FCFA.")}" target="_blank" rel="noopener">WhatsApp</a>. PayDunya reste disponible a partir de ${formatPrice(PAYDUNYA_MINIMUM_AMOUNT)}. Total actuel : ${formatPrice(total)}.`
      : "";
  }
  itemsBox.innerHTML = details.items.length
    ? details.items.map(({ product, quantity, lineTotal }) => `<div class="checkout-item">
        <div class="checkout-item-visual">${cartItemVisual(product)}</div>
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <span>${quantity} x ${formatPrice(product.price)}</span>
        </div>
        <b>${formatPrice(lineTotal)}</b>
      </div>`).join("")
    : `<p class="checkout-empty">Votre panier est vide.</p>`;
}

function renderWishlist(){
  const container = $("#wishlistItems");
  if (!wishlist.length) {
    container.innerHTML = `<div class="empty-drawer"><span>♡</span><h3>Aucun favori pour le moment</h3><p>Cliquez sur le cœur d'un produit pour le garder sous la main.</p></div>`;
    return;
  }
  container.innerHTML = wishlist.map(id => {
    const product = products.find(entry => entry.id === id);
    if (!product) return "";
    return `<div class="drawer-item">
      <div class="drawer-item-visual">${cartItemVisual(product)}</div>
      <div>
        <h4>${escapeHtml(product.name)}</h4>
        <strong>${formatPrice(product.price)}</strong><br>
        <button class="wishlist-add" data-cart="${product.id}">Ajouter au panier</button>
      </div>
      <button class="remove-item" data-wishlist="${product.id}">×</button>
    </div>`;
  }).join("");
}

function openDrawer(drawer){
  closeAll();
  drawer.classList.add("active");
  drawer.setAttribute("aria-hidden", "false");
  $("#overlay").classList.add("active");
  document.body.classList.add("no-scroll");
}

function closeAll(){
  $$(".drawer,.modal").forEach(element => {
    element.classList.remove("active");
    element.setAttribute("aria-hidden", "true");
  });
  $("#overlay").classList.remove("active");
  document.body.classList.remove("no-scroll");
}

function productDetailVisual(product){
  const images = getProductImages(product);
  if (!images.length) {
    return `<div class="product-detail-visual">${productVisual(product, "product-detail-emoji")}</div>`;
  }
  return `<div class="product-detail-visual">
    <div class="product-detail-gallery">
      <div class="product-detail-main">
        <img class="product-image" id="productDetailMainImage" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.name)}">
      </div>
      ${images.length > 1 ? `<div class="product-detail-thumbs" aria-label="Images du produit">
        ${images.map((image, index) => `<button type="button" class="product-detail-thumb ${index === 0 ? "active" : ""}" data-detail-image="${escapeHtml(image)}" aria-label="Afficher image ${index + 1}">
          <img src="${escapeHtml(image)}" alt="" loading="lazy">
        </button>`).join("")}
      </div>` : ""}
    </div>
  </div>`;
}

function openProductDetail(id){
  const product = products.find(entry => entry.id === Number(id));
  if (!product) return;
  trackProductAnalytics("product_view", product, {
    metadata: { source: "modal" }
  });
  $("#productDetailContent").innerHTML = `
    ${productDetailVisual(product)}
    <div class="product-detail-info">
      <span class="eyebrow">${escapeHtml(getProductCategoryLabel(product))}</span>
      <h2>${escapeHtml(product.name)}</h2>
      <div class="product-detail-rating"><span class="stars">★★★★★</span> ${product.rating} (${product.reviews} avis)</div>
      <p>${escapeHtml(getProductDescription(product))}</p>
      <div class="product-detail-meta">
        <span>Stock disponible : <strong>${product.stock}</strong></span>
        <span>Livraison rapide a Dakar</span>
        <span>Paiement en ligne ou a la livraison</span>
      </div>
      <div class="product-detail-bottom">
        <span class="price"><strong>${formatPrice(product.price)}</strong>${product.oldPrice ? `<del>${formatPrice(product.oldPrice)}</del>` : ""}</span>
        <div class="product-detail-actions">
          <a class="button outline" href="${productUrl(product)}">Page produit</a>
          <button class="button primary" data-cart="${product.id}">Ajouter au panier</button>
        </div>
      </div>
    </div>
  `;
  closeAll();
  $("#productDetailModal").classList.add("active");
  $("#productDetailModal").setAttribute("aria-hidden", "false");
  $("#overlay").classList.add("active");
  document.body.classList.add("no-scroll");
}

document.addEventListener("click", event => {
  const cartButton = event.target.closest("[data-cart]");
  const wishButton = event.target.closest("[data-wishlist]");
  const qtyButton = event.target.closest("[data-qty]");
  const removeButton = event.target.closest("[data-remove]");
  const filterButton = event.target.closest("[data-filter]");
  const productPageCard = event.target.closest("[data-product-page-card]");
  const detailImageButton = event.target.closest("[data-detail-image]");
  const productPageLink = event.target.closest("[data-product-page]");

  if (detailImageButton) {
    const mainImage = $("#productDetailMainImage");
    if (mainImage) mainImage.src = detailImageButton.dataset.detailImage;
    $$(".product-detail-thumb").forEach(button => button.classList.toggle("active", button === detailImageButton));
    return;
  }
  if (productPageLink) {
    const product = products.find(entry => entry.id === Number(productPageLink.dataset.productId));
    trackProductAnalytics("product_view", product, {
      metadata: { source: "product_link" }
    });
    return;
  }

  if (cartButton) {
    addToCart(Number(cartButton.dataset.cart));
    return;
  }
  if (wishButton) {
    toggleWishlist(Number(wishButton.dataset.wishlist));
    return;
  }
  if (qtyButton) {
    const entry = cart.find(item => item.id === Number(qtyButton.dataset.qty));
    if (!entry) return;
    entry.qty += Number(qtyButton.dataset.delta);
    if (entry.qty <= 0) cart = cart.filter(item => item.id !== entry.id);
    persist();
    renderCart();
    return;
  }
  if (removeButton) {
    cart = cart.filter(item => item.id !== Number(removeButton.dataset.remove));
    wishlist = wishlist.filter(id => id !== Number(removeButton.dataset.wishlist));
    persist();
    renderCart();
    renderWishlist();
    renderProducts($("#searchInput").value);
    return;
  }
  if (filterButton) {
    activeFilter = filterButton.dataset.filter;
    visibleCount = 12;
    $$("#productTabs button").forEach(button => button.classList.toggle("active", button.dataset.filter === activeFilter));
    renderProducts();
    trackAnalytics("category_view", {
      category: activeFilter,
      metadata: {
        source: filterButton.closest(".category-card") ? "home_category" : "navigation"
      }
    });
    if (filterButton.closest(".category-card") || filterButton.closest(".nav-inner")) {
      setTimeout(() => $("#boutique").scrollIntoView(), 50);
    }
    $("#mainNav").classList.remove("open");
    return;
  }
  if (productPageCard) {
    const product = products.find(entry => entry.id === Number(productPageCard.dataset.productId));
    trackProductAnalytics("product_view", product, {
      metadata: { source: "product_card" }
    });
    window.location.href = productPageCard.dataset.productPageCard;
  }
});

document.addEventListener("keydown", event => {
  const productPageCard = event.target.closest?.("[data-product-page-card]");
  if (productPageCard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    const product = products.find(entry => entry.id === Number(productPageCard.dataset.productId));
    trackProductAnalytics("product_view", product, {
      metadata: { source: "product_card_keyboard" }
    });
    window.location.href = productPageCard.dataset.productPageCard;
  }
});

function trackingHtml(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const deliveryFee = Number(order.deliveryFee || 0);
  const subtotal = Number(order.subtotal || 0) || Math.max(0, Number(order.total || 0) - deliveryFee);
  return `<div class="tracking-card">
    <div class="tracking-card-head">
      <div><span>Commande</span><strong>${escapeHtml(order.id)}</strong></div>
      <div><span>Total</span><strong>${formatPrice(order.total)}</strong></div>
    </div>
    <div class="tracking-statuses">
      <span class="tracking-badge">${orderStatuses[order.orderStatus] || escapeHtml(order.orderStatus)}</span>
      <span class="tracking-badge payment">${paymentStatuses[order.paymentStatus] || escapeHtml(order.paymentStatus)}</span>
      <span class="tracking-badge payment">${escapeHtml(formatPaymentProviderLabel(order.paymentProvider))}</span>
      <span class="tracking-date">${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.createdAt))}</span>
    </div>
    <div class="tracking-items">
      ${items.map(item => `<div><span>${escapeHtml(item.name)} x${item.quantity}</span><strong>${formatPrice(item.lineTotal)}</strong></div>`).join("") || "<p>Aucun article trouve.</p>"}
      <div><span>Sous-total produits</span><strong>${formatPrice(subtotal)}</strong></div>
      <div><span>Livraison ${escapeHtml(order.deliveryZone || "A confirmer")}</span><strong>${formatPrice(deliveryFee)}</strong></div>
    </div>
    <a class="button outline" href="https://wa.me/221772177176?text=${encodeURIComponent(`Bonjour DieguemTech Store, je souhaite avoir des informations sur ma commande ${order.id}.`)}" target="_blank" rel="noopener">Contacter le support</a>
  </div>`;
}

async function trackOrder(form) {
  const resultBox = $("#trackingResult");
  resultBox.hidden = false;
  resultBox.innerHTML = `<p class="tracking-message">Recherche de la commande...</p>`;
  const formData = new FormData(form);
  trackAnalytics("order_track", {
    metadata: { status: "submit", hasOrderId: Boolean(String(formData.get("orderId") || "").trim()) }
  });
  try {
    const response = await fetch("/api/orders/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: formData.get("orderId"),
        phone: formData.get("phone")
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Commande introuvable.");
    trackAnalytics("order_track", {
      metadata: { status: "found", paymentStatus: result.paymentStatus, orderStatus: result.orderStatus }
    });
    resultBox.innerHTML = trackingHtml(result);
  } catch (error) {
    trackAnalytics("order_track", {
      metadata: { status: "not_found" }
    });
    resultBox.innerHTML = `<p class="tracking-message error">${escapeHtml(error.message)}</p>`;
  }
}

function openModal(modal) {
  closeAll();
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  $("#overlay").classList.add("active");
  document.body.classList.add("no-scroll");
}

function showOrderSuccess(result, customerPhone, provider) {
  const orderId = result.orderId;
  const isWavePayment = provider === WAVE_PROVIDER;
  const isManualPayment = provider === CASH_ON_DELIVERY_PROVIDER;
  const showWaveLink = isWavePayment || isManualPayment;
  const waveLink = $("#orderWaveLink");
  $("#successOrderId").textContent = orderId;
  renderSuccessOrderSummary(result, provider);
  if (waveLink) {
    waveLink.href = WAVE_PAYMENT_URL;
    waveLink.hidden = !showWaveLink;
  }
  if (isWavePayment) {
    $("#successNotificationInfo").innerHTML = `Votre commande est enregistree. Cliquez sur <a href="${WAVE_PAYMENT_URL}" target="_blank" rel="noopener">Payer avec Wave</a>, puis envoyez la confirmation au support. L'email de commande sera envoye apres validation du paiement.`;
  } else if (isManualPayment) {
    $("#successNotificationInfo").innerHTML = `Votre commande est enregistree. Vous pouvez payer a la livraison ou payer DieguemTech Store avec <a href="${WAVE_PAYMENT_URL}" target="_blank" rel="noopener">Wave</a>, puis envoyer la confirmation au support. L'email de commande sera envoye apres validation du paiement.`;
  } else {
    $("#successNotificationInfo").textContent = "L'email de commande sera envoye apres validation du paiement.";
  }
  const whatsappLabel = isWavePayment
    ? "Envoyer preuve WhatsApp"
    : isManualPayment
      ? "Confirmer sur WhatsApp"
      : "WhatsApp support";
  const whatsappText = isWavePayment
    ? `Bonjour DieguemTech Store, je viens de payer avec Wave pour la commande ${orderId}. Je vous envoie la preuve.`
    : isManualPayment
      ? `Bonjour DieguemTech Store, je confirme ma commande ${orderId} et je souhaite payer a la livraison.`
      : `Bonjour DieguemTech Store, je viens de passer la commande ${orderId}.`;
  $("#orderWhatsappLink").textContent = whatsappLabel;
  $("#orderWhatsappLink").href = `https://wa.me/221772177176?text=${encodeURIComponent(whatsappText)}`;
  $("#trackingForm").elements.orderId.value = orderId;
  $("#trackingForm").elements.phone.value = customerPhone;
  openModal($("#orderSuccessModal"));
  showToast("Commande creee", `Numero ${orderId} - ${formatPaymentProviderLabel(provider)} en attente.`);
}

function renderSuccessOrderSummary(result, provider) {
  const box = $("#successOrderSummary");
  if (!box) return;
  const total = Number(result.total || 0);
  const deliveryFee = Number(result.deliveryFee || 0);
  const subtotal = Number(result.subtotal || Math.max(0, total - deliveryFee));
  box.hidden = false;
  box.innerHTML = `
    <div><span>Total</span><strong>${formatPrice(total)}</strong></div>
    <div><span>Paiement</span><strong>${escapeHtml(formatPaymentProviderLabel(provider))}</strong></div>
    <div><span>Livraison</span><strong>${escapeHtml(result.deliveryZone || "A confirmer")}${deliveryFee ? ` - ${formatPrice(deliveryFee)}` : ""}</strong></div>
    <div><span>Produits</span><strong>${formatPrice(subtotal)}</strong></div>
  `;
}

async function copyOrderId() {
  const orderId = $("#successOrderId").textContent.trim();
  try {
    await navigator.clipboard.writeText(orderId);
  } catch (error) {
    const input = document.createElement("input");
    input.value = orderId;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast("Numéro copié", orderId);
}

$("#searchForm").addEventListener("submit", event => {
  event.preventDefault();
  activeFilter = "Tous";
  visibleCount = 12;
  const query = $("#searchInput").value;
  updateSearchUrl(query);
  renderProducts(query);
  trackAnalytics("search", {
    value: query.trim().length,
    metadata: { query: query.trim() }
  });
  $("#boutique").scrollIntoView();
});
$("#searchInput").addEventListener("input", event => {
  if (event.target.value.length > 1 || !event.target.value) {
    activeFilter = "Tous";
    renderProducts(event.target.value);
  }
});
$("#resetSearch").addEventListener("click", () => {
  $("#searchInput").value = "";
  activeFilter = "Tous";
  visibleCount = 8;
  updateSearchUrl("");
  renderProducts();
});
$("#showAllProducts").addEventListener("click", () => {
  visibleCount = products.length;
  renderProducts($("#searchInput").value);
});
$("#trackingForm").addEventListener("submit", event => {
  event.preventDefault();
  trackOrder(event.target);
});
$("#copyOrderIdButton").addEventListener("click", copyOrderId);
$("#trackOrderLink").addEventListener("click", event => {
  event.preventDefault();
  closeAll();
  $("#suivi").scrollIntoView({ behavior: "smooth" });
});
$("#cartButton").addEventListener("click", () => {
  renderCart();
  const details = getCartDetails();
  trackAnalytics("cart_open", {
    value: details.total,
    metadata: { itemCount: details.count, lineCount: details.items.length }
  });
  openDrawer($("#cartDrawer"));
});
$("#wishlistButton").addEventListener("click", () => {
  renderWishlist();
  openDrawer($("#wishlistDrawer"));
});
$("#overlay").addEventListener("click", closeAll);
$$(".close-drawer,.modal-close").forEach(button => button.addEventListener("click", closeAll));
$("#menuToggle").addEventListener("click", () => $("#mainNav").classList.toggle("open"));

$("#checkoutButton").addEventListener("click", () => {
  if (!cart.length) {
    showToast("Panier vide", "Ajoutez au moins un produit avant de commander.");
    return;
  }
  renderCheckoutSummary();
  const details = getCartDetails();
  trackAnalytics("checkout_open", {
    value: details.total,
    metadata: { itemCount: details.count, lineCount: details.items.length }
  });
  openModal($("#checkoutModal"));
});
$$(".payment-options button").forEach(button => button.addEventListener("click", () => {
  $$(".payment-options button").forEach(item => {
    item.classList.remove("selected");
    item.setAttribute("aria-pressed", "false");
  });
  button.classList.add("selected");
  button.setAttribute("aria-pressed", "true");
  renderCheckoutSummary();
  const details = getCartDetails();
  const delivery = getSelectedDeliveryOption();
  trackAnalytics("payment_selected", {
    value: details.total + Number(delivery?.fee || 0),
    metadata: {
      provider: button.dataset.payment,
      itemCount: details.count,
      deliveryZone: $("#checkoutForm select[name='deliveryZone']")?.value || ""
    }
  });
}));
$("#checkoutForm select[name='deliveryZone']").addEventListener("change", renderCheckoutSummary);
$("#checkoutForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const requiredFields = ["customerName", "customerPhone", "deliveryZone", "deliveryAddress"];
  if (requiredFields.some(name => !String(formData.get(name) || "").trim())) {
    showToast("Informations manquantes", "Veuillez renseigner vos coordonnees et la livraison.");
    return;
  }
  if (!cart.length) {
    showToast("Panier vide", "Votre panier ne contient aucun produit.");
    return;
  }
  const provider = getSelectedPaymentProvider();
  const customerPhone = String(formData.get("customerPhone") || "").trim();
  const deliveryZone = String(formData.get("deliveryZone") || "").trim();
  const delivery = getDeliveryOption(deliveryZone);
  const checkoutDetails = getCartDetails();
  const checkoutTotal = checkoutDetails.total + Number(delivery?.fee || 0);
  if (provider === "PayDunya" && checkoutTotal < PAYDUNYA_MINIMUM_AMOUNT) {
    showToast(
      "Montant PayDunya trop bas",
      `Choisissez Wave, A la livraison ou WhatsApp pour ce total de ${formatPrice(checkoutTotal)}.`
    );
    return;
  }
  const deliveryNote = String(formData.get("deliveryNote") || "").trim();
  const deliveryAddress = [
    String(formData.get("deliveryAddress") || "").trim(),
    deliveryNote ? `Instruction: ${deliveryNote}` : ""
  ].filter(Boolean).join(" - ");
  const payButton = $("#payButton");
  payButton.disabled = true;
  payButton.textContent = "Creation de la commande...";
  trackAnalytics("checkout_submit", {
    value: checkoutTotal,
    metadata: {
      provider,
      itemCount: checkoutDetails.count,
      lineCount: checkoutDetails.items.length,
      deliveryZone
    }
  });
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: {
          name: String(formData.get("customerName") || "").trim(),
          phone: customerPhone,
          email: String(formData.get("customerEmail") || "").trim(),
          address: deliveryAddress,
          deliveryZone
        },
        items: cart.map(item => ({ id: item.id, quantity: item.qty })),
        paymentProvider: provider
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "La commande n'a pas pu etre creee.");
    trackAnalytics("order_created", {
      value: Number(result.total || checkoutTotal),
      metadata: {
        provider,
        orderId: result.orderId,
        paymentStatus: result.paymentStatus,
        itemCount: checkoutDetails.count,
        deliveryZone: result.deliveryZone || deliveryZone
      }
    });
    if (result.redirect_url) {
      window.location.href = result.redirect_url;
      return;
    }
    cart = [];
    persist();
    renderCart();
    form.reset();
    renderCheckoutSummary();
    showOrderSuccess(result, customerPhone, provider);
  } catch (error) {
    showToast("Commande impossible", error.message);
  } finally {
    payButton.disabled = false;
    payButton.textContent = "Confirmer ma commande";
  }
});

$("#newsletterForm").addEventListener("submit", event => {
  event.preventDefault();
  event.target.reset();
  showToast("Inscription reussie", "Bienvenue dans la communaute DieguemTech !");
});

const deadline = Date.now() + (2 * 24 * 60 * 60 * 1000) + (14 * 60 * 60 * 1000);
setInterval(() => {
  const diff = Math.max(0, deadline - Date.now());
  $("#days").textContent = String(Math.floor(diff / 86400000)).padStart(2, "0");
  $("#hours").textContent = String(Math.floor(diff % 86400000 / 3600000)).padStart(2, "0");
  $("#minutes").textContent = String(Math.floor(diff % 3600000 / 60000)).padStart(2, "0");
}, 1000);

function getInitialSearch(){
  return new URLSearchParams(window.location.search).get("q")?.trim() || "";
}

async function initializeStore(){
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Catalogue indisponible.");
    products = sortProductsForStore(await response.json());
    cart = cart.filter(item => products.some(product => product.id === item.id));
    wishlist = wishlist.filter(id => products.some(product => product.id === id));
    const initialSearch = getInitialSearch();
    if (initialSearch) {
      $("#searchInput").value = initialSearch;
      visibleCount = 12;
    }
    renderProducts(initialSearch);
    renderCart();
    renderWishlist();
    persist();
    await initializeMarketingTracking();
    trackAnalytics("page_view", {
      metadata: {
        title: document.title,
        initialSearch: initialSearch || ""
      }
    });
    if (initialSearch) {
      trackAnalytics("search", {
        value: initialSearch.length,
        metadata: { query: initialSearch, source: "url" }
      });
    }
  } catch (error) {
    $("#productsGrid").innerHTML = "";
    $("#emptyState").style.display = "block";
    $("#emptyState h3").textContent = "Le catalogue est temporairement indisponible";
    $("#emptyState p").textContent = "Veuillez actualiser la page dans quelques instants.";
    console.error(error);
  }
}

function cleanWebsiteServiceWorker(){
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    const rootScope = `${window.location.origin}/`;
    Promise.all([
      navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations
          .filter(registration => registration.scope === rootScope)
          .map(registration => registration.unregister())
        )),
      "caches" in window
        ? caches.keys().then(keys => Promise.all(keys
          .filter(key => key.startsWith("dieguemtech-store"))
          .map(key => caches.delete(key))
        ))
        : Promise.resolve()
    ])
      .then(([unregistered]) => {
        if (unregistered.some(Boolean) && navigator.serviceWorker.controller && !sessionStorage.getItem("dt-website-sw-cleaned")) {
          sessionStorage.setItem("dt-website-sw-cleaned", "1");
          window.location.reload();
        }
      })
      .catch(error => {
        console.warn("Nettoyage service worker impossible:", error);
      });
  });
}

cleanWebsiteServiceWorker();
initializeStore();
