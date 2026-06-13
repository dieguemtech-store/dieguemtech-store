const express = require("express");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const products = require("./data/products");

const app = express();
const port = process.env.PORT || 3000;
const ordersFile = path.join(__dirname, "data", "orders.json");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (request, response) => {
  response.json({ status: "ok", service: "dieguemtech-store" });
});

app.get("/api/products", (request, response) => {
  const category = String(request.query.category || "").toLowerCase();
  const search = String(request.query.search || "").trim().toLowerCase();
  const result = products.filter(product => {
    const matchesCategory = !category || product.category.toLowerCase() === category;
    const matchesSearch = !search || `${product.name} ${product.category}`.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });

  response.json(result);
});

app.get("/api/products/:id", (request, response) => {
  const product = products.find(item => item.id === Number(request.params.id));
  if (!product) return response.status(404).json({ error: "Produit introuvable." });
  response.json(product);
});

app.post("/api/orders", async (request, response, next) => {
  try {
    const { customer, items, paymentProvider } = request.body;
    const validationError = validateOrder(customer, items, paymentProvider);
    if (validationError) return response.status(400).json({ error: validationError });

    const normalizedItems = [];
    for (const item of items) {
      const product = products.find(entry => entry.id === Number(item.id));
      const quantity = Number(item.quantity);
      if (!product) return response.status(400).json({ error: `Produit ${item.id} introuvable.` });
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return response.status(400).json({ error: "Quantité invalide." });
      }
      if (quantity > product.stock) {
        return response.status(409).json({ error: `Stock insuffisant pour ${product.name}.` });
      }
      normalizedItems.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity,
        lineTotal: product.price * quantity
      });
    }

    const order = {
      id: `DT-${Date.now()}-${crypto.randomInt(100, 999)}`,
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        address: customer.address.trim()
      },
      items: normalizedItems,
      total: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
      currency: "XOF",
      paymentProvider,
      paymentStatus: "pending",
      orderStatus: "pending",
      createdAt: new Date().toISOString()
    };

    await saveOrder(order);
    response.status(201).json({
      orderId: order.id,
      total: order.total,
      currency: order.currency,
      paymentProvider: order.paymentProvider,
      paymentStatus: order.paymentStatus
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html"
}));

app.use((error, request, response, next) => {
  console.error(error);
  response.status(500).json({ error: "Une erreur interne est survenue." });
});

function validateOrder(customer, items, paymentProvider) {
  if (!customer || !customer.name?.trim() || !customer.phone?.trim() || !customer.address?.trim()) {
    return "Les coordonnées de livraison sont incomplètes.";
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return "Le panier est vide ou invalide.";
  }
  if (!["PayDunya", "PayTech"].includes(paymentProvider)) {
    return "Moyen de paiement invalide.";
  }
  return null;
}

async function saveOrder(order) {
  let orders = [];
  try {
    orders = JSON.parse(await fs.readFile(ordersFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  orders.push(order);
  await fs.writeFile(ordersFile, JSON.stringify(orders, null, 2));
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`DieguemTech Store disponible sur http://localhost:${port}`);
  });
}

module.exports = app;
