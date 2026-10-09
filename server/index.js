'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('./db');
const U = require('./util');
const AI = require('./ai');
const Backup = require('./backup');

const app = express();
app.disable('x-powered-by');
// Basic security headers (no external deps)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple in-memory rate limiter for auth endpoints (brute-force protection)
const authHits = new Map();
function rateLimitAuth(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const max = Number(process.env.AUTH_RATE_LIMIT || 20); // attempts per window per IP
  const rec = authHits.get(ip) || { count: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + windowMs; }
  rec.count++;
  authHits.set(ip, rec);
  if (rec.count > max) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  next();
}
// prune the map occasionally
setInterval(() => { const t = Date.now(); for (const [k, v] of authHits) if (t > v.reset) authHits.delete(k); }, 10 * 60 * 1000).unref();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx?|xlsx?|csv|png|jpe?g|gif|webp|txt)$/i.test(file.originalname);
    cb(ok ? null : new Error('Unsupported file type'), ok);
  },
});

const api = express.Router();
app.use('/api', api);

// Wrap async route handlers so rejected promises are forwarded to the Express
// error handler instead of crashing the process (Express 4 does not do this).
function wrapAsync(fn) {
  if (typeof fn !== 'function' || fn.length >= 4) return fn; // skip error middleware
  return function (req, res, next) {
    try {
      const r = fn(req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
      return r;
    } catch (e) {
      next(e);
    }
  };
}
for (const m of ['get', 'post', 'put', 'delete', 'patch', 'all']) {
  const orig = api[m].bind(api);
  api[m] = (path, ...handlers) => orig(path, ...handlers.map(wrapAsync));
}

// Lightweight public health check — no auth and no database query. Render uses
// this endpoint to confirm the web service is responding.
api.get('/health', (req, res) => { res.json({ status: 'ok', ts: Date.now() }); });

// ---------- helpers ----------
function ok(res, data) { res.json(data); }
function bad(res, msg, code = 400) { res.status(code).json({ error: msg }); }
async function getEvent(id) { return (await db.prepare('SELECT * FROM events WHERE id=?').get(id)); }
function assertUnlocked(res, event) {
  if (!event) { bad(res, 'Event not found', 404); return false; }
  if (event.locked) { bad(res, 'This event is locked as historical record. Unlock it (Admin) to make corrections.', 409); return false; }
  return true;
}

// Enrich rows with computed actual dates + relative labels
function enrichDated(rows, eventStart) {
  return rows.map((r) => ({
    ...r,
    relative: U.relLabel(r.offset_days),
    computed_date: U.computeActual(eventStart, r.offset_days, r.date_override),
  }));
}

// ---------- AUTH ----------
api.post('/auth/register', rateLimitAuth, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  const errors = U.validate({ name: { required: true }, email: { required: true }, password: { required: true } }, req.body || {});
  if (errors.length) return bad(res, errors.join('; '));
  if (String(password).length < 6) return bad(res, 'Password must be at least 6 characters');
  const exists = (await db.prepare('SELECT id FROM users WHERE email=?').get(email));
  if (exists) return bad(res, 'Email already registered', 409);
  const count = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
  // First user becomes Administrator; otherwise requested role limited to Viewer/Contributor unless created by admin
  const assignedRole = count === 0 ? 'Administrator' : (['Viewer', 'Contributor'].includes(role) ? role : 'Viewer');
  const hash = bcrypt.hashSync(String(password), 12);
  const info = (await db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, hash, assignedRole));
  const user = (await db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(info.lastInsertRowid));
  await U.audit(user, 'create', 'user', user.id, null, { email, role: assignedRole });
  ok(res, { token: U.signToken(user), user });
});

api.post('/auth/login', rateLimitAuth, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, 'Email and password required');
  const row = (await db.prepare('SELECT * FROM users WHERE email=?').get(email));
  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) return bad(res, 'Invalid email or password', 401);
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  ok(res, { token: U.signToken(user), user });
});

api.get('/auth/me', U.authRequired, async (req, res) => {
  const row = (await db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.user.id));
  if (!row) return bad(res, 'User not found', 404);
  ok(res, { user: row });
});

// ---------- USERS (admin) ----------
api.get('/users', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  ok(res, (await db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id').all()));
});
api.put('/users/:id/role', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  const { role } = req.body || {};
  if (!U.ROLE_LEVEL[role]) return bad(res, 'Invalid role');
  const old = (await db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id));
  if (!old) return bad(res, 'User not found', 404);
  (await db.prepare('UPDATE users SET role=?, updated_at=datetime(\'now\') WHERE id=?').run(role, req.params.id));
  await U.audit(req.user, 'update', 'user', req.params.id, { role: old.role }, { role });
  ok(res, { ok: true });
});

// ---------- EVENT SERIES ----------
api.get('/series', U.authRequired, async (req, res) => {
  const rows = (await db.prepare('SELECT * FROM event_series ORDER BY name').all());
  for (const s of rows) s.events = (await db.prepare('SELECT id,name,event_year,status,start_date FROM events WHERE series_id=? ORDER BY event_year').all(s.id));
  ok(res, rows);
});
api.post('/series', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const { name, event_type, description } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = (await db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)').run(name, event_type || null, description || null));
  await U.audit(req.user, 'create', 'series', info.lastInsertRowid, null, { name });
  ok(res, (await db.prepare('SELECT * FROM event_series WHERE id=?').get(info.lastInsertRowid)));
});

// ---------- EVENTS ----------
api.get('/events', U.authRequired, async (req, res) => {
  const { status, year, q, series_id } = req.query;
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status=?'; params.push(status); }
  if (year) { sql += ' AND event_year=?'; params.push(Number(year)); }
  if (series_id) { sql += ' AND series_id=?'; params.push(Number(series_id)); }
  if (q) { sql += ' AND (name LIKE ? OR location LIKE ? OR event_type LIKE ?)'; const l = `%${q}%`; params.push(l, l, l); }
  sql += ' ORDER BY COALESCE(start_date, created_at) DESC';
  ok(res, (await db.prepare(sql).all(...params)));
});

api.get('/events/:id', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id);
  if (!ev) return bad(res, 'Event not found', 404);
  ev.series = ev.series_id ? (await db.prepare('SELECT * FROM event_series WHERE id=?').get(ev.series_id)) : null;
  ev.previous_event = ev.previous_event_id ? (await db.prepare('SELECT id,name,event_year FROM events WHERE id=?').get(ev.previous_event_id)) : null;
  ev.next_event = (await db.prepare('SELECT id,name,event_year FROM events WHERE previous_event_id=?').get(ev.id)) || null;
  ok(res, ev);
});

const EVENT_STATUSES = ['Planning', 'Active', 'Completed', 'Cancelled', 'Archived'];
api.post('/events', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const b = req.body || {};
  const errors = U.validate({ name: { required: true }, start_date: { date: true }, end_date: { date: true }, status: { enum: EVENT_STATUSES } }, b);
  if (errors.length) return bad(res, errors.join('; '));
  let seriesId = b.series_id || null;
  if (!seriesId && b.create_series && b.name) {
    const si = (await db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)').run(b.series_name || b.name, b.event_type || null, null));
    seriesId = si.lastInsertRowid;
  }
  const year = b.event_year || (b.start_date ? Number(b.start_date.slice(0, 4)) : null);
  const info = (await db.prepare(`INSERT INTO events (series_id,name,event_type,description,event_year,start_date,end_date,location,organizer,owner,status,previous_event_id,participants,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    seriesId, b.name, b.event_type || null, b.description || null, year, b.start_date || null, b.end_date || null,
    b.location || null, b.organizer || null, b.owner || null, b.status || 'Planning', b.previous_event_id || null,
    b.participants || 0, b.notes || null
  ));
  const ev = await getEvent(info.lastInsertRowid);
  await U.audit(req.user, 'create', 'event', ev.id, null, { name: ev.name, year });
  ok(res, ev);
});

api.put('/events/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  const ev = await getEvent(req.params.id);
  if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  const errors = U.validate({ start_date: { date: true }, end_date: { date: true }, status: { enum: EVENT_STATUSES } }, b);
  if (errors.length) return bad(res, errors.join('; '));
  const fields = ['name', 'event_type', 'description', 'event_year', 'start_date', 'end_date', 'location', 'organizer', 'owner', 'status', 'participants', 'notes', 'series_id', 'previous_event_id'];
  const sets = [], params = [];
  for (const f of fields) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (b.start_date && !('event_year' in b)) { sets.push('event_year=?'); params.push(Number(b.start_date.slice(0, 4))); }
  if (!sets.length) return bad(res, 'No fields to update');
  sets.push("updated_at=datetime('now')");
  params.push(req.params.id);
  (await db.prepare(`UPDATE events SET ${sets.join(',')} WHERE id=?`).run(...params));
  const updated = await getEvent(req.params.id);
  await U.audit(req.user, 'update', 'event', ev.id, { status: ev.status, start_date: ev.start_date }, { status: updated.status, start_date: updated.start_date });
  // If completed, auto-create draft retrospective + AI lessons
  if (b.status === 'Completed' && ev.status !== 'Completed') {
    await autoRetrospective(updated, req.user);
  }
  ok(res, updated);
});

// lock/unlock (admin only)
api.post('/events/:id/lock', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const lock = req.body && req.body.locked === false ? 0 : 1;
  (await db.prepare('UPDATE events SET locked=? WHERE id=?').run(lock, ev.id));
  await U.audit(req.user, lock ? 'lock' : 'unlock', 'event', ev.id, { locked: ev.locked }, { locked: lock });
  ok(res, { ok: true, locked: !!lock });
});

api.delete('/events/:id', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  if (ev.locked) return bad(res, 'Cannot delete a locked historical event', 409);
  (await db.prepare('DELETE FROM events WHERE id=?').run(ev.id));
  await U.audit(req.user, 'delete', 'event', ev.id, { name: ev.name }, null);
  ok(res, { ok: true });
});

// ---------- PHASES ----------
api.get('/events/:id/phases', U.authRequired, async (req, res) => {
  ok(res, (await db.prepare('SELECT * FROM phases WHERE event_id=? ORDER BY sort_order').all(req.params.id)));
});

// ---------- generic CRUD factory for dated child entities ----------
function datedRoutes(name, table, fields, opts = {}) {
  // list for an event
  api.get(`/events/:id/${name}`, U.authRequired, async (req, res) => {
    const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
    let rows = (await db.prepare(`SELECT * FROM ${table} WHERE event_id=? ORDER BY COALESCE(offset_days,0)`).all(req.params.id));
    rows = enrichDated(rows, ev.start_date);
    ok(res, rows);
  });
  api.post(`/events/:id/${name}`, U.authRequired, U.requireRole('Contributor'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (opts.required) { const e = U.validate(opts.required, b); if (e.length) return bad(res, e.join('; ')); }
    if (opts.validateCreate) {
      const problem = await opts.validateCreate({ body: b, event: ev, req });
      if (problem) return bad(res, typeof problem === 'string' ? problem : problem.message, (problem && problem.status) || 400);
    }
    const cols = ['event_id', ...fields.filter((f) => f in b)];
    const vals = [req.params.id, ...fields.filter((f) => f in b).map((f) => b[f])];
    const info = (await db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals));
    const row = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(info.lastInsertRowid));
    await U.audit(req.user, 'create', name, row.id, null, b);
    ok(res, enrichDated([row], ev.start_date)[0]);
  });
  api.put(`/${name}/:itemId`, U.authRequired, U.requireRole('Contributor'), async (req, res) => {
    const row = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId));
    if (!row) return bad(res, `${name} not found`, 404);
    const ev = await getEvent(row.event_id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (opts.validateUpdate) {
      const problem = await opts.validateUpdate({ body: b, event: ev, row, req });
      if (problem) return bad(res, typeof problem === 'string' ? problem : problem.message, (problem && problem.status) || 400);
    }
    const sets = [], params = [];
    for (const f of fields) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
    if (table === 'tasks') sets.push("updated_at=datetime('now')");
    if (!sets.length) return bad(res, 'No fields to update');
    if (fields.includes('updated_at')) {} // handled below
    params.push(req.params.itemId);
    (await db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...params));
    let updated = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId));
    await U.audit(req.user, 'update', name, row.id, row, b);
    if (opts.onUpdate) {
      await opts.onUpdate(row, updated, req.user);
      updated = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId));
    }
    ok(res, enrichDated([updated], ev.start_date)[0]);
  });
  api.delete(`/${name}/:itemId`, U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const row = (await db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId));
    if (!row) return bad(res, `${name} not found`, 404);
    const ev = await getEvent(row.event_id); if (!assertUnlocked(res, ev)) return;
    if (opts.validateDelete) {
      const problem = await opts.validateDelete({ row, event: ev, req });
      if (problem) return bad(res, typeof problem === 'string' ? problem : problem.message, (problem && problem.status) || 400);
    }
    (await db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.itemId));
    await U.audit(req.user, 'delete', name, row.id, row, null);
    ok(res, { ok: true });
  });
}

datedRoutes('milestones', 'milestones', ['name', 'description', 'offset_days', 'date_override', 'actual_date', 'owner', 'status', 'completion_date', 'dependencies', 'notes', 'disposition'], { required: { name: { required: true } } });

const TASK_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Completed', 'Cancelled'];
const TASK_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

async function taskParentError(parentId, eventId, taskId = null) {
  if (parentId === undefined || parentId === null || parentId === '') return null;
  const id = Number(parentId);
  if (!Number.isInteger(id) || id <= 0) return 'Parent task must be a valid task ID';
  if (taskId && id === Number(taskId)) return 'A task cannot be its own parent';
  const parent = await db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!parent || Number(parent.event_id) !== Number(eventId)) return 'Parent task must belong to the same event';
  if (taskId) {
    let current = parent;
    const seen = new Set();
    while (current) {
      if (Number(current.id) === Number(taskId)) return 'Moving this task under one of its descendants would create a cycle';
      if (seen.has(Number(current.id))) return 'The existing task hierarchy contains a cycle';
      seen.add(Number(current.id));
      current = current.parent_task_id ? await db.prepare('SELECT id,parent_task_id FROM tasks WHERE id=?').get(current.parent_task_id) : null;
    }
  }
  return null;
}

async function taskDependencyError(dependencyId, eventId, taskId = null) {
  if (dependencyId === undefined || dependencyId === null || dependencyId === '') return null;
  const id = Number(dependencyId);
  if (!Number.isInteger(id) || id <= 0) return 'Dependency must be a valid task ID';
  if (taskId && id === Number(taskId)) return 'A task cannot depend on itself';
  const target = await db.prepare('SELECT id,event_id FROM tasks WHERE id=?').get(id);
  if (!target || Number(target.event_id) !== Number(eventId)) return 'Dependency must belong to the same event';
  if (taskId) {
    const graph = new Map();
    const links = await db.prepare(`SELECT d.task_id,d.depends_on_task_id FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.event_id=?`).all(eventId);
    const legacy = await db.prepare('SELECT id,dependency_id FROM tasks WHERE event_id=? AND dependency_id IS NOT NULL').all(eventId);
    for (const edge of [...links, ...legacy.map((row) => ({ task_id: row.id, depends_on_task_id: row.dependency_id }))]) {
      const from = Number(edge.task_id), to = Number(edge.depends_on_task_id);
      if (!graph.has(from)) graph.set(from, []);
      if (!graph.get(from).includes(to)) graph.get(from).push(to);
    }
    const pending = [id], seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === Number(taskId)) return 'This dependency would create a cycle';
      if (seen.has(current)) continue;
      seen.add(current);pending.push(...(graph.get(current) || []));
    }
  }
  return null;
}

function taskFieldsError(body) {
  if (body.title !== undefined && (!String(body.title || '').trim() || String(body.title).trim().length > 500)) return 'Task title is required and must be 500 characters or fewer';
  if (body.status !== undefined && body.status !== null && body.status !== '' && !TASK_STATUSES.includes(body.status)) return 'Invalid task status';
  if (body.priority !== undefined && body.priority !== null && body.priority !== '' && !TASK_PRIORITIES.includes(body.priority)) return 'Invalid task priority';
  if (body.offset_days !== undefined && body.offset_days !== null && body.offset_days !== '' && !Number.isInteger(Number(body.offset_days))) return 'offset_days must be a whole number';
  if (body.sort_order !== undefined && body.sort_order !== null && body.sort_order !== '' && !Number.isInteger(Number(body.sort_order))) return 'sort_order must be a whole number';
  if (body.date_override && !/^\d{4}-\d{2}-\d{2}$/.test(body.date_override)) return 'date_override must be a date (YYYY-MM-DD)';
  if (body.tags !== undefined) {
    try {
      const tags = Array.isArray(body.tags) ? body.tags : JSON.parse(body.tags || '[]');
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) return 'tags must be a list of text values';
      body.tags = JSON.stringify(tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 30));
    } catch (_) { return 'tags must be valid JSON or a list'; }
  }
  return null;
}

datedRoutes('tasks', 'tasks', ['title', 'description', 'phase', 'owner', 'assignee', 'offset_days', 'date_override', 'actual_date', 'priority', 'status', 'dependency_id', 'completion_date', 'notes', 'type', 'disposition', 'department_id', 'parent_task_id', 'sort_order', 'tags'], {
  required: { title: { required: true } },
  validateCreate: async ({ body, event }) => {
    if (body.parent_task_id === '') body.parent_task_id = null;
    if (body.dependency_id === '') body.dependency_id = null;
    const fieldsErr = taskFieldsError(body); if (fieldsErr) return fieldsErr;
    const parentErr = await taskParentError(body.parent_task_id, event.id); if (parentErr) return parentErr;
    return taskDependencyError(body.dependency_id, event.id);
  },
  validateUpdate: async ({ body, event, row }) => {
    if (body.parent_task_id === '') body.parent_task_id = null;
    if (body.dependency_id === '') body.dependency_id = null;
    const fieldsErr = taskFieldsError(body); if (fieldsErr) return fieldsErr;
    if ('parent_task_id' in body) { const parentErr = await taskParentError(body.parent_task_id, event.id, row.id); if (parentErr) return parentErr; }
    if ('dependency_id' in body) return taskDependencyError(body.dependency_id, event.id, row.id);
    return null;
  },
  validateDelete: async ({ row }) => {
    const child = await db.prepare('SELECT id FROM tasks WHERE parent_task_id=? LIMIT 1').get(row.id);
    if (child) return { message: 'Move or delete this task’s subtasks before deleting the parent.', status: 409 };
    const comment = await db.prepare('SELECT id FROM task_comments WHERE task_id=? LIMIT 1').get(row.id);
    if (comment) return { message: 'This task has discussion history. Keep it and mark it Cancelled instead of deleting it.', status: 409 };
    const attachment = await db.prepare("SELECT id FROM attachments WHERE entity_type='task' AND entity_id=? LIMIT 1").get(row.id);
    if (attachment) return { message: 'This task has attachments. Keep it and mark it Cancelled instead of deleting its file history.', status: 409 };
    const dependency = await db.prepare('SELECT id FROM task_dependencies WHERE task_id=? OR depends_on_task_id=? LIMIT 1').get(row.id, row.id);
    if (dependency) return { message: 'Remove this task’s dependency links before deleting it.', status: 409 };
    return null;
  },
  onUpdate: async (oldRow, newRow, user) => {
    if (newRow.status === 'Completed' && oldRow.status !== 'Completed' && !newRow.completion_date) {
      (await db.prepare("UPDATE tasks SET completion_date=date('now') WHERE id=?").run(newRow.id));
    }
    if (newRow.status === 'Blocked' && oldRow.status !== 'Blocked') {
      await U.notify('blocked', `Task blocked: ${newRow.title}`, newRow.event_id, 'task', newRow.id);
    }
  },
});

datedRoutes('communications', 'communications', ['title', 'purpose', 'audience', 'channel', 'offset_days', 'date_override', 'owner', 'approval_required', 'status', 'message', 'related_task_id', 'related_milestone_id', 'lessons_learned'], { required: { title: { required: true } } });

// ---------- task detail, subtasks, checklist, comments, and dependencies ----------
api.get('/tasks/:itemId/detail', U.authRequired, async (req, res) => {
  const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.itemId);
  if (!task) return bad(res, 'Task not found', 404);
  const ev = await getEvent(task.event_id);
  if (!ev) return bad(res, 'Event not found', 404);
  const subtasks = await db.prepare('SELECT * FROM tasks WHERE parent_task_id=? ORDER BY sort_order,id').all(task.id);
  const checklist = await db.prepare('SELECT * FROM task_checklist_items WHERE task_id=? ORDER BY sort_order,id').all(task.id);
  const comments = await db.prepare('SELECT id,task_id,user_name,body,created_at FROM task_comments WHERE task_id=? ORDER BY id ASC LIMIT 200').all(task.id);
  let dependencies = await db.prepare(`SELECT t.id,t.title,t.status FROM task_dependencies d JOIN tasks t ON t.id=d.depends_on_task_id WHERE d.task_id=? ORDER BY t.title`).all(task.id);
  if (!dependencies.length && task.dependency_id) {
    const legacy = await db.prepare('SELECT id,title,status FROM tasks WHERE id=? AND event_id=?').get(task.dependency_id, task.event_id);
    if (legacy) dependencies = [legacy];
  }
  const dependents = await db.prepare(`SELECT t.id,t.title,t.status FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE d.depends_on_task_id=? ORDER BY t.title`).all(task.id);
  const activity = await db.prepare(`SELECT id,"user" AS user,action,old_value,new_value,created_at FROM audit_logs WHERE entity_type='task' AND entity_id=? ORDER BY id DESC LIMIT 40`).all(task.id);
  ok(res, {
    task: enrichDated([task], ev.start_date)[0],
    subtasks: enrichDated(subtasks, ev.start_date), checklist, comments, dependencies, dependents, activity,
    event_locked: !!ev.locked,
  });
});

api.post('/tasks/:itemId/subtasks', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const parent = await db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.itemId);
  if (!parent) return bad(res, 'Parent task not found', 404);
  const ev = await getEvent(parent.event_id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return bad(res, 'Subtask title is required');
  if (title.length > 500) return bad(res, 'Subtask title must be 500 characters or fewer');
  const data = {
    ...b,
    status: b.status || 'Not Started',
    priority: b.priority || parent.priority || 'Medium',
    offset_days: b.offset_days === undefined || b.offset_days === '' ? Number(parent.offset_days) || 0 : Number(b.offset_days),
  };
  const fieldsErr = taskFieldsError(data); if (fieldsErr) return bad(res, fieldsErr);
  const next = await db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM tasks WHERE parent_task_id=?').get(parent.id);
  const info = await db.prepare(`INSERT INTO tasks
    (event_id,title,description,phase,owner,assignee,offset_days,date_override,priority,status,type,notes,parent_task_id,sort_order,tags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    parent.event_id, title, b.description || null, b.phase || parent.phase || null,
    b.owner || parent.owner || null, b.assignee || '', data.offset_days,
    b.date_override || null, data.priority, data.status, b.type || 'Task', b.notes || null,
    parent.id, next.n, data.tags || '[]'
  );
  const created = await db.prepare('SELECT * FROM tasks WHERE id=?').get(info.lastInsertRowid);
  await U.audit(req.user, 'create-subtask', 'task', created.id, null, { parent_task_id: parent.id, title });
  ok(res, enrichDated([created], ev.start_date)[0]);
});

api.post('/tasks/:itemId/comments', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.itemId);
  if (!task) return bad(res, 'Task not found', 404);
  const ev = await getEvent(task.event_id); if (!assertUnlocked(res, ev)) return;
  const body = String((req.body || {}).body || '').trim();
  if (!body) return bad(res, 'Comment cannot be empty');
  if (body.length > 10000) return bad(res, 'Comment must be 10,000 characters or fewer');
  const info = await db.prepare('INSERT INTO task_comments (task_id,user_name,body) VALUES (?,?,?)').run(task.id, req.user.name || req.user.email, body);
  const comment = await db.prepare('SELECT id,task_id,user_name,body,created_at FROM task_comments WHERE id=?').get(info.lastInsertRowid);
  await U.audit(req.user, 'comment', 'task', task.id, null, { comment_id: comment.id });
  ok(res, comment);
});

api.post('/tasks/:itemId/checklist-items', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.itemId);
  if (!task) return bad(res, 'Task not found', 404);
  const ev = await getEvent(task.event_id); if (!assertUnlocked(res, ev)) return;
  const text = String((req.body || {}).text || '').trim();
  if (!text) return bad(res, 'Checklist item text is required');
  if (text.length > 1000) return bad(res, 'Checklist item must be 1,000 characters or fewer');
  const next = await db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM task_checklist_items WHERE task_id=?').get(task.id);
  const info = await db.prepare('INSERT INTO task_checklist_items (task_id,text,sort_order,created_by) VALUES (?,?,?,?)').run(task.id, text, next.n, req.user.name);
  const item = await db.prepare('SELECT * FROM task_checklist_items WHERE id=?').get(info.lastInsertRowid);
  await U.audit(req.user, 'checklist-add', 'task', task.id, null, { item_id: item.id, text });
  ok(res, item);
});

api.put('/task-checklist-items/:itemId', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const item = await db.prepare('SELECT * FROM task_checklist_items WHERE id=?').get(req.params.itemId);
  if (!item) return bad(res, 'Checklist item not found', 404);
  const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(item.task_id);
  const ev = await getEvent(task.event_id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {}; const sets = [], params = [];
  if ('text' in b) {
    const text = String(b.text || '').trim();
    if (!text) return bad(res, 'Checklist item text cannot be empty');
    if (text.length > 1000) return bad(res, 'Checklist item must be 1,000 characters or fewer');
    sets.push('text=?'); params.push(text);
  }
  if ('done' in b) {
    const allowed = [true, false, 0, 1, '0', '1', 'true', 'false'];
    if (!allowed.includes(b.done)) return bad(res, 'done must be a boolean');
    const done = b.done === true || b.done === 1 || b.done === '1' || b.done === 'true';
    sets.push('done=?'); params.push(done ? 1 : 0);
  }
  if (!sets.length) return bad(res, 'No checklist fields to update');
  params.push(item.id);
  await db.prepare(`UPDATE task_checklist_items SET ${sets.join(',')} WHERE id=?`).run(...params);
  const updated = await db.prepare('SELECT * FROM task_checklist_items WHERE id=?').get(item.id);
  await U.audit(req.user, 'checklist-update', 'task', task.id, item, updated);
  ok(res, updated);
});

api.delete('/task-checklist-items/:itemId', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  const item = await db.prepare('SELECT * FROM task_checklist_items WHERE id=?').get(req.params.itemId);
  if (!item) return bad(res, 'Checklist item not found', 404);
  const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(item.task_id);
  const ev = await getEvent(task.event_id); if (!assertUnlocked(res, ev)) return;
  await db.prepare('DELETE FROM task_checklist_items WHERE id=?').run(item.id);
  await U.audit(req.user, 'checklist-remove', 'task', task.id, item, null);
  ok(res, { ok: true });
});

api.put('/tasks/:itemId/dependencies', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.itemId);
  if (!task) return bad(res, 'Task not found', 404);
  const ev = await getEvent(task.event_id); if (!assertUnlocked(res, ev)) return;
  const raw = (req.body || {}).depends_on;
  if (!Array.isArray(raw)) return bad(res, 'depends_on must be an array of task IDs');
  if (raw.length > 100) return bad(res, 'A task can have at most 100 prerequisites');
  const ids = [...new Set(raw.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return bad(res, 'Dependency IDs must be valid task IDs');
  if (ids.includes(Number(task.id))) return bad(res, 'A task cannot depend on itself');
  for (const id of ids) {
    const target = await db.prepare('SELECT id,event_id FROM tasks WHERE id=?').get(id);
    if (!target || Number(target.event_id) !== Number(task.event_id)) return bad(res, 'Dependencies must be tasks in the same event');
  }
  const edges = await db.prepare(`SELECT d.task_id,d.depends_on_task_id FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.event_id=?`).all(task.event_id);
  const legacyEdges = await db.prepare('SELECT id AS task_id,dependency_id AS depends_on_task_id FROM tasks WHERE event_id=? AND dependency_id IS NOT NULL').all(task.event_id);
  const graph = new Map();
  for (const edge of [...edges, ...legacyEdges]) {
    if (!graph.has(Number(edge.task_id))) graph.set(Number(edge.task_id), []);
    if (!graph.get(Number(edge.task_id)).includes(Number(edge.depends_on_task_id))) graph.get(Number(edge.task_id)).push(Number(edge.depends_on_task_id));
  }
  for (const id of ids) {
    const pending = [id], seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === Number(task.id)) return bad(res, 'This dependency would create a cycle');
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(graph.get(current) || []));
    }
  }
  const tx = db.transaction(async () => {
    await db.prepare('DELETE FROM task_dependencies WHERE task_id=?').run(task.id);
    for (const id of ids) await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_task_id,created_by) VALUES (?,?,?)').run(task.id, id, req.user.name);
    await db.prepare("UPDATE tasks SET dependency_id=?,updated_at=datetime('now') WHERE id=?").run(ids[0] || null, task.id);
  });
  await tx();
  await U.audit(req.user, 'dependencies-update', 'task', task.id, null, { depends_on: ids });
  ok(res, { ok: true, depends_on: ids });
});

// bulk task status
api.post('/tasks/bulk-status', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const { ids, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || !status) return bad(res, 'ids[] and status required');
  if (!TASK_STATUSES.includes(status)) return bad(res, 'Invalid task status');
  const tx = db.transaction(async () => {
    for (const id of ids) {
      const row = (await db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
      if (!row) continue;
      const ev = await getEvent(row.event_id); if (ev && ev.locked) continue;
      (await db.prepare("UPDATE tasks SET status=?, completion_date=CASE WHEN ?='Completed' THEN date('now') ELSE completion_date END, updated_at=datetime('now') WHERE id=?").run(status, status, id));
      await U.audit(req.user, 'update', 'task', id, { status: row.status }, { status });
    }
  });
  await tx();
  ok(res, { ok: true, count: ids.length });
});

// ---------- ANNOUNCEMENTS ----------
const ANN_APPROVAL = ['Draft', 'Review', 'Approved', 'Scheduled', 'Published', 'Cancelled', 'Archived'];
api.get('/events/:id/announcements', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  let rows = (await db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY COALESCE(offset_days,0)').all(req.params.id));
  ok(res, enrichDated(rows, ev.start_date));
});
api.get('/announcements/:id', U.authRequired, async (req, res) => {
  const a = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = await getEvent(a.event_id);
  a.versions = (await db.prepare('SELECT * FROM announcement_versions WHERE announcement_id=? ORDER BY version DESC').all(a.id));
  a.approvals = (await db.prepare("SELECT * FROM approvals WHERE entity_type='announcement' AND entity_id=? ORDER BY id DESC").all(a.id));
  ok(res, enrichDated([a], ev ? ev.start_date : null)[0]);
});
const ANN_FIELDS = ['title', 'category', 'phase_group', 'offset_days', 'date_override', 'audience', 'purpose', 'message', 'short_version', 'channel', 'owner', 'approval_status', 'published_status', 'publication_date', 'template_source', 'lessons_learned', 'next_year_recommendation', 'disposition', 'department_id'];
api.post('/events/:id/announcements', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  if (!b.title) return bad(res, 'title is required');
  const cols = ['event_id', ...ANN_FIELDS.filter((f) => f in b)];
  const vals = [req.params.id, ...ANN_FIELDS.filter((f) => f in b).map((f) => b[f])];
  const info = (await db.prepare(`INSERT INTO announcements (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals));
  const a = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(info.lastInsertRowid));
  (await db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)')
    .run(a.id, 1, a.title, a.message, a.short_version, req.user.name, 'Initial version'));
  await U.audit(req.user, 'create', 'announcement', a.id, null, { title: a.title });
  ok(res, enrichDated([a], ev.start_date)[0]);
});
api.put('/announcements/:id', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const a = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = await getEvent(a.event_id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  const contentChanged = ('message' in b && b.message !== a.message) || ('title' in b && b.title !== a.title) || ('short_version' in b && b.short_version !== a.short_version);
  const sets = [], params = [];
  for (const f of ANN_FIELDS) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (!sets.length) return bad(res, 'No fields to update');
  let newVersion = a.version;
  if (contentChanged) { newVersion = a.version + 1; sets.push('version=?'); params.push(newVersion); }
  sets.push("updated_at=datetime('now')");
  params.push(req.params.id);
  (await db.prepare(`UPDATE announcements SET ${sets.join(',')} WHERE id=?`).run(...params));
  const updated = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (contentChanged) {
    (await db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)')
      .run(a.id, newVersion, updated.title, updated.message, updated.short_version, req.user.name, b.change_reason || 'Content updated'));
  }
  await U.audit(req.user, 'update', 'announcement', a.id, { title: a.title, approval_status: a.approval_status }, { title: updated.title, approval_status: updated.approval_status });
  ok(res, enrichDated([updated], ev.start_date)[0]);
});
api.post('/announcements/:id/duplicate', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const a = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!a) return bad(res, 'Announcement not found', 404);
  const info = (await db.prepare(`INSERT INTO announcements (event_id,title,category,phase_group,offset_days,date_override,audience,purpose,message,short_version,channel,owner,approval_status,published_status,previous_version_id,template_source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.event_id, a.title + ' (copy)', a.category, a.phase_group, a.offset_days, a.date_override, a.audience, a.purpose, a.message, a.short_version, a.channel, a.owner, 'Draft', 'Not Published', a.id, a.template_source));
  const copy = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(info.lastInsertRowid));
  (await db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)').run(copy.id, 1, copy.title, copy.message, copy.short_version, req.user.name, 'Duplicated'));
  await U.audit(req.user, 'create', 'announcement', copy.id, null, { duplicated_from: a.id });
  ok(res, copy);
});
api.delete('/announcements/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  const a = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = await getEvent(a.event_id); if (!assertUnlocked(res, ev)) return;
  (await db.prepare('DELETE FROM announcements WHERE id=?').run(a.id));
  await U.audit(req.user, 'delete', 'announcement', a.id, { title: a.title }, null);
  ok(res, { ok: true });
});

// Approval workflow transitions
api.post('/announcements/:id/transition', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  const a = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = await getEvent(a.event_id); if (!assertUnlocked(res, ev)) return;
  const { to, comments } = req.body || {};
  if (!ANN_APPROVAL.includes(to)) return bad(res, 'Invalid target status');
  // Approving/Publishing needs higher role
  if ((to === 'Approved') && (U.ROLE_LEVEL[req.user.role] < U.ROLE_LEVEL['Coordinator'])) return bad(res, 'Not authorized to approve', 403);
  const patch = { approval_status: to };
  if (to === 'Published') {
    patch.published_status = 'Published';
    patch.publication_date = U.todayStr();
  }
  const sets = Object.keys(patch).map((k) => `${k}=?`).join(',');
  (await db.prepare(`UPDATE announcements SET ${sets}, updated_at=datetime('now') WHERE id=?`).run(...Object.values(patch), a.id));
  (await db.prepare('INSERT INTO approvals (entity_type,entity_id,status,approver,comments,version) VALUES (?,?,?,?,?,?)').run('announcement', a.id, to, req.user.name, comments || null, a.version));
  await U.audit(req.user, 'transition', 'announcement', a.id, { approval_status: a.approval_status }, patch);
  ok(res, (await db.prepare('SELECT * FROM announcements WHERE id=?').get(a.id)));
});

// version compare
api.get('/announcements/:id/compare', U.authRequired, async (req, res) => {
  const { v1, v2 } = req.query;
  const a = (await db.prepare('SELECT * FROM announcement_versions WHERE announcement_id=? AND version=?').get(req.params.id, v1));
  const b = (await db.prepare('SELECT * FROM announcement_versions WHERE announcement_id=? AND version=?').get(req.params.id, v2));
  if (!a || !b) return bad(res, 'One or both versions not found', 404);
  ok(res, { v1: a, v2: b });
});

// ---------- CHECKLISTS ----------
api.get('/checklists', U.authRequired, async (req, res) => {
  const { event_id, template } = req.query;
  let sql = 'SELECT * FROM checklists WHERE 1=1', params = [];
  if (event_id) { sql += ' AND event_id=?'; params.push(event_id); }
  if (template === '1') { sql += ' AND is_template=1'; }
  sql += ' ORDER BY id DESC';
  const lists = (await db.prepare(sql).all(...params));
  for (const l of lists) l.items = (await db.prepare('SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY sort_order,id').all(l.id));
  ok(res, lists);
});
api.post('/checklists', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const { event_id, name, category, is_template, items, department_id } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = (await db.prepare('INSERT INTO checklists (event_id,name,category,is_template,department_id) VALUES (?,?,?,?,?)').run(event_id || null, name, category || null, is_template ? 1 : 0, department_id || null));
  const id = info.lastInsertRowid;
  if (Array.isArray(items)) { let i = 0; for (const t of items) { await db.prepare('INSERT INTO checklist_items (checklist_id,text,sort_order) VALUES (?,?,?)').run(id, typeof t === 'string' ? t : t.text, i); i++; } }
  await U.audit(req.user, 'create', 'checklist', id, null, { name });
  const l = (await db.prepare('SELECT * FROM checklists WHERE id=?').get(id));
  l.items = (await db.prepare('SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY sort_order,id').all(id));
  ok(res, l);
});
api.post('/checklists/:id/items', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const { text } = req.body || {};
  if (!text) return bad(res, 'text is required');
  const c = (await db.prepare('SELECT * FROM checklists WHERE id=?').get(req.params.id));
  if (!c) return bad(res, 'Checklist not found', 404);
  const info = (await db.prepare('INSERT INTO checklist_items (checklist_id,text) VALUES (?,?)').run(req.params.id, text));
  ok(res, (await db.prepare('SELECT * FROM checklist_items WHERE id=?').get(info.lastInsertRowid)));
});
api.put('/checklist-items/:id', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const it = (await db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id));
  if (!it) return bad(res, 'Item not found', 404);
  const b = req.body || {};
  const sets = [], params = [];
  if ('done' in b) { sets.push('done=?'); params.push(b.done ? 1 : 0); }
  if ('text' in b) { sets.push('text=?'); params.push(b.text); }
  if (!sets.length) return bad(res, 'Nothing to update');
  params.push(req.params.id);
  (await db.prepare(`UPDATE checklist_items SET ${sets.join(',')} WHERE id=?`).run(...params));
  ok(res, (await db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id)));
});
api.delete('/checklists/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  (await db.prepare('DELETE FROM checklists WHERE id=?').run(req.params.id));
  await U.audit(req.user, 'delete', 'checklist', req.params.id, null, null);
  ok(res, { ok: true });
});

// ---------- PEOPLE / ROLES ----------
api.get('/events/:id/people', U.authRequired, async (req, res) => ok(res, (await db.prepare('SELECT * FROM people WHERE event_id=? ORDER BY role').all(req.params.id))));
api.post('/events/:id/people', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  if (!b.name) return bad(res, 'name is required');
  const info = (await db.prepare('INSERT INTO people (event_id,name,role,email,phone,notes) VALUES (?,?,?,?,?,?)').run(req.params.id, b.name, b.role || null, b.email || null, b.phone || null, b.notes || null));
  await U.audit(req.user, 'create', 'person', info.lastInsertRowid, null, b);
  ok(res, (await db.prepare('SELECT * FROM people WHERE id=?').get(info.lastInsertRowid)));
});
api.put('/people/:id', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const p = (await db.prepare('SELECT * FROM people WHERE id=?').get(req.params.id));
  if (!p) return bad(res, 'Person not found', 404);
  const b = req.body || {};
  const sets = [], params = [];
  for (const f of ['name', 'role', 'email', 'phone', 'notes']) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (!sets.length) return bad(res, 'Nothing to update');
  params.push(req.params.id);
  (await db.prepare(`UPDATE people SET ${sets.join(',')} WHERE id=?`).run(...params));
  ok(res, (await db.prepare('SELECT * FROM people WHERE id=?').get(req.params.id)));
});
api.delete('/people/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  (await db.prepare('DELETE FROM people WHERE id=?').run(req.params.id));
  ok(res, { ok: true });
});

// ---------- LESSONS LEARNED ----------
api.get('/events/:id/lessons', U.authRequired, async (req, res) => ok(res, (await db.prepare('SELECT * FROM lessons WHERE event_id=? ORDER BY id DESC').all(req.params.id))));
const LESSON_FIELDS = ['category', 'description', 'impact', 'recommendation', 'priority', 'owner', 'related_task_id', 'related_announcement_id', 'related_milestone_id', 'action_next', 'disposition', 'confirmed', 'source'];
api.post('/events/:id/lessons', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const b = req.body || {};
  if (!b.description) return bad(res, 'description is required');
  const cols = ['event_id', ...LESSON_FIELDS.filter((f) => f in b)];
  const vals = [req.params.id, ...LESSON_FIELDS.filter((f) => f in b).map((f) => b[f])];
  const info = (await db.prepare(`INSERT INTO lessons (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals));
  await U.audit(req.user, 'create', 'lesson', info.lastInsertRowid, null, b);
  ok(res, (await db.prepare('SELECT * FROM lessons WHERE id=?').get(info.lastInsertRowid)));
});
api.put('/lessons/:id', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const l = (await db.prepare('SELECT * FROM lessons WHERE id=?').get(req.params.id));
  if (!l) return bad(res, 'Lesson not found', 404);
  const b = req.body || {};
  const sets = [], params = [];
  for (const f of LESSON_FIELDS) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (!sets.length) return bad(res, 'Nothing to update');
  params.push(req.params.id);
  (await db.prepare(`UPDATE lessons SET ${sets.join(',')} WHERE id=?`).run(...params));
  await U.audit(req.user, 'update', 'lesson', l.id, l, b);
  ok(res, (await db.prepare('SELECT * FROM lessons WHERE id=?').get(req.params.id)));
});
api.delete('/lessons/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  (await db.prepare('DELETE FROM lessons WHERE id=?').run(req.params.id));
  await U.audit(req.user, 'delete', 'lesson', req.params.id, null, null);
  ok(res, { ok: true });
});

// ---------- RETROSPECTIVE ----------
const RETRO_TEMPLATE = [
  ['Planning', 'What went well?'], ['Planning', 'What went poorly?'], ['Planning', 'What should change?'],
  ['Communication', 'Which announcements worked?'], ['Communication', 'Which were unnecessary?'], ['Communication', 'Were they sent at the right time?'], ['Communication', 'Was the audience correct?'], ['Communication', 'Which communication caused confusion?'],
  ['Event Execution', 'What worked?'], ['Event Execution', 'What failed?'], ['Event Execution', 'What unexpected problems occurred?'],
  ['People', 'Were responsibilities clear?'], ['People', 'Were enough volunteers available?'],
  ['Technology', 'What technical problems occurred?'],
  ['Schedule', 'Which activities ran late?'], ['Schedule', 'Which timing should change?'],
  ['Recommendations', 'Keep'], ['Recommendations', 'Change'], ['Recommendations', 'Remove'], ['Recommendations', 'Add'],
];
api.get('/events/:id/retrospective', U.authRequired, async (req, res) => {
  let rows = (await db.prepare('SELECT * FROM retrospectives WHERE event_id=? ORDER BY id').all(req.params.id));
  ok(res, rows);
});
api.post('/events/:id/retrospective/init', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const existing = (await db.prepare('SELECT COUNT(*) c FROM retrospectives WHERE event_id=?').get(req.params.id)).c;
  if (existing > 0) return ok(res, (await db.prepare('SELECT * FROM retrospectives WHERE event_id=? ORDER BY id').all(req.params.id)));
  const tx = db.transaction(async () => {
    for (const [section, question] of RETRO_TEMPLATE) (await db.prepare('INSERT INTO retrospectives (event_id,section,question) VALUES (?,?,?)').run(req.params.id, section, question));
  });
  await tx();
  await U.audit(req.user, 'create', 'retrospective', ev.id, null, { init: true });
  ok(res, (await db.prepare('SELECT * FROM retrospectives WHERE event_id=? ORDER BY id').all(req.params.id)));
});
api.put('/retrospective/:id', U.authRequired, U.requireRole('Contributor'), async (req, res) => {
  const r = (await db.prepare('SELECT * FROM retrospectives WHERE id=?').get(req.params.id));
  if (!r) return bad(res, 'Not found', 404);
  (await db.prepare("UPDATE retrospectives SET answer=? WHERE id=?").run(req.body.answer || '', req.params.id));
  ok(res, (await db.prepare('SELECT * FROM retrospectives WHERE id=?').get(req.params.id)));
});

async function autoRetrospective(ev, user) {
  const existing = (await db.prepare('SELECT COUNT(*) c FROM retrospectives WHERE event_id=?').get(ev.id)).c;
  if (existing === 0) {
    const tx = db.transaction(async () => {
      for (const [section, question] of RETRO_TEMPLATE) (await db.prepare('INSERT INTO retrospectives (event_id,section,question) VALUES (?,?,?)').run(ev.id, section, question));
    });
    await tx();
  }
  // AI proposed (unconfirmed) lessons
  const proposals = await AI.extractLessons(ev.id);
  for (const p of proposals) {
    (await db.prepare('INSERT INTO lessons (event_id,category,description,recommendation,priority,confirmed,source) VALUES (?,?,?,?,?,0,?)')
      .run(ev.id, p.category, p.description, p.recommendation, p.priority, 'AI Suggested'));
  }
  await U.notify('retrospective', `Draft retrospective & ${proposals.length} candidate lessons created for "${ev.name}"`, ev.id, 'event', ev.id);
  await U.audit(user, 'auto-retrospective', 'event', ev.id, null, { lessons_proposed: proposals.length });
}

// ---------- CREATE FROM PREVIOUS EVENT ----------
api.post('/events/:id/preview-clone', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const src = await getEvent(req.params.id);
  if (!src) return bad(res, 'Source event not found', 404);
  // Build KEEP/CHANGE/REMOVE/ADD analysis
  const collect = async (table) => (await db.prepare(`SELECT * FROM ${table} WHERE event_id=?`).all(src.id));
  const analysis = { keep: [], change: [], remove: [], add: [] };
  const bucket = (label, disposition) => {
    const d = (disposition || '').toUpperCase();
    if (d === 'REMOVE') analysis.remove.push(label);
    else if (d === 'MODIFY' || d === 'CHANGE') analysis.change.push(label);
    else analysis.keep.push(label);
  };
  (await collect('milestones')).forEach((m) => bucket(`Milestone: ${m.name}`, m.disposition));
  (await collect('tasks')).forEach((t) => bucket(`Task: ${t.title}`, t.disposition));
  (await collect('announcements')).forEach((a) => bucket(`Announcement: ${a.title}`, a.disposition));
  // lessons -> ADD suggestions
  (await db.prepare('SELECT * FROM lessons WHERE event_id=?').all(src.id)).forEach((l) => {
    if (l.action_next) analysis.add.push(`New action from lesson: ${l.action_next}`);
    else if (l.recommendation) analysis.change.push(`Per lesson (${l.category}): ${l.recommendation}`);
  });
  ok(res, { source: { id: src.id, name: src.name, year: src.event_year }, analysis });
});

api.post('/events/:id/clone', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const src = await getEvent(req.params.id);
  if (!src) return bad(res, 'Source event not found', 404);
  const b = req.body || {};
  if (!b.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) return bad(res, 'Valid new start_date (YYYY-MM-DD) is required');
  const copy = b.copy || {};
  const includeRemoved = false; // never carry REMOVE items
  const newYear = b.event_year || Number(b.start_date.slice(0, 4));
  const durationDays = (src.start_date && src.end_date) ? U.daysBetween(src.start_date, src.end_date) : 0;
  const newEnd = b.end_date || U.addDays(b.start_date, durationDays || 0);

  const tx = db.transaction(async () => {
    // ensure series
    let seriesId = src.series_id;
    if (!seriesId) {
      const si = (await db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)').run(src.name, src.event_type, src.description));
      seriesId = si.lastInsertRowid;
      (await db.prepare('UPDATE events SET series_id=? WHERE id=?').run(seriesId, src.id));
    }
    const newName = b.name || src.name.replace(/\b20\d\d\b/, String(newYear)) || `${src.name} (${newYear})`;
    const info = (await db.prepare(`INSERT INTO events (series_id,name,event_type,description,event_year,start_date,end_date,location,organizer,owner,status,previous_event_id,participants,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      seriesId, newName, src.event_type, src.description, newYear, b.start_date, newEnd, b.location || src.location, src.organizer, src.owner,
      'Planning', src.id, 0, `Created from "${src.name}" (${src.event_year}).`
    ));
    const newId = info.lastInsertRowid;

    const skipRemoved = (row) => (row.disposition || '').toUpperCase() === 'REMOVE';

    if (copy.milestones !== false) {
      for (const m of (await db.prepare('SELECT * FROM milestones WHERE event_id=?').all(src.id))) {
        if (skipRemoved(m)) continue;
        (await db.prepare(`INSERT INTO milestones (event_id,name,description,offset_days,owner,status,dependencies,notes,inherited_from) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(newId, m.name, m.description, m.offset_days, m.owner, 'Not Started', m.dependencies, m.notes, m.id));
      }
    }
    if (copy.tasks !== false) {
      const sourceTasks = await db.prepare('SELECT * FROM tasks WHERE event_id=?').all(src.id);
      const taskById = new Map(sourceTasks.map((t) => [Number(t.id), t]));
      const taskMap = new Map();
      const depthOf = (task) => {
        let depth = 0, current = task; const seen = new Set();
        while (current && current.parent_task_id && taskById.has(Number(current.parent_task_id))) {
          if (seen.has(Number(current.id))) break;
          seen.add(Number(current.id)); depth++;
          current = taskById.get(Number(current.parent_task_id));
        }
        return depth;
      };
      const removedByAncestor = (task) => {
        let current = task; const seen = new Set();
        while (current) {
          if (skipRemoved(current)) return true;
          if (seen.has(Number(current.id))) return true;
          seen.add(Number(current.id));
          current = current.parent_task_id ? taskById.get(Number(current.parent_task_id)) : null;
        }
        return false;
      };
      sourceTasks.sort((a, b) => depthOf(a) - depthOf(b) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id));
      for (const t of sourceTasks) {
        if (removedByAncestor(t)) continue;
        const oldParent = t.parent_task_id ? Number(t.parent_task_id) : null;
        if (oldParent && taskById.has(oldParent) && !taskMap.has(oldParent)) continue;
        const newParent = oldParent ? (taskMap.get(oldParent) || null) : null;
        const info = await db.prepare(`INSERT INTO tasks
          (event_id,title,description,phase,owner,assignee,offset_days,priority,status,type,notes,inherited_from,source_event_id,department_id,parent_task_id,sort_order,tags)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          newId, t.title, t.description, t.phase, t.owner, t.assignee, t.offset_days, t.priority, 'Not Started', t.type, t.notes,
          t.id, src.id, t.department_id || null, newParent, Number(t.sort_order) || 0, t.tags || '[]'
        );
        taskMap.set(Number(t.id), Number(info.lastInsertRowid));
        const items = await db.prepare('SELECT * FROM task_checklist_items WHERE task_id=? ORDER BY sort_order,id').all(t.id);
        for (const item of items) await db.prepare('INSERT INTO task_checklist_items (task_id,text,done,sort_order,created_by) VALUES (?,?,0,?,?)')
          .run(info.lastInsertRowid, item.text, item.sort_order || 0, req.user.name);
      }
      // Recreate prerequisite links only when both endpoints were copied.
      const copiedEdges = new Set();
      const sourceEdges = await db.prepare(`SELECT d.task_id,d.depends_on_task_id FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.event_id=?`).all(src.id);
      for (const edge of sourceEdges) {
        const from = taskMap.get(Number(edge.task_id)), to = taskMap.get(Number(edge.depends_on_task_id));
        if (!from || !to || from === to) continue;
        await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_task_id,created_by) VALUES (?,?,?) ON CONFLICT (task_id,depends_on_task_id) DO NOTHING').run(from, to, req.user.name);
        copiedEdges.add(`${edge.task_id}:${edge.depends_on_task_id}`);
        await db.prepare('UPDATE tasks SET dependency_id=? WHERE id=?').run(to, from);
      }
      // Migrate legacy single-dependency tasks during cloning as well.
      for (const t of sourceTasks) {
        if (!t.dependency_id || copiedEdges.has(`${t.id}:${t.dependency_id}`)) continue;
        const from = taskMap.get(Number(t.id)), to = taskMap.get(Number(t.dependency_id));
        if (!from || !to || from === to) continue;
        await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_task_id,created_by) VALUES (?,?,?) ON CONFLICT (task_id,depends_on_task_id) DO NOTHING').run(from, to, req.user.name);
        await db.prepare('UPDATE tasks SET dependency_id=? WHERE id=?').run(to, from);
      }
    }
    if (copy.announcements !== false) {
      for (const a of (await db.prepare('SELECT * FROM announcements WHERE event_id=?').all(src.id))) {
        if (skipRemoved(a)) continue;
        const ai = (await db.prepare(`INSERT INTO announcements (event_id,title,category,phase_group,offset_days,audience,purpose,message,short_version,channel,owner,approval_status,published_status,template_source,inherited_from) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(newId, a.title, a.category, a.phase_group, a.offset_days, a.audience, a.purpose, a.message, a.short_version, a.channel, a.owner, 'Draft', 'Not Published', `Event ${src.event_year}`, a.id));
        (await db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)')
          .run(ai.lastInsertRowid, 1, a.title, a.message, a.short_version, req.user.name, `Inherited from ${src.event_year}`));
      }
    }
    if (copy.communications !== false) {
      for (const c of (await db.prepare('SELECT * FROM communications WHERE event_id=?').all(src.id))) {
        (await db.prepare(`INSERT INTO communications (event_id,title,purpose,audience,channel,offset_days,owner,approval_required,status,message) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(newId, c.title, c.purpose, c.audience, c.channel, c.offset_days, c.owner, c.approval_required, 'Planned', c.message));
      }
    }
    if (copy.checklists !== false) {
      for (const cl of (await db.prepare('SELECT * FROM checklists WHERE event_id=?').all(src.id))) {
        const ci = (await db.prepare('INSERT INTO checklists (event_id,name,category,is_template) VALUES (?,?,?,0)').run(newId, cl.name, cl.category));
        for (const it of (await db.prepare('SELECT * FROM checklist_items WHERE checklist_id=?').all(cl.id)))
          (await db.prepare('INSERT INTO checklist_items (checklist_id,text,done,sort_order) VALUES (?,?,0,?)').run(ci.lastInsertRowid, it.text, it.sort_order));
      }
    }
    if (copy.roles !== false) {
      for (const p of (await db.prepare('SELECT * FROM people WHERE event_id=?').all(src.id)))
        (await db.prepare('INSERT INTO people (event_id,name,role,email,phone,notes) VALUES (?,?,?,?,?,?)').run(newId, p.name, p.role, p.email, p.phone, p.notes));
    }
    // Add lessons->actions as NEW tasks (proposed)
    if (b.apply_lessons !== false) {
      for (const l of (await db.prepare('SELECT * FROM lessons WHERE event_id=? AND (action_next IS NOT NULL AND action_next != \'\')').all(src.id))) {
        (await db.prepare(`INSERT INTO tasks (event_id,title,description,phase,priority,status,type,notes,source_event_id) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(newId, `[From lessons] ${l.action_next}`, l.recommendation, 'Phase 1 — Long-Term Preparation', 'High', 'Not Started', 'Task', `Auto-added from ${src.event_year} lesson: ${l.description}`, src.id));
      }
    }
    return newId;
  });
  const newId = await tx();
  await U.audit(req.user, 'clone', 'event', newId, { from: src.id }, { name: b.name, start_date: b.start_date });
  await U.notify('event', `New draft event created from "${src.name}"`, newId, 'event', newId);
  ok(res, await getEvent(newId));
});

// ---------- TEMPLATES ----------
api.get('/templates', U.authRequired, async (req, res) => ok(res, (await db.prepare('SELECT * FROM templates ORDER BY id DESC').all())));
api.post('/templates', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const { name, event_type, description, data } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = (await db.prepare('INSERT INTO templates (name,event_type,description,data) VALUES (?,?,?,?)').run(name, event_type || null, description || null, JSON.stringify(data || {})));
  await U.audit(req.user, 'create', 'template', info.lastInsertRowid, null, { name });
  ok(res, (await db.prepare('SELECT * FROM templates WHERE id=?').get(info.lastInsertRowid)));
});
// Save an event as template
api.post('/events/:id/save-template', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const sourceTasks = await db.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY sort_order,id').all(ev.id);
  const data = {
    milestones: (await db.prepare('SELECT name,description,offset_days,owner FROM milestones WHERE event_id=?').all(ev.id)),
    tasks: await Promise.all(sourceTasks.map(async (task) => ({
      source_id: task.id, parent_source_id: task.parent_task_id || null,
      title: task.title, description: task.description, phase: task.phase, owner: task.owner, assignee: task.assignee,
      offset_days: task.offset_days, priority: task.priority, type: task.type, sort_order: task.sort_order || 0,
      tags: task.tags || '[]',
      checklist_items: (await db.prepare('SELECT text FROM task_checklist_items WHERE task_id=? ORDER BY sort_order,id').all(task.id)).map((item) => item.text),
      dependencies: (await db.prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id=?').all(task.id)).map((edge) => edge.depends_on_task_id),
    }))),
    announcements: (await db.prepare('SELECT title,category,phase_group,offset_days,audience,purpose,channel FROM announcements WHERE event_id=?').all(ev.id)),
    checklists: await Promise.all((await db.prepare('SELECT id,name,category FROM checklists WHERE event_id=?').all(ev.id)).map(async (c) => ({ ...c, items: (await db.prepare('SELECT text FROM checklist_items WHERE checklist_id=?').all(c.id)).map((i) => i.text) }))),
  };
  const info = (await db.prepare('INSERT INTO templates (name,event_type,description,data) VALUES (?,?,?,?)').run(req.body.name || `${ev.name} Template`, ev.event_type, `Template from ${ev.name}`, JSON.stringify(data)));
  await U.audit(req.user, 'create', 'template', info.lastInsertRowid, null, { from_event: ev.id });
  ok(res, (await db.prepare('SELECT * FROM templates WHERE id=?').get(info.lastInsertRowid)));
});
// Apply template to event
api.post('/events/:id/apply-template/:tid', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const t = (await db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.tid));
  if (!t) return bad(res, 'Template not found', 404);
  let data;
  try { data = JSON.parse(t.data || '{}'); } catch (_) { return bad(res, 'Template data is invalid'); }
  const templateTasks = Array.isArray(data.tasks) ? data.tasks : [];
  const sourceTaskById = new Map(templateTasks.filter((m) => m.source_id !== undefined).map((m) => [Number(m.source_id), m]));
  if (sourceTaskById.size !== templateTasks.filter((m) => m.source_id !== undefined).length) return bad(res, 'Template contains duplicate task references');
  const hierarchy = new Map(), dependencyGraph = new Map();
  for (const task of templateTasks) {
    const id = Number(task.source_id);
    if (task.source_id !== undefined) {
      if (task.parent_source_id && !sourceTaskById.has(Number(task.parent_source_id))) return bad(res, 'Template has a missing parent task');
      if (task.parent_source_id) hierarchy.set(id, [Number(task.parent_source_id)]);
      const dependencies = Array.isArray(task.dependencies) ? task.dependencies.map(Number) : [];
      if (dependencies.some((dep) => !sourceTaskById.has(dep) || dep === id)) return bad(res, 'Template has an invalid task dependency');
      dependencyGraph.set(id, dependencies);
    }
  }
  function hasGraphCycle(graph) {
    const visiting = new Set(), visited = new Set();
    function visit(id) {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const next of graph.get(id) || []) if (visit(next)) return true;
      visiting.delete(id);visited.add(id);return false;
    }
    for (const id of graph.keys()) if (visit(id)) return true;
    return false;
  }
  if (hasGraphCycle(hierarchy)) return bad(res, 'Template task hierarchy contains a cycle');
  if (hasGraphCycle(dependencyGraph)) return bad(res, 'Template dependencies contain a cycle');
  const tx = db.transaction(async () => {
    for (const m of (data.milestones || [])) await db.prepare('INSERT INTO milestones (event_id,name,description,offset_days,owner,status) VALUES (?,?,?,?,?,?)').run(ev.id, m.name, m.description, m.offset_days, m.owner, 'Not Started');
    const taskMap = new Map();
    const depthOf = (task) => {
      let depth = 0, current = task; const seen = new Set();
      while (current && current.parent_source_id && sourceTaskById.has(Number(current.parent_source_id))) {
        const key = Number(current.source_id); if (seen.has(key)) break; seen.add(key); depth++;
        current = sourceTaskById.get(Number(current.parent_source_id));
      }
      return depth;
    };
    templateTasks.sort((a, b) => depthOf(a) - depthOf(b) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
    for (const m of templateTasks) {
      const parentId = m.parent_source_id ? (taskMap.get(Number(m.parent_source_id)) || null) : null;
      const tags = Array.isArray(m.tags) ? JSON.stringify(m.tags) : (m.tags || '[]');
      const info = await db.prepare(`INSERT INTO tasks (event_id,title,description,phase,owner,assignee,offset_days,priority,status,type,parent_task_id,sort_order,tags)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ev.id, m.title, m.description || null, m.phase || null, m.owner || null, m.assignee || '', Number(m.offset_days) || 0, m.priority || 'Medium', 'Not Started', m.type || 'Task', parentId, Number(m.sort_order) || 0, tags);
      if (m.source_id !== undefined) taskMap.set(Number(m.source_id), Number(info.lastInsertRowid));
      for (const text of (m.checklist_items || [])) await db.prepare('INSERT INTO task_checklist_items (task_id,text,done,created_by) VALUES (?,?,0,?)').run(info.lastInsertRowid, text, req.user.name);
    }
    for (const m of templateTasks) {
      const from = taskMap.get(Number(m.source_id)); if (!from) continue;
      for (const sourceDependency of (m.dependencies || [])) {
        const to = taskMap.get(Number(sourceDependency)); if (!to || to === from) continue;
        await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_task_id,created_by) VALUES (?,?,?) ON CONFLICT (task_id,depends_on_task_id) DO NOTHING').run(from, to, req.user.name);
        await db.prepare('UPDATE tasks SET dependency_id=? WHERE id=?').run(to, from);
      }
    }
    for (const m of (data.announcements || [])) await db.prepare('INSERT INTO announcements (event_id,title,category,phase_group,offset_days,audience,purpose,channel,approval_status,published_status) VALUES (?,?,?,?,?,?,?,?,?,?)').run(ev.id, m.title, m.category, m.phase_group, m.offset_days, m.audience, m.purpose, m.channel, 'Draft', 'Not Published');
    for (const c of (data.checklists || [])) { const ci = (await db.prepare('INSERT INTO checklists (event_id,name,category) VALUES (?,?,?)').run(ev.id, c.name, c.category)); for (const it of (c.items || [])) await db.prepare('INSERT INTO checklist_items (checklist_id,text) VALUES (?,?)').run(ci.lastInsertRowid, it); }
  });
  await tx();
  await U.audit(req.user, 'apply-template', 'event', ev.id, null, { template: t.id });
  ok(res, { ok: true });
});

// ---------- ATTACHMENTS ----------
api.get('/attachments', U.authRequired, async (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) return bad(res, 'entity_type and entity_id required');
  if (entity_type === 'task') {
    const task = await db.prepare('SELECT id FROM tasks WHERE id=?').get(entity_id);
    if (!task) return bad(res, 'Task not found', 404);
  }
  ok(res, (await db.prepare('SELECT id,entity_type,entity_id,filename,mimetype,size,uploaded_by,created_at FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all(entity_type, entity_id)));
});
api.post('/attachments', U.authRequired, U.requireRole('Contributor'), upload.single('file'), async (req, res) => {
  const { entity_type, entity_id } = req.body || {};
  if (!req.file) return bad(res, 'No file uploaded');
  if (!entity_type || !entity_id) { try { fs.unlinkSync(req.file.path); } catch (_) {} return bad(res, 'entity_type and entity_id required'); }
  if (entity_type === 'task') {
    const task = await db.prepare('SELECT * FROM tasks WHERE id=?').get(entity_id);
    if (!task) { try { fs.unlinkSync(req.file.path); } catch (_) {} return bad(res, 'Task not found', 404); }
    const ev = await getEvent(task.event_id);
    if (!ev || ev.locked) { try { fs.unlinkSync(req.file.path); } catch (_) {} return bad(res, ev && ev.locked ? 'This event is locked as historical record.' : 'Event not found', ev && ev.locked ? 409 : 404); }
  }
  const info = (await db.prepare('INSERT INTO attachments (entity_type,entity_id,filename,stored_name,mimetype,size,uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(entity_type, entity_id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.name));
  await U.audit(req.user, 'upload', 'attachment', info.lastInsertRowid, null, { entity_type, entity_id, filename: req.file.originalname });
  ok(res, (await db.prepare('SELECT id,entity_type,entity_id,filename,mimetype,size,uploaded_by,created_at FROM attachments WHERE id=?').get(info.lastInsertRowid)));
});
api.get('/attachments/:id/download', U.authRequired, async (req, res) => {
  const a = (await db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id));
  if (!a) return bad(res, 'Not found', 404);
  if (a.entity_type === 'task' && !(await db.prepare('SELECT id FROM tasks WHERE id=?').get(a.entity_id))) return bad(res, 'Task not found', 404);
  const fp = path.join(UPLOAD_DIR, a.stored_name);
  if (!fs.existsSync(fp)) return bad(res, 'File missing on server', 410);
  res.download(fp, a.filename);
});

// ---------- SEARCH / KNOWLEDGE ----------
api.get('/search', U.authRequired, async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return ok(res, []);
  ok(res, await AI.knowledgeSearch(q));
});

// ---------- NOTIFICATIONS ----------
api.get('/notifications', U.authRequired, async (req, res) => {
  await refreshNotifications();
  ok(res, (await db.prepare('SELECT * FROM notifications ORDER BY read, created_at DESC LIMIT 100').all()));
});
api.post('/notifications/:id/read', U.authRequired, async (req, res) => {
  (await db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(req.params.id));
  ok(res, { ok: true });
});
api.post('/notifications/read-all', U.authRequired, async (req, res) => {
  (await db.prepare('UPDATE notifications SET read=1').run());
  ok(res, { ok: true });
});

async function refreshNotifications() {
  const today = U.todayStr();
  const events = (await db.prepare("SELECT * FROM events WHERE status IN ('Planning','Active')").all());
  for (const ev of events) {
    const tasks = (await db.prepare("SELECT * FROM tasks WHERE event_id=? AND status NOT IN ('Completed','Cancelled')").all(ev.id));
    for (const t of tasks) {
      const due = U.computeActual(ev.start_date, t.offset_days, t.date_override);
      if (!due) continue;
      const key = `overdue-task-${t.id}`;
      if (due < today) {
        const exists = (await db.prepare("SELECT id FROM notifications WHERE type='overdue' AND entity_type='task' AND entity_id=? AND date(created_at)=date('now')").get(t.id));
        if (!exists) U.notify('overdue', `Overdue task: ${t.title} (was due ${due})`, ev.id, 'task', t.id);
      }
    }
  }
}

// ---------- DASHBOARD ----------
api.get('/dashboard/:id', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id);
  if (!ev) return bad(res, 'Event not found', 404);
  const today = U.todayStr();
  const tasks = (await db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id));
  const completed = tasks.filter((t) => t.status === 'Completed').length;
  const cancelled = tasks.filter((t) => t.status === 'Cancelled').length;
  const active = tasks.length - cancelled;
  const remaining = active - completed;
  const overdue = tasks.filter((t) => {
    if (['Completed', 'Cancelled'].includes(t.status)) return false;
    const due = U.computeActual(ev.start_date, t.offset_days, t.date_override);
    return due && due < today;
  });
  const milestones = enrichDated((await db.prepare('SELECT * FROM milestones WHERE event_id=?').all(ev.id)), ev.start_date)
    .filter((m) => m.status !== 'Completed' && m.computed_date && m.computed_date >= today)
    .sort((a, b) => (a.computed_date || '').localeCompare(b.computed_date || '')).slice(0, 5);
  const announcements = enrichDated((await db.prepare('SELECT * FROM announcements WHERE event_id=?').all(ev.id)), ev.start_date)
    .filter((a) => a.published_status !== 'Published' && a.computed_date && a.computed_date >= today)
    .sort((a, b) => (a.computed_date || '').localeCompare(b.computed_date || '')).slice(0, 5);
  const pendingApprovals = (await db.prepare("SELECT id,title,approval_status FROM announcements WHERE event_id=? AND approval_status IN ('Review')").all(ev.id));
  const criticalIssues = (await db.prepare("SELECT id,title FROM tasks WHERE event_id=? AND priority='Critical' AND status='Blocked'").all(ev.id));
  const daysUntil = ev.start_date ? U.daysBetween(today, ev.start_date) : null;
  // current phase
  let currentPhase = 'Planning';
  if (daysUntil !== null) {
    if (daysUntil > 60) currentPhase = 'Phase 1 — Long-Term Preparation';
    else if (daysUntil > 30) currentPhase = 'Phase 2 — Planning';
    else if (daysUntil > 14) currentPhase = 'Phase 3 — Final Preparation';
    else if (daysUntil > 2) currentPhase = 'Phase 4 — Final Communication';
    else if (daysUntil > 0) currentPhase = 'Phase 5 — Final Countdown';
    else if (ev.end_date && today <= ev.end_date) currentPhase = 'Phase 6 — Event Execution';
    else if (U.daysBetween(ev.end_date || ev.start_date, today) <= 7) currentPhase = 'Phase 7 — Immediate Follow-Up';
    else currentPhase = 'Phase 8 — Retrospective';
  }
  const timeline = [-120, -60, -30, -14, -2, 0, 7].map((off) => ({
    offset: off, label: U.relLabel(off), date: U.computeActual(ev.start_date, off, null),
    isPast: ev.start_date ? U.computeActual(ev.start_date, off, null) < today : false,
  }));
  ok(res, {
    event: ev,
    currentPhase,
    daysUntil,
    daysSince: (ev.end_date && ev.end_date < today) ? U.daysBetween(ev.end_date, today) : null,
    completion: active ? Math.round((completed / active) * 100) : 0,
    tasksCompleted: completed, tasksRemaining: remaining, tasksTotal: tasks.length, overdue: overdue.length, overdueTasks: overdue.slice(0, 10),
    milestones, announcements, pendingApprovals, criticalIssues, timeline,
  });
});

// ---------- EVENT DAY MODE ----------
api.get('/events/:id/eventday', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const day = req.query.date || U.todayStr();
  const dayActivities = enrichDated((await db.prepare("SELECT * FROM tasks WHERE event_id=? AND type='Event Day Activity'").all(ev.id)), ev.start_date)
    .filter((t) => t.computed_date === day).sort((a, b) => (a.notes || '').localeCompare(b.notes || ''));
  const tasksToday = enrichDated((await db.prepare("SELECT * FROM tasks WHERE event_id=?").all(ev.id)), ev.start_date).filter((t) => t.computed_date === day);
  const anns = enrichDated((await db.prepare('SELECT * FROM announcements WHERE event_id=?').all(ev.id)), ev.start_date).filter((a) => a.computed_date === day);
  const contacts = (await db.prepare('SELECT * FROM people WHERE event_id=?').all(ev.id));
  const eventDayNum = ev.start_date ? (U.daysBetween(ev.start_date, day) + 1) : null;
  ok(res, { event: ev, date: day, eventDayNum, dayActivities, tasksToday, announcements: anns, contacts });
});

// ---------- COMPARISON ----------
api.get('/compare', U.authRequired, async (req, res) => {
  const { a, b } = req.query;
  const ea = await getEvent(a), eb = await getEvent(b);
  if (!ea || !eb) return bad(res, 'Both events required', 404);
  const stats = async (ev) => {
    const tasks = (await db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id));
    const completed = tasks.filter((t) => t.status === 'Completed');
    const onTime = completed.filter((t) => { const due = U.computeActual(ev.start_date, t.offset_days, t.date_override); return due && t.completion_date && t.completion_date <= due; });
    return {
      event: ev,
      tasks: tasks.length,
      tasksCompleted: completed.length,
      onTimePct: completed.length ? Math.round((onTime.length / completed.length) * 100) : 0,
      milestones: (await db.prepare('SELECT COUNT(*) c FROM milestones WHERE event_id=?').get(ev.id)).c,
      announcements: (await db.prepare('SELECT COUNT(*) c FROM announcements WHERE event_id=?').get(ev.id)).c,
      lessons: (await db.prepare('SELECT COUNT(*) c FROM lessons WHERE event_id=?').get(ev.id)).c,
      participants: ev.participants,
    };
  };
  ok(res, { a: await stats(ea), b: await stats(eb) });
});

// ---------- ANALYTICS (series improvement) ----------
api.get('/analytics/series/:id', U.authRequired, async (req, res) => {
  const events = (await db.prepare('SELECT * FROM events WHERE series_id=? ORDER BY event_year').all(req.params.id));
  const rows = await Promise.all(events.map(async (ev) => {
    const tasks = (await db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id));
    const completed = tasks.filter((t) => t.status === 'Completed');
    const onTime = completed.filter((t) => { const due = U.computeActual(ev.start_date, t.offset_days, t.date_override); return due && t.completion_date && t.completion_date <= due; });
    return {
      id: ev.id, year: ev.event_year, name: ev.name, status: ev.status,
      onTimePct: completed.length ? Math.round((onTime.length / completed.length) * 100) : 0,
      completionPct: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
      announcements: (await db.prepare('SELECT COUNT(*) c FROM announcements WHERE event_id=?').get(ev.id)).c,
      lessons: (await db.prepare('SELECT COUNT(*) c FROM lessons WHERE event_id=?').get(ev.id)).c,
      participants: ev.participants,
    };
  }));
  ok(res, { events: rows, recurringIssues: await AI.recurringIssues(Number(req.params.id)) });
});

// ---------- AUDIT ----------
api.get('/audit', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const { entity_type, entity_id, limit } = req.query;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1', params = [];
  if (entity_type) { sql += ' AND entity_type=?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND entity_id=?'; params.push(entity_id); }
  sql += ' ORDER BY id DESC LIMIT ?'; params.push(Number(limit) || 200);
  ok(res, (await db.prepare(sql).all(...params)));
});

// ---------- CATEGORIES ----------
api.get('/categories', U.authRequired, async (req, res) => ok(res, (await db.prepare('SELECT * FROM categories ORDER BY group_name,name').all())));
api.post('/categories', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
  const { group_name, name } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = (await db.prepare('INSERT INTO categories (group_name,name) VALUES (?,?)').run(group_name || 'Custom', name));
  ok(res, (await db.prepare('SELECT * FROM categories WHERE id=?').get(info.lastInsertRowid)));
});

// ---------- AI ----------
api.post('/ai/timeline', U.authRequired, async (req, res) => {
  const { start_date } = req.body || {};
  if (!start_date) return bad(res, 'start_date required');
  ok(res, { note: 'AI Suggested draft — review before applying.', items: AI.generateTimeline(start_date) });
});
api.post('/events/:id/ai/apply-timeline', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
  const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const items = AI.generateTimeline(ev.start_date);
  const tx = db.transaction(async () => {
    for (const it of items) {
      if (it.type === 'Milestone') (await db.prepare('INSERT INTO milestones (event_id,name,offset_days,status,notes) VALUES (?,?,?,?,?)').run(ev.id, it.name, it.offset, 'Not Started', 'AI Suggested'));
      else if (it.type === 'Announcement') (await db.prepare('INSERT INTO announcements (event_id,title,phase_group,offset_days,approval_status,published_status,template_source) VALUES (?,?,?,?,?,?,?)').run(ev.id, it.name, it.phase, it.offset, 'Draft', 'Not Published', 'AI Suggested'));
      else (await db.prepare('INSERT INTO tasks (event_id,title,phase,offset_days,status,type,notes) VALUES (?,?,?,?,?,?,?)').run(ev.id, it.name, it.phase, it.offset, 'Not Started', 'Task', 'AI Suggested'));
    }
  });
  await tx();
  await U.audit(req.user, 'ai-apply-timeline', 'event', ev.id, null, { count: items.length });
  ok(res, { ok: true, count: items.length });
});
api.get('/events/:id/ai/analyze-announcements', U.authRequired, async (req, res) => ok(res, { findings: await AI.analyzeAnnouncements(Number(req.params.id)) }));
api.get('/events/:id/ai/extract-lessons', U.authRequired, async (req, res) => ok(res, { proposals: await AI.extractLessons(Number(req.params.id)) }));
api.post('/events/:id/ai/draft-announcement', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const prev = req.body.previous_id ? (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.body.previous_id)) : null;
  ok(res, AI.draftAnnouncement({ previous: prev, event: ev, audience: req.body.audience, purpose: req.body.purpose, timing: req.body.timing }));
});

// ---------- REPORTS ----------
api.get('/events/:id/report/:type', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const type = req.params.type;
  if (type === 'summary') {
    ok(res, {
      event: ev,
      milestones: enrichDated((await db.prepare('SELECT * FROM milestones WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      tasks: enrichDated((await db.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      announcements: enrichDated((await db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      lessons: (await db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id)),
    });
  } else if (type === 'communication') {
    ok(res, { event: ev, announcements: enrichDated((await db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date) });
  } else if (type === 'lessons') {
    ok(res, { event: ev, lessons: (await db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id)) });
  } else if (type === 'playbook') {
    ok(res, {
      event: ev,
      series: ev.series_id ? (await db.prepare('SELECT * FROM event_series WHERE id=?').get(ev.series_id)) : null,
      milestones: enrichDated((await db.prepare('SELECT * FROM milestones WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      tasks: enrichDated((await db.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      announcements: enrichDated((await db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      communications: enrichDated((await db.prepare('SELECT * FROM communications WHERE event_id=? ORDER BY offset_days').all(ev.id)), ev.start_date),
      checklists: await Promise.all((await db.prepare('SELECT * FROM checklists WHERE event_id=?').all(ev.id)).map(async (c) => ({ ...c, items: (await db.prepare('SELECT * FROM checklist_items WHERE checklist_id=?').all(c.id)) }))),
      people: (await db.prepare('SELECT * FROM people WHERE event_id=?').all(ev.id)),
      lessons: (await db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id)),
    });
  } else if (type === 'next-prep') {
    const lessons = (await db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id));
    ok(res, { event: ev, actions: lessons.filter((l) => l.action_next).map((l) => ({ action: l.action_next, from: l.description, priority: l.priority })) });
  } else return bad(res, 'Unknown report type');
});

// CSV export
api.get('/events/:id/export/:kind.csv', U.authRequired, async (req, res) => {
  const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const kind = req.params.kind;
  let rows = [], headers = [];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  if (kind === 'tasks') { headers = ['title', 'phase', 'owner', 'priority', 'status', 'relative', 'computed_date']; rows = enrichDated((await db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id)), ev.start_date); }
  else if (kind === 'announcements') { headers = ['title', 'category', 'audience', 'channel', 'approval_status', 'published_status', 'relative', 'computed_date']; rows = enrichDated((await db.prepare('SELECT * FROM announcements WHERE event_id=?').all(ev.id)), ev.start_date); }
  else if (kind === 'milestones') { headers = ['name', 'owner', 'status', 'relative', 'computed_date']; rows = enrichDated((await db.prepare('SELECT * FROM milestones WHERE event_id=?').all(ev.id)), ev.start_date); }
  else if (kind === 'lessons') { headers = ['category', 'description', 'impact', 'recommendation', 'priority', 'action_next']; rows = (await db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id)); }
  else return bad(res, 'Unknown export kind');
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${ev.name.replace(/\W+/g, '_')}_${kind}.csv"`);
  res.send(csv);
});

// full backup export (admin)
api.get('/backup', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  const dump = {};
  for (const t of ['users', 'event_series', 'events', 'milestones', 'tasks', 'task_checklist_items', 'task_comments', 'task_dependencies', 'announcements', 'announcement_versions', 'communications', 'checklists', 'checklist_items', 'people', 'lessons', 'retrospectives', 'templates', 'attachments', 'approvals', 'audit_logs', 'categories']) {
    dump[t] = (await db.prepare(`SELECT * FROM ${t}`).all());
    if (t === 'users') dump[t] = dump[t].map((u) => ({ ...u, password_hash: '[redacted]' }));
  }
  res.setHeader('Content-Disposition', 'attachment; filename="eventplaybook-backup.json"');
  ok(res, dump);
});

// list automatic database snapshots (admin)
api.get('/backups', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  ok(res, Backup.listBackups());
});
// trigger a snapshot now (admin)
api.post('/backups/run', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  const dest = await Backup.runBackup('manual');
  if (!dest) return bad(res, 'Backup failed', 500);
  await U.audit(req.user, 'backup', 'database', null, null, { file: path.basename(dest) });
  ok(res, { ok: true, file: path.basename(dest) });
});
// download a specific snapshot file (admin)
api.get('/backups/:name/download', U.authRequired, U.requireRole('Administrator'), async (req, res) => {
  const name = path.basename(req.params.name); // prevent path traversal
  if (!/^eventplaybook-[\w.\-]+\.(db|json)$/.test(name)) return bad(res, 'Invalid backup name');
  const fp = path.join(Backup.BACKUP_DIR, name);
  if (!fs.existsSync(fp)) return bad(res, 'Backup not found', 404);
  res.download(fp, name);
});

// ---------- Shibir-specific routes (Core Team, Departments, Venues, Caterers, Registration, Setup, Approval) ----------
require('./shibir')(api, U.audit);

// ---------- error handling ----------
api.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Unsupported file type/.test(err.message)) return bad(res, err.message);
  console.error('API error:', err.message);
  bad(res, 'Internal server error', 500);
});

// static frontend
// PWA files: correct MIME types + keep the service worker fresh (never long-cache it)
app.get('/sw.js', async (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
app.get('/manifest.webmanifest', async (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, '..', 'public', 'manifest.webmanifest'));
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', async (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  // Create schema / run migrations before serving any request.
  const { init } = require('./db');
  await init();

  // Auto-seed demo data on first boot if the database is empty (fresh deploy)
  try {
    const userCount = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
    if (userCount === 0 && process.env.NO_AUTO_SEED !== '1') {
      const { seed } = require('./seed');
      await seed();
      console.log('First boot: demo data seeded.');
    }
  } catch (e) {
    console.error('Auto-seed check failed:', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EventPlaybook running on http://0.0.0.0:${PORT}`);
    Backup.start(); // begin automatic database backups
  });
}

bootstrap().catch((e) => {
  console.error('FATAL: failed to start:', e);
  process.exit(1);
});

module.exports = app;
