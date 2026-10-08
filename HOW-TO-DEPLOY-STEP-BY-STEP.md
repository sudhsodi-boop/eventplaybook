# 🚀 How to Put EventPlaybook Online — Beginner's Guide

**Goal:** By the end you'll have a web link (like `https://shibir-app.onrender.com`)
that you and your whole team can open from any phone or computer, anytime. Your data
is saved forever and it's completely **free**.

**Time:** about 15–20 minutes, going slowly.
**You do NOT need to know any coding.** You'll be clicking buttons on websites.

You'll create **3 free accounts** (no credit card):
1. **Neon** — stores your data (the database)
2. **GitHub** — stores the app's code
3. **Render** — runs the app and gives you the link

Do them in order. Take a break between steps if you need to. ☕

> 💡 **Tip:** Open this guide on one side of your screen and your web browser on the
> other, so you can read and click at the same one.

---

## ✅ Before you start: get the app file

1. In your workspace, find the file **`eventplaybook.zip`** and **download** it to your computer.
2. Find it in your Downloads folder and **unzip it** (right-click → "Extract All" on Windows,
   or double-click on Mac). You'll get a folder called **`eventplaybook`**.
3. Leave that folder open in a window — you'll need it in Part 2.

Keep a notepad handy (paper or a text file) to jot down one thing you'll copy later.

---

## PART 1 — Create the database (Neon) 🗄️

The database is where all your Shibir info lives. Neon gives you one for free, forever.

1. Go to **https://neon.tech**
2. Click **Sign Up** (top right). The easiest is **"Continue with Google"** — use any
   Google account. (No credit card is ever asked.)
3. After signing in, Neon asks you to **create a project**:
   - **Project name:** type anything, e.g. `shibir`
   - **Region:** pick the one closest to where most of your team is (e.g. "US East").
   - Click **Create project**.
4. Neon now shows a box labeled **Connection string** (sometimes under a "Connect" button).
   It's a long line that starts with `postgresql://` and looks like this:
   ```
   postgresql://myuser:AbC123xyz@ep-cool-lab-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Click the **Copy** button next to it. Then **paste it into your notepad** and save it.
   - ⚠️ This is like a password — don't share it publicly. We'll use it once in Part 3.

✅ **Part 1 done.** You have your connection string saved. Keep going.

---

## PART 2 — Upload the code (GitHub) 📦

GitHub is where the app's files live so Render can read them.

1. Go to **https://github.com** and click **Sign up** (skip if you already have an account).
   Follow the prompts (email, password, username). Verify your email if asked.
2. Once logged in, look at the **top-right corner**, click the **`+`** sign → **New repository**.
3. On the "Create a new repository" page:
   - **Repository name:** type `eventplaybook`
   - Leave everything else as-is (Public is fine).
   - Click the green **Create repository** button at the bottom.
4. On the next page you'll see some text. Find and click the blue link that says
   **"uploading an existing file"** (it's in a sentence in the middle of the page).
5. Now open the **`eventplaybook` folder** you unzipped earlier.
   - **Select everything INSIDE it** (the `server` folder, `public` folder, `package.json`,
     `render.yaml`, etc.). On Windows press **Ctrl+A**; on Mac press **Cmd+A**.
   - **Drag all of it** into the big dashed upload box on the GitHub page.
   - Wait for the files to finish uploading (you'll see them listed).
   - 💡 Make sure you dragged the *contents* of the folder, not the folder itself. You
     should see `server`, `public`, and `package.json` in the list — not a single
     `eventplaybook` folder.
6. Scroll to the bottom and click the green **Commit changes** button.

✅ **Part 2 done.** Your code is on GitHub. Keep going.

---

## PART 3 — Turn it on (Render) 🌐

Render runs the app and gives you the shareable link.

1. Go to **https://render.com** → click **Get Started** / **Sign Up**.
2. Choose **"Sign in with GitHub"** — this is the easiest, because it connects to the
   code you just uploaded. Approve any permission popup GitHub shows.
3. On the Render dashboard, click **New +** (top right) → **Web Service**.
4. Render shows your GitHub repositories. Find **eventplaybook** and click **Connect**
   next to it. (If you don't see it, click "Configure account" and allow Render to access it.)
5. Render reads the app's settings automatically. You'll see fields already filled in:
   - Name: `eventplaybook` (you can change it — this becomes part of your link)
   - Runtime: **Node**, Build Command: `npm install`, Start Command: `node server/index.js`
   - Instance Type: make sure **Free** is selected.
6. **⭐ THE MOST IMPORTANT STEP — add your database link:**
   - Scroll down to a section called **Environment Variables** (or "Advanced" → "Add
     Environment Variable").
   - Click **Add Environment Variable** and fill in:
     - **Key** (or "Name"):  `DATABASE_URL`
     - **Value:**  paste the **connection string** from your notepad (Part 1, step 5).
   - Double-check there are no extra spaces before or after it.
   - (You may see `JWT_SECRET` already there set to "generate" — leave it. That's good.)
7. Click the big **Create Web Service** button at the bottom.
8. Render starts building. You'll see a black screen with scrolling text (the "logs").
   Wait ~2–3 minutes. When you see **"EventPlaybook running on..."** and the status at
   the top turns to **"Live"** (green), it's ready. 🎉

✅ **Part 3 done!**

---

## PART 4 — Open it and log in 🔓

1. At the top of the Render page, click the link (it looks like
   `https://eventplaybook-xxxx.onrender.com`). It opens your app in a new tab.
   - ⏳ The very first time (and after it's been idle a while) it may take **30–60
     seconds** to wake up. This is normal for the free plan. It's fast afterward.
2. You'll see the EventPlaybook sign-in screen. Log in with:
   - **Email:** `admin@example.com`
   - **Password:** `password`
3. You're in! 🎉 **Bookmark this link** and share it with your team.

---

## PART 5 — Make it yours (do this right away) 👤

1. **Create your own admin account:** on the login screen click **Register**, make an
   account with your real email. (The first-ever account is automatically an Administrator;
   since the demo admin already exists, an existing Admin can promote you — see next step.)
2. **Set team roles:** signed in as an Admin, go to **Settings** → user list. For each
   person you can set their role:
   - **Administrator** – full control
   - **Event Manager** – runs the planning
   - **Coordinator** – edits most things, submits schedule for approval
   - **Approver** – this is the **Vatsalya** role that approves the schedule
   - **Contributor** – adds tasks/announcements
   - **Viewer** – read-only
3. **Tell your team:** send them the link. Each person clicks **Register** to make their
   own account, then you set their role.

---

## PART 6 — Start planning your Shibir 🕉️

Work top to bottom in the left menu:

1. **Planning Setup** — Shibir name, region, start date, duration (3 or 5 days). The end
   date fills in automatically. Watch the progress bar at the top fill as you complete steps.
2. **Core Team** — add members grouped by region; mark the **POC** (point of contact).
3. **Departments** — click **"Add Default Departments"** to instantly create all 15
   (AV, Kitchen, Registration, Pujyashree Seva, Welcome Ceremony, and more). Click any
   department to assign members and add its tasks.
4. **Venues** — add options, compare, and click **✓ Select** on the chosen one.
5. **Caterers** — rate them on budget/taste/flexibility, then **Select** one.
6. **Registration** — set open/close dates, paid or free, cost per person, refund policy.
7. **Schedule approval** — a Coordinator clicks **Submit to Vatsalya**; an Approver (or
   Event Manager/Admin) clicks **Approve**.

---

## ❓ If something goes wrong

- **The page won't load / spins forever the first time** → wait a full minute; the free
  server is waking up. Refresh once after that.
- **Render build shows red errors** → most often `DATABASE_URL` is missing or has a typo.
  In Render go to your service → **Environment** → check `DATABASE_URL` matches your Neon
  string exactly, then click **Manual Deploy → Deploy latest commit**.
- **"Cannot connect to database"** → make sure you copied the *whole* Neon string,
  including the `?sslmode=require` at the end.
- **You want to change the code later** → upload the new files to the same GitHub repo;
  Render redeploys automatically within a couple minutes.

---

## 📝 Quick reference

| Thing | Value |
|---|---|
| Demo login | `admin@example.com` / `password` |
| Your app link | (the Render URL, once live — bookmark it) |
| Database | Neon (free, permanent) |
| The one setting that matters on Render | `DATABASE_URL` = your Neon connection string |

You've got this. Take it one part at a time. 🙌
