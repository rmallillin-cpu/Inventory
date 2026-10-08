const CATEGORIES = ['All', 'Album', 'Photocard', 'Lightstick', 'Apparel', 'Accessory', 'Poster', 'Other'];
let allItems = [];
let activeCategory = 'All';
let cart = JSON.parse(localStorage.getItem('kpop_cart') || '[]');
let html5QrCode = null;
let sortMode = 'new';
let inStockOnly = false;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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


// ---------- Image slider (slide transition) + lightbox ----------

function makeSlider(host, urls, start, onChange) {
  let cur = start || 0, busy = false;
  const mk = src => { const i = document.createElement('img'); i.src = src; i.draggable = false; i.className = 'slide'; return i; };
  let img = mk(urls[cur]);
  host.prepend(img);
  function go(n, dir) {
    n = (n + urls.length) % urls.length;
    if (n === cur || busy) return;
    busy = true;
    dir = dir || (n > cur ? 1 : -1);
    const nxt = mk(urls[n]);
    nxt.style.transform = `translateX(${dir * 100}%)`; nxt.style.opacity = '0';
    host.prepend(nxt);
    void nxt.offsetWidth; // force reflow so the transition runs
    img.style.transform = `translateX(${-dir * 40}%) scale(.96)`; img.style.opacity = '0';
    nxt.style.transform = 'translateX(0)'; nxt.style.opacity = '1';
    const old = img; img = nxt; cur = n;
    if (onChange) onChange(cur);
    setTimeout(() => { old.remove(); busy = false; }, 400);
  }
  return { go, next: () => go(cur + 1, 1), prev: () => go(cur - 1, -1), get cur() { return cur; }, get img() { return img; } };
}

function openLightbox(urls, start, onClose) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<button class="lb-close" aria-label="Close">×</button><div class="lb-stage"></div>` +
    (urls.length > 1 ? `<button class="gal-nav lb-prev" style="left:12px">‹</button><button class="gal-nav lb-next" style="right:12px">›</button><span class="gal-count lb-count"></span>` : '') +
    `<span class="lb-hint">Tap photo to zoom</span>`;
  document.body.appendChild(lb);
  requestAnimationFrame(() => lb.classList.add('open'));
  const stage = lb.querySelector('.lb-stage');
  const count = lb.querySelector('.lb-count');
  const setCount = i => { if (count) count.textContent = `${i + 1} / ${urls.length}`; };
  const sl = makeSlider(stage, urls, start, i => { stage.classList.remove('zoomed'); setCount(i); });
  setCount(start);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    lb.classList.remove('open');
    setTimeout(() => lb.remove(), 300);
    if (onClose) onClose(sl.cur);
  };
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') sl.next(); if (e.key === 'ArrowLeft') sl.prev(); };
  document.addEventListener('keydown', onKey);
  lb.querySelector('.lb-close').addEventListener('click', close);
  lb.querySelector('.lb-prev')?.addEventListener('click', () => sl.prev());
  lb.querySelector('.lb-next')?.addEventListener('click', () => sl.next());
  lb.addEventListener('click', e => {
    if (e.target.classList.contains('slide')) stage.classList.toggle('zoomed');
    else if (e.target === lb || e.target === stage) close();
  });
  let x0 = null;
  lb.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (x0 === null || stage.classList.contains('zoomed')) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) (dx < 0 ? sl.next() : sl.prev());
    x0 = null;
  });
}

function flyToCart(fromEl) {
  const fab = document.getElementById('cartFab');
  if (!fromEl || !fab || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = fromEl.getBoundingClientRect(), b = fab.getBoundingClientRect();
  const clone = document.createElement('img');
  clone.src = fromEl.currentSrc || fromEl.src;
  clone.className = 'fly';
  Object.assign(clone.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.appendChild(clone);
  void clone.offsetWidth;
  clone.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(.08)`;
  clone.style.opacity = '.3';
  setTimeout(() => clone.remove(), 750);
}

// ---------- Sorting / filtering ----------

function viewItems() {
  let list = allItems.slice();
  if (inStockOnly) list = list.filter(i => i.stock > 0);
  const by = {
    new: (a, b) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')),
    plow: (a, b) => a.price - b.price,
    phigh: (a, b) => b.price - a.price,
    az: (a, b) => String(a.name).localeCompare(String(b.name))
  };
  return list.sort(by[sortMode] || by.new);
}
function refreshGrid() {
  const list = viewItems();
  const rc = document.getElementById('resultCount');
  if (rc) rc.textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
  renderGrid(list);
}
document.getElementById('sortSelect').addEventListener('change', e => { sortMode = e.target.value; refreshGrid(); });
document.getElementById('inStockOnly').addEventListener('change', e => { inStockOnly = e.target.checked; refreshGrid(); });

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
  grid.innerHTML = items.map((it, n) => `
    <div class="card reveal" data-id="${esc(it.id)}" style="--i:${Math.min(n, 14)}">
      <div class="card-media">
        ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy" onload="this.classList.add('loaded')">` : `<span class="placeholder">no image</span>`}${(it.images || []).length > 1 ? `<span class="photo-badge">📷 ${it.images.length}</span>` : ''}
        ${stockBadge(it.stock)}
      </div>
      <div class="card-body">
        <div class="card-cat">${esc(it.category || 'Merch')}</div>
        <div class="card-name">${esc(it.name)}</div>
        <div class="card-group">${esc(it.group || '')}</div>
        <div class="card-footer">
          <div class="card-price">${money(it.price)}</div>
          <button class="quick-add" data-add="${esc(it.id)}" aria-label="Add ${esc(it.name)} to cart" ${it.stock <= 0 ? 'disabled' : ''}>＋</button>
        </div>
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openItem(card.dataset.id));
  });
  grid.querySelectorAll('.quick-add').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const item = allItems.find(i => i.id === btn.dataset.add);
    if (item) addToCart(item, btn.closest('.card').querySelector('.card-media img'));
  }));
}

async function loadItems() {
  const search = document.getElementById('searchInput').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (activeCategory && activeCategory !== 'All') params.set('category', activeCategory);
  const grid = document.getElementById('grid');
  if (!allItems.length) grid.innerHTML = Array(6).fill('<div class="card skel"><div class="card-media"></div><div class="card-body"><div class="sk-line"></div><div class="sk-line short"></div></div></div>').join('');
  try {
    const res = await fetch('/api/items?' + params.toString());
    const data = await res.json();
    allItems = data.items || [];
    refreshGrid();
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
  clearInterval(window.galTimer);
  const urls = (item.images && item.images.length ? item.images.map(i => i.url) : (item.image ? [item.image] : []));
  const modal = document.getElementById('itemModal');
  const many = urls.length > 1;
  modal.innerHTML = `
    <button class="modal-close" onclick="closeOverlay('itemOverlay')" aria-label="Close">×</button>
    <div class="item-layout">
      <div class="item-gallery">
        <div class="card-media gal-main" id="galMain">
          ${urls.length ? '' : `<span class="placeholder">no image</span>`}
          ${many ? `<button class="gal-nav" id="galPrev" style="left:8px" aria-label="Previous photo">‹</button>
            <button class="gal-nav" id="galNext" style="right:8px" aria-label="Next photo">›</button>
            <span class="gal-count" id="galCount">1 / ${urls.length}</span>
            <div class="gal-dots" id="galDots">${urls.map((_, i) => `<i data-i="${i}" class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : ''}
          ${urls.length ? `<span class="gal-hint">🔍 Tap to enlarge</span>` : ''}
        </div>
        ${many ? `<div class="gal-thumbs">${urls.map((u, i) => `<img src="${esc(u)}" data-i="${i}" class="${i === 0 ? 'on' : ''}" alt="Photo ${i + 1}">`).join('')}</div>` : ''}
      </div>
      <div class="item-info">
        <div class="info-scroll">
          <div class="card-cat">${esc(item.category || 'Merch')}${item.group ? ' • ' + esc(item.group) : ''}</div>
          <h2 class="item-title">${esc(item.name)}</h2>
          <div class="row" style="margin:6px 0 12px;gap:10px;flex-wrap:wrap">
            <div class="card-price" style="font-size:22px">${money(item.price)}</div>
            ${stockBadge(item.stock).replace('class="badge ', 'class="badge static ')}
          </div>
          <p class="item-desc">${esc(item.description || 'No description yet.')}</p>
          <p class="mono dim" style="font-size:12px;margin:10px 0 0">SKU: ${esc(item.sku)}</p>
        </div>
        <div class="info-actions">
          <button class="btn btn-primary" id="addToCartBtn" ${item.stock <= 0 ? 'disabled' : ''}>Add to cart</button>
          <button class="btn btn-ghost" onclick="window.open('/api/items/${encodeURIComponent(item.id)}/qrcode','_blank')">QR tag</button>
        </div>
      </div>
    </div>
  `;
  if (urls.length) {
    const gm = document.getElementById('galMain');
    const count = document.getElementById('galCount');
    const dots = [...modal.querySelectorAll('.gal-dots i')];
    const thumbs = [...modal.querySelectorAll('.gal-thumbs img')];
    const sl = makeSlider(gm, urls, 0, i => {
      if (count) count.textContent = `${i + 1} / ${urls.length}`;
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
      thumbs.forEach((t, k) => t.classList.toggle('on', k === i));
      if (thumbs[i]) thumbs[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    let swipedAt = 0;
    const stopAuto = () => clearInterval(window.galTimer);
    gm.addEventListener('click', e => {
      if (e.target.closest('.gal-nav') || e.target.closest('.gal-dots') || Date.now() - swipedAt < 400) return;
      stopAuto();
      openLightbox(urls, sl.cur, i => sl.go(i));
    });
    if (many) {
      document.getElementById('galPrev').addEventListener('click', e => { e.stopPropagation(); stopAuto(); sl.prev(); });
      document.getElementById('galNext').addEventListener('click', e => { e.stopPropagation(); stopAuto(); sl.next(); });
      [...dots, ...thumbs].forEach(el => el.addEventListener('click', e => { e.stopPropagation(); stopAuto(); sl.go(+el.dataset.i); }));
      let x0 = null;
      gm.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; stopAuto(); }, { passive: true });
      gm.addEventListener('touchend', e => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) { swipedAt = Date.now(); dx < 0 ? sl.next() : sl.prev(); }
        x0 = null;
      });
      // gentle auto-slideshow until the shopper interacts or hovers
      let hover = false;
      gm.addEventListener('mouseenter', () => { hover = true; });
      gm.addEventListener('mouseleave', () => { hover = false; });
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.galTimer = setInterval(() => { if (!hover && !document.querySelector('.lightbox')) sl.next(); }, 4200);
      }
    }
  }
  document.getElementById('addToCartBtn')?.addEventListener('click', () => addToCart(item, document.querySelector('#galMain .slide')));
  document.getElementById('itemOverlay').style.display = 'flex';

  // support deep-linking via ?item=ID
  const url = new URL(window.location);
  url.searchParams.set('item', item.id);
  window.history.replaceState({}, '', url);
}

function closeOverlay(id) {
  if (id === 'itemOverlay') clearInterval(window.galTimer);
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

function addToCart(item, fromEl) {
  const existing = cart.find(l => l.id === item.id);
  if (existing) {
    if (existing.qty >= item.stock) { toast('No more stock available for this item', 'error'); return; }
    existing.qty += 1;
  } else {
    cart.push({ id: item.id, name: item.name, price: item.price, image: item.image, qty: 1, maxStock: item.stock });
  }
  saveCart();
  flyToCart(fromEl);
  const fab = document.getElementById('cartFab');
  fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump');
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
