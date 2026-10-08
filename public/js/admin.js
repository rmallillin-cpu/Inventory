let editingId = null;
let pendingImages = []; // [{url, fileId}] - first is the main photo
let uploading = false;
let role = 'staff';
let allItems = [];
let lowThreshold = 5;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) checkSession();
  if (!res.ok) throw new Error(data.detail ? `${data.error}: ${data.detail}` : (data.error || 'Request failed'));
  return data;
}

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

// ---------- Session / login ----------

let me = {};
async function checkSession() {
  const data = await (await fetch('/api/session')).json();
  me = data;
  const on = !!data.isAdmin;
  role = data.role || 'staff';
  const forced = on && data.mustChange;
  document.getElementById('loginScreen').style.display = on ? 'none' : 'block';
  document.getElementById('dashboard').style.display = on && !forced ? 'block' : 'none';
  document.getElementById('changeScreen').style.display = forced ? 'block' : 'none';
  document.getElementById('logoutBtn').style.display = on ? 'inline-flex' : 'none';
  document.getElementById('pwBtn').style.display = on && !forced && !data.env ? 'inline-flex' : 'none';
  document.getElementById('usersChip').style.display = role === 'admin' && !forced ? 'inline-flex' : 'none';
  document.getElementById('whoami').textContent = on ? `${data.username} (${role})` : '';
  if (forced) openChange(true);
  else if (on) showTab('dashboard');
}

function openChange(forced) {
  document.getElementById('changeTitle').textContent = forced ? 'Set a new password' : 'Change password';
  document.getElementById('changeNote').textContent = forced ? 'You are using a temporary password. Choose your own to continue.' : '';
  document.getElementById('cpCancel').style.display = forced ? 'none' : 'block';
  document.getElementById('cpOld').value = ''; document.getElementById('cpNew').value = '';
  document.getElementById('changeScreen').style.display = 'block';
  document.getElementById('dashboard').style.display = 'none';
}
document.getElementById('pwBtn').addEventListener('click', () => openChange(false));
document.getElementById('cpCancel').addEventListener('click', checkSession);
document.getElementById('cpBtn').addEventListener('click', async () => {
  try {
    await api('/api/change-password', 'POST', { currentPassword: cpOld.value, newPassword: cpNew.value });
    toast('Password changed', 'ok'); checkSession();
  } catch (err) { toast(err.message, 'error'); }
});
document.getElementById('showSignup').addEventListener('click', e => { e.preventDefault(); document.getElementById('signupBox').style.display = 'block'; });
document.getElementById('signupBtn').addEventListener('click', async () => {
  try {
    await api('/api/signup', 'POST', { username: suUser.value.trim(), password: suPass.value });
    suUser.value = ''; suPass.value = '';
    toast('Request sent. Wait for an admin to approve it.', 'ok');
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Logging in...';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    checkSession();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  checkSession();
});

// ---------- Tabs ----------

const TABS = { dashboard: loadDashboard, items: loadAdminItems, orders: loadOrders, movements: loadMovements, users: loadUsers };
function showTab(tab) {
  document.querySelectorAll('.chip[data-tab]').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
  Object.keys(TABS).forEach(t => { document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none'; });
  TABS[tab]().catch(err => toast(err.message, 'error'));
}
document.querySelectorAll('.chip[data-tab]').forEach(chip => chip.addEventListener('click', () => showTab(chip.dataset.tab)));

// ---------- Dashboard ----------

async function loadDashboard() {
  const s = await api('/api/stats');
  lowThreshold = s.lowThreshold;
  const tile = (label, val, warn) => `<div class="card" style="padding:14px"><div class="dim" style="font-size:12px">${label}</div>
    <div class="mono" style="font-size:22px;margin-top:4px;${warn ? 'color:#ff6b81' : ''}">${val}</div></div>`;
  document.getElementById('statTiles').innerHTML = [
    tile('Products', s.itemCount), tile('Units in stock', s.units), tile('Retail value of stock', money(s.retailValue)),
    tile('Pending orders', s.pendingOrders, s.pendingOrders > 0), tile('Open order value', money(s.openOrderValue)),
    tile('Completed revenue', money(s.revenue)), tile('Low stock (≤' + s.lowThreshold + ')', s.lowStock.length, s.lowStock.length > 0),
    tile('Out of stock', s.outOfStock.length, s.outOfStock.length > 0)
  ].join('');
  const list = (title, rows, fmt) => `<div class="card" style="padding:14px"><strong>${title}</strong><div class="stack" style="gap:4px;margin-top:8px">
    ${rows.length ? rows.map(fmt).join('') : '<span class="dim" style="font-size:13px">Nothing here 🎉</span>'}</div></div>`;
  document.getElementById('statLists').innerHTML =
    list('Needs restocking', [...s.outOfStock, ...s.lowStock], i => `<div style="font-size:13px">${esc(i.name)} <span class="mono dim">— ${i.stock} left</span></div>`) +
    list('Top sellers', s.topSellers, t => `<div style="font-size:13px">${esc(t.name)} <span class="mono dim">— ${t.qty} sold</span></div>`) +
    list('Stock by category', Object.entries(s.byCategory), ([k, v]) => `<div style="font-size:13px">${esc(k)} <span class="mono dim">— ${v} units</span></div>`);
}

// ---------- Items ----------

async function loadAdminItems() {
  allItems = (await api('/api/items')).items || [];
  renderItems();
}

function renderItems() {
  const q = document.getElementById('invSearch').value.trim().toLowerCase();
  const f = document.getElementById('invFilter').value;
  const items = allItems.filter(i =>
    (!q || `${i.name} ${i.sku} ${i.group} ${i.category}`.toLowerCase().includes(q)) &&
    (!f || (f === 'out' ? i.stock === 0 : i.stock > 0 && i.stock <= lowThreshold)));
  const grid = document.getElementById('adminGrid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="big">✧</div><div>${allItems.length ? 'No items match.' : 'No items yet. Add your first one.'}</div></div>`;
    return;
  }
  grid.innerHTML = items.map(it => {
    const color = it.stock === 0 ? '#ff6b81' : it.stock <= lowThreshold ? '#ffb347' : 'inherit';
    return `<div class="card" data-id="${esc(it.id)}">
      <div class="card-media">${it.image ? `<img src="${esc(it.image)}">` : `<span class="placeholder">no image</span>`}</div>
      <div class="card-body">
        <div class="card-cat">${esc(it.category || 'Merch')}</div>
        <div class="card-name">${esc(it.name)}</div>
        <div class="card-group">${esc(it.group || '')}</div>
        <div class="card-footer">
          <div class="card-price">${money(it.price)}</div>
          <span class="mono" style="font-size:12px;color:${color}">stock: ${it.stock}</span>
        </div>
        <button class="btn btn-ghost btn-sm adjBtn" data-id="${esc(it.id)}" style="margin-top:8px;width:100%;justify-content:center">± Adjust stock</button>
      </div></div>`;
  }).join('');
  grid.querySelectorAll('.card').forEach(card => card.addEventListener('click', () => openEditor(allItems.find(i => i.id === card.dataset.id))));
  grid.querySelectorAll('.adjBtn').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const delta = parseInt(prompt('Change in stock (e.g. 10 to add, -2 to remove):'), 10);
    if (!delta) return;
    const reason = prompt('Reason (e.g. restock, damaged, sold in person):', 'Restock') || 'Manual adjustment';
    try { await api(`/api/items/${btn.dataset.id}/adjust`, 'POST', { delta, reason }); toast('Stock updated', 'ok'); loadAdminItems(); }
    catch (err) { toast(err.message, 'error'); }
  }));
}
document.getElementById('invSearch').addEventListener('input', renderItems);
document.getElementById('invFilter').addEventListener('change', renderItems);

document.getElementById('newItemBtn').addEventListener('click', () => openEditor(null));

function openEditor(item) {
  editingId = item ? item.id : null;
  pendingImages = item ? (item.images || []).map(i => ({ ...i })) : [];
  document.getElementById('editorTitle').textContent = item ? 'Edit item' : 'Add item';
  document.getElementById('fName').value = item ? item.name : '';
  document.getElementById('fGroup').value = item ? item.group : '';
  document.getElementById('fCategory').value = item ? item.category : 'Album';
  document.getElementById('fPrice').value = item ? item.price : '';
  document.getElementById('fStock').value = item ? item.stock : '';
  document.getElementById('fSku').value = item ? item.sku : '';
  document.getElementById('fDescription').value = item ? item.description : '';
  document.getElementById('deleteItemBtn').style.display = item && role === 'admin' ? 'inline-flex' : 'none';
  renderPhotoPreview();
  document.getElementById('editorOverlay').style.display = 'flex';
}

function closeEditor() {
  document.getElementById('editorOverlay').style.display = 'none';
}

function renderPhotoPreview() {
  const grid = document.getElementById('photoGrid');
  document.getElementById('photoCount').textContent = `(${pendingImages.length}/8)`;
  grid.innerHTML = pendingImages.map((im, i) => `
    <div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--surface-2);${i === 0 ? 'outline:2px solid var(--accent, #ff3caa)' : ''}">
      <img src="${esc(im.url)}" style="width:100%;height:100%;object-fit:cover">
      <button type="button" data-rm="${i}" style="position:absolute;top:3px;right:3px;border:0;border-radius:50%;width:22px;height:22px;background:#000a;color:#fff;cursor:pointer">×</button>
      ${i === 0 ? '<span style="position:absolute;left:4px;bottom:4px;font-size:10px;background:#000a;color:#fff;padding:1px 6px;border-radius:8px">MAIN</span>'
        : `<button type="button" data-main="${i}" style="position:absolute;left:4px;bottom:4px;font-size:10px;border:0;background:#000a;color:#fff;padding:1px 6px;border-radius:8px;cursor:pointer">★ main</button>`}
    </div>`).join('') || '<span class="dim" style="font-size:12px;grid-column:1/-1">No photos yet.</span>';
  grid.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { pendingImages.splice(+b.dataset.rm, 1); renderPhotoPreview(); }));
  grid.querySelectorAll('[data-main]').forEach(b => b.addEventListener('click', () => { pendingImages.unshift(pendingImages.splice(+b.dataset.main, 1)[0]); renderPhotoPreview(); }));
}

// Photos now upload to Google Drive (full quality), so we only need to keep
// the upload fast and under the request size limit — not squeeze into a Sheets cell.
function compressImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = height * (maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = width * (maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      let q = quality;
      let dataUrl = canvas.toDataURL('image/jpeg', q);
      // only shrink further if it's unreasonably large (keeps uploads snappy on mobile data)
      while (dataUrl.length > 8_000_000 && q > 0.3) {
        q -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', q);
      }
      resolve(dataUrl);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('photoInput').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, 8 - pendingImages.length);
  e.target.value = '';
  if (!files.length) { toast('Maximum of 8 photos', 'error'); return; }
  uploading = true;
  let done = 0;
  for (const file of files) {
    try {
      toast(`Uploading photo ${done + 1} of ${files.length}...`);
      const image = await compressImage(file);
      const r = await api('/api/upload-image', 'POST', { image });
      pendingImages.push({ url: r.url, fileId: r.fileId });
      done++; renderPhotoPreview();
    } catch (err) { toast(err.message, 'error'); }
  }
  uploading = false;
  if (done) toast(`${done} photo${done > 1 ? 's' : ''} added. Press Save item.`, 'ok');
});

document.getElementById('saveItemBtn').addEventListener('click', async () => {
  const payload = {
    name: document.getElementById('fName').value.trim(),
    group: document.getElementById('fGroup').value.trim(),
    category: document.getElementById('fCategory').value,
    price: parseFloat(document.getElementById('fPrice').value) || 0,
    stock: parseInt(document.getElementById('fStock').value, 10) || 0,
    sku: document.getElementById('fSku').value.trim(),
    description: document.getElementById('fDescription').value.trim(),
    images: pendingImages
  };
  if (!payload.name) { toast('Item name is required', 'error'); return; }
  if (uploading) { toast('Wait for photos to finish uploading', 'error'); return; }

  const btn = document.getElementById('saveItemBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const url = editingId ? `/api/items/${editingId}` : '/api/items';
    const method = editingId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail ? `${data.error}: ${data.detail}` : (data.error || 'Failed to save item'));
    toast('Item saved', 'ok');
    closeEditor();
    loadAdminItems();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save item';
  }
});

document.getElementById('deleteItemBtn').addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('Delete this item permanently?')) return;
  try {
    const res = await fetch(`/api/items/${editingId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete item');
    toast('Item deleted', 'ok');
    closeEditor();
    loadAdminItems();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- Orders ----------

async function loadOrders() {
  const orders = (await api('/api/orders')).orders || [];
  const host = document.getElementById('ordersList');
  if (!orders.length) {
    host.innerHTML = `<div class="empty-state"><div class="big">📦</div><div>No order requests yet.</div></div>`;
    return;
  }
  host.innerHTML = orders.map(o => `
    <div class="card" style="padding:16px;flex-direction:row;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px">
        <div class="row"><strong>${esc(o.customerName)}</strong><span class="dim">• ${esc(o.contact)}</span></div>
        <div class="dim" style="font-size:13px">${esc(o.address)}</div>
        <div class="mono dim" style="font-size:12px;margin:6px 0">${esc(o.id)} · ${new Date(o.date).toLocaleString()}</div>
        <div class="stack" style="gap:2px">${o.items.map(l => `<div style="font-size:13px">${esc(l.qty)}× ${esc(l.name)} — ${money(l.price * l.qty)}</div>`).join('')}</div>
        ${o.notes ? `<div class="dim" style="font-size:13px;margin-top:6px">Note: ${esc(o.notes)}</div>` : ''}
      </div>
      <div class="stack" style="align-items:flex-end;gap:8px">
        <div class="card-price">${money(o.total)}</div>
        <select data-id="${esc(o.id)}" class="orderStatus" style="background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 10px">
          ${['Pending', 'Confirmed', 'Shipped', 'Completed', 'Cancelled'].map(s => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>`).join('');
  host.querySelectorAll('.orderStatus').forEach(sel => sel.addEventListener('change', async () => {
    try {
      await api(`/api/orders/${sel.dataset.id}/status`, 'PUT', { status: sel.value });
      toast(sel.value === 'Cancelled' ? 'Order cancelled, stock returned' : 'Order status updated', 'ok');
    } catch (err) { toast(err.message, 'error'); loadOrders(); }
  }));
}

// ---------- Stock history ----------

async function loadMovements() {
  const list = (await api('/api/movements')).movements || [];
  document.getElementById('movementsList').innerHTML = list.length ? list.map(m => `
    <div class="card" style="padding:10px 14px;flex-direction:row;gap:12px;align-items:center;flex-wrap:wrap">
      <span class="mono" style="font-weight:700;min-width:44px;color:${m.delta < 0 ? '#ff6b81' : '#4cd98f'}">${m.delta > 0 ? '+' : ''}${m.delta}</span>
      <span style="flex:1;min-width:160px">${esc(m.itemName)} <span class="dim" style="font-size:12px">→ ${m.newStock} left · ${esc(m.reason)}</span></span>
      <span class="dim mono" style="font-size:11px">${esc(m.user)} · ${new Date(m.date).toLocaleString()}</span>
    </div>`).join('') : `<div class="empty-state"><div>No stock changes recorded yet.</div></div>`;
}

// ---------- Users (admin) ----------

async function loadUsers() {
  const { users, envAdmin } = await api('/api/users');
  const tag = u => u.pending ? ' · <strong style="color:#ffb347">awaiting approval</strong>' : (u.active ? '' : ' · disabled') + (u.mustChange ? ' · temp password' : '');
  const row = u => `<div class="card" style="padding:12px 14px;flex-direction:row;gap:10px;align-items:center;flex-wrap:wrap">
    <strong>${esc(u.username)}</strong><span class="dim" style="font-size:12px">${u.role}${tag(u)}</span><span class="spacer" style="flex:1"></span>
    ${u.pending ? `<button class="btn btn-primary btn-sm" data-act="approve" data-u="${esc(u.username)}">Approve</button>` : ''}
    <button class="btn btn-ghost btn-sm" data-act="role" data-u="${esc(u.username)}" data-v="${u.role === 'admin' ? 'staff' : 'admin'}">Make ${u.role === 'admin' ? 'staff' : 'admin'}</button>
    <button class="btn btn-ghost btn-sm" data-act="pass" data-u="${esc(u.username)}">Temp password</button>
    <button class="btn btn-ghost btn-sm" data-act="active" data-u="${esc(u.username)}" data-v="${u.active ? 'off' : 'on'}">${u.active ? 'Disable' : (u.pending ? 'Reject' : 'Enable')}</button></div>`;
  const host = document.getElementById('usersList');
  host.innerHTML = `<div class="card" style="padding:12px 14px"><strong>${esc(envAdmin)}</strong> <span class="dim" style="font-size:12px">owner admin (set in Render environment)</span></div>` + users.map(row).join('');
  host.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const u = b.dataset.u, body = {};
    if (b.dataset.act === 'approve') body.active = true;
    if (b.dataset.act === 'role') body.role = b.dataset.v;
    if (b.dataset.act === 'active') body.active = b.dataset.v === 'on';
    if (b.dataset.act === 'pass') { const pw = prompt(`Temporary password for ${u} (min 8 chars). Leave blank to auto-generate:`); if (pw === null) return; body.password = pw; }
    try {
      const r = await api(`/api/users/${encodeURIComponent(u)}`, 'PUT', body);
      if (r.tempPassword) prompt(`Temporary password for ${u} (copy it now, it is shown once):`, r.tempPassword);
      toast('Updated', 'ok'); loadUsers();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

document.getElementById('nuBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/users', 'POST', { username: nuName.value.trim(), password: nuPass.value, role: nuRole.value });
    if (r.tempPassword) prompt(`Temporary password for ${nuName.value.trim()} (copy it now, it is shown once):`, r.tempPassword);
    nuName.value = ''; nuPass.value = '';
    toast('Account created. They must change the password at first login.', 'ok'); loadUsers();
  } catch (err) { toast(err.message, 'error'); }
});

checkSession();
