// Users + stock-movement audit log, stored as extra tabs in the same Google Sheet.
const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TABS = {
  Users: ['Username', 'PasswordHash', 'Role', 'Active', 'CreatedAt', 'MustChange', 'Pending'],
  Movements: ['Date', 'ItemID', 'ItemName', 'Delta', 'NewStock', 'Reason', 'User']
};
let client = null;
async function api() {
  if (!client) client = google.sheets({ version: 'v4', auth: await getAuthClient() });
  return client;
}

async function ensure() {
  const s = await api();
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const have = meta.data.sheets.map(x => x.properties.title);
  const add = Object.keys(TABS).filter(t => !have.includes(t)).map(title => ({ addSheet: { properties: { title } } }));
  if (add.length) await s.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: add } });
  for (const [tab, header] of Object.entries(TABS)) {
    const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A1:G1` });
    if (!r.data.values || !r.data.values.length || r.data.values[0].length < header.length) {
      await s.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${tab}!A1`, valueInputOption: 'RAW', requestBody: { values: [header] } });
    }
  }
}

async function rows(tab) {
  const s = await api();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A2:G` });
  return (r.data.values || []).map((row, i) => ({ rowNumber: i + 2, row }));
}
const toUser = ({ rowNumber, row }) => ({
  rowNumber, username: row[0] || '', hash: row[1] || '', role: row[2] === 'admin' ? 'admin' : 'staff',
  active: String(row[3]).toUpperCase() !== 'FALSE', createdAt: row[4] || '',
  mustChange: String(row[5]).toUpperCase() === 'TRUE', pending: String(row[6]).toUpperCase() === 'TRUE'
});
const userRow = u => [u.username, u.hash, u.role, u.active ? 'TRUE' : 'FALSE', u.createdAt, u.mustChange ? 'TRUE' : 'FALSE', u.pending ? 'TRUE' : 'FALSE'];

async function listUsers() { return (await rows('Users')).map(toUser); }

async function addUser({ username, hash, role, active = true, mustChange = false, pending = false }) {
  const s = await api();
  const u = { username, hash, role, active, mustChange, pending, createdAt: new Date().toISOString() };
  await s.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: 'Users!A2', valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS', requestBody: { values: [userRow(u)] }
  });
  return u;
}

async function updateUser(username, patch) {
  const found = (await listUsers()).find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!found) return null;
  const merged = { ...found, ...patch };
  const s = await api();
  await s.spreadsheets.values.update({
    spreadsheetId: SHEET_ID, range: `Users!A${found.rowNumber}:G${found.rowNumber}`,
    valueInputOption: 'RAW', requestBody: { values: [userRow(merged)] }
  });
  return merged;
}

async function logMovement(m) {
  const s = await api();
  await s.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: 'Movements!A2', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[new Date().toISOString(), m.itemId, m.itemName, m.delta, m.newStock, m.reason || '', m.user || '']] }
  });
}

async function listMovements(limit = 200) {
  const all = await rows('Movements');
  return all.slice(-limit).reverse().map(({ row }) => ({
    date: row[0], itemId: row[1], itemName: row[2], delta: Number(row[3]) || 0,
    newStock: Number(row[4]) || 0, reason: row[5] || '', user: row[6] || ''
  }));
}

module.exports = { ensure, listUsers, addUser, updateUser, logMovement, listMovements };
