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
  return `<article class="product-card" data-product-detail="${product.id}" tabindex="0" role="button" aria-label="Voir ${escapeHtml(product.name)}">
    <div class="product-visual">
      <span class="${badgeClass}">${escapeHtml(product.badge)}</span>
      <button class="wishlist-toggle ${liked ? "active" : ""}" data-wishlist="${product.id}" aria-label="Ajouter aux favoris">
        <svg><use href="#icon-heart"></use></svg>
      </button>
      ${productVisual(product)}
    </div>
    <div class="product-info">
      <span class="product-category">${escapeHtml(product.category)}</span>
      <h3 title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
      <p class="product-description">${escapeHtml(description)}</p>
      <div class="product-rating"><span class="stars">★★★★★</span> ${product.rating} (${product.reviews})</div>
      <div class="product-bottom">
        <span class="price"><strong>${formatPrice(product.price)}</strong>${product.oldPrice ? `<del>${formatPrice(product.oldPrice)}</del>` : ""}</span>
        <button class="add-cart" data-cart="${product.id}" aria-label="Ajouter ${escapeHtml(product.name)} au panier"><svg><use href="#icon-cart"></use></svg></button>
      </div>
    </div>
  </article>`;
}

function renderProducts(search = ""){
  const query = search.trim().toLowerCase();
  const filtered = products.filter(product => {
    const matchesCategory = activeFilter === "Tous" || product.category === activeFilter;
    const matchesSearch = !query || `${product.name} ${product.category} ${getProductDescription(product)}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
  $("#productsGrid").innerHTML = filtered.slice(0, visibleCount).map(productCard).join("");
  $("#emptyState").style.display = filtered.length ? "none" : "block";
  $("#showAllProducts").style.display = filtered.length > visibleCount ? "inline-flex" : "none";
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
  $("#checkoutTotal").textContent = formatPrice(total);
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
      <span class="eyebrow">${escapeHtml(product.category)}</span>
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
        <button class="button primary" data-cart="${product.id}">Ajouter au panier</button>
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
  const detailCard = event.target.closest("[data-product-detail]");
  const detailImageButton = event.target.closest("[data-detail-image]");

  if (detailImageButton) {
    const mainImage = $("#productDetailMainImage");
    if (mainImage) mainImage.src = detailImageButton.dataset.detailImage;
    $$(".product-detail-thumb").forEach(button => button.classList.toggle("active", button === detailImageButton));
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
    if (filterButton.closest(".category-card") || filterButton.closest(".nav-inner")) {
      setTimeout(() => $("#boutique").scrollIntoView(), 50);
    }
    $("#mainNav").classList.remove("open");
    return;
  }
  if (detailCard) openProductDetail(detailCard.dataset.productDetail);
});

document.addEventListener("keydown", event => {
  const detailCard = event.target.closest?.("[data-product-detail]");
  if (detailCard && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openProductDetail(detailCard.dataset.productDetail);
  }
});

function trackingHtml(order) {
  const items = Array.isArray(order.items) ? order.items : [];
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
  $("#successOrderId").textContent = orderId;
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
  renderProducts($("#searchInput").value);
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
  $("#cartDrawer").classList.remove("active");
  $("#checkoutModal").classList.add("active");
  $("#checkoutModal").setAttribute("aria-hidden", "false");
});
$$(".payment-options button").forEach(button => button.addEventListener("click", () => {
  $$(".payment-options button").forEach(item => item.classList.remove("selected"));
  button.classList.add("selected");
}));
$("#payButton").addEventListener("click", async () => {
  const fields = $$("#checkoutModal input");
  if ([...fields].some(field => !field.value.trim())) {
    showToast("Informations manquantes", "Veuillez renseigner vos coordonnees de livraison.");
    return;
  }
  const provider = $(".payment-options button.selected").dataset.payment;
  const customerPhone = fields[1].value;
  const payButton = $("#payButton");
  payButton.disabled = true;
  payButton.textContent = "Création de la commande...";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: {
          name: fields[0].value,
          phone: fields[1].value,
          address: fields[2].value
        },
        items: cart.map(item => ({ id: item.id, quantity: item.qty })),
        paymentProvider: provider
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "La commande n'a pas pu être créée.");
    if (provider === "PayTech" && result.redirect_url) {
      window.location.href = result.redirect_url;
      return;
    }
    cart = [];
    persist();
    renderCart();
    fields.forEach(field => field.value = "");
    showOrderSuccess(result, customerPhone, provider);
  } catch (error) {
    showToast("Commande impossible", error.message);
  } finally {
    payButton.disabled = false;
    payButton.textContent = "Payer maintenant";
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

async function initializeStore(){
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Catalogue indisponible.");
    products = await response.json();
    cart = cart.filter(item => products.some(product => product.id === item.id));
    wishlist = wishlist.filter(id => products.some(product => product.id === id));
    renderProducts();
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

initializeStore();
