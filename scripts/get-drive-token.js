// Run once on your PC:  npm run drive-token
// Prints a refresh token so the server can upload photos to YOUR Google Drive.
require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');

const id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!id || !secret) {
  console.error('Put GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in a .env file first.');
  process.exit(1);
}
const redirect = 'http://localhost:3333/oauth2callback';
const oauth = new google.auth.OAuth2(id, secret, redirect);
const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive'] });
console.log('\nOpen this link in your browser and allow access:\n\n' + url + '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) { res.end(); return; }
  const code = new URL(req.url, redirect).searchParams.get('code');
  try {
    const { tokens } = await oauth.getToken(code);
    res.end('Done. You can close this tab and go back to the terminal.');
    console.log('\nGOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
    if (!tokens.refresh_token) console.log('No refresh token returned. Remove the app at myaccount.google.com/permissions and run again.');
  } catch (e) { res.end('Failed: ' + e.message); console.error(e.message); }
  server.close();
});
server.listen(3333);
