# Deploy EventPlaybook to a permanent link (works on any phone/computer)

You'll get a URL like `https://eventplaybook-xxxx.onrender.com` that you and your
team can open anytime, from any device. Total time: ~10 minutes. Free.

The app **auto-seeds demo data on first boot**, so it works immediately — you can
sign in with `admin@example.com` / `password` right after it goes live.

---

## Recommended: Deploy on Render (free, no credit card)

### Step 1 — Get the code onto GitHub
1. Create a free account at **https://github.com** if you don't have one.
2. Click **+ (top right) → New repository**. Name it `eventplaybook`, keep it Public
   (or Private), click **Create repository**.
3. On the new repo page, click **"uploading an existing file"**.
4. **Unzip `eventplaybook.zip`** on your computer, then drag ALL the files/folders
   from inside it into the GitHub upload area. Click **Commit changes**.
   - Make sure `server/`, `public/`, `package.json`, and `render.yaml` are all there.
   - Do NOT upload `node_modules` or `data` (they aren't in the zip — good).

### Step 2 — Deploy on Render
1. Create a free account at **https://render.com** (sign in with GitHub — easiest).
2. Click **New + → Web Service**.
3. Connect your GitHub and pick the **eventplaybook** repo.
4. Render reads `render.yaml` automatically. If it asks, confirm:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `node server/index.js`
   - **Instance type:** Free
5. Click **Create Web Service** / **Deploy**.
6. Wait ~2–3 minutes for the build. When it says **"Live"**, click the URL at the
   top (like `https://eventplaybook-xxxx.onrender.com`).

### Step 3 — Use it
- Open that URL on your **phone or any computer**.
- Sign in: `admin@example.com` / `password`.
- Share the URL with your team. Each teammate clicks **Register** to make their own
  account. (An Admin can set everyone's role under **Settings**.)

---

## Important: data persistence on the free tier
Render's **free** tier has an ephemeral disk — the SQLite database **resets when the
service sleeps or redeploys** (free services sleep after ~15 min idle). That's fine for
demos/testing. For **permanent data**:

- **Option A (simplest):** upgrade the Render service to a paid **Starter** plan, then
  in `render.yaml` uncomment the `disk:` block and the `DATA_DIR=/var/data` env var,
  and redeploy. Your data will then persist on a 1 GB disk.
- **Option B:** switch the storage from SQLite to a hosted database (e.g. Postgres).
  Ask me and I'll convert it.

---

## Alternatives (if you prefer)

### Railway (very similar)
1. https://railway.app → **New Project → Deploy from GitHub repo**.
2. Pick the repo. Set start command `node server/index.js` if asked.
3. Add a variable `JWT_SECRET` = any long random string.
4. Railway gives you a public URL. (Add a Volume for persistent data.)

### Docker (any server / VPS you control)
A `Dockerfile` is included. On any machine with Docker:
```bash
docker build -t eventplaybook .
docker run -d -p 3000:3000 -e JWT_SECRET=change-me \
  -v eventplaybook-data:/app/data eventplaybook
```
Then open `http://<server-ip>:3000`. The `-v` volume keeps data permanent.

---

## Environment variables (all optional)
| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Port to listen on | `3000` |
| `JWT_SECRET` | Secret for login tokens — **set a long random value in production** | dev fallback |
| `DATA_DIR` | Where the SQLite DB + uploads are stored | `./data` |
| `NO_AUTO_SEED` | Set to `1` to skip demo-data seeding on first boot | (seeds if empty) |
