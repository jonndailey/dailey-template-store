const express = require('express');
const mysql = require('mysql2/promise');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { migrate } = require('./migrate');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const STORE_NAME = process.env.STORE_NAME || 'My Store';

let pool;
async function getPool() {
  if (!pool) pool = mysql.createPool(process.env.DATABASE_URL);
  return pool;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session middleware
app.use((req, res, next) => {
  if (!req.cookies.session_id) {
    const sid = uuidv4();
    res.cookie('session_id', sid, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'strict' });
    req.sessionId = sid;
  } else {
    req.sessionId = req.cookies.session_id;
  }
  next();
});

function formatPrice(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function adminAuth(req, res, next) {
  if (req.cookies.store_admin === '1') return next();
  res.redirect('/admin/login');
}

// Cart count helper
async function getCartCount(sessionId) {
  try {
    const db = await getPool();
    const [rows] = await db.execute('SELECT SUM(quantity) as cnt FROM cart_items WHERE session_id = ?', [sessionId]);
    return rows[0].cnt || 0;
  } catch { return 0; }
}

function layout(title, content, options = {}) {
  const { isAdmin = false, cartCount = 0 } = options;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${STORE_NAME}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a2e; background: #fafafa; }
  a { color: #4361ee; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 16px 0; position: sticky; top: 0; z-index: 100; }
  header .container { display: flex; align-items: center; justify-content: space-between; }
  .logo { font-size: 22px; font-weight: 700; color: #1a1a2e; }
  .logo:hover { text-decoration: none; color: #4361ee; }
  header nav { display: flex; align-items: center; gap: 24px; }
  header nav a { color: #555; font-weight: 500; font-size: 15px; }
  header nav a:hover { color: #4361ee; text-decoration: none; }
  .cart-badge { position: relative; }
  .cart-badge .count { position: absolute; top: -8px; right: -10px; background: #e63946; color: #fff; font-size: 11px; font-weight: 700; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  main { padding: 40px 0 80px; min-height: 60vh; }
  footer { background: #fff; border-top: 1px solid #e8e8e8; padding: 32px 0; text-align: center; color: #888; font-size: 14px; }
  .btn { display: inline-block; padding: 10px 24px; background: #4361ee; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn:hover { background: #3a0ca3; color: #fff; text-decoration: none; }
  .btn-sm { padding: 8px 16px; font-size: 13px; }
  .btn-outline { background: transparent; color: #4361ee; border: 1px solid #4361ee; }
  .btn-outline:hover { background: #4361ee; color: #fff; }
  .btn-danger { background: #e63946; }
  .btn-danger:hover { background: #c1121f; }
  .btn-success { background: #2d6a4f; }
  .btn-success:hover { background: #1b4332; }

  /* Products */
  .category-nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 32px; }
  .category-nav a { padding: 8px 20px; background: #fff; border: 1px solid #e8e8e8; border-radius: 20px; font-size: 14px; font-weight: 500; color: #555; }
  .category-nav a:hover, .category-nav a.active { background: #4361ee; color: #fff; border-color: #4361ee; text-decoration: none; }
  .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; }
  .product-card { background: #fff; border-radius: 12px; border: 1px solid #e8e8e8; overflow: hidden; transition: box-shadow 0.2s; }
  .product-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
  .product-img { width: 100%; height: 200px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 48px; }
  .product-info { padding: 20px; }
  .product-info h3 { font-size: 18px; margin-bottom: 4px; }
  .product-info h3 a { color: #1a1a2e; }
  .product-cat { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .product-price { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 8px 0 12px; }
  .product-stock { font-size: 13px; }
  .in-stock { color: #2d6a4f; }
  .out-of-stock { color: #e63946; }

  /* Product detail */
  .product-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; background: #fff; border-radius: 12px; padding: 32px; border: 1px solid #e8e8e8; }
  .product-detail-img { width: 100%; height: 400px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 80px; }
  .product-detail h1 { font-size: 32px; margin-bottom: 8px; }
  .product-detail .price { font-size: 36px; font-weight: 700; margin: 16px 0; }
  .product-detail .desc { color: #555; font-size: 16px; line-height: 1.7; margin-bottom: 24px; }
  .qty-control { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .qty-control input { width: 60px; padding: 8px; text-align: center; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; }
  .qty-control label { font-weight: 600; }

  /* Cart */
  .cart-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #e8e8e8; }
  .cart-table th { background: #f8f9fa; text-align: left; padding: 14px 16px; font-size: 13px; font-weight: 600; color: #555; text-transform: uppercase; }
  .cart-table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; }
  .cart-summary { background: #fff; border-radius: 12px; padding: 28px; border: 1px solid #e8e8e8; margin-top: 24px; }
  .cart-total { font-size: 28px; font-weight: 700; }

  /* Checkout */
  .checkout-grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 32px; }
  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 14px; font-weight: 600; color: #333; margin-bottom: 6px; }
  .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 12px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 15px; font-family: inherit; }
  .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #4361ee; box-shadow: 0 0 0 3px rgba(67,97,238,0.1); }
  .order-summary { background: #f8f9fa; border-radius: 12px; padding: 28px; }
  .order-summary h3 { margin-bottom: 16px; }
  .order-line { display: flex; justify-content: space-between; padding: 8px 0; font-size: 15px; }
  .order-line.total { border-top: 2px solid #ddd; margin-top: 12px; padding-top: 12px; font-weight: 700; font-size: 18px; }

  /* Confirmation */
  .confirmation { text-align: center; background: #fff; border-radius: 12px; padding: 60px 40px; border: 1px solid #e8e8e8; }
  .confirmation .checkmark { width: 80px; height: 80px; border-radius: 50%; background: #e8fde8; color: #2d6a4f; font-size: 40px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
  .confirmation h1 { font-size: 32px; margin-bottom: 8px; }
  .confirmation p { color: #888; font-size: 18px; }

  /* Admin */
  .admin-header { background: #1a1a2e; }
  .admin-header .logo { color: #fff; }
  .admin-header nav a { color: #aaa; }
  .admin-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #e8e8e8; }
  .admin-table th { background: #f8f9fa; text-align: left; padding: 14px 16px; font-size: 13px; font-weight: 600; color: #555; text-transform: uppercase; }
  .admin-table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 15px; }
  .admin-table tr:hover td { background: #f8f9ff; }
  .page-title { font-size: 28px; margin-bottom: 8px; }
  .login-box { max-width: 400px; margin: 80px auto; background: #fff; padding: 40px; border-radius: 12px; border: 1px solid #e8e8e8; }
  .login-box h1 { font-size: 24px; text-align: center; margin-bottom: 24px; }
  .alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
  .alert-success { background: #e8fde8; color: #2d6a4f; }
  .alert-error { background: #fde8e8; color: #c1121f; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .badge-pending { background: #fff3cd; color: #856404; }
  .badge-confirmed { background: #e8fde8; color: #2d6a4f; }
  .badge-shipped { background: #eef0ff; color: #4361ee; }
  .badge-delivered { background: #d4edda; color: #155724; }
  .badge-cancelled { background: #fde8e8; color: #c1121f; }

  @media (max-width: 768px) {
    .product-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
    .product-detail { grid-template-columns: 1fr; }
    .checkout-grid { grid-template-columns: 1fr; }
    header .container { flex-direction: column; gap: 12px; }
  }
</style>
</head><body>
<header${isAdmin ? ' class="admin-header"' : ''}>
  <div class="container">
    <a href="${isAdmin ? '/admin' : '/'}" class="logo">${isAdmin ? 'Store Admin' : STORE_NAME}</a>
    <nav>
      ${isAdmin ? `
        <a href="/admin">Products</a>
        <a href="/admin/orders">Orders</a>
        <a href="/" target="_blank">View Store</a>
        <a href="/admin/logout">Logout</a>
      ` : `
        <a href="/">Shop</a>
        <a href="/cart" class="cart-badge">Cart${cartCount > 0 ? `<span class="count">${cartCount}</span>` : ''}</a>
      `}
    </nav>
  </div>
</header>
<main><div class="container">${content}</div></main>
<footer><div class="container">&copy; ${new Date().getFullYear()} ${STORE_NAME}. Powered by <a href="https://dailey.cloud">Dailey OS</a>.</div></footer>
</body></html>`;
}

// Product icon based on category
function productIcon(category) {
  const icons = { 'Electronics': '&#128187;', 'Clothing': '&#128085;', 'Home': '&#127968;' };
  return icons[category] || '&#128230;';
}

// =====================
// STORE ROUTES
// =====================
app.get('/', async (req, res) => {
  try {
    const db = await getPool();
    const cat = req.query.category || null;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    if (cat) { query += ' AND category = ?'; params.push(cat); }
    query += ' ORDER BY created_at DESC';
    const [products] = await db.execute(query, params);
    const [categories] = await db.execute('SELECT DISTINCT category FROM products ORDER BY category');
    const cartCount = await getCartCount(req.sessionId);

    const catLinks = categories.map(c =>
      `<a href="/?category=${encodeURIComponent(c.category)}" class="${cat === c.category ? 'active' : ''}">${c.category}</a>`
    ).join('');

    const cards = products.map(p => `
      <div class="product-card">
        <div class="product-img">${productIcon(p.category)}</div>
        <div class="product-info">
          <span class="product-cat">${p.category}</span>
          <h3><a href="/product/${p.slug}">${p.name}</a></h3>
          <div class="product-price">${formatPrice(p.price_cents)}</div>
          <span class="product-stock ${p.in_stock ? 'in-stock' : 'out-of-stock'}">${p.in_stock ? 'In Stock' : 'Out of Stock'}</span>
        </div>
      </div>`).join('');

    res.send(layout(STORE_NAME, `
      <h1 class="page-title" style="margin-bottom:8px;">${STORE_NAME}</h1>
      <p style="color:#888;margin-bottom:24px;">Quality products, great prices</p>
      <div class="category-nav">
        <a href="/" class="${!cat ? 'active' : ''}">All</a>
        ${catLinks}
      </div>
      <div class="product-grid">${cards || '<p style="color:#888;text-align:center;padding:40px;">No products yet.</p>'}</div>
    `, { cartCount }));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

app.get('/product/:slug', async (req, res) => {
  try {
    const db = await getPool();
    const [products] = await db.execute('SELECT * FROM products WHERE slug = ?', [req.params.slug]);
    if (!products.length) return res.status(404).send(layout('Not Found', '<p>Product not found.</p>'));
    const p = products[0];
    const cartCount = await getCartCount(req.sessionId);

    res.send(layout(p.name, `
      <div class="product-detail">
        <div class="product-detail-img">${productIcon(p.category)}</div>
        <div>
          <span class="product-cat">${p.category}</span>
          <h1>${p.name}</h1>
          <div class="price">${formatPrice(p.price_cents)}</div>
          <span class="product-stock ${p.in_stock ? 'in-stock' : 'out-of-stock'}">${p.in_stock ? 'In Stock' : 'Out of Stock'}</span>
          <p class="desc" style="margin-top:16px;">${p.description || ''}</p>
          ${p.in_stock ? `
            <form method="POST" action="/cart/add">
              <input type="hidden" name="product_id" value="${p.id}">
              <div class="qty-control">
                <label>Qty:</label>
                <input type="number" name="quantity" value="1" min="1" max="99">
              </div>
              <button type="submit" class="btn">Add to Cart</button>
            </form>
          ` : '<p style="margin-top:16px;color:#e63946;font-weight:600;">Currently unavailable</p>'}
        </div>
      </div>
      <div style="margin-top:24px;"><a href="/">&larr; Continue shopping</a></div>
    `, { cartCount }));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

// Cart
app.post('/cart/add', async (req, res) => {
  try {
    const db = await getPool();
    const { product_id, quantity } = req.body;
    const qty = Math.max(1, parseInt(quantity) || 1);
    const [existing] = await db.execute('SELECT * FROM cart_items WHERE session_id = ? AND product_id = ?', [req.sessionId, product_id]);
    if (existing.length) {
      await db.execute('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?', [qty, existing[0].id]);
    } else {
      await db.execute('INSERT INTO cart_items (session_id, product_id, quantity) VALUES (?, ?, ?)', [req.sessionId, product_id, qty]);
    }
    res.redirect('/cart');
  } catch (err) { console.error(err); res.redirect('/cart'); }
});

app.get('/cart', async (req, res) => {
  try {
    const db = await getPool();
    const [items] = await db.execute(
      'SELECT ci.*, p.name, p.price_cents, p.slug FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.session_id = ?',
      [req.sessionId]
    );
    const cartCount = items.reduce((s, i) => s + i.quantity, 0);
    const total = items.reduce((s, i) => s + i.price_cents * i.quantity, 0);

    const rows = items.map(i => `<tr>
      <td><a href="/product/${i.slug}">${i.name}</a></td>
      <td>${formatPrice(i.price_cents)}</td>
      <td>
        <form method="POST" action="/cart/update" style="display:flex;align-items:center;gap:8px;">
          <input type="hidden" name="item_id" value="${i.id}">
          <input type="number" name="quantity" value="${i.quantity}" min="0" max="99" style="width:60px;padding:6px;border:1px solid #ddd;border-radius:6px;text-align:center;">
          <button type="submit" class="btn btn-sm btn-outline">Update</button>
        </form>
      </td>
      <td style="font-weight:600;">${formatPrice(i.price_cents * i.quantity)}</td>
      <td>
        <form method="POST" action="/cart/remove" style="display:inline;">
          <input type="hidden" name="item_id" value="${i.id}">
          <button type="submit" class="btn btn-sm btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

    res.send(layout('Cart', `
      <h1 class="page-title">Shopping Cart</h1>
      ${items.length > 0 ? `
        <table class="cart-table" style="margin-top:24px;">
          <thead><tr><th>Product</th><th>Price</th><th>Quantity</th><th>Subtotal</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="cart-summary" style="display:flex;align-items:center;justify-content:space-between;">
          <div><span style="color:#888;">Total:</span> <span class="cart-total">${formatPrice(total)}</span></div>
          <div style="display:flex;gap:12px;">
            <a href="/" class="btn btn-outline">Continue Shopping</a>
            <a href="/checkout" class="btn btn-success">Checkout</a>
          </div>
        </div>
      ` : `
        <div style="text-align:center;padding:60px;color:#888;">
          <p style="font-size:48px;margin-bottom:16px;">&#128722;</p>
          <p style="font-size:18px;margin-bottom:24px;">Your cart is empty</p>
          <a href="/" class="btn">Start Shopping</a>
        </div>
      `}
    `, { cartCount }));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

app.post('/cart/update', async (req, res) => {
  try {
    const db = await getPool();
    const qty = parseInt(req.body.quantity) || 0;
    if (qty <= 0) {
      await db.execute('DELETE FROM cart_items WHERE id = ? AND session_id = ?', [req.body.item_id, req.sessionId]);
    } else {
      await db.execute('UPDATE cart_items SET quantity = ? WHERE id = ? AND session_id = ?', [qty, req.body.item_id, req.sessionId]);
    }
    res.redirect('/cart');
  } catch (err) { res.redirect('/cart'); }
});

app.post('/cart/remove', async (req, res) => {
  try {
    const db = await getPool();
    await db.execute('DELETE FROM cart_items WHERE id = ? AND session_id = ?', [req.body.item_id, req.sessionId]);
    res.redirect('/cart');
  } catch (err) { res.redirect('/cart'); }
});

// Checkout
app.get('/checkout', async (req, res) => {
  try {
    const db = await getPool();
    const [items] = await db.execute(
      'SELECT ci.*, p.name, p.price_cents FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.session_id = ?',
      [req.sessionId]
    );
    if (!items.length) return res.redirect('/cart');
    const total = items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
    const cartCount = items.reduce((s, i) => s + i.quantity, 0);

    const orderLines = items.map(i =>
      `<div class="order-line"><span>${i.name} x ${i.quantity}</span><span>${formatPrice(i.price_cents * i.quantity)}</span></div>`
    ).join('');

    res.send(layout('Checkout', `
      <h1 class="page-title" style="margin-bottom:24px;">Checkout</h1>
      <div class="checkout-grid">
        <div class="card">
          <h2 style="margin-bottom:20px;">Shipping Information</h2>
          <form method="POST" action="/checkout">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
              <div class="form-group"><label>Full Name</label><input type="text" name="name" required></div>
              <div class="form-group"><label>Email</label><input type="email" name="email" required></div>
            </div>
            <div class="form-group"><label>Address</label><input type="text" name="address_line" required placeholder="Street address"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
              <div class="form-group"><label>City</label><input type="text" name="city" required></div>
              <div class="form-group"><label>State</label><input type="text" name="state" required></div>
              <div class="form-group"><label>ZIP</label><input type="text" name="zip" required></div>
            </div>
            <button type="submit" class="btn btn-success" style="width:100%;margin-top:8px;">Place Order &mdash; ${formatPrice(total)}</button>
          </form>
        </div>
        <div class="order-summary">
          <h3>Order Summary</h3>
          ${orderLines}
          <div class="order-line total"><span>Total</span><span>${formatPrice(total)}</span></div>
        </div>
      </div>
    `, { cartCount }));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

app.post('/checkout', async (req, res) => {
  try {
    const db = await getPool();
    const { name, email, address_line, city, state, zip } = req.body;
    const address = `${address_line}, ${city}, ${state} ${zip}`;
    const [items] = await db.execute(
      'SELECT ci.*, p.price_cents, p.id as pid FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.session_id = ?',
      [req.sessionId]
    );
    if (!items.length) return res.redirect('/cart');
    const total = items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
    const [result] = await db.execute(
      'INSERT INTO orders (customer_name, customer_email, address, total_cents, status) VALUES (?, ?, ?, ?, ?)',
      [name, email, address, total, 'confirmed']
    );
    for (const item of items) {
      await db.execute('INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES (?, ?, ?, ?)',
        [result.insertId, item.pid, item.quantity, item.price_cents]);
    }
    await db.execute('DELETE FROM cart_items WHERE session_id = ?', [req.sessionId]);
    res.redirect(`/order/${result.insertId}`);
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

app.get('/order/:id', async (req, res) => {
  try {
    const db = await getPool();
    const [orders] = await db.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!orders.length) return res.status(404).send(layout('Not Found', '<p>Order not found.</p>'));
    const order = orders[0];

    res.send(layout('Order Confirmed', `
      <div class="confirmation">
        <div class="checkmark">&#10003;</div>
        <h1>Order Confirmed!</h1>
        <p>Thank you, ${order.customer_name}. Your order #${order.id} has been placed.</p>
        <p style="margin-top:8px;font-size:14px;">A confirmation email will be sent to ${order.customer_email}.</p>
        <p style="margin-top:24px;"><strong>Total: ${formatPrice(order.total_cents)}</strong></p>
        <a href="/" class="btn" style="margin-top:24px;">Continue Shopping</a>
      </div>
    `));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

// =====================
// ADMIN ROUTES
// =====================
app.get('/admin/login', (req, res) => {
  const error = req.query.error ? '<div class="alert alert-error">Invalid password.</div>' : '';
  res.send(layout('Admin Login', `
    <div class="login-box"><h1>Store Admin</h1>${error}
    <form method="POST" action="/admin/login">
      <div class="form-group"><label>Password</label><input type="password" name="password" required autofocus></div>
      <button type="submit" class="btn" style="width:100%;">Log In</button>
    </form></div>`, { isAdmin: true }));
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('store_admin', '1', { httpOnly: true, maxAge: 86400000, sameSite: 'strict' });
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

app.get('/admin/logout', (req, res) => {
  res.clearCookie('store_admin');
  res.redirect('/admin/login');
});

// Admin: products
app.get('/admin', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    const [products] = await db.execute('SELECT * FROM products ORDER BY created_at DESC');
    const success = req.query.success || '';

    const rows = products.map(p => `<tr>
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>${formatPrice(p.price_cents)}</td>
      <td>${p.in_stock ? '<span class="in-stock">Yes</span>' : '<span class="out-of-stock">No</span>'}</td>
      <td style="display:flex;gap:8px;">
        <a href="/admin/products/${p.id}/edit" class="btn btn-sm btn-outline">Edit</a>
        <form method="POST" action="/admin/products/${p.id}/delete" style="display:inline;" onsubmit="return confirm('Delete?')">
          <button type="submit" class="btn btn-sm btn-danger">Delete</button>
        </form>
      </td>
    </tr>`).join('');

    res.send(layout('Products', `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h1 class="page-title">Products</h1>
        <a href="/admin/products/new" class="btn btn-sm">Add Product</a>
      </div>
      ${success ? `<div class="alert alert-success">${success}</div>` : ''}
      <table class="admin-table">
        <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>In Stock</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`, { isAdmin: true }));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

app.get('/admin/products/new', adminAuth, (req, res) => {
  res.send(layout('New Product', productForm({}), { isAdmin: true }));
});

app.post('/admin/products', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    const { name, description, price, category, in_stock } = req.body;
    const slug = slugify(name);
    const priceCents = Math.round(parseFloat(price) * 100);
    await db.execute('INSERT INTO products (name, slug, description, price_cents, category, in_stock) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, description, priceCents, category, in_stock === 'on' ? 1 : 0]);
    res.redirect('/admin?success=Product+created');
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

app.get('/admin/products/:id/edit', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    const [products] = await db.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!products.length) return res.redirect('/admin');
    res.send(layout('Edit Product', productForm({ product: products[0], isEdit: true }), { isAdmin: true }));
  } catch (err) { res.redirect('/admin'); }
});

app.post('/admin/products/:id', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    const { name, description, price, category, in_stock } = req.body;
    const slug = slugify(name);
    const priceCents = Math.round(parseFloat(price) * 100);
    await db.execute('UPDATE products SET name=?, slug=?, description=?, price_cents=?, category=?, in_stock=? WHERE id=?',
      [name, slug, description, priceCents, category, in_stock === 'on' ? 1 : 0, req.params.id]);
    res.redirect('/admin?success=Product+updated');
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

app.post('/admin/products/:id/delete', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    await db.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.redirect('/admin?success=Product+deleted');
  } catch (err) { res.redirect('/admin'); }
});

function productForm({ product, isEdit }) {
  const p = product || {};
  const price = p.price_cents ? (p.price_cents / 100).toFixed(2) : '';
  return `
    <h1 class="page-title">${isEdit ? 'Edit Product' : 'New Product'}</h1>
    <form method="POST" action="${isEdit ? `/admin/products/${p.id}` : '/admin/products'}" style="max-width:600px;margin-top:24px;">
      <div class="form-group"><label>Name</label><input type="text" name="name" value="${p.name || ''}" required></div>
      <div class="form-group"><label>Description</label><textarea name="description" rows="4">${p.description || ''}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group"><label>Price ($)</label><input type="number" name="price" value="${price}" step="0.01" min="0" required></div>
        <div class="form-group"><label>Category</label><input type="text" name="category" value="${p.category || ''}" required></div>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" name="in_stock" id="in_stock" ${p.in_stock !== 0 ? 'checked' : ''}>
        <label for="in_stock" style="margin:0;">In Stock</label>
      </div>
      <div style="display:flex;gap:12px;margin-top:20px;">
        <button type="submit" class="btn">${isEdit ? 'Update' : 'Create'} Product</button>
        <a href="/admin" class="btn" style="background:#888;">Cancel</a>
      </div>
    </form>`;
}

// Admin: orders
app.get('/admin/orders', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    const [orders] = await db.execute('SELECT * FROM orders ORDER BY created_at DESC');

    const rows = orders.map(o => `<tr>
      <td>#${o.id}</td>
      <td>${o.customer_name}</td>
      <td>${o.customer_email}</td>
      <td>${formatPrice(o.total_cents)}</td>
      <td><span class="badge badge-${o.status}">${o.status}</span></td>
      <td>${new Date(o.created_at).toLocaleDateString()}</td>
      <td>
        <form method="POST" action="/admin/orders/${o.id}/status" style="display:flex;gap:4px;">
          <select name="status" style="padding:4px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;">
            <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
            <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>Shipped</option>
            <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>Delivered</option>
            <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
          <button type="submit" class="btn btn-sm btn-outline">Update</button>
        </form>
      </td>
    </tr>`).join('');

    res.send(layout('Orders', `
      <h1 class="page-title" style="margin-bottom:24px;">Orders</h1>
      <table class="admin-table">
        <thead><tr><th>ID</th><th>Customer</th><th>Email</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#888;padding:32px;">No orders yet.</td></tr>'}</tbody>
      </table>`, { isAdmin: true }));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

app.post('/admin/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const db = await getPool();
    await db.execute('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
    res.redirect('/admin/orders');
  } catch (err) { res.redirect('/admin/orders'); }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// =====================
// START
// =====================
async function start() {
  try { await migrate(); } catch (err) { console.error('[startup] Migration failed:', err.message); }

  // Seed products
  if (process.env.DATABASE_URL) {
    try {
      const db = await getPool();
      const [products] = await db.execute('SELECT COUNT(*) as cnt FROM products');
      if (products[0].cnt === 0) {
        const seedProducts = [
          ['Wireless Headphones', 'wireless-headphones', 'Premium noise-cancelling wireless headphones with 30-hour battery life. Crystal clear audio with deep bass.', 7999, 'Electronics', 1],
          ['Smart Watch Pro', 'smart-watch-pro', 'Feature-packed smartwatch with health monitoring, GPS, and 5-day battery life.', 24999, 'Electronics', 1],
          ['USB-C Hub', 'usb-c-hub', '7-in-1 USB-C hub with HDMI, USB 3.0, SD card reader, and 100W power delivery.', 4999, 'Electronics', 1],
          ['Classic T-Shirt', 'classic-t-shirt', 'Soft cotton blend t-shirt in a relaxed fit. Available in multiple colors.', 2499, 'Clothing', 1],
          ['Denim Jacket', 'denim-jacket', 'Vintage-inspired denim jacket with a modern cut. Durable and stylish.', 8999, 'Clothing', 1],
          ['Running Shoes', 'running-shoes', 'Lightweight running shoes with responsive cushioning and breathable mesh upper.', 12999, 'Clothing', 0],
          ['Ceramic Mug Set', 'ceramic-mug-set', 'Set of 4 handcrafted ceramic mugs. Microwave and dishwasher safe.', 3499, 'Home', 1],
          ['Plant Pot Trio', 'plant-pot-trio', 'Modern minimalist plant pots in three sizes. Perfect for succulents and small plants.', 2999, 'Home', 1],
        ];
        for (const p of seedProducts) {
          await db.execute('INSERT INTO products (name, slug, description, price_cents, category, in_stock) VALUES (?, ?, ?, ?, ?, ?)', p);
        }

        // Seed orders
        await db.execute("INSERT INTO orders (customer_name, customer_email, address, total_cents, status) VALUES (?, ?, ?, ?, ?)",
          ['Jane Smith', 'jane@example.com', '123 Main St, Springfield, IL 62701', 12998, 'confirmed']);
        await db.execute("INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES (1, 1, 1, 7999)");
        await db.execute("INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES (1, 7, 1, 4999)");
        await db.execute("INSERT INTO orders (customer_name, customer_email, address, total_cents, status) VALUES (?, ?, ?, ?, ?)",
          ['Bob Johnson', 'bob@example.com', '456 Oak Ave, Portland, OR 97201', 24999, 'shipped']);
        await db.execute("INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES (2, 2, 1, 24999)");

        console.log('[seed] Products and orders created');
      }
    } catch (err) { console.error('[seed] Error:', err.message); }
  }

  app.listen(PORT, () => console.log(`Store running on port ${PORT}`));
}

start();
