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
app.set("trust proxy", 1);
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

app.get("/api/admin/orders", requireAdmin, async (request, response, next) => {
  try {
    response.json(await database.getOrders());
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
    const order = await database.updateOrderStatus(request.params.id, { orderStatus, paymentStatus });
    if (!order) return response.status(404).json({ error: "Commande introuvable." });
    response.json(order);
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

app.get("/site.webmanifest", (request, response) => {
  response.type("application/manifest+json").sendFile(path.join(__dirname, "site.webmanifest"));
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

function validateProductUpdate(product) {
  if (!product.name?.trim()) return "Le nom du produit est requis.";
  if (!product.category?.trim()) return "La categorie est requise.";
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

function renderSitemap(baseUrl, products) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    {
      loc: `${baseUrl}/`,
      changefreq: "daily",
      priority: "1.0"
    },
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

function renderProductSeoPage(product, baseUrl, relatedProducts = []) {
  const canonicalPath = productPath(product);
  const canonicalUrl = `${baseUrl}${canonicalPath}`;
  const images = getProductImages(product).map(image => absoluteUrl(image, baseUrl));
  const mainImage = images[0] || `${baseUrl}/assets/hero-tech.png`;
  const fullDescription = getProductDescription(product);
  const description = truncateText(fullDescription, 155);
  const schemaDescription = truncateText(fullDescription, 500);
  const title = `${product.name} | DieguemTech Store`;
  const availability = Number(product.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";
  const isLongDescription = fullDescription.replace(/\s+/g, " ").trim().length > 330;
  const stockLabel = Number(product.stock) > 0 ? "En stock" : "Rupture temporaire";
  const discountLabel = getSeoDiscountLabel(product);
  const highlights = getSeoProductHighlights(product);
  const visibleRelatedProducts = relatedProducts
    .filter(entry => Number(entry.id) !== Number(product.id))
    .slice(0, 4);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
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
            item: `${baseUrl}/#boutique`
          },
          {
            "@type": "ListItem",
            position: 3,
            name: product.name,
            item: canonicalUrl
          }
        ]
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
          seller: {
            "@type": "Organization",
            name: "DieguemTech Store",
            url: `${baseUrl}/`,
            logo: `${baseUrl}/assets/logo-mark.svg`
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
  <link rel="manifest" href="/site.webmanifest">
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
      <a href="/">Accueil</a> / <a href="/#boutique">Boutique</a> / <span>${escapeHtml(product.category)}</span>
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
          <span>Livraison : Dakar et autres zones selon confirmation</span>
          <span>Paiement : PayDunya / PayTech selon disponibilite</span>
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
        <article><b>Paiement securise</b><p>Paiement mobile et solutions locales selon la disponibilite des services actives.</p></article>
        <article><b>Livraison rapide</b><p>Organisation de la livraison a Dakar et dans les autres zones apres confirmation.</p></article>
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

function renderSeoNotFoundPage(baseUrl) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><title>Produit introuvable - DieguemTech Store</title></head>
<body><main style="font-family:Arial,sans-serif;max-width:620px;margin:80px auto;padding:24px"><h1>Produit introuvable</h1><p>Ce produit n'est plus disponible ou a ete desactive.</p><a href="${escapeHtml(baseUrl)}/">Retour a la boutique</a></main></body></html>`;
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
    "Conseil disponible pour choisir le bon modele selon votre besoin."
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
    const redirectUrl = getPayTechRedirectUrl(data);
    if (!redirectUrl) {
      const error = new Error(`PayTech n'a pas renvoye de lien de paiement. Reponse: ${JSON.stringify(data).slice(0, 250)}`);
      error.status = 502;
      throw error;
    }
    return { redirectUrl };
  } catch (error) {
    if (error.status && !error.isAxiosError) throw error;
    const details = getPayTechErrorDetails(error);
    const paymentError = new Error(`PayTech a refuse la demande de paiement.${details ? ` Detail: ${details}` : ""}`);
    paymentError.status = 502;
    paymentError.cause = error;
    throw paymentError;
  }
}

function getPayTechRedirectUrl(data) {
  const directKeys = [
    "redirect_url",
    "redirectUrl",
    "payment_url",
    "paymentUrl",
    "url",
    "link"
  ];
  for (const key of directKeys) {
    if (typeof data?.[key] === "string" && /^https?:\/\//.test(data[key])) {
      return data[key];
    }
  }
  const nested = findUrlInObject(data);
  if (nested) return nested;
  if (typeof data?.token === "string" && data.token.trim()) {
    return `https://paytech.sn/payment/checkout/${encodeURIComponent(data.token.trim())}`;
  }
  return null;
}

function findUrlInObject(value) {
  if (!value || typeof value !== "object") return null;
  for (const item of Object.values(value)) {
    if (typeof item === "string" && /^https?:\/\/.+paytech/i.test(item)) return item;
    if (item && typeof item === "object") {
      const nested = findUrlInObject(item);
      if (nested) return nested;
    }
  }
  return null;
}

function getPayTechErrorDetails(error) {
  const data = error.response?.data;
  if (!data) return error.message;
  if (typeof data === "string") return data.slice(0, 250);
  const candidates = [
    data.message,
    data.error,
    data.errors,
    data.detail,
    data.response_text
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
