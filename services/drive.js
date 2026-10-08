const { google } = require('googleapis');
const { Readable } = require('stream');
const { getAuthClient } = require('./googleAuth');

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

let driveClient = null;
async function getClient() {
  if (driveClient) return driveClient;
  let auth;
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
    // Uploads as YOU (uses your Drive storage). Service accounts have no storage of their own.
    auth = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  } else {
    auth = await getAuthClient();
  }
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

// dataUrl looks like: data:image/jpeg;base64,/9j/4AAQ...
function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid image data');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

/**
 * Uploads a base64 image to the configured Drive folder, makes it publicly
 * viewable (needed so it renders on the public storefront), and returns
 * a directly embeddable image URL plus the Drive file ID.
 */
async function uploadImage(dataUrl, filenameHint = 'item') {
  if (!FOLDER_ID) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set. Add it to your environment variables.');
  }
  const drive = await getClient();
  const { mimeType, buffer } = parseDataUrl(dataUrl);
  const ext = mimeType.split('/')[1] || 'jpg';
  const name = `${filenameHint}-${Date.now()}.${ext}`;

  const res = await drive.files.create({
    requestBody: { name, parents: [FOLDER_ID] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
    supportsAllDrives: true // required for Shared Drives (harmless for normal folders)
  });
  const fileId = res.data.id;

  try {
    await drive.permissions.create({ fileId, supportsAllDrives: true, requestBody: { role: 'reader', type: 'anyone' } });
  } catch (err) {
    await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() => {});
    throw new Error("Could not make the photo public (your organization or Shared Drive may block link sharing). " + err.message);
  }

  const url = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  return { fileId, url };
}

async function deleteImage(fileId) {
  if (!fileId) return;
  try {
    const drive = await getClient();
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (err) {
    // Non-fatal: file may already be gone, or permissions changed. Log and move on.
    console.warn('Could not delete Drive file', fileId, err.message);
  }
}

module.exports = { uploadImage, deleteImage };
