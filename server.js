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
const seoContentLastModified = "2026-07-17";
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
const adminSessionTtlMs = 8 * 60 * 60 * 1000;
const adminLoginWindowMs = 15 * 60 * 1000;
const adminLoginMaxAttempts = 8;
const adminSessions = new Map();
const adminLoginAttempts = new Map();
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
app.use(securityHeaders);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(canonicalDomainRedirect);

app.get("/api/health", (request, response) => {
  response.json({
    status: "ok",
    service: "DieguemTech Store",
    database: database.hasDatabase ? "postgresql" : "local"
  });
});

app.get("/api/paydunya/status", requireAdmin, (request, response) => {
  response.json({
    configured: hasPayDunyaConfig(),
    mode: getPayDunyaMode(),
    minimumAmount: getPayDunyaMinimumAmount(),
    missing: getPayDunyaMissingConfig()
  });
});

app.get("/api/email/status", requireAdmin, (request, response) => {
  response.json(getEmailStatus());
});

app.get("/api/marketing/config", (request, response) => {
  response.set("Cache-Control", "no-store");
  response.json(getMarketingConfig());
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
  const clientKey = getAdminLoginKey(request);
  if (!getAdminPassword()) {
    return response.status(503).json({ error: "ADMIN_PASSWORD n'est pas configure dans Render." });
  }
  if (isAdminLoginBlocked(clientKey)) {
    return response.status(429).json({ error: "Trop de tentatives. Reessayez dans quelques minutes." });
  }
  if (!isValidAdminPassword(password)) {
    recordFailedAdminLogin(clientKey);
    return response.status(401).json({ error: "Mot de passe admin invalide." });
  }
  resetAdminLoginAttempts(clientKey);
  response.json(createAdminSession());
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

app.delete("/api/admin/orders", requireAdmin, async (request, response, next) => {
  try {
    response.json(await database.deleteAllOrders());
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
    const notifications = {
      paid: await notifyPaidOrderIfNeeded(fullOrder, request, previousOrder),
      status: await notifyOrderStatusIfNeeded(fullOrder, request, previousOrder)
    };
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

app.get("/robots.txt", (request, response) => {
  response
    .type("text/plain")
    .set("Cache-Control", "public, max-age=3600")
    .send(renderRobotsTxt(getPublicBaseUrl(request)));
});

app.get("/sitemap.xml", async (request, response, next) => {
  try {
    const products = await database.getProducts();
    response
      .type("application/xml")
      .set("Cache-Control", "public, max-age=3600")
      .send(renderSitemap(getPublicBaseUrl(request), products));
  } catch (error) {
    next(error);
  }
});

app.get("/produit/:id", renderProductSeoRoute);
app.get("/produit/:id/:slug", renderProductSeoRoute);
app.get("/categorie/:categorySlug", renderCategorySeoRoute);
app.get("/categorie/:categorySlug/:subcategorySlug", renderCategorySeoRoute);
app.get("/conditions-generales", renderLegalPageRoute);
app.get("/politique-confidentialite", renderLegalPageRoute);
app.get("/livraison-retours", renderLegalPageRoute);
app.get("/mentions-legales", renderLegalPageRoute);

app.post("/api/orders", async (request, response, next) => {
  try {
    const { customer, items, paymentProvider, attribution } = request.body;
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
      paymentProvider,
      attribution: normalizeOrderAttribution(attribution)
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

app.use("/assets", express.static(path.join(__dirname, "assets"), {
  dotfiles: "ignore",
  etag: true,
  immutable: true,
  index: false,
  maxAge: "7d"
}));

app.get("/", sendPublicFile("index.html"));
app.get("/index.html", (request, response) => response.redirect(301, "/"));
app.get("/app.js", sendPublicFile("app.js"));
app.get("/styles.css", sendPublicFile("styles.css"));
app.get("/offline.html", sendPublicFile("offline.html"));
app.get("/admin", sendPublicFile("admin.html", { noStore: true }));
app.get("/admin.html", sendPublicFile("admin.html", { noStore: true }));
app.get("/admin.js", sendPublicFile("admin.js", { noStore: true }));
app.get("/admin.css", sendPublicFile("admin.css", { noStore: true }));

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

function securityHeaders(request, response, next) {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://analytics.tiktok.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://analytics.tiktok.com https://paydunya.com https://*.paydunya.com",
      "manifest-src 'self'",
      "worker-src 'self'"
    ].join("; ")
  });
  next();
}

function sendPublicFile(fileName, options = {}) {
  const filePath = path.join(__dirname, fileName);
  return (request, response) => {
    response.set("Cache-Control", options.noStore ? "no-store" : "public, max-age=300");
    response.sendFile(filePath);
  };
}

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

function normalizeOrderAttribution(attribution = {}) {
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return {};
  return {
    source: cleanAnalyticsString(attribution.source, 80) || "",
    medium: cleanAnalyticsString(attribution.medium, 80) || "",
    campaign: cleanAnalyticsString(attribution.campaign, 120) || "",
    content: cleanAnalyticsString(attribution.content, 120) || "",
    term: cleanAnalyticsString(attribution.term, 120) || "",
    clickId: cleanAnalyticsString(attribution.clickId, 160) || "",
    clickType: cleanAnalyticsString(attribution.clickType, 40) || "",
    landingPage: cleanAnalyticsString(attribution.landingPage, 240) || "",
    capturedAt: cleanAnalyticsString(attribution.capturedAt, 40) || ""
  };
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

function isValidAdminPassword(password) {
  const expected = getAdminPassword();
  const received = String(password || "");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function createAdminSession() {
  cleanupAdminSessions();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + adminSessionTtlMs;
  adminSessions.set(hashAdminToken(token), { expiresAt });
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

function hashAdminToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function cleanupAdminSessions(now = Date.now()) {
  for (const [tokenHash, session] of adminSessions.entries()) {
    if (!session?.expiresAt || session.expiresAt <= now) adminSessions.delete(tokenHash);
  }
}

function getBearerToken(request) {
  const header = String(request.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isValidAdminSession(token) {
  if (!token) return false;
  cleanupAdminSessions();
  const session = adminSessions.get(hashAdminToken(token));
  if (!session || session.expiresAt <= Date.now()) return false;
  return true;
}

function getAdminLoginKey(request) {
  return String(request.ip || request.socket?.remoteAddress || "unknown").slice(0, 120);
}

function isAdminLoginBlocked(key) {
  const entry = adminLoginAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    adminLoginAttempts.delete(key);
    return false;
  }
  return entry.count >= adminLoginMaxAttempts;
}

function recordFailedAdminLogin(key) {
  const now = Date.now();
  const current = adminLoginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    adminLoginAttempts.set(key, { count: 1, resetAt: now + adminLoginWindowMs });
    return;
  }
  current.count += 1;
}

function resetAdminLoginAttempts(key) {
  adminLoginAttempts.delete(key);
}

function requireAdmin(request, response, next) {
  if (!getAdminPassword()) {
    return response.status(503).json({ error: "ADMIN_PASSWORD n'est pas configure dans Render." });
  }
  if (!isValidAdminSession(getBearerToken(request))) {
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

function getMarketingConfig() {
  const config = {
    metaPixelId: getPublicConfigValue("META_PIXEL_ID"),
    tiktokPixelId: getPublicConfigValue("TIKTOK_PIXEL_ID"),
    googleTagManagerId: getPublicConfigValue("GOOGLE_TAG_MANAGER_ID"),
    googleAdsId: getPublicConfigValue("GOOGLE_ADS_ID"),
    googleAdsLeadLabel: getPublicConfigValue("GOOGLE_ADS_LEAD_LABEL")
  };
  return {
    ...config,
    configured: {
      meta: Boolean(config.metaPixelId),
      tiktok: Boolean(config.tiktokPixelId),
      googleTagManager: Boolean(config.googleTagManagerId),
      googleAds: Boolean(config.googleAdsId)
    }
  };
}

function getPublicConfigValue(name) {
  return String(process.env[name] || "").trim();
}

function canonicalDomainRedirect(request, response, next) {
  if (!["GET", "HEAD"].includes(request.method)) return next();
  const hostname = String(request.hostname || "").toLowerCase();
  const shouldRedirect = hostname === "www.dieguemtechstore.com" || hostname.endsWith(".onrender.com");
  if (!shouldRedirect) return next();
  if (request.path.startsWith("/api/")) return next();
  response.redirect(301, `https://dieguemtechstore.com${request.originalUrl || request.url || "/"}`);
}

function renderRobotsTxt(baseUrl) {
  return `User-agent: *
Allow: /
Allow: /assets/
Allow: /api/uploads/
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`;
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
  const topCampaignSources = new Map();
  const topCampaigns = new Map();

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
    const campaignSource = cleanAnalyticsString(metadata.campaignSource, 90);
    const campaignName = cleanAnalyticsString(metadata.campaignName, 120);
    if (campaignSource) {
      incrementCounter(topCampaignSources, campaignSource, eventName === "order_created" ? 4 : 1);
    }
    if (campaignName) {
      incrementCounter(topCampaigns, campaignName, eventName === "order_created" ? 4 : 1);
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
    topCampaignSources: mapToSimpleList(topCampaignSources).slice(0, 8),
    topCampaigns: mapToSimpleList(topCampaigns).slice(0, 8),
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

function renderLocalSeoMeta({ canonicalUrl = "" } = {}) {
  return `  <meta name="language" content="fr-SN">
  <meta name="geo.region" content="SN-DK">
  <meta name="geo.placename" content="Dakar, Senegal">
  <meta name="geo.position" content="14.7167;-17.4677">
  <meta name="ICBM" content="14.7167, -17.4677">
  ${canonicalUrl ? `<link rel="alternate" hreflang="fr-SN" href="${escapeHtml(canonicalUrl)}">\n  <link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalUrl)}">` : ""}`;
}

function renderLegalPageRoute(request, response, next) {
  try {
    const slug = request.path.replace(/^\/+/, "").toLowerCase();
    const page = getLegalPage(slug);
    if (!page) return next();
    response.send(renderLegalPage(page, getPublicBaseUrl(request)));
  } catch (error) {
    next(error);
  }
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
  const categoryPages = getCategorySitemapEntries(products);
  const legalPages = getLegalPages();
  const urls = [
    {
      loc: `${baseUrl}/`,
      lastmod: seoContentLastModified,
      image: `${baseUrl}/assets/hero-tech.png`,
      imageTitle: "DieguemTech Store - boutique high-tech au Senegal"
    },
    ...categoryPages.map(page => ({
      loc: `${baseUrl}${page.path}`,
      lastmod: seoContentLastModified,
      image: page.image ? absoluteUrl(page.image, baseUrl) : `${baseUrl}/assets/hero-tech.png`,
      imageTitle: page.title
    })),
    ...legalPages.map(page => ({
      loc: `${baseUrl}${page.path}`,
      lastmod: seoContentLastModified,
      image: `${baseUrl}/assets/hero-tech.png`,
      imageTitle: page.title
    })),
    ...products.map(product => ({
      loc: `${baseUrl}${productPath(product)}`,
      lastmod: getSitemapLastModified(product.updatedAt || product.updated_at || product.createdAt),
      image: absoluteUrl(getProductImages(product)[0], baseUrl),
      imageTitle: product.name
    }))
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(url => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
${url.lastmod ? `    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : ""}
${url.image ? `    <image:image>
      <image:loc>${escapeXml(url.image)}</image:loc>
      <image:title>${escapeXml(url.imageTitle || "DieguemTech Store")}</image:title>
    </image:image>` : ""}
  </url>`).join("\n")}
</urlset>`;
}

function getSitemapLastModified(value) {
  if (!value) return seoContentLastModified;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? seoContentLastModified : date.toISOString().slice(0, 10);
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
  <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta name="description" content="${escapeHtml(description)}">
${renderLocalSeoMeta({ canonicalUrl })}
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="fr_SN">
  <meta property="og:site_name" content="DieguemTech Store">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(heroImageUrl)}">
  <meta property="og:image:alt" content="${escapeHtml(currentTitle)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(heroImageUrl)}">
  <meta name="twitter:image:alt" content="${escapeHtml(currentTitle)}">
  <meta name="theme-color" content="#f68b1e">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="shortcut icon" href="/assets/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/logo-mark.svg">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css?v=20260718-mobile-polish">
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
    .category-toast{position:fixed;right:24px;bottom:24px;background:#222;color:#fff;border-radius:14px;padding:18px 20px;box-shadow:0 16px 40px rgba(0,0,0,.24);transform:translateY(90px);opacity:0;transition:.25s;z-index:100;display:flex;align-items:flex-start;gap:15px;max-width:470px}
    .category-toast.active{transform:translateY(0);opacity:1}
    .category-toast>span{width:27px;height:27px;border-radius:50%;background:#16a66a;display:grid;place-items:center;min-width:27px}
    .category-toast p{margin:0;min-width:0;flex:1;display:flex;flex-direction:column}.category-toast strong{display:block;font-size:13px}.category-toast small{color:#bbb;font-size:11px;line-height:1.45}
    .category-toast-actions{display:flex;gap:10px;margin-left:4px}.category-toast-actions button{border:0;border-radius:9px;background:#f68b1e;color:#fff;font-weight:800;font-size:12px;padding:11px 14px;white-space:nowrap}.category-toast-actions button.ghost{background:#3a3a3d}
    @media(max-width:1000px){.category-products-grid,.category-subgrid{grid-template-columns:repeat(3,1fr)}.category-hero{grid-template-columns:1fr}}
    @media(max-width:760px){.category-page{width:min(100% - 20px,1180px);padding:16px 0 32px}.category-top{align-items:flex-start;flex-direction:column;gap:12px;margin-bottom:16px}.category-logo img{width:168px}.category-nav-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.category-nav-actions a{text-align:center;min-height:44px}.category-hero{padding:26px 20px;border-radius:20px;gap:18px}.category-hero h1{font-size:34px;letter-spacing:-1px}.category-hero p{font-size:13px;line-height:1.65}.category-hero-visual{min-height:150px;padding:16px}.category-hero-visual img{max-height:140px}.category-products-grid,.category-subgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.category-section{padding:16px;border-radius:18px;margin-top:18px}.category-section-head{align-items:flex-start;flex-direction:column;gap:6px}.category-section-head h2{font-size:21px}.category-subcard{grid-template-rows:105px auto;border-radius:13px}.category-subvisual{padding:10px}.category-subvisual img{max-height:84px}.category-subbody{padding:11px}.category-product-card{border-radius:14px}.category-product-visual{height:142px;padding:10px}.category-product-visual img{max-height:120px}.category-product-body{padding:11px;gap:5px}.category-product-body h3{font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:33px}.category-product-body p{display:none}.category-product-price{font-size:13px}.category-product-actions{padding:9px;display:grid;grid-template-columns:1fr 1fr}.category-see-link,.category-cart-button{display:flex;align-items:center;justify-content:center;min-height:42px;padding:8px 6px;font-size:10px;border-radius:8px;text-align:center}.category-toast{left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom));max-width:none}}
    @media(max-width:520px){.category-hero{padding:22px 18px}.category-hero h1{font-size:30px}.category-pill{padding:7px 9px;font-size:10px}.category-toast{display:grid;grid-template-columns:27px 1fr}.category-toast-actions{grid-column:1/-1;margin-left:0;width:100%;display:grid;grid-template-columns:1fr 1fr}.category-toast-actions button{width:100%}}
  </style>
  <script type="application/ld+json">${toJsonLdScript(structuredData)}</script>
</head>
<body>
  ${renderFloatingSupportMessage()}
  ${renderStandaloneMobileNav("categories")}
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
        ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="${escapeHtml(currentTitle)}" fetchpriority="high" decoding="async">` : "<span>DT</span>"}
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
  <div class="category-toast" id="categoryToast" aria-live="polite">
    <span>✓</span>
    <p><strong>Produit ajoute</strong><small>Voulez-vous aller au panier ou continuer vos achats ?</small></p>
    <div class="category-toast-actions">
      <button type="button" id="categoryCartOpen">Voir le panier</button>
      <button type="button" class="ghost" id="categoryCartContinue">Continuer</button>
    </div>
  </div>
  <script>
    (function(){
      var toast = document.getElementById("categoryToast");
      function showToast(name) {
        if (!toast) return;
        toast.querySelector("strong").textContent = "Produit ajoute";
        toast.querySelector("small").textContent = name ? name + " est dans votre panier. Que voulez-vous faire ?" : "Votre panier a ete mis a jour. Que voulez-vous faire ?";
        toast.classList.add("active");
        clearTimeout(showToast.timer);
      }
      function hideToast(){
        if (!toast) return;
        toast.classList.remove("active");
        clearTimeout(showToast.timer);
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
      var openCartButton = document.getElementById("categoryCartOpen");
      if (openCartButton) {
        openCartButton.addEventListener("click", function(){
          hideToast();
          window.location.href = "/?cart=open#boutique";
        });
      }
      var continueButton = document.getElementById("categoryCartContinue");
      if (continueButton) {
        continueButton.addEventListener("click", hideToast);
      }
    })();
  </script>
  ${renderFloatingSupportScript()}
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
      <a class="category-see-link" href="${escapeHtml(productPath(product))}" aria-label="Voir ${escapeHtml(product.name)}">Voir</a>
      <button class="category-cart-button" type="button" data-cart-product="${Number(product.id)}" data-product-name="${escapeHtml(product.name)}" aria-label="Ajouter ${escapeHtml(product.name)} au panier">Ajouter</button>
    </div>
  </article>`;
}

function getLegalPages() {
  return [
    {
      slug: "conditions-generales",
      path: "/conditions-generales",
      title: "Conditions generales de vente",
      eyebrow: "Cadre d'achat",
      description: "Conditions generales applicables aux commandes passees sur DieguemTech Store au Senegal.",
      intro: "Ces conditions expliquent les regles de commande, de paiement, de livraison, de garantie et de support pour les achats effectues sur DieguemTech Store.",
      sections: [
        {
          title: "1. Objet",
          paragraphs: [
            "Les presentes conditions generales encadrent les ventes de produits high-tech, gaming, IPTV, smartphones, accessoires, gadgets electroniques et petit electromenager proposees par DieguemTech Store.",
            "Toute commande passee sur le site implique l'acceptation de ces conditions par le client."
          ]
        },
        {
          title: "2. Produits et disponibilite",
          paragraphs: [
            "Les produits sont presentes avec leurs caracteristiques principales, images, prix et informations utiles. Les images sont fournies a titre illustratif et peuvent legerement differer du produit reel selon les arrivages, couleurs ou variantes.",
            "La disponibilite du stock peut etre confirmee par l'equipe avant expedition, notamment pour les produits a forte demande."
          ]
        },
        {
          title: "3. Prix",
          paragraphs: [
            "Les prix sont affiches en FCFA. Les frais de livraison sont ajoutes selon la zone choisie par le client.",
            "DieguemTech Store peut mettre a jour les prix, promotions et stocks a tout moment. Le prix applicable est celui affiche au moment de la validation de la commande."
          ]
        },
        {
          title: "4. Commande",
          paragraphs: [
            "Le client doit fournir des informations exactes : nom, telephone joignable, zone de livraison, adresse ou repere, et email si disponible.",
            "Une commande est consideree comme enregistree apres validation du formulaire. Elle est confirmee apres paiement valide ou confirmation directe par l'equipe pour les paiements a la livraison."
          ]
        },
        {
          title: "5. Paiement",
          paragraphs: [
            "Les moyens de paiement disponibles sont PayDunya, Wave et paiement a la livraison selon les produits et zones.",
            "PayDunya peut appliquer un montant minimum. Pour les petites commandes, le client peut choisir Wave, paiement a la livraison ou commander via WhatsApp.",
            "Les emails de confirmation de commande sont envoyes apres validation effective du paiement lorsque le moyen de paiement le permet."
          ]
        },
        {
          title: "6. Livraison",
          paragraphs: [
            "La livraison est disponible a Dakar et dans plusieurs zones du Senegal. Les delais peuvent varier selon la disponibilite du produit, la zone et la confirmation du client.",
            "Le client doit rester joignable pour faciliter la livraison. En cas d'adresse incomplete ou d'indisponibilite du client, la livraison peut etre reprogrammee."
          ]
        },
        {
          title: "7. Retours, garantie et reclamations",
          paragraphs: [
            "Tout probleme constate a la reception doit etre signale rapidement au support avec le numero de commande, des photos ou videos si necessaire.",
            "Les retours et garanties sont etudies selon la nature du produit, son etat, les conditions fournisseur et l'utilisation constatee.",
            "Les produits endommages par mauvaise utilisation, choc, humidite, modification ou installation incorrecte peuvent etre exclus de la garantie."
          ]
        },
        {
          title: "8. Responsabilites",
          paragraphs: [
            "DieguemTech Store s'engage a traiter les commandes avec serieux, a conseiller les clients et a fournir les informations disponibles sur les produits.",
            "Le client reste responsable du choix du produit, de la compatibilite avec ses appareils et de l'exactitude des informations fournies."
          ]
        },
        {
          title: "9. Contact",
          paragraphs: [
            "Pour toute question, reclamation ou assistance, le client peut contacter DieguemTech Store par WhatsApp au +221772177176 ou par email a contact@dieguemtech.com."
          ]
        }
      ]
    },
    {
      slug: "politique-confidentialite",
      path: "/politique-confidentialite",
      title: "Politique de confidentialite",
      eyebrow: "Donnees personnelles",
      description: "Politique de confidentialite de DieguemTech Store concernant les donnees collectees pour les commandes, paiements, livraison, support et analytics.",
      intro: "Cette politique explique quelles donnees sont collectees, pourquoi elles sont utilisees, avec qui elles peuvent etre partagees et comment exercer vos droits.",
      sections: [
        {
          title: "1. Donnees collectees",
          paragraphs: [
            "Lors d'une commande, DieguemTech Store peut collecter le nom, le telephone, l'email, l'adresse ou le repere de livraison, la zone de livraison, les produits commandes et les informations de suivi de paiement.",
            "Le site peut aussi collecter des donnees techniques limitees comme la page visitee, le produit consulte, la source de campagne, le navigateur et des evenements de navigation utiles pour ameliorer le service."
          ]
        },
        {
          title: "2. Finalites",
          paragraphs: [
            "Les donnees sont utilisees pour traiter les commandes, confirmer le stock, organiser la livraison, suivre le paiement, fournir le support client, envoyer des emails de confirmation et ameliorer l'experience du site.",
            "Les donnees de navigation et campagnes servent a comprendre les performances commerciales et publicitaires de la boutique."
          ]
        },
        {
          title: "3. Base de traitement et consentement",
          paragraphs: [
            "Les donnees de commande sont necessaires a l'execution de la vente et au suivi client.",
            "Les donnees marketing ou publicitaires peuvent dependre du consentement de l'utilisateur ou des reglages de son navigateur lorsque des outils tiers sont utilises."
          ]
        },
        {
          title: "4. Partage des donnees",
          paragraphs: [
            "Les donnees peuvent etre partagees uniquement avec les prestataires necessaires au service : hebergement, base de donnees, paiement, email, livraison, analytics ou support.",
            "DieguemTech Store ne revend pas les donnees personnelles des clients."
          ]
        },
        {
          title: "5. Paiement",
          paragraphs: [
            "Les paiements en ligne sont traites par les prestataires selectionnes, notamment PayDunya. DieguemTech Store ne stocke pas les donnees sensibles de carte bancaire.",
            "Pour Wave ou paiement a la livraison, les informations de commande servent a confirmer et suivre le paiement."
          ]
        },
        {
          title: "6. Conservation",
          paragraphs: [
            "Les donnees de commande sont conservees aussi longtemps que necessaire pour le suivi commercial, le support, les obligations administratives et la preuve de transaction.",
            "Les donnees analytics peuvent etre conservees sous forme technique pour suivre les performances du site."
          ]
        },
        {
          title: "7. Securite",
          paragraphs: [
            "Le site utilise HTTPS, un acces admin protege, des sessions temporaires, des limites de televersement et des controles serveur afin de reduire les risques d'acces non autorise.",
            "Aucune mesure technique n'etant absolue, DieguemTech Store continue d'ameliorer la securite du site."
          ]
        },
        {
          title: "8. Droits des clients",
          paragraphs: [
            "Le client peut demander l'acces, la correction ou la suppression de ses donnees lorsque cela est applicable.",
            "Pour exercer ces droits, contactez DieguemTech Store par email a contact@dieguemtech.com ou par WhatsApp au +221772177176."
          ]
        },
        {
          title: "9. Cookies, analytics et publicite",
          paragraphs: [
            "Le site peut utiliser des technologies de mesure ou de publicite comme Google, Meta ou TikTok lorsque les identifiants correspondants sont configures.",
            "Ces outils servent a mesurer les visites, les conversions et l'efficacite des campagnes. Le client peut limiter certains suivis depuis les reglages de son navigateur."
          ]
        }
      ]
    },
    {
      slug: "livraison-retours",
      path: "/livraison-retours",
      title: "Livraison, retours et garantie",
      eyebrow: "Service client",
      description: "Informations sur les zones de livraison, frais, retours et garantie chez DieguemTech Store.",
      intro: "Cette page detaille les frais de livraison, la confirmation des commandes, les retours et la prise en charge en cas de probleme produit.",
      sections: [
        {
          title: "1. Zones et frais de livraison",
          paragraphs: [
            "DieguemTech Store livre a Dakar et dans plusieurs zones du Senegal apres confirmation de la commande.",
            "Frais indicatifs : Dakar 1 500 FCFA, Pikine 2 000 FCFA, Guediawaye 2 000 FCFA, Rufisque 2 500 FCFA, Thies 4 000 FCFA, Mbour 4 000 FCFA, autre zone Senegal 5 000 FCFA."
          ]
        },
        {
          title: "2. Delais",
          paragraphs: [
            "Les delais dependent du stock, de la zone, du jour de commande et de la disponibilite du client.",
            "L'equipe peut contacter le client par telephone ou WhatsApp pour confirmer le stock, le paiement et le point de livraison."
          ]
        },
        {
          title: "3. Reception du produit",
          paragraphs: [
            "Le client doit verifier le produit a la reception lorsque cela est possible : etat general, accessoires, couleur, modele et fonctionnement apparent.",
            "Toute anomalie doit etre signalee rapidement avec le numero de commande et, si possible, des photos ou videos."
          ]
        },
        {
          title: "4. Retours",
          paragraphs: [
            "Un retour peut etre etudie si le produit recu presente un probleme signale rapidement, si le produit est incomplet ou si une erreur de reference est constatee.",
            "Le produit doit etre retourne dans le meilleur etat possible avec ses accessoires, emballages et preuves d'achat disponibles."
          ]
        },
        {
          title: "5. Cas non couverts",
          paragraphs: [
            "La garantie ou le retour peut etre refuse en cas de casse, choc, humidite, mauvaise installation, mauvaise utilisation, modification non autorisee, accessoires manquants ou degradation visible apres livraison.",
            "Les produits consommables, ecouteurs, accessoires d'hygiene ou produits fortement manipules peuvent etre soumis a des conditions particulieres."
          ]
        },
        {
          title: "6. Support",
          paragraphs: [
            "Pour toute demande, contactez le support au +221772177176 avec le numero de commande, le nom du produit et une description claire du probleme."
          ]
        }
      ]
    },
    {
      slug: "mentions-legales",
      path: "/mentions-legales",
      title: "Mentions legales",
      eyebrow: "Informations officielles",
      description: "Mentions legales de DieguemTech Store : editeur, contact, hebergement, propriete intellectuelle et responsabilite.",
      intro: "Cette page rassemble les informations legales et pratiques relatives au site DieguemTech Store.",
      sections: [
        {
          title: "1. Editeur du site",
          paragraphs: [
            "Le site DieguemTech Store est edite par DieguemTech Store, boutique basee a Dakar, Senegal.",
            "Contact principal : contact@dieguemtech.com. Support WhatsApp : +221772177176.",
            "Les informations administratives complementaires comme RCCM, NINEA ou adresse complete pourront etre ajoutees lorsque les donnees definitives seront disponibles."
          ]
        },
        {
          title: "2. Responsable de publication",
          paragraphs: [
            "Le responsable de publication est DieguemTech Store. Pour toute demande concernant le contenu du site, utilisez l'adresse contact@dieguemtech.com."
          ]
        },
        {
          title: "3. Hebergement",
          paragraphs: [
            "Le site est heberge par Render. Le domaine dieguemtechstore.com est gere via LWS.",
            "Les services techniques associes peuvent inclure PostgreSQL, Resend pour les emails, PayDunya pour les paiements et des outils analytics/publicitaires selon configuration."
          ]
        },
        {
          title: "4. Propriete intellectuelle",
          paragraphs: [
            "Les textes, elements graphiques, logos, structures de pages et contenus de DieguemTech Store sont proteges. Toute reproduction non autorisee est interdite.",
            "Les marques, logos ou images de produits tiers restent la propriete de leurs titulaires respectifs."
          ]
        },
        {
          title: "5. Responsabilite",
          paragraphs: [
            "DieguemTech Store s'efforce de fournir des informations fiables et a jour. Des erreurs, ruptures de stock ou variations de caracteristiques peuvent toutefois survenir.",
            "En cas de doute sur un produit, le client est invite a contacter le support avant achat."
          ]
        },
        {
          title: "6. Contact",
          paragraphs: [
            "Email : contact@dieguemtech.com.",
            "WhatsApp : +221772177176.",
            "Zone principale de service : Dakar et Senegal selon confirmation."
          ]
        }
      ]
    }
  ];
}

function getLegalPage(slug) {
  return getLegalPages().find(page => page.slug === slug) || null;
}

function renderLegalPage(page, baseUrl) {
  const canonicalUrl = `${baseUrl}${page.path}`;
  const relatedPages = getLegalPages();
  const organization = getLocalBusinessStructuredData(baseUrl);
  if (page.slug === "livraison-retours") {
    organization.hasMerchantReturnPolicy = {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "SN",
      returnPolicyCountry: "SN",
      merchantReturnLink: canonicalUrl
    };
  }
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Accueil", item: `${baseUrl}/` },
          { "@type": "ListItem", position: 2, name: page.title, item: canonicalUrl }
        ]
      },
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        name: page.title,
        description: page.description,
        url: canonicalUrl,
        isPartOf: {
          "@type": "WebSite",
          name: "DieguemTech Store",
          url: `${baseUrl}/`
        },
        publisher: {
          "@id": `${baseUrl}/#store`
        },
        dateModified: seoContentLastModified,
        inLanguage: "fr-SN"
      }
    ]
  };

  return `<!doctype html>
<html lang="fr-SN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow">
  <meta name="description" content="${escapeHtml(page.description)}">
${renderLocalSeoMeta({ canonicalUrl })}
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="fr_SN">
  <meta property="og:site_name" content="DieguemTech Store">
  <meta property="og:title" content="${escapeHtml(page.title)} | DieguemTech Store">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(`${baseUrl}/assets/hero-tech.png`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#f68b1e">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="shortcut icon" href="/assets/favicon.svg">
  <title>${escapeHtml(page.title)} | DieguemTech Store</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css?v=20260718-mobile-polish">
  <style>
    body{background:#f7f7f7}
    .legal-page{width:min(1120px,calc(100% - 34px));margin:0 auto;padding:28px 0 72px}
    .legal-top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}
    .legal-logo img{display:block;width:210px;height:auto}
    .legal-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .legal-actions a{display:inline-flex;align-items:center;justify-content:center;border:1px solid #e4e4e4;background:#fff;color:#313133;border-radius:9px;padding:11px 14px;font-weight:900;font-size:13px}
    .legal-actions a:hover{border-color:#f68b1e;color:#f68b1e}
    .legal-hero{border-radius:26px;background:radial-gradient(circle at 90% 20%,rgba(246,139,30,.26),transparent 28%),linear-gradient(135deg,#242426,#121213);color:#fff;padding:48px;box-shadow:0 18px 45px rgba(0,0,0,.13)}
    .legal-hero h1{font:800 clamp(34px,5vw,58px)/1.04 Manrope;margin:0 0 14px;letter-spacing:-1.8px}
    .legal-hero p{color:#d7d7d7;max-width:760px;margin:0;font-size:15px;line-height:1.75}
    .legal-updated{display:inline-flex;margin-top:22px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900}
    .legal-layout{display:grid;grid-template-columns:1fr 300px;gap:22px;align-items:start;margin-top:24px}
    .legal-content,.legal-side{background:#fff;border:1px solid #ededed;border-radius:22px;box-shadow:0 12px 34px rgba(0,0,0,.045)}
    .legal-content{padding:32px}
    .legal-section{padding:0 0 24px;margin:0 0 24px;border-bottom:1px solid #f0f0f0}
    .legal-section:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
    .legal-section h2{font:800 23px Manrope;margin:0 0 12px;color:#1c1c1e;letter-spacing:-.5px}
    .legal-section p{color:#606060;font-size:14px;line-height:1.8;margin:0 0 12px}
    .legal-side{padding:20px;position:sticky;top:18px}
    .legal-side h2{font:800 16px Manrope;margin:0 0 12px;color:#1c1c1e}
    .legal-side nav{display:grid;gap:9px}
    .legal-side a{border:1px solid #f0f0f0;border-radius:12px;padding:11px 12px;color:#666;font-weight:800;font-size:12px;background:#fff}
    .legal-side a.active,.legal-side a:hover{border-color:rgba(246,139,30,.28);background:#fff8f0;color:#f68b1e}
    .legal-contact{margin-top:16px;background:#fff8f0;border:1px solid rgba(246,139,30,.24);border-radius:14px;padding:14px}
    .legal-contact strong{display:block;color:#1c1c1e;font-size:13px;margin-bottom:6px}
    .legal-contact p{font-size:12px;color:#666;line-height:1.6;margin:0 0 10px}
    .legal-contact a{display:inline-flex;background:#f68b1e;color:#fff;border-radius:9px;padding:10px 12px;font-size:12px;font-weight:900}
    .legal-note{margin-top:18px;color:#888;font-size:12px;line-height:1.65}
    @media(max-width:860px){.legal-layout{grid-template-columns:1fr}.legal-side{position:static}.legal-hero{padding:34px 24px}.legal-content{padding:24px}.legal-top{align-items:flex-start;flex-direction:column}.legal-logo img{width:185px}}
  </style>
  <script type="application/ld+json">${toJsonLdScript(structuredData)}</script>
</head>
<body>
  ${renderFloatingSupportMessage()}
  ${renderStandaloneMobileNav()}
  <main class="legal-page">
    <nav class="legal-top" aria-label="Navigation">
      <a class="legal-logo" href="/" aria-label="DieguemTech Store - Accueil"><img src="/assets/logo.svg" alt="DieguemTech Store" width="220" height="56"></a>
      <div class="legal-actions">
        <a href="/">Retour a l'accueil</a>
        <a href="/#boutique">Voir la boutique</a>
      </div>
    </nav>
    <section class="legal-hero">
      <span class="eyebrow light">${escapeHtml(page.eyebrow)}</span>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.intro)}</p>
      <span class="legal-updated">Derniere mise a jour : 17 juillet 2026</span>
    </section>
    <div class="legal-layout">
      <article class="legal-content">
        ${page.sections.map(renderLegalSection).join("")}
        <p class="legal-note">Ce document est une base d'information commerciale. Il peut etre ajuste en fonction de l'evolution de l'activite, des partenaires et des obligations legales applicables.</p>
      </article>
      <aside class="legal-side" aria-label="Pages legales">
        <h2>Pages utiles</h2>
        <nav>
          ${relatedPages.map(item => `<a class="${item.slug === page.slug ? "active" : ""}" href="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a>`).join("")}
        </nav>
        <div class="legal-contact">
          <strong>Besoin d'une precision ?</strong>
          <p>Contactez le support avec votre question ou votre numero de commande.</p>
          <a href="https://wa.me/221772177176?text=Bonjour%20DieguemTech%20Store,%20j'ai%20une%20question%20sur%20les%20conditions." target="_blank" rel="noopener">WhatsApp support</a>
        </div>
      </aside>
    </div>
  </main>
  ${renderFloatingSupportScript()}
</body>
</html>`;
}

function renderLegalSection(section) {
  return `<section class="legal-section">
    <h2>${escapeHtml(section.title)}</h2>
    ${section.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}
  </section>`;
}

function renderStandaloneMobileNav(activeItem = "") {
  const itemClass = item => `standalone-nav-item${activeItem === item ? " active" : ""}`;
  return `<nav class="standalone-mobile-nav" aria-label="Navigation mobile principale">
    <a class="${itemClass("home")}" href="/" aria-label="Accueil">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"></path><path d="M5.5 10.5V20h13v-9.5"></path><path d="M9.5 20v-6h5v6"></path></svg>
      <span>Accueil</span>
    </a>
    <a class="${itemClass("categories")}" href="/#categories" aria-label="Catégories">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="4" width="6" height="6" rx="1"></rect><rect x="4" y="14" width="6" height="6" rx="1"></rect><rect x="14" y="14" width="6" height="6" rx="1"></rect></svg>
      <span>Catégories</span>
    </a>
    <a class="${itemClass("boutique")} standalone-nav-primary" href="/#boutique" aria-label="Boutique">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
      <span>Boutique</span>
    </a>
    <a class="${itemClass("help")}" href="https://wa.me/221772177176?text=Bonjour%20DieguemTech%20Store,%20j'ai%20besoin%20d'aide." target="_blank" rel="noopener" aria-label="Aide WhatsApp">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z"></path><path d="M9 9.5a3 3 0 0 1 5.5 1.7c0 2-2.5 2-2.5 3.3"></path><path d="M12 17h.01"></path></svg>
      <span>Aide</span>
    </a>
    <a class="${itemClass("cart")}" href="/?cart=open#boutique" aria-label="Panier">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2 11h10l2-7H6"></path><circle cx="9" cy="19" r="1"></circle><circle cx="17" cy="19" r="1"></circle></svg>
      <span>Panier</span>
    </a>
  </nav>`;
}

function renderFloatingSupportMessage() {
  return `<a href="https://wa.me/221772177176?text=Bonjour%20DieguemTech%20Store,%20je%20souhaite%20obtenir%20plus%20d'informations."
   class="whatsapp-float"
   target="_blank"
   rel="noopener"
   aria-label="Contacter DieguemTech Store sur WhatsApp">
    💬
  </a>
  <div class="floating-message" id="floatingMessage" role="complementary" aria-label="Assistance DieguemTech Store" hidden>
    <button class="floating-message-close" id="floatingMessageClose" type="button" aria-label="Fermer le message">×</button>
    <span>Support rapide</span>
    <strong>Besoin d'aide pour choisir ?</strong>
    <p>Confirmez le stock, le prix et la livraison avec un conseiller.</p>
    <a href="https://wa.me/221772177176?text=Bonjour%20DieguemTech%20Store,%20je%20veux%20commander%20un%20produit." target="_blank" rel="noopener">Commander sur WhatsApp</a>
  </div>`;
}

function renderFloatingSupportScript() {
  return `<script>
    (function(){
      var message = document.getElementById("floatingMessage");
      var closeButton = document.getElementById("floatingMessageClose");
      if (!message || !closeButton) return;
      if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) return;
      var storageKey = "dt-floating-message-closed-until";
      var closedUntil = Number(localStorage.getItem(storageKey) || 0);
      if (Number.isFinite(closedUntil) && closedUntil > Date.now()) return;
      message.hidden = false;
      requestAnimationFrame(function(){ message.classList.add("active"); });
      closeButton.addEventListener("click", function(){
        message.classList.remove("active");
        localStorage.setItem(storageKey, String(Date.now() + 24 * 60 * 60 * 1000));
        setTimeout(function(){ message.hidden = true; }, 300);
      });
    })();
  </script>`;
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
  const productBrand = getProductBrandName(product);
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
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        name: title,
        description,
        url: canonicalUrl,
        isPartOf: {
          "@type": "WebSite",
          "@id": `${baseUrl}/#website`,
          name: "DieguemTech Store",
          url: `${baseUrl}/`
        },
        about: {
          "@id": `${canonicalUrl}#product`
        },
        primaryImageOfPage: mainImage,
        inLanguage: "fr-SN"
      },
      {
        "@type": "Product",
        "@id": `${canonicalUrl}#product`,
        name: product.name,
        description: schemaDescription,
        image: images.length ? images : [mainImage],
        sku: `DT-${product.id}`,
        category: product.category,
        ...(productBrand ? {
          brand: {
            "@type": "Brand",
            name: productBrand
          }
        } : {}),
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
  <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta name="description" content="${escapeHtml(description)}">
${renderLocalSeoMeta({ canonicalUrl })}
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
  <meta name="twitter:image:alt" content="${escapeHtml(product.name)}">
  <meta name="theme-color" content="#f68b1e">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="shortcut icon" href="/assets/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/logo-mark.svg">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css?v=20260718-mobile-polish">
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
    .seo-cart-toast{align-items:flex-start;max-width:470px;padding:18px 20px;gap:15px}
    .seo-cart-toast p{min-width:0;flex:1}
    .seo-cart-toast strong{font-size:13px}
    .seo-cart-toast small{font-size:11px;line-height:1.45}
    .seo-cart-toast .toast-actions{display:flex;gap:10px;margin-left:4px}
    .seo-cart-toast .toast-actions button{border:0;border-radius:9px;background:#f68b1e;color:#fff;font-weight:800;font-size:12px;padding:11px 14px;white-space:nowrap}
    .seo-cart-toast .toast-actions button.ghost{background:#3a3a3d}
    @media(max-width:900px){.seo-service-grid,.seo-related-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:760px){.seo-product-page{width:min(100% - 20px,1120px);padding:16px 0 32px}.seo-card{grid-template-columns:1fr;padding:14px;border-radius:18px;gap:20px}.seo-gallery{min-height:250px;position:relative;top:auto;padding:16px;border-radius:16px}.seo-gallery-main{min-height:190px}.seo-gallery-main img{max-height:205px}.seo-thumb{width:52px;height:52px}.seo-top{align-items:flex-start;flex-direction:column;gap:12px;margin-bottom:16px}.seo-logo img{width:168px}.seo-nav-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.seo-nav-actions a,.seo-back-button{display:flex;align-items:center;justify-content:center;min-height:44px;text-align:center}.seo-info h1{font-size:30px;letter-spacing:-1px}.seo-price{margin:18px 0}.seo-price strong{font-size:25px}.seo-description-card,.seo-help,.seo-related{margin-top:18px;padding:16px}.seo-actions{display:grid;grid-template-columns:1fr;margin-top:18px}.seo-actions .button{width:100%;min-width:0;min-height:50px}.seo-service-grid{grid-template-columns:1fr;gap:10px}.seo-help{align-items:flex-start;flex-direction:column}.seo-help .button{width:100%;min-height:48px}.seo-related-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.seo-related-visual{height:120px;padding:10px}.seo-related-visual img{max-height:98px}.seo-related-body{padding:11px}.seo-related-body h3{font-size:12px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:34px}.seo-cart-toast{left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom));max-width:none}}
    @media(max-width:520px){.seo-card{padding:12px}.seo-info h1{font-size:27px}.seo-badges{margin:12px 0 15px}.seo-meta{padding:13px;font-size:12px}.seo-cart-toast{display:grid;grid-template-columns:27px 1fr;align-items:start}.seo-cart-toast .toast-actions{grid-column:1/-1;margin-left:0;width:100%;display:grid;grid-template-columns:1fr 1fr}.seo-cart-toast .toast-actions button{width:100%}}
  </style>
  <script type="application/ld+json">${toJsonLdScript(structuredData)}</script>
</head>
<body>
  ${renderFloatingSupportMessage()}
  ${renderStandaloneMobileNav("boutique")}
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
          <img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}" fetchpriority="high" decoding="async" data-main-image>
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
          <button class="button primary" type="button" data-seo-cart-product="${Number(product.id)}" data-product-name="${escapeHtml(product.name)}">Ajouter ce produit au panier</button>
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
  <div class="toast cart-choice-toast seo-cart-toast" id="seoCartToast" aria-live="polite">
    <span>✓</span>
    <p><strong>Produit ajoute</strong><small>Voulez-vous aller au panier ou continuer vos achats ?</small></p>
    <div class="toast-actions">
      <button type="button" id="seoCartOpen">Voir le panier</button>
      <button type="button" class="ghost" id="seoCartContinue">Continuer</button>
    </div>
  </div>
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
      var cartButton = document.querySelector("[data-seo-cart-product]");
      var cartToast = document.getElementById("seoCartToast");
      function hideCartChoice(){
        if (!cartToast) return;
        cartToast.classList.remove("active");
        clearTimeout(hideCartChoice.timer);
      }
      function showCartChoice(name){
        if (!cartToast) return;
        cartToast.querySelector("strong").textContent = "Produit ajoute";
        cartToast.querySelector("small").textContent = name + " est dans votre panier. Que voulez-vous faire ?";
        cartToast.classList.add("active");
        clearTimeout(hideCartChoice.timer);
      }
      if (cartButton) {
        cartButton.addEventListener("click", function(){
          var id = Number(cartButton.getAttribute("data-seo-cart-product"));
          var name = cartButton.getAttribute("data-product-name") || "Ce produit";
          var cart = [];
          try { cart = JSON.parse(localStorage.getItem("dt-cart") || "[]"); } catch (error) { cart = []; }
          var item = cart.find(function(entry){ return Number(entry.id) === id; });
          if (item) item.qty = Number(item.qty || 0) + 1;
          else cart.push({ id: id, qty: 1 });
          localStorage.setItem("dt-cart", JSON.stringify(cart));
          showCartChoice(name);
        });
      }
      var openCartButton = document.getElementById("seoCartOpen");
      if (openCartButton) {
        openCartButton.addEventListener("click", function(){
          hideCartChoice();
          window.location.href = "/?cart=open#boutique";
        });
      }
      var continueButton = document.getElementById("seoCartContinue");
      if (continueButton) {
        continueButton.addEventListener("click", hideCartChoice);
      }
    })();
  </script>
  ${renderFloatingSupportScript()}
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
    const categoryTitle = getCategoryDisplayName(category);
    return [
      {
        path: categoryPath(category),
        priority: "0.9",
        title: `${categoryTitle} - DieguemTech Store`,
        image: getProductImages(categoryProducts[0] || {})[0]
      },
      ...visibleSubcategories.map(subcategory => ({
        path: subcategoryPath(category, subcategory.name),
        priority: "0.85",
        title: `${subcategory.name} - ${categoryTitle}`,
        image: getProductImages(subcategory.products[0] || {})[0]
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

function getProductBrandName(product) {
  const explicitBrand = String(product.brand || "").trim();
  if (explicitBrand) return explicitBrand;

  const knownBrands = [
    "Samsung",
    "Xiaomi",
    "Oraimo",
    "Sony",
    "Hisense",
    "HP",
    "TP-Link",
    "SanDisk",
    "Tefal",
    "Binatone",
    "Bruhm",
    "Canleen",
    "Deska",
    "Galuin",
    "Gueeton",
    "Lasa",
    "Nexon",
    "Qsonic",
    "Roch"
  ];
  const normalizedName = ` ${normalizeSearchText(product.name)} `;
  return knownBrands.find(brand => normalizedName.includes(` ${normalizeSearchText(brand)} `)) || "";
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

function getSkippedStatusNotifications(reason = "skipped") {
  return {
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

async function notifyOrderStatusIfNeeded(order, request, previousOrder = null) {
  const config = getOrderStatusNotificationConfig(order?.orderStatus);
  if (!order || !config) {
    return getSkippedStatusNotifications("status_not_notifiable");
  }
  if (previousOrder?.orderStatus === order.orderStatus) {
    return getSkippedStatusNotifications("status_unchanged");
  }

  const fullOrder = await database.getOrder(order.id) || order;
  if (fullOrder[config.sentAtKey]) {
    return getSkippedStatusNotifications("already_sent");
  }

  const notifications = await sendOrderStatusEmail(fullOrder, request, config);
  const hasFailure = Object.values(notifications)
    .some(status => String(status || "").startsWith("failed"));
  if (!hasFailure && notifications.customerEmail === "sent") {
    await database.markOrderStatusNotificationSent(fullOrder.id, config.status);
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

async function sendOrderStatusEmail(order, request, config) {
  const notifications = {
    customerEmail: "skipped"
  };

  const result = await runNotification("customerEmail", async () => {
    const customerEmail = getOrderCustomerEmail(order);
    if (!customerEmail) return "skipped";
    return sendOrderEmail({
      to: customerEmail,
      subject: `${config.subject} - commande ${order.id} - DieguemTech Store`,
      text: buildOrderStatusEmailText(order, request, config),
      html: buildOrderStatusEmailHtml(order, request, config)
    });
  });
  notifications[result.name] = result.status;
  return notifications;
}

function getOrderStatusNotificationConfig(status) {
  const configs = {
    preparing: {
      status: "preparing",
      sentAtKey: "preparingNotificationSentAt",
      subject: "Commande validee",
      title: "Votre commande est validee",
      badge: "Preparation",
      intro: "Votre commande a ete validee par notre equipe. Nous preparons vos produits et organisons la livraison.",
      nextStep: "Restez joignable : un conseiller peut vous contacter pour confirmer le point de livraison ou une precision sur le produit."
    },
    shipped: {
      status: "shipped",
      sentAtKey: "shippedNotificationSentAt",
      subject: "Commande en cours de livraison",
      title: "Votre commande est en cours de livraison",
      badge: "Livraison",
      intro: "Bonne nouvelle : votre commande est en cours de livraison.",
      nextStep: "Gardez votre telephone disponible afin de faciliter la remise du colis."
    }
  };
  return configs[status] || null;
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

function buildOrderStatusEmailText(order, request, config) {
  return [
    `Bonjour ${getOrderCustomerName(order)},`,
    config.intro,
    `Commande: ${order.id}.`,
    `Statut: ${config.badge}.`,
    `Paiement: ${formatPaymentProviderLabel(order.paymentProvider)} - ${formatPaymentStatusLabel(order.paymentStatus)}.`,
    `Livraison ${getOrderDeliveryZone(order)}: ${formatSeoPrice(getOrderDeliveryFee(order))}.`,
    `Total: ${formatSeoPrice(order.total)}.`,
    config.nextStep,
    `Suivi: ${getPublicBaseUrl(request)}/#suivi`
  ].filter(Boolean).join("\n");
}

function buildOrderStatusEmailHtml(order, request, config) {
  const items = getOrderItems(order)
    .map(item => `<tr><td>${escapeHtml(item.name)}</td><td style="text-align:center">${Number(item.quantity)}</td><td style="text-align:right">${escapeHtml(formatSeoPrice(item.lineTotal))}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="fr">
<body style="margin:0;background:#f6f6f6;font-family:Arial,sans-serif;color:#313133">
  <main style="max-width:680px;margin:0 auto;padding:24px">
    <section style="background:#fff;border-radius:18px;padding:26px;border:1px solid #ececec">
      <p style="margin:0 0 8px;color:#f68b1e;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px">DieguemTech Store</p>
      <h1 style="margin:0 0 10px;font-size:26px;color:#1c1c1e">${escapeHtml(config.title)}</h1>
      <p style="margin:0 0 22px;color:#666;line-height:1.6">${escapeHtml(config.intro)}</p>
      <div style="background:#fff8f0;border:1px dashed rgba(246,139,30,.35);border-radius:14px;padding:16px;margin-bottom:18px">
        <span style="display:block;color:#777;font-size:12px;text-transform:uppercase;font-weight:800">Numero de commande</span>
        <strong style="font-size:24px;color:#f68b1e">${escapeHtml(order.id)}</strong>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px">
        <tr><td style="padding:8px 0;color:#777">Statut</td><td style="padding:8px 0;text-align:right;color:#f68b1e;font-weight:800">${escapeHtml(config.badge)}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Client</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(getOrderCustomerName(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Telephone</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderCustomerPhone(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Zone livraison</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderDeliveryZone(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Adresse</td><td style="padding:8px 0;text-align:right">${escapeHtml(getOrderAddress(order))}</td></tr>
        <tr><td style="padding:8px 0;color:#777">Paiement</td><td style="padding:8px 0;text-align:right">${escapeHtml(formatPaymentProviderLabel(order.paymentProvider))} - ${escapeHtml(formatPaymentStatusLabel(order.paymentStatus))}</td></tr>
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
      <p style="margin:20px 0 0;background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px;color:#666;line-height:1.6">${escapeHtml(config.nextStep)}</p>
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

function formatPaymentStatusLabel(status) {
  const value = String(status || "").trim();
  return {
    pending: "En attente",
    paid: "Paye",
    failed: "Echoue",
    refunded: "Rembourse"
  }[value] || value || "A confirmer";
}

function usesWavePaymentLink(order) {
  const provider = String(order.paymentProvider || "").trim();
  return provider === waveProvider;
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
    attribution: normalizeOrderAttribution(orderInput.attribution),
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
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="referrer" content="no-referrer">
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
