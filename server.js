const axios = require("axios");

const PAYTECH_API_KEY = process.env.PAYTECH_API_KEY;
const PAYTECH_API_SECRET = process.env.PAYTECH_API_SECRET;

const express = require("express");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const localProducts = require("./data/products");
const database = require("./db");

const app = express();
const port = process.env.PORT || 3000;
const ordersFile = path.join(__dirname, "data", "orders.json");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "DieguemTech Store",
    database: database.hasDatabase ? "postgresql" : "local"
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

app.get("/api/products/:id", async (req, res, next) => {
  try {
    const product = await database.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ error: "Produit introuvable." });
    res.json(product);
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", async (request, response, next) => {
  try {
    const { customer, items, paymentProvider } = request.body;
    const validationError = validateOrder(customer, items, paymentProvider);
    if (validationError) return response.status(400).json({ error: validationError });

    const preparedItems = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
        return response.status(400).json({ error: "Quantité invalide." });
      }
      preparedItems.push({ id: Number(item.id), quantity });
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
app.post("/api/paytech/create", async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    const response = await axios.post(
      "https://paytech.sn/api/payment/request-payment",
      {
        item_name: "Commande DieguemTech",
        item_price: amount,
        currency: "XOF",
        ref_command: orderId,
        command_name: `Commande ${orderId}`,
        env: "prod",
        success_url:
          "https://dieguemtech-store.onrender.com/payment-success",
        cancel_url:
          "https://dieguemtech-store.onrender.com/payment-cancel",
        ipn_url:
          "https://dieguemtech-store.onrender.com/api/paytech/ipn"
      },
      {
        headers: {
          API_KEY: PAYTECH_API_KEY,
          API_SECRET: PAYTECH_API_SECRET
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);

    res.status(500).json({
      error: "Erreur PayTech"
    });
  }
});

app.post("/api/paytech/ipn", (req, res) => {
  console.log("Notification PayTech :", req.body);
  res.status(200).send("OK");
});
app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html"
}));

app.use((error, request, response, next) => {
  console.error(error);
  response.status(error.status || 500).json({
    error: error.status ? error.message : "Une erreur interne est survenue."
  });
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
