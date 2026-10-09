# Put EventPlaybook online — GitHub + Render only

This setup uses **two services only**: GitHub for the code and Render to run the app.
EventPlaybook includes a local SQLite database; no separate database account or connection
string is needed.

## 1. Put the app on GitHub

1. Download and unzip `eventplaybook.zip`.
2. Create a GitHub repository named `eventplaybook` (or use your existing one).
3. Upload the contents of the unzipped folder. Make sure `server/`, `public/`,
   `package.json`, `package-lock.json`, and `render.yaml` are included.
4. Do **not** upload `node_modules` or a local `data/` folder.
5. Commit the files.

## 2. Connect the repository to Render

1. Sign in to Render with GitHub.
2. Choose **New → Blueprint** and select the `eventplaybook` repository.
3. Review the service. The included `render.yaml` configures Node, `npm ci`, `npm start`,
   and `/api/health` as the health check.
4. Create the Blueprint and wait for the first deploy to finish.

Render generates the app's `JWT_SECRET` from `render.yaml`. If you are updating an
existing Render service and its logs say `JWT_SECRET not set`, add a long random value to
that service under **Environment** and save/redeploy. This is an app security setting; it
is not a database URL.

## 3. Open the app

Open the service URL shown by Render. On a new database the app automatically creates its
SQLite tables and demo data. Sign in with:

- **Email:** `admin@example.com`
- **Password:** `password`

Change the demo password and add your team members after signing in.

## SQLite data note

The SQLite file is stored in the app's local `data/` directory. No outside database
service is required. Render's free filesystem is ephemeral, however, so local data may be
lost when Render replaces the instance or resets its filesystem during a deploy/restart.
The app's automatic backups are stored on that same filesystem. For a separate copy, use
**Settings → Backup & Data Safety** to download a backup. A Render persistent disk can
preserve the file on plans that support disks; this guide does not create one.

## If deployment fails

- Check Render **Logs** for the first error, not just the final “No open ports” message.
- `JWT_SECRET not set`: add the secret in this EventPlaybook service's Environment
  settings; do not paste it into GitHub.
- No separate database setup is required; the app creates and uses its local SQLite file.
- Open `https://<your-render-url>/api/health`; a live app returns a small JSON status.
