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

document.addEventListener("change", async event => {
  const orderStatus = event.target.closest("[data-order-status]");
  const paymentStatus = event.target.closest("[data-payment-status]");
  if (orderStatus) await updateStatus(orderStatus.dataset.orderStatus, { orderStatus: orderStatus.value });
  if (paymentStatus) await updateStatus(paymentStatus.dataset.paymentStatus, { paymentStatus: paymentStatus.value });
});

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view-order]");
  const printButton = event.target.closest("[data-print-order]");
  if (viewButton) openOrderModal(viewButton.dataset.viewOrder);
  if (printButton) printOrder(printButton.dataset.printOrder);
});

$("#closeOrderModal").addEventListener("click", closeOrderModal);
$("#orderModal").addEventListener("click", event => {
  if (event.target.id === "orderModal") closeOrderModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("#orderModal").hidden) closeOrderModal();
});

if (token) {
  showDashboard();
  loadOrders().catch(() => logout());
}
