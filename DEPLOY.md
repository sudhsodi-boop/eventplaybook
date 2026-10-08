# Deploy EventPlaybook to a permanent link (works on any phone/computer)

You'll get a URL like `https://eventplaybook-xxxx.onrender.com` that you and your
team can open anytime, from any device. Total time: ~15 minutes. **Free, and your
data is permanent** (it lives in a free hosted PostgreSQL database).

The app **auto-seeds demo data on first boot**, so it works immediately — you can
sign in with `admin@example.com` / `password` right after it goes live.

---

## The setup: Render (free web) + Neon (free Postgres)

EventPlaybook stores all its data in **PostgreSQL**. Render's free web service has
no permanent disk, so the database lives on **Neon** (a separate service with a
genuinely permanent free tier — no credit card, no 30-day expiry). This combo is
$0/month and your data survives restarts and redeploys.

### Step 1 — Create a free Postgres database on Neon
1. Go to **https://neon.tech** and sign up (free, no card).
2. Create a project (any name, e.g. `eventplaybook`). Pick the region closest to you.
3. On the project dashboard, find the **connection string**. It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. **Copy it** — you'll paste it into Render in Step 3. Keep it secret.

> Supabase (https://supabase.com) also works — use its "Connection string" from
> **Project Settings → Database**. Either provider is fine.

### Step 2 — Get the code onto GitHub
1. Create a free account at **https://github.com** if you don't have one.
2. Click **+ (top right) → New repository**. Name it `eventplaybook`, click **Create**.
3. On the new repo page, click **"uploading an existing file"**.
4. **Unzip `eventplaybook.zip`** on your computer, then drag ALL the files/folders
   from inside it into the GitHub upload area. Click **Commit changes**.
   - Make sure `server/`, `public/`, `package.json`, and `render.yaml` are all there.
   - Do NOT upload `node_modules` or `data` (they aren't in the zip — good).

### Step 3 — Deploy on Render
1. Create a free account at **https://render.com** (sign in with GitHub — easiest).
2. Click **New + → Web Service** and pick the **eventplaybook** repo.
3. Render reads `render.yaml` automatically. Confirm:
   - **Runtime:** Node · **Build:** `npm install` · **Start:** `node server/index.js`
   - **Instance type:** Free
4. **IMPORTANT — add your database.** Under **Environment**, add:
   - `DATABASE_URL` = the Neon connection string you copied in Step 1.
   - (`JWT_SECRET` is generated automatically; `NODE_ENV=production` is set for you.)
5. Click **Create Web Service** / **Deploy**.
6. Wait ~2–3 minutes. When it says **"Live"**, click the URL at the top.

### Step 4 — Use it
- Open that URL on your **phone or any computer**.
- Sign in: `admin@example.com` / `password`.
- Share the URL with your team. Each teammate clicks **Register** to make their own
  account. (An Admin can set everyone's role under **Settings** — including the new
  **Approver** role for the Vatsalya schedule-approval step.)

---

## 🔒 Data safety notes

- **Your data is permanent** as long as `DATABASE_URL` points at your Neon/Supabase
  database. That database persists independently of the Render web service.
- **The demo data seeds only once** — on the very first boot, when the database is
  empty. After that your real data is never overwritten.
- **Free-tier caps:** Neon/Supabase free tiers give ~0.5 GB storage and pause idle
  compute (a first request after a quiet period may take a few seconds to wake).
  That's plenty for planning a Shibir. If you ever outgrow it, upgrading is a paid
  toggle on Neon — no code change needed.
- **Automatic backups:** the app writes a JSON snapshot of every table to
  `DATA_DIR/backups/` shortly after startup and every few hours (keeps the latest
  14). Admins can also, in **Settings → Backup & Data Safety**: **Back Up Now**,
  **Download** any snapshot, or download a full JSON export.
- **Set a strong `JWT_SECRET`.** Render generates one automatically. If self-hosting,
  set your own long random string; in `NODE_ENV=production` the app refuses to start
  with the insecure default.

---

## Running locally (for development)

You need a PostgreSQL database. Either install Postgres locally, or point at your
Neon URL:

```bash
npm install
export DATABASE_URL='postgresql://user:pass@host/dbname?sslmode=require'
export JWT_SECRET='dev-secret-change-me'
npm start        # http://localhost:3000  (auto-seeds demo data on first run)
npm run seed     # optional: wipe & re-seed demo data
```

If `DATABASE_URL` is not set, the app falls back to standard `PG*` environment
variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`).

---

## Docker (self-host on a VPS)

```bash
docker build -t eventplaybook .
docker run -d -p 3000:3000 \
  -e DATABASE_URL='postgresql://user:pass@host/dbname?sslmode=require' \
  -e JWT_SECRET='your-long-random-string' \
  -e NODE_ENV=production \
  -v eventplaybook-data:/app/data \
  eventplaybook
```

The volume keeps uploaded attachments and local backup snapshots; the primary data
lives in your Postgres database.
