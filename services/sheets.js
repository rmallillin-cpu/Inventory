const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ITEMS_TAB = 'Items';
const ORDERS_TAB = 'Orders';

// Photos live in Google Drive now - the sheet stores a link + the Drive file ID (for cleanup on delete/replace)
const ITEMS_HEADER = ['ID', 'SKU', 'Name', 'Group', 'Category', 'Price', 'Stock', 'Description', 'ImageURL', 'ImageFileId', 'DateAdded'];
const ORDERS_HEADER = ['OrderID', 'Date', 'CustomerName', 'Contact', 'Address', 'ItemsJSON', 'Total', 'Status', 'Notes'];

let sheetsClient = null;
let cache = { items: null, itemsAt: 0 };
const CACHE_TTL_MS = 15000; // short cache to avoid hammering the Sheets API

async function getClient() {
  if (sheetsClient) return sheetsClient;
  const auth = await getAuthClient();
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function ensureSheetsExist() {
  const sheets = await getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existingTitles = meta.data.sheets.map(s => s.properties.title);

  const requests = [];
  if (!existingTitles.includes(ITEMS_TAB)) {
    requests.push({ addSheet: { properties: { title: ITEMS_TAB } } });
  }
  if (!existingTitles.includes(ORDERS_TAB)) {
    requests.push({ addSheet: { properties: { title: ORDERS_TAB } } });
  }
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
  }

  // Ensure headers
  const itemsHeaderRow = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${ITEMS_TAB}!A1:K1` });
  if (!itemsHeaderRow.data.values || itemsHeaderRow.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${ITEMS_TAB}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [ITEMS_HEADER] }
    });
  }
  const ordersHeaderRow = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${ORDERS_TAB}!A1:I1` });
  if (!ordersHeaderRow.data.values || ordersHeaderRow.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${ORDERS_TAB}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [ORDERS_HEADER] }
    });
  }
}

function rowToItem(row) {
  return {
    id: row[0] || '',
    sku: row[1] || '',
    name: row[2] || '',
    group: row[3] || '',
    category: row[4] || '',
    price: parseFloat(row[5]) || 0,
    stock: parseInt(row[6], 10) || 0,
    description: row[7] || '',
    image: row[8] || '',
    imageFileId: row[9] || '',
    dateAdded: row[10] || ''
  };
}

function itemToRow(item) {
  return [
    item.id, item.sku, item.name, item.group, item.category,
    item.price, item.stock, item.description, item.image || '', item.imageFileId || '', item.dateAdded
  ];
}

async function getAllItemsRaw() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${ITEMS_TAB}!A2:K` });
  const rows = res.data.values || [];
  return rows.map((row, idx) => ({ rowNumber: idx + 2, item: rowToItem(row) }));
}

async function getAllItems({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.items && now - cache.itemsAt < CACHE_TTL_MS) {
    return cache.items;
  }
  const rows = await getAllItemsRaw();
  cache.items = rows;
  cache.itemsAt = now;
  return rows;
}

function invalidateCache() {
  cache.items = null;
}

async function searchItems({ search = '', category = '', group = '' } = {}) {
  const rows = await getAllItems();
  const q = search.trim().toLowerCase();
  return rows
    .map(r => r.item)
    .filter(it => {
      if (category && it.category.toLowerCase() !== category.toLowerCase()) return false;
      if (group && it.group.toLowerCase() !== group.toLowerCase()) return false;
      if (!q) return true;
      const hay = `${it.name} ${it.sku} ${it.group} ${it.category} ${it.description} ${it.id}`.toLowerCase();
      return hay.includes(q);
    });
}

async function findItemById(id) {
  const rows = await getAllItems();
  return rows.find(r => r.item.id === id) || null;
}

async function createItem(data) {
  const sheets = await getClient();
  const id = 'ITM' + Date.now().toString(36).toUpperCase();
  const sku = data.sku && data.sku.trim() ? data.sku.trim() : id;
  const item = {
    id,
    sku,
    name: data.name || '',
    group: data.group || '',
    category: data.category || '',
    price: data.price || 0,
    stock: data.stock || 0,
    description: data.description || '',
    image: data.image || '',
    imageFileId: data.imageFileId || '',
    dateAdded: new Date().toISOString()
  };
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${ITEMS_TAB}!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [itemToRow(item)] }
  });
  invalidateCache();
  return item;
}

async function updateItem(id, data) {
  const found = await findItemById(id);
  if (!found) return null;
  const sheets = await getClient();
  const merged = { ...found.item, ...data, id: found.item.id, dateAdded: found.item.dateAdded };
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${ITEMS_TAB}!A${found.rowNumber}:K${found.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [itemToRow(merged)] }
  });
  invalidateCache();
  return merged;
}

async function deleteItem(id) {
  const found = await findItemById(id);
  if (!found) return false;
  const sheets = await getClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === ITEMS_TAB);
  const sheetId = sheet.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: found.rowNumber - 1,
            endIndex: found.rowNumber
          }
        }
      }]
    }
  });
  invalidateCache();
  return true;
}

async function adjustStock(id, delta) {
  const found = await findItemById(id);
  if (!found) return null;
  const newStock = Math.max(0, (found.item.stock || 0) + delta);
  return updateItem(id, { stock: newStock });
}

// ---- Orders ----

function rowToOrder(row) {
  let items = [];
  try { items = JSON.parse(row[5] || '[]'); } catch (e) { items = []; }
  return {
    id: row[0] || '',
    date: row[1] || '',
    customerName: row[2] || '',
    contact: row[3] || '',
    address: row[4] || '',
    items,
    total: parseFloat(row[6]) || 0,
    status: row[7] || 'Pending',
    notes: row[8] || ''
  };
}

function orderToRow(order) {
  return [
    order.id, order.date, order.customerName, order.contact, order.address,
    JSON.stringify(order.items || []), order.total, order.status, order.notes || ''
  ];
}

async function getAllOrdersRaw() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${ORDERS_TAB}!A2:I` });
  const rows = res.data.values || [];
  return rows.map((row, idx) => ({ rowNumber: idx + 2, order: rowToOrder(row) }));
}

async function createOrder(data) {
  const sheets = await getClient();
  const id = 'ORD' + Date.now().toString(36).toUpperCase();
  const order = {
    id,
    date: new Date().toISOString(),
    customerName: data.customerName || '',
    contact: data.contact || '',
    address: data.address || '',
    items: data.items || [],
    total: data.total || 0,
    status: 'Pending',
    notes: data.notes || ''
  };
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${ORDERS_TAB}!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [orderToRow(order)] }
  });

  // decrement stock for each ordered item; report movements so the caller can audit-log them
  order.movements = [];
  for (const line of order.items) {
    if (line.id && line.qty) {
      const upd = await adjustStock(line.id, -Math.abs(line.qty));
      if (upd) order.movements.push({ itemId: upd.id, itemName: upd.name, delta: -Math.abs(line.qty), newStock: upd.stock });
    }
  }
  return order;
}

async function updateOrderStatus(id, status) {
  const rows = await getAllOrdersRaw();
  const found = rows.find(r => r.order.id === id);
  if (!found) return null;
  const sheets = await getClient();
  const merged = { ...found.order, status, prevStatus: found.order.status };
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${ORDERS_TAB}!A${found.rowNumber}:I${found.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [orderToRow(merged)] }
  });
  return merged;
}

module.exports = {
  ensureSheetsExist,
  getAllItems,
  searchItems,
  findItemById,
  createItem,
  updateItem,
  deleteItem,
  adjustStock,
  getAllOrdersRaw,
  createOrder,
  updateOrderStatus
};
