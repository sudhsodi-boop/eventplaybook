'use strict';
const bcrypt = require('bcryptjs');
const { db } = require('./db');

async function reset() {
  const tables = ['audit_logs', 'approvals', 'notifications', 'attachments', 'templates', 'retrospectives', 'lessons', 'people', 'checklist_items', 'checklists', 'communications', 'announcement_versions', 'announcements', 'tasks', 'milestones', 'phases', 'registration_config', 'department_members', 'departments', 'venues', 'caterers', 'core_team', 'events', 'event_series', 'categories', 'users'];
  // TRUNCATE with RESTART IDENTITY resets serial sequences and cascades FKs.
  await db.exec(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

const DEFAULT_CATEGORIES = {
  'Before Event': ['Save the Date', 'Registration Announcement', 'Registration Reminder', 'Important Information', 'Volunteer Announcement', 'Program Announcement', 'Accommodation Information', 'Transportation Information', 'Speaker Information', 'Preparation Instructions', 'Final Reminder', 'What to Bring', 'Arrival Instructions'],
  'During Event': ['Welcome', 'Daily Schedule', 'Session Announcement', 'Location Change', 'Important Reminder', 'Emergency/urgent information', 'Meal Information', 'Volunteer Coordination', 'Program Update', 'Day Closing Announcement', 'Next-Day Reminder'],
  'After Event': ['Thank You', 'Feedback Request', 'Results', 'Photos/Videos', 'Follow-up', 'Appreciation', 'Next Steps'],
};

async function seed() {
  await reset();
  // Users — one per role
  const users = [
    ['Alice Admin', 'admin@example.com', 'password', 'Administrator'],
    ['Manny Manager', 'manager@example.com', 'password', 'Event Manager'],
    ['Cora Coordinator', 'coord@example.com', 'password', 'Coordinator'],
    ['Chris Contributor', 'contrib@example.com', 'password', 'Contributor'],
    ['Vera Viewer', 'viewer@example.com', 'password', 'Viewer'],
  ];
  for (const [name, email, pw, role] of users)
    (await db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, bcrypt.hashSync(pw, 12), role));

  for (const [group, names] of Object.entries(DEFAULT_CATEGORIES))
    for (const n of names) (await db.prepare('INSERT INTO categories (group_name,name) VALUES (?,?)').run(group, n));

  // Series + 2026 event
  const seriesId = (await db.prepare('INSERT INTO event_series (name,event_type,description) VALUES (?,?,?)')
    .run('Annual Community Event', 'Community', 'Recurring annual community gathering')).lastInsertRowid;

  const evId = (await db.prepare(`INSERT INTO events (series_id,name,event_type,description,event_year,start_date,end_date,location,organizer,owner,status,participants,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    seriesId, 'Annual Community Event 2026', 'Community', 'Two-day community gathering with sessions, meals and networking.',
    2026, '2026-07-25', '2026-07-26', 'Community Hall, Main Street', 'Manny Manager', 'Alice Admin', 'Completed', 320,
    'Flagship event of the year.'
  )).lastInsertRowid;

  // People / roles
  const people = [
    ['Manny Manager', 'Event Director', 'manager@example.com', '555-0100'],
    ['Cora Coordinator', 'Communication Coordinator', 'coord@example.com', '555-0101'],
    ['Vic Volunteer', 'Volunteer Coordinator', 'vic@example.com', '555-0102'],
    ['Reggie Reg', 'Registration Coordinator', 'reg@example.com', '555-0103'],
    ['Tia Tech', 'Technical Coordinator', 'tech@example.com', '555-0104'],
  ];
  for (const [n, r, e, p] of people) (await db.prepare('INSERT INTO people (event_id,name,role,email,phone) VALUES (?,?,?,?,?)').run(evId, n, r, e, p));

  // Milestones
  const milestones = [
    ['Registration opens', -60, 'Reggie Reg', 'Completed'],
    ['Program finalized', -30, 'Manny Manager', 'Completed'],
    ['Materials ready', -14, 'Tia Tech', 'Completed'],
    ['Event begins', 0, 'Manny Manager', 'Completed'],
    ['Event ends', 1, 'Manny Manager', 'Completed'],
    ['Feedback completed', 7, 'Cora Coordinator', 'Completed'],
  ];
  for (const [name, off, owner, st] of milestones)
    (await db.prepare('INSERT INTO milestones (event_id,name,offset_days,owner,status,completion_date) VALUES (?,?,?,?,?,date(\'now\'))').run(evId, name, off, owner, st));

  // Tasks (with actual completion for analytics)
  const tasks = [
    ['Confirm venue', 'Phase 1 — Long-Term Preparation', -120, 'High', 'Completed', '2026-03-27'],
    ['Recruit volunteers', 'Phase 2 — Planning', -60, 'High', 'Completed', '2026-05-28'],
    ['Finalize speaker list', 'Phase 2 — Planning', -45, 'Medium', 'Completed', '2026-06-12'],
    ['Print materials', 'Phase 4 — Final Communication', -14, 'Medium', 'Completed', '2026-07-13'],
    ['Test AV equipment', 'Phase 5 — Final Countdown', -2, 'Critical', 'Completed', '2026-07-24'],
  ];
  for (const [title, phase, off, prio, st, comp] of tasks)
    (await db.prepare('INSERT INTO tasks (event_id,title,phase,offset_days,priority,status,completion_date) VALUES (?,?,?,?,?,?,?)').run(evId, title, phase, off, prio, st, comp));
  // Demo nested work under a completed task so the task hierarchy is explorable on first boot.
  const venueTask = await db.prepare("SELECT id FROM tasks WHERE event_id=? AND title='Confirm venue'").get(evId);
  await db.prepare(`INSERT INTO tasks (event_id,title,description,phase,owner,offset_days,priority,status,type,parent_task_id,sort_order,tags,completion_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evId, 'Verify room capacity and table layout', 'Confirm the room plan fits the expected attendee count.', 'Phase 1 — Long-Term Preparation', 'Manny Manager', -112, 'High', 'Completed', 'Task', venueTask.id, 0, '["venue","operations"]', '2026-04-04');
  const venueSetup = (await db.prepare(`INSERT INTO tasks (event_id,title,description,phase,owner,offset_days,priority,status,type,parent_task_id,sort_order,tags,completion_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evId, 'Confirm venue access and setup window', 'Align arrival and loading access with the venue contact.', 'Phase 1 — Long-Term Preparation', 'Manny Manager', -110, 'Medium', 'Completed', 'Task', venueTask.id, 1, '["venue"]', '2026-04-06')).lastInsertRowid;
  (await db.prepare(`INSERT INTO tasks (event_id,title,description,phase,owner,offset_days,priority,status,type,parent_task_id,sort_order,completion_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(evId, 'Record venue setup contact and phone', 'Keep access details in the event-day playbook.', 'Phase 2 — Planning', 'Cora Coordinator', -100, 'Low', 'Completed', 'Task', venueSetup, 0, '2026-04-16'));
  for (const [text, order] of [['Capacity confirmed against registration estimate', 0], ['Venue setup and access window confirmed', 1]])
    (await db.prepare('INSERT INTO task_checklist_items (task_id,text,done,sort_order,created_by) VALUES (?,?,1,?,?)').run(venueTask.id, text, order, 'Demo seed'));
  const speakerTask = await db.prepare("SELECT id FROM tasks WHERE event_id=? AND title='Finalize speaker list'").get(evId);
  await db.prepare('INSERT INTO task_dependencies (task_id,depends_on_task_id,created_by) VALUES (?,?,?)').run(speakerTask.id, venueTask.id, 'Demo seed');
  await db.prepare('UPDATE tasks SET dependency_id=? WHERE id=?').run(venueTask.id, speakerTask.id);
  // A task marked REMOVE (obsolete) to demonstrate Keep/Change/Remove exclusion on clone
  (await db.prepare("INSERT INTO tasks (event_id,title,phase,offset_days,priority,status,disposition) VALUES (?,?,?,?,?,?,?)").run(evId, 'Registration duplicate cleanup', 'Phase 3 — Final Preparation', -30, 'Low', 'Cancelled', 'REMOVE'));
  // Mark an item KEEP for a richer next-year preview
  (await db.prepare("UPDATE tasks SET disposition='KEEP' WHERE event_id=? AND title='Recruit volunteers'").run(evId));

  // Event-day activities (Day 1)
  const dayActs = [
    ['07:00 — Setup', 0], ['08:00 — Registration', 0], ['09:00 — Opening', 0], ['10:00 — Session 1', 0],
    ['12:00 — Lunch', 0], ['13:30 — Session 2', 0], ['16:00 — Closing', 0],
    ['09:00 — Day 2 Sessions', 1], ['12:00 — Farewell Lunch', 1],
  ];
  for (const [title, off] of dayActs)
    (await db.prepare("INSERT INTO tasks (event_id,title,offset_days,type,status,notes,phase) VALUES (?,?,?,?,?,?,?)").run(evId, title, off, 'Event Day Activity', 'Completed', title.slice(0, 5), 'Phase 6 — Event Execution'));

  // Announcements
  const anns = [
    ['Save the Date', 'Save the Date', 'Before Event', -120, 'All community', 'Reserve the dates', 'Save the date for our Annual Community Event 2026 on July 25-26!', 'Email', 'Published'],
    ['Registration Now Open', 'Registration Announcement', 'Before Event', -60, 'All community', 'Drive registrations', 'Registration for the 2026 event is now open. Sign up early to secure your spot.', 'Email', 'Published'],
    ['One Month To Go', 'Registration Reminder', 'Before Event', -30, 'Registered + prospects', 'Reminder', 'Only one month left! Complete your registration today.', 'WhatsApp', 'Published'],
    ['Important Information', 'Important Information', 'Before Event', -14, 'Registered', 'Logistics', 'Here is important information about parking, schedule and what to bring.', 'Email', 'Published'],
    ['Final Reminder', 'Final Reminder', 'Before Event', -2, 'Registered', 'Final details', 'See you in 2 days! Doors open at 8am. Bring your confirmation.', 'WhatsApp', 'Published'],
    ['Welcome!', 'Welcome', 'During Event', 0, 'Attendees', 'Welcome', 'Welcome to the 2026 Annual Community Event! Grab your badge at registration.', 'In-person Announcement', 'Published'],
    ['Day 2 Schedule', 'Daily Schedule', 'During Event', 1, 'Attendees', 'Day 2 info', 'Day 2 begins at 9am with sessions followed by a farewell lunch.', 'WhatsApp', 'Published'],
    ['Thank You', 'Thank You', 'After Event', 1, 'All attendees', 'Gratitude', 'Thank you for making the 2026 event a success!', 'Email', 'Published'],
    ['We Want Your Feedback', 'Feedback Request', 'After Event', 7, 'All attendees', 'Collect feedback', 'Please take 3 minutes to share your feedback via our survey.', 'Email', 'Published'],
  ];
  for (const [title, cat, grp, off, aud, purp, msg, chan, pub] of anns) {
    const aid = (await db.prepare(`INSERT INTO announcements (event_id,title,category,phase_group,offset_days,audience,purpose,message,short_version,channel,owner,approval_status,published_status,publication_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,date('now'))`)
      .run(evId, title, cat, grp, off, aud, purp, msg, msg.slice(0, 80), chan, 'Cora Coordinator', 'Approved', pub)).lastInsertRowid;
    (await db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)').run(aid, 1, title, msg, msg.slice(0, 80), 'Cora Coordinator', 'Initial version'));
  }
  // Give one announcement a v2 to demonstrate history
  const regAnn = (await db.prepare("SELECT * FROM announcements WHERE event_id=? AND title='One Month To Go'").get(evId));
  const newMsg = 'Only one month left! Complete your registration today. NOTE: registration link corrected.';
  (await db.prepare("UPDATE announcements SET message=?, version=2, updated_at=datetime('now') WHERE id=?").run(newMsg, regAnn.id));
  (await db.prepare('INSERT INTO announcement_versions (announcement_id,version,title,message,short_version,author,reason) VALUES (?,?,?,?,?,?,?)').run(regAnn.id, 2, regAnn.title, newMsg, newMsg.slice(0, 80), 'Cora Coordinator', 'Fixed broken registration link'));
  (await db.prepare("UPDATE announcements SET disposition='MODIFY' WHERE id=?").run(regAnn.id));

  // Communication plan
  const comms = [
    ['Save the Date blast', 'Awareness', 'All community', 'Email', -120, 'Sent'],
    ['Registration push', 'Conversion', 'Prospects', 'Social Media', -60, 'Sent'],
    ['Volunteer briefing', 'Coordination', 'Volunteers', 'WhatsApp', -7, 'Sent'],
  ];
  for (const [t, pu, au, ch, off, st] of comms)
    (await db.prepare('INSERT INTO communications (event_id,title,purpose,audience,channel,offset_days,status) VALUES (?,?,?,?,?,?,?)').run(evId, t, pu, au, ch, off, st));

  // Checklists
  const checklists = {
    'Pre-Event Checklist': ['Venue confirmed', 'Speakers confirmed', 'Volunteers confirmed', 'Materials prepared', 'Registration ready', 'Communications approved', 'Equipment tested'],
    'Event-Day Checklist': ['Venue opened', 'Registration desk ready', 'Audio tested', 'Video tested', 'Materials available', 'Volunteers present', 'Announcements ready'],
    'Post-Event Checklist': ['Thank-you message', 'Feedback collected', 'Photos collected', 'Expenses finalized', 'Attendance recorded', 'Issues documented', 'Lessons learned recorded'],
  };
  for (const [name, items] of Object.entries(checklists)) {
    const cid = (await db.prepare('INSERT INTO checklists (event_id,name,category) VALUES (?,?,?)').run(evId, name, name.split(' ')[0])).lastInsertRowid;
    { let i = 0; for (const t of items) { await db.prepare('INSERT INTO checklist_items (checklist_id,text,done,sort_order) VALUES (?,?,?,?)').run(cid, t, 1, i); i++; } }
  }

  // Lessons learned (with dispositions and next actions)
  const lessons = [
    ['Communication', 'The one-month reminder had a broken registration link initially.', 'Some users could not register for a day.', 'Test all links before publishing.', 'High', 'Send test communication to internal team first.', 'CHANGE'],
    ['Registration', 'Registration desk had long queues on Day 1 morning.', 'Attendees waited up to 25 minutes.', 'Add a second registration desk and pre-print badges.', 'High', 'Add second registration desk task at T-14.', 'MODIFY'],
    ['Planning', 'The registration duplicate cleanup task was unnecessary.', 'Wasted volunteer time.', 'Remove this task from the template.', 'Low', '', 'REMOVE'],
    ['People', 'Volunteer briefing worked very well.', 'Volunteers felt prepared.', 'Keep the volunteer briefing as-is.', 'Medium', '', 'KEEP'],
  ];
  for (const [cat, desc, imp, rec, prio, act, disp] of lessons)
    (await db.prepare('INSERT INTO lessons (event_id,category,description,impact,recommendation,priority,action_next,disposition,confirmed,source) VALUES (?,?,?,?,?,?,?,?,1,?)').run(evId, cat, desc, imp, rec, prio, act, disp, 'User'));

  console.log('Seed complete. Event 2026 id =', evId);
  return evId;
}

if (require.main === module) {
  const { init } = require('./db');
  init()
    .then(() => seed())
    .then(() => { console.log('Seed done.'); process.exit(0); })
    .catch((e) => { console.error('Seed failed:', e); process.exit(1); });
}
module.exports = { seed };
