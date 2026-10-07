require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const path = require('path');

const sheets = require('./services/sheets');
const drive = require('./services/drive');
const store = require('./services/store');
const requireAuth = require('./middleware/requireAuth');

const app = express();
app.set('trust proxy', 1); // Render terminates HTTPS at a proxy; needed for secure session cookies
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const LOW_STOCK = Number(process.env.LOW_STOCK_THRESHOLD) || 5;
const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Completed', 'Cancelled'];

app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn, msg) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    console.error(err);
    res.status(500).json({ error: msg, detail: err.message });
  }
};
const who = req => req.session.username;
const logMove = (item, delta, reason, user) =>
  store.logMovement({ itemId: item.id, itemName: item.name, delta, newStock: item.stock, reason, user })
    .catch(e => console.warn('movement log failed:', e.message));

// ---------- Auth (env super-admin + Users sheet accounts) ----------

const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const isLimited = ip => { const a = attempts.get(ip); return a && a.n >= 8 && Date.now() - a.t < WINDOW; };
const noteFail = ip => {
  const a = attempts.get(ip), now = Date.now();
  attempts.set(ip, !a || now - a.t >= WINDOW ? { n: 1, t: now } : { n: a.n + 1, t: a.t });
};

app.post('/api/login', async (req, res) => {
  const ip = req.ip;
  if (isLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username = '', password = '' } = req.body || {};
  const envUser = process.env.ADMIN_USERNAME || 'admin';
  const envHash = process.env.ADMIN_PASSWORD_HASH || '';
  let account = null;
  try {
    if (envHash && username === envUser) {
      if (bcrypt.compareSync(password, envHash)) account = { username: envUser, role: 'admin', env: true };
    } else {
      const u = (await store.listUsers()).find(x => x.active && !x.pending && x.username.toLowerCase() === username.toLowerCase());
      if (u && bcrypt.compareSync(password, u.hash)) account = { username: u.username, role: u.role, mustChange: u.mustChange };
      const p = (await store.listUsers()).find(x => x.pending && x.username.toLowerCase() === username.toLowerCase());
      if (!account && p && bcrypt.compareSync(password, p.hash)) {
        return res.status(403).json({ error: 'Your request is waiting for admin approval.' });
      }
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login unavailable. Check server configuration.' });
  }
  if (!account) { noteFail(ip); return res.status(401).json({ error: 'Invalid username or password' }); }
  attempts.delete(ip);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.username = account.username;
    req.session.role = account.role;
    req.session.mustChange = !!account.mustChange;
    req.session.env = !!account.env;
    res.json({ success: true, username: account.username, role: account.role, mustChange: !!account.mustChange });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get('/api/session', (req, res) => {
  const s = req.session || {};
  res.json({ isAdmin: !!s.username, username: s.username || null, role: s.role || null, mustChange: !!s.mustChange, env: !!s.env });
});

// ---------- Sign-up requests & password change ----------

const tempPassword = () => crypto.randomBytes(9).toString('base64url');
const signups = new Map();
app.post('/api/signup', wrap(async (req, res) => {
  const ip = req.ip, now = Date.now(), a = signups.get(ip);
  if (a && a.n >= 5 && now - a.t < 60 * 60 * 1000) return res.status(429).json({ error: 'Too many requests. Try again later.' });
  signups.set(ip, !a || now - a.t >= 60 * 60 * 1000 ? { n: 1, t: now } : { n: a.n + 1, t: a.t });
  const { username = '', password = '' } = req.body || {};
  if (!/^[a-z0-9_.-]{3,30}$/i.test(username)) return res.status(400).json({ error: 'Username: 3-30 letters, numbers, . _ -' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const taken = username.toLowerCase() === (process.env.ADMIN_USERNAME || 'admin').toLowerCase() ||
    (await store.listUsers()).some(u => u.username.toLowerCase() === username.toLowerCase());
  if (taken) return res.status(409).json({ error: 'That username is taken' });
  // Always staff, always inactive until an admin approves.
  await store.addUser({ username, hash: bcrypt.hashSync(password, 10), role: 'staff', active: false, pending: true });
  res.status(201).json({ success: true });
}, 'Failed to submit request'));

app.post('/api/change-password', wrap(async (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.env) return res.status(400).json({ error: 'The owner password is set in Render (ADMIN_PASSWORD_HASH).' });
  const { currentPassword = '', newPassword = '' } = req.body || {};
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a different password' });
  const u = (await store.listUsers()).find(x => x.username.toLowerCase() === req.session.username.toLowerCase());
  if (!u || !bcrypt.compareSync(currentPassword, u.hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  await store.updateUser(u.username, { hash: bcrypt.hashSync(newPassword, 10), mustChange: false });
  req.session.mustChange = false;
  res.json({ success: true });
}, 'Failed to change password'));

// ---------- Users (admin only) ----------

app.get('/api/users', requireAuth.admin, wrap(async (req, res) => {
  const users = (await store.listUsers()).map(({ hash, rowNumber, ...u }) => u);
  res.json({ users, envAdmin: process.env.ADMIN_USERNAME || 'admin' });
}, 'Failed to load users'));

app.post('/api/users', requireAuth.admin, wrap(async (req, res) => {
  const { username = '', role = 'staff' } = req.body || {};
  const generated = !(req.body || {}).password;
  const password = generated ? tempPassword() : req.body.password;
  if (!/^[a-z0-9_.-]{3,30}$/i.test(username)) return res.status(400).json({ error: 'Username: 3-30 letters, numbers, . _ -' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const taken = username.toLowerCase() === (process.env.ADMIN_USERNAME || 'admin').toLowerCase() ||
    (await store.listUsers()).some(u => u.username.toLowerCase() === username.toLowerCase());
  if (taken) return res.status(409).json({ error: 'Username already exists' });
  await store.addUser({ username, hash: bcrypt.hashSync(password, 10), role, mustChange: true });
  res.status(201).json({ success: true, tempPassword: generated ? password : undefined });
}, 'Failed to create user'));

app.put('/api/users/:username', requireAuth.admin, wrap(async (req, res) => {
  const { password, role, active } = req.body || {};
  const patch = {};
  let generated = null;
  if (password !== undefined) {
    const pw = password === '' ? (generated = tempPassword()) : String(password);
    if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    patch.hash = bcrypt.hashSync(pw, 10);
    patch.mustChange = true; // an admin-set password is temporary
  }
  if (role !== undefined) { if (!['admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' }); patch.role = role; }
  if (active !== undefined) { patch.active = !!active; if (active) patch.pending = false; }
  const self = req.params.username.toLowerCase() === who(req).toLowerCase();
  if (self && (patch.active === false || (patch.role && patch.role !== 'admin'))) {
    return res.status(400).json({ error: "You can't deactivate or demote your own account" });
  }
  const u = await store.updateUser(req.params.username, patch);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, tempPassword: generated || undefined });
}, 'Failed to update user'));

// ---------- Items ----------

app.get('/api/items', wrap(async (req, res) => {
  const { search = '', category = '', group = '' } = req.query;
  res.json({ items: await sheets.searchItems({ search, category, group }) });
}, 'Failed to load items'));

app.get('/api/items/:id', wrap(async (req, res) => {
  const found = await sheets.findItemById(req.params.id);
  if (!found) return res.status(404).json({ error: 'Item not found' });
  res.json({ item: found.item });
}, 'Failed to load item'));

app.get('/api/items/:id/qrcode', wrap(async (req, res) => {
  const found = await sheets.findItemById(req.params.id);
  if (!found) return res.status(404).json({ error: 'Item not found' });
  const png = await QRCode.toBuffer(`${BASE_URL}/?item=${encodeURIComponent(found.item.id)}`, { width: 400, margin: 2 });
  res.set('Content-Type', 'image/png');
  res.send(png);
}, 'Failed to generate QR code'));

async function resolveIncomingImage(body, hint) {
  const clean = {
    ...body,
    price: Math.max(0, Number(body.price) || 0),
    stock: Math.max(0, parseInt(body.stock, 10) || 0)
  };
  if (clean.image && clean.image.startsWith('data:')) {
    const { url, fileId } = await drive.uploadImage(clean.image, hint);
    return { ...clean, image: url, imageFileId: fileId };
  }
  return clean;
}

app.post('/api/items', requireAuth, wrap(async (req, res) => {
  const body = await resolveIncomingImage(req.body || {}, (req.body && req.body.name) || 'item');
  const item = await sheets.createItem(body);
  if (item.stock > 0) logMove(item, item.stock, 'Initial stock', who(req));
  res.status(201).json({ item });
}, 'Failed to create item'));

app.put('/api/items/:id', requireAuth, wrap(async (req, res) => {
  const existing = await sheets.findItemById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const body = await resolveIncomingImage(req.body || {}, (req.body && req.body.name) || 'item');
  if (existing.item.imageFileId && body.image && body.image !== existing.item.image) {
    await drive.deleteImage(existing.item.imageFileId);
  }
  const item = await sheets.updateItem(req.params.id, body);
  const delta = item.stock - existing.item.stock;
  if (delta) logMove(item, delta, 'Edited in admin', who(req));
  res.json({ item });
}, 'Failed to update item'));

app.post('/api/items/:id/adjust', requireAuth, wrap(async (req, res) => {
  const delta = parseInt((req.body || {}).delta, 10);
  if (!delta) return res.status(400).json({ error: 'Enter a non-zero whole number' });
  const found = await sheets.findItemById(req.params.id);
  if (!found) return res.status(404).json({ error: 'Item not found' });
  if (found.item.stock + delta < 0) return res.status(400).json({ error: 'Stock cannot go below 0' });
  const item = await sheets.adjustStock(req.params.id, delta);
  logMove(item, delta, String(req.body.reason || 'Manual adjustment').slice(0, 100), who(req));
  res.json({ item });
}, 'Failed to adjust stock'));

app.delete('/api/items/:id', requireAuth.admin, wrap(async (req, res) => {
  const existing = await sheets.findItemById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  await sheets.deleteItem(req.params.id);
  if (existing.item.imageFileId) await drive.deleteImage(existing.item.imageFileId);
  logMove({ ...existing.item, stock: 0 }, -existing.item.stock, 'Item deleted', who(req));
  res.json({ success: true });
}, 'Failed to delete item'));

// ---------- Orders ----------

app.post('/api/orders', wrap(async (req, res) => {
  const { customerName, contact, address, items, notes } = req.body || {};
  if (!customerName || !contact || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customerName, contact, and at least one item are required' });
  }
  // Rebuild every line from server data: never trust client-sent prices, and refuse to oversell.
  const lines = [];
  for (const l of items) {
    const qty = Math.min(99, parseInt(l.qty, 10) || 0);
    const found = qty > 0 && (await sheets.findItemById(l.id));
    if (!found) return res.status(400).json({ error: 'An item in your cart is no longer available.' });
    if (found.item.stock < qty) {
      return res.status(409).json({ error: `Only ${found.item.stock} left of ${found.item.name}.` });
    }
    lines.push({ id: found.item.id, name: found.item.name, price: found.item.price, qty, image: found.item.image });
  }
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const order = await sheets.createOrder({
    customerName: String(customerName).slice(0, 120), contact: String(contact).slice(0, 120),
    address: String(address || '').slice(0, 300), items: lines, total, notes: String(notes || '').slice(0, 500)
  });
  (order.movements || []).forEach(m => logMove({ id: m.itemId, name: m.itemName, stock: m.newStock }, m.delta, `Order ${order.id}`, 'customer'));
  delete order.movements;
  res.status(201).json({ order });
}, 'Failed to submit order'));

app.get('/api/orders', requireAuth, wrap(async (req, res) => {
  res.json({ orders: (await sheets.getAllOrdersRaw()).map(r => r.order).reverse() });
}, 'Failed to load orders'));

app.put('/api/orders/:id/status', requireAuth, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const order = await sheets.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Cancelling returns stock to inventory; re-opening a cancelled order takes it out again.
  const cancelling = status === 'Cancelled' && order.prevStatus !== 'Cancelled';
  const reopening = status !== 'Cancelled' && order.prevStatus === 'Cancelled';
  if (cancelling || reopening) {
    for (const l of order.items) {
      const delta = cancelling ? Math.abs(l.qty) : -Math.abs(l.qty);
      const item = await sheets.adjustStock(l.id, delta);
      if (item) logMove(item, delta, `${cancelling ? 'Cancelled' : 'Reopened'} order ${order.id}`, who(req));
    }
  }
  delete order.prevStatus;
  res.json({ order });
}, 'Failed to update order'));

// ---------- Dashboard, audit log, exports ----------

app.get('/api/stats', requireAuth, wrap(async (req, res) => {
  const items = (await sheets.getAllItems()).map(r => r.item);
  const orders = (await sheets.getAllOrdersRaw()).map(r => r.order);
  const live = orders.filter(o => o.status !== 'Cancelled');
  const byCategory = {}, sold = {};
  items.forEach(i => { const k = i.category || 'Other'; byCategory[k] = (byCategory[k] || 0) + i.stock; });
  live.forEach(o => o.items.forEach(l => { sold[l.name] = (sold[l.name] || 0) + (l.qty || 0); }));
  const slim = i => ({ id: i.id, name: i.name, stock: i.stock });
  res.json({
    lowThreshold: LOW_STOCK,
    itemCount: items.length,
    units: items.reduce((s, i) => s + i.stock, 0),
    retailValue: items.reduce((s, i) => s + i.price * i.stock, 0),
    outOfStock: items.filter(i => i.stock === 0).map(slim),
    lowStock: items.filter(i => i.stock > 0 && i.stock <= LOW_STOCK).map(slim),
    pendingOrders: orders.filter(o => o.status === 'Pending').length,
    revenue: orders.filter(o => o.status === 'Completed').reduce((s, o) => s + o.total, 0),
    openOrderValue: orders.filter(o => ['Pending', 'Confirmed', 'Shipped'].includes(o.status)).reduce((s, o) => s + o.total, 0),
    byCategory,
    topSellers: Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }))
  });
}, 'Failed to load stats'));

app.get('/api/movements', requireAuth, wrap(async (req, res) => {
  res.json({ movements: await store.listMovements(200) });
}, 'Failed to load stock history'));

const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function sendCsv(res, name, header, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('\ufeff' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
}
app.get('/api/export/items.csv', requireAuth, wrap(async (req, res) => {
  const items = (await sheets.getAllItems({ forceRefresh: true })).map(r => r.item);
  sendCsv(res, 'inventory.csv', ['ID', 'SKU', 'Name', 'Group', 'Category', 'Price', 'Stock', 'Description'],
    items.map(i => [i.id, i.sku, i.name, i.group, i.category, i.price, i.stock, i.description]));
}, 'Export failed'));
app.get('/api/export/orders.csv', requireAuth, wrap(async (req, res) => {
  const orders = (await sheets.getAllOrdersRaw()).map(r => r.order);
  sendCsv(res, 'orders.csv', ['OrderID', 'Date', 'Customer', 'Contact', 'Address', 'Items', 'Total', 'Status', 'Notes'],
    orders.map(o => [o.id, o.date, o.customerName, o.contact, o.address, o.items.map(l => `${l.qty}x ${l.name}`).join('; '), o.total, o.status, o.notes]));
}, 'Export failed'));

// ---------- Boot ----------

app.get('/healthz', (req, res) => res.json({ ok: true }));

async function start() {
  try {
    await sheets.ensureSheetsExist();
    await store.ensure();
    console.log('Google Sheet tabs verified/created.');
  } catch (err) {
    console.error('WARNING: could not verify Google Sheet setup. Check your credentials.', err.message);
  }
  app.listen(PORT, () => console.log(`Thea server running on port ${PORT}\nBASE_URL = ${BASE_URL}`));
}
start();
