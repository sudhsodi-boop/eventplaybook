'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('./db');
const U = require('./util');
const AI = require('./ai');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

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

// ---------- helpers ----------
function ok(res, data) { res.json(data); }
function bad(res, msg, code = 400) { res.status(code).json({ error: msg }); }
function getEvent(id) { return db.prepare('SELECT * FROM events WHERE id=?').get(id); }
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
api.post('/auth/register', (req, res) => {
  const { name, email, password, role } = req.body || {};
  const errors = U.validate({ name: { required: true }, email: { required: true }, password: { required: true } }, req.body || {});
  if (errors.length) return bad(res, errors.join('; '));
  if (String(password).length < 6) return bad(res, 'Password must be at least 6 characters');
  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (exists) return bad(res, 'Email already registered', 409);
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  // First user becomes Administrator; otherwise requested role limited to Viewer/Contributor unless created by admin
  const assignedRole = count === 0 ? 'Administrator' : (['Viewer', 'Contributor'].includes(role) ? role : 'Viewer');
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, hash, assignedRole);
  const user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(info.lastInsertRowid);
  U.audit(user, 'create', 'user', user.id, null, { email, role: assignedRole });
  ok(res, { token: U.signToken(user), user });
});

api.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, 'Email and password required');
  const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!row || !bcrypt.compareSync(String(password), row.password_hash)) return bad(res, 'Invalid email or password', 401);
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  ok(res, { token: U.signToken(user), user });
});

api.get('/auth/me', U.authRequired, (req, res) => {
  const row = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.user.id);
  if (!row) return bad(res, 'User not found', 404);
  ok(res, { user: row });
});

// ---------- USERS (admin) ----------
api.get('/users', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  ok(res, db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id').all());
});
api.put('/users/:id/role', U.authRequired, U.requireRole('Administrator'), (req, res) => {
  const { role } = req.body || {};
  if (!U.ROLE_LEVEL[role]) return bad(res, 'Invalid role');
  const old = db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id);
  if (!old) return bad(res, 'User not found', 404);
  db.prepare('UPDATE users SET role=?, updated_at=datetime(\'now\') WHERE id=?').run(role, req.params.id);
  U.audit(req.user, 'update', 'user', req.params.id, { role: old.role }, { role });
  ok(res, { ok: true });
});

// ---------- EVENT SERIES ----------
api.get('/series', U.authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM event_series ORDER BY name').all();
  for (const s of rows) s.events = db.prepare('SELECT id,name,event_year,status,start_date FROM events WHERE series_id=? ORDER BY event_year').all(s.id);
  ok(res, rows);
});
api.post('/series', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const { name, event_type, description } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)').run(name, event_type || null, description || null);
  U.audit(req.user, 'create', 'series', info.lastInsertRowid, null, { name });
  ok(res, db.prepare('SELECT * FROM event_series WHERE id=?').get(info.lastInsertRowid));
});

// ---------- EVENTS ----------
api.get('/events', U.authRequired, (req, res) => {
  const { status, year, q, series_id } = req.query;
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status=?'; params.push(status); }
  if (year) { sql += ' AND event_year=?'; params.push(Number(year)); }
  if (series_id) { sql += ' AND series_id=?'; params.push(Number(series_id)); }
  if (q) { sql += ' AND (name LIKE ? OR location LIKE ? OR event_type LIKE ?)'; const l = `%${q}%`; params.push(l, l, l); }
  sql += ' ORDER BY COALESCE(start_date, created_at) DESC';
  ok(res, db.prepare(sql).all(...params));
});

api.get('/events/:id', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev) return bad(res, 'Event not found', 404);
  ev.series = ev.series_id ? db.prepare('SELECT * FROM event_series WHERE id=?').get(ev.series_id) : null;
  ev.previous_event = ev.previous_event_id ? db.prepare('SELECT id,name,event_year FROM events WHERE id=?').get(ev.previous_event_id) : null;
  ev.next_event = db.prepare('SELECT id,name,event_year FROM events WHERE previous_event_id=?').get(ev.id) || null;
  ok(res, ev);
});

const EVENT_STATUSES = ['Planning', 'Active', 'Completed', 'Cancelled', 'Archived'];
api.post('/events', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const b = req.body || {};
  const errors = U.validate({ name: { required: true }, start_date: { date: true }, end_date: { date: true }, status: { enum: EVENT_STATUSES } }, b);
  if (errors.length) return bad(res, errors.join('; '));
  let seriesId = b.series_id || null;
  if (!seriesId && b.create_series && b.name) {
    const si = db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)').run(b.series_name || b.name, b.event_type || null, null);
    seriesId = si.lastInsertRowid;
  }
  const year = b.event_year || (b.start_date ? Number(b.start_date.slice(0, 4)) : null);
  const info = db.prepare(`INSERT INTO events (series_id,name,event_type,description,event_year,start_date,end_date,location,organizer,owner,status,previous_event_id,participants,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    seriesId, b.name, b.event_type || null, b.description || null, year, b.start_date || null, b.end_date || null,
    b.location || null, b.organizer || null, b.owner || null, b.status || 'Planning', b.previous_event_id || null,
    b.participants || 0, b.notes || null
  );
  const ev = getEvent(info.lastInsertRowid);
  U.audit(req.user, 'create', 'event', ev.id, null, { name: ev.name, year });
  ok(res, ev);
});

api.put('/events/:id', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  const ev = getEvent(req.params.id);
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
  db.prepare(`UPDATE events SET ${sets.join(',')} WHERE id=?`).run(...params);
  const updated = getEvent(req.params.id);
  U.audit(req.user, 'update', 'event', ev.id, { status: ev.status, start_date: ev.start_date }, { status: updated.status, start_date: updated.start_date });
  // If completed, auto-create draft retrospective + AI lessons
  if (b.status === 'Completed' && ev.status !== 'Completed') {
    autoRetrospective(updated, req.user);
  }
  ok(res, updated);
});

// lock/unlock (admin only)
api.post('/events/:id/lock', U.authRequired, U.requireRole('Administrator'), (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const lock = req.body && req.body.locked === false ? 0 : 1;
  db.prepare('UPDATE events SET locked=? WHERE id=?').run(lock, ev.id);
  U.audit(req.user, lock ? 'lock' : 'unlock', 'event', ev.id, { locked: ev.locked }, { locked: lock });
  ok(res, { ok: true, locked: !!lock });
});

api.delete('/events/:id', U.authRequired, U.requireRole('Administrator'), (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  if (ev.locked) return bad(res, 'Cannot delete a locked historical event', 409);
  db.prepare('DELETE FROM events WHERE id=?').run(ev.id);
  U.audit(req.user, 'delete', 'event', ev.id, { name: ev.name }, null);
  ok(res, { ok: true });
});

// ---------- PHASES ----------
api.get('/events/:id/phases', U.authRequired, (req, res) => {
  ok(res, db.prepare('SELECT * FROM phases WHERE event_id=? ORDER BY sort_order').all(req.params.id));
});

// ---------- generic CRUD factory for dated child entities ----------
function datedRoutes(name, table, fields, opts = {}) {
  // list for an event
  api.get(`/events/:id/${name}`, U.authRequired, (req, res) => {
    const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
    let rows = db.prepare(`SELECT * FROM ${table} WHERE event_id=? ORDER BY COALESCE(offset_days,0)`).all(req.params.id);
    rows = enrichDated(rows, ev.start_date);
    ok(res, rows);
  });
  api.post(`/events/:id/${name}`, U.authRequired, U.requireRole('Contributor'), (req, res) => {
    const ev = getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (opts.required) { const e = U.validate(opts.required, b); if (e.length) return bad(res, e.join('; ')); }
    const cols = ['event_id', ...fields.filter((f) => f in b)];
    const vals = [req.params.id, ...fields.filter((f) => f in b).map((f) => b[f])];
    const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(info.lastInsertRowid);
    U.audit(req.user, 'create', name, row.id, null, b);
    ok(res, enrichDated([row], ev.start_date)[0]);
  });
  api.put(`/${name}/:itemId`, U.authRequired, U.requireRole('Contributor'), (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId);
    if (!row) return bad(res, `${name} not found`, 404);
    const ev = getEvent(row.event_id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of fields) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
    if (!sets.length) return bad(res, 'No fields to update');
    if (fields.includes('updated_at')) {} // handled below
    params.push(req.params.itemId);
    db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...params);
    const updated = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId);
    U.audit(req.user, 'update', name, row.id, row, b);
    if (opts.onUpdate) opts.onUpdate(row, updated, req.user);
    ok(res, enrichDated([updated], ev.start_date)[0]);
  });
  api.delete(`/${name}/:itemId`, U.authRequired, U.requireRole('Coordinator'), (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.itemId);
    if (!row) return bad(res, `${name} not found`, 404);
    const ev = getEvent(row.event_id); if (!assertUnlocked(res, ev)) return;
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.itemId);
    U.audit(req.user, 'delete', name, row.id, row, null);
    ok(res, { ok: true });
  });
}

datedRoutes('milestones', 'milestones', ['name', 'description', 'offset_days', 'date_override', 'actual_date', 'owner', 'status', 'completion_date', 'dependencies', 'notes', 'disposition'], { required: { name: { required: true } } });

datedRoutes('tasks', 'tasks', ['title', 'description', 'phase', 'owner', 'assignee', 'offset_days', 'date_override', 'actual_date', 'priority', 'status', 'dependency_id', 'completion_date', 'notes', 'type', 'disposition'], {
  required: { title: { required: true } },
  onUpdate: (oldRow, newRow, user) => {
    if (newRow.status === 'Completed' && oldRow.status !== 'Completed' && !newRow.completion_date) {
      db.prepare("UPDATE tasks SET completion_date=date('now') WHERE id=?").run(newRow.id);
    }
    if (newRow.status === 'Blocked' && oldRow.status !== 'Blocked') {
      U.notify('blocked', `Task blocked: ${newRow.title}`, newRow.event_id, 'task', newRow.id);
    }
  },
});

datedRoutes('communications', 'communications', ['title', 'purpose', 'audience', 'channel', 'offset_days', 'date_override', 'owner', 'approval_required', 'status', 'message', 'related_task_id', 'related_milestone_id', 'lessons_learned'], { required: { title: { required: true } } });

// bulk task status
api.post('/tasks/bulk-status', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const { ids, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || !status) return bad(res, 'ids[] and status required');
  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
      if (!row) continue;
      const ev = getEvent(row.event_id); if (ev && ev.locked) continue;
      db.prepare("UPDATE tasks SET status=?, completion_date=CASE WHEN ?='Completed' THEN date('now') ELSE completion_date END, updated_at=datetime('now') WHERE id=?").run(status, status, id);
      U.audit(req.user, 'update', 'task', id, { status: row.status }, { status });
    }
  });
  tx();
  ok(res, { ok: true, count: ids.length });
});

// ---------- ANNOUNCEMENTS ----------
const ANN_APPROVAL = ['Draft', 'Review', 'Approved', 'Scheduled', 'Published', 'Cancelled', 'Archived'];
api.get('/events/:id/announcements', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  let rows = db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY COALESCE(offset_days,0)').all(req.params.id);
  ok(res, enrichDated(rows, ev.start_date));
});
api.get('/announcements/:id', U.authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = getEvent(a.event_id);
  a.versions = db.prepare('SELECT * FROM announcement_versions WHERE announcement_id=? ORDER BY version DESC').all(a.id);
  a.approvals = db.prepare("SELECT * FROM approvals WHERE entity_type='announcement' AND entity_id=? ORDER BY id DESC").all(a.id);
  ok(res, enrichDated([a], ev ? ev.start_date : null)[0]);
});
const ANN_FIELDS = ['title', 'category', 'phase_group', 'offset_days', 'date_override', 'audience', 'purpose', 'message', 'short_version', 'channel', 'owner', 'approval_status', 'published_status', 'publication_date', 'template_source', 'lessons_learned', 'next_year_recommendation', 'disposition'];
api.post('/events/:id/announcements', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const ev = getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  if (!b.title) return bad(res, 'title is required');
  const cols = ['event_id', ...ANN_FIELDS.filter((f) => f in b)];
  const vals = [req.params.id, ...ANN_FIELDS.filter((f) => f in b).map((f) => b[f])];
  const info = db.prepare(`INSERT INTO announcements (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)')
    .run(a.id, 1, a.title, a.message, a.short_version, req.user.name, 'Initial version');
  U.audit(req.user, 'create', 'announcement', a.id, null, { title: a.title });
  ok(res, enrichDated([a], ev.start_date)[0]);
});
api.put('/announcements/:id', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = getEvent(a.event_id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  const contentChanged = ('message' in b && b.message !== a.message) || ('title' in b && b.title !== a.title) || ('short_version' in b && b.short_version !== a.short_version);
  const sets = [], params = [];
  for (const f of ANN_FIELDS) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (!sets.length) return bad(res, 'No fields to update');
  let newVersion = a.version;
  if (contentChanged) { newVersion = a.version + 1; sets.push('version=?'); params.push(newVersion); }
  sets.push("updated_at=datetime('now')");
  params.push(req.params.id);
  db.prepare(`UPDATE announcements SET ${sets.join(',')} WHERE id=?`).run(...params);
  const updated = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (contentChanged) {
    db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)')
      .run(a.id, newVersion, updated.title, updated.message, updated.short_version, req.user.name, b.change_reason || 'Content updated');
  }
  U.audit(req.user, 'update', 'announcement', a.id, { title: a.title, approval_status: a.approval_status }, { title: updated.title, approval_status: updated.approval_status });
  ok(res, enrichDated([updated], ev.start_date)[0]);
});
api.post('/announcements/:id/duplicate', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!a) return bad(res, 'Announcement not found', 404);
  const info = db.prepare(`INSERT INTO announcements (event_id,title,category,phase_group,offset_days,date_override,audience,purpose,message,short_version,channel,owner,approval_status,published_status,previous_version_id,template_source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a.event_id, a.title + ' (copy)', a.category, a.phase_group, a.offset_days, a.date_override, a.audience, a.purpose, a.message, a.short_version, a.channel, a.owner, 'Draft', 'Not Published', a.id, a.template_source);
  const copy = db.prepare('SELECT * FROM announcements WHERE id=?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)').run(copy.id, 1, copy.title, copy.message, copy.short_version, req.user.name, 'Duplicated');
  U.audit(req.user, 'create', 'announcement', copy.id, null, { duplicated_from: a.id });
  ok(res, copy);
});
api.delete('/announcements/:id', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = getEvent(a.event_id); if (!assertUnlocked(res, ev)) return;
  db.prepare('DELETE FROM announcements WHERE id=?').run(a.id);
  U.audit(req.user, 'delete', 'announcement', a.id, { title: a.title }, null);
  ok(res, { ok: true });
});

// Approval workflow transitions
api.post('/announcements/:id/transition', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!a) return bad(res, 'Announcement not found', 404);
  const ev = getEvent(a.event_id); if (!assertUnlocked(res, ev)) return;
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
  db.prepare(`UPDATE announcements SET ${sets}, updated_at=datetime('now') WHERE id=?`).run(...Object.values(patch), a.id);
  db.prepare('INSERT INTO approvals (entity_type,entity_id,status,approver,comments,version) VALUES (?,?,?,?,?,?)').run('announcement', a.id, to, req.user.name, comments || null, a.version);
  U.audit(req.user, 'transition', 'announcement', a.id, { approval_status: a.approval_status }, patch);
  ok(res, db.prepare('SELECT * FROM announcements WHERE id=?').get(a.id));
});

// version compare
api.get('/announcements/:id/compare', U.authRequired, (req, res) => {
  const { v1, v2 } = req.query;
  const a = db.prepare('SELECT * FROM announcement_versions WHERE announcement_id=? AND version=?').get(req.params.id, v1);
  const b = db.prepare('SELECT * FROM announcement_versions WHERE announcement_id=? AND version=?').get(req.params.id, v2);
  if (!a || !b) return bad(res, 'One or both versions not found', 404);
  ok(res, { v1: a, v2: b });
});

// ---------- CHECKLISTS ----------
api.get('/checklists', U.authRequired, (req, res) => {
  const { event_id, template } = req.query;
  let sql = 'SELECT * FROM checklists WHERE 1=1', params = [];
  if (event_id) { sql += ' AND event_id=?'; params.push(event_id); }
  if (template === '1') { sql += ' AND is_template=1'; }
  sql += ' ORDER BY id DESC';
  const lists = db.prepare(sql).all(...params);
  for (const l of lists) l.items = db.prepare('SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY sort_order,id').all(l.id);
  ok(res, lists);
});
api.post('/checklists', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const { event_id, name, category, is_template, items } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = db.prepare('INSERT INTO checklists (event_id,name,category,is_template) VALUES (?,?,?,?)').run(event_id || null, name, category || null, is_template ? 1 : 0);
  const id = info.lastInsertRowid;
  if (Array.isArray(items)) items.forEach((t, i) => db.prepare('INSERT INTO checklist_items (checklist_id,text,sort_order) VALUES (?,?,?)').run(id, typeof t === 'string' ? t : t.text, i));
  U.audit(req.user, 'create', 'checklist', id, null, { name });
  const l = db.prepare('SELECT * FROM checklists WHERE id=?').get(id);
  l.items = db.prepare('SELECT * FROM checklist_items WHERE checklist_id=? ORDER BY sort_order,id').all(id);
  ok(res, l);
});
api.post('/checklists/:id/items', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const { text } = req.body || {};
  if (!text) return bad(res, 'text is required');
  const c = db.prepare('SELECT * FROM checklists WHERE id=?').get(req.params.id);
  if (!c) return bad(res, 'Checklist not found', 404);
  const info = db.prepare('INSERT INTO checklist_items (checklist_id,text) VALUES (?,?)').run(req.params.id, text);
  ok(res, db.prepare('SELECT * FROM checklist_items WHERE id=?').get(info.lastInsertRowid));
});
api.put('/checklist-items/:id', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const it = db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id);
  if (!it) return bad(res, 'Item not found', 404);
  const b = req.body || {};
  const sets = [], params = [];
  if ('done' in b) { sets.push('done=?'); params.push(b.done ? 1 : 0); }
  if ('text' in b) { sets.push('text=?'); params.push(b.text); }
  if (!sets.length) return bad(res, 'Nothing to update');
  params.push(req.params.id);
  db.prepare(`UPDATE checklist_items SET ${sets.join(',')} WHERE id=?`).run(...params);
  ok(res, db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id));
});
api.delete('/checklists/:id', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  db.prepare('DELETE FROM checklists WHERE id=?').run(req.params.id);
  U.audit(req.user, 'delete', 'checklist', req.params.id, null, null);
  ok(res, { ok: true });
});

// ---------- PEOPLE / ROLES ----------
api.get('/events/:id/people', U.authRequired, (req, res) => ok(res, db.prepare('SELECT * FROM people WHERE event_id=? ORDER BY role').all(req.params.id)));
api.post('/events/:id/people', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const ev = getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const b = req.body || {};
  if (!b.name) return bad(res, 'name is required');
  const info = db.prepare('INSERT INTO people (event_id,name,role,email,phone,notes) VALUES (?,?,?,?,?,?)').run(req.params.id, b.name, b.role || null, b.email || null, b.phone || null, b.notes || null);
  U.audit(req.user, 'create', 'person', info.lastInsertRowid, null, b);
  ok(res, db.prepare('SELECT * FROM people WHERE id=?').get(info.lastInsertRowid));
});
api.put('/people/:id', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id=?').get(req.params.id);
  if (!p) return bad(res, 'Person not found', 404);
  const b = req.body || {};
  const sets = [], params = [];
  for (const f of ['name', 'role', 'email', 'phone', 'notes']) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (!sets.length) return bad(res, 'Nothing to update');
  params.push(req.params.id);
  db.prepare(`UPDATE people SET ${sets.join(',')} WHERE id=?`).run(...params);
  ok(res, db.prepare('SELECT * FROM people WHERE id=?').get(req.params.id));
});
api.delete('/people/:id', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  db.prepare('DELETE FROM people WHERE id=?').run(req.params.id);
  ok(res, { ok: true });
});

// ---------- LESSONS LEARNED ----------
api.get('/events/:id/lessons', U.authRequired, (req, res) => ok(res, db.prepare('SELECT * FROM lessons WHERE event_id=? ORDER BY id DESC').all(req.params.id)));
const LESSON_FIELDS = ['category', 'description', 'impact', 'recommendation', 'priority', 'owner', 'related_task_id', 'related_announcement_id', 'related_milestone_id', 'action_next', 'disposition', 'confirmed', 'source'];
api.post('/events/:id/lessons', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const b = req.body || {};
  if (!b.description) return bad(res, 'description is required');
  const cols = ['event_id', ...LESSON_FIELDS.filter((f) => f in b)];
  const vals = [req.params.id, ...LESSON_FIELDS.filter((f) => f in b).map((f) => b[f])];
  const info = db.prepare(`INSERT INTO lessons (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  U.audit(req.user, 'create', 'lesson', info.lastInsertRowid, null, b);
  ok(res, db.prepare('SELECT * FROM lessons WHERE id=?').get(info.lastInsertRowid));
});
api.put('/lessons/:id', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const l = db.prepare('SELECT * FROM lessons WHERE id=?').get(req.params.id);
  if (!l) return bad(res, 'Lesson not found', 404);
  const b = req.body || {};
  const sets = [], params = [];
  for (const f of LESSON_FIELDS) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
  if (!sets.length) return bad(res, 'Nothing to update');
  params.push(req.params.id);
  db.prepare(`UPDATE lessons SET ${sets.join(',')} WHERE id=?`).run(...params);
  U.audit(req.user, 'update', 'lesson', l.id, l, b);
  ok(res, db.prepare('SELECT * FROM lessons WHERE id=?').get(req.params.id));
});
api.delete('/lessons/:id', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  db.prepare('DELETE FROM lessons WHERE id=?').run(req.params.id);
  U.audit(req.user, 'delete', 'lesson', req.params.id, null, null);
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
api.get('/events/:id/retrospective', U.authRequired, (req, res) => {
  let rows = db.prepare('SELECT * FROM retrospectives WHERE event_id=? ORDER BY id').all(req.params.id);
  ok(res, rows);
});
api.post('/events/:id/retrospective/init', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const existing = db.prepare('SELECT COUNT(*) c FROM retrospectives WHERE event_id=?').get(req.params.id).c;
  if (existing > 0) return ok(res, db.prepare('SELECT * FROM retrospectives WHERE event_id=? ORDER BY id').all(req.params.id));
  const tx = db.transaction(() => {
    for (const [section, question] of RETRO_TEMPLATE) db.prepare('INSERT INTO retrospectives (event_id,section,question) VALUES (?,?,?)').run(req.params.id, section, question);
  });
  tx();
  U.audit(req.user, 'create', 'retrospective', ev.id, null, { init: true });
  ok(res, db.prepare('SELECT * FROM retrospectives WHERE event_id=? ORDER BY id').all(req.params.id));
});
api.put('/retrospective/:id', U.authRequired, U.requireRole('Contributor'), (req, res) => {
  const r = db.prepare('SELECT * FROM retrospectives WHERE id=?').get(req.params.id);
  if (!r) return bad(res, 'Not found', 404);
  db.prepare("UPDATE retrospectives SET answer=? WHERE id=?").run(req.body.answer || '', req.params.id);
  ok(res, db.prepare('SELECT * FROM retrospectives WHERE id=?').get(req.params.id));
});

function autoRetrospective(ev, user) {
  const existing = db.prepare('SELECT COUNT(*) c FROM retrospectives WHERE event_id=?').get(ev.id).c;
  if (existing === 0) {
    const tx = db.transaction(() => {
      for (const [section, question] of RETRO_TEMPLATE) db.prepare('INSERT INTO retrospectives (event_id,section,question) VALUES (?,?,?)').run(ev.id, section, question);
    });
    tx();
  }
  // AI proposed (unconfirmed) lessons
  const proposals = AI.extractLessons(ev.id);
  for (const p of proposals) {
    db.prepare('INSERT INTO lessons (event_id,category,description,recommendation,priority,confirmed,source) VALUES (?,?,?,?,?,0,?)')
      .run(ev.id, p.category, p.description, p.recommendation, p.priority, 'AI Suggested');
  }
  U.notify('retrospective', `Draft retrospective & ${proposals.length} candidate lessons created for "${ev.name}"`, ev.id, 'event', ev.id);
  U.audit(user, 'auto-retrospective', 'event', ev.id, null, { lessons_proposed: proposals.length });
}

// ---------- CREATE FROM PREVIOUS EVENT ----------
api.post('/events/:id/preview-clone', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const src = getEvent(req.params.id);
  if (!src) return bad(res, 'Source event not found', 404);
  // Build KEEP/CHANGE/REMOVE/ADD analysis
  const collect = (table) => db.prepare(`SELECT * FROM ${table} WHERE event_id=?`).all(src.id);
  const analysis = { keep: [], change: [], remove: [], add: [] };
  const bucket = (label, disposition) => {
    const d = (disposition || '').toUpperCase();
    if (d === 'REMOVE') analysis.remove.push(label);
    else if (d === 'MODIFY' || d === 'CHANGE') analysis.change.push(label);
    else analysis.keep.push(label);
  };
  collect('milestones').forEach((m) => bucket(`Milestone: ${m.name}`, m.disposition));
  collect('tasks').forEach((t) => bucket(`Task: ${t.title}`, t.disposition));
  collect('announcements').forEach((a) => bucket(`Announcement: ${a.title}`, a.disposition));
  // lessons -> ADD suggestions
  db.prepare('SELECT * FROM lessons WHERE event_id=?').all(src.id).forEach((l) => {
    if (l.action_next) analysis.add.push(`New action from lesson: ${l.action_next}`);
    else if (l.recommendation) analysis.change.push(`Per lesson (${l.category}): ${l.recommendation}`);
  });
  ok(res, { source: { id: src.id, name: src.name, year: src.event_year }, analysis });
});

api.post('/events/:id/clone', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const src = getEvent(req.params.id);
  if (!src) return bad(res, 'Source event not found', 404);
  const b = req.body || {};
  if (!b.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) return bad(res, 'Valid new start_date (YYYY-MM-DD) is required');
  const copy = b.copy || {};
  const includeRemoved = false; // never carry REMOVE items
  const newYear = b.event_year || Number(b.start_date.slice(0, 4));
  const durationDays = (src.start_date && src.end_date) ? U.daysBetween(src.start_date, src.end_date) : 0;
  const newEnd = b.end_date || U.addDays(b.start_date, durationDays || 0);

  const tx = db.transaction(() => {
    // ensure series
    let seriesId = src.series_id;
    if (!seriesId) {
      const si = db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)').run(src.name, src.event_type, src.description);
      seriesId = si.lastInsertRowid;
      db.prepare('UPDATE events SET series_id=? WHERE id=?').run(seriesId, src.id);
    }
    const newName = b.name || src.name.replace(/\b20\d\d\b/, String(newYear)) || `${src.name} (${newYear})`;
    const info = db.prepare(`INSERT INTO events (series_id,name,event_type,description,event_year,start_date,end_date,location,organizer,owner,status,previous_event_id,participants,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      seriesId, newName, src.event_type, src.description, newYear, b.start_date, newEnd, b.location || src.location, src.organizer, src.owner,
      'Planning', src.id, 0, `Created from "${src.name}" (${src.event_year}).`
    );
    const newId = info.lastInsertRowid;

    const skipRemoved = (row) => (row.disposition || '').toUpperCase() === 'REMOVE';

    if (copy.milestones !== false) {
      for (const m of db.prepare('SELECT * FROM milestones WHERE event_id=?').all(src.id)) {
        if (skipRemoved(m)) continue;
        db.prepare(`INSERT INTO milestones (event_id,name,description,offset_days,owner,status,dependencies,notes,inherited_from) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(newId, m.name, m.description, m.offset_days, m.owner, 'Not Started', m.dependencies, m.notes, m.id);
      }
    }
    if (copy.tasks !== false) {
      for (const t of db.prepare('SELECT * FROM tasks WHERE event_id=?').all(src.id)) {
        if (skipRemoved(t)) continue;
        db.prepare(`INSERT INTO tasks (event_id,title,description,phase,owner,assignee,offset_days,priority,status,type,notes,inherited_from,source_event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(newId, t.title, t.description, t.phase, t.owner, t.assignee, t.offset_days, t.priority, 'Not Started', t.type, t.notes, t.id, src.id);
      }
    }
    if (copy.announcements !== false) {
      for (const a of db.prepare('SELECT * FROM announcements WHERE event_id=?').all(src.id)) {
        if (skipRemoved(a)) continue;
        const ai = db.prepare(`INSERT INTO announcements (event_id,title,category,phase_group,offset_days,audience,purpose,message,short_version,channel,owner,approval_status,published_status,template_source,inherited_from) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(newId, a.title, a.category, a.phase_group, a.offset_days, a.audience, a.purpose, a.message, a.short_version, a.channel, a.owner, 'Draft', 'Not Published', `Event ${src.event_year}`, a.id);
        db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)')
          .run(ai.lastInsertRowid, 1, a.title, a.message, a.short_version, req.user.name, `Inherited from ${src.event_year}`);
      }
    }
    if (copy.communications !== false) {
      for (const c of db.prepare('SELECT * FROM communications WHERE event_id=?').all(src.id)) {
        db.prepare(`INSERT INTO communications (event_id,title,purpose,audience,channel,offset_days,owner,approval_required,status,message) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(newId, c.title, c.purpose, c.audience, c.channel, c.offset_days, c.owner, c.approval_required, 'Planned', c.message);
      }
    }
    if (copy.checklists !== false) {
      for (const cl of db.prepare('SELECT * FROM checklists WHERE event_id=?').all(src.id)) {
        const ci = db.prepare('INSERT INTO checklists (event_id,name,category,is_template) VALUES (?,?,?,0)').run(newId, cl.name, cl.category);
        for (const it of db.prepare('SELECT * FROM checklist_items WHERE checklist_id=?').all(cl.id))
          db.prepare('INSERT INTO checklist_items (checklist_id,text,done,sort_order) VALUES (?,?,0,?)').run(ci.lastInsertRowid, it.text, it.sort_order);
      }
    }
    if (copy.roles !== false) {
      for (const p of db.prepare('SELECT * FROM people WHERE event_id=?').all(src.id))
        db.prepare('INSERT INTO people (event_id,name,role,email,phone,notes) VALUES (?,?,?,?,?,?)').run(newId, p.name, p.role, p.email, p.phone, p.notes);
    }
    // Add lessons->actions as NEW tasks (proposed)
    if (b.apply_lessons !== false) {
      for (const l of db.prepare('SELECT * FROM lessons WHERE event_id=? AND (action_next IS NOT NULL AND action_next != \'\')').all(src.id)) {
        db.prepare(`INSERT INTO tasks (event_id,title,description,phase,priority,status,type,notes,source_event_id) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(newId, `[From lessons] ${l.action_next}`, l.recommendation, 'Phase 1 — Long-Term Preparation', 'High', 'Not Started', 'Task', `Auto-added from ${src.event_year} lesson: ${l.description}`, src.id);
      }
    }
    return newId;
  });
  const newId = tx();
  U.audit(req.user, 'clone', 'event', newId, { from: src.id }, { name: b.name, start_date: b.start_date });
  U.notify('event', `New draft event created from "${src.name}"`, newId, 'event', newId);
  ok(res, getEvent(newId));
});

// ---------- TEMPLATES ----------
api.get('/templates', U.authRequired, (req, res) => ok(res, db.prepare('SELECT * FROM templates ORDER BY id DESC').all()));
api.post('/templates', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const { name, event_type, description, data } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = db.prepare('INSERT INTO templates (name,event_type,description,data) VALUES (?,?,?,?)').run(name, event_type || null, description || null, JSON.stringify(data || {}));
  U.audit(req.user, 'create', 'template', info.lastInsertRowid, null, { name });
  ok(res, db.prepare('SELECT * FROM templates WHERE id=?').get(info.lastInsertRowid));
});
// Save an event as template
api.post('/events/:id/save-template', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const data = {
    milestones: db.prepare('SELECT name,description,offset_days,owner FROM milestones WHERE event_id=?').all(ev.id),
    tasks: db.prepare('SELECT title,description,phase,owner,offset_days,priority,type FROM tasks WHERE event_id=?').all(ev.id),
    announcements: db.prepare('SELECT title,category,phase_group,offset_days,audience,purpose,channel FROM announcements WHERE event_id=?').all(ev.id),
    checklists: db.prepare('SELECT id,name,category FROM checklists WHERE event_id=?').all(ev.id).map((c) => ({ ...c, items: db.prepare('SELECT text FROM checklist_items WHERE checklist_id=?').all(c.id).map((i) => i.text) })),
  };
  const info = db.prepare('INSERT INTO templates (name,event_type,description,data) VALUES (?,?,?,?)').run(req.body.name || `${ev.name} Template`, ev.event_type, `Template from ${ev.name}`, JSON.stringify(data));
  U.audit(req.user, 'create', 'template', info.lastInsertRowid, null, { from_event: ev.id });
  ok(res, db.prepare('SELECT * FROM templates WHERE id=?').get(info.lastInsertRowid));
});
// Apply template to event
api.post('/events/:id/apply-template/:tid', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const ev = getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.tid);
  if (!t) return bad(res, 'Template not found', 404);
  const data = JSON.parse(t.data || '{}');
  const tx = db.transaction(() => {
    (data.milestones || []).forEach((m) => db.prepare('INSERT INTO milestones (event_id,name,description,offset_days,owner,status) VALUES (?,?,?,?,?,?)').run(ev.id, m.name, m.description, m.offset_days, m.owner, 'Not Started'));
    (data.tasks || []).forEach((m) => db.prepare('INSERT INTO tasks (event_id,title,description,phase,owner,offset_days,priority,status,type) VALUES (?,?,?,?,?,?,?,?,?)').run(ev.id, m.title, m.description, m.phase, m.owner, m.offset_days, m.priority || 'Medium', 'Not Started', m.type || 'Task'));
    (data.announcements || []).forEach((m) => db.prepare('INSERT INTO announcements (event_id,title,category,phase_group,offset_days,audience,purpose,channel,approval_status,published_status) VALUES (?,?,?,?,?,?,?,?,?,?)').run(ev.id, m.title, m.category, m.phase_group, m.offset_days, m.audience, m.purpose, m.channel, 'Draft', 'Not Published'));
    (data.checklists || []).forEach((c) => { const ci = db.prepare('INSERT INTO checklists (event_id,name,category) VALUES (?,?,?)').run(ev.id, c.name, c.category); (c.items || []).forEach((it) => db.prepare('INSERT INTO checklist_items (checklist_id,text) VALUES (?,?)').run(ci.lastInsertRowid, it)); });
  });
  tx();
  U.audit(req.user, 'apply-template', 'event', ev.id, null, { template: t.id });
  ok(res, { ok: true });
});

// ---------- ATTACHMENTS ----------
api.get('/attachments', U.authRequired, (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) return bad(res, 'entity_type and entity_id required');
  ok(res, db.prepare('SELECT id,entity_type,entity_id,filename,mimetype,size,uploaded_by,created_at FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY id DESC').all(entity_type, entity_id));
});
api.post('/attachments', U.authRequired, U.requireRole('Contributor'), upload.single('file'), (req, res) => {
  const { entity_type, entity_id } = req.body || {};
  if (!req.file) return bad(res, 'No file uploaded');
  if (!entity_type || !entity_id) return bad(res, 'entity_type and entity_id required');
  const info = db.prepare('INSERT INTO attachments (entity_type,entity_id,filename,stored_name,mimetype,size,uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(entity_type, entity_id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.name);
  U.audit(req.user, 'upload', 'attachment', info.lastInsertRowid, null, { entity_type, entity_id, filename: req.file.originalname });
  ok(res, db.prepare('SELECT id,entity_type,entity_id,filename,mimetype,size,uploaded_by,created_at FROM attachments WHERE id=?').get(info.lastInsertRowid));
});
api.get('/attachments/:id/download', U.authRequired, (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!a) return bad(res, 'Not found', 404);
  const fp = path.join(UPLOAD_DIR, a.stored_name);
  if (!fs.existsSync(fp)) return bad(res, 'File missing on server', 410);
  res.download(fp, a.filename);
});

// ---------- SEARCH / KNOWLEDGE ----------
api.get('/search', U.authRequired, (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return ok(res, []);
  ok(res, AI.knowledgeSearch(q));
});

// ---------- NOTIFICATIONS ----------
api.get('/notifications', U.authRequired, (req, res) => {
  refreshNotifications();
  ok(res, db.prepare('SELECT * FROM notifications ORDER BY read, created_at DESC LIMIT 100').all());
});
api.post('/notifications/:id/read', U.authRequired, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(req.params.id);
  ok(res, { ok: true });
});
api.post('/notifications/read-all', U.authRequired, (req, res) => {
  db.prepare('UPDATE notifications SET read=1').run();
  ok(res, { ok: true });
});

function refreshNotifications() {
  const today = U.todayStr();
  const events = db.prepare("SELECT * FROM events WHERE status IN ('Planning','Active')").all();
  for (const ev of events) {
    const tasks = db.prepare("SELECT * FROM tasks WHERE event_id=? AND status NOT IN ('Completed','Cancelled')").all(ev.id);
    for (const t of tasks) {
      const due = U.computeActual(ev.start_date, t.offset_days, t.date_override);
      if (!due) continue;
      const key = `overdue-task-${t.id}`;
      if (due < today) {
        const exists = db.prepare("SELECT id FROM notifications WHERE type='overdue' AND entity_type='task' AND entity_id=? AND date(created_at)=date('now')").get(t.id);
        if (!exists) U.notify('overdue', `Overdue task: ${t.title} (was due ${due})`, ev.id, 'task', t.id);
      }
    }
  }
}

// ---------- DASHBOARD ----------
api.get('/dashboard/:id', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id);
  if (!ev) return bad(res, 'Event not found', 404);
  const today = U.todayStr();
  const tasks = db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id);
  const completed = tasks.filter((t) => t.status === 'Completed').length;
  const cancelled = tasks.filter((t) => t.status === 'Cancelled').length;
  const active = tasks.length - cancelled;
  const remaining = active - completed;
  const overdue = tasks.filter((t) => {
    if (['Completed', 'Cancelled'].includes(t.status)) return false;
    const due = U.computeActual(ev.start_date, t.offset_days, t.date_override);
    return due && due < today;
  });
  const milestones = enrichDated(db.prepare('SELECT * FROM milestones WHERE event_id=?').all(ev.id), ev.start_date)
    .filter((m) => m.status !== 'Completed' && m.computed_date && m.computed_date >= today)
    .sort((a, b) => (a.computed_date || '').localeCompare(b.computed_date || '')).slice(0, 5);
  const announcements = enrichDated(db.prepare('SELECT * FROM announcements WHERE event_id=?').all(ev.id), ev.start_date)
    .filter((a) => a.published_status !== 'Published' && a.computed_date && a.computed_date >= today)
    .sort((a, b) => (a.computed_date || '').localeCompare(b.computed_date || '')).slice(0, 5);
  const pendingApprovals = db.prepare("SELECT id,title,approval_status FROM announcements WHERE event_id=? AND approval_status IN ('Review')").all(ev.id);
  const criticalIssues = db.prepare("SELECT id,title FROM tasks WHERE event_id=? AND priority='Critical' AND status='Blocked'").all(ev.id);
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
api.get('/events/:id/eventday', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const day = req.query.date || U.todayStr();
  const dayActivities = enrichDated(db.prepare("SELECT * FROM tasks WHERE event_id=? AND type='Event Day Activity'").all(ev.id), ev.start_date)
    .filter((t) => t.computed_date === day).sort((a, b) => (a.notes || '').localeCompare(b.notes || ''));
  const tasksToday = enrichDated(db.prepare("SELECT * FROM tasks WHERE event_id=?").all(ev.id), ev.start_date).filter((t) => t.computed_date === day);
  const anns = enrichDated(db.prepare('SELECT * FROM announcements WHERE event_id=?').all(ev.id), ev.start_date).filter((a) => a.computed_date === day);
  const contacts = db.prepare('SELECT * FROM people WHERE event_id=?').all(ev.id);
  const eventDayNum = ev.start_date ? (U.daysBetween(ev.start_date, day) + 1) : null;
  ok(res, { event: ev, date: day, eventDayNum, dayActivities, tasksToday, announcements: anns, contacts });
});

// ---------- COMPARISON ----------
api.get('/compare', U.authRequired, (req, res) => {
  const { a, b } = req.query;
  const ea = getEvent(a), eb = getEvent(b);
  if (!ea || !eb) return bad(res, 'Both events required', 404);
  const stats = (ev) => {
    const tasks = db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id);
    const completed = tasks.filter((t) => t.status === 'Completed');
    const onTime = completed.filter((t) => { const due = U.computeActual(ev.start_date, t.offset_days, t.date_override); return due && t.completion_date && t.completion_date <= due; });
    return {
      event: ev,
      tasks: tasks.length,
      tasksCompleted: completed.length,
      onTimePct: completed.length ? Math.round((onTime.length / completed.length) * 100) : 0,
      milestones: db.prepare('SELECT COUNT(*) c FROM milestones WHERE event_id=?').get(ev.id).c,
      announcements: db.prepare('SELECT COUNT(*) c FROM announcements WHERE event_id=?').get(ev.id).c,
      lessons: db.prepare('SELECT COUNT(*) c FROM lessons WHERE event_id=?').get(ev.id).c,
      participants: ev.participants,
    };
  };
  ok(res, { a: stats(ea), b: stats(eb) });
});

// ---------- ANALYTICS (series improvement) ----------
api.get('/analytics/series/:id', U.authRequired, (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE series_id=? ORDER BY event_year').all(req.params.id);
  const rows = events.map((ev) => {
    const tasks = db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id);
    const completed = tasks.filter((t) => t.status === 'Completed');
    const onTime = completed.filter((t) => { const due = U.computeActual(ev.start_date, t.offset_days, t.date_override); return due && t.completion_date && t.completion_date <= due; });
    return {
      id: ev.id, year: ev.event_year, name: ev.name, status: ev.status,
      onTimePct: completed.length ? Math.round((onTime.length / completed.length) * 100) : 0,
      completionPct: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
      announcements: db.prepare('SELECT COUNT(*) c FROM announcements WHERE event_id=?').get(ev.id).c,
      lessons: db.prepare('SELECT COUNT(*) c FROM lessons WHERE event_id=?').get(ev.id).c,
      participants: ev.participants,
    };
  });
  ok(res, { events: rows, recurringIssues: AI.recurringIssues(Number(req.params.id)) });
});

// ---------- AUDIT ----------
api.get('/audit', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const { entity_type, entity_id, limit } = req.query;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1', params = [];
  if (entity_type) { sql += ' AND entity_type=?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND entity_id=?'; params.push(entity_id); }
  sql += ' ORDER BY id DESC LIMIT ?'; params.push(Number(limit) || 200);
  ok(res, db.prepare(sql).all(...params));
});

// ---------- CATEGORIES ----------
api.get('/categories', U.authRequired, (req, res) => ok(res, db.prepare('SELECT * FROM categories ORDER BY group_name,name').all()));
api.post('/categories', U.authRequired, U.requireRole('Coordinator'), (req, res) => {
  const { group_name, name } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const info = db.prepare('INSERT INTO categories (group_name,name) VALUES (?,?)').run(group_name || 'Custom', name);
  ok(res, db.prepare('SELECT * FROM categories WHERE id=?').get(info.lastInsertRowid));
});

// ---------- AI ----------
api.post('/ai/timeline', U.authRequired, (req, res) => {
  const { start_date } = req.body || {};
  if (!start_date) return bad(res, 'start_date required');
  ok(res, { note: 'AI Suggested draft — review before applying.', items: AI.generateTimeline(start_date) });
});
api.post('/events/:id/ai/apply-timeline', U.authRequired, U.requireRole('Event Manager'), (req, res) => {
  const ev = getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
  const items = AI.generateTimeline(ev.start_date);
  const tx = db.transaction(() => {
    for (const it of items) {
      if (it.type === 'Milestone') db.prepare('INSERT INTO milestones (event_id,name,offset_days,status,notes) VALUES (?,?,?,?,?)').run(ev.id, it.name, it.offset, 'Not Started', 'AI Suggested');
      else if (it.type === 'Announcement') db.prepare('INSERT INTO announcements (event_id,title,phase_group,offset_days,approval_status,published_status,template_source) VALUES (?,?,?,?,?,?,?)').run(ev.id, it.name, it.phase, it.offset, 'Draft', 'Not Published', 'AI Suggested');
      else db.prepare('INSERT INTO tasks (event_id,title,phase,offset_days,status,type,notes) VALUES (?,?,?,?,?,?,?)').run(ev.id, it.name, it.phase, it.offset, 'Not Started', 'Task', 'AI Suggested');
    }
  });
  tx();
  U.audit(req.user, 'ai-apply-timeline', 'event', ev.id, null, { count: items.length });
  ok(res, { ok: true, count: items.length });
});
api.get('/events/:id/ai/analyze-announcements', U.authRequired, (req, res) => ok(res, { findings: AI.analyzeAnnouncements(Number(req.params.id)) }));
api.get('/events/:id/ai/extract-lessons', U.authRequired, (req, res) => ok(res, { proposals: AI.extractLessons(Number(req.params.id)) }));
api.post('/events/:id/ai/draft-announcement', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const prev = req.body.previous_id ? db.prepare('SELECT * FROM announcements WHERE id=?').get(req.body.previous_id) : null;
  ok(res, AI.draftAnnouncement({ previous: prev, event: ev, audience: req.body.audience, purpose: req.body.purpose, timing: req.body.timing }));
});

// ---------- REPORTS ----------
api.get('/events/:id/report/:type', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const type = req.params.type;
  if (type === 'summary') {
    ok(res, {
      event: ev,
      milestones: enrichDated(db.prepare('SELECT * FROM milestones WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      tasks: enrichDated(db.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      announcements: enrichDated(db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      lessons: db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id),
    });
  } else if (type === 'communication') {
    ok(res, { event: ev, announcements: enrichDated(db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date) });
  } else if (type === 'lessons') {
    ok(res, { event: ev, lessons: db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id) });
  } else if (type === 'playbook') {
    ok(res, {
      event: ev,
      series: ev.series_id ? db.prepare('SELECT * FROM event_series WHERE id=?').get(ev.series_id) : null,
      milestones: enrichDated(db.prepare('SELECT * FROM milestones WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      tasks: enrichDated(db.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      announcements: enrichDated(db.prepare('SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      communications: enrichDated(db.prepare('SELECT * FROM communications WHERE event_id=? ORDER BY offset_days').all(ev.id), ev.start_date),
      checklists: db.prepare('SELECT * FROM checklists WHERE event_id=?').all(ev.id).map((c) => ({ ...c, items: db.prepare('SELECT * FROM checklist_items WHERE checklist_id=?').all(c.id) })),
      people: db.prepare('SELECT * FROM people WHERE event_id=?').all(ev.id),
      lessons: db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id),
    });
  } else if (type === 'next-prep') {
    const lessons = db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id);
    ok(res, { event: ev, actions: lessons.filter((l) => l.action_next).map((l) => ({ action: l.action_next, from: l.description, priority: l.priority })) });
  } else return bad(res, 'Unknown report type');
});

// CSV export
api.get('/events/:id/export/:kind.csv', U.authRequired, (req, res) => {
  const ev = getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
  const kind = req.params.kind;
  let rows = [], headers = [];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  if (kind === 'tasks') { headers = ['title', 'phase', 'owner', 'priority', 'status', 'relative', 'computed_date']; rows = enrichDated(db.prepare('SELECT * FROM tasks WHERE event_id=?').all(ev.id), ev.start_date); }
  else if (kind === 'announcements') { headers = ['title', 'category', 'audience', 'channel', 'approval_status', 'published_status', 'relative', 'computed_date']; rows = enrichDated(db.prepare('SELECT * FROM announcements WHERE event_id=?').all(ev.id), ev.start_date); }
  else if (kind === 'milestones') { headers = ['name', 'owner', 'status', 'relative', 'computed_date']; rows = enrichDated(db.prepare('SELECT * FROM milestones WHERE event_id=?').all(ev.id), ev.start_date); }
  else if (kind === 'lessons') { headers = ['category', 'description', 'impact', 'recommendation', 'priority', 'action_next']; rows = db.prepare('SELECT * FROM lessons WHERE event_id=?').all(ev.id); }
  else return bad(res, 'Unknown export kind');
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${ev.name.replace(/\W+/g, '_')}_${kind}.csv"`);
  res.send(csv);
});

// full backup export (admin)
api.get('/backup', U.authRequired, U.requireRole('Administrator'), (req, res) => {
  const dump = {};
  for (const t of ['users', 'event_series', 'events', 'milestones', 'tasks', 'announcements', 'announcement_versions', 'communications', 'checklists', 'checklist_items', 'people', 'lessons', 'retrospectives', 'templates', 'attachments', 'approvals', 'audit_logs', 'categories']) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
    if (t === 'users') dump[t] = dump[t].map((u) => ({ ...u, password_hash: '[redacted]' }));
  }
  res.setHeader('Content-Disposition', 'attachment; filename="eventplaybook-backup.json"');
  ok(res, dump);
});

// ---------- error handling ----------
api.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Unsupported file type/.test(err.message)) return bad(res, err.message);
  console.error('API error:', err.message);
  bad(res, 'Internal server error', 500);
});

// static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// Auto-seed demo data on first boot if the database is empty (fresh deploy)
try {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0 && process.env.NO_AUTO_SEED !== '1') {
    const { seed } = require('./seed');
    seed();
    console.log('First boot: demo data seeded.');
  }
} catch (e) {
  console.error('Auto-seed check failed:', e.message);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`EventPlaybook running on http://0.0.0.0:${PORT}`));

module.exports = app;
