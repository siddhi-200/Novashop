/* NovaShop shared frontend. Plain JS, no build step. Each page sets <body data-page="..."> */
const $ = (s, r = document) => r.querySelector(s);
const money = n => '₹' + Number(n).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_QTY = 10;

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
};
const Cart = {
  get() { return store.get('novashop-cart', {}); },
  save(c) { store.set('novashop-cart', c); updateBadge(); },
  count() { return Object.values(this.get()).reduce((a, b) => a + b, 0); },
  add(id, qty = 1, stock = MAX_QTY) {
    const c = this.get(); const max = Math.min(MAX_QTY, stock);
    c[id] = Math.min(max, (c[id] || 0) + qty); this.save(c); return c[id];
  },
  set(id, qty, stock = MAX_QTY) {
    const c = this.get(); const q = Math.min(MAX_QTY, stock, qty);
    if (q <= 0) delete c[id]; else c[id] = q; this.save(c);
  },
  clear() { this.save({}); }
};
const Orders = {
  ids() { return store.get('novashop-orders', []); },
  add(id) { store.set('novashop-orders', [id, ...this.ids().filter(x => x !== id)].slice(0, 50)); }
};

async function api(path, opts) {
  let r;
  try { r = await fetch(path, opts); } catch { throw new Error('Cannot reach the server. Please try again.'); }
  let data = null; try { data = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok) { const e = new Error((data && data.error) || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}

function updateBadge() { const b = $('#cartCount'); if (b) b.textContent = Cart.count(); }

function renderLayout(active) {
  const q = new URLSearchParams(location.search).get('q') || '';
  const link = (href, key, label) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  $('#app-header').innerHTML = `<header><a class="brand" href="/">✦ Nova<span>Shop</span></a>
    <form action="/" method="get"><input name="q" value="${esc(q)}" placeholder="Search products, categories..." aria-label="Search products"></form>
    <nav>${link('/', 'index', 'Shop')}${link('/orders', 'orders', 'My orders')}${link('/about', 'about', 'Help')}
    <a href="/cart" class="${active === 'cart' ? 'active' : ''}">Cart <span class="badge" id="cartCount">0</span></a></nav></header>`;
  $('#app-footer').innerHTML = `<footer>NovaShop · Educational ecommerce demo · <span id="arch">…</span></footer>`;
  updateBadge();
  api('/api/health').then(h => { $('#arch').textContent = h.architecture === 'monolith' ? 'Monolithic architecture' : 'Microservices architecture (via ' + (h.service || 'gateway') + ')'; })
    .catch(() => { $('#arch').textContent = 'Backend unreachable'; });
}

function productCard(p) {
  const out = p.stock <= 0;
  return `<article class="product"><a class="emoji" href="/product?id=${p.id}" aria-label="View ${esc(p.name)}">${esc(p.emoji)}</a>
    <h3><a href="/product?id=${p.id}">${esc(p.name)}</a></h3><p>${esc(p.description)}</p><span class="category">${esc(p.category)}</span>
    <div class="price-row"><span class="price">${money(p.price)}</span>${stockLabel(p)}</div>
    <div class="actions"><button class="primary" data-add="${p.id}" data-stock="${p.stock}" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to cart'}</button>
    <a class="btn" href="/product?id=${p.id}">Details</a></div></article>`;
}
function stockLabel(p) {
  if (p.stock <= 0) return '<small class="out">Out of stock</small>';
  if (p.stock <= 5) return `<small class="low">Only ${p.stock} left</small>`;
  return `<small>${p.stock} in stock</small>`;
}
function bindAddButtons(root, after) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    Cart.add(Number(b.dataset.add), 1, Number(b.dataset.stock));
    const t = b.textContent; b.textContent = 'Added ✓'; setTimeout(() => { b.textContent = t; }, 900);
    if (after) after();
  });
}
const showError = (el, msg) => { el.innerHTML = `<div class="error">${esc(msg)}</div>`; };

/* ---------- pages ---------- */
const pages = {
  async index() {
    const params = new URLSearchParams(location.search);
    let category = params.get('category') || 'All'; const q = params.get('q') || '';
    const grid = $('#products'); let all = [];
    try { all = await api('/api/products'); } catch (e) { showError(grid, e.message); return; }
    const cats = ['All', ...new Set(all.map(p => p.category))];
    if (!cats.includes(category)) category = 'All';
    const draw = () => {
      $('#filters').innerHTML = cats.map(c => `<button class="${c === category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      const needle = q.toLowerCase();
      const list = all.filter(p => (category === 'All' || p.category === category) && `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(needle));
      $('#heading').textContent = q ? `Results for “${q}”` : 'Popular picks';
      grid.innerHTML = list.length ? list.map(productCard).join('') : '<div class="empty">No products match your search.</div>';
    };
    $('#filters').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) { category = b.dataset.cat; draw(); } });
    bindAddButtons(grid); draw();
  },

  async product() {
    const root = $('#detail'); const id = Number(new URLSearchParams(location.search).get('id'));
    if (!Number.isInteger(id) || id < 1) { root.innerHTML = '<div class="empty">No product selected. <a href="/">Browse the shop</a>.</div>'; return; }
    let p; try { p = await api('/api/products/' + id); } catch (e) {
      root.innerHTML = e.status === 404 ? '<div class="empty">Product not found. <a href="/">Browse the shop</a>.</div>' : `<div class="error">${esc(e.message)}</div>`; return;
    }
    document.title = p.name + ' | NovaShop';
    const out = p.stock <= 0, max = Math.min(MAX_QTY, p.stock);
    root.innerHTML = `<div class="crumbs"><a href="/">Shop</a> › <a href="/?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a> › ${esc(p.name)}</div>
      <div class="detail"><div class="emoji">${esc(p.emoji)}</div><div><span class="category">${esc(p.category)}</span><h1>${esc(p.name)}</h1>
      <p>${esc(p.description)}</p><div class="total">${money(p.price)}</div><p>${stockLabel(p)}</p>
      <div class="row"><select id="qty" aria-label="Quantity" ${out ? 'disabled' : ''}>${Array.from({ length: max }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
      <button class="primary" id="add" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to cart'}</button>
      <button class="green" id="buy" ${out ? 'disabled' : ''}>Buy now</button></div><p id="msg" class="muted"></p></div></div>
      <div class="toolbar"><h2>You may also like</h2></div><div class="grid" id="related"></div>`;
    const qty = () => Number($('#qty').value) || 1;
    $('#add').onclick = () => { Cart.add(p.id, qty(), p.stock); $('#msg').innerHTML = 'Added to your cart. <a href="/cart">View cart</a>'; };
    $('#buy').onclick = () => { Cart.add(p.id, qty(), p.stock); location.href = '/cart'; };
    try {
      const rel = (await api('/api/products?category=' + encodeURIComponent(p.category))).filter(x => x.id !== p.id).slice(0, 3);
      $('#related').innerHTML = rel.length ? rel.map(productCard).join('') : '<div class="empty">Nothing else in this category yet.</div>';
      bindAddButtons($('#related'));
    } catch { $('#related').innerHTML = ''; }
  },

  async cart() {
    const root = $('#cartBody'); let products;
    try { products = await api('/api/products'); } catch (e) { showError(root, e.message); return; }
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    const cart = Cart.get(); let changed = false;
    for (const id of Object.keys(cart)) { if (!byId[id]) { delete cart[id]; changed = true; } }
    if (changed) Cart.save(cart);
    const draw = () => {
      const c = Cart.get(); const ids = Object.keys(c);
      if (!ids.length) { root.innerHTML = '<div class="panel empty">Your cart is empty. <a href="/">Find something you love!</a></div>'; return; }
      let total = 0;
      const lines = ids.map(id => {
        const p = byId[id], q = c[id]; total += p.price * q;
        return `<div class="cart-line"><div class="ico">${esc(p.emoji)}</div><div class="grow"><a href="/product?id=${p.id}"><b>${esc(p.name)}</b></a><br><small>${money(p.price)} each</small></div>
          <div class="qty"><button data-dec="${id}" aria-label="Decrease">−</button><b>${q}</b><button data-inc="${id}" aria-label="Increase" ${q >= Math.min(MAX_QTY, p.stock) ? 'disabled' : ''}>+</button></div>
          <b>${money(p.price * q)}</b><button class="danger" data-del="${id}">Remove</button></div>`;
      }).join('');
      root.innerHTML = `<div class="panel">${lines}</div><div class="total">Total: ${money(total)}</div>
        <a class="btn green" href="/checkout">Continue to checkout →</a> <a class="btn" href="/">Keep shopping</a>`;
    };
    root.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return; const d = t.dataset; const c = Cart.get();
      const id = d.inc || d.dec || d.del; if (!id || !byId[id]) return;
      if (d.inc) Cart.set(id, (c[id] || 0) + 1, byId[id].stock);
      if (d.dec) Cart.set(id, (c[id] || 0) - 1, byId[id].stock);
      if (d.del) Cart.set(id, 0);
      draw();
    });
    draw();
  },

  async checkout() {
    const root = $('#checkoutBody'); const c = Cart.get();
    if (!Object.keys(c).length) { root.innerHTML = '<div class="panel empty">Your cart is empty. <a href="/">Go shopping</a>.</div>'; return; }
    let products; try { products = await api('/api/products'); } catch (e) { showError(root, e.message); return; }
    const byId = Object.fromEntries(products.map(p => [p.id, p]));
    let total = 0; const summary = Object.entries(c).filter(([id]) => byId[id]).map(([id, q]) => { total += byId[id].price * q; return `<tr><td>${esc(byId[id].name)} × ${q}</td><td style="text-align:right">${money(byId[id].price * q)}</td></tr>`; }).join('');
    root.innerHTML = `<div class="panel"><b>Order summary</b><table><tbody>${summary}</tbody></table><div class="total">Total: ${money(total)}</div>
      <form id="form" class="form"><label>Full name<input id="customerName" maxlength="100" required autocomplete="name"></label>
      <label>Delivery address<textarea id="address" rows="3" maxlength="300" required autocomplete="street-address"></textarea></label>
      <div id="err"></div><button class="green" type="submit" id="submit">Place demo order</button></form>
      <p class="muted" style="font-size:12px">Demo only — no payment is collected.</p></div>`;
    $('#form').addEventListener('submit', async e => {
      e.preventDefault(); const btn = $('#submit'); btn.disabled = true; btn.textContent = 'Placing order…'; $('#err').innerHTML = '';
      const items = Object.entries(Cart.get()).map(([productId, quantity]) => ({ productId: Number(productId), quantity }));
      try {
        const order = await api('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerName: $('#customerName').value, address: $('#address').value, items }) });
        Orders.add(order.id); Cart.clear(); location.href = '/order?id=' + encodeURIComponent(order.id) + '&new=1';
      } catch (err) { showError($('#err'), err.message); btn.disabled = false; btn.textContent = 'Place demo order'; }
    });
  },

  async order() {
    const params = new URLSearchParams(location.search); const id = params.get('id'); const root = $('#orderBody');
    if (!id) { location.replace('/orders'); return; }
    try {
      const o = await api('/api/orders/' + encodeURIComponent(id));
      const rows = o.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.quantity}</td><td>${money(i.price)}</td><td style="text-align:right">${money(i.price * i.quantity)}</td></tr>`).join('');
      root.innerHTML = `${params.get('new') ? '<div class="panel" style="text-align:center"><div style="font-size:60px">🎉</div><div class="eyebrow">Order confirmed</div><h1>Thank you for shopping!</h1></div>' : '<div class="eyebrow">Order details</div><h1>Order ' + esc(o.id) + '</h1>'}
        <div class="panel"><p><b>Order ID:</b> ${esc(o.id)} <span class="status">${esc(o.status)}</span><br><small>Placed ${esc(new Date(o.createdAt).toLocaleString())}</small></p>
        <p><b>${esc(o.customerName)}</b><br>${esc(o.address).replace(/\n/g, '<br>')}</p>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th style="text-align:right">Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="total">Total: ${money(o.total)}</div></div><a class="btn primary" href="/">Back to shopping</a> <a class="btn" href="/orders">My orders</a>`;
      Orders.add(o.id);
    } catch (e) {
      root.innerHTML = e.status === 404 ? `<div class="panel empty">No order found with ID <b>${esc(id)}</b>. <a href="/orders">Try another ID</a>.</div>` : `<div class="error">${esc(e.message)}</div>`;
    }
  },

  async orders() {
    $('#track').addEventListener('submit', e => { e.preventDefault(); const v = $('#trackId').value.trim(); if (v) location.href = '/order?id=' + encodeURIComponent(v); });
    const root = $('#ordersBody'); const ids = Orders.ids();
    if (!ids.length) { root.innerHTML = '<div class="empty">You have not placed any orders on this device yet.</div>'; return; }
    const res = await Promise.allSettled(ids.map(id => api('/api/orders/' + encodeURIComponent(id))));
    const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!ok.length) { root.innerHTML = '<div class="empty">Your previous orders are no longer available (demo data resets when the server restarts).</div>'; return; }
    root.innerHTML = `<table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th></th></tr></thead><tbody>${ok.map(o =>
      `<tr><td>${esc(o.id)}</td><td>${esc(new Date(o.createdAt).toLocaleDateString())}</td><td>${o.items.reduce((a, i) => a + i.quantity, 0)}</td><td>${money(o.total)}</td><td><a href="/order?id=${encodeURIComponent(o.id)}">View</a></td></tr>`).join('')}</tbody></table>`;
  },

  about() { /* static page */ }
};

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page; renderLayout(page);
  if (pages[page]) pages[page]();
});
