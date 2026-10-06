const CATEGORIES = ['All', 'Album', 'Photocard', 'Lightstick', 'Apparel', 'Accessory', 'Poster', 'Other'];
let allItems = [];
let activeCategory = 'All';
let cart = JSON.parse(localStorage.getItem('kpop_cart') || '[]');
let html5QrCode = null;

function toast(msg, type = '') {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function money(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function stockBadge(stock) {
  if (stock <= 0) return '<span class="badge out">Sold out</span>';
  if (stock <= 3) return `<span class="badge low">Only ${stock} left</span>`;
  return '<span class="badge in">In stock</span>';
}

function renderChips() {
  const host = document.getElementById('categoryChips');
  host.innerHTML = CATEGORIES.map(c =>
    `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${c}">${c}</button>`
  ).join('');
  host.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeCategory = chip.dataset.cat;
      renderChips();
      loadItems();
    });
  });
}

function renderGrid(items) {
  const grid = document.getElementById('grid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="big">✧</div>
      <div>No items match your search yet.</div>
    </div>`;
    return;
  }
  grid.innerHTML = items.map(it => `
    <div class="card" data-id="${it.id}">
      <div class="card-media">
        ${it.image ? `<img src="${it.image}" alt="${it.name}">` : `<span class="placeholder">no image</span>`}
        ${stockBadge(it.stock)}
      </div>
      <div class="card-body">
        <div class="card-cat">${it.category || 'Merch'}</div>
        <div class="card-name">${it.name}</div>
        <div class="card-group">${it.group || ''}</div>
        <div class="card-footer">
          <div class="card-price">${money(it.price)}</div>
        </div>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openItem(card.dataset.id));
  });
}

async function loadItems() {
  const search = document.getElementById('searchInput').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (activeCategory && activeCategory !== 'All') params.set('category', activeCategory);
  try {
    const res = await fetch('/api/items?' + params.toString());
    const data = await res.json();
    allItems = data.items || [];
    renderGrid(allItems);
  } catch (err) {
    toast('Could not load items. Check your connection.', 'error');
  }
}

let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadItems, 300);
});

// ---------- Item detail modal ----------

async function openItem(id) {
  try {
    const res = await fetch('/api/items/' + id);
    if (!res.ok) { toast('Item not found', 'error'); return; }
    const { item } = await res.json();
    showItemModal(item);
  } catch (err) {
    toast('Failed to load item', 'error');
  }
}

function showItemModal(item) {
  const modal = document.getElementById('itemModal');
  modal.innerHTML = `
    <button class="modal-close" onclick="closeOverlay('itemOverlay')">×</button>
    <div style="display:grid;grid-template-columns:1fr;gap:0">
      <div class="card-media" style="aspect-ratio:4/3;border-radius:20px 20px 0 0">
        ${item.image ? `<img src="${item.image}" alt="${item.name}">` : `<span class="placeholder">no image</span>`}
      </div>
      <div style="padding:22px">
        <div class="card-cat">${item.category || 'Merch'} • ${item.group || ''}</div>
        <h2 style="font-family:var(--font-display);margin:6px 0">${item.name}</h2>
        <div class="row" style="margin-bottom:10px">
          <div class="card-price" style="font-size:20px">${money(item.price)}</div>
          ${stockBadge(item.stock)}
        </div>
        <p class="dim" style="line-height:1.5">${item.description || 'No description yet.'}</p>
        <p class="mono dim" style="font-size:12px">SKU: ${item.sku}</p>
        <div class="row" style="margin-top:16px">
          <button class="btn btn-primary" id="addToCartBtn" ${item.stock <= 0 ? 'disabled' : ''}>Add to cart</button>
          <button class="btn btn-ghost" onclick="window.open('/api/items/${item.id}/qrcode','_blank')">View QR tag</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('addToCartBtn')?.addEventListener('click', () => addToCart(item));
  document.getElementById('itemOverlay').style.display = 'flex';

  // support deep-linking via ?item=ID
  const url = new URL(window.location);
  url.searchParams.set('item', item.id);
  window.history.replaceState({}, '', url);
}

function closeOverlay(id) {
  document.getElementById(id).style.display = 'none';
  if (id === 'itemOverlay') {
    const url = new URL(window.location);
    url.searchParams.delete('item');
    window.history.replaceState({}, '', url);
  }
}

// ---------- Cart ----------

function saveCart() {
  localStorage.setItem('kpop_cart', JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const badge = document.getElementById('cartCount');
  if (count > 0) { badge.style.display = 'flex'; badge.textContent = count; }
  else { badge.style.display = 'none'; }
}

function addToCart(item) {
  const existing = cart.find(l => l.id === item.id);
  if (existing) {
    if (existing.qty >= item.stock) { toast('No more stock available for this item', 'error'); return; }
    existing.qty += 1;
  } else {
    cart.push({ id: item.id, name: item.name, price: item.price, image: item.image, qty: 1, maxStock: item.stock });
  }
  saveCart();
  toast(`Added "${item.name}" to cart`, 'ok');
  closeOverlay('itemOverlay');
}

function changeQty(id, delta) {
  const line = cart.find(l => l.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) cart = cart.filter(l => l.id !== id);
  saveCart();
  renderCart();
}

function renderCart() {
  const modal = document.getElementById('cartModal');
  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);

  if (!cart.length) {
    modal.innerHTML = `
      <button class="modal-close" onclick="closeOverlay('cartOverlay')">×</button>
      <div class="empty-state">
        <div class="big">🛍️</div>
        <div>Your cart is empty.</div>
      </div>`;
    return;
  }

  modal.innerHTML = `
    <button class="modal-close" onclick="closeOverlay('cartOverlay')">×</button>
    <div style="padding:22px">
      <h2 style="font-family:var(--font-display);margin-top:0">Your cart</h2>
      <div id="cartLines">
        ${cart.map(l => `
          <div class="cart-line">
            ${l.image ? `<img src="${l.image}">` : `<div style="width:52px;height:52px;background:var(--surface-2);border-radius:8px"></div>`}
            <div class="info">
              <div style="font-weight:600">${l.name}</div>
              <div class="mono dim" style="font-size:13px">${money(l.price)}</div>
            </div>
            <div class="qty-control">
              <button onclick="changeQty('${l.id}',-1)">−</button>
              <span>${l.qty}</span>
              <button onclick="changeQty('${l.id}',1)">+</button>
            </div>
          </div>
        `).join('')}
      </div>
      <hr class="divider">
      <div class="row" style="justify-content:space-between;font-weight:700;font-size:17px">
        <span>Total</span><span class="mono">${money(total)}</span>
      </div>
      <hr class="divider">
      <h3 style="font-family:var(--font-display);margin-bottom:12px">Reserve this order</h3>
      <div class="field"><label>Full name</label><input id="custName" placeholder="Juan Dela Cruz"></div>
      <div class="field"><label>Contact number / Messenger / Instagram</label><input id="custContact" placeholder="09XX XXX XXXX or @handle"></div>
      <div class="field"><label>Shipping address (optional)</label><input id="custAddress" placeholder="City, Province"></div>
      <div class="field"><label>Notes (optional)</label><textarea id="custNotes" rows="2" placeholder="Preferred payment method, special requests..."></textarea></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center" id="submitOrderBtn">Submit order request</button>
      <p class="dim" style="font-size:12px;margin-top:10px">This reserves your items — no online payment is collected here. The shop owner will contact you to confirm payment and shipping.</p>
    </div>
  `;
  document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
}

async function submitOrder() {
  const customerName = document.getElementById('custName').value.trim();
  const contact = document.getElementById('custContact').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes = document.getElementById('custNotes').value.trim();

  if (!customerName || !contact) {
    toast('Please enter your name and contact info', 'error');
    return;
  }

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true; btn.textContent = 'Submitting...';

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName, contact, address, notes, items: cart })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit order');

    cart = [];
    saveCart();
    closeOverlay('cartOverlay');
    toast('Order request submitted! You will be contacted to confirm.', 'ok');
    loadItems();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Submit order request';
  }
}

document.getElementById('cartFab').addEventListener('click', () => {
  renderCart();
  document.getElementById('cartOverlay').style.display = 'flex';
});

// ---------- QR Scanner ----------

document.getElementById('scanBtn').addEventListener('click', openScanner);

function openScanner() {
  document.getElementById('scanOverlay').style.display = 'flex';
  html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 240 },
    (decodedText) => {
      let id = decodedText;
      try {
        const url = new URL(decodedText);
        id = url.searchParams.get('item') || decodedText;
      } catch (e) { /* not a URL, treat as raw ID/SKU */ }
      closeScanner();
      openItem(id);
    },
    () => {} // ignore per-frame scan failures
  ).catch(() => {
    toast('Could not access camera. Check browser permissions.', 'error');
  });
}

function closeScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
  }
  document.getElementById('scanOverlay').style.display = 'none';
}

// ---------- Init ----------

renderChips();
updateCartCount();
loadItems();

// deep link support
const params = new URLSearchParams(window.location.search);
if (params.get('item')) openItem(params.get('item'));
