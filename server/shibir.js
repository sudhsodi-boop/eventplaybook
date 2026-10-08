'use strict';
// Shibir-specific routes: Core Team, Departments, Venues, Caterers,
// Registration config, Setup/planning stage, and Schedule approval.
const { db } = require('./db');
const U = require('./util');

function ok(res, data) { res.json(data); }
function bad(res, msg, code = 400) { res.status(code).json({ error: msg }); }
async function getEvent(id) { return (await db.prepare('SELECT * FROM events WHERE id=?').get(id)); }
function assertUnlocked(res, ev) {
  if (!ev) { bad(res, 'Event not found', 404); return false; }
  if (ev.locked) { bad(res, 'This event is locked as historical record.', 409); return false; }
  return true;
}

// Default departments seeded when a Shibir is set up
const DEFAULT_DEPARTMENTS = [
  ['AV Team', 'Audio/visual, sound, projection, recording'],
  ['Announcement', 'All communications and announcements to participants'],
  ['Kitchen Team', 'Kitchen operations and meal service coordination'],
  ['Hall Management', 'Seating, hall setup, crowd flow, cleanliness'],
  ['Registration', 'Online registration and on-site check-in'],
  ['Food / Caterers', 'Caterer coordination, menu, quantities'],
  ['Venue Coordination', 'Venue liaison, logistics, permissions'],
  ['Event Promotions', 'Promotion, outreach, invitations'],
  ['Pujyashree Seva', 'Seva arrangements for Pujyashree'],
  ['Welcome Ceremony', 'Welcome ceremony planning and execution'],
  ['Transportation', 'Travel, shuttles, parking'],
  ['Accommodation', 'Lodging and stay arrangements'],
  ['Finance / Budget', 'Budgeting, expenses, payments'],
  ['Medical / First-Aid', 'Medical support and emergencies'],
  ['Photography', 'Photography and videography'],
];

module.exports = function registerShibir(api, audit) {
  const A = audit || (() => {});

  // ---------- CORE TEAM ----------
  api.get('/events/:id/core-team', U.authRequired, async (req, res) => {
    ok(res, (await db.prepare('SELECT * FROM core_team WHERE event_id=? ORDER BY is_poc DESC, region, name').all(req.params.id)));
  });
  api.post('/events/:id/core-team', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (!b.name) return bad(res, 'name is required');
    const info = (await db.prepare('INSERT INTO core_team (event_id,name,region,email,phone,is_poc,skills,notes) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.params.id, b.name, b.region || null, b.email || null, b.phone || null, b.is_poc ? 1 : 0, b.skills || null, b.notes || null));
    await A(req.user, 'create', 'core_team', info.lastInsertRowid, null, b);
    ok(res, (await db.prepare('SELECT * FROM core_team WHERE id=?').get(info.lastInsertRowid)));
  });
  api.put('/core-team/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const m = (await db.prepare('SELECT * FROM core_team WHERE id=?').get(req.params.id));
    if (!m) return bad(res, 'Member not found', 404);
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of ['name', 'region', 'email', 'phone', 'is_poc', 'skills', 'notes']) if (f in b) { sets.push(`${f}=?`); params.push(f === 'is_poc' ? (b[f] ? 1 : 0) : b[f]); }
    if (!sets.length) return bad(res, 'Nothing to update');
    params.push(req.params.id);
    (await db.prepare(`UPDATE core_team SET ${sets.join(',')} WHERE id=?`).run(...params));
    await A(req.user, 'update', 'core_team', m.id, m, b);
    ok(res, (await db.prepare('SELECT * FROM core_team WHERE id=?').get(req.params.id)));
  });
  api.delete('/core-team/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    (await db.prepare('DELETE FROM core_team WHERE id=?').run(req.params.id));
    await A(req.user, 'delete', 'core_team', req.params.id, null, null);
    ok(res, { ok: true });
  });

  // ---------- DEPARTMENTS ----------
  api.get('/events/:id/departments', U.authRequired, async (req, res) => {
    const depts = (await db.prepare('SELECT * FROM departments WHERE event_id=? ORDER BY sort_order, id').all(req.params.id));
    for (const d of depts) {
      d.members = (await db.prepare(`SELECT dm.id assign_id, dm.role_in_dept, ct.* FROM department_members dm JOIN core_team ct ON ct.id=dm.member_id WHERE dm.department_id=?`).all(d.id));
      d.lead = d.lead_member_id ? (await db.prepare('SELECT * FROM core_team WHERE id=?').get(d.lead_member_id)) : null;
      const tstats = (await db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) done FROM tasks WHERE department_id=?").get(d.id));
      d.task_total = tstats.total || 0; d.task_done = tstats.done || 0;
    }
    ok(res, depts);
  });
  api.post('/events/:id/departments', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (!b.name) return bad(res, 'name is required');
    const maxOrder = (await db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM departments WHERE event_id=?').get(req.params.id)).m;
    const info = (await db.prepare('INSERT INTO departments (event_id,name,description,lead_member_id,status,sort_order) VALUES (?,?,?,?,?,?)')
      .run(req.params.id, b.name, b.description || null, b.lead_member_id || null, b.status || 'Not Started', maxOrder + 1));
    await A(req.user, 'create', 'department', info.lastInsertRowid, null, b);
    ok(res, (await db.prepare('SELECT * FROM departments WHERE id=?').get(info.lastInsertRowid)));
  });
  // Seed default departments
  api.post('/events/:id/departments/seed-defaults', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const existing = (await db.prepare('SELECT COUNT(*) c FROM departments WHERE event_id=?').get(req.params.id)).c;
    const tx = db.transaction(async () => {
      let order = existing;
      for (const [name, desc] of DEFAULT_DEPARTMENTS) {
        const dup = (await db.prepare('SELECT id FROM departments WHERE event_id=? AND name=?').get(req.params.id, name));
        if (dup) continue;
        (await db.prepare('INSERT INTO departments (event_id,name,description,sort_order) VALUES (?,?,?,?)').run(req.params.id, name, desc, ++order));
      }
    });
    await tx();
    await A(req.user, 'seed-departments', 'event', req.params.id, null, { count: DEFAULT_DEPARTMENTS.length });
    ok(res, (await db.prepare('SELECT * FROM departments WHERE event_id=? ORDER BY sort_order').all(req.params.id)));
  });
  api.put('/departments/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const d = (await db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id));
    if (!d) return bad(res, 'Department not found', 404);
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of ['name', 'description', 'lead_member_id', 'status', 'sort_order']) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
    if (!sets.length) return bad(res, 'Nothing to update');
    params.push(req.params.id);
    (await db.prepare(`UPDATE departments SET ${sets.join(',')} WHERE id=?`).run(...params));
    await A(req.user, 'update', 'department', d.id, d, b);
    ok(res, (await db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id)));
  });
  api.delete('/departments/:id', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
    (await db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id));
    await A(req.user, 'delete', 'department', req.params.id, null, null);
    ok(res, { ok: true });
  });
  // assign / unassign members
  api.post('/departments/:id/members', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const d = (await db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id));
    if (!d) return bad(res, 'Department not found', 404);
    const { member_id, role_in_dept } = req.body || {};
    if (!member_id) return bad(res, 'member_id is required');
    const dup = (await db.prepare('SELECT id FROM department_members WHERE department_id=? AND member_id=?').get(req.params.id, member_id));
    if (dup) return bad(res, 'Member already assigned to this department', 409);
    const info = (await db.prepare('INSERT INTO department_members (department_id,member_id,role_in_dept) VALUES (?,?,?)').run(req.params.id, member_id, role_in_dept || null));
    await A(req.user, 'assign', 'department', d.id, null, { member_id });
    ok(res, { id: info.lastInsertRowid });
  });
  api.delete('/department-members/:assignId', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    (await db.prepare('DELETE FROM department_members WHERE id=?').run(req.params.assignId));
    ok(res, { ok: true });
  });

  // ---------- VENUES ----------
  api.get('/events/:id/venues', U.authRequired, async (req, res) => ok(res, (await db.prepare('SELECT * FROM venues WHERE event_id=? ORDER BY id').all(req.params.id))));
  api.post('/events/:id/venues', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (!b.name) return bad(res, 'name is required');
    const info = (await db.prepare('INSERT INTO venues (event_id,name,location,capacity,cost,suitable_days,contact,pros,cons,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.params.id, b.name, b.location || null, b.capacity || null, b.cost || null, b.suitable_days || null, b.contact || null, b.pros || null, b.cons || null, b.status || 'Candidate', b.notes || null));
    await A(req.user, 'create', 'venue', info.lastInsertRowid, null, b);
    ok(res, (await db.prepare('SELECT * FROM venues WHERE id=?').get(info.lastInsertRowid)));
  });
  api.put('/venues/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const v = (await db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id));
    if (!v) return bad(res, 'Venue not found', 404);
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of ['name', 'location', 'capacity', 'cost', 'suitable_days', 'contact', 'pros', 'cons', 'status', 'notes']) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
    if (!sets.length) return bad(res, 'Nothing to update');
    params.push(req.params.id);
    (await db.prepare(`UPDATE venues SET ${sets.join(',')} WHERE id=?`).run(...params));
    // Selecting a venue updates the event
    if (b.status === 'Selected') {
      (await db.prepare('UPDATE venues SET status=? WHERE event_id=? AND id!=?').run('Candidate', v.event_id, v.id));
      (await db.prepare("UPDATE events SET venue_id=?, location=?, updated_at=datetime('now') WHERE id=?").run(v.id, v.location || v.name, v.event_id));
    }
    await A(req.user, 'update', 'venue', v.id, v, b);
    ok(res, (await db.prepare('SELECT * FROM venues WHERE id=?').get(req.params.id)));
  });
  api.delete('/venues/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    (await db.prepare('DELETE FROM venues WHERE id=?').run(req.params.id)); ok(res, { ok: true });
  });

  // ---------- CATERERS ----------
  api.get('/events/:id/caterers', U.authRequired, async (req, res) => ok(res, (await db.prepare('SELECT * FROM caterers WHERE event_id=? ORDER BY id').all(req.params.id))));
  api.post('/events/:id/caterers', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    if (!b.name) return bad(res, 'name is required');
    const info = (await db.prepare('INSERT INTO caterers (event_id,name,cuisine,budget_rating,taste_rating,flexibility_rating,cost_per_person,contact,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(req.params.id, b.name, b.cuisine || null, b.budget_rating || null, b.taste_rating || null, b.flexibility_rating || null, b.cost_per_person || null, b.contact || null, b.status || 'Candidate', b.notes || null));
    await A(req.user, 'create', 'caterer', info.lastInsertRowid, null, b);
    ok(res, (await db.prepare('SELECT * FROM caterers WHERE id=?').get(info.lastInsertRowid)));
  });
  api.put('/caterers/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const c = (await db.prepare('SELECT * FROM caterers WHERE id=?').get(req.params.id));
    if (!c) return bad(res, 'Caterer not found', 404);
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of ['name', 'cuisine', 'budget_rating', 'taste_rating', 'flexibility_rating', 'cost_per_person', 'contact', 'status', 'notes']) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
    if (!sets.length) return bad(res, 'Nothing to update');
    params.push(req.params.id);
    (await db.prepare(`UPDATE caterers SET ${sets.join(',')} WHERE id=?`).run(...params));
    if (b.status === 'Selected') {
      (await db.prepare('UPDATE caterers SET status=? WHERE event_id=? AND id!=?').run('Candidate', c.event_id, c.id));
      (await db.prepare("UPDATE events SET caterer_id=?, updated_at=datetime('now') WHERE id=?").run(c.id, c.event_id));
    }
    await A(req.user, 'update', 'caterer', c.id, c, b);
    ok(res, (await db.prepare('SELECT * FROM caterers WHERE id=?').get(req.params.id)));
  });
  api.delete('/caterers/:id', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    (await db.prepare('DELETE FROM caterers WHERE id=?').run(req.params.id)); ok(res, { ok: true });
  });

  // ---------- REGISTRATION CONFIG ----------
  api.get('/events/:id/registration', U.authRequired, async (req, res) => {
    let cfg = (await db.prepare('SELECT * FROM registration_config WHERE event_id=?').get(req.params.id));
    if (!cfg) {
      (await db.prepare('INSERT INTO registration_config (event_id) VALUES (?)').run(req.params.id));
      cfg = (await db.prepare('SELECT * FROM registration_config WHERE event_id=?').get(req.params.id));
    }
    ok(res, cfg);
  });
  api.put('/events/:id/registration', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    let cfg = (await db.prepare('SELECT * FROM registration_config WHERE event_id=?').get(req.params.id));
    if (!cfg) { (await db.prepare('INSERT INTO registration_config (event_id) VALUES (?)').run(req.params.id)); cfg = (await db.prepare('SELECT * FROM registration_config WHERE event_id=?').get(req.params.id)); }
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of ['open_date', 'close_date', 'regions', 'is_paid', 'cost_per_person', 'refund_policy', 'refund_deadline', 'capacity', 'status', 'notes']) if (f in b) { sets.push(`${f}=?`); params.push(f === 'is_paid' ? (b[f] ? 1 : 0) : b[f]); }
    if (!sets.length) return bad(res, 'Nothing to update');
    sets.push("updated_at=datetime('now')");
    params.push(req.params.id);
    (await db.prepare(`UPDATE registration_config SET ${sets.join(',')} WHERE event_id=?`).run(...params));
    await A(req.user, 'update', 'registration', cfg.id, cfg, b);
    ok(res, (await db.prepare('SELECT * FROM registration_config WHERE event_id=?').get(req.params.id)));
  });

  // ---------- SETUP / PLANNING STAGE ----------
  api.put('/events/:id/setup', U.authRequired, U.requireRole('Event Manager'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const b = req.body || {};
    const sets = [], params = [];
    for (const f of ['duration_days', 'region', 'expected_participants', 'planning_stage', 'guru_bhagwant', 'start_date', 'end_date']) if (f in b) { sets.push(`${f}=?`); params.push(b[f]); }
    // auto-calc end_date from start + duration if provided
    if (b.start_date && b.duration_days && !b.end_date) {
      const d = new Date(b.start_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + (Number(b.duration_days) - 1));
      sets.push('end_date=?'); params.push(d.toISOString().slice(0, 10));
    }
    if (!sets.length) return bad(res, 'Nothing to update');
    sets.push("updated_at=datetime('now')");
    params.push(req.params.id);
    (await db.prepare(`UPDATE events SET ${sets.join(',')} WHERE id=?`).run(...params));
    await A(req.user, 'update', 'event-setup', ev.id, { planning_stage: ev.planning_stage }, b);
    ok(res, await getEvent(req.params.id));
  });

  // ---------- SCHEDULE APPROVAL (Vatsalya) ----------
  api.post('/events/:id/schedule/submit', U.authRequired, U.requireRole('Coordinator'), async (req, res) => {
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    (await db.prepare("UPDATE events SET schedule_approval='Submitted to Vatsalya', updated_at=datetime('now') WHERE id=?").run(ev.id));
    await A(req.user, 'schedule-submit', 'event', ev.id, { was: ev.schedule_approval }, { now: 'Submitted to Vatsalya' });
    ok(res, await getEvent(req.params.id));
  });
  api.post('/events/:id/schedule/approve', U.authRequired, async (req, res) => {
    if (!U.CAN_APPROVE.includes(req.user.role)) return bad(res, 'Only an Approver (Vatsalya), Event Manager or Administrator can approve the schedule', 403);
    const ev = await getEvent(req.params.id); if (!assertUnlocked(res, ev)) return;
    const decision = (req.body && req.body.decision) === 'reject' ? 'Rejected' : 'Approved';
    (await db.prepare("UPDATE events SET schedule_approval=?, schedule_approved_by=?, schedule_approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
      .run(decision, req.user.name, ev.id));
    await A(req.user, 'schedule-' + decision.toLowerCase(), 'event', ev.id, { was: ev.schedule_approval }, { now: decision, comments: req.body && req.body.comments });
    ok(res, await getEvent(req.params.id));
  });

  // ---------- SHIBIR OVERVIEW (planning progress) ----------
  api.get('/events/:id/shibir-overview', U.authRequired, async (req, res) => {
    const ev = await getEvent(req.params.id); if (!ev) return bad(res, 'Event not found', 404);
    const coreCount = (await db.prepare('SELECT COUNT(*) c FROM core_team WHERE event_id=?').get(ev.id)).c;
    const pocCount = (await db.prepare('SELECT COUNT(*) c FROM core_team WHERE event_id=? AND is_poc=1').get(ev.id)).c;
    const depts = (await db.prepare('SELECT COUNT(*) c FROM departments WHERE event_id=?').get(ev.id)).c;
    const venue = ev.venue_id ? (await db.prepare('SELECT * FROM venues WHERE id=?').get(ev.venue_id)) : null;
    const caterer = ev.caterer_id ? (await db.prepare('SELECT * FROM caterers WHERE id=?').get(ev.caterer_id)) : null;
    const reg = (await db.prepare('SELECT * FROM registration_config WHERE event_id=?').get(ev.id));
    const stages = [
      { key: 'Core Team', done: coreCount > 0 },
      { key: 'POC Selected', done: pocCount > 0 },
      { key: 'Duration & Region', done: !!ev.duration_days && !!ev.region },
      { key: 'Venue Selected', done: !!ev.venue_id },
      { key: 'Schedule Approved', done: ev.schedule_approval === 'Approved' },
      { key: 'Caterer Selected', done: !!ev.caterer_id },
      { key: 'Departments Created', done: depts > 0 },
      { key: 'Registration Configured', done: !!(reg && reg.status && reg.status !== 'Not Open') },
    ];
    const doneCount = stages.filter((s) => s.done).length;
    ok(res, {
      event: ev, venue, caterer, registration: reg,
      counts: { coreTeam: coreCount, poc: pocCount, departments: depts },
      stages, progress: Math.round((doneCount / stages.length) * 100),
    });
  });
};
