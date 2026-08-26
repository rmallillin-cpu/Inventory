require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const path = require('path');

const sheets = require('./services/sheets');
const drive = require('./services/drive');
const requireAuth = require('./middleware/requireAuth');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json({ limit: '20mb' })); // generous limit to allow base64 photo uploads to Drive
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12 // 12 hours
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminHash = process.env.ADMIN_PASSWORD_HASH || '';

  if (!adminHash) {
    return res.status(500).json({ error: 'Server not configured: ADMIN_PASSWORD_HASH is missing.' });
  }
  if (username !== adminUser) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const ok = bcrypt.compareSync(password || '', adminHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.isAdmin = true;
  req.session.username = username;
  res.json({ success: true, username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin), username: req.session ? req.session.username : null });
});

// ---------- Items (public read) ----------

app.get('/api/items', async (req, res) => {
  try {
    const { search = '', category = '', group = '' } = req.query;
    const items = await sheets.searchItems({ search, category, group });
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load items', detail: err.message });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    const found = await sheets.findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: found.item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load item', detail: err.message });
  }
});

app.get('/api/items/:id/qrcode', async (req, res) => {
  try {
    const found = await sheets.findItemById(req.params.id);
    if (!found) return res.status(404).json({ error: 'Item not found' });
    const url = `${BASE_URL}/?item=${encodeURIComponent(found.item.id)}`;
    const png = await QRCode.toBuffer(url, { width: 400, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate QR code', detail: err.message });
  }
});

// ---------- Items (admin write) ----------

// If req.body.image is a fresh base64 data URL, upload it to Drive and swap
// it out for the resulting {url, fileId} before it ever touches the Sheet.
async function resolveIncomingImage(body, filenameHint) {
  if (body.image && body.image.startsWith('data:')) {
    const { url, fileId } = await drive.uploadImage(body.image, filenameHint);
    return { ...body, image: url, imageFileId: fileId };
  }
  return body;
}

app.post('/api/items', requireAuth, async (req, res) => {
  try {
    const body = await resolveIncomingImage(req.body || {}, (req.body && req.body.name) || 'item');
    const item = await sheets.createItem(body);
    res.status(201).json({ item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item', detail: err.message });
  }
});

app.put('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const existing = await sheets.findItemById(req.params.id);
    const body = await resolveIncomingImage(req.body || {}, (req.body && req.body.name) || 'item');

    // If a new photo replaced an old Drive-hosted one, clean up the old file
    if (existing && existing.item.imageFileId && body.image && body.image !== existing.item.image) {
      await drive.deleteImage(existing.item.imageFileId);
    }

    const item = await sheets.updateItem(req.params.id, body);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update item', detail: err.message });
  }
});

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const existing = await sheets.findItemById(req.params.id);
    const ok = await sheets.deleteItem(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Item not found' });
    if (existing && existing.item.imageFileId) {
      await drive.deleteImage(existing.item.imageFileId);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete item', detail: err.message });
  }
});

// ---------- Orders ----------

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, contact, address, items, notes } = req.body || {};
    if (!customerName || !contact || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'customerName, contact, and at least one item are required' });
    }
    const total = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const order = await sheets.createOrder({ customerName, contact, address, items, total, notes });
    res.status(201).json({ order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit order', detail: err.message });
  }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const rows = await sheets.getAllOrdersRaw();
    res.json({ orders: rows.map(r => r.order).reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load orders', detail: err.message });
  }
});

app.put('/api/orders/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    const order = await sheets.updateOrderStatus(req.params.id, status);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order', detail: err.message });
  }
});

// ---------- Boot ----------

app.get('/healthz', (req, res) => res.json({ ok: true }));

async function start() {
  try {
    await sheets.ensureSheetsExist();
    console.log('Google Sheet tabs verified/created.');
  } catch (err) {
    console.error('WARNING: could not verify Google Sheet setup. Check your credentials.', err.message);
  }
  app.listen(PORT, () => {
    console.log(`KPOP Inventory server running on port ${PORT}`);
    console.log(`BASE_URL = ${BASE_URL}`);
  });
}

start();
