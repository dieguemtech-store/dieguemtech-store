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
  return `<article class="product-card" data-product-page-card="${productUrl(product)}" tabindex="0" role="link" aria-label="Ouvrir la page de ${escapeHtml(product.name)}">
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
          <a class="product-page-link" href="${productUrl(product)}" data-product-page aria-label="Voir la page de ${escapeHtml(product.name)}">Voir</a>
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
}

function toggleWishlist(id){
  wishlist = wishlist.includes(id) ? wishlist.filter(item => item !== id) : [...wishlist, id];
  persist();
  renderProducts($("#searchInput").value);
  renderWishlist();
  showToast(
    wishlist.includes(id) ? "Ajouté aux favoris" : "Retiré des favoris",
    wishlist.includes(id) ? "Vous pourrez le retrouver facilement." : "Votre liste de souhaits a été mise à jour."
  );
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
        <span>Paiement securise PayDunya / PayTech</span>
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
  if (productPageLink) return;

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
    if (filterButton.closest(".category-card") || filterButton.closest(".nav-inner")) {
      setTimeout(() => $("#boutique").scrollIntoView(), 50);
    }
    $("#mainNav").classList.remove("open");
    return;
  }
  if (productPageCard) window.location.href = productPageCard.dataset.productPageCard;
});

document.addEventListener("keydown", event => {
  const productPageCard = event.target.closest?.("[data-product-page-card]");
  if (productPageCard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
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
    resultBox.innerHTML = trackingHtml(result);
  } catch (error) {
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
  const notifications = result.notifications || {};
  const customerNotified = notifications.customerEmail === "sent" || notifications.customerWhatsapp === "sent";
  $("#successOrderId").textContent = orderId;
  $("#successNotificationInfo").textContent = customerNotified
    ? "Une confirmation vient aussi de vous etre envoyee."
    : "Le support confirmera votre commande par WhatsApp ou telephone.";
  $("#orderWhatsappLink").href = `https://wa.me/221772177176?text=${encodeURIComponent(`Bonjour DieguemTech Store, je viens de passer la commande ${orderId}.`)}`;
  $("#trackingForm").elements.orderId.value = orderId;
  $("#trackingForm").elements.phone.value = customerPhone;
  openModal($("#orderSuccessModal"));
  showToast("Commande créée", `Numéro ${orderId} - paiement ${provider} en attente.`);
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
  openModal($("#checkoutModal"));
});
$$(".payment-options button").forEach(button => button.addEventListener("click", () => {
  $$(".payment-options button").forEach(item => {
    item.classList.remove("selected");
    item.setAttribute("aria-pressed", "false");
  });
  button.classList.add("selected");
  button.setAttribute("aria-pressed", "true");
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
  const provider = $(".payment-options button.selected").dataset.payment;
  const customerPhone = String(formData.get("customerPhone") || "").trim();
  const deliveryZone = String(formData.get("deliveryZone") || "").trim();
  const deliveryNote = String(formData.get("deliveryNote") || "").trim();
  const deliveryAddress = [
    String(formData.get("deliveryAddress") || "").trim(),
    deliveryNote ? `Instruction: ${deliveryNote}` : ""
  ].filter(Boolean).join(" - ");
  const payButton = $("#payButton");
  payButton.disabled = true;
  payButton.textContent = "Creation de la commande...";
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
