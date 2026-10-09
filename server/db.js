'use strict';
// Local SQLite data layer. The app uses a small async adapter so the existing
// HTTP handlers can continue to await database operations while SQLite itself
// remains a single-file, embedded database (no external database service).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { AsyncLocalStorage } = require('async_hooks');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const DB_PATH = path.resolve(process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'eventplaybook.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000) });
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma(`busy_timeout = ${Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000)}`);

// AsyncLocalStorage keeps all awaited queries inside a transaction on the same
// SQLite connection. A FIFO queue prevents another request from accidentally
// joining an in-flight transaction on this single connection.
const als = new AsyncLocalStorage();
let operationQueue = Promise.resolve();
let savepointSequence = 0;

function serialize(work) {
  if (als.getStore()?.inTransaction) {
    try { return Promise.resolve(work()); } catch (e) { return Promise.reject(e); }
  }
  const run = operationQueue.then(work);
  operationQueue = run.then(() => undefined, () => undefined);
  return run;
}

function prepare(sql) {
  const statement = sqlite.prepare(sql);
  return {
    run(...args) { return serialize(() => statement.run(...args)); },
    get(...args) { return serialize(() => statement.get(...args)); },
    all(...args) { return serialize(() => statement.all(...args)); },
  };
}

const db = {
  prepare,
  exec(sql) { return serialize(() => sqlite.exec(sql)); },
  pragma(source, options) { return sqlite.pragma(source, options); },
  transaction(fn) {
    return (...args) => {
      const parent = als.getStore();
      if (parent?.inTransaction) {
        const savepoint = `ep_nested_${++savepointSequence}`;
        return (async () => {
          sqlite.exec(`SAVEPOINT ${savepoint}`);
          try {
            const result = await als.run(parent, () => fn(...args));
            sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
            return result;
          } catch (e) {
            try { sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch (_) {}
            try { sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch (_) {}
            throw e;
          }
        })();
      }
      return serialize(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await als.run({ inTransaction: true }, () => fn(...args));
          sqlite.exec('COMMIT');
          return result;
        } catch (e) {
          try { sqlite.exec('ROLLBACK'); } catch (_) {}
          throw e;
        }
      });
    };
  },
  close() { sqlite.close(); },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_type TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_milestones_event ON milestones(event_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist_items(task_id, sort_order, id);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT task_dependencies_no_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT task_dependencies_unique UNIQUE (task_id, depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_prereq ON task_dependencies(depends_on_task_id);

CREATE TABLE IF NOT EXISTS announcements ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ann_event ON announcements(event_id);

CREATE TABLE IF NOT EXISTS announcement_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT,
  message TEXT,
  short_version TEXT,
  author TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annver_ann ON announcement_versions(announcement_id);

CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comm_event ON communications(event_id);

CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  is_template INTEGER DEFAULT 0,
  department_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lessons_event ON lessons(event_id);

CREATE TABLE IF NOT EXISTS retrospectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_type TEXT,
  description TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mimetype TEXT,
  size INTEGER,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_att_entity ON attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  message TEXT,
  event_id INTEGER,
  entity_type TEXT,
  entity_id INTEGER,
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT,
  entity_id INTEGER,
  status TEXT,
  approver TEXT,
  comments TEXT,
  version INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  "user" TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT,
  name TEXT NOT NULL
);

-- Shibir-specific structure
CREATE TABLE IF NOT EXISTS core_team (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  region TEXT,
  email TEXT,
  phone TEXT,
  is_poc INTEGER NOT NULL DEFAULT 0,
  skills TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coreteam_event ON core_team(event_id);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lead_member_id INTEGER REFERENCES core_team(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Not Started',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dept_event ON departments(event_id);

CREATE TABLE IF NOT EXISTS department_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES core_team(id) ON DELETE CASCADE,
  role_in_dept TEXT
);
CREATE INDEX IF NOT EXISTS idx_deptmem_dept ON department_members(department_id);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_venue_event ON venues(event_id);

CREATE TABLE IF NOT EXISTS caterers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_caterer_event ON caterers(event_id);

CREATE TABLE IF NOT EXISTS registration_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function ensureColumn(table, definition) {
  const column = definition.trim().split(/\s+/, 1)[0];
  const columns = sqlite.pragma(`table_info(${table})`);
  if (!columns.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function init() {
  // New installs get the complete schema; old SQLite installs receive only the
  // additive columns/tables needed by current features. Existing rows are kept.
  sqlite.exec(SCHEMA);
  const migrations = [
    ['events', 'duration_days INTEGER'],
    ['events', 'region TEXT'],
    ['events', 'expected_participants INTEGER'],
    ['events', 'venue_id INTEGER'],
    ['events', 'caterer_id INTEGER'],
    ['events', "schedule_approval TEXT DEFAULT 'Draft'"],
    ['events', 'schedule_approved_by TEXT'],
    ['events', 'schedule_approved_at TEXT'],
    ['events', "planning_stage TEXT DEFAULT 'Core Team'"],
    ['events', 'guru_bhagwant TEXT'],
    ['tasks', 'department_id INTEGER'],
    ['tasks', 'parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE'],
    ['tasks', 'sort_order INTEGER NOT NULL DEFAULT 0'],
    ['tasks', "tags TEXT NOT NULL DEFAULT '[]'"],
    ['checklists', 'department_id INTEGER'],
    ['announcements', 'department_id INTEGER'],
  ];
  for (const [table, definition] of migrations) ensureColumn(table, definition);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)');
}

module.exports = { db, UPLOAD_DIR, DATA_DIR, DB_PATH, init, sqlite };
