const { Pool } = require("pg");
const seedProducts = require("./data/products");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
    })
  : null;

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
      image TEXT,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      total INTEGER NOT NULL CHECK (total >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'XOF',
      payment_provider TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      order_status TEXT NOT NULL DEFAULT 'pending',
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

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  `);

  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS image TEXT,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  const values = [];
  const placeholders = seedProducts.map((product, index) => {
    const offset = index * 12;
    values.push(
      product.id,
      product.name,
      product.category,
      product.price,
      product.oldPrice ?? null,
      product.emoji,
      product.rating,
      product.reviews,
      product.badge,
      product.stock,
      product.image || null,
      product.description || null
    );
    return `(${Array.from({ length: 12 }, (_, item) => `$${offset + item + 1}`).join(",")})`;
  });

  await pool.query(`
    INSERT INTO products (
      id, name, category, price, old_price, emoji, rating, reviews, badge, stock, image, description
    ) VALUES ${placeholders.join(",")}
    ON CONFLICT (id) DO NOTHING
  `, values);
}

async function getProducts({ category = "", search = "" } = {}) {
  if (!pool) {
    return seedProducts.filter(product => {
      const matchesCategory = !category || product.category.toLowerCase() === category.toLowerCase();
      const matchesSearch = !search || `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase());
      return product.active !== false && matchesCategory && matchesSearch;
    });
  }

  const values = [];
  const conditions = ["active = TRUE"];
  if (category) {
    values.push(category);
    conditions.push(`LOWER(category) = LOWER($${values.length})`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(name ILIKE $${values.length} OR category ILIKE $${values.length})`);
  }

  const result = await pool.query(`
    SELECT
      id, name, category, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, description
    FROM products
    WHERE ${conditions.join(" AND ")}
    ORDER BY id
  `, values);
  return result.rows;
}

async function getProduct(id, client = pool) {
  if (!pool) return seedProducts.find(product => product.id === Number(id) && product.active !== false);
  const result = await client.query(`
    SELECT
      id, name, category, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, description
    FROM products
    WHERE id = $1 AND active = TRUE
  `, [id]);
  return result.rows[0];
}

async function getAdminProducts() {
  if (!pool) return seedProducts.map(product => ({ ...product, active: product.active !== false }));

  const result = await pool.query(`
    SELECT
      id, name, category, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, description, active
    FROM products
    ORDER BY id
  `);
  return result.rows;
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
      id, name, category, price, old_price, emoji, rating, reviews, badge, stock, image, description, active
    )
    VALUES (
      (SELECT COALESCE(MAX(id), 0) + 1 FROM products),
      $1, $2, $3, $4, $5, 0, 0, $6, $7, $8, $9, $10
    )
    RETURNING
      id, name, category, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, description, active
  `, [
    product.name,
    product.category,
    product.price,
    product.oldPrice,
    "DT",
    product.badge,
    product.stock,
    product.image,
    product.description,
    product.active
  ]);
  return result.rows[0];
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
      price = $4,
      old_price = $5,
      badge = $6,
      stock = $7,
      image = $8,
      description = $9,
      active = $10,
      updated_at = NOW()
    WHERE id = $1
    RETURNING
      id, name, category, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, description, active
  `, [
    productId,
    product.name,
    product.category,
    product.price,
    product.oldPrice,
    product.badge,
    product.stock,
    product.image,
    product.description,
    product.active
  ]);
  return result.rows[0] || null;
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
      id, name, category, price, old_price AS "oldPrice", emoji,
      rating::FLOAT, reviews, badge, stock, image, description, active
  `, [productId]);
  return result.rows[0] || null;
}

function normalizeProductInput(input) {
  return {
    name: String(input.name || "").trim(),
    category: String(input.category || "").trim(),
    price: Number(input.price),
    oldPrice: input.oldPrice === null || input.oldPrice === "" || typeof input.oldPrice === "undefined" ? null : Number(input.oldPrice),
    badge: String(input.badge || "").trim(),
    stock: Number(input.stock),
    image: input.image ? String(input.image).trim() : null,
    description: input.description ? String(input.description).trim() : null,
    active: input.active !== false
  };
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

    const total = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    await client.query(`
      INSERT INTO orders (
        id, customer_name, customer_phone, delivery_address, total,
        currency, payment_provider, payment_status, order_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      orderInput.id,
      orderInput.customer.name,
      orderInput.customer.phone,
      orderInput.customer.address,
      total,
      "XOF",
      orderInput.paymentProvider,
      "pending",
      "pending"
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
    return { ...orderInput, items: normalizedItems, total, currency: "XOF" };
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
      o.delivery_address AS "deliveryAddress",
      o.total,
      o.currency,
      o.payment_provider AS "paymentProvider",
      o.payment_status AS "paymentStatus",
      o.order_status AS "orderStatus",
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
      delivery_address AS "deliveryAddress",
      total,
      currency,
      payment_provider AS "paymentProvider",
      payment_status AS "paymentStatus",
      order_status AS "orderStatus",
      created_at AS "createdAt"
  `, [id, orderStatus || null, paymentStatus || null]);
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
  createOrder,
  getOrders,
  updateOrderStatus
};
