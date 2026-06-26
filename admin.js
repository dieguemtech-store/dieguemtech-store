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

let orders = [];
let products = [];
let token = sessionStorage.getItem("dt-admin-token") || "";

const $ = selector => document.querySelector(selector);
const formatPrice = value => `${new Intl.NumberFormat("fr-FR").format(Number(value || 0))} FCFA`;
const formatDate = value => new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short"
}).format(new Date(value));

function setMessage(text = "") {
  $("#loginMessage").textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Operation impossible.");
  return data;
}

async function login(password) {
  const result = await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  token = result.token;
  sessionStorage.setItem("dt-admin-token", token);
  showDashboard();
  await loadOrders();
}

function logout() {
  token = "";
  sessionStorage.removeItem("dt-admin-token");
  $("#dashboard").hidden = true;
  $("#loginCard").hidden = false;
}

function showDashboard() {
  $("#loginCard").hidden = true;
  $("#dashboard").hidden = false;
}

async function loadOrders() {
  orders = await api("/api/admin/orders");
  renderOrders();
}

async function loadProducts() {
  products = await api("/api/admin/products");
  renderProductCategories();
  renderProducts();
}

function renderStats(filtered) {
  $("#totalOrders").textContent = orders.length;
  $("#pendingOrders").textContent = orders.filter(order => order.orderStatus === "pending").length;
  $("#paidOrders").textContent = orders.filter(order => order.paymentStatus === "paid").length;
  $("#totalRevenue").textContent = formatPrice(
    orders.filter(order => order.paymentStatus === "paid").reduce((sum, order) => sum + Number(order.total || 0), 0)
  );
}

function getFilteredOrders() {
  const query = $("#orderSearch").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  return orders.filter(order => {
    const haystack = `${order.id} ${order.customerName} ${order.customerPhone} ${order.deliveryAddress}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesStatus = !status || order.orderStatus === status;
    return matchesSearch && matchesStatus;
  });
}

function renderOrders() {
  const filtered = getFilteredOrders();
  renderStats(filtered);
  $("#emptyOrders").hidden = filtered.length > 0;
  $("#ordersList").innerHTML = filtered.map(orderCard).join("");
}

function renderProductCategories() {
  const select = $("#productCategoryFilter");
  const current = select.value;
  const categories = [...new Set(products.map(product => product.category))].sort();
  select.innerHTML = `<option value="">Toutes categories</option>${categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  select.value = current;
}

function getFilteredProducts() {
  const query = $("#productSearch").value.trim().toLowerCase();
  const category = $("#productCategoryFilter").value;
  return products.filter(product => {
    const haystack = `${product.name} ${product.category} ${product.badge} ${product.description || ""}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!category || product.category === category);
  });
}

function getProductImages(product) {
  const candidates = [];
  if (product.image) candidates.push(product.image);
  if (Array.isArray(product.images)) candidates.push(...product.images);
  return [...new Set(
    candidates
      .map(normalizeProductImagePath)
      .filter(Boolean)
  )].slice(0, 8);
}

function parseImageLines(value) {
  return [...new Set(
    String(value || "")
      .split(/[\n,]/)
      .map(normalizeProductImagePath)
      .filter(Boolean)
  )].slice(0, 8);
}

function normalizeProductImagePath(image) {
  const value = String(image || "").trim().replace(/\\/g, "/");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\/?assets?\//i.test(value)) {
    return `/assets/${value.replace(/^\/?assets?\/*/i, "")}`;
  }
  return value;
}

function renderProducts() {
  const filtered = getFilteredProducts();
  $("#emptyProducts").hidden = filtered.length > 0;
  $("#productsAdminList").innerHTML = filtered.map(productCard).join("");
}

function productCard(product) {
  const activeLabel = product.active === false ? "Inactif" : "Actif";
  const images = getProductImages(product);
  const mainImage = images[0];
  return `<article class="product-admin-card">
    <div class="product-admin-visual">
      ${mainImage ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}">` : `<span>${product.emoji}</span>`}
      ${images.length > 1 ? `<b class="image-count">${images.length}</b>` : ""}
    </div>
    <div>
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.category)} &middot; ${escapeHtml(product.badge || "Sans badge")} &middot; ${images.length} image${images.length > 1 ? "s" : ""}</p>
      <p class="muted">${escapeHtml(product.description || "Aucune description.")}</p>
    </div>
    <div class="product-admin-meta">
      <strong>${formatPrice(product.price)}</strong>
      <span>Stock: ${product.stock}</span>
      <span class="product-state ${product.active === false ? "inactive" : "active"}">${activeLabel}</span>
      <button type="button" data-edit-product="${product.id}">Modifier</button>
      ${product.active === false ? "" : `<button type="button" class="danger-button" data-deactivate-product="${product.id}">Desactiver</button>`}
    </div>
  </article>`;
}

function orderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  return `<article class="order-card">
    <div class="order-top">
      <div>
        <div class="order-id">${order.id}</div>
        <div class="order-date">${formatDate(order.createdAt)}</div>
      </div>
      <div>
        <span class="badge ${order.orderStatus}">${orderStatuses[order.orderStatus] || order.orderStatus}</span>
        <span class="badge ${order.paymentStatus}">${paymentStatuses[order.paymentStatus] || order.paymentStatus}</span>
      </div>
    </div>
    <div class="order-actions">
      <button type="button" data-view-order="${order.id}">Voir detail</button>
      <button type="button" class="ghost" data-print-order="${order.id}">Imprimer recu</button>
      <a class="whatsapp-action" href="${whatsappUrl(order)}" target="_blank" rel="noopener">WhatsApp client</a>
    </div>
    <div class="order-body">
      <div>
        <h3>Client</h3>
        <p><strong>${escapeHtml(order.customerName)}</strong></p>
        <p>${escapeHtml(order.customerPhone)}</p>
        <p>${escapeHtml(order.deliveryAddress)}</p>
      </div>
      <div>
        <h3>Produits</h3>
        <div class="items">${items.map(item => `<div class="item-line"><span>${escapeHtml(item.name)} x${item.quantity}</span><strong>${formatPrice(item.lineTotal)}</strong></div>`).join("") || "<p>Aucun detail produit.</p>"}</div>
        <div class="order-total">${formatPrice(order.total)}</div>
        <p>${escapeHtml(order.paymentProvider)} · ${escapeHtml(order.currency)}</p>
      </div>
      <div class="status-controls">
        <label>Statut commande
          <select data-order-status="${order.id}">
            ${Object.entries(orderStatuses).map(([value, label]) => `<option value="${value}" ${order.orderStatus === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>Statut paiement
          <select data-payment-status="${order.id}">
            ${Object.entries(paymentStatuses).map(([value, label]) => `<option value="${value}" ${order.paymentStatus === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>
  </article>`;
}

function findOrder(id) {
  return orders.find(order => order.id === id);
}

function whatsappUrl(order) {
  const message = [
    `Bonjour ${order.customerName},`,
    `Votre commande ${order.id} chez DieguemTech Store est en statut: ${orderStatuses[order.orderStatus] || order.orderStatus}.`,
    `Total: ${formatPrice(order.total)}.`,
    "Merci pour votre confiance."
  ].join(" ");
  const phone = String(order.customerPhone || "").replace(/\D/g, "");
  const normalizedPhone = phone.startsWith("221") ? phone : `221${phone.replace(/^0+/, "")}`;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

function openOrderModal(id) {
  const order = findOrder(id);
  if (!order) return;
  $("#orderModalContent").innerHTML = receiptHtml(order, false);
  $("#orderModal").hidden = false;
}

function closeOrderModal() {
  $("#orderModal").hidden = true;
}

function openProductModal(id) {
  const product = products.find(item => item.id === Number(id));
  if (!product) return;
  renderProductForm(product);
  $("#productModal").hidden = false;
}

function openCreateProductModal() {
  renderProductForm({
    id: "",
    name: "",
    category: "",
    badge: "",
    price: "",
    oldPrice: "",
    stock: 0,
    image: "",
    images: [],
    description: "",
    active: true
  });
  $("#productModal").hidden = false;
}

function renderProductForm(product) {
  const isNew = !product.id;
  const images = getProductImages(product);
  $("#productForm").innerHTML = `<div class="product-form-head">
      <span class="eyebrow">${isNew ? "Nouveau produit" : `Produit #${product.id}`}</span>
      <h2>${isNew ? "Ajouter un produit" : "Modifier le produit"}</h2>
    </div>
    <label>Nom
      <input name="name" value="${escapeHtml(product.name)}" required>
    </label>
    <div class="form-grid">
      <label>Categorie
        <input name="category" value="${escapeHtml(product.category)}" required>
      </label>
      <label>Badge
        <input name="badge" value="${escapeHtml(product.badge || "")}" placeholder="-20%, Nouveau...">
      </label>
      <label>Prix
        <input name="price" type="number" min="0" step="1" value="${product.price}" required>
      </label>
      <label>Ancien prix
        <input name="oldPrice" type="number" min="0" step="1" value="${product.oldPrice ?? ""}">
      </label>
      <label>Stock
        <input name="stock" type="number" min="0" step="1" value="${product.stock}" required>
      </label>
    </div>
    <label>Galerie images
      <textarea name="images" rows="5" placeholder="Une image par ligne. Exemple: assets/nom-du-produit.png">${escapeHtml(images.join("\n"))}</textarea>
      <small class="field-help">Formats acceptes: assets/photo.png, /assets/photo.png ou une URL https. La premiere image devient l'image principale.</small>
    </label>
    <div class="image-preview-card">
      <div class="image-preview" id="productImagePreview"></div>
      <div>
        <strong>Apercu des images</strong>
        <p>Pour une image locale, place d'abord le fichier dans le dossier assets, puis indique son chemin ici.</p>
        <small id="productImageHelp"></small>
      </div>
    </div>
    <label>Description
      <textarea name="description" rows="5" placeholder="Description commerciale du produit">${escapeHtml(product.description || "")}</textarea>
    </label>
    <label class="checkbox-row">
      <input name="active" type="checkbox" ${product.active === false ? "" : "checked"}> Produit actif
    </label>
    <input type="hidden" name="id" value="${product.id}">
    <div class="modal-actions">
      <button type="submit">${isNew ? "Ajouter le produit" : "Enregistrer"}</button>
      <button type="button" class="ghost" id="cancelProductEdit">Annuler</button>
    </div>`;
  updateProductImagePreview(images.join("\n"));
}

function closeProductModal() {
  $("#productModal").hidden = true;
}

function updateProductImagePreview(value) {
  const preview = $("#productImagePreview");
  const help = $("#productImageHelp");
  const images = parseImageLines(value);
  if (!images.length) {
    preview.innerHTML = "<span>Images</span>";
    help.textContent = "Aucune image selectionnee.";
    return;
  }
  preview.innerHTML = `${images.slice(0, 6).map((image, index) => `<img src="${escapeHtml(image)}" alt="Apercu image ${index + 1}">`).join("")}${images.length > 6 ? `<span class="preview-more">+${images.length - 6}</span>` : ""}`;
  help.textContent = `${images.length} image${images.length > 1 ? "s" : ""}. La premiere sera affichee sur les cartes produit.`;
}

function receiptHtml(order, printable = true) {
  const items = Array.isArray(order.items) ? order.items : [];
  return `<div class="${printable ? "receipt printable" : "receipt"}">
    <div class="receipt-head">
      <div class="receipt-logo">D</div>
      <div>
        <h2>DieguemTech Store</h2>
        <p>High-Tech · Gaming · IPTV · Accessoires</p>
      </div>
    </div>
    <div class="receipt-meta">
      <div><span>Commande</span><strong>${escapeHtml(order.id)}</strong></div>
      <div><span>Date</span><strong>${formatDate(order.createdAt)}</strong></div>
      <div><span>Paiement</span><strong>${paymentStatuses[order.paymentStatus] || order.paymentStatus}</strong></div>
      <div><span>Statut</span><strong>${orderStatuses[order.orderStatus] || order.orderStatus}</strong></div>
    </div>
    <section class="receipt-section">
      <h3>Client</h3>
      <p><strong>${escapeHtml(order.customerName)}</strong><br>${escapeHtml(order.customerPhone)}<br>${escapeHtml(order.deliveryAddress)}</p>
    </section>
    <section class="receipt-section">
      <h3>Produits</h3>
      <table>
        <thead><tr><th>Produit</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${formatPrice(item.unitPrice)}</td><td>${formatPrice(item.lineTotal)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
    <div class="receipt-total"><span>Total</span><strong>${formatPrice(order.total)}</strong></div>
    <p class="receipt-note">Merci pour votre confiance. Support WhatsApp: +221772177176</p>
    ${printable ? "" : `<div class="modal-actions"><button type="button" data-print-order="${order.id}">Imprimer ce recu</button><a class="whatsapp-action" href="${whatsappUrl(order)}" target="_blank" rel="noopener">Envoyer WhatsApp</a></div>`}
  </div>`;
}

function printOrder(id) {
  const order = findOrder(id);
  if (!order) return;
  const printWindow = window.open("", "_blank", "width=820,height=900");
  if (!printWindow) return;
  printWindow.document.write(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Recu ${escapeHtml(order.id)} - DieguemTech Store</title>
  <link rel="stylesheet" href="admin.css">
</head>
<body class="print-body">
  ${receiptHtml(order)}
  <script>window.addEventListener("load",()=>{window.print();});<\/script>
</body>
</html>`);
  printWindow.document.close();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

async function updateStatus(id, payload) {
  await api(`/api/admin/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  await loadOrders();
}

async function saveProduct(form) {
  const formData = new FormData(form);
  const id = formData.get("id");
  const images = parseImageLines(formData.get("images"));
  const payload = {
    name: formData.get("name"),
    category: formData.get("category"),
    badge: formData.get("badge"),
    price: Number(formData.get("price")),
    oldPrice: formData.get("oldPrice") ? Number(formData.get("oldPrice")) : null,
    stock: Number(formData.get("stock")),
    image: images[0] || "",
    images,
    description: formData.get("description"),
    active: formData.get("active") === "on"
  };
  await api(id ? `/api/admin/products/${encodeURIComponent(id)}` : "/api/admin/products", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
  closeProductModal();
  await loadProducts();
}

async function deactivateProduct(id) {
  const product = products.find(item => item.id === Number(id));
  if (!product) return;
  const confirmed = window.confirm(`Desactiver "${product.name}" ? Il disparaitra de la boutique, mais restera dans l'admin.`);
  if (!confirmed) return;
  await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadProducts();
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  setMessage("");
  try {
    await login($("#adminPassword").value);
  } catch (error) {
    setMessage(error.message);
  }
});

$("#logoutButton").addEventListener("click", logout);
$("#refreshOrders").addEventListener("click", loadOrders);
$("#orderSearch").addEventListener("input", renderOrders);
$("#statusFilter").addEventListener("change", renderOrders);
$("#productSearch").addEventListener("input", renderProducts);
$("#productCategoryFilter").addEventListener("change", renderProducts);
$("#addProductButton").addEventListener("click", openCreateProductModal);

document.addEventListener("change", async event => {
  const orderStatus = event.target.closest("[data-order-status]");
  const paymentStatus = event.target.closest("[data-payment-status]");
  if (orderStatus) await updateStatus(orderStatus.dataset.orderStatus, { orderStatus: orderStatus.value });
  if (paymentStatus) await updateStatus(paymentStatus.dataset.paymentStatus, { paymentStatus: paymentStatus.value });
});

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view-order]");
  const printButton = event.target.closest("[data-print-order]");
  const editProductButton = event.target.closest("[data-edit-product]");
  const deactivateProductButton = event.target.closest("[data-deactivate-product]");
  if (viewButton) openOrderModal(viewButton.dataset.viewOrder);
  if (printButton) printOrder(printButton.dataset.printOrder);
  if (editProductButton) openProductModal(editProductButton.dataset.editProduct);
  if (deactivateProductButton) deactivateProduct(deactivateProductButton.dataset.deactivateProduct);
});

$("#closeOrderModal").addEventListener("click", closeOrderModal);
$("#orderModal").addEventListener("click", event => {
  if (event.target.id === "orderModal") closeOrderModal();
});
$("#closeProductModal").addEventListener("click", closeProductModal);
$("#productModal").addEventListener("click", event => {
  if (event.target.id === "productModal") closeProductModal();
});
$("#productForm").addEventListener("click", event => {
  if (event.target.id === "cancelProductEdit") closeProductModal();
});
$("#productForm").addEventListener("input", event => {
  if (event.target.name === "images") updateProductImagePreview(event.target.value);
});
$("#productForm").addEventListener("submit", async event => {
  event.preventDefault();
  await saveProduct(event.target);
});

document.querySelectorAll("[data-admin-tab]").forEach(button => {
  button.addEventListener("click", async () => {
    document.querySelectorAll("[data-admin-tab]").forEach(tab => tab.classList.toggle("active", tab === button));
    const showProducts = button.dataset.adminTab === "products";
    $("#ordersPanel").hidden = showProducts;
    $("#productsPanel").hidden = !showProducts;
    if (showProducts && products.length === 0) await loadProducts();
  });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#orderModal").hidden) closeOrderModal();
  if (event.key === "Escape" && !$("#productModal").hidden) closeProductModal();
});

if (token) {
  showDashboard();
  loadOrders().catch(() => logout());
}
