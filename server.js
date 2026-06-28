const axios = require("axios");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const multer = require("multer");

const localProducts = require("./data/products");
const database = require("./db");

const app = express();
const port = process.env.PORT || 3000;
const ordersFile = path.join(__dirname, "data", "orders.json");
const deliveryOptions = {
  Dakar: { zone: "Dakar", label: "Dakar", fee: 1500 },
  Pikine: { zone: "Pikine", label: "Pikine", fee: 2000 },
  Guediawaye: { zone: "Guediawaye", label: "Guediawaye", fee: 2000 },
  Rufisque: { zone: "Rufisque", label: "Rufisque", fee: 2500 },
  Thies: { zone: "Thies", label: "Thies", fee: 4000 },
  Mbour: { zone: "Mbour", label: "Mbour", fee: 4000 },
  "Autre zone Senegal": { zone: "Autre zone Senegal", label: "Autre zone au Senegal", fee: 5000 }
};
const defaultPayDunyaMinimumAmount = 6000;
const cashOnDeliveryProvider = "Paiement livraison";
const waveProvider = "Wave";
const wavePaymentUrl = process.env.WAVE_PAYMENT_URL || "https://pay.wave.com/m/M_sn_Y0u8_bUZ_dN-/c/sn/";
const analyticsEventNames = new Set([
  "page_view",
  "product_view",
  "category_view",
  "search",
  "add_to_cart",
  "wishlist_toggle",
  "cart_open",
  "checkout_open",
  "payment_selected",
  "checkout_submit",
  "order_created",
  "order_track"
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 8
  },
  fileFilter: (request, file, callback) => {
    if (isAllowedUploadMimeType(file.mimetype)) return callback(null, true);
    const error = new Error("Format image non accepte. Utilisez JPG, PNG, WebP ou GIF.");
    error.status = 400;
    callback(error);
  }
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.get("/api/health", (request, response) => {
  response.json({
    status: "ok",
    service: "DieguemTech Store",
    database: database.hasDatabase ? "postgresql" : "local"
  });
});

app.get("/api/paydunya/status", (request, response) => {
  response.json({
    configured: hasPayDunyaConfig(),
    mode: getPayDunyaMode(),
    minimumAmount: getPayDunyaMinimumAmount(),
    missing: getPayDunyaMissingConfig()
  });
});

app.get("/api/email/status", (request, response) => {
  response.json(getEmailStatus());
});

app.post("/api/analytics", async (request, response, next) => {
  try {
    const eventName = String(request.body?.eventName || request.body?.name || "").trim();
    if (!analyticsEventNames.has(eventName)) {
      return response.status(400).json({ error: "Evenement analytics invalide." });
    }

    const productId = Number(request.body?.productId);
    const value = Number(request.body?.value);
    await database.recordAnalyticsEvent({
      eventName,
      path: cleanAnalyticsString(request.body?.path, 240) || cleanAnalyticsPath(request),
      productId: Number.isInteger(productId) && productId > 0 ? productId : null,
      productName: cleanAnalyticsString(request.body?.productName, 180),
      category: cleanAnalyticsString(request.body?.category, 120),
      value: Number.isFinite(value) && value > 0 ? Math.round(value) : 0,
      metadata: normalizeAnalyticsMetadata(request.body?.metadata),
      sessionId: cleanAnalyticsString(request.body?.sessionId, 100),
      referrer: cleanAnalyticsString(request.body?.referrer || request.get("referer"), 500),
      userAgent: cleanAnalyticsString(request.get("user-agent"), 500)
    });

    response.status(202).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/login", (request, response) => {
  const { password } = request.body || {};
  if (!getAdminPassword()) {
    return response.status(503).json({ error: "ADMIN_PASSWORD n'est pas configure dans Render." });
  }
  if (password !== getAdminPassword()) {
    return response.status(401).json({ error: "Mot de passe admin invalide." });
  }
  response.json({ token: getAdminPassword() });
});

app.post("/api/admin/email/test", requireAdmin, async (request, response) => {
  const adminEmail = getOrderAdminEmail();
  if (!adminEmail) {
    return response.status(400).json({
      error: "Ajoutez ORDER_ADMIN_EMAIL dans Render pour recevoir les notifications admin.",
      email: getEmailStatus()
    });
  }

  try {
    const status = await sendOrderEmail({
      to: adminEmail,
      subject: "Test email - DieguemTech Store",
      text: "Ceci est un test de notification email DieguemTech Store. Si vous recevez ce message, les emails admin sont actifs.",
      html: `<p>Ceci est un test de notification email <strong>DieguemTech Store</strong>.</p><p>Si vous recevez ce message, les emails admin sont actifs.</p>`
    });

    if (status !== "sent") {
      return response.status(503).json({
        error: "Email non envoye. La configuration Resend est incomplete.",
        status,
        email: getEmailStatus()
      });
    }

    response.json({
      status: "sent",
      message: "Email test envoye a l'adresse admin.",
      email: getEmailStatus()
    });
  } catch (error) {
    response.status(502).json({
      error: "Resend a refuse l'email de test.",
      detail: getNotificationError(error),
      hint: getEmailErrorHint(error),
      email: getEmailStatus()
    });
  }
});

app.get("/api/admin/orders", requireAdmin, async (request, response, next) => {
  try {
    response.json(await database.getOrders());
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/analytics", requireAdmin, async (request, response, next) => {
  try {
    const days = getAnalyticsRangeDays(request.query.days);
    const events = await database.getAnalyticsEvents(days);
    response.json(buildAnalyticsSummary(events, days));
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/backup", requireAdmin, async (request, response, next) => {
  try {
    const backup = await buildAdminBackup(request);
    const stamp = new Date().toISOString().slice(0, 10);
    response.set({
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dieguemtech-store-backup-${stamp}.json"`
    });
    response.send(JSON.stringify(backup, null, 2));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/orders/:id", requireAdmin, async (request, response, next) => {
  try {
    const { orderStatus, paymentStatus } = request.body || {};
    if (orderStatus && !getOrderStatuses().includes(orderStatus)) {
      return response.status(400).json({ error: "Statut de commande invalide." });
    }
    if (paymentStatus && !getPaymentStatuses().includes(paymentStatus)) {
      return response.status(400).json({ error: "Statut de paiement invalide." });
    }
    const previousOrder = await database.getOrder(request.params.id);
    const order = await database.updateOrderStatus(request.params.id, { orderStatus, paymentStatus });
    if (!order) return response.status(404).json({ error: "Commande introuvable." });
    const fullOrder = await database.getOrder(order.id) || order;
    const notifications = await notifyPaidOrderIfNeeded(fullOrder, request, previousOrder);
    response.json({ ...fullOrder, notifications });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/products", requireAdmin, async (request, response, next) => {
  try {
    response.json(await database.getAdminProducts());
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/products", requireAdmin, async (request, response, next) => {
  try {
    const validationError = validateProductUpdate(request.body || {});
    if (validationError) return response.status(400).json({ error: validationError });

    const product = await database.createProduct(request.body);
    response.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/products/:id", requireAdmin, async (request, response, next) => {
  try {
    const validationError = validateProductUpdate(request.body || {});
    if (validationError) return response.status(400).json({ error: validationError });

    const product = await database.updateProduct(request.params.id, request.body);
    if (!product) return response.status(404).json({ error: "Produit introuvable." });
    response.json(product);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (request, response, next) => {
  try {
    const product = await database.deactivateProduct(request.params.id);
    if (!product) return response.status(404).json({ error: "Produit introuvable." });
    response.json(product);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/uploads", requireAdmin, upload.array("images", 8), async (request, response, next) => {
  try {
    const files = Array.isArray(request.files) ? request.files : [];
    if (!files.length) return response.status(400).json({ error: "Selectionnez au moins une image." });

    const uploads = [];
    for (const file of files) {
      uploads.push(await database.createProductUpload({
        id: createProductUploadId(file),
        filename: file.originalname || "image-produit",
        mimeType: file.mimetype,
        size: file.size,
        data: file.buffer
      }));
    }

    response.status(201).json({ uploads });
  } catch (error) {
    next(error);
  }
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

app.get("/api/uploads/:id", async (request, response, next) => {
  try {
    const uploadRecord = await database.getProductUpload(request.params.id);
    if (!uploadRecord) return response.status(404).send("Image introuvable.");

    response.set("Cache-Control", "public, max-age=31536000, immutable");
    response.type(uploadRecord.mimeType);
    response.send(uploadRecord.data);
  } catch (error) {
    next(error);
  }
});

app.get("/sitemap.xml", async (request, response, next) => {
  try {
    const products = await database.getProducts();
    response.type("application/xml").send(renderSitemap(getPublicBaseUrl(request), products));
  } catch (error) {
    next(error);
  }
});

app.get("/produit/:id", renderProductSeoRoute);
app.get("/produit/:id/:slug", renderProductSeoRoute);
app.get("/categorie/:categorySlug", renderCategorySeoRoute);
app.get("/categorie/:categorySlug/:subcategorySlug", renderCategorySeoRoute);

app.post("/api/orders", async (request, response, next) => {
  try {
    const { customer, items, paymentProvider } = request.body;
    const validationError = validateOrder(customer, items, paymentProvider);
    if (validationError) return response.status(400).json({ error: validationError });

    if (paymentProvider === "PayDunya" && !hasPayDunyaConfig()) {
      return response.status(503).json({
        error: `PayDunya n'est pas encore configure. Variable(s) manquante(s) dans Render: ${getPayDunyaMissingConfig().join(", ")}.`
      });
    }
    const delivery = getDeliveryOption(customer.deliveryZone);

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

    const estimatedOrder = await estimateOrderBeforePayment(preparedItems, delivery);
    if (paymentProvider === "PayDunya" && estimatedOrder.total < getPayDunyaMinimumAmount()) {
      return response.status(400).json({
        error: `PayDunya accepte les paiements a partir de ${formatSeoPrice(getPayDunyaMinimumAmount())}. Total actuel: ${formatSeoPrice(estimatedOrder.total)}. Ajoutez un produit ou choisissez un autre moyen de paiement.`
      });
    }

    const orderInput = {
      id: `DT-${Date.now()}-${crypto.randomInt(100, 999)}`,
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: normalizeEmail(customer.email),
        address: customer.address.trim()
      },
      deliveryZone: delivery.zone,
      deliveryFee: delivery.fee,
      items: preparedItems,
      paymentProvider
    };

    const order = database.hasDatabase
      ? await database.createOrder(orderInput)
      : await createLocalOrder(orderInput);

    if (paymentProvider === "PayDunya") {
      const payment = await createPayDunyaPayment(order, request);
      return response.status(201).json({
        orderId: order.id,
        total: order.total,
        currency: order.currency,
        paymentProvider: order.paymentProvider,
        paymentStatus: "pending",
        subtotal: order.subtotal,
        deliveryZone: order.deliveryZone,
        deliveryFee: order.deliveryFee,
        redirect_url: payment.redirectUrl,
        payment_token: payment.token,
        notifications: getDeferredPaymentNotifications()
      });
    }

    response.status(201).json({
      orderId: order.id,
      total: order.total,
      currency: order.currency,
      paymentProvider: order.paymentProvider,
      paymentStatus: "pending",
      subtotal: order.subtotal,
      deliveryZone: order.deliveryZone,
      deliveryFee: order.deliveryFee,
      notifications: getDeferredPaymentNotifications()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/track", async (request, response, next) => {
  try {
    const orderId = String(request.body?.orderId || "").trim().toUpperCase();
    const phone = String(request.body?.phone || "").trim();
    if (!orderId || !phone) {
      return response.status(400).json({ error: "Numero de commande et telephone requis." });
    }

    const order = await database.getOrder(orderId);
    if (!order || normalizePhone(order.customerPhone) !== normalizePhone(phone)) {
      return response.status(404).json({ error: "Commande introuvable avec ces informations." });
    }

    response.json({
      id: order.id,
      subtotal: order.subtotal,
      deliveryZone: order.deliveryZone,
      deliveryFee: order.deliveryFee,
      total: order.total,
      currency: order.currency,
      paymentProvider: order.paymentProvider,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      createdAt: order.createdAt,
      items: order.items || []
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/paydunya/ipn", async (request, response, next) => {
  try {
    const data = parsePayDunyaData(request.body?.data || request.body);
    if (!verifyPayDunyaHash(data?.hash)) {
      return response.status(403).send("Invalid PayDunya hash");
    }

    const update = await updateOrderFromPayDunyaData(data);
    const notifications = await notifyPaidOrderIfNeeded(update.order, request, update.previousOrder);
    console.log("Notification PayDunya:", {
      orderId: update.orderId,
      status: data?.status,
      paymentStatus: update.paymentStatus,
      orderUpdated: Boolean(update.order),
      paidNotifications: notifications
    });
    response.status(200).send("OK");
  } catch (error) {
    next(error);
  }
});

app.get("/payment-success/paydunya", async (request, response, next) => {
  try {
    const token = String(request.query.token || "").trim();
    if (!token) {
      return response.send(renderPaymentPage(
        "Paiement en cours de confirmation",
        "Merci pour votre commande. PayDunya confirmera automatiquement le paiement des que la transaction sera finalisee.",
        "success"
      ));
    }

    const data = await confirmPayDunyaInvoice(token);
    const update = await updateOrderFromPayDunyaData(data);
    await notifyPaidOrderIfNeeded(update.order, request, update.previousOrder);
    const isPaid = update.paymentStatus === "paid";
    const isFailed = update.paymentStatus === "failed";
    response.send(renderPaymentPage(
      isPaid ? "Paiement confirme" : isFailed ? "Paiement non confirme" : "Paiement en cours de confirmation",
      isPaid
        ? "Merci pour votre commande. Votre paiement PayDunya a ete confirme."
        : isFailed
          ? "Le paiement PayDunya n'a pas ete finalise. Vous pouvez revenir a la boutique et reessayer."
          : "Merci pour votre commande. Le paiement PayDunya est encore en cours de confirmation.",
      isPaid ? "success" : isFailed ? "cancel" : "pending"
    ));
  } catch (error) {
    next(error);
  }
});

app.get("/payment-cancel", (request, response) => {
  response.send(renderPaymentPage(
    "Paiement annule",
    "Votre paiement n'a pas ete finalise. Vous pouvez revenir a la boutique et reessayer.",
    "cancel"
  ));
});

app.get("/site.webmanifest", (request, response) => {
  response.type("application/manifest+json").sendFile(path.join(__dirname, "site.webmanifest"));
});

app.get("/sw.js", (request, response) => {
  response.set("Cache-Control", "no-cache, no-store, must-revalidate");
  response.type("application/javascript").sendFile(path.join(__dirname, "sw.js"));
});

app.get("/favicon.ico", (request, response) => {
  response.redirect(301, "/assets/favicon.svg");
});

app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html"
}));

app.use((error, request, response, next) => {
  console.error(error.response?.data || error);
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Image trop lourde. Maximum 5 Mo par fichier."
      : "Televersement impossible. Verifiez les images selectionnees.";
    return response.status(400).json({ error: message });
  }
  response.status(error.status || 500).json({
    error: error.status ? error.message : "Une erreur interne est survenue."
  });
});

function validateOrder(customer, items, paymentProvider) {
  if (!customer || !customer.name?.trim() || !customer.phone?.trim() || !customer.address?.trim()) {
    return "Les coordonnees de livraison sont incompletes.";
  }
  if (customer.email && !isValidEmail(customer.email)) {
    return "Adresse email invalide.";
  }
  if (!getDeliveryOption(customer.deliveryZone)) {
    return "Zone de livraison invalide.";
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    return "Le panier est vide ou invalide.";
  }
  if (!["PayDunya", waveProvider, cashOnDeliveryProvider].includes(paymentProvider)) {
    return "Moyen de paiement invalide.";
  }
  return null;
}

async function estimateOrderBeforePayment(items, delivery) {
  const normalizedItems = [];
  for (const item of items) {
    const product = await database.getProduct(item.id);
    if (!product) {
      const error = new Error(`Produit ${item.id} introuvable.`);
      error.status = 400;
      throw error;
    }
    if (item.quantity > Number(product.stock || 0)) {
      const error = new Error(`Stock insuffisant pour ${product.name}.`);
      error.status = 409;
      throw error;
    }
    const lineTotal = Number(product.price || 0) * item.quantity;
    normalizedItems.push({ ...item, product, lineTotal });
  }
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = Number(delivery?.fee || 0);
  return {
    items: normalizedItems,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee
  };
}

function validateProductUpdate(product) {
  if (!product.name?.trim()) return "Le nom du produit est requis.";
  if (!product.category?.trim()) return "La categorie est requise.";
  if (String(product.subcategory || "").length > 80) return "La sous-categorie est trop longue.";
  if (product.price === "" || typeof product.price === "undefined" || !Number.isInteger(Number(product.price)) || Number(product.price) < 0) return "Prix invalide.";
  if (product.oldPrice !== null && product.oldPrice !== "" && typeof product.oldPrice !== "undefined" && (!Number.isInteger(Number(product.oldPrice)) || Number(product.oldPrice) < 0)) {
    return "Ancien prix invalide.";
  }
  if (product.stock === "" || typeof product.stock === "undefined" || !Number.isInteger(Number(product.stock)) || Number(product.stock) < 0) return "Stock invalide.";
  const images = collectProductImages(product);
  if (images.length > 8) return "Maximum 8 images par produit.";
  const invalidImage = images.find(image => !isValidProductImage(image));
  if (invalidImage) return "Chaque image doit etre une URL http(s) ou un chemin assets/photo.png.";
  return null;
}

function collectProductImages(product) {
  const candidates = [];
  if (product.image) candidates.push(product.image);
  if (Array.isArray(product.images)) {
    candidates.push(...product.images);
  } else if (typeof product.images === "string") {
    candidates.push(...product.images.split(/[\n,]/));
  }
  return [...new Set(
    candidates
      .map(normalizeProductImagePath)
      .filter(Boolean)
  )];
}

function isValidProductImage(image) {
  return String(image).startsWith("/") || /^https?:\/\//.test(String(image));
}

function isAllowedUploadMimeType(mimeType) {
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(String(mimeType || "").toLowerCase());
}

function createProductUploadId(file) {
  const extension = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  }[String(file.mimetype || "").toLowerCase()] || "";
  return `${crypto.randomUUID()}${extension}`;
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

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("221")) return digits.slice(3);
  return digits.replace(/^0+/, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getDeliveryOption(zone) {
  return deliveryOptions[String(zone || "").trim()] || null;
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "";
}

function requireAdmin(request, response, next) {
  const token = String(request.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!getAdminPassword()) {
    return response.status(503).json({ error: "ADMIN_PASSWORD n'est pas configure dans Render." });
  }
  if (token !== getAdminPassword()) {
    return response.status(401).json({ error: "Acces admin refuse." });
  }
  next();
}

function getOrderStatuses() {
  return ["pending", "paid", "preparing", "shipped", "delivered", "cancelled"];
}

function getPaymentStatuses() {
  return ["pending", "paid", "failed", "refunded"];
}

function cleanAnalyticsString(value, maxLength = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanAnalyticsPath(request) {
  const referer = String(request.get("referer") || "");
  try {
    const url = new URL(referer);
    return `${url.pathname}${url.search}`.slice(0, 240);
  } catch (error) {
    return null;
  }
}

function normalizeAnalyticsMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    const safeKey = cleanAnalyticsString(key, 60);
    if (!safeKey) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      normalized[safeKey] = Math.round(value * 100) / 100;
    } else if (typeof value === "boolean") {
      normalized[safeKey] = value;
    } else if (Array.isArray(value)) {
      normalized[safeKey] = value
        .slice(0, 10)
        .map(item => cleanAnalyticsString(item, 80))
        .filter(Boolean);
    } else {
      normalized[safeKey] = cleanAnalyticsString(value, 180);
    }
  }
  return normalized;
}

function getAnalyticsRangeDays(value) {
  const days = Number(value || 30);
  if (!Number.isFinite(days)) return 30;
  return Math.min(365, Math.max(1, Math.round(days)));
}

async function buildAdminBackup(request) {
  const analyticsDays = getAnalyticsRangeDays(request.query.analyticsDays || 365);
  const [orders, products, analyticsEvents] = await Promise.all([
    database.getOrders(),
    database.getAdminProducts(),
    database.getAnalyticsEvents(analyticsDays)
  ]);
  const paidOrders = orders.filter(order => order.paymentStatus === "paid");
  const productsCount = products.length;
  const activeProductsCount = products.filter(product => product.active !== false).length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    service: "DieguemTech Store",
    source: {
      url: getPublicBaseUrl(request),
      database: database.hasDatabase ? "postgresql" : "local"
    },
    counts: {
      orders: orders.length,
      paidOrders: paidOrders.length,
      products: productsCount,
      activeProducts: activeProductsCount,
      analyticsEvents: analyticsEvents.length
    },
    totals: {
      paidRevenue: paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
      currency: "XOF"
    },
    products,
    orders,
    analytics: {
      days: analyticsDays,
      summary: buildAnalyticsSummary(analyticsEvents, analyticsDays),
      events: analyticsEvents
    }
  };
}

function buildAnalyticsSummary(events = [], days = 30) {
  const metrics = {
    totalEvents: 0,
    uniqueSessions: 0,
    pageViews: 0,
    productViews: 0,
    categoryViews: 0,
    searches: 0,
    cartAdds: 0,
    checkoutOpens: 0,
    checkoutSubmits: 0,
    ordersCreated: 0,
    trackedRevenue: 0,
    conversionRate: 0
  };
  const sessions = new Set();
  const topProducts = new Map();
  const topSearches = new Map();
  const topPages = new Map();
  const topCategories = new Map();

  for (const event of events) {
    const eventName = event.eventName || event.event_name;
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    metrics.totalEvents += 1;
    if (event.sessionId) sessions.add(event.sessionId);

    if (eventName === "page_view") {
      metrics.pageViews += 1;
      incrementCounter(topPages, normalizeAnalyticsPathLabel(event.path), 1);
    }
    if (eventName === "product_view") metrics.productViews += 1;
    if (eventName === "category_view") metrics.categoryViews += 1;
    if (eventName === "search") {
      metrics.searches += 1;
      incrementCounter(topSearches, cleanAnalyticsString(metadata.query, 90), 1);
    }
    if (eventName === "add_to_cart") metrics.cartAdds += 1;
    if (eventName === "checkout_open") metrics.checkoutOpens += 1;
    if (eventName === "checkout_submit") metrics.checkoutSubmits += 1;
    if (eventName === "order_created") {
      metrics.ordersCreated += 1;
      metrics.trackedRevenue += Number(event.value || 0);
    }

    if (["product_view", "add_to_cart"].includes(eventName)) {
      incrementProductAnalytics(topProducts, event, eventName);
    }
    if (event.category) {
      incrementCounter(topCategories, event.category, 1);
    }
  }

  metrics.uniqueSessions = sessions.size;
  metrics.conversionRate = metrics.checkoutOpens
    ? Math.round((metrics.ordersCreated / metrics.checkoutOpens) * 1000) / 10
    : 0;

  return {
    days,
    generatedAt: new Date().toISOString(),
    metrics,
    topProducts: mapToAnalyticsList(topProducts, ["views", "cartAdds"]).slice(0, 8),
    topSearches: mapToSimpleList(topSearches).slice(0, 8),
    topPages: mapToSimpleList(topPages).slice(0, 8),
    topCategories: mapToSimpleList(topCategories).slice(0, 8),
    timeline: buildAnalyticsTimeline(events, days)
  };
}

function incrementProductAnalytics(map, event, eventName) {
  const label = cleanAnalyticsString(event.productName, 120) || (event.productId ? `Produit #${event.productId}` : null);
  if (!label) return;
  const key = `${event.productId || ""}:${label}`;
  const current = map.get(key) || {
    label,
    productId: event.productId || null,
    views: 0,
    cartAdds: 0,
    score: 0
  };
  if (eventName === "product_view") current.views += 1;
  if (eventName === "add_to_cart") current.cartAdds += 1;
  current.score = current.views + current.cartAdds * 2;
  map.set(key, current);
}

function incrementCounter(map, label, amount = 1) {
  if (!label) return;
  const key = String(label);
  map.set(key, (map.get(key) || 0) + amount);
}

function mapToSimpleList(map) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function mapToAnalyticsList(map, fields = []) {
  return Array.from(map.values())
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .map(item => fields.reduce((entry, field) => ({ ...entry, [field]: item[field] || 0 }), {
      label: item.label,
      productId: item.productId,
      score: item.score
    }));
}

function normalizeAnalyticsPathLabel(pathValue) {
  const pathText = cleanAnalyticsString(pathValue, 180);
  if (!pathText) return "/";
  if (pathText === "/") return "Accueil";
  return pathText;
}

function buildAnalyticsTimeline(events, days) {
  const safeDays = Math.min(90, getAnalyticsRangeDays(days));
  const today = new Date();
  const buckets = new Map();
  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, { date: key, pageViews: 0, cartAdds: 0, ordersCreated: 0 });
  }

  for (const event of events) {
    const date = new Date(event.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (event.eventName === "page_view") bucket.pageViews += 1;
    if (event.eventName === "add_to_cart") bucket.cartAdds += 1;
    if (event.eventName === "order_created") bucket.ordersCreated += 1;
  }

  return Array.from(buckets.values());
}

function hasPayDunyaConfig() {
  return getPayDunyaMissingConfig().length === 0;
}

function getPayDunyaMissingConfig() {
  return [
    "PAYDUNYA_MASTER_KEY",
    "PAYDUNYA_PRIVATE_KEY",
    "PAYDUNYA_TOKEN"
  ].filter(name => !getPayDunyaConfigValue(name));
}

function getPayDunyaConfigValue(name) {
  return String(process.env[name] || "").trim();
}

function getPayDunyaMode() {
  const mode = String(process.env.PAYDUNYA_MODE || "test").trim().toLowerCase();
  if (["prod", "production", "live"].includes(mode)) return "live";
  if (["test", "sandbox", "testing"].includes(mode)) return "test";
  return "test";
}

function getPayDunyaMinimumAmount() {
  const amount = Number(process.env.PAYDUNYA_MIN_AMOUNT || defaultPayDunyaMinimumAmount);
  return Number.isFinite(amount) && amount > 0
    ? Math.round(amount)
    : defaultPayDunyaMinimumAmount;
}

function getPayDunyaApiBaseUrl() {
  return getPayDunyaMode() === "live"
    ? "https://app.paydunya.com/api/v1"
    : "https://app.paydunya.com/sandbox-api/v1";
}

function getPayDunyaHeaders() {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": getPayDunyaConfigValue("PAYDUNYA_MASTER_KEY"),
    "PAYDUNYA-PRIVATE-KEY": getPayDunyaConfigValue("PAYDUNYA_PRIVATE_KEY"),
    "PAYDUNYA-TOKEN": getPayDunyaConfigValue("PAYDUNYA_TOKEN")
  };
}

function getBaseUrl(request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = request.get("host");
  const forwardedProto = request.get("x-forwarded-proto");
  const protocol = forwardedProto || request.protocol || "https";
  return `${protocol}://${host}`.replace(/\/$/, "");
}

function getPublicBaseUrl(request) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const host = request.get("host") || "";
  if (/onrender\.com$/i.test(host)) return "https://dieguemtechstore.com";
  if (process.env.NODE_ENV === "production") return "https://dieguemtechstore.com";
  return getBaseUrl(request);
}

function getLocalBusinessStructuredData(baseUrl) {
  return {
    "@type": "ElectronicsStore",
    "@id": `${baseUrl}/#store`,
    name: "DieguemTech Store",
    alternateName: "DieguemTech",
    url: `${baseUrl}/`,
    logo: `${baseUrl}/assets/logo-mark.svg`,
    image: `${baseUrl}/assets/hero-tech.png`,
    description: "Boutique high-tech au Senegal specialisee en smartphones, gaming, IPTV, TV Box, accessoires, audio, informatique et electromenager.",
    telephone: "+221772177176",
    email: "contact@dieguemtech.com",
    priceRange: "FCFA",
    currenciesAccepted: "XOF",
    paymentAccepted: "PayDunya, Wave, paiement a la livraison, Mobile Money, paiement mobile",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Dakar",
      addressRegion: "Dakar",
      addressCountry: "SN"
    },
    areaServed: [
      { "@type": "Country", name: "Senegal" },
      { "@type": "AdministrativeArea", name: "Dakar" },
      "Pikine",
      "Guediawaye",
      "Rufisque",
      "Thies",
      "Mbour"
    ],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+221772177176",
      contactType: "customer support",
      areaServed: "SN",
      availableLanguage: ["fr", "wo"]
    },
    knowsAbout: [
      "Smartphones",
      "Gaming",
      "IPTV",
      "TV Box",
      "Accessoires electroniques",
      "Audio",
      "Informatique",
      "Electromenager",
      "Climatisation"
    ],
    sameAs: ["https://wa.me/221772177176"]
  };
}

function renderLocalSeoMeta({ canonicalUrl = "", keywords = "" } = {}) {
  return `${keywords ? `  <meta name="keywords" content="${escapeHtml(keywords)}">\n` : ""}  <meta name="language" content="fr-SN">
  <meta name="geo.region" content="SN-DK">
  <meta name="geo.placename" content="Dakar, Senegal">
  <meta name="geo.position" content="14.7167;-17.4677">
  <meta name="ICBM" content="14.7167, -17.4677">
  ${canonicalUrl ? `<link rel="alternate" hreflang="fr-SN" href="${escapeHtml(canonicalUrl)}">\n  <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl)}">` : ""}`;
}

function getLocalSeoKeywords(items = []) {
  return [
    ...items,
    "DieguemTech Store",
    "boutique high-tech Senegal",
    "smartphone Dakar",
    "accessoires electroniques Senegal",
    "gaming Dakar",
    "IPTV Senegal",
    "TV Box Dakar",
    "livraison Dakar"
  ].filter(Boolean).join(", ");
}

async function renderProductSeoRoute(request, response, next) {
  try {
    const product = await database.getProduct(Number(request.params.id));
    if (!product) return response.status(404).send(renderSeoNotFoundPage(getPublicBaseUrl(request)));

    const canonicalPath = productPath(product);
    if (request.path !== canonicalPath) {
      return response.redirect(301, canonicalPath);
    }

    const relatedProducts = await database.getProducts({ category: product.category });
    response.send(renderProductSeoPage(product, getPublicBaseUrl(request), relatedProducts));
  } catch (error) {
    next(error);
  }
}

async function renderCategorySeoRoute(request, response, next) {
  try {
    const products = await database.getProducts();
    const category = findCategoryBySlug(products, request.params.categorySlug);
    const baseUrl = getPublicBaseUrl(request);

    if (!category) {
      return response.status(404).send(renderSeoNotFoundPage(
        baseUrl,
        "Categorie introuvable",
        "Cette categorie n'existe pas encore ou ne contient aucun produit actif."
      ));
    }

    const categoryProducts = products.filter(product => product.category === category);
    const subcategories = getCategorySubcategories(categoryProducts);
    const visibleSubcategories = subcategories.length > 1 ? subcategories : [];
    let selectedSubcategory = null;
    let visibleProducts = categoryProducts;

    if (request.params.subcategorySlug) {
      selectedSubcategory = subcategories.find(subcategory => slugify(subcategory.name) === request.params.subcategorySlug);
      if (!selectedSubcategory) {
        return response.status(404).send(renderSeoNotFoundPage(
          baseUrl,
          "Sous-categorie introuvable",
          "Cette sous-categorie n'existe pas encore dans cette famille de produits."
        ));
      }
      visibleProducts = selectedSubcategory.products;
    }

    const canonicalPath = selectedSubcategory
      ? subcategoryPath(category, selectedSubcategory.name)
      : categoryPath(category);

    if (request.path !== canonicalPath) {
      return response.redirect(301, canonicalPath);
    }

    response.send(renderCategorySeoPage({
      category,
      categoryProducts,
      visibleProducts,
      subcategories: visibleSubcategories,
      selectedSubcategory,
      baseUrl
    }));
  } catch (error) {
    next(error);
  }
}

function renderSitemap(baseUrl, products) {
  const today = new Date().toISOString().slice(0, 10);
  const categoryPages = getCategorySitemapEntries(products);
  const urls = [
    {
      loc: `${baseUrl}/`,
      changefreq: "daily",
      priority: "1.0"
    },
    ...categoryPages.map(page => ({
      loc: `${baseUrl}${page.path}`,
      changefreq: "weekly",
      priority: page.priority
    })),
    ...products.map(product => ({
      loc: `${baseUrl}${productPath(product)}`,
      changefreq: "weekly",
      priority: "0.8"
    }))
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join("\n")}
</urlset>`;
}

function renderCategorySeoPage({
  category,
  categoryProducts,
  visibleProducts,
  subcategories,
  selectedSubcategory,
  baseUrl
}) {
  const displayCategory = getCategoryDisplayName(category);
  const currentTitle = selectedSubcategory ? selectedSubcategory.name : displayCategory;
  const canonicalPath = selectedSubcategory
    ? subcategoryPath(category, selectedSubcategory.name)
    : categoryPath(category);
  const canonicalUrl = `${baseUrl}${canonicalPath}`;
  const parentPath = selectedSubcategory ? categoryPath(category) : "/";
  const backLabel = selectedSubcategory ? `Retour a ${displayCategory}` : "Retour a l'accueil";
  const description = truncateText(getCategoryDescription(category, selectedSubcategory?.name), 155);
  const heroProduct = visibleProducts[0] || categoryProducts[0] || {};
  const heroImage = getProductImages(heroProduct)[0];
  const heroImageUrl = heroImage ? absoluteUrl(heroImage, baseUrl) : `${baseUrl}/assets/hero-tech.png`;
  const productsLabel = productCountLabel(visibleProducts.length);
  const subcategoryTitle = selectedSubcategory ? "Autres sous-categories" : "Sous-categories";
  const pageTitle = selectedSubcategory
    ? `${selectedSubcategory.name} ${displayCategory} au Senegal | DieguemTech Store`
    : `${displayCategory} au Senegal | DieguemTech Store`;
  const localKeywords = getLocalSeoKeywords([
    `${displayCategory} Senegal`,
    `${displayCategory} Dakar`,
    selectedSubcategory ? `${selectedSubcategory.name} Senegal` : "",
    selectedSubcategory ? `${selectedSubcategory.name} Dakar` : ""
  ]);
  const breadcrumbItems = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Accueil",
      item: `${baseUrl}/`
    },
    {
      "@type": "ListItem",
      position: 2,
      name: displayCategory,
      item: `${baseUrl}${categoryPath(category)}`
    }
  ];

  if (selectedSubcategory) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: selectedSubcategory.name,
      item: canonicalUrl
    });
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      getLocalBusinessStructuredData(baseUrl),
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumbItems
      },
      {
        "@type": "CollectionPage",
        "@id": `${canonicalUrl}#webpage`,
        name: currentTitle,
        description,
        url: canonicalUrl,
        isPartOf: {
          "@type": "WebSite",
          name: "DieguemTech Store",
          url: `${baseUrl}/`
        },
        publisher: {
          "@id": `${baseUrl}/#store`
        },
        inLanguage: "fr-SN"
      },
      {
        "@type": "ItemList",
        name: `${currentTitle} - produits`,
        itemListElement: visibleProducts.slice(0, 40).map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: product.name,
          url: `${baseUrl}${productPath(product)}`
        }))
      }
    ]
  };

  return `<!doctype html>
<html lang="fr-SN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow">
  <meta name="description" content="${escapeHtml(description)}">
${renderLocalSeoMeta({ canonicalUrl, keywords: localKeywords })}
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="fr_SN">
  <meta property="og:site_name" content="DieguemTech Store">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(heroImageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(heroImageUrl)}">
  <meta name="theme-color" content="#f68b1e">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="shortcut icon" href="/assets/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/logo-mark.svg">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <style>
    body{background:#f7f7f7}
    .category-page{width:min(1180px,calc(100% - 34px));margin:0 auto;padding:28px 0 72px}
    .category-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
    .category-logo img{display:block;width:210px;height:auto}
    .category-nav-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .category-back-button{display:inline-flex;align-items:center;justify-content:center;border:1px solid #e2e2e2;background:#fff;color:#313133;border-radius:9px;padding:11px 14px;font-weight:900;font-size:13px}
    .category-back-button:hover{border-color:#f68b1e;color:#f68b1e}
    .category-nav-actions a:not(.category-back-button){color:#f68b1e;font-weight:900;font-size:13px}
    .category-breadcrumb{display:flex;align-items:center;gap:8px;margin:0 0 18px;color:#8b8b8b;font-size:12px;font-weight:800;flex-wrap:wrap}
    .category-breadcrumb a{color:#313133}.category-breadcrumb span{color:#f68b1e}
    .category-hero{position:relative;overflow:hidden;border-radius:26px;background:radial-gradient(circle at 78% 28%,rgba(246,139,30,.34),transparent 30%),linear-gradient(135deg,#252526,#111112);color:#fff;padding:46px;display:grid;grid-template-columns:1.2fr .8fr;gap:30px;align-items:center;box-shadow:0 18px 45px rgba(0,0,0,.13)}
    .category-hero h1{font:800 clamp(34px,5vw,58px)/1.04 Manrope;margin:0 0 14px;letter-spacing:-1.8px}
    .category-hero p{color:#d4d4d4;max-width:620px;margin:0 0 22px;font-size:15px;line-height:1.75}
    .category-hero-metrics{display:flex;gap:10px;flex-wrap:wrap}
    .category-pill{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900}
    .category-hero-visual{min-height:260px;border-radius:22px;background:rgba(255,255,255,.08);display:grid;place-items:center;padding:24px}
    .category-hero-visual img{max-width:100%;max-height:245px;object-fit:contain;filter:drop-shadow(0 18px 20px rgba(0,0,0,.28))}
    .category-hero-visual span{font:800 60px Manrope;color:#f68b1e}
    .category-section{margin-top:28px;background:#fff;border:1px solid #ededed;border-radius:22px;padding:24px;box-shadow:0 12px 34px rgba(0,0,0,.045)}
    .category-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:18px}
    .category-section-head h2{font:800 24px Manrope;margin:0;color:#1c1c1e;letter-spacing:-.7px}
    .category-section-head p{margin:4px 0 0;color:#8a8a8a;font-size:12px}
    .category-subgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
    .category-subcard{border:1px solid #eee;border-radius:16px;background:#fff;overflow:hidden;transition:.25s;display:grid;grid-template-rows:130px auto}
    .category-subcard:hover,.category-subcard.active{border-color:#f68b1e;box-shadow:0 12px 28px rgba(246,139,30,.13);transform:translateY(-3px)}
    .category-subvisual{background:linear-gradient(145deg,#fff8f0,#f2f2f2);display:grid;place-items:center;padding:16px}
    .category-subvisual img{max-width:100%;max-height:105px;object-fit:contain;filter:drop-shadow(0 12px 13px rgba(0,0,0,.12))}
    .category-subbody{padding:14px}
    .category-subbody strong{display:block;color:#1c1c1e;font-size:14px;margin-bottom:4px}
    .category-subbody small{color:#999;font-size:11px;font-weight:800}
    .category-products-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
    .category-product-card{border:1px solid #ececec;border-radius:18px;background:#fff;overflow:hidden;transition:.25s;display:flex;flex-direction:column}
    .category-product-card:hover{transform:translateY(-5px);box-shadow:0 14px 34px rgba(0,0,0,.08);border-color:#f68b1e}
    .category-product-link{display:flex;flex-direction:column;flex:1}
    .category-product-visual{height:190px;background:linear-gradient(145deg,#f8f8f8,#eeeeef);display:grid;place-items:center;padding:18px;position:relative}
    .category-product-visual img{max-width:100%;max-height:155px;object-fit:contain;filter:drop-shadow(0 14px 14px rgba(0,0,0,.13))}
    .category-product-visual span{font:800 38px Manrope;color:#f68b1e}
    .category-product-badge{position:absolute;left:12px;top:12px;background:#2d8d67;color:#fff;border-radius:7px;padding:5px 8px;font-size:10px;font-weight:900}
    .category-product-body{padding:15px;display:flex;flex-direction:column;gap:7px;flex:1}
    .category-product-body small{color:#aaa;text-transform:uppercase;font-size:9px;font-weight:900;letter-spacing:1px}
    .category-product-body h3{font:800 14px/1.35 Manrope;margin:0;color:#1c1c1e}
    .category-product-body p{color:#666;font-size:12px;line-height:1.6;margin:0}
    .category-product-price{margin-top:auto;color:#f68b1e;font:800 16px Manrope}
    .category-product-actions{border-top:1px solid #f0f0f0;padding:12px 15px;display:flex;gap:8px;align-items:center;justify-content:space-between}
    .category-see-link{font-size:12px;font-weight:900;color:#313133}
    .category-see-link:hover{color:#f68b1e}
    .category-cart-button{border:0;background:#f68b1e;color:#fff;border-radius:8px;padding:9px 10px;font-size:11px;font-weight:900}
    .category-cart-button:hover{background:#313133}
    .category-empty{padding:50px;text-align:center;color:#777}
    .category-toast{position:fixed;right:24px;bottom:24px;background:#222;color:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 16px 40px rgba(0,0,0,.24);transform:translateY(90px);opacity:0;transition:.25s;z-index:100}
    .category-toast.active{transform:translateY(0);opacity:1}
    .category-toast strong{display:block;font-size:12px}.category-toast small{color:#bbb;font-size:11px}
    @media(max-width:1000px){.category-products-grid,.category-subgrid{grid-template-columns:repeat(3,1fr)}.category-hero{grid-template-columns:1fr}}
    @media(max-width:760px){.category-page{width:min(100% - 24px,1180px);padding-top:18px}.category-top{align-items:flex-start;flex-direction:column}.category-logo img{width:185px}.category-hero{padding:30px 22px}.category-hero-visual{min-height:210px}.category-products-grid,.category-subgrid{grid-template-columns:repeat(2,1fr)}.category-section{padding:18px}.category-section-head{align-items:flex-start;flex-direction:column}}
    @media(max-width:520px){.category-products-grid,.category-subgrid{grid-template-columns:1fr}.category-product-visual{height:180px}.category-hero h1{letter-spacing:-1px}.category-product-actions{align-items:stretch;flex-direction:column}.category-cart-button,.category-see-link{text-align:center;width:100%}}
  </style>
  <script type="application/ld+json">${toJsonLdScript(structuredData)}</script>
</head>
<body>
  <main class="category-page">
    <nav class="category-top" aria-label="Navigation categorie">
      <a class="category-logo" href="/" aria-label="DieguemTech Store - Accueil"><img src="/assets/logo.svg" alt="DieguemTech Store" width="220" height="56"></a>
      <div class="category-nav-actions">
        <a class="category-back-button" href="${escapeHtml(parentPath)}">${escapeHtml(backLabel)}</a>
        <a href="/#categories">Toutes les categories</a>
      </div>
    </nav>
    <div class="category-breadcrumb" aria-label="Fil d'Ariane">
      <a href="/">Accueil</a> /
      ${selectedSubcategory ? `<a href="${escapeHtml(categoryPath(category))}">${escapeHtml(displayCategory)}</a> / <span>${escapeHtml(selectedSubcategory.name)}</span>` : `<span>${escapeHtml(displayCategory)}</span>`}
    </div>
    <section class="category-hero">
      <div>
        <span class="eyebrow light">${selectedSubcategory ? "Sous-categorie" : "Categorie"}</span>
        <h1>${escapeHtml(currentTitle)}</h1>
        <p>${escapeHtml(getCategoryDescription(category, selectedSubcategory?.name))}</p>
        <div class="category-hero-metrics">
          <span class="category-pill">${escapeHtml(productsLabel)}</span>
          <span class="category-pill">Livraison Dakar & Senegal</span>
          <span class="category-pill">Support WhatsApp</span>
        </div>
      </div>
      <div class="category-hero-visual">
        ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="${escapeHtml(currentTitle)}">` : "<span>DT</span>"}
      </div>
    </section>
    ${subcategories.length ? `<section class="category-section">
      <div class="category-section-head">
        <div><span class="eyebrow">${escapeHtml(subcategoryTitle)}</span><h2>${selectedSubcategory ? "Continuer l'exploration" : "Choisissez plus precisement"}</h2></div>
        <p>${escapeHtml(productCountLabel(categoryProducts.length))} dans ${escapeHtml(displayCategory)}</p>
      </div>
      <div class="category-subgrid">
        ${subcategories.map(subcategory => renderCategorySubcategoryCard(category, subcategory, selectedSubcategory)).join("")}
      </div>
    </section>` : ""}
    <section class="category-section">
      <div class="category-section-head">
        <div><span class="eyebrow">Catalogue</span><h2>${selectedSubcategory ? `Produits ${escapeHtml(selectedSubcategory.name)}` : "Tous les produits"}</h2></div>
        <p>${escapeHtml(productsLabel)}</p>
      </div>
      ${visibleProducts.length ? `<div class="category-products-grid">
        ${visibleProducts.map(product => renderCategoryProductCard(product)).join("")}
      </div>` : `<div class="category-empty"><h3>Aucun produit disponible</h3><p>Cette categorie sera mise a jour tres bientot.</p></div>`}
    </section>
  </main>
  <div class="category-toast" id="categoryToast" aria-live="polite"><strong>Produit ajoute</strong><small>Votre panier a ete mis a jour.</small></div>
  <script>
    (function(){
      var toast = document.getElementById("categoryToast");
      function showToast(name) {
        if (!toast) return;
        toast.querySelector("strong").textContent = "Produit ajoute";
        toast.querySelector("small").textContent = name ? name + " est dans votre panier." : "Votre panier a ete mis a jour.";
        toast.classList.add("active");
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(function(){ toast.classList.remove("active"); }, 2600);
      }
      document.querySelectorAll("[data-cart-product]").forEach(function(button){
        button.addEventListener("click", function(){
          var id = Number(button.getAttribute("data-cart-product"));
          var name = button.getAttribute("data-product-name") || "";
          var cart = [];
          try { cart = JSON.parse(localStorage.getItem("dt-cart") || "[]"); } catch (error) { cart = []; }
          var item = cart.find(function(entry){ return Number(entry.id) === id; });
          if (item) item.qty = Number(item.qty || 0) + 1;
          else cart.push({ id: id, qty: 1 });
          localStorage.setItem("dt-cart", JSON.stringify(cart));
          showToast(name);
        });
      });
    })();
  </script>
</body>
</html>`;
}

function renderCategorySubcategoryCard(category, subcategory, selectedSubcategory) {
  const image = getProductImages(subcategory.products[0] || {})[0];
  const isActive = selectedSubcategory?.name === subcategory.name;
  return `<a class="category-subcard ${isActive ? "active" : ""}" href="${escapeHtml(subcategoryPath(category, subcategory.name))}">
    <div class="category-subvisual">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(subcategory.name)}" loading="lazy">` : "<span>DT</span>"}</div>
    <div class="category-subbody">
      <strong>${escapeHtml(subcategory.name)}</strong>
      <small>${escapeHtml(productCountLabel(subcategory.count))}</small>
    </div>
  </a>`;
}

function renderCategoryProductCard(product) {
  const image = getProductImages(product)[0];
  const description = truncateText(getProductDescription(product), 135);
  const categoryLabel = product.subcategory ? `${product.category} / ${product.subcategory}` : product.category;
  return `<article class="category-product-card">
    <a class="category-product-link" href="${escapeHtml(productPath(product))}">
      <div class="category-product-visual">
        ${product.badge ? `<span class="category-product-badge">${escapeHtml(product.badge)}</span>` : ""}
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : "<span>DT</span>"}
      </div>
      <div class="category-product-body">
        <small>${escapeHtml(categoryLabel)}</small>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(description)}</p>
        <strong class="category-product-price">${formatSeoPrice(product.price)}</strong>
      </div>
    </a>
    <div class="category-product-actions">
      <a class="category-see-link" href="${escapeHtml(productPath(product))}">Voir le produit</a>
      <button class="category-cart-button" type="button" data-cart-product="${Number(product.id)}" data-product-name="${escapeHtml(product.name)}">Ajouter au panier</button>
    </div>
  </article>`;
}

function renderProductSeoPage(product, baseUrl, relatedProducts = []) {
  const canonicalPath = productPath(product);
  const canonicalUrl = `${baseUrl}${canonicalPath}`;
  const images = getProductImages(product).map(image => absoluteUrl(image, baseUrl));
  const mainImage = images[0] || `${baseUrl}/assets/hero-tech.png`;
  const fullDescription = getProductDescription(product);
  const description = truncateText(`${product.name} au Senegal chez DieguemTech Store. Livraison a Dakar et autres zones selon confirmation. ${fullDescription}`, 155);
  const schemaDescription = truncateText(fullDescription, 500);
  const title = `${product.name} au Senegal | DieguemTech Store`;
  const availability = Number(product.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
  const isLongDescription = fullDescription.replace(/\s+/g, " ").trim().length > 330;
  const stockLabel = Number(product.stock) > 0 ? "En stock" : "Rupture temporaire";
  const discountLabel = getSeoDiscountLabel(product);
  const highlights = getSeoProductHighlights(product);
  const productSubcategory = getProductSubcategory(product);
  const localKeywords = getLocalSeoKeywords([
    `${product.name} Senegal`,
    `${product.name} Dakar`,
    `${product.category} Senegal`,
    `${product.category} Dakar`,
    productSubcategory ? `${productSubcategory} Senegal` : ""
  ]);
  const productBreadcrumbItems = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Accueil",
      item: `${baseUrl}/`
    },
    {
      "@type": "ListItem",
      position: 2,
      name: product.category,
      item: `${baseUrl}${categoryPath(product.category)}`
    },
    ...(productSubcategory ? [{
      "@type": "ListItem",
      position: 3,
      name: productSubcategory,
      item: `${baseUrl}${subcategoryPath(product.category, productSubcategory)}`
    }] : []),
    {
      "@type": "ListItem",
      position: productSubcategory ? 4 : 3,
      name: product.name,
      item: canonicalUrl
    }
  ];
  const visibleRelatedProducts = relatedProducts
    .filter(entry => Number(entry.id) !== Number(product.id))
    .slice(0, 4);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      getLocalBusinessStructuredData(baseUrl),
      {
        "@type": "BreadcrumbList",
        itemListElement: productBreadcrumbItems
      },
      {
        "@type": "Product",
        "@id": `${canonicalUrl}#product`,
        name: product.name,
        description: schemaDescription,
        image: images.length ? images : [mainImage],
        sku: `DT-${product.id}`,
        category: product.category,
        brand: {
          "@type": "Brand",
          name: "DieguemTech Store"
        },
        offers: {
          "@type": "Offer",
          url: canonicalUrl,
          priceCurrency: "XOF",
          price: Number(product.price || 0),
          availability,
          itemCondition: "https://schema.org/NewCondition",
          areaServed: {
            "@type": "Country",
            name: "Senegal"
          },
          seller: {
            "@id": `${baseUrl}/#store`
          }
        },
        ...(Number(product.rating) > 0 && Number(product.reviews) > 0 ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(product.rating),
            reviewCount: Number(product.reviews)
          }
        } : {})
      }
    ]
  };

  return `<!doctype html>
<html lang="fr-SN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow">
  <meta name="description" content="${escapeHtml(description)}">
${renderLocalSeoMeta({ canonicalUrl, keywords: localKeywords })}
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="product">
  <meta property="og:locale" content="fr_SN">
  <meta property="og:site_name" content="DieguemTech Store">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(mainImage)}">
  <meta property="og:image:alt" content="${escapeHtml(product.name)}">
  <meta property="product:price:amount" content="${Number(product.price || 0)}">
  <meta property="product:price:currency" content="XOF">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(mainImage)}">
  <meta name="theme-color" content="#f68b1e">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="shortcut icon" href="/assets/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/logo-mark.svg">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <style>
    body{background:#f7f7f7}
    .seo-product-page{width:min(1120px,calc(100% - 34px));margin:0 auto;padding:28px 0 70px}
    .seo-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
    .seo-logo{display:flex;align-items:center;gap:10px;font-weight:900;color:#313133}
    .seo-logo img{display:block;width:210px;height:auto}
    .seo-nav-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .seo-back-button{border:1px solid #e2e2e2;background:#fff;color:#313133;border-radius:9px;padding:11px 14px;font-weight:900;font-size:13px}
    .seo-back-button:hover{border-color:#f68b1e;color:#f68b1e}
    .seo-nav-actions a{color:#f68b1e;font-weight:900;font-size:13px}
    .seo-breadcrumb{display:flex;align-items:center;gap:8px;margin:0 0 18px;color:#8b8b8b;font-size:12px;font-weight:800;flex-wrap:wrap}
    .seo-breadcrumb a{color:#313133}.seo-breadcrumb span{color:#f68b1e}
    .seo-card{display:grid;grid-template-columns:.95fr 1.05fr;gap:34px;background:#fff;border:1px solid #ececec;border-radius:24px;padding:30px;box-shadow:0 18px 45px rgba(0,0,0,.07)}
    .seo-gallery{background:linear-gradient(145deg,#fff8f0,#f1f1f1);border-radius:20px;display:grid;gap:14px;align-content:center;padding:26px;min-height:430px;position:sticky;top:18px}
    .seo-gallery-main{display:grid;place-items:center;min-height:300px}
    .seo-gallery-main img{max-width:100%;max-height:320px;object-fit:contain;filter:drop-shadow(0 18px 18px rgba(0,0,0,.14))}
    .seo-thumbs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
    .seo-thumb{width:62px;height:62px;border:1px solid #e6e6e6;background:#fff;border-radius:12px;padding:5px;display:grid;place-items:center;box-shadow:0 8px 18px rgba(0,0,0,.04)}
    .seo-thumb img{width:100%;height:100%;object-fit:contain}
    .seo-thumb.active,.seo-thumb:hover{border-color:#f68b1e;box-shadow:0 10px 22px rgba(246,139,30,.18)}
    .seo-info .eyebrow{margin-bottom:10px}
    .seo-info h1{font:800 clamp(30px,4vw,48px)/1.05 Manrope;margin:0 0 12px;color:#1c1c1e;letter-spacing:-1.6px}
    .seo-badges{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 18px}
    .seo-badge{display:inline-flex;align-items:center;gap:7px;border-radius:999px;background:#fff8f0;color:#f68b1e;border:1px solid rgba(246,139,30,.18);padding:8px 11px;font-size:12px;font-weight:900}
    .seo-badge.dark{background:#f6f6f6;color:#313133;border-color:#e9e9e9}
    .seo-description-card,.seo-help,.seo-related{margin-top:24px;background:#fff;border:1px solid #eee;border-radius:18px;padding:20px}
    .seo-description-card h2,.seo-services h2,.seo-related h2{font:800 20px Manrope;margin:0 0 12px;color:#1c1c1e}
    .seo-description{position:relative;color:#5f5f62;line-height:1.85;font-size:15px;white-space:pre-line}
    .seo-description.is-collapsed{max-height:155px;overflow:hidden}
    .seo-description.is-collapsed:after{content:"";position:absolute;left:0;right:0;bottom:0;height:58px;background:linear-gradient(180deg,rgba(255,255,255,0),#fff)}
    .seo-read-more{border:0;background:none;color:#f68b1e;font-weight:900;padding:10px 0 0;font-size:13px}
    .seo-price{display:flex;align-items:flex-end;gap:12px;margin:24px 0}
    .seo-price strong{font:800 30px Manrope;color:#f68b1e}
    .seo-price del{color:#aaa;font-size:14px}
    .seo-price small{align-self:center;color:#16a66a;background:#eaf8f1;border-radius:999px;padding:6px 9px;font-weight:900;font-size:11px}
    .seo-meta{display:grid;gap:9px;background:#fafafa;border:1px solid #eee;border-radius:14px;padding:16px;color:#666;font-size:13px}
    .seo-meta span:before{content:"";width:7px;height:7px;border-radius:50%;background:#16a66a;display:inline-block;margin-right:9px}
    .seo-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
    .seo-actions .button{min-width:180px}
    .seo-note{margin-top:22px;color:#888;font-size:12px;line-height:1.7}
    .seo-services{margin-top:24px}
    .seo-service-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .seo-service-grid article{background:#fff;border:1px solid #eee;border-radius:16px;padding:16px;box-shadow:0 8px 26px rgba(0,0,0,.035)}
    .seo-service-grid b{display:block;color:#1c1c1e;font-size:13px;margin-bottom:5px}
    .seo-service-grid p{margin:0;color:#777;font-size:12px;line-height:1.6}
    .seo-highlight-list{display:grid;gap:9px;margin:16px 0 0;padding:0;list-style:none}
    .seo-highlight-list li{display:flex;gap:10px;color:#5f5f62;font-size:13px;line-height:1.6}
    .seo-highlight-list li:before{content:"";width:8px;height:8px;border-radius:50%;background:#f68b1e;min-width:8px;margin-top:7px}
    .seo-help{display:flex;align-items:center;justify-content:space-between;gap:18px;background:#313133;color:#fff}
    .seo-help h2{font:800 21px Manrope;margin:0 0 5px}.seo-help p{margin:0;color:#d5d5d5;font-size:13px;line-height:1.6}
    .seo-related-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
    .seo-related-card{border:1px solid #eee;border-radius:16px;overflow:hidden;background:#fff;transition:.25s}
    .seo-related-card:hover{transform:translateY(-4px);box-shadow:0 14px 32px rgba(0,0,0,.08);border-color:#f68b1e}
    .seo-related-visual{height:140px;background:linear-gradient(145deg,#f8f8f8,#eeeeef);display:grid;place-items:center;padding:14px}
    .seo-related-visual img{max-width:100%;max-height:112px;object-fit:contain;filter:drop-shadow(0 12px 14px rgba(0,0,0,.12))}
    .seo-related-visual span{font:800 32px Manrope;color:#f68b1e}
    .seo-related-body{padding:13px}.seo-related-body h3{font:800 13px Manrope;margin:0 0 8px;color:#1c1c1e}.seo-related-body strong{color:#f68b1e;font-size:13px}
    @media(max-width:900px){.seo-service-grid,.seo-related-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:760px){.seo-card{grid-template-columns:1fr;padding:20px}.seo-gallery{min-height:300px;position:relative;top:auto}.seo-gallery-main{min-height:220px}.seo-actions .button{width:100%}.seo-top{align-items:flex-start;flex-direction:column}.seo-help{align-items:flex-start;flex-direction:column}.seo-help .button{width:100%}}
    @media(max-width:520px){.seo-service-grid,.seo-related-grid{grid-template-columns:1fr}.seo-card{padding:16px}.seo-product-page{width:min(100% - 24px,1120px);padding-top:18px}.seo-logo img{width:180px}.seo-info h1{letter-spacing:-1px}}
  </style>
  <script type="application/ld+json">${toJsonLdScript(structuredData)}</script>
</head>
<body>
  <main class="seo-product-page">
    <nav class="seo-top" aria-label="Navigation produit">
      <a class="seo-logo" href="/" aria-label="DieguemTech Store - Accueil"><img src="/assets/logo.svg" alt="DieguemTech Store" width="220" height="56"></a>
      <div class="seo-nav-actions">
        <button type="button" class="seo-back-button" data-back-button>Retour</button>
        <a href="/#boutique">Retour a la boutique</a>
      </div>
    </nav>
    <div class="seo-breadcrumb" aria-label="Fil d'Ariane">
      <a href="/">Accueil</a> / <a href="${escapeHtml(categoryPath(product.category))}">${escapeHtml(getCategoryDisplayName(product.category))}</a>${productSubcategory ? ` / <a href="${escapeHtml(subcategoryPath(product.category, productSubcategory))}">${escapeHtml(productSubcategory)}</a>` : ""} / <span>${escapeHtml(product.name)}</span>
    </div>
    <article class="seo-card">
      <section class="seo-gallery" aria-label="Images du produit">
        <div class="seo-gallery-main">
          <img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}" data-main-image>
        </div>
        ${images.length > 1 ? `<div class="seo-thumbs">${images.slice(0, 8).map((image, index) => `<button type="button" class="seo-thumb ${index === 0 ? "active" : ""}" data-seo-thumb="${escapeHtml(image)}" aria-label="Afficher image ${index + 1}"><img src="${escapeHtml(image)}" alt=""></button>`).join("")}</div>` : ""}
      </section>
      <section class="seo-info">
        <span class="eyebrow">${escapeHtml(product.category)}</span>
        <h1>${escapeHtml(product.name)}</h1>
        <div class="product-detail-rating"><span class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span> ${Number(product.rating || 0)} (${Number(product.reviews || 0)} avis)</div>
        <div class="seo-badges">
          <span class="seo-badge">${escapeHtml(stockLabel)}</span>
          <span class="seo-badge dark">Reference DT-${Number(product.id)}</span>
          ${product.badge ? `<span class="seo-badge dark">${escapeHtml(product.badge)}</span>` : ""}
        </div>
        <div class="seo-price">
          <strong>${formatSeoPrice(product.price)}</strong>
          ${product.oldPrice ? `<del>${formatSeoPrice(product.oldPrice)}</del>` : ""}
          ${discountLabel ? `<small>${escapeHtml(discountLabel)}</small>` : ""}
        </div>
        <div class="seo-meta">
          <span>Disponibilite : <strong>${escapeHtml(stockLabel)}</strong>${Number(product.stock) > 0 ? ` (${Number(product.stock)} disponible${Number(product.stock) > 1 ? "s" : ""})` : ""}</span>
          <span>Livraison : Dakar, Pikine, Guediawaye, Rufisque et autres zones selon confirmation</span>
          <span>Paiement : PayDunya, Wave ou paiement a la livraison</span>
          <span>Support : conseil avant achat et suivi apres commande</span>
        </div>
        <div class="seo-description-card">
          <h2>Description du produit</h2>
          <div class="seo-description ${isLongDescription ? "is-collapsed" : ""}" id="productDescription">${escapeHtml(fullDescription)}</div>
          ${isLongDescription ? `<button type="button" class="seo-read-more" data-description-toggle aria-expanded="false" aria-controls="productDescription">Lire la suite</button>` : ""}
          <ul class="seo-highlight-list">
            ${highlights.map(item => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
        <div class="seo-actions">
          <a class="button primary" href="/#boutique">Acheter sur la boutique</a>
          <a class="button outline" href="https://wa.me/221772177176?text=${encodeURIComponent(`Bonjour DieguemTech Store, je suis interesse par ${product.name}.`)}" target="_blank" rel="noopener">Demander sur WhatsApp</a>
        </div>
        <p class="seo-note">Cette fiche produit est optimisee pour le referencement et le partage. Les prix et stocks peuvent etre confirmes au moment de la commande.</p>
      </section>
    </article>
    <section class="seo-services" aria-label="Services inclus">
      <h2>Ce que DieguemTech Store vous apporte</h2>
      <div class="seo-service-grid">
        <article><b>Produit selectionne</b><p>Nous privilegions des produits fiables, utiles et adaptes aux besoins high-tech du quotidien.</p></article>
        <article><b>Paiement flexible</b><p>Paiement mobile en ligne ou paiement a la livraison apres confirmation de la commande.</p></article>
        <article><b>Livraison rapide</b><p>Organisation de la livraison a Dakar, Pikine, Guediawaye, Rufisque et dans les autres zones apres confirmation.</p></article>
        <article><b>Support reactif</b><p>Assistance avant achat, confirmation du stock et suivi de commande par WhatsApp.</p></article>
      </div>
    </section>
    <section class="seo-help">
      <div>
        <h2>Besoin d'un conseil avant de commander ?</h2>
        <p>Envoyez le nom du produit sur WhatsApp. Le support peut confirmer la disponibilite, les options et la livraison.</p>
      </div>
      <a class="button primary" href="https://wa.me/221772177176?text=${encodeURIComponent(`Bonjour DieguemTech Store, je veux plus d'informations sur ${product.name}.`)}" target="_blank" rel="noopener">Contacter WhatsApp</a>
    </section>
    ${visibleRelatedProducts.length ? `<section class="seo-related" aria-label="Produits similaires">
      <h2>Produits similaires</h2>
      <div class="seo-related-grid">
        ${visibleRelatedProducts.map(relatedProduct => {
          const relatedImage = getProductImages(relatedProduct)[0];
          const relatedImageUrl = relatedImage ? absoluteUrl(relatedImage, baseUrl) : "";
          return `<a class="seo-related-card" href="${escapeHtml(productPath(relatedProduct))}">
            <div class="seo-related-visual">${relatedImageUrl ? `<img src="${escapeHtml(relatedImageUrl)}" alt="${escapeHtml(relatedProduct.name)}" loading="lazy">` : "<span>DT</span>"}</div>
            <div class="seo-related-body">
              <h3>${escapeHtml(relatedProduct.name)}</h3>
              <strong>${formatSeoPrice(relatedProduct.price)}</strong>
            </div>
          </a>`;
        }).join("")}
      </div>
    </section>` : ""}
  </main>
  <script>
    (function(){
      var mainImage = document.querySelector("[data-main-image]");
      document.querySelectorAll("[data-seo-thumb]").forEach(function(button){
        button.addEventListener("click", function(){
          if (mainImage) mainImage.src = button.getAttribute("data-seo-thumb");
          document.querySelectorAll("[data-seo-thumb]").forEach(function(item){
            item.classList.toggle("active", item === button);
          });
        });
      });
      var description = document.getElementById("productDescription");
      var toggle = document.querySelector("[data-description-toggle]");
      if (description && toggle) {
        toggle.addEventListener("click", function(){
          var expanded = description.classList.toggle("is-expanded");
          description.classList.toggle("is-collapsed", !expanded);
          toggle.textContent = expanded ? "Voir moins" : "Lire la suite";
          toggle.setAttribute("aria-expanded", String(expanded));
        });
      }
      var backButton = document.querySelector("[data-back-button]");
      if (backButton) {
        backButton.addEventListener("click", function(){
          if (window.history.length > 1) window.history.back();
          else window.location.href = "/#boutique";
        });
      }
    })();
  </script>
</body>
</html>`;
}

function renderSeoNotFoundPage(baseUrl, title = "Produit introuvable", message = "Ce produit n'est plus disponible ou a ete desactive.") {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><title>${escapeHtml(title)} - DieguemTech Store</title></head>
<body><main style="font-family:Arial,sans-serif;max-width:620px;margin:80px auto;padding:24px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(baseUrl)}/">Retour a la boutique</a></main></body></html>`;
}

function categoryPath(category) {
  return `/categorie/${slugify(category)}`;
}

function subcategoryPath(category, subcategory) {
  return `${categoryPath(category)}/${slugify(subcategory)}`;
}

function findCategoryBySlug(products, categorySlug) {
  return getUniqueCategories(products).find(category => slugify(category) === categorySlug);
}

function getUniqueCategories(products) {
  const seen = new Set();
  const categories = [];
  for (const product of products) {
    const category = String(product.category || "").trim();
    if (category && !seen.has(category)) {
      seen.add(category);
      categories.push(category);
    }
  }
  return categories;
}

function getCategorySitemapEntries(products) {
  return getUniqueCategories(products).flatMap(category => {
    const categoryProducts = products.filter(product => product.category === category);
    const subcategories = getCategorySubcategories(categoryProducts);
    const visibleSubcategories = subcategories.length > 1 ? subcategories : [];
    return [
      { path: categoryPath(category), priority: "0.9" },
      ...visibleSubcategories.map(subcategory => ({
        path: subcategoryPath(category, subcategory.name),
        priority: "0.85"
      }))
    ];
  });
}

function getCategorySubcategories(products) {
  const groups = new Map();
  for (const product of products) {
    const name = getProductSubcategory(product);
    if (!name) continue;
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        count: 0,
        products: []
      });
    }
    const group = groups.get(name);
    group.count += 1;
    group.products.push(product);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function getProductSubcategory(product) {
  const manualSubcategory = String(product.subcategory || "").trim();
  if (manualSubcategory) return manualSubcategory;

  const category = normalizeSearchText(product.category);
  const text = normalizeSearchText(`${product.name} ${product.badge} ${product.description}`);

  if (category.includes("climatisation")) {
    if (text.includes("rafraichisseur") || text.includes("air cooler") || text.includes("humidificateur")) return "Rafraichisseurs d'air";
    if (text.includes("ventilateur")) return "Ventilateurs";
    if (text.includes("climatiseur") || text.includes("split") || text.includes("btu")) return "Climatiseurs";
    return "Confort thermique";
  }

  if ((category.includes("tv") && !category.includes("iptv")) || category.includes("home cinema")) {
    if (text.includes("support") || text.includes("hdmi") || text.includes("cable")) return "Supports & cables";
    if (text.includes("projecteur") || text.includes("projection") || text.includes("ecran")) return "Projection";
    if (text.includes("barre") || text.includes("woofer") || text.includes("home cinema") || text.includes("son")) return "Son & home cinema";
    if (text.includes("lecteur") || text.includes("dvd") || text.includes("video")) return "Lecteurs video";
    if (text.includes("tv") || text.includes("televiseur") || text.includes("pouces") || text.includes("smart")) return "Televiseurs";
    return "TV & accessoires";
  }

  if (category.includes("electromenager")) {
    if (text.includes("aspirateur") || text.includes("nettoyage") || text.includes("linge") || text.includes("repasser")) return "Entretien & linge";
    if (text.includes("cafe") || text.includes("petit dej") || text.includes("grille") || text.includes("bouilloire")) return "Petit dejeuner";
    if (text.includes("blender") || text.includes("cuisine") || text.includes("friteuse") || text.includes("air fryer") || text.includes("four")) return "Cuisine";
    return "Maison";
  }

  if (category.includes("informatique")) {
    if (text.includes("routeur") || text.includes("wifi") || text.includes("4g") || text.includes("connexion")) return "Reseau & connexion";
    if (text.includes("stockage") || text.includes("ssd") || text.includes("disque")) return "Stockage";
    return "Bureau & peripheriques";
  }

  if (category.includes("accessoires")) {
    if (text.includes("charge") || text.includes("power") || text.includes("batterie")) return "Charge & energie";
    if (text.includes("camera") || text.includes("led") || text.includes("securite")) return "Maison connectee";
    return "Accessoires mobile";
  }

  if (category.includes("audio")) {
    if (text.includes("enceinte") || text.includes("speaker") || text.includes("bass") || text.includes("haut-parleur")) return "Enceintes & basses";
    return "Ecouteurs & casques";
  }

  return "";
}

function getCategoryDisplayName(category) {
  if (category === "TV & Home Cinema") return "TV, Video & Home cinema";
  if (category === "Electromenager") return "Electromenager";
  return category;
}

function getCategoryDescription(category, subcategory = "") {
  if (subcategory) {
    return `Explorez notre selection ${subcategory} dans la categorie ${getCategoryDisplayName(category)} au Senegal. Produits avec images, prix, descriptions, livraison a Dakar et acces direct a leur page detaillee.`;
  }

  const normalizedCategory = normalizeSearchText(category);
  if (normalizedCategory.includes("climatisation")) {
    return "Retrouvez au Senegal climatiseurs, ventilateurs, modeles rechargeables et rafraichisseurs d'air pour ameliorer le confort thermique a la maison, au bureau ou dans un espace de vie.";
  }
  if (normalizedCategory.includes("iptv")) {
    return "Solutions IPTV et TV Box au Senegal pour transformer votre televiseur en espace multimedia connecte, avec conseil et livraison a Dakar selon disponibilite.";
  }
  if ((normalizedCategory.includes("tv") && !normalizedCategory.includes("iptv")) || normalizedCategory.includes("home cinema")) {
    return "Decouvrez nos televisions, projecteurs, barres de son, supports, cables et accessoires video au Senegal pour creer une vraie experience multimedia a domicile.";
  }
  if (normalizedCategory.includes("electromenager")) {
    return "Equipez votre maison au Senegal avec des produits utiles pour la cuisine, le petit dejeuner, l'entretien, le linge et les besoins du quotidien.";
  }
  if (normalizedCategory.includes("informatique")) {
    return "Selection informatique au Senegal pour le bureau, les etudes, la connexion, le stockage et les peripheriques essentiels.";
  }
  if (normalizedCategory.includes("accessoires")) {
    return "Accessoires pratiques au Senegal pour smartphone, maison connectee, charge, securite et usages high-tech du quotidien.";
  }
  if (normalizedCategory.includes("audio")) {
    return "Ecouteurs, casques et enceintes disponibles au Senegal pour appels, musique, videos et divertissement au quotidien.";
  }
  if (normalizedCategory.includes("gaming")) {
    return "Produits gaming au Senegal pour ameliorer le confort, le son, les commandes et l'experience de jeu.";
  }
  if (normalizedCategory.includes("smartphone")) {
    return "Smartphones au Senegal selectionnes pour les appels, internet, reseaux sociaux, photos et usages quotidiens.";
  }
  return "Explorez les produits selectionnes par DieguemTech Store au Senegal avec images, prix et fiches detaillees.";
}

function productCountLabel(count) {
  return `${Number(count || 0)} produit${Number(count || 0) > 1 ? "s" : ""}`;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function productPath(product) {
  return `/produit/${product.id}/${slugify(product.name)}`;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "produit";
}

function getProductDescription(product) {
  return product.description || "Produit selectionne par DieguemTech Store pour offrir un bon rapport qualite-prix et une experience fiable au quotidien.";
}

function getProductImages(product) {
  const candidates = [];
  if (product.image) candidates.push(product.image);
  if (Array.isArray(product.images)) candidates.push(...product.images);
  return [...new Set(
    candidates
      .map(image => String(image || "").trim())
      .filter(Boolean)
  )].slice(0, 8);
}

function absoluteUrl(value, baseUrl) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatSeoPrice(value) {
  return `${new Intl.NumberFormat("fr-FR").format(Number(value || 0))} FCFA`;
}

function getSeoDiscountLabel(product) {
  const price = Number(product.price || 0);
  const oldPrice = Number(product.oldPrice || 0);
  if (oldPrice > price && price > 0) return `Economisez ${formatSeoPrice(oldPrice - price)}`;
  return "";
}

function getSeoProductHighlights(product) {
  const category = String(product.category || "").toLowerCase();
  const common = [
    "Produit verifie avant confirmation de la commande.",
    "Livraison disponible a Dakar et autres zones du Senegal selon confirmation.",
    "Conseil WhatsApp disponible pour choisir le bon modele selon votre besoin."
  ];

  if (category.includes("smartphone")) {
    return [
      "Ideal pour appels, internet, photos, reseaux sociaux et productivite mobile.",
      "Verification de la disponibilite et des options avant livraison.",
      ...common
    ];
  }

  if (category.includes("gaming")) {
    return [
      "Selection pensee pour ameliorer le confort et l'experience de jeu.",
      "Compatible avec les setups gaming modernes selon le modele choisi.",
      ...common
    ];
  }

  if (category.includes("iptv")) {
    return [
      "Solution pratique pour profiter de contenus multimedia sur grand ecran.",
      "Support disponible pour vous orienter sur l'installation et la compatibilite.",
      ...common
    ];
  }

  if (category.includes("tv") || category.includes("home cinema")) {
    return [
      "Selection adaptee aux films, series, sport, videos et installations multimedia.",
      "Conseil disponible pour verifier la compatibilite avec votre TV, box, projecteur ou systeme audio.",
      ...common
    ];
  }

  if (category.includes("audio")) {
    return [
      "Concu pour les appels, la musique, les videos et l'utilisation quotidienne.",
      "Format pratique pour une utilisation a la maison, au travail ou en deplacement.",
      ...common
    ];
  }

  if (category.includes("montres")) {
    return [
      "Pratique pour les notifications, le suivi sport et les usages connectes.",
      "Design moderne adapte a une utilisation quotidienne.",
      ...common
    ];
  }

  if (category.includes("informatique")) {
    return [
      "Adapte a la bureautique, aux etudes, a la navigation et a la productivite.",
      "Selection utile pour equiper un espace de travail moderne.",
      ...common
    ];
  }

  if (category.includes("electromenager")) {
    return [
      "Produit pratique pour simplifier les taches de la maison et de la cuisine.",
      "Format adapte aux usages quotidiens avec un bon rapport utilite-prix.",
      ...common
    ];
  }

  if (category.includes("climatisation")) {
    return [
      "Produit adapte pour ameliorer le confort thermique a la maison, au bureau ou dans une piece de vie.",
      "Conseil disponible pour verifier la puissance, la ventilation et l'usage adapte a votre espace.",
      ...common
    ];
  }

  return [
    "Accessoire utile pour completer votre equipement high-tech.",
    "Bon rapport qualite-prix avec accompagnement avant achat.",
    ...common
  ];
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
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

function escapeXml(value) {
  return escapeHtml(value);
}

function toJsonLdScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function getDeferredPaymentNotifications() {
  return {
    adminEmail: "deferred_until_paid",
    customerEmail: "deferred_until_paid"
  };
}

function getSkippedPaidNotifications(reason = "skipped") {
  return {
    adminEmail: reason,
    customerEmail: reason
  };
}

async function notifyPaidOrderIfNeeded(order, request, previousOrder = null) {
  if (!order || order.paymentStatus !== "paid") {
    return getSkippedPaidNotifications("not_paid");
  }
  if (previousOrder?.paymentStatus === "paid") {
    return getSkippedPaidNotifications("already_paid");
  }
  const fullOrder = await database.getOrder(order.id) || order;
  if (fullOrder.paidNotificationSentAt) {
    return getSkippedPaidNotifications("already_sent");
  }

  const notifications = await sendPaidOrderEmails(fullOrder, request);
  const hasFailure = Object.values(notifications)
    .some(status => String(status || "").startsWith("failed"));
  if (!hasFailure) {
    await database.markPaidNotificationSent(fullOrder.id);
  }
  return notifications;
}

async function sendPaidOrderEmails(order, request) {
  const notifications = {
    adminEmail: "skipped",
    customerEmail: "skipped"
  };

  const tasks = [
    runNotification("adminEmail", async () => {
      const adminEmail = process.env.ORDER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";
      if (!adminEmail) return "skipped";
      return sendOrderEmail({
        to: adminEmail,
        subject: `Paiement confirme - commande ${order.id} - DieguemTech Store`,
        text: buildAdminOrderText(order, request),
        html: buildOrderEmailHtml(order, request, "admin")
      });
    }),
    runNotification("customerEmail", async () => {
      const customerEmail = order.customer?.email || order.customerEmail || "";
      if (!customerEmail) return "skipped";
      return sendOrderEmail({
        to: customerEmail,
        subject: `Paiement confirme - commande ${order.id} - DieguemTech Store`,
        text: buildCustomerOrderText(order, request),
        html: buildOrderEmailHtml(order, request, "customer")
      });
    })
  ];

  const results = await Promise.all(tasks);
  for (const result of results) {
    notifications[result.name] = result.status;
  }
  return notifications;
}

async function runNotification(name, task) {
  try {
    return { name, status: await task() };
  } catch (error) {
    console.error(`Notification ${name} impossible:`, getNotificationError(error));
    return { name, status: "failed" };
  }
}

async function sendOrderEmail({ to, subject, text, html }) {
  const apiKey = getEmailConfigValue("RESEND_API_KEY");
  const from = getEmailFrom();
  const recipient = normalizeEmail(to);
  if (!apiKey || !from || !recipient) return "skipped";
  await axios.post("https://api.resend.com/emails", {
    from,
    to: [recipient],
    subject,
    text,
    html
  }, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    timeout: 10000
  });
  return "sent";
}

function getEmailStatus() {
  const missing = getEmailMissingConfig();
  const from = getEmailFrom();
  return {
    provider: "resend",
    configured: missing.length === 0,
    missing,
    adminEmailConfigured: Boolean(getOrderAdminEmail()),
    fromConfigured: Boolean(from),
    fromDomain: getEmailDomain(from)
  };
}

function getEmailMissingConfig() {
  return [
    "RESEND_API_KEY",
    "ORDER_EMAIL_FROM",
    "ORDER_ADMIN_EMAIL"
  ].filter(name => {
    if (name === "ORDER_ADMIN_EMAIL") return !getOrderAdminEmail();
    return !getEmailConfigValue(name);
  });
}

function getEmailConfigValue(name) {
  return String(process.env[name] || "").trim();
}

function getEmailFrom() {
  return getEmailConfigValue("ORDER_EMAIL_FROM");
}

function getOrderAdminEmail() {
  return getEmailConfigValue("ORDER_ADMIN_EMAIL") || getEmailConfigValue("ADMIN_EMAIL");
}

function getEmailDomain(value) {
  const match = String(value || "").match(/@([^>\s]+)>?$/);
  return match ? match[1].toLowerCase() : "";
}

function getEmailErrorHint(error) {
  const details = getNotificationError(error).toLowerCase();
  const status = Number(error.response?.status || 0);
  if (details.includes("domain") || details.includes("verify") || details.includes("verified")) {
    return "Verifiez le domaine expediteur dans Resend et utilisez une adresse ORDER_EMAIL_FROM avec un domaine valide, par exemple DieguemTech Store <commandes@dieguemtechstore.com>.";
  }
  if (status === 401 || status === 403 || details.includes("api key")) {
    return "Verifiez RESEND_API_KEY dans Render.";
  }
  if (details.includes("from")) {
    return "Verifiez ORDER_EMAIL_FROM dans Render.";
  }
  if (details.includes("to") || details.includes("recipient")) {
    return "Verifiez ORDER_ADMIN_EMAIL dans Render.";
  }
  return "Ouvrez les logs Render pour le detail complet, puis verifiez RESEND_API_KEY, ORDER_EMAIL_FROM et ORDER_ADMIN_EMAIL.";
}

async function sendOrderWhatsApp({ to, text, templateName, templateParams = [] }) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !to) return "skipped";
  const recipient = normalizeWhatsAppRecipient(to);
  if (!recipient) return "skipped";

  const payload = templateName
    ? {
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "fr" },
          components: [{
            type: "body",
            parameters: templateParams.map(value => ({ type: "text", text: String(value) }))
          }]
        }
      }
    : buildWhatsAppTextPayload(recipient, text);

  if (!payload) return "skipped";

  const apiUrl = process.env.WHATSAPP_API_URL
    || `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v25.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await axios.post(apiUrl, payload, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    timeout: 10000
  });
  return "sent";
}

function buildWhatsAppTextPayload(to, text) {
  if (String(process.env.WHATSAPP_SEND_TEXT || "").toLowerCase() !== "true") return null;
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text
    }
  };
}

function buildAdminOrderText(order, request) {
  const isPaid = order.paymentStatus === "paid";
  const lines = [
    `${isPaid ? "Commande payee" : "Nouvelle commande"} ${order.id}`,
    `Client: ${getOrderCustomerName(order)}`,
    `Telephone: ${getOrderCustomerPhone(order)}`,
    getOrderCustomerEmail(order) ? `Email: ${getOrderCustomerEmail(order)}` : "",
    `Zone livraison: ${getOrderDeliveryZone(order)}`,
    `Adresse: ${getOrderAddress(order)}`,
    `Sous-total: ${formatSeoPrice(getOrderSubtotal(order))}`,
    `Livraison: ${formatSeoPrice(getOrderDeliveryFee(order))}`,
    `${isPaid ? "Total paye" : "Total a payer"}: ${formatSeoPrice(order.total)}`,
    `Paiement: ${formatPaymentProviderLabel(order.paymentProvider)}`,
    isPaid ? "Paiement confirme: oui" : "",
    !isPaid && usesWavePaymentLink(order) ? `Paiement Wave: ${wavePaymentUrl}` : "",
    "",
    "Articles:",
    ...getOrderItems(order).map(item => `- ${item.name} x${item.quantity} = ${formatSeoPrice(item.lineTotal)}`),
    "",
    `Admin: ${getPublicBaseUrl(request)}/admin.html`
  ].filter(line => line !== "");
  return lines.join("\n");
}

function buildCustomerOrderText(order, request) {
  const isPaid = order.paymentStatus === "paid";
  return [
    `Bonjour ${getOrderCustomerName(order)},`,
    isPaid
      ? `Votre paiement pour la commande ${order.id} chez DieguemTech Store est confirme.`
      : `Votre commande ${order.id} chez DieguemTech Store est bien enregistree.`,
    `Sous-total produits: ${formatSeoPrice(getOrderSubtotal(order))}.`,
    `Livraison ${getOrderDeliveryZone(order)}: ${formatSeoPrice(getOrderDeliveryFee(order))}.`,
    `${isPaid ? "Total paye" : "Total a payer"}: ${formatSeoPrice(order.total)}.`,
    !isPaid && usesWavePaymentLink(order) ? `Vous pouvez payer DieguemTech Store avec Wave en cliquant sur ce lien: ${wavePaymentUrl}` : "",
    isPaid
      ? "Notre equipe confirme le stock et organise la preparation/livraison."
      : "Notre equipe confirme le stock, la livraison et le paiement avant expedition.",
    `Suivi: ${getPublicBaseUrl(request)}/#suivi`
  ].filter(Boolean).join("\n");
}

function buildOrderEmailHtml(order, request, audience) {
  const isAdmin = audience === "admin";
  const isPaid = order.paymentStatus === "paid";
  const title = isAdmin
    ? (isPaid ? "Commande payee recue" : "Nouvelle commande recue")
    : (isPaid ? "Paiement confirme" : "Votre commande est enregistree");
  const intro = isAdmin
    ? (isPaid ? "Le paiement de cette commande est confirme." : "Une nouvelle commande vient d'arriver sur DieguemTech Store.")
    : (isPaid ? "Merci pour votre paiement. Gardez ce numero pour le suivi et les echanges avec le support." : "Merci pour votre commande. Gardez ce numero pour le suivi et les echanges avec le support.");
  const items = getOrderItems(order)
    .map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${Number(item.quantity)}</td><td>${escapeHtml(formatSeoPrice(item.lineTotal))}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="fr">
<body style="margin:0;background:#f6f6f6;font-family:Arial,sans-serif;color:#313133">
  <main style="max-width:680px;margin:0 auto;padding:24px">
    <section style="background:#fff;border-radius:18px;padding:26px;border:1px solid #ececec">
      <p style="margin:0 0 8px;color:#f68b1e;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px">DieguemTech Store</p>
      <h1 style="margin:0 0 10px;font-size:26px;color:#1c1c1e">${escapeHtml(title)}</h1>
      <p style="margin:0 0 22px;color:#666;line-height:1.6">${escapeHtml(intro)}</p>
      <div style="background:#fff8f0;border:1px dashed rgba(246,139,30,.35);border-radius:14px;padding:16px;margin-bottom:18px">
        <span style="display:block;color:#777;font-size:12px;text-transform:uppercase;font-weight:800">Numero de commande</span>
        <strong style="font-size:24px;color:#f68b1e">${escapeHtml(order.id)}</strong>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#777">Client</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(getOrderCustomerName(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Telephone</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderCustomerPhone(order))}</td></tr>
        ${getOrderCustomerEmail(order) ? `<tr><td style="padding:8px 0;color:#777">Email</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderCustomerEmail(order))}</td></tr>` : ""}
        <tr><td style="padding:8px 0;color:#777">Zone livraison</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderDeliveryZone(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Adresse</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderAddress(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Paiement</td><td style="padding:8px 0;text-align:right">${escapeHtml(formatPaymentProviderLabel(order.paymentProvider))}</td></tr>
        ${isPaid ? `<tr><td style="padding:8px 0;color:#777">Statut paiement</td><td style="padding:8px 0;text-align:right;color:#0f8f5f;font-weight:700">Confirme</td></tr>` : ""}
        ${!isPaid && usesWavePaymentLink(order) ? `<tr><td style="padding:8px 0;color:#777">Wave</td><td style="padding:8px 0;text-align:right"><a href="${escapeHtml(wavePaymentUrl)}" style="color:#f68b1e;font-weight:700">Payer avec Wave</a></td></tr>` : ""}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#fafafa"><th style="text-align:left;padding:10px">Produit</th><th style="text-align:center;padding:10px">Qte</th><th style="text-align:right;padding:10px">Total</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div style="margin:18px 0 0;margin-left:auto;max-width:300px;font-size:14px">
        <p style="display:flex;justify-content:space-between;margin:6px 0;color:#666"><span>Sous-total</span><strong>${escapeHtml(formatSeoPrice(getOrderSubtotal(order)))}</strong></p>
        <p style="display:flex;justify-content:space-between;margin:6px 0;color:#666"><span>Livraison</span><strong>${escapeHtml(formatSeoPrice(getOrderDeliveryFee(order)))}</strong></p>
        <p style="display:flex;justify-content:space-between;margin:10px 0 0;padding-top:10px;border-top:1px solid #eee;font-size:20px;font-weight:800;color:#f68b1e"><span>Total</span><strong>${escapeHtml(formatSeoPrice(order.total))}</strong></p>
      </div>
      <p style="margin:22px 0 0;color:#777;font-size:12px;line-height:1.6">Suivi commande: ${escapeHtml(getPublicBaseUrl(request))}/#suivi</p>
    </section>
  </main>
</body>
</html>`;
}

function getAdminWhatsAppTemplateParams(order) {
  return [
    order.id,
    getOrderCustomerName(order),
    getOrderCustomerPhone(order),
    formatSeoPrice(order.total)
  ];
}

function getCustomerWhatsAppTemplateParams(order) {
  return [
    getOrderCustomerName(order),
    order.id,
    formatSeoPrice(order.total)
  ];
}

function getOrderItems(order) {
  return Array.isArray(order.items) ? order.items : [];
}

function getOrderCustomerName(order) {
  return order.customer?.name || order.customerName || "";
}

function getOrderCustomerPhone(order) {
  return order.customer?.phone || order.customerPhone || "";
}

function getOrderCustomerEmail(order) {
  return order.customer?.email || order.customerEmail || "";
}

function getOrderAddress(order) {
  return order.customer?.address || order.deliveryAddress || "";
}

function getOrderDeliveryZone(order) {
  return order.deliveryZone || order.delivery_zone || "A confirmer";
}

function getOrderDeliveryFee(order) {
  return Number(order.deliveryFee || order.delivery_fee || 0);
}

function formatPaymentProviderLabel(provider) {
  const value = String(provider || "").trim();
  if (value === cashOnDeliveryProvider) return "Paiement a la livraison";
  if (value === waveProvider) return "Wave";
  return value || "A confirmer";
}

function usesWavePaymentLink(order) {
  const provider = String(order.paymentProvider || "").trim();
  return provider === waveProvider || provider === cashOnDeliveryProvider;
}

function getOrderSubtotal(order) {
  const subtotal = Number(order.subtotal || 0);
  if (subtotal > 0) return subtotal;
  return Math.max(0, Number(order.total || 0) - getOrderDeliveryFee(order));
}

function normalizeWhatsAppRecipient(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("221")) return digits;
  if (digits.length === 9) return `221${digits}`;
  return digits;
}

function getNotificationError(error) {
  const data = error.response?.data;
  if (!data) return error.message;
  if (typeof data === "string") return data.slice(0, 250);
  return JSON.stringify(data).slice(0, 250);
}

async function createPayDunyaPayment(order, request) {
  const payload = buildPayDunyaPayload(order, request);

  try {
    const paydunyaResponse = await axios.post(
      `${getPayDunyaApiBaseUrl()}/checkout-invoice/create`,
      payload,
      {
        headers: getPayDunyaHeaders(),
        timeout: 15000
      }
    );

    const data = paydunyaResponse.data || {};
    const redirectUrl = getPayDunyaRedirectUrl(data);
    if (data.response_code !== "00" || !redirectUrl) {
      const error = new Error(`PayDunya n'a pas renvoye de lien de paiement. Reponse: ${JSON.stringify(data).slice(0, 250)}`);
      error.status = 502;
      throw error;
    }
    return {
      redirectUrl,
      token: typeof data.token === "string" ? data.token : ""
    };
  } catch (error) {
    if (error.status && !error.isAxiosError) throw error;
    const details = getPayDunyaErrorDetails(error);
    const paymentError = new Error(`PayDunya a refuse la demande de paiement.${details ? ` Detail: ${details}` : ""}`);
    paymentError.status = 502;
    paymentError.cause = error;
    throw paymentError;
  }
}

function buildPayDunyaPayload(order, request) {
  const baseUrl = getBaseUrl(request);
  const customerEmail = getOrderCustomerEmail(order);
  const customer = {
    name: getOrderCustomerName(order),
    phone: getOrderCustomerPhone(order)
  };
  if (customerEmail) customer.email = customerEmail;

  const items = {};
  getOrderItems(order).forEach((item, index) => {
    items[`item_${index}`] = {
      name: truncateText(item.name || `Produit ${item.productId || index + 1}`, 90),
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unitPrice || 0),
      total_price: Number(item.lineTotal || 0),
      description: ""
    };
  });

  const invoice = {
    total_amount: Number(order.total || 0),
    description: `Commande ${order.id} - DieguemTech Store`,
    customer
  };
  if (Object.keys(items).length) invoice.items = items;

  const deliveryFee = getOrderDeliveryFee(order);
  if (deliveryFee > 0) {
    invoice.taxes = {
      tax_0: {
        name: `Livraison ${getOrderDeliveryZone(order)}`,
        amount: deliveryFee
      }
    };
  }

  return {
    invoice,
    store: {
      name: process.env.PAYDUNYA_STORE_NAME || "DieguemTech Store"
    },
    custom_data: {
      order_id: order.id,
      source: "dieguemtech-store"
    },
    actions: {
      cancel_url: `${baseUrl}/payment-cancel`,
      return_url: `${baseUrl}/payment-success/paydunya`,
      callback_url: `${baseUrl}/api/paydunya/ipn`
    }
  };
}

async function confirmPayDunyaInvoice(token) {
  try {
    const paydunyaResponse = await axios.get(
      `${getPayDunyaApiBaseUrl()}/checkout-invoice/confirm/${encodeURIComponent(token)}`,
      {
        headers: getPayDunyaHeaders(),
        timeout: 15000
      }
    );

    const data = paydunyaResponse.data || {};
    if (data.response_code !== "00") {
      const error = new Error(`PayDunya n'a pas confirme la facture. Reponse: ${JSON.stringify(data).slice(0, 250)}`);
      error.status = 502;
      throw error;
    }
    if (!verifyPayDunyaHash(data.hash)) {
      const error = new Error("La confirmation PayDunya a echoue: hash invalide.");
      error.status = 502;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.status && !error.isAxiosError) throw error;
    const details = getPayDunyaErrorDetails(error);
    const paymentError = new Error(`Impossible de confirmer le paiement PayDunya.${details ? ` Detail: ${details}` : ""}`);
    paymentError.status = 502;
    paymentError.cause = error;
    throw paymentError;
  }
}

function getPayDunyaRedirectUrl(data) {
  const candidates = [
    data?.response_text,
    data?.invoice_url,
    data?.checkout_url,
    data?.url
  ];
  const direct = candidates.find(isPayDunyaUrl);
  if (direct) return direct;
  return findPayDunyaUrlInObject(data);
}

function findPayDunyaUrlInObject(value) {
  if (!value || typeof value !== "object") return null;
  for (const item of Object.values(value)) {
    if (isPayDunyaUrl(item)) return item;
    if (item && typeof item === "object") {
      const nested = findPayDunyaUrlInObject(item);
      if (nested) return nested;
    }
  }
  return null;
}

function isPayDunyaUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    return ["http:", "https:"].includes(url.protocol)
      && (hostname === "paydunya.com" || hostname.endsWith(".paydunya.com"));
  } catch (error) {
    return false;
  }
}

function parsePayDunyaData(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return {};
    }
  }
  return value;
}

function verifyPayDunyaHash(hash) {
  if (!hasPayDunyaConfig() || !hash) return false;
  const expected = crypto.createHash("sha512").update(process.env.PAYDUNYA_MASTER_KEY).digest("hex");
  const received = String(hash || "").trim().toLowerCase();
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

async function updateOrderFromPayDunyaData(data) {
  const orderId = getPayDunyaOrderId(data);
  const paymentStatus = getPayDunyaPaymentStatus(data?.status);
  const orderStatus = paymentStatus === "paid"
    ? "paid"
    : paymentStatus === "failed"
      ? "cancelled"
      : null;
  const previousOrder = orderId ? await database.getOrder(orderId) : null;
  const updatedOrder = orderId
    ? await database.updateOrderStatus(orderId, { orderStatus, paymentStatus })
    : null;
  const order = updatedOrder
    ? await database.getOrder(updatedOrder.id) || updatedOrder
    : null;
  return { orderId, paymentStatus, order, previousOrder };
}

function getPayDunyaOrderId(data) {
  const customData = data?.custom_data || data?.invoice?.custom_data || {};
  const orderId = customData.order_id || customData.orderId || customData.ref_command;
  if (orderId) return String(orderId).trim().toUpperCase();
  const description = String(data?.invoice?.description || "");
  const match = description.match(/DT-\d+-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function getPayDunyaPaymentStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") return "paid";
  if (["cancelled", "canceled", "failed"].includes(normalized)) return "failed";
  return "pending";
}

function getPayDunyaErrorDetails(error) {
  const data = error.response?.data;
  if (!data) return error.message;
  if (typeof data === "string") return data.slice(0, 250);
  const candidates = [
    data.response_text,
    data.message,
    data.error,
    data.errors,
    data.description
  ].filter(Boolean);
  if (candidates.length) {
    return candidates.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" | ").slice(0, 250);
  }
  return JSON.stringify(data).slice(0, 250);
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
    customerName: orderInput.customer.name,
    customerPhone: orderInput.customer.phone,
    customerEmail: orderInput.customer.email || "",
    deliveryZone: orderInput.deliveryZone,
    deliveryAddress: orderInput.customer.address,
    items: normalizedItems,
    subtotal: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
    deliveryFee: Number(orderInput.deliveryFee || 0),
    currency: "XOF",
    paymentStatus: "pending",
    orderStatus: "pending",
    createdAt: new Date().toISOString()
  };
  order.total = order.subtotal + order.deliveryFee;
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
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="shortcut icon" href="/assets/favicon.svg">
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
    <div class="mark">${status === "success" ? "&#10003;" : "!"}</div>
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
