# Deploy EventPlaybook with GitHub + Render

EventPlaybook uses an embedded SQLite database stored in `data/eventplaybook.db`.
It needs no external database service or database connection URL. GitHub stores the
code; Render runs the app.

## Deploy

1. Upload the contents of `eventplaybook.zip` to a GitHub repository. Include `server/`,
   `public/`, `package.json`, `package-lock.json`, and `render.yaml`. Do not upload
   `node_modules` or a local `data/` folder.
2. In Render, choose **New → Blueprint** and connect that GitHub repository. Render reads
   `render.yaml` and creates the web service. The configured commands are `npm ci` and
   `npm start`; the health check is `/api/health`.
3. Let the deploy finish and open the Render URL. On an empty SQLite database, the app
   creates its schema and seeds demo data on first boot.
4. Sign in with `admin@example.com` / `password`, then change the demo password and add
   your team accounts.

The Blueprint asks Render to generate `JWT_SECRET` automatically. If you deploy through
an already-existing manually configured service and the logs say `JWT_SECRET not set`, add
that variable in **that EventPlaybook service's** Render Environment settings. It is a
security secret, not a database connection.

## Important: where SQLite data lives

The database file, uploads, and automatic JSON snapshots are written under the app's
`data/` directory (or `DATA_DIR` if set). Existing SQLite files are migrated additively;
normal startup does not wipe or reseed an existing database.

Render's **free** filesystem is ephemeral. SQLite works without any outside service, but
Render may discard local files when an instance is replaced or a deployment/restart resets
the filesystem. The app's automatic snapshots are on that same filesystem, so download an
admin backup from **Settings → Backup & Data Safety** if you need an off-host copy. A Render
persistent disk can keep SQLite data on plans that support disks; no disk is configured by
this free-tier Blueprint.

## Local run

```bash
npm ci
npm start
```

Open `http://localhost:3000`. The local SQLite file is created at `data/eventplaybook.db`.
Set `JWT_SECRET` in your shell for local sessions if desired; no database setup is needed.
