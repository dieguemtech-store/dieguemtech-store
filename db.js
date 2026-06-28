const { Pool } = require("pg");
const fs = require("node:fs/promises");
const path = require("node:path");
const seedProducts = require("./data/products");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
    })
  : null;
const localUploads = new Map();
const legacyStarterProductIds = Array.from({ length: 14 }, (_, index) => index + 1);
const localAnalyticsFile = path.join(__dirname, "data", "analytics.json");

async function initializeDatabase() {
  if (!pool) {
    console.warn("DATABASE_URL absente : utilisation du catalogue local.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      old_price INTEGER CHECK (old_price >= 0),
      emoji TEXT NOT NULL,
      rating NUMERIC(2,1) NOT NULL DEFAULT 0,
      reviews INTEGER NOT NULL DEFAULT 0,
      badge TEXT NOT NULL DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      subcategory TEXT NOT NULL DEFAULT '',
      image TEXT,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      description TEXT,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      delivery_zone TEXT,
      delivery_address TEXT NOT NULL,
      subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
      delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
      total INTEGER NOT NULL CHECK (total >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'XOF',
      payment_provider TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      order_status TEXT NOT NULL DEFAULT 'pending',
      attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
      paid_notification_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      line_total INTEGER NOT NULL CHECK (line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS product_uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size > 0),
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGSERIAL PRIMARY KEY,
      event_name TEXT NOT NULL,
      path TEXT,
      product_id INTEGER,
      product_name TEXT,
      category TEXT,
      value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      session_id TEXT,
      referrer TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_product_uploads_created_at ON product_uploads(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_product_id ON analytics_events(product_id);
  `);

  await pool.query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_email TEXT,
      ADD COLUMN IF NOT EXISTS delivery_zone TEXT,
      ADD COLUMN IF NOT EXISTS subtotal INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS delivery_fee INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS paid_notification_sent_at TIMESTAMPTZ;

    UPDATE orders
    SET subtotal = total
    WHERE subtotal = 0;

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS subcategory TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS image TEXT,
      ADD COLUMN IF NOT EXISTS images JSONB,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

    UPDATE products
    SET images = '[]'::jsonb
    WHERE images IS NULL;

    ALTER TABLE products
      ALTER COLUMN images SET DEFAULT '[]'::jsonb,
      ALTER COLUMN images SET NOT NULL;

    UPDATE products
    SET images = jsonb_build_array(image)
    WHERE image IS NOT NULL
      AND image <> ''
      AND images = '[]'::jsonb;
  `);

  const values = [];
  const placeholders = seedProducts.map((product, index) => {
    const offset = index * 15;
    values.push(
      product.id,
      product.name,
      product.category,
      product.subcategory || "",
      product.price,
      product.oldPrice ?? null,
      product.emoji,
      product.rating,
      product.reviews,
      product.badge,
      product.stock,
      product.image || null,
      JSON.stringify(normalizeImageList(product.images, product.image)),
      product.description || null,
      product.featured === true
    );
    const row = Array.from({ length: 15 }, (_, item) => {
      const placeholder = `$${offset + item + 1}`;
      return item === 12 ? `${placeholder}::jsonb` : placeholder;
    });
    return `(${row.join(",")})`;
  });

  await pool.query(`
    INSERT INTO products (
      id, name, category, subcategory, price, old_price, emoji, rating, reviews, badge, stock, image, images, description, featured
    ) VALUES ${placeholders.join(",")}
    ON CONFLICT (id) DO NOTHING
  `, values);

  await removeLegacyStarterProducts();
}

async function removeLegacyStarterProducts() {
  await pool.query(`
    DELETE FROM products p
    WHERE p.id = ANY($1::int[])
      AND NOT EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.product_id = p.id
      )
  `, [legacyStarterProductIds]);

  await pool.query(`
    UPDATE products
    SET active = FALSE, updated_at = NOW()
    WHERE id = ANY($1::int[])
      AND active = TRUE
  `, [legacyStarterProductIds]);
}

async function getProducts({ category = "", search = "" } = {}) {
  if (!pool) {
    return normalizeProductRows(seedProducts.filter(product => {
      const matchesCategory = !category || product.category.toLowerCase() === category.toLowerCase();
      const matchesSearch = !search || `${product.name} ${product.category} ${product.subcategory || ""} ${product.badge || ""} ${product.description || ""}`.toLowerCase().includes(search.toLowerCase());
      return product.active !== false && matchesCategory && matchesSearch;
    })).sort(sortProductsForDisplay);
  }

  const values = [];
  const conditions = ["active = TRUE"];
  if (category) {
    values.push(category);
    conditions.push(`LOWER(category) = LOWER($${values.length})`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(name ILIKE $${values.length} OR category ILIKE $${values.length} OR subcategory ILIKE $${values.length} OR badge ILIKE $${values.length} OR description ILIKE $${values.length})`);
  }

  const result = await pool.query(`
    SELECT
      id, name, category, subcategory, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, images, description, featured
    FROM products
    WHERE ${conditions.join(" AND ")}
    ORDER BY featured DESC, id
  `, values);
  return normalizeProductRows(result.rows);
}

async function getProduct(id, client = pool) {
  if (!pool) return normalizeProductRow(seedProducts.find(product => product.id === Number(id) && product.active !== false));
  const result = await client.query(`
    SELECT
      id, name, category, subcategory, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, images, description, featured
    FROM products
    WHERE id = $1 AND active = TRUE
  `, [id]);
  return normalizeProductRow(result.rows[0]);
}

async function getAdminProducts() {
  if (!pool) return normalizeProductRows(seedProducts.map(product => ({ ...product, active: product.active !== false })));

  const result = await pool.query(`
    SELECT
      id, name, category, subcategory, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, images, description, featured, active
    FROM products
    WHERE id <> ALL($1::int[])
    ORDER BY active DESC, featured DESC, id
  `, [legacyStarterProductIds]);
  return normalizeProductRows(result.rows);
}

async function createProduct(input) {
  const product = normalizeProductInput(input);

  if (!pool) {
    const nextId = Math.max(0, ...seedProducts.map(entry => Number(entry.id) || 0)) + 1;
    const created = {
      id: nextId,
      ...product,
      emoji: "DT",
      rating: 0,
      reviews: 0
    };
    seedProducts.push(created);
    return created;
  }

  const result = await pool.query(`
    INSERT INTO products (
      id, name, category, subcategory, price, old_price, emoji, rating, reviews, badge, stock, image, images, description, featured, active
    )
    VALUES (
      (SELECT COALESCE(MAX(id), 0) + 1 FROM products),
      $1, $2, $3, $4, $5, $6, 0, 0, $7, $8, $9, $10::jsonb, $11, $12, $13
    )
    RETURNING
      id, name, category, subcategory, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, images, description, featured, active
  `, [
    product.name,
    product.category,
    product.subcategory,
    product.price,
    product.oldPrice,
    "DT",
    product.badge,
    product.stock,
    product.image,
    JSON.stringify(product.images),
    product.description,
    product.featured,
    product.active
  ]);
  return normalizeProductRow(result.rows[0]);
}

async function updateProduct(id, input) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) return null;

  if (!pool) {
    const product = seedProducts.find(entry => entry.id === productId);
    if (!product) return null;
    Object.assign(product, normalizeProductInput(input));
    return product;
  }

  const product = normalizeProductInput(input);
  const result = await pool.query(`
    UPDATE products
    SET
      name = $2,
      category = $3,
      subcategory = $4,
      price = $5,
      old_price = $6,
      badge = $7,
      stock = $8,
      image = $9,
      images = $10::jsonb,
      description = $11,
      featured = $12,
      active = $13,
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, name, category, subcategory, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, images, description, featured, active
  `, [
    productId,
    product.name,
    product.category,
    product.subcategory,
    product.price,
    product.oldPrice,
    product.badge,
    product.stock,
    product.image,
    JSON.stringify(product.images),
    product.description,
    product.featured,
    product.active
  ]);
  return normalizeProductRow(result.rows[0]) || null;
}

async function deactivateProduct(id) {
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId < 1) return null;

  if (!pool) {
    const product = seedProducts.find(entry => entry.id === productId);
    if (!product) return null;
    product.active = false;
    return { ...product, active: false };
  }

  const result = await pool.query(`
    UPDATE products
    SET active = FALSE, updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, name, category, subcategory, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, images, description, featured, active
  `, [productId]);
  return normalizeProductRow(result.rows[0]) || null;
}

async function createProductUpload(upload) {
  const record = {
    id: upload.id,
    filename: String(upload.filename || "image-produit").trim() || "image-produit",
    mimeType: upload.mimeType,
    size: Number(upload.size || 0),
    data: upload.data
  };

  if (!pool) {
    localUploads.set(record.id, { ...record, createdAt: new Date().toISOString() });
    return uploadPublicRecord(record);
  }

  const result = await pool.query(`
    INSERT INTO product_uploads (id, filename, mime_type, size, data)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, filename, mime_type AS "mimeType", size, created_at AS "createdAt"
  `, [
    record.id,
    record.filename,
    record.mimeType,
    record.size,
    record.data
  ]);

  return uploadPublicRecord(result.rows[0]);
}

async function getProductUpload(id) {
  const uploadId = String(id || "").trim();
  if (!uploadId) return null;

  if (!pool) return localUploads.get(uploadId) || null;

  const result = await pool.query(`
    SELECT id, filename, mime_type AS "mimeType", size, data, created_at AS "createdAt"
    FROM product_uploads
    WHERE id = $1
  `, [uploadId]);
  return result.rows[0] || null;
}

function uploadPublicRecord(upload) {
  return {
    id: upload.id,
    filename: upload.filename,
    mimeType: upload.mimeType,
    size: upload.size,
    url: `/api/uploads/${upload.id}`,
    createdAt: upload.createdAt
  };
}

function normalizeProductInput(input) {
  const images = normalizeImageList(input.images, input.image);
  return {
    name: String(input.name || "").trim(),
    category: String(input.category || "").trim(),
    subcategory: String(input.subcategory || "").trim(),
    price: Number(input.price),
    oldPrice: input.oldPrice === null || input.oldPrice === "" || typeof input.oldPrice === "undefined" ? null : Number(input.oldPrice),
    badge: String(input.badge || "").trim(),
    stock: Number(input.stock),
    image: images[0] || null,
    images,
    description: input.description ? String(input.description).trim() : null,
    featured: input.featured === true,
    active: input.active !== false
  };
}

function normalizeImageList(images, primaryImage = "") {
  const candidates = [];
  if (primaryImage) candidates.push(primaryImage);
  if (Array.isArray(images)) {
    candidates.push(...images);
  } else if (typeof images === "string") {
    candidates.push(...images.split(/[\n,]/));
  }
  const normalizedImages = [...new Set(
    candidates
      .map(normalizeProductImagePath)
      .filter(Boolean)
  )];
  return removeJumiaDuplicateVariants(normalizedImages).slice(0, 1);
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

function removeJumiaDuplicateVariants(images) {
  const seen = new Set();
  return images.filter(image => {
    const key = getJumiaVariantKey(image);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getJumiaVariantKey(image) {
  const value = String(image || "");
  if (!/^https?:\/\/sn\.jumia\.is\//i.test(value)) return "";
  return value.replace(/fit-in\/\d+x\d+/i, "fit-in/SIZE");
}

function normalizeProductRow(product) {
  if (!product) return product;
  const images = normalizeImageList(product.images, product.image);
  return {
    ...product,
    image: images[0] || product.image || null,
    images,
    subcategory: String(product.subcategory || "").trim(),
    featured: product.featured === true
  };
}

function normalizeProductRows(products) {
  return products.map(normalizeProductRow);
}

function sortProductsForDisplay(left, right) {
  return Number(right.featured === true) - Number(left.featured === true) || Number(left.id || 0) - Number(right.id || 0);
}

async function createOrder(orderInput) {
  if (!pool) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const normalizedItems = [];

    for (const item of orderInput.items) {
      const result = await client.query(`
        SELECT id, name, price, stock
        FROM products
        WHERE id = $1 AND active = TRUE
        FOR UPDATE
      `, [item.id]);
      const product = result.rows[0];
      if (!product) throw orderError(`Produit ${item.id} introuvable.`, 400);
      if (item.quantity > product.stock) {
        throw orderError(`Stock insuffisant pour ${product.name}.`, 409);
      }
      normalizedItems.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: product.price * item.quantity
      });
    }

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const deliveryFee = Number(orderInput.deliveryFee || 0);
    const total = subtotal + deliveryFee;
    await client.query(`
      INSERT INTO orders (
        id, customer_name, customer_phone, customer_email, delivery_zone, delivery_address, subtotal, delivery_fee, total,
        currency, payment_provider, payment_status, order_status, attribution
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    `, [
      orderInput.id,
      orderInput.customer.name,
      orderInput.customer.phone,
      orderInput.customer.email || null,
      orderInput.deliveryZone,
      orderInput.customer.address,
      subtotal,
      deliveryFee,
      total,
      "XOF",
      orderInput.paymentProvider,
      "pending",
      "pending",
      JSON.stringify(normalizeOrderAttribution(orderInput.attribution))
    ]);

    for (const item of normalizedItems) {
      await client.query(`
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price, quantity, line_total
        ) VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        orderInput.id,
        item.productId,
        item.name,
        item.unitPrice,
        item.quantity,
        item.lineTotal
      ]);
      await client.query(
        "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2",
        [item.quantity, item.productId]
      );
    }

    await client.query("COMMIT");
    return { ...orderInput, attribution: normalizeOrderAttribution(orderInput.attribution), items: normalizedItems, subtotal, deliveryFee, total, currency: "XOF" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getOrders() {
  if (!pool) return getLocalOrders();

  const result = await pool.query(`
    SELECT
      o.id,
      o.customer_name AS "customerName",
      o.customer_phone AS "customerPhone",
      o.customer_email AS "customerEmail",
      o.delivery_zone AS "deliveryZone",
      o.delivery_address AS "deliveryAddress",
      o.subtotal,
      o.delivery_fee AS "deliveryFee",
      o.total,
      o.currency,
      o.payment_provider AS "paymentProvider",
      o.payment_status AS "paymentStatus",
      o.order_status AS "orderStatus",
      o.attribution,
      o.paid_notification_sent_at AS "paidNotificationSentAt",
      o.created_at AS "createdAt",
      COALESCE(
        json_agg(
          json_build_object(
            'productId', oi.product_id,
            'name', oi.product_name,
            'unitPrice', oi.unit_price,
            'quantity', oi.quantity,
            'lineTotal', oi.line_total
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `);
  return result.rows;
}

async function getOrder(id) {
  if (!pool) {
    const orders = await getLocalOrders();
    return orders.find(order => order.id === id) || null;
  }

  const result = await pool.query(`
    SELECT
      o.id,
      o.customer_name AS "customerName",
      o.customer_phone AS "customerPhone",
      o.customer_email AS "customerEmail",
      o.delivery_zone AS "deliveryZone",
      o.delivery_address AS "deliveryAddress",
      o.subtotal,
      o.delivery_fee AS "deliveryFee",
      o.total,
      o.currency,
      o.payment_provider AS "paymentProvider",
      o.payment_status AS "paymentStatus",
      o.order_status AS "orderStatus",
      o.attribution,
      o.paid_notification_sent_at AS "paidNotificationSentAt",
      o.created_at AS "createdAt",
      COALESCE(
        json_agg(
          json_build_object(
            'productId', oi.product_id,
            'name', oi.product_name,
            'unitPrice', oi.unit_price,
            'quantity', oi.quantity,
            'lineTotal', oi.line_total
          )
          ORDER BY oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id
  `, [id]);
  return result.rows[0] || null;
}

async function updateOrderStatus(id, { orderStatus, paymentStatus }) {
  if (!pool) return updateLocalOrderStatus(id, { orderStatus, paymentStatus });

  const result = await pool.query(`
    UPDATE orders
    SET
      order_status = COALESCE($2, order_status),
      payment_status = COALESCE($3, payment_status)
    WHERE id = $1
    RETURNING
      id,
      customer_name AS "customerName",
      customer_phone AS "customerPhone",
      customer_email AS "customerEmail",
      delivery_zone AS "deliveryZone",
      delivery_address AS "deliveryAddress",
      subtotal,
      delivery_fee AS "deliveryFee",
      total,
      currency,
      payment_provider AS "paymentProvider",
      payment_status AS "paymentStatus",
      order_status AS "orderStatus",
      attribution,
      paid_notification_sent_at AS "paidNotificationSentAt",
      created_at AS "createdAt"
  `, [id, orderStatus || null, paymentStatus || null]);
  return result.rows[0] || null;
}

async function markPaidNotificationSent(id) {
  if (!pool) return markLocalPaidNotificationSent(id);

  const result = await pool.query(`
    UPDATE orders
    SET paid_notification_sent_at = COALESCE(paid_notification_sent_at, NOW())
    WHERE id = $1
    RETURNING
      id,
      paid_notification_sent_at AS "paidNotificationSentAt"
  `, [id]);
  return result.rows[0] || null;
}

async function getLocalOrders() {
  try {
    const orders = JSON.parse(await require("node:fs/promises").readFile(require("node:path").join(__dirname, "data", "orders.json"), "utf8"));
    return orders.slice().reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function updateLocalOrderStatus(id, { orderStatus, paymentStatus }) {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const file = path.join(__dirname, "data", "orders.json");
  const orders = await getLocalOrders();
  const normalized = orders.slice().reverse();
  const order = normalized.find(entry => entry.id === id);
  if (!order) return null;
  if (orderStatus) order.orderStatus = orderStatus;
  if (paymentStatus) order.paymentStatus = paymentStatus;
  await fs.writeFile(file, JSON.stringify(normalized, null, 2));
  return order;
}

async function markLocalPaidNotificationSent(id) {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const file = path.join(__dirname, "data", "orders.json");
  const orders = await getLocalOrders();
  const normalized = orders.slice().reverse();
  const order = normalized.find(entry => entry.id === id);
  if (!order) return null;
  order.paidNotificationSentAt = order.paidNotificationSentAt || new Date().toISOString();
  await fs.writeFile(file, JSON.stringify(normalized, null, 2));
  return order;
}

async function recordAnalyticsEvent(eventInput) {
  const event = normalizeAnalyticsEvent(eventInput);
  if (!event.eventName) return null;

  if (!pool) return recordLocalAnalyticsEvent(event);

  const result = await pool.query(`
    INSERT INTO analytics_events (
      event_name, path, product_id, product_name, category, value, metadata, session_id, referrer, user_agent
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
    RETURNING
      id,
      event_name AS "eventName",
      path,
      product_id AS "productId",
      product_name AS "productName",
      category,
      value,
      metadata,
      session_id AS "sessionId",
      referrer,
      user_agent AS "userAgent",
      created_at AS "createdAt"
  `, [
    event.eventName,
    event.path,
    event.productId,
    event.productName,
    event.category,
    event.value,
    JSON.stringify(event.metadata),
    event.sessionId,
    event.referrer,
    event.userAgent
  ]);
  return result.rows[0] || null;
}

async function getAnalyticsEvents(days = 30) {
  const safeDays = clampAnalyticsDays(days);
  if (!pool) {
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    return (await getLocalAnalyticsEvents())
      .filter(event => new Date(event.createdAt).getTime() >= cutoff)
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 10000);
  }

  const result = await pool.query(`
    SELECT
      id,
      event_name AS "eventName",
      path,
      product_id AS "productId",
      product_name AS "productName",
      category,
      value,
      metadata,
      session_id AS "sessionId",
      referrer,
      user_agent AS "userAgent",
      created_at AS "createdAt"
    FROM analytics_events
    WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY created_at DESC
    LIMIT 10000
  `, [safeDays]);
  return result.rows;
}

async function recordLocalAnalyticsEvent(event) {
  const record = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString()
  };
  const events = await getLocalAnalyticsEvents();
  events.push(record);
  await fs.mkdir(path.dirname(localAnalyticsFile), { recursive: true });
  await fs.writeFile(localAnalyticsFile, JSON.stringify(events.slice(-10000), null, 2));
  return record;
}

async function getLocalAnalyticsEvents() {
  try {
    const events = JSON.parse(await fs.readFile(localAnalyticsFile, "utf8"));
    return Array.isArray(events) ? events : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeAnalyticsEvent(eventInput = {}) {
  const productId = Number(eventInput.productId);
  const value = Number(eventInput.value);
  return {
    eventName: String(eventInput.eventName || "").trim(),
    path: nullableString(eventInput.path),
    productId: Number.isInteger(productId) && productId > 0 ? productId : null,
    productName: nullableString(eventInput.productName),
    category: nullableString(eventInput.category),
    value: Number.isFinite(value) && value > 0 ? Math.round(value) : 0,
    metadata: isPlainObject(eventInput.metadata) ? eventInput.metadata : {},
    sessionId: nullableString(eventInput.sessionId),
    referrer: nullableString(eventInput.referrer),
    userAgent: nullableString(eventInput.userAgent)
  };
}

function normalizeOrderAttribution(attribution = {}) {
  if (!isPlainObject(attribution)) return {};
  return {
    source: limitedString(attribution.source, 80),
    medium: limitedString(attribution.medium, 80),
    campaign: limitedString(attribution.campaign, 120),
    content: limitedString(attribution.content, 120),
    term: limitedString(attribution.term, 120),
    clickId: limitedString(attribution.clickId, 160),
    clickType: limitedString(attribution.clickType, 40),
    landingPage: limitedString(attribution.landingPage, 240),
    capturedAt: limitedString(attribution.capturedAt, 40)
  };
}

function clampAnalyticsDays(days) {
  const value = Number(days);
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(1, Math.round(value)));
}

function nullableString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function limitedString(value, maxLength = 120) {
  const text = nullableString(value);
  return text ? text.slice(0, maxLength) : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function orderError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = {
  hasDatabase: Boolean(pool),
  initializeDatabase,
  getProducts,
  getAdminProducts,
  getProduct,
  createProduct,
  updateProduct,
  deactivateProduct,
  createProductUpload,
  getProductUpload,
  createOrder,
  getOrders,
  getOrder,
  updateOrderStatus,
  markPaidNotificationSent,
  recordAnalyticsEvent,
  getAnalyticsEvents
};
