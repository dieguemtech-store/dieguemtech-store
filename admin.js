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

function getOrderDate(order) {
  const date = new Date(order.createdAt);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isTodayOrder(order) {
  const today = startOfDay(new Date());
  return startOfDay(getOrderDate(order)).getTime() === today.getTime();
}

function getRevenue(list) {
  return list.reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function getOrderDeliveryFee(order) {
  return Number(order.deliveryFee || 0);
}

function getOrderSubtotal(order) {
  const subtotal = Number(order.subtotal || 0);
  if (subtotal > 0) return subtotal;
  return Math.max(0, Number(order.total || 0) - getOrderDeliveryFee(order));
}

function getOrderDeliveryZone(order) {
  return order.deliveryZone || "A confirmer";
}

function isOrderToPrepare(order) {
  return order.paymentStatus === "paid" && !["shipped", "delivered", "cancelled"].includes(order.orderStatus);
}

function setMessage(text = "") {
  $("#loginMessage").textContent = text;
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {})
  };
  const response = await fetch(path, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = [data.error, data.detail, data.hint].filter(Boolean).join(" - ");
    throw new Error(message || "Operation impossible.");
  }
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
  await Promise.all([loadOrders(), loadEmailStatus()]);
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

async function loadEmailStatus() {
  const card = $("#emailStatusCard");
  if (!card) return;
  try {
    const status = await api("/api/email/status");
    renderEmailStatus(status);
  } catch (error) {
    renderEmailStatus({ configured: false, missing: ["statut indisponible"], error: error.message });
  }
}

function renderEmailStatus(status) {
  const badge = $("#emailStatusBadge");
  const text = $("#emailStatusText");
  if (!badge || !text) return;
  const missing = Array.isArray(status.missing) ? status.missing : [];
  const ready = status.configured === true;
  badge.classList.toggle("ok", ready);
  badge.classList.toggle("error", !ready);
  badge.textContent = ready ? "Actif" : "A configurer";
  if (ready) {
    text.textContent = `Resend est configure. Domaine expediteur: ${status.fromDomain || "non detecte"}.`;
    return;
  }
  text.textContent = status.error
    ? `Statut email indisponible: ${status.error}`
    : `Variables manquantes dans Render: ${missing.join(", ") || "configuration incomplete"}.`;
}

async function testAdminEmail() {
  const button = $("#testEmailButton");
  const message = $("#emailTestMessage");
  if (!button || !message) return;
  button.disabled = true;
  message.classList.remove("error", "success");
  message.textContent = "Envoi du test email...";
  try {
    const result = await api("/api/admin/email/test", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderEmailStatus(result.email);
    message.classList.add("success");
    message.textContent = result.message || "Email test envoye.";
  } catch (error) {
    await loadEmailStatus();
    message.classList.add("error");
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadProducts() {
  products = await api("/api/admin/products");
  renderProductCategories();
  renderProducts();
}

function renderStats() {
  const paid = orders.filter(order => order.paymentStatus === "paid");
  const today = orders.filter(isTodayOrder);
  const totalRevenue = getRevenue(paid);
  $("#totalOrders").textContent = orders.length;
  $("#pendingOrders").textContent = orders.filter(order => order.orderStatus === "pending").length;
  $("#toPrepareOrders").textContent = orders.filter(isOrderToPrepare).length;
  $("#paidOrders").textContent = paid.length;
  $("#deliveredOrders").textContent = orders.filter(order => order.orderStatus === "delivered").length;
  $("#todayOrders").textContent = today.length;
  $("#todayRevenue").textContent = `${formatPrice(getRevenue(today.filter(order => order.paymentStatus === "paid")))} encaisses`;
  $("#averageBasket").textContent = formatPrice(paid.length ? Math.round(totalRevenue / paid.length) : 0);
  $("#totalRevenue").textContent = formatPrice(totalRevenue);
}

function getFilteredOrders() {
  const query = $("#orderSearch").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  const payment = $("#paymentFilter").value;
  const dateFilter = $("#dateFilter").value;
  return orders.filter(order => {
    const haystack = `${order.id} ${order.customerName} ${order.customerPhone} ${order.customerEmail || ""} ${getOrderDeliveryZone(order)} ${order.deliveryAddress} ${order.paymentProvider}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesStatus = !status || order.orderStatus === status;
    const matchesPayment = !payment || order.paymentStatus === payment;
    const matchesDate = matchesDateFilter(order, dateFilter);
    return matchesSearch && matchesStatus && matchesPayment && matchesDate;
  });
}

function matchesDateFilter(order, dateFilter) {
  if (!dateFilter) return true;
  const orderDate = startOfDay(getOrderDate(order));
  const today = startOfDay(new Date());
  if (dateFilter === "today") return orderDate.getTime() === today.getTime();
  const days = dateFilter === "7d" ? 7 : dateFilter === "30d" ? 30 : 0;
  if (!days) return true;
  const start = new Date(today);
  start.setDate(today.getDate() - (days - 1));
  return orderDate >= start && orderDate <= today;
}

function renderOrders() {
  const filtered = getFilteredOrders();
  renderStats();
  $("#emptyOrders").hidden = filtered.length > 0;
  $("#ordersFilterSummary").textContent = `${filtered.length} commande${filtered.length > 1 ? "s" : ""} affichee${filtered.length > 1 ? "s" : ""} sur ${orders.length}.`;
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
  const status = $("#productStatusFilter").value;
  const featured = $("#productFeaturedFilter").value;
  return products.filter(product => {
    const isPublished = product.active !== false;
    const isFeatured = product.featured === true;
    const haystack = `${product.name} ${product.category} ${product.subcategory || ""} ${product.badge} ${product.description || ""}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    const matchesCategory = !category || product.category === category;
    const matchesStatus = !status || (status === "published" ? isPublished : !isPublished);
    const matchesFeatured = !featured || (featured === "featured" ? isFeatured : !isFeatured);
    return matchesSearch && matchesCategory && matchesStatus && matchesFeatured;
  });
}

function getCategoryOptions() {
  return [...new Set(products.map(product => product.category).filter(Boolean))].sort();
}

function getSubcategoryOptions(category = "") {
  return [...new Set(products
    .filter(product => !category || product.category === category)
    .map(product => product.subcategory)
    .filter(Boolean)
  )].sort();
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
  const activeLabel = product.active === false ? "Masque" : "Publie";
  const images = getProductImages(product);
  const mainImage = images[0];
  const subcategoryLabel = product.subcategory ? ` / ${escapeHtml(product.subcategory)}` : "";
  return `<article class="product-admin-card">
    <div class="product-admin-visual">
      ${mainImage ? `<img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}">` : `<span>${product.emoji}</span>`}
      ${images.length > 1 ? `<b class="image-count">${images.length}</b>` : ""}
    </div>
    <div>
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.category)}${subcategoryLabel} &middot; ${escapeHtml(product.badge || "Sans badge")} &middot; ${images.length} image${images.length > 1 ? "s" : ""}</p>
      <div class="product-chips">
        <span class="product-state ${product.active === false ? "inactive" : "active"}">${activeLabel}</span>
        ${product.featured === true ? `<span class="product-state featured">Mis en avant</span>` : ""}
      </div>
      <p class="muted">${escapeHtml(product.description || "Aucune description.")}</p>
    </div>
    <div class="product-admin-meta">
      <strong>${formatPrice(product.price)}</strong>
      <span>Stock: ${product.stock}</span>
      <button type="button" data-edit-product="${product.id}">Modifier</button>
      ${product.active === false ? "" : `<button type="button" class="danger-button" data-deactivate-product="${product.id}">Masquer</button>`}
    </div>
  </article>`;
}

function orderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = getOrderSubtotal(order);
  const deliveryFee = getOrderDeliveryFee(order);
  return `<article class="order-card ${isOrderToPrepare(order) ? "needs-prep" : ""}">
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
    ${orderAttentionHtml(order)}
    ${orderProgressHtml(order)}
    <div class="order-actions">
      <button type="button" data-view-order="${order.id}">Voir detail</button>
      <button type="button" class="ghost" data-print-order="${order.id}">Facture / recu</button>
      <a class="whatsapp-action" href="${whatsappUrl(order)}" target="_blank" rel="noopener">WhatsApp client</a>
    </div>
    <div class="order-body">
      <div>
        <h3>Client</h3>
        <p><strong>${escapeHtml(order.customerName)}</strong></p>
        <p>${escapeHtml(order.customerPhone)}</p>
        ${order.customerEmail ? `<p>${escapeHtml(order.customerEmail)}</p>` : ""}
        <p><strong>Zone:</strong> ${escapeHtml(getOrderDeliveryZone(order))}</p>
        <p>${escapeHtml(order.deliveryAddress)}</p>
      </div>
      <div>
        <h3>Produits</h3>
        <div class="items">${items.map(item => `<div class="item-line"><span>${escapeHtml(item.name)} x${item.quantity}</span><strong>${formatPrice(item.lineTotal)}</strong></div>`).join("") || "<p>Aucun detail produit.</p>"}</div>
        <div class="item-line delivery-line"><span>Sous-total</span><strong>${formatPrice(subtotal)}</strong></div>
        <div class="item-line delivery-line"><span>Livraison ${escapeHtml(getOrderDeliveryZone(order))}</span><strong>${formatPrice(deliveryFee)}</strong></div>
        <div class="order-total">${formatPrice(order.total)}</div>
        <p>${escapeHtml(order.paymentProvider)} &middot; ${escapeHtml(order.currency)}</p>
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
    ${quickActionsHtml(order)}
  </article>`;
}

function orderAttentionHtml(order) {
  if (order.orderStatus === "cancelled") {
    return `<div class="order-alert danger">Commande annulee. Aucune action client automatique n'est envoyee.</div>`;
  }
  if (order.paymentStatus !== "paid") {
    return `<div class="order-alert">Paiement a confirmer avant preparation.</div>`;
  }
  if (isOrderToPrepare(order)) {
    return `<div class="order-alert success">Paiement confirme. Cette commande peut etre preparee.</div>`;
  }
  return "";
}

function orderProgressHtml(order) {
  const steps = [
    ["pending", "Commande"],
    ["paid", "Payee"],
    ["preparing", "Preparation"],
    ["shipped", "Expedition"],
    ["delivered", "Livree"]
  ];
  const statusIndex = steps.findIndex(([status]) => status === order.orderStatus);
  const paymentBoost = order.paymentStatus === "paid" ? 1 : 0;
  const activeIndex = order.orderStatus === "cancelled" ? -1 : Math.max(statusIndex, paymentBoost);
  return `<div class="order-progress">
    ${steps.map(([status, label], index) => `<span class="${index <= activeIndex ? "active" : ""} ${order.orderStatus === status ? "current" : ""}">${label}</span>`).join("")}
  </div>`;
}

function quickActionsHtml(order) {
  if (order.orderStatus === "cancelled") return "";
  const actions = [];
  if (order.paymentStatus !== "paid") {
    actions.push(`<button type="button" class="ghost" data-set-payment-status="${order.id}" data-next-status="paid">Paiement recu</button>`);
  }
  if (!["preparing", "shipped", "delivered"].includes(order.orderStatus)) {
    actions.push(`<button type="button" data-set-order-status="${order.id}" data-next-status="preparing">Preparer</button>`);
  }
  if (order.orderStatus === "preparing") {
    actions.push(`<button type="button" data-set-order-status="${order.id}" data-next-status="shipped">Expedier</button>`);
  }
  if (order.orderStatus !== "delivered") {
    actions.push(`<button type="button" class="success-button" data-complete-order="${order.id}">Commande traitee</button>`);
  }
  actions.push(`<button type="button" class="danger-button" data-cancel-order="${order.id}">Annuler</button>`);
  return `<div class="quick-actions">${actions.join("")}</div>`;
}

function findOrder(id) {
  return orders.find(order => order.id === id);
}

function whatsappUrl(order) {
  const message = [
    `Bonjour ${order.customerName},`,
    `Votre commande ${order.id} chez DieguemTech Store est en statut: ${orderStatuses[order.orderStatus] || order.orderStatus}.`,
    `Livraison ${getOrderDeliveryZone(order)}: ${formatPrice(getOrderDeliveryFee(order))}.`,
    `Total a payer: ${formatPrice(order.total)}.`,
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
    subcategory: "",
    price: "",
    oldPrice: "",
    stock: 0,
    image: "",
    images: [],
    description: "",
    featured: false,
    active: true
  });
  $("#productModal").hidden = false;
}

function renderProductForm(product) {
  const isNew = !product.id;
  const images = getProductImages(product);
  const categoryOptions = getCategoryOptions();
  const subcategoryOptions = getSubcategoryOptions(product.category);
  $("#productForm").innerHTML = `<div class="product-form-head">
      <span class="eyebrow">${isNew ? "Nouveau produit" : `Produit #${product.id}`}</span>
      <h2>${isNew ? "Ajouter un produit" : "Modifier le produit"}</h2>
    </div>
    <label>Nom
      <input name="name" value="${escapeHtml(product.name)}" required>
    </label>
    <div class="form-grid">
      <label>Categorie
        <input name="category" list="productCategoryOptions" value="${escapeHtml(product.category)}" required>
        <datalist id="productCategoryOptions">
          ${categoryOptions.map(category => `<option value="${escapeHtml(category)}"></option>`).join("")}
        </datalist>
      </label>
      <label>Sous-categorie
        <input name="subcategory" list="productSubcategoryOptions" value="${escapeHtml(product.subcategory || "")}" placeholder="Ex: Ventilateurs, Projecteurs...">
        <datalist id="productSubcategoryOptions">
          ${subcategoryOptions.map(subcategory => `<option value="${escapeHtml(subcategory)}"></option>`).join("")}
        </datalist>
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
      <label>Statut boutique
        <select name="active">
          <option value="true" ${product.active === false ? "" : "selected"}>Publie sur la boutique</option>
          <option value="false" ${product.active === false ? "selected" : ""}>Masque de la boutique</option>
        </select>
      </label>
    </div>
    <label>Galerie images
      <textarea name="images" rows="5" placeholder="Une image par ligne. Exemple: assets/nom-du-produit.png">${escapeHtml(images.join("\n"))}</textarea>
      <small class="field-help">Formats acceptes: assets/photo.png, /assets/photo.png ou une URL https. La premiere image devient l'image principale.</small>
    </label>
    <div class="upload-card">
      <label class="upload-drop">Televerser des images
        <input id="productImageFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
      </label>
      <div>
        <strong>Ajout rapide</strong>
        <p>Choisis une ou plusieurs images depuis ton ordinateur. Elles seront ajoutees automatiquement dans la galerie.</p>
        <small id="productUploadStatus">JPG, PNG, WebP ou GIF. Maximum 5 Mo par image.</small>
      </div>
    </div>
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
      <input name="featured" type="checkbox" ${product.featured === true ? "checked" : ""}> Mettre ce produit en avant
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

function setProductUploadStatus(message, isError = false) {
  const status = $("#productUploadStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function uploadProductImages(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith("image/"));
  if (!files.length) {
    setProductUploadStatus("Selectionnez au moins une image.", true);
    return;
  }

  const textarea = $("#productForm textarea[name='images']");
  const currentImages = parseImageLines(textarea.value);
  const remainingSlots = 8 - currentImages.length;
  if (remainingSlots <= 0) {
    setProductUploadStatus("Maximum 8 images par produit.", true);
    return;
  }

  const selectedFiles = files.slice(0, remainingSlots);
  const formData = new FormData();
  selectedFiles.forEach(file => formData.append("images", file));

  setProductUploadStatus("Televersement en cours...");
  const result = await api("/api/admin/uploads", {
    method: "POST",
    body: formData
  });

  const uploadedUrls = (result.uploads || []).map(upload => upload.url).filter(Boolean);
  const nextImages = [...new Set([...currentImages, ...uploadedUrls])].slice(0, 8);
  textarea.value = nextImages.join("\n");
  updateProductImagePreview(textarea.value);

  const ignored = files.length - selectedFiles.length;
  setProductUploadStatus(`${uploadedUrls.length} image${uploadedUrls.length > 1 ? "s" : ""} ajoutee${uploadedUrls.length > 1 ? "s" : ""}.${ignored > 0 ? ` ${ignored} image${ignored > 1 ? "s" : ""} ignoree${ignored > 1 ? "s" : ""} car la limite est de 8.` : ""}`);
}

function receiptHtml(order, printable = true) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = getOrderSubtotal(order);
  const deliveryFee = getOrderDeliveryFee(order);
  return `<div class="${printable ? "receipt printable" : "receipt"}">
    <div class="receipt-head receipt-head-pro">
      <div class="receipt-logo"><img src="/assets/logo-mark.svg" alt="DieguemTech Store"></div>
      <div>
        <span class="eyebrow">Facture / recu</span>
        <h2>DieguemTech Store</h2>
        <p>High-Tech &middot; Gaming &middot; IPTV &middot; Accessoires</p>
      </div>
      <strong>${escapeHtml(order.id)}</strong>
    </div>
    <div class="receipt-meta">
      <div><span>Commande</span><strong>${escapeHtml(order.id)}</strong></div>
      <div><span>Date</span><strong>${formatDate(order.createdAt)}</strong></div>
      <div><span>Paiement</span><strong>${paymentStatuses[order.paymentStatus] || order.paymentStatus}</strong></div>
      <div><span>Statut</span><strong>${orderStatuses[order.orderStatus] || order.orderStatus}</strong></div>
    </div>
    <div class="receipt-columns">
      <section class="receipt-section">
        <h3>Boutique</h3>
        <p><strong>DieguemTech Store</strong><br>dieguemtechstore.com<br>WhatsApp: +221 77 217 71 76<br>Dakar, Senegal</p>
      </section>
      <section class="receipt-section">
        <h3>Client</h3>
        <p><strong>${escapeHtml(order.customerName)}</strong><br>${escapeHtml(order.customerPhone)}${order.customerEmail ? `<br>${escapeHtml(order.customerEmail)}` : ""}<br>Zone: ${escapeHtml(getOrderDeliveryZone(order))}<br>${escapeHtml(order.deliveryAddress)}</p>
      </section>
    </div>
    <section class="receipt-section">
      <h3>Produits</h3>
      <table>
        <thead><tr><th>Produit</th><th>Qte</th><th>Prix</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${formatPrice(item.unitPrice)}</td><td>${formatPrice(item.lineTotal)}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>
    <div class="receipt-totals">
      <div><span>Sous-total produits</span><strong>${formatPrice(subtotal)}</strong></div>
      <div><span>Livraison ${escapeHtml(getOrderDeliveryZone(order))}</span><strong>${formatPrice(deliveryFee)}</strong></div>
      <div class="receipt-total"><span>Total a payer</span><strong>${formatPrice(order.total)}</strong></div>
    </div>
    <p class="receipt-note">Merci pour votre confiance. Cette facture confirme l'enregistrement de la commande. La livraison et le paiement final peuvent etre confirmes par le support.</p>
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
  <title>Facture ${escapeHtml(order.id)} - DieguemTech Store</title>
  <link rel="stylesheet" href="admin.css">
</head>
<body class="print-body">
  ${receiptHtml(order)}
  <script>window.addEventListener("load",()=>{window.print();});<\/script>
</body>
</html>`);
  printWindow.document.close();
}

function exportOrdersCsv() {
  const filtered = getFilteredOrders();
  if (!filtered.length) {
    window.alert("Aucune commande a exporter avec les filtres actuels.");
    return;
  }
  const rows = [
    ["Commande", "Date", "Client", "Telephone", "Email", "Zone livraison", "Adresse", "Sous-total", "Frais livraison", "Total", "Devise", "Paiement", "Statut paiement", "Statut commande", "Produits"],
    ...filtered.map(order => [
      order.id,
      formatDate(order.createdAt),
      order.customerName,
      order.customerPhone,
      order.customerEmail || "",
      getOrderDeliveryZone(order),
      order.deliveryAddress,
      getOrderSubtotal(order),
      getOrderDeliveryFee(order),
      order.total,
      order.currency,
      order.paymentProvider,
      paymentStatuses[order.paymentStatus] || order.paymentStatus,
      orderStatuses[order.orderStatus] || order.orderStatus,
      (order.items || []).map(item => `${item.name} x${item.quantity}`).join(" | ")
    ])
  ];
  const csv = rows.map(row => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `commandes-dieguemtech-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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

async function completeOrder(id) {
  await updateStatus(id, {
    orderStatus: "delivered",
    paymentStatus: "paid"
  });
}

async function cancelOrder(id) {
  const order = findOrder(id);
  if (!order) return;
  const confirmed = window.confirm(`Annuler la commande ${order.id} ?`);
  if (!confirmed) return;
  await updateStatus(id, {
    orderStatus: "cancelled"
  });
}

async function saveProduct(form) {
  const formData = new FormData(form);
  const id = formData.get("id");
  const images = parseImageLines(formData.get("images"));
  const payload = {
    name: formData.get("name"),
    category: formData.get("category"),
    subcategory: formData.get("subcategory"),
    badge: formData.get("badge"),
    price: Number(formData.get("price")),
    oldPrice: formData.get("oldPrice") ? Number(formData.get("oldPrice")) : null,
    stock: Number(formData.get("stock")),
    image: images[0] || "",
    images,
    description: formData.get("description"),
    featured: formData.get("featured") === "on",
    active: formData.get("active") !== "false"
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
$("#exportOrders").addEventListener("click", exportOrdersCsv);
$("#testEmailButton").addEventListener("click", () => {
  testAdminEmail().catch(error => window.alert(error.message));
});
$("#orderSearch").addEventListener("input", renderOrders);
$("#statusFilter").addEventListener("change", renderOrders);
$("#paymentFilter").addEventListener("change", renderOrders);
$("#dateFilter").addEventListener("change", renderOrders);
$("#productSearch").addEventListener("input", renderProducts);
$("#productCategoryFilter").addEventListener("change", renderProducts);
$("#productStatusFilter").addEventListener("change", renderProducts);
$("#productFeaturedFilter").addEventListener("change", renderProducts);
$("#addProductButton").addEventListener("click", openCreateProductModal);

document.addEventListener("change", event => {
  handleStatusChange(event).catch(error => window.alert(error.message));
});

async function handleStatusChange(event) {
  const orderStatus = event.target.closest("[data-order-status]");
  const paymentStatus = event.target.closest("[data-payment-status]");
  if (orderStatus) await updateStatus(orderStatus.dataset.orderStatus, { orderStatus: orderStatus.value });
  if (paymentStatus) await updateStatus(paymentStatus.dataset.paymentStatus, { paymentStatus: paymentStatus.value });
}

document.addEventListener("click", event => {
  handleDocumentClick(event).catch(error => window.alert(error.message));
});

async function handleDocumentClick(event) {
  const viewButton = event.target.closest("[data-view-order]");
  const printButton = event.target.closest("[data-print-order]");
  const editProductButton = event.target.closest("[data-edit-product]");
  const deactivateProductButton = event.target.closest("[data-deactivate-product]");
  const orderStatusButton = event.target.closest("[data-set-order-status]");
  const paymentStatusButton = event.target.closest("[data-set-payment-status]");
  const completeButton = event.target.closest("[data-complete-order]");
  const cancelButton = event.target.closest("[data-cancel-order]");
  if (orderStatusButton) return updateStatus(orderStatusButton.dataset.setOrderStatus, { orderStatus: orderStatusButton.dataset.nextStatus });
  if (paymentStatusButton) return updateStatus(paymentStatusButton.dataset.setPaymentStatus, { paymentStatus: paymentStatusButton.dataset.nextStatus });
  if (completeButton) return completeOrder(completeButton.dataset.completeOrder);
  if (cancelButton) return cancelOrder(cancelButton.dataset.cancelOrder);
  if (viewButton) openOrderModal(viewButton.dataset.viewOrder);
  if (printButton) printOrder(printButton.dataset.printOrder);
  if (editProductButton) openProductModal(editProductButton.dataset.editProduct);
  if (deactivateProductButton) await deactivateProduct(deactivateProductButton.dataset.deactivateProduct);
}

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
  if (event.target.name === "category") {
    const datalist = $("#productSubcategoryOptions");
    if (datalist) {
      datalist.innerHTML = getSubcategoryOptions(event.target.value)
        .map(subcategory => `<option value="${escapeHtml(subcategory)}"></option>`)
        .join("");
    }
  }
});
$("#productForm").addEventListener("change", async event => {
  if (event.target.id !== "productImageFiles") return;
  try {
    await uploadProductImages(event.target.files);
  } catch (error) {
    setProductUploadStatus(error.message, true);
  } finally {
    event.target.value = "";
  }
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
  Promise.all([loadOrders(), loadEmailStatus()]).catch(() => logout());
}
