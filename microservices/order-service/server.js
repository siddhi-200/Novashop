const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3002);
const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
const pool = new Pool(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
} : {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'orders',
  user: process.env.DB_USER || 'novashop',
  password: process.env.DB_PASSWORD || 'novashop_dev_password',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});
app.use(express.json({ limit: '10kb' }));

async function initDatabase() {
  let connected = false;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try { await pool.query('SELECT 1'); connected = true; break; }
    catch (err) {
      console.log(`Waiting for order PostgreSQL (${attempt}/30): ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!connected) throw new Error('Order service could not connect to PostgreSQL.');
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, address TEXT NOT NULL,
    items JSONB NOT NULL, total INTEGER NOT NULL CHECK (total >= 0),
    status TEXT NOT NULL DEFAULT 'Confirmed', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sync_events (
    event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), synced BOOLEAN NOT NULL DEFAULT FALSE
  )`);
}
function orderFromRow(row) {
  return { id: row.id, customerName: row.customer_name, address: row.address,
    items: row.items, total: row.total, status: row.status, createdAt: row.created_at };
}
async function releaseStock(items) {
  try {
    const response = await fetch(`${PRODUCT_URL}/products/release`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map(i => ({ productId: i.productId, quantity: i.quantity })) }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) console.error('Stock compensation failed:', await response.text());
  } catch (err) { console.error('Could not compensate stock reservation:', err.message); }
}

async function syncPendingEvents() {
  try {
    const pending = await pool.query('SELECT event_id,event_type,payload FROM sync_events WHERE synced=FALSE ORDER BY created_at LIMIT 50');
    for (const event of pending.rows) {
      try {
        const response = await fetch(`${PRODUCT_URL}/sync/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event), signal: AbortSignal.timeout(4000)
        });
        if (response.ok) await pool.query('UPDATE sync_events SET synced=TRUE WHERE event_id=$1', [event.event_id]);
      } catch (err) {
        console.warn(`Event ${event.event_id} is queued until product service is reachable: ${err.message}`);
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
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'order-service', database: 'connected' }); }
  catch { res.status(503).json({ status: 'error', service: 'order-service', database: 'unavailable' }); }
});

app.post('/orders', async (req, res, next) => {
  const { customerName, address, items } = req.body || {};
  const name = typeof customerName === 'string' ? customerName.trim() : '';
  const addr = typeof address === 'string' ? address.trim() : '';
  if (!name || !addr || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Name, address, and at least one item are required.' });
  }
  if (name.length > 100 || addr.length > 300) return res.status(400).json({ error: 'Name or address is too long.' });

  let reservedItems;
  try {
    const reserveResponse = await fetch(`${PRODUCT_URL}/products/reserve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map(i => ({ productId: i && i.productId, quantity: i && i.quantity })) }),
      signal: AbortSignal.timeout(5000)
    });
    const reservedData = await reserveResponse.json().catch(() => ({}));
    if (!reserveResponse.ok) return res.status(reserveResponse.status === 400 ? 400 : 502).json({ error: reservedData.error || 'Product service error' });
    reservedItems = reservedData.items;
  } catch {
    return res.status(503).json({ error: 'Product service is unavailable. Please try again shortly.' });
  }

  const total = reservedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const orderId = `NS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO orders (id,customer_name,address,items,total,status)
       VALUES ($1,$2,$3,$4::jsonb,$5,'Confirmed') RETURNING *`,
      [orderId, name, addr, JSON.stringify(reservedItems), total]
    );
    await client.query(
      'INSERT INTO sync_events (event_id,event_type,payload,synced) VALUES ($1,$2,$3::jsonb,FALSE)',
      [crypto.randomUUID(), 'order_created', JSON.stringify({ orderId, items: reservedItems, total, occurredAt: new Date().toISOString() })]
    );
    await client.query('COMMIT');
    res.status(201).json(orderFromRow(inserted.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // The two service-owned databases cannot share a SQL transaction; compensate stock if the order write fails.
    await releaseStock(reservedItems);
    next(err);
  } finally { client.release(); }
});

app.get('/orders/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Order not found' });
    res.json(orderFromRow(result.rows[0]));
  } catch (err) { next(err); }
});
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Order service listening on port ${PORT}`));
  setInterval(syncPendingEvents, 5000).unref();
  syncPendingEvents();
}).catch(err => { console.error(err.message); process.exit(1); });
