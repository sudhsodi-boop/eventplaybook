'use strict';
// Automatic, durable backups. On Postgres we take a logical JSON snapshot of
// every table (portable and restore-friendly) on an interval.
const path = require('path');
const fs = require('fs');
const { db, DATA_DIR } = require('./db');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MAX_BACKUPS = Number(process.env.MAX_BACKUPS || 14);
const INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || 6);

const TABLES = [
  'users', 'event_series', 'events', 'phases', 'milestones', 'tasks',
  'task_checklist_items', 'task_comments', 'task_dependencies',
  'announcements', 'announcement_versions', 'communications', 'checklists',
  'checklist_items', 'people', 'lessons', 'retrospectives', 'templates',
  'attachments', 'notifications', 'approvals', 'audit_logs', 'categories',
  'core_team', 'departments', 'department_members', 'venues', 'caterers',
  'registration_config',
];

async function runBackup(reason = 'scheduled') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `eventplaybook-${ts}.json`);
  try {
    const dump = { _meta: { created_at: new Date().toISOString(), reason } };
    for (const t of TABLES) {
      try {
        dump[t] = await db.prepare(`SELECT * FROM ${t}`).all();
      } catch (e) {
        dump[t] = [];
      }
    }
    fs.writeFileSync(dest, JSON.stringify(dump));
    prune();
    console.log(`[backup] ${reason} snapshot written: ${path.basename(dest)}`);
    return dest;
  } catch (e) {
    console.error('[backup] failed:', e.message);
    return null;
  }
}

function prune() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json') || f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old.f)); } catch (e) {}
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json') || f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function start() {
  if (process.env.DISABLE_AUTO_BACKUP === '1') return;
  setTimeout(() => runBackup('startup'), 15000);
  setInterval(() => runBackup('scheduled'), INTERVAL_HOURS * 3600 * 1000).unref();
}

module.exports = { runBackup, listBackups, start, BACKUP_DIR };
