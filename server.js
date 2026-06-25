const axios = require("axios");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");

const localProducts = require("./data/products");
const database = require("./db");

const app = express();
const port = process.env.PORT || 3000;
const ordersFile = path.join(__dirname, "data", "orders.json");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (request, response) => {
  response.json({
    status: "ok",
    service: "DieguemTech Store",
    database: database.hasDatabase ? "postgresql" : "local"
  });
});

app.get("/api/paytech/status", (request, response) => {
  response.json({
    configured: hasPayTechConfig(),
    mode: getPayTechMode()
  });
});

app.get("/api/products", async (request, response, next) => {
  try {
    const category = String(request.query.category || "").toLowerCase();
    const search = String(request.query.search || "").trim().toLowerCase();
    const result = await database.getProducts({ category, search });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/products/:id", async (request, response, next) => {
  try {
    const product = await database.getProduct(Number(request.params.id));
    if (!product) return response.status(404).json({ error: "Produit introuvable." });
    response.json(product);
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", async (request, response, next) => {
  try {
    const { customer, items, paymentProvider } = request.body;
    const validationError = validateOrder(customer, items, paymentProvider);
    if (validationError) return response.status(400).json({ error: validationError });

    if (paymentProvider === "PayTech" && !hasPayTechConfig()) {
      return response.status(503).json({
        error: "PayTech n'est pas encore configure. Ajoutez PAYTECH_API_KEY et PAYTECH_API_SECRET dans Render."
      });
    }

    const preparedItems = [];
    for (const item of items) {
      const id = Number(item.id);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(id) || id < 1) {
        return response.status(400).json({ error: "Produit invalide dans le panier." });
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return response.status(400).json({ error: "Quantite invalide." });
      }
      preparedItems.push({ id, quantity });
    }

    const orderInput = {
      id: `DT-${Date.now()}-${crypto.randomInt(100, 999)}`,
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        address: customer.address.trim()
      },
      items: preparedItems,
      paymentProvider
    };

    const order = database.hasDatabase
      ? await database.createOrder(orderInput)
      : await createLocalOrder(orderInput);

    if (paymentProvider === "PayTech") {
      const payment = await createPayTechPayment(order, request);
      return response.status(201).json({
        orderId: order.id,
        total: order.total,
        currency: order.currency,
        paymentProvider: order.paymentProvider,
        paymentStatus: "pending",
        redirect_url: payment.redirectUrl
      });
    }

    response.status(201).json({
      orderId: order.id,
      total: order.total,
      currency: order.currency,
      paymentProvider: order.paymentProvider,
      paymentStatus: "pending"
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/paytech/ipn", (request, response) => {
  console.log("Notification PayTech:", {
    type_event: request.body?.type_event,
    ref_command: request.body?.ref_command,
    payment_method: request.body?.payment_method,
    item_price: request.body?.item_price
  });
  response.status(200).send("OK");
});

app.get("/payment-success", (request, response) => {
  response.send(renderPaymentPage(
    "Paiement en cours de confirmation",
    "Merci pour votre commande. Nous avons recu le retour PayTech et votre paiement sera confirme automatiquement.",
    "success"
  ));
});

app.get("/payment-cancel", (request, response) => {
  response.send(renderPaymentPage(
    "Paiement annule",
    "Votre paiement n'a pas ete finalise. Vous pouvez revenir a la boutique et reessayer.",
    "cancel"
  ));
});

app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html"
}));

app.use((error, request, response, next) => {
  console.error(error.response?.data || error);
  response.status(error.status || 500).json({
    error: error.status ? error.message : "Une erreur interne est survenue."
  });
});

function validateOrder(customer, items, paymentProvider) {
  if (!customer || !customer.name?.trim() || !customer.phone?.trim() || !customer.address?.trim()) {
    return "Les coordonnees de livraison sont incompletes.";
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return "Le panier est vide ou invalide.";
  }
  if (!["PayDunya", "PayTech"].includes(paymentProvider)) {
    return "Moyen de paiement invalide.";
  }
  return null;
}

function hasPayTechConfig() {
  return Boolean(process.env.PAYTECH_API_KEY && process.env.PAYTECH_API_SECRET);
}

function getPayTechMode() {
  const mode = String(process.env.PAYTECH_MODE || "test").trim().toLowerCase();
  if (["prod", "production", "live"].includes(mode)) return "prod";
  if (["test", "sandbox", "testing"].includes(mode)) return "test";
  return "test";
}

function getBaseUrl(request) {
  return (process.env.APP_URL || `${request.protocol}://${request.get("host")}`).replace(/\/$/, "");
}

async function createPayTechPayment(order, request) {
  const baseUrl = getBaseUrl(request);
  const payload = {
    item_name: "Commande DieguemTech",
    item_price: order.total,
    currency: "XOF",
    ref_command: order.id,
    command_name: `Commande ${order.id}`,
    env: getPayTechMode(),
    success_url: `${baseUrl}/payment-success`,
    cancel_url: `${baseUrl}/payment-cancel`,
    ipn_url: `${baseUrl}/api/paytech/ipn`
  };

  try {
    const paytechResponse = await axios.post(
      "https://paytech.sn/api/payment/request-payment",
      payload,
      {
        headers: {
          API_KEY: process.env.PAYTECH_API_KEY,
          API_SECRET: process.env.PAYTECH_API_SECRET
        },
        timeout: 15000
      }
    );

    const data = paytechResponse.data || {};
    const redirectUrl = data.redirect_url || data.payment_url || data.url;
    if (!redirectUrl) {
      const error = new Error("PayTech n'a pas renvoye de lien de paiement.");
      error.status = 502;
      throw error;
    }
    return { redirectUrl };
  } catch (error) {
    if (error.status) throw error;
    const paymentError = new Error("PayTech est indisponible ou a refuse la demande de paiement.");
    paymentError.status = 502;
    paymentError.cause = error;
    throw paymentError;
  }
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

async function createLocalOrder(orderInput) {
  const normalizedItems = [];
  for (const item of orderInput.items) {
    const product = localProducts.find(entry => entry.id === item.id);
    if (!product) {
      const error = new Error(`Produit ${item.id} introuvable.`);
      error.status = 400;
      throw error;
    }
    if (item.quantity > product.stock) {
      const error = new Error(`Stock insuffisant pour ${product.name}.`);
      error.status = 409;
      throw error;
    }
    normalizedItems.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: item.quantity,
      lineTotal: product.price * item.quantity
    });
  }
  const order = {
    ...orderInput,
    items: normalizedItems,
    total: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
    currency: "XOF",
    paymentStatus: "pending",
    orderStatus: "pending",
    createdAt: new Date().toISOString()
  };
  await saveOrder(order);
  return order;
}

function renderPaymentPage(title, message, status) {
  const color = status === "success" ? "#16a66a" : "#f68b1e";
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - DieguemTech Store</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f7f7f7;color:#313133;display:grid;min-height:100vh;place-items:center}
    main{width:min(520px,calc(100% - 32px));background:#fff;border-radius:18px;padding:34px;box-shadow:0 18px 45px rgba(0,0,0,.08);text-align:center}
    .mark{width:64px;height:64px;border-radius:50%;background:${color};color:#fff;display:grid;place-items:center;margin:0 auto 18px;font-size:30px;font-weight:800}
    h1{font-size:28px;margin:0 0 12px}
    p{color:#666;line-height:1.7;margin:0 0 24px}
    a{display:inline-flex;background:#f68b1e;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700}
  </style>
</head>
<body>
  <main>
    <div class="mark">${status === "success" ? "✓" : "!"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Retour a la boutique</a>
  </main>
</body>
</html>`;
}

if (require.main === module) {
  database.initializeDatabase()
    .then(() => {
      app.listen(port, () => {
        console.log(`DieguemTech Store disponible sur http://localhost:${port}`);
      });
    })
    .catch(error => {
      console.error("Initialisation de la base impossible.", error);
      process.exit(1);
    });
}

module.exports = app;
