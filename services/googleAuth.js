const { google } = require('googleapis');

let jwtClient = null;

async function getAuthClient() {
  if (jwtClient) return jwtClient;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const jwt = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    key,
    [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  );
  await jwt.authorize();
  jwtClient = jwt;
  return jwtClient;
}

module.exports = { getAuthClient };
