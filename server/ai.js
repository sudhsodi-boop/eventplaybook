'use strict';
// Heuristic AI assistance layer. All outputs are proposals/drafts only.
// Never mutates records; callers must apply changes explicitly.
const { db } = require('./db');
const { computeActual, relLabel } = require('./util');

// Recommended standard timeline offsets for an event.
const STANDARD_TIMELINE = [
  { name: 'Long-term preparation kickoff', type: 'Milestone', offset: -120, phase: 'Phase 1 — Long-Term Preparation' },
  { name: 'Save the Date announcement', type: 'Announcement', offset: -120, phase: 'Phase 1 — Long-Term Preparation' },
  { name: 'Confirm venue & core team', type: 'Task', offset: -110, phase: 'Phase 1 — Long-Term Preparation' },
  { name: 'Registration opens', type: 'Milestone', offset: -60, phase: 'Phase 2 — Planning' },
  { name: 'Registration announcement', type: 'Announcement', offset: -60, phase: 'Phase 2 — Planning' },
  { name: 'Confirm speakers / program', type: 'Task', offset: -45, phase: 'Phase 2 — Planning' },
  { name: 'Program finalized', type: 'Milestone', offset: -30, phase: 'Phase 3 — Final Preparation' },
  { name: 'Registration reminder', type: 'Announcement', offset: -30, phase: 'Phase 3 — Final Preparation' },
  { name: 'Materials ready', type: 'Milestone', offset: -14, phase: 'Phase 4 — Final Communication' },
  { name: 'Important information announcement', type: 'Announcement', offset: -14, phase: 'Phase 4 — Final Communication' },
  { name: 'Final reminder', type: 'Announcement', offset: -2, phase: 'Phase 5 — Final Countdown' },
  { name: 'Event begins', type: 'Milestone', offset: 0, phase: 'Phase 6 — Event Execution' },
  { name: 'Welcome announcement', type: 'Announcement', offset: 0, phase: 'Phase 6 — Event Execution' },
  { name: 'Thank-you message', type: 'Announcement', offset: 1, phase: 'Phase 7 — Immediate Follow-Up' },
  { name: 'Feedback request', type: 'Announcement', offset: 7, phase: 'Phase 7 — Immediate Follow-Up' },
  { name: 'Post-event review completed', type: 'Milestone', offset: 14, phase: 'Phase 8 — Retrospective' },
];

function generateTimeline(startDate) {
  return STANDARD_TIMELINE.map((t) => ({
    ...t,
    relative: relLabel(t.offset),
    actual_date: computeActual(startDate, t.offset, null),
    origin: 'AI Suggested',
  }));
}

// Analyze announcements for a given event: duplicates, timing, clarity, gaps.
function analyzeAnnouncements(eventId) {
  const anns = db.prepare(`SELECT * FROM announcements WHERE event_id=? ORDER BY offset_days`).all(eventId);
  const findings = [];
  // duplicates by similar title/category+offset
  const byKey = {};
  for (const a of anns) {
    const key = (a.category || '') + '|' + Math.round((a.offset_days || 0) / 7);
    (byKey[key] = byKey[key] || []).push(a);
  }
  for (const [, group] of Object.entries(byKey)) {
    if (group.length > 1) {
      findings.push({
        severity: 'warning',
        type: 'Possible duplicate',
        detail: `Announcements "${group.map((g) => g.title).join('", "')}" share the same category and timing window; consider merging.`,
      });
    }
  }
  // timing problems: registration reminder too close to open
  for (const a of anns) {
    if (/reminder/i.test(a.title) && (a.offset_days || 0) > -7 && (a.offset_days || 0) < 0) {
      findings.push({
        severity: 'warning',
        type: 'Timing',
        detail: `"${a.title}" is scheduled only ${Math.abs(a.offset_days)} days before the event — reminders usually perform better ~14 days out.`,
      });
    }
    if (a.message && a.message.length > 0 && a.message.length < 25) {
      findings.push({
        severity: 'info',
        type: 'Unclear wording',
        detail: `"${a.title}" has a very short message; consider adding audience-specific detail.`,
      });
    }
    if (!a.message) {
      findings.push({ severity: 'info', type: 'Missing content', detail: `"${a.title}" has no message body drafted yet.` });
    }
  }
  // gaps: no thank-you / feedback
  const titles = anns.map((a) => (a.title || '').toLowerCase()).join(' ');
  if (!/thank/.test(titles)) findings.push({ severity: 'info', type: 'Missing communication', detail: 'No post-event thank-you announcement found.' });
  if (!/feedback|survey/.test(titles)) findings.push({ severity: 'info', type: 'Missing communication', detail: 'No feedback request announcement found.' });
  if (!/save the date|save-the-date/.test(titles)) findings.push({ severity: 'info', type: 'Missing communication', detail: 'No early "Save the Date" announcement found.' });
  if (findings.length === 0) findings.push({ severity: 'ok', type: 'All clear', detail: 'No issues detected in the announcement plan.' });
  return findings;
}

// Extract candidate lessons from actual-vs-planned data.
function extractLessons(eventId) {
  const proposals = [];
  const tasks = db.prepare(`SELECT * FROM tasks WHERE event_id=?`).all(eventId);
  const ev = db.prepare(`SELECT * FROM events WHERE id=?`).get(eventId);
  const late = tasks.filter((t) => {
    if (t.status === 'Completed' && t.completion_date && ev.start_date) {
      const due = t.date_override || null;
      return due && t.completion_date > due;
    }
    return false;
  });
  const cancelled = tasks.filter((t) => t.status === 'Cancelled');
  const blocked = tasks.filter((t) => t.status === 'Blocked');
  if (late.length) proposals.push({ category: 'Schedule', description: `${late.length} task(s) were completed after their due date.`, recommendation: 'Add buffer time or start these tasks earlier next year.', priority: 'High', source: 'AI Suggested' });
  if (cancelled.length) proposals.push({ category: 'Planning', description: `${cancelled.length} task(s) were cancelled.`, recommendation: 'Review whether these tasks are needed in the template.', priority: 'Medium', source: 'AI Suggested' });
  if (blocked.length) proposals.push({ category: 'Execution', description: `${blocked.length} task(s) ended up blocked.`, recommendation: 'Identify and remove the blockers earlier in the timeline.', priority: 'High', source: 'AI Suggested' });
  const changedAnns = db.prepare(`SELECT a.title, COUNT(v.id) c FROM announcements a JOIN announcement_versions v ON v.announcement_id=a.id WHERE a.event_id=? GROUP BY a.id HAVING c>1`).all(eventId);
  for (const c of changedAnns) proposals.push({ category: 'Communication', description: `Announcement "${c.title}" was revised ${c.c} times.`, recommendation: 'Stabilize wording in the template to reduce rework.', priority: 'Medium', source: 'AI Suggested' });
  if (proposals.length === 0) proposals.push({ category: 'Planning', description: 'No automatic issues detected from plan-vs-actual data.', recommendation: 'Add manual lessons from the retrospective.', priority: 'Low', source: 'AI Suggested' });
  return proposals;
}

// Draft an announcement based on a previous one + event details.
function draftAnnouncement({ previous, event, audience, purpose, timing }) {
  const base = previous || {};
  const evName = event ? event.name : 'the event';
  const dateStr = event && event.start_date ? event.start_date : 'the event date';
  let message = base.message || '';
  message = message
    .replace(/\b20\d\d\b/g, event && event.event_year ? String(event.event_year) : '20XX');
  if (!message) {
    message = `Dear ${audience || 'participants'},\n\nWe are pleased to share details about ${evName} taking place on ${dateStr}${event && event.location ? ` at ${event.location}` : ''}.\n\n${purpose || 'Please see the information below and let us know if you have questions.'}\n\nWarm regards,\nThe Organizing Team`;
  }
  return {
    title: base.title ? `${base.title} (${event ? event.event_year : ''})`.trim() : `${purpose || 'Announcement'} — ${evName}`,
    audience: audience || base.audience || 'All participants',
    purpose: purpose || base.purpose || '',
    channel: base.channel || 'Email',
    message,
    short_version: (message.split('\n')[0] || '').slice(0, 140),
    origin: 'AI Suggested',
    note: 'Draft generated for review — not published.',
  };
}

// Detect recurring issues across a series.
function recurringIssues(seriesId) {
  const rows = db.prepare(
    `SELECT l.category, l.description, e.event_year FROM lessons l JOIN events e ON e.id=l.event_id WHERE e.series_id=?`
  ).all(seriesId);
  const byCat = {};
  for (const r of rows) (byCat[r.category] = byCat[r.category] || new Set()).add(r.event_year);
  const recurring = [];
  for (const [cat, years] of Object.entries(byCat)) {
    if (years.size >= 2) recurring.push({ category: cat, years: [...years].sort(), detail: `Lessons in category "${cat}" recurred across ${years.size} events (${[...years].sort().join(', ')}). Consider a permanent process improvement.` });
  }
  return recurring;
}

// Natural-language-ish knowledge search across the knowledge base.
function knowledgeSearch(query) {
  const q = `%${(query || '').trim()}%`;
  const results = [];
  const push = (type, rows, mapFn) => rows.forEach((r) => results.push({ type, ...mapFn(r) }));
  push('Announcement', db.prepare(`SELECT a.*, e.name en, e.event_year ey FROM announcements a JOIN events e ON e.id=a.event_id WHERE a.title LIKE ? OR a.message LIKE ? OR a.purpose LIKE ? LIMIT 25`).all(q, q, q),
    (r) => ({ id: r.id, event_id: r.event_id, title: r.title, snippet: (r.message || r.purpose || '').slice(0, 160), context: `${r.en} (${r.ey}) · ${relLabel(r.offset_days)}` }));
  push('Task', db.prepare(`SELECT t.*, e.name en, e.event_year ey FROM tasks t JOIN events e ON e.id=t.event_id WHERE t.title LIKE ? OR t.description LIKE ? OR t.notes LIKE ? LIMIT 25`).all(q, q, q),
    (r) => ({ id: r.id, event_id: r.event_id, title: r.title, snippet: (r.description || r.notes || '').slice(0, 160), context: `${r.en} (${r.ey}) · ${r.status}` }));
  push('Lesson', db.prepare(`SELECT l.*, e.name en, e.event_year ey FROM lessons l JOIN events e ON e.id=l.event_id WHERE l.description LIKE ? OR l.recommendation LIKE ? OR l.category LIKE ? LIMIT 25`).all(q, q, q),
    (r) => ({ id: r.id, event_id: r.event_id, title: `${r.category}: ${(r.description || '').slice(0, 60)}`, snippet: (r.recommendation || '').slice(0, 160), context: `${r.en} (${r.ey})` }));
  push('Milestone', db.prepare(`SELECT m.*, e.name en, e.event_year ey FROM milestones m JOIN events e ON e.id=m.event_id WHERE m.name LIKE ? OR m.notes LIKE ? LIMIT 25`).all(q, q),
    (r) => ({ id: r.id, event_id: r.event_id, title: r.name, snippet: (r.notes || '').slice(0, 160), context: `${r.en} (${r.ey}) · ${relLabel(r.offset_days)}` }));
  push('Checklist item', db.prepare(`SELECT ci.*, c.name cn, e.name en, e.event_year ey FROM checklist_items ci JOIN checklists c ON c.id=ci.checklist_id LEFT JOIN events e ON e.id=c.event_id WHERE ci.text LIKE ? LIMIT 25`).all(q),
    (r) => ({ id: r.id, event_id: null, title: r.text, snippet: r.cn, context: r.en ? `${r.en} (${r.ey})` : 'Template' }));
  return results;
}

module.exports = {
  STANDARD_TIMELINE,
  generateTimeline,
  analyzeAnnouncements,
  extractLessons,
  draftAnnouncement,
  recurringIssues,
  knowledgeSearch,
};
