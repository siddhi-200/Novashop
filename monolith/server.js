const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_QTY = 10;
const pool = new Pool(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
} : {
  host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  database: process.env.DB_NAME || process.env.PGDATABASE || 'novashop',
  user: process.env.DB_USER || process.env.PGUSER || 'novashop',
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'novashop_dev_password',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

app.use(express.json({ limit: '10kb' }));

const seedProducts = [
  [1, 'Wireless Headphones', 'Audio', 1999, 18, '🎧', 'Comfortable everyday sound'],
  [2, 'Mechanical Keyboard', 'Electronics', 2499, 12, '⌨️', 'Tactile keys for work and play'],
  [3, 'Gaming Mouse', 'Electronics', 999, 20, '🖱️', 'Precise tracking, ergonomic grip'],
  [4, 'Smart Watch', 'Wearables', 3499, 8, '⌚', 'Keep your day in sync'],
  [5, 'Bluetooth Speaker', 'Audio', 1499, 15, '🔊', 'Portable music anywhere'],
  [6, 'Everyday Backpack', 'Accessories', 1299, 10, '🎒', 'Room for all your essentials']
];

async function initDatabase() {
  let connected = false;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      connected = true;
      break;
    } catch (err) {
      console.log(`Waiting for PostgreSQL (${attempt}/30): ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!connected) throw new Error('Could not connect to PostgreSQL after 30 attempts. Check DB_HOST/DB credentials.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0),
      emoji TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      address TEXT NOT NULL,
      items JSONB NOT NULL,
      total INTEGER NOT NULL CHECK (total >= 0),
      status TEXT NOT NULL DEFAULT 'Confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const p of seedProducts) {
    await pool.query(
      `INSERT INTO products (id, name, category, price, stock, emoji, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`, p
    );
  }
}

function orderFromRow(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    address: row.address,
    items: row.items,
    total: row.total,
    status: row.status,
    createdAt: row.created_at
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', architecture: 'monolith', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', architecture: 'monolith', database: 'unavailable' });
  }
});

app.get('/api/products', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const result = await pool.query(
      `SELECT id, name, category, price, stock, emoji, description
       FROM products
       WHERE ($1 = '' OR (name || ' ' || category || ' ' || description) ILIKE $2)
         AND ($3 = '' OR category ILIKE $3)
       ORDER BY id`,
      [q, `%${q}%`, category]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

app.get('/api/products/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category, price, stock, emoji, description FROM products WHERE id = $1',
      [Number(req.params.id)]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

app.post('/api/orders', async (req, res, next) => {
  const { customerName, address, items } = req.body || {};
  const name = typeof customerName === 'string' ? customerName.trim() : '';
  const addr = typeof address === 'string' ? address.trim() : '';
  if (!name || !addr || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Name, address, and at least one item are required.' });
  }
  if (name.length > 100 || addr.length > 300) return res.status(400).json({ error: 'Name or address is too long.' });

  const wanted = new Map();
  for (const item of items) {
    const qty = Number(item && item.quantity);
    const id = Number(item && item.productId);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.status(400).json({ error: `Quantity must be a whole number between 1 and ${MAX_QTY}.` });
    }
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid product ID.' });
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [...wanted.keys()];
    const result = await client.query(
      'SELECT id, name, price, stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]
    );
    const byId = new Map(result.rows.map(p => [p.id, p]));
    const lines = [];
    for (const [id, qty] of wanted) {
      const p = byId.get(id);
      if (!p) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Unknown product ${id}` }); }
      if (qty > MAX_QTY) { await client.query('ROLLBACK'); return res.status(400).json({ error: `You can order at most ${MAX_QTY} of ${p.name}.` }); }
      if (p.stock < qty) { await client.query('ROLLBACK'); return res.status(400).json({ error: `${p.name} is out of stock for requested quantity` }); }
      lines.push({ p, qty });
    }

    let total = 0;
    const orderItems = [];
    for (const { p, qty } of lines) {
      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [qty, p.id]);
      total += p.price * qty;
      orderItems.push({ productId: p.id, name: p.name, price: p.price, quantity: qty });
    }
    const orderId = `NS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const inserted = await client.query(
      `INSERT INTO orders (id, customer_name, address, items, total, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'Confirmed') RETURNING *`,
      [orderId, name, addr, JSON.stringify(orderItems), total]
    );
    await client.query('COMMIT');
    res.status(201).json(orderFromRow(inserted.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Order not found' });
    res.json(orderFromRow(result.rows[0]));
  } catch (err) { next(err); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`NovaShop monolith running on port ${PORT}`));
}).catch(err => {
  console.error(err.message);
  process.exit(1);
});
