const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const MAX_QTY = 10;
const ORDER_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3002';
const pool = new Pool(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
} : {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'products',
  user: process.env.DB_USER || 'novashop',
  password: process.env.DB_PASSWORD || 'novashop_dev_password',
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
    try { await pool.query('SELECT 1'); connected = true; break; }
    catch (err) {
      console.log(`Waiting for product PostgreSQL (${attempt}/30): ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!connected) throw new Error('Product service could not connect to PostgreSQL.');
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0), stock INTEGER NOT NULL CHECK (stock >= 0),
    emoji TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sync_events (
    event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), synced BOOLEAN NOT NULL DEFAULT FALSE
  )`);
  for (const p of seedProducts) {
    await pool.query(`INSERT INTO products (id,name,category,price,stock,emoji,description)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`, p);
  }
}

async function syncPendingEvents() {
  try {
    const pending = await pool.query('SELECT event_id,event_type,payload FROM sync_events WHERE synced=FALSE ORDER BY created_at LIMIT 50');
    for (const event of pending.rows) {
      try {
        const response = await fetch(`${ORDER_URL}/sync/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event), signal: AbortSignal.timeout(4000)
        });
        if (response.ok) await pool.query('UPDATE sync_events SET synced=TRUE WHERE event_id=$1', [event.event_id]);
      } catch (err) {
        console.warn(`Event ${event.event_id} is queued until order service is reachable: ${err.message}`);
        break;
      }
    }
  } catch (err) { console.warn(`Event sync check failed: ${err.message}`); }
}

app.post('/sync/events', async (req, res, next) => {
  const { event_id, event_type, payload } = req.body || {};
  if (!event_id || !event_type || payload === undefined) return res.status(400).json({ error: 'event_id, event_type, and payload are required.' });
  try {
    await pool.query(
      `INSERT INTO sync_events (event_id,event_type,payload,synced) VALUES ($1,$2,$3::jsonb,TRUE) ON CONFLICT (event_id) DO NOTHING`,
      [String(event_id), String(event_type), JSON.stringify(payload)]
    );
    res.status(202).json({ status: 'stored', event_id });
  } catch (err) { next(err); }
});

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'product-service', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', service: 'product-service', database: 'unavailable' }); }
});

app.get('/products', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const result = await pool.query(
      `SELECT id,name,category,price,stock,emoji,description FROM products
       WHERE ($1 = '' OR (name || ' ' || category || ' ' || description) ILIKE $2)
         AND ($3 = '' OR category ILIKE $3) ORDER BY id`,
      [q, `%${q}%`, category]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Internal endpoint used only by the Order service. It reserves stock atomically.
app.post('/products/reserve', async (req, res, next) => {
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required.' });
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
    const result = await client.query(
      'SELECT id,name,price,stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
      [[...wanted.keys()]]
    );
    const found = new Map(result.rows.map(p => [p.id, p]));
    const lines = [];
    for (const [id, qty] of wanted) {
      const p = found.get(id);
      if (!p) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Unknown product ${id}` }); }
      if (qty > MAX_QTY) { await client.query('ROLLBACK'); return res.status(400).json({ error: `You can order at most ${MAX_QTY} of ${p.name}.` }); }
      if (p.stock < qty) { await client.query('ROLLBACK'); return res.status(400).json({ error: `${p.name} is out of stock for requested quantity` }); }
      lines.push({ p, qty });
    }
    const reservedItems = [];
    for (const { p, qty } of lines) {
      await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2', [qty, p.id]);
      reservedItems.push({ productId: p.id, name: p.name, price: p.price, quantity: qty });
    }
    await client.query(
      'INSERT INTO sync_events (event_id,event_type,payload,synced) VALUES ($1,$2,$3::jsonb,FALSE)',
      [crypto.randomUUID(), 'inventory_reserved', JSON.stringify({ items: reservedItems, occurredAt: new Date().toISOString() })]
    );
    await client.query('COMMIT');
    res.json({ items: reservedItems });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
});

// Compensation endpoint: the Order service calls this if persisting an order fails.
app.post('/products/release', async (req, res, next) => {
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const id = Number(item && item.productId);
      const qty = Number(item && item.quantity);
      if (!Number.isInteger(id) || id < 1 || !Number.isInteger(qty) || qty < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid release item.' });
      }
      const result = await client.query('UPDATE products SET stock=stock+$1 WHERE id=$2 RETURNING id', [qty, id]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Unknown product ${id}` });
      }
    }
    await client.query(
      'INSERT INTO sync_events (event_id,event_type,payload,synced) VALUES ($1,$2,$3::jsonb,FALSE)',
      [crypto.randomUUID(), 'inventory_released', JSON.stringify({ items, occurredAt: new Date().toISOString() })]
    );
    await client.query('COMMIT');
    res.json({ status: 'released' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
});

app.get('/products/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT id,name,category,price,stock,emoji,description FROM products WHERE id=$1', [Number(req.params.id)]);
    if (!result.rowCount) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Product service listening on port ${PORT}`));
  setInterval(syncPendingEvents, 5000).unref();
  syncPendingEvents();
}).catch(err => { console.error(err.message); process.exit(1); });
