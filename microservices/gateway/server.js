const express = require('express'); // global fetch requires Node 18+
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
const ORDER_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3002';
app.use(express.json({ limit: '10kb' }));

// Forward a request to a backend service. Only the routes listed below are exposed,
// so internal endpoints (e.g. POST /products/reserve) are not reachable from the browser.
function forward(base, toPath) {
  return async (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const url = base + toPath(req) + qs;
    const init = { method: req.method, signal: AbortSignal.timeout(8000) };
    if (req.method === 'POST') { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(req.body || {}); }
    try {
      const r = await fetch(url, init);
      res.status(r.status).type('application/json').send(await r.text());
    } catch {
      res.status(502).json({ error: 'A backend service is unavailable. Please try again shortly.' });
    }
  };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', architecture: 'microservices', service: 'api-gateway' }));
app.get('/api/products', forward(PRODUCT_URL, () => '/products'));
app.get('/api/products/:id', forward(PRODUCT_URL, req => `/products/${encodeURIComponent(req.params.id)}`));
app.post('/api/orders', forward(ORDER_URL, () => '/orders'));
app.get('/api/orders/:id', forward(ORDER_URL, req => `/orders/${encodeURIComponent(req.params.id)}`));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`API Gateway running at http://localhost:${PORT}`));
