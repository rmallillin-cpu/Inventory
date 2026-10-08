# Thea — Inventory & Storefront

A mobile-friendly inventory + storefront system for KPOP merchandise:

- **Google Sheets as your database** — no separate database to manage, edit stock directly in the sheet if you want
- **Google Drive for photos** — full-quality item photos are uploaded to a Drive folder you choose; the Sheet just stores the link
- **Storefront** — e‑commerce style product grid, keyword search, category filters, cart, and "order request" checkout (no payment gateway — you confirm payment manually with the buyer)
- **QR search** — every item gets a QR code; scanning it (with the built-in scanner or any phone camera) opens that item directly
- **Camera capture** — admin can snap a photo with their phone camera or upload one when adding an item
- **Admin login** — single admin account protects add/edit/delete and the orders dashboard
- **Deploys free on Render**, code lives on GitHub

---

## 1. How it's organized

```
kpop-inventory/
  server.js              Express server + all API routes
  services/sheets.js      All Google Sheets reads/writes
  middleware/requireAuth.js
  scripts/hash-password.js  helper to generate your admin password hash
  public/
    index.html / js/storefront.js   customer-facing storefront
    admin.html / js/admin.js        admin login + dashboard
    css/style.css                   shared design
```

The Google Sheet will automatically get two tabs created the first time the server starts:
- **Items** — ID, SKU, Name, Group, Category, Price, Stock, Description, ImageURL, ImageFileId, DateAdded
- **Orders** — OrderID, Date, CustomerName, Contact, Address, ItemsJSON, Total, Status, Notes

You never have to create these columns yourself — just create a blank sheet and share it (step 3 below). Photos themselves live in your Drive folder as full-quality files; the sheet only stores a link (`ImageURL`) and the Drive file's ID (`ImageFileId`, used internally to clean up the file if you delete or replace the photo).

---

## 2. Set up Google API access (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a new project (any name, e.g. "kpop-inventory").
2. Go to **APIs & Services → Library**, search **Google Sheets API**, click **Enable**. Then search **Google Drive API** and enable that too.
3. Go to **APIs & Services → Credentials → Create Credentials → Service account**. Give it any name, click through, no extra roles needed.
4. Open the new service account → **Keys** tab → **Add Key → Create new key → JSON**. This downloads a `.json` file — keep it safe, you'll need two values from it:
   - `client_email`
   - `private_key`
5. **Sheet:** create a new blank [Google Sheet](https://sheets.google.com) (or use an existing one). Copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_IS_THE_SHEET_ID`**`/edit`
   Click **Share** on the Sheet and share it with the `client_email` from the JSON key, as **Editor**.
6. **Drive folder:** create a folder in [Google Drive](https://drive.google.com) for your item photos (or use an existing one). Copy its ID from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_IS_THE_FOLDER_ID`**
   Click **Share** on the folder and share it with the same `client_email`, as **Editor**.

Both share steps are the ones people most often forget — without them, the app can't read/write your sheet or upload photos.

> **Privacy note:** to display photos on the public storefront without requiring buyers to log in to Google, each uploaded photo is automatically set to "anyone with the link can view." Don't use this folder for anything you want to keep private — treat it as public-facing, the same way product photos on any online shop are public.

---

## 3. Run it locally first (recommended)

You'll need [Node.js 18+](https://nodejs.org/) installed.

```bash
cd kpop-inventory
npm install
cp .env.example .env
```

Open `.env` and fill in:
- `GOOGLE_SHEET_ID` — from step 2.5
- `GOOGLE_DRIVE_FOLDER_ID` — from step 2.6
- `GOOGLE_CLIENT_EMAIL` — from the JSON key file
- `GOOGLE_PRIVATE_KEY` — from the JSON key file (keep the quotes and `\n` characters exactly as they appear)
- `SESSION_SECRET` — any random long string
- `BASE_URL` — `http://localhost:3000` for now

Generate your admin password:

```bash
npm run hash-password
```

It'll ask for a password and print something like `ADMIN_PASSWORD_HASH=$2a$10$...` — paste that whole line into `.env`, and set `ADMIN_USERNAME` to whatever you want.

Start the server:

```bash
npm start
```

Visit `http://localhost:3000` for the storefront and `http://localhost:3000/admin.html` to log in and add your first items.

---

## 4. Push the code to GitHub

Your repo: **https://github.com/rmallillin-cpu/Inventory**

### Option A — one-click script (Windows)

1. Unzip this project into a folder on your PC.
2. Double-click **`push-to-github.bat`** (included in this folder).
3. It will check that Git is installed, initialize the repo, commit everything, connect it to `https://github.com/rmallillin-cpu/Inventory.git`, and push.
4. If a browser window pops up asking you to log in to GitHub, sign in there — the script continues automatically after that.

If you don't have Git yet, install it first from [git-scm.com/download/win](https://git-scm.com/download/win), then run the script.

### Option B — manual (Mac/Linux/Windows, any terminal)

```bash
cd kpop-inventory
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/rmallillin-cpu/Inventory.git
git push -u origin main
```

If the remote repo isn't empty (e.g. it already has a README from GitHub's setup), you may need:
```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

Either way, your `.env` file is already excluded via `.gitignore` — your secrets (Google keys, admin password hash) never get committed. Good.

**After the first push**, any time you make changes: `git add .`, `git commit -m "..."`, `git push` (or just re-run the `.bat` script — it handles both first-time and repeat pushes).

---

## 5. Deploy on Render

1. Go to [render.com](https://render.com) → **New → Web Service** → connect your GitHub repo.
2. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free is fine to start
3. Under **Environment**, add every variable from your `.env` file (same names, same values) — including `GOOGLE_PRIVATE_KEY` exactly as-is (with the `\n` characters and surrounding quotes).
4. Set `BASE_URL` to the Render URL you'll be given, e.g. `https://kpop-inventory.onrender.com` (this is used to build the QR codes, so items scan correctly once live).
5. Set `NODE_ENV=production`.
6. Click **Create Web Service**. Render will build and deploy automatically, and redeploy on every push to `main`.

Once live, share the storefront link with buyers, and keep `/admin.html` for yourself.

---

### Admin accounts & roles
- The `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` in Render is the **owner admin**. Log in with it, open **Users**, and create more accounts.
- **Admin**: everything, including deleting items and managing accounts. **Staff**: add/edit items, adjust stock, handle orders.
- **Sign-up:** anyone can use *Request access* on the login page. The request stays disabled until an admin clicks **Approve** in Users. New sign-ups are always Staff.
- **Temporary passwords:** accounts created by an admin (or reset with *Temp password*) must set their own password at first login. Leave the password blank to auto-generate one.
- Accounts live in a `Users` tab and every stock change in a `Movements` tab of your Google Sheet. Keep that Sheet private to you and the service account.
- Cancelling an order returns its stock automatically. Set `LOW_STOCK_THRESHOLD` (default 5) to tune low-stock alerts.

## 6. Using it day to day

**Adding an item (as admin):**
1. Go to `/admin.html`, log in.
2. Click **+ Add item**.
3. Tap **Take / choose photo** — on a phone this opens the camera directly; on desktop it opens a file picker. The photo is compressed automatically so it fits in a Google Sheets cell.
4. Fill in name, group, category, price, stock, and save.
5. Open the item from the storefront and click **View QR tag** to get a printable QR code — stick it on the item's shelf, box, or sleeve. Scanning it (with the storefront's 📷 button or any phone camera) opens that exact item.

**Buyers:**
- Browse or search the storefront, add items to cart, and submit an order request with their name and contact info.
- This does **not** charge any card — it just reserves the order and logs it to your **Orders** tab / admin dashboard so you can follow up to collect payment (GCash, bank transfer, etc.) and arrange shipping.

**Stock:** decreases automatically when an order request is submitted. You can also edit stock manually anytime from the admin panel, or directly in the Google Sheet.

---

## 7. Limitations & good next upgrades

- **Photos are public-by-link in Drive** — required so they render on the storefront without buyers logging in. See the privacy note in step 2.
- **No online payment** — by design, per your request. Adding GCash/PayPal/Stripe checkout is a natural next step if needed.
- **Single admin account** — fine for one person running the shop. If you bring on staff later, this can be extended to multiple accounts with roles (e.g. staff can't delete items).
- **Sessions reset on server restart** (Render free tier can spin down when idle) — admins just log in again, no data is lost since everything lives in the Sheet.
