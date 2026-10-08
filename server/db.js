'use strict';
// PostgreSQL data layer with a thin adapter that preserves the
// better-sqlite3 call shape: db.prepare(sql).get/all/run(...args)
// but every method returns a Promise. SQL-dialect differences are
// absorbed centrally (? -> $n, datetime('now'), auto RETURNING id).
const path = require('path');
const fs = require('fs');
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// Parse int8 (bigint, OID 20) as a JS Number so COUNT(*)/SUM() come back numeric.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DATABASE_URL = process.env.DATABASE_URL || null;
// Enable SSL for hosted providers (Neon/Supabase/Render) unless explicitly disabled.
function sslConfig() {
  if (process.env.PGSSL === 'disable' || process.env.DATABASE_SSL === 'disable') return false;
  if (!DATABASE_URL) return false; // local socket / dev
  if (/localhost|127\.0\.0\.1/.test(DATABASE_URL)) return false;
  return { rejectUnauthorized: false };
}
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: sslConfig(), max: Number(process.env.PG_POOL_MAX || 10) })
  : new Pool({ max: Number(process.env.PG_POOL_MAX || 10) }); // uses PG* env vars

pool.on('error', (err) => console.error('[pg] idle client error:', err.message));

// Transaction context: when set, queries run on the transaction's client.
const als = new AsyncLocalStorage();

async function runQuery(text, params) {
  const client = als.getStore();
  if (client) return client.query(text, params);
  return pool.query(text, params);
}

// Translate a better-sqlite3 style statement to Postgres.
function translate(sql) {
  let i = 0;
  let out = sql.replace(/\?/g, () => '$' + (++i));
  out = out.replace(/datetime\('now'\)/g, "to_char(now(),'YYYY-MM-DD HH24:MI:SS')");
  out = out.replace(/date\('now'\)/g, "to_char(CURRENT_DATE,'YYYY-MM-DD')");
  return out;
}

function prepare(sql) {
  const isInsert = /^\s*INSERT\s/i.test(sql);
  const hasReturning = /\breturning\b/i.test(sql);
  return {
    async run(...args) {
      let text = translate(sql);
      if (isInsert && !hasReturning) text += ' RETURNING id';
      const r = await runQuery(text, args);
      return {
        lastInsertRowid: r.rows && r.rows[0] ? r.rows[0].id : undefined,
        changes: r.rowCount,
      };
    },
    async get(...args) {
      const r = await runQuery(translate(sql), args);
      return r.rows[0];
    },
    async all(...args) {
      const r = await runQuery(translate(sql), args);
      return r.rows;
    },
  };
}

const db = {
  prepare,
  async exec(sql) {
    // Raw multi-statement DDL/SQL (no placeholder translation).
    await runQuery(sql, []);
  },
  pragma() { /* no-op on Postgres */ },
  // Returns an async function that runs `fn` inside a transaction.
  transaction(fn) {
    return async (...a) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await als.run(client, () => fn(...a));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
      } finally {
        client.release();
      }
    };
  },
  pool,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer',
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS event_series (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  series_id INTEGER REFERENCES event_series(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  event_type TEXT,
  description TEXT,
  event_year INTEGER,
  start_date TEXT,
  end_date TEXT,
  location TEXT,
  organizer TEXT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'Planning',
  previous_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  participants INTEGER DEFAULT 0,
  notes TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  duration_days INTEGER,
  region TEXT,
  expected_participants INTEGER,
  venue_id INTEGER,
  caterer_id INTEGER,
  schedule_approval TEXT DEFAULT 'Draft',
  schedule_approved_by TEXT,
  schedule_approved_at TEXT,
  planning_stage TEXT DEFAULT 'Core Team',
  guru_bhagwant TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS phases (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS milestones (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  offset_days INTEGER DEFAULT 0,
  actual_date TEXT,
  date_override TEXT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'Not Started',
  completion_date TEXT,
  dependencies TEXT,
  notes TEXT,
  disposition TEXT DEFAULT '',
  inherited_from INTEGER,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_milestones_event ON milestones(event_id);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT,
  owner TEXT,
  assignee TEXT,
  offset_days INTEGER DEFAULT 0,
  date_override TEXT,
  actual_date TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'Not Started',
  dependency_id INTEGER,
  completion_date TEXT,
  notes TEXT,
  type TEXT DEFAULT 'Task',
  disposition TEXT DEFAULT '',
  inherited_from INTEGER,
  source_event_id INTEGER,
  department_id INTEGER,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist_items(task_id, sort_order, id);

CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS'),
  CONSTRAINT task_dependencies_no_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT task_dependencies_unique UNIQUE (task_id, depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_prereq ON task_dependencies(depends_on_task_id);

CREATE TABLE IF NOT EXISTS announcements ( 
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  phase_group TEXT,
  offset_days INTEGER DEFAULT 0,
  date_override TEXT,
  audience TEXT,
  purpose TEXT,
  message TEXT,
  short_version TEXT,
  channel TEXT DEFAULT 'Email',
  owner TEXT,
  approval_status TEXT NOT NULL DEFAULT 'Draft',
  published_status TEXT NOT NULL DEFAULT 'Not Published',
  publication_date TEXT,
  previous_version_id INTEGER,
  template_source TEXT,
  lessons_learned TEXT,
  next_year_recommendation TEXT,
  disposition TEXT DEFAULT '',
  inherited_from INTEGER,
  department_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_ann_event ON announcements(event_id);

CREATE TABLE IF NOT EXISTS announcement_versions (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT,
  message TEXT,
  short_version TEXT,
  author TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_annver_ann ON announcement_versions(announcement_id);

CREATE TABLE IF NOT EXISTS communications (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  purpose TEXT,
  audience TEXT,
  channel TEXT DEFAULT 'Email',
  offset_days INTEGER DEFAULT 0,
  date_override TEXT,
  owner TEXT,
  approval_required INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Planned',
  message TEXT,
  related_task_id INTEGER,
  related_milestone_id INTEGER,
  lessons_learned TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_comm_event ON communications(event_id);

CREATE TABLE IF NOT EXISTS checklists (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  is_template INTEGER DEFAULT 0,
  department_id INTEGER,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS lessons (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT,
  description TEXT,
  impact TEXT,
  recommendation TEXT,
  priority TEXT DEFAULT 'Medium',
  owner TEXT,
  related_task_id INTEGER,
  related_announcement_id INTEGER,
  related_milestone_id INTEGER,
  action_next TEXT,
  disposition TEXT DEFAULT '',
  confirmed INTEGER DEFAULT 1,
  source TEXT DEFAULT 'User',
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_lessons_event ON lessons(event_id);

CREATE TABLE IF NOT EXISTS retrospectives (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT,
  description TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mimetype TEXT,
  size INTEGER,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_att_entity ON attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type TEXT,
  message TEXT,
  event_id INTEGER,
  entity_type TEXT,
  entity_id INTEGER,
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  entity_type TEXT,
  entity_id INTEGER,
  status TEXT,
  approver TEXT,
  comments TEXT,
  version INTEGER,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  "user" TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  group_name TEXT,
  name TEXT NOT NULL
);

-- Shibir-specific structure
CREATE TABLE IF NOT EXISTS core_team (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region TEXT,
  email TEXT,
  phone TEXT,
  is_poc INTEGER NOT NULL DEFAULT 0,
  skills TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_coreteam_event ON core_team(event_id);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_member_id INTEGER REFERENCES core_team(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Not Started',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_dept_event ON departments(event_id);

CREATE TABLE IF NOT EXISTS department_members (
  id SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES core_team(id) ON DELETE CASCADE,
  role_in_dept TEXT
);
CREATE INDEX IF NOT EXISTS idx_deptmem_dept ON department_members(department_id);

CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  capacity INTEGER,
  cost TEXT,
  suitable_days TEXT,
  contact TEXT,
  pros TEXT,
  cons TEXT,
  status TEXT NOT NULL DEFAULT 'Candidate',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_venue_event ON venues(event_id);

CREATE TABLE IF NOT EXISTS caterers (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cuisine TEXT,
  budget_rating INTEGER,
  taste_rating INTEGER,
  flexibility_rating INTEGER,
  cost_per_person TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'Candidate',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_caterer_event ON caterers(event_id);

CREATE TABLE IF NOT EXISTS registration_config (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  open_date TEXT,
  close_date TEXT,
  regions TEXT,
  is_paid INTEGER NOT NULL DEFAULT 0,
  cost_per_person TEXT,
  refund_policy TEXT,
  refund_deadline TEXT,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'Not Open',
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
);
`;

async function init() {
  // Neon/Supabase free tiers "sleep" and can take several seconds to accept the
  // first connection. Retry with backoff so a cold database doesn't crash boot.
  const maxAttempts = Number(process.env.DB_INIT_RETRIES || 10);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query('SELECT 1');
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const waitMs = Math.min(2000 * attempt, 10000);
      console.warn(`[db] connection attempt ${attempt}/${maxAttempts} failed (${e.code || e.message}); retrying in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (lastErr) throw lastErr; // all attempts failed — surface the real reason in logs
  await pool.query(SCHEMA);
  // Idempotent safety migrations for pre-existing databases.
  const migrations = [
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS duration_days INTEGER",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS region TEXT",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_participants INTEGER",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_id INTEGER",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS caterer_id INTEGER",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS schedule_approval TEXT DEFAULT 'Draft'",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS schedule_approved_by TEXT",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS schedule_approved_at TEXT",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS planning_stage TEXT DEFAULT 'Core Team'",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS guru_bhagwant TEXT",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS department_id INTEGER",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '[]'",
    "CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)",
    "ALTER TABLE checklists ADD COLUMN IF NOT EXISTS department_id INTEGER",
    "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS department_id INTEGER",
  ];
  for (const m of migrations) {
    try { await pool.query(m); } catch (e) { /* ignore */ }
  }
}

module.exports = { db, UPLOAD_DIR, DATA_DIR, init, pool };
