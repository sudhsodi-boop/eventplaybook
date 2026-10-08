# Neon Database — Complete Setup From Scratch

**Goal of this whole guide:** end up with ONE piece of text called a *connection string*
(it starts with `postgresql://`). That string is the only thing you need from Neon — you'll
paste it into Render later as `DATABASE_URL`.

**What Neon is:** a free, permanent place on the internet that stores your app's data
(events, tasks, people, logins). Your app on Render "talks to" Neon using the connection
string. No credit card needed.

⏱️ About 5 minutes.

---

## Part 1 — Create your Neon account

1. Open your web browser and go to: **https://neon.tech**
2. Click the **Sign up** button (top-right).
3. Choose **Continue with Google** (easiest) — or sign up with an email + password.
4. If it asks a couple of setup questions (what you're building, etc.), pick anything /
   click **Skip**. It doesn't matter.

You're now on the Neon **Console** (the dashboard).

---

## Part 2 — Create a project (this also creates the database)

> On Neon, a "project" automatically contains a database inside it. You do NOT create the
> database separately.

1. If Neon didn't already start creating one, click **New Project** (or **Create project**).
2. You'll see a small form:
   - **Project name:** type anything, e.g. `shibir`
   - **Postgres version:** leave the default (don't change it).
   - **Region:** pick the one closest to you (e.g. *US East* or *US West* if you're in the
     USA). This only affects speed slightly — any choice works.
3. Click **Create project**.

Wait a few seconds. Neon builds your database and drops you on the project dashboard. ✅

---

## Part 3 — Copy the connection string (the important part ⭐)

This is the one thing you came here for.

1. On your project dashboard, look for a **Connect** button (usually top-right) — click it.
   - (If you don't see "Connect", look for a box already labeled **Connection string** on
     the dashboard — same thing.)
2. A panel opens showing a **connection string**. It looks like this (yours will have
   different names/numbers):

   ```
   postgresql://shibir_owner:npg_AbC123xyz@ep-cool-name-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

3. Make sure of two things in that panel:
   - There may be a dropdown for **Database** — leave it on the default (often `neondb`).
   - There may be a **"Show password" / pooled connection** toggle. The default string is
     fine. If there's a checkbox like **"Pooled connection"**, leaving it on is fine too.
4. Click the **Copy** button (a little clipboard icon) to copy the whole string.
5. **Paste it somewhere safe right now** so you don't lose it — open Notes / Notepad and
   paste it there for a minute.

### ✅ Check your string looks right
It MUST:
- start with `postgresql://`
- end with `?sslmode=require`
- be all on **one line**, with **no spaces** anywhere

> 🔒 Treat this string like a password — it contains the password to your database.
> Don't post it publicly or put it in your GitHub code. (In our setup it only ever gets
> pasted into Render's private "Environment Variables" box.)

---

## That's it for Neon! 🎉

You now have your connection string. You do **not** need to create tables, add columns, or
run anything inside Neon — **your app builds all of that automatically** the first time it
starts up. Neon just needs to exist and hand you that one string.

---

## What happens next (the other two pieces)

Neon is only 1 of 3 pieces. Here's where this fits:

1. ✅ **Neon** — done. Your database + connection string.
2. ⏭️ **GitHub** — holds your app's code (upload the unzipped `eventplaybook.zip`).
3. ⏭️ **Render** — runs the app. This is where you PASTE the Neon string.

### The one paste that matters (on Render, later)
When you set up (or fix) the app on Render, go to the **Environment** tab and add:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string you just copied |
| `JWT_SECRET` | any long random text, e.g. `shibir2027-secret-9f3k2xq7` |

Then **Save Changes**. Render restarts the app, the app connects to Neon, builds its tables,
seeds the demo data, and your link goes live. 🎯

(Full click-by-click for GitHub + Render is in `HOW-TO-DEPLOY-STEP-BY-STEP.md`. To keep the
app fast so it never sleeps, see `KEEP-IT-FAST-UPTIMEROBOT.md`.)

---

## Troubleshooting Neon

- **"I lost my connection string."** No problem — just go back to your Neon project and
  click **Connect** again. You can view/copy it any time. If it hides the password, click
  **Show password** or **Reset password** to get a fresh one (then update it on Render).
- **"There are several connection strings / a 'pooled' vs 'direct' one."** Either works for
  this app. If unsure, use the default one shown first.
- **"Which database name?"** Leave the default (usually `neondb`). Don't create extra ones.
- **"Do I need to create tables?"** No. The app creates everything automatically on first
  startup. An empty Neon database is exactly what you want.
- **"It says my project will sleep after inactivity."** That's normal for Neon's free tier —
  it wakes in a second or two. It is NOT the cause of the big slowness (that was Render).
