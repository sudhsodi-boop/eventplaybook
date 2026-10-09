# EventPlaybook — Event Management, Communication & Lessons-Learned System

Plan → Communicate → Execute → Record → Learn → Reuse → Improve.

A production-style full-stack web app that manages recurring events and turns every
completed event into a reusable, improving playbook for next year.

## Run

```bash
cd eventplaybook
npm install
npm run seed     # loads demo data (Annual Community Event 2026)
npm start        # http://localhost:3000
```

### Demo accounts (password: `password`)
| Email | Role | Can |
|---|---|---|
| admin@example.com | Administrator | Everything, lock/delete history, roles, backup |
| manager@example.com | Event Manager | Create/manage events, clone, templates, audit |
| coord@example.com | Coordinator | Approve announcements, delete items |
| contrib@example.com | Contributor | Create/edit tasks, announcements, lessons |
| viewer@example.com | Viewer | Read-only |

The first user created on an empty database automatically becomes Administrator.

## Tech
- **Backend:** Node.js + Express, embedded SQLite (better-sqlite3; normalized schema, foreign keys, indexes). The app creates `data/eventplaybook.db` automatically; no external database or connection URL is needed.
- **Hosting:** GitHub + Render. Render's free filesystem is ephemeral, so download backups if you need an off-host copy; see `DEPLOY.md`.
- **Auth:** JWT + bcrypt password hashing, server-side role-based authorization
- **Frontend:** Vanilla JS SPA (no build step), responsive, mobile Event-Day Mode
- **Files:** multer uploads (PDF/DOCX/XLSX/CSV/images/TXT), metadata preserved

## Key concepts implemented
- **Relative Date Engine** — all timing stored as day offsets (`T-120`, `T-2`, `T+0`, `T+7`).
  Actual dates compute from the event start; changing the date recalculates everything.
  Per-item date overrides supported.
- **Create Next Event From Previous** — wizard with Next-Year Intelligence
  (KEEP / CHANGE / REMOVE / ADD), copies chosen entities, recalculates all dates,
  links to source, marks items "Inherited", never mutates the previous event.
- **KEEP / MODIFY / REMOVE dispositions** on tasks, milestones, announcements drive cloning.
- **Announcement version history** — content edits create new immutable versions with author/reason; compare + view history.
- **Approval workflow** — Draft → Review → Approved → Scheduled → Published, tracked with approver/comments.
- **Plan vs Actual & No Fake Completion** — `Published` requires an explicit confirmed transition; drafts stay drafts.
- **Lessons Learned + auto retrospective** on completion; AI proposes lessons that must be confirmed.
- **Historical protection** — Admin can lock events; locked events reject edits (409). Audit log records all changes.
- **AI assistance (heuristic, no external keys)** — timeline generation, announcement analysis,
  lesson extraction, announcement drafting, recurring-issue detection, knowledge search.
  All AI output is a labeled draft/proposal; nothing is silently applied.

## API (all under `/api`, JSON, `Authorization: Bearer <token>`)

### Auth
- `POST /auth/register` · `POST /auth/login` · `GET /auth/me`

### Users (Manager+/Admin)
- `GET /users` · `PUT /users/:id/role` (Admin)

### Events & Series
- `GET/POST /events` · `GET/PUT/DELETE /events/:id`
- `POST /events/:id/lock` (Admin) — lock/unlock historical record
- `GET/POST /series`
- `POST /events/:id/preview-clone` — KEEP/CHANGE/REMOVE/ADD analysis
- `POST /events/:id/clone` — create next event, recalculates dates
- `POST /events/:id/save-template` · `POST /events/:id/apply-template/:tid`

### Planning
- `GET/POST /events/:id/milestones` · `PUT/DELETE /milestones/:id`
- `GET/POST /events/:id/tasks` · `PUT/DELETE /tasks/:id` · `POST /tasks/bulk-status`
- `GET/POST /events/:id/communications` · `PUT/DELETE /communications/:id`

### Announcements
- `GET/POST /events/:id/announcements` · `GET/PUT/DELETE /announcements/:id`
- `POST /announcements/:id/duplicate` · `POST /announcements/:id/transition` (approval workflow)
- `GET /announcements/:id/compare?v1&v2`

### Execution & Knowledge
- `GET /events/:id/eventday?date=` — Event Day Mode
- `GET/POST /checklists` · `POST /checklists/:id/items` · `PUT /checklist-items/:id`
- `GET/POST /events/:id/people` · `PUT/DELETE /people/:id`
- `GET/POST /events/:id/lessons` · `PUT/DELETE /lessons/:id`
- `GET /events/:id/retrospective` · `POST /events/:id/retrospective/init` · `PUT /retrospective/:id`
- `GET /search?q=` — knowledge base search

### Reports / Analytics / Export
- `GET /events/:id/report/{summary|communication|lessons|next-prep|playbook}`
- `GET /events/:id/export/{tasks|announcements|milestones|lessons}.csv`
- `GET /dashboard/:id` · `GET /compare?a&b` · `GET /analytics/series/:id`
- `GET /backup` (Admin JSON backup)

### Platform
- `GET /attachments` · `POST /attachments` (multipart) · `GET /attachments/:id/download`
- `GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all`
- `GET /audit` (Manager+) · `GET/POST /categories`
- AI: `POST /ai/timeline`, `POST /events/:id/ai/apply-timeline`,
  `GET /events/:id/ai/analyze-announcements`, `GET /events/:id/ai/extract-lessons`,
  `POST /events/:id/ai/draft-announcement`

## Testing
`bash test.sh` runs an end-to-end acceptance suite (Tests 1–23 from the spec) against the
running server: event/timeline/milestone/task/announcement CRUD, version history, relative-date
recalculation on clone, KEEP/REMOVE application, historical immutability, RBAC for all five roles,
validation/error paths, search, and reports.

## Security notes
- Passwords hashed with bcrypt; JWT secret via `JWT_SECRET` env var.
- Authorization enforced **server-side** on every mutating route (not just hidden in UI).
- Historical events can be locked; AI never deletes/overwrites records or marks things sent.
- File type/size validation; stack traces never returned to clients.
