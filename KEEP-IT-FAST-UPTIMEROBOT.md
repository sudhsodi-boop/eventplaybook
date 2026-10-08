# Keep EventPlaybook Fast & Awake (Free) — UptimeRobot Setup

**The problem:** On Render's free plan, your app "falls asleep" after ~15 minutes with
no visitors. The next person to open it then waits **30–60 seconds** while it wakes up.
That's the slowness you saw — it is NOT a bug in the app.

**The fix:** A free service called **UptimeRobot** visits your app every 5 minutes,
so Render thinks someone is always using it and never lets it sleep. Result: your app
stays fast, it stays **100% free**, and you don't move anything or enter a credit card.

⏱️ Takes about 5 minutes. No coding.

---

## Before you start — get your app's web address

1. Open your app on **Render** (the dashboard for your `eventplaybook` service).
2. At the top you'll see the URL, something like:

   ```
   https://eventplaybook-xxxx.onrender.com
   ```

3. Copy it. Your special "health check" address is that URL with **`/api/health`** on the end:

   ```
   https://eventplaybook-xxxx.onrender.com/api/health
   ```

   👉 Paste that full address into your browser once. You should see a tiny message like
   `{"status":"ok", ...}`. That confirms the target works. (This page is deliberately
   tiny and fast — the perfect thing to ping.)

> Note: the improved app now includes this `/api/health` page. Make sure you've uploaded
> the latest `eventplaybook.zip` to GitHub so Render has it (see the deploy guide). If
> `/api/health` shows "Not Found", re-upload the code first, then come back here.

---

## Part 1 — Create a free UptimeRobot account

1. Go to **https://uptimerobot.com**
2. Click **Sign Up / Register** (free plan — no credit card).
3. Enter your email + a password, confirm your email if it asks.
4. You'll land on the **Dashboard**.

---

## Part 2 — Add a monitor (this is the "pinger")

1. Click the **+ New monitor** (or **Add New Monitor**) button.
2. Fill in the form:

   | Field | What to put |
   |---|---|
   | **Monitor Type** | **HTTP(s)** |
   | **Friendly Name** | `EventPlaybook keep-awake` (any name) |
   | **URL (or IP)** | your health address, e.g. `https://eventplaybook-xxxx.onrender.com/api/health` |
   | **Monitoring Interval** | **every 5 minutes** |

3. Leave everything else at its default.
4. Click **Create Monitor** (or **Save**).

That's it! UptimeRobot now quietly visits your app every 5 minutes, 24/7.

---

## Part 3 — Confirm it's working

1. On the UptimeRobot dashboard, your new monitor should show a green **Up** status
   within a minute or two.
2. **The real test:** don't touch your app for ~30 minutes, then open it. It should load
   quickly instead of taking 30–60 seconds. (The very first load after you set this up may
   still be slow because it was already asleep — after that it stays warm.)

---

## What to expect

- ✅ **Fast for your team** almost all the time — no more long waits.
- ✅ **Still free** — UptimeRobot's free plan allows up to 50 monitors at 5-minute checks.
- ✅ **Nothing to maintain** — set it once and forget it.

### Honest caveats
- Render's free plan gives **750 hours/month** of running time. Keeping the app awake
  24/7 uses about 720 of those — so **one** always-on free app fits, but you can't keep
  two free apps awake this way at the same time.
- Very rarely Render still restarts a free service (routine maintenance). If someone hits
  it in that exact moment they may see one slow load. This is uncommon.
- If you ever want *guaranteed* instant, always-on with no caveats, that's the Render
  **Starter plan ($7/month)** — but for a team planning tool, the free + pinger setup
  here is usually all you need.

---

## Troubleshooting

- **Monitor shows "Down" / red:** double-check the URL is exactly right and ends in
  `/api/health`. Open that address in your browser — if it doesn't load, the app itself
  isn't running (check Render's Logs tab), so fix that first.
- **App still slow after setting this up:** wait ~15 minutes for the ping cycle to take
  effect, then test again. The first wake-up after setup is still slow; later ones aren't.
- **"Not Found" at /api/health:** you're running an older copy of the code. Upload the
  latest `eventplaybook.zip` contents to GitHub, let Render redeploy, then retry.
