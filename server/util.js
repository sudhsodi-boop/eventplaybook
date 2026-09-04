'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'eventplaybook-dev-secret-change-in-prod';

// Role hierarchy for authorization
const ROLE_LEVEL = {
  Viewer: 1,
  Contributor: 2,
  Coordinator: 3,
  'Event Manager': 4,
  Administrator: 5,
};

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// minRole middleware factory: server-side authorization
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const level = ROLE_LEVEL[req.user.role] || 0;
    if (level < ROLE_LEVEL[minRole]) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

function audit(user, action, entity_type, entity_id, oldValue, newValue) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (user, action, entity_type, entity_id, old_value, new_value) VALUES (?,?,?,?,?,?)`
    ).run(
      user ? user.name || user.email : 'system',
      action,
      entity_type,
      entity_id || null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    );
  } catch (e) {
    /* non-fatal */
  }
}

function notify(type, message, event_id, entity_type, entity_id) {
  db.prepare(
    `INSERT INTO notifications (type, message, event_id, entity_type, entity_id) VALUES (?,?,?,?,?)`
  ).run(type, message, event_id || null, entity_type || null, entity_id || null);
}

// ---- Relative date engine ----
function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Actual date = override if present, else event.start_date + offset_days
function computeActual(eventStart, offsetDays, override) {
  if (override) return override;
  return addDays(eventStart, offsetDays || 0);
}

// Relative label: T-120, T+7, T+0
function relLabel(offset) {
  if (offset === 0 || offset === null || offset === undefined) return 'T+0';
  return offset < 0 ? `T${offset}` : `T+${offset}`;
}

function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00Z');
  const b = new Date(toStr + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function validate(fields, body) {
  const errors = [];
  for (const [key, rule] of Object.entries(fields)) {
    const val = body[key];
    if (rule.required && (val === undefined || val === null || val === '')) {
      errors.push(`${key} is required`);
    }
    if (val !== undefined && val !== null && val !== '' && rule.enum && !rule.enum.includes(val)) {
      errors.push(`${key} must be one of: ${rule.enum.join(', ')}`);
    }
    if (val && rule.date && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      errors.push(`${key} must be a valid date (YYYY-MM-DD)`);
    }
  }
  return errors;
}

module.exports = {
  JWT_SECRET,
  ROLE_LEVEL,
  signToken,
  authRequired,
  requireRole,
  audit,
  notify,
  addDays,
  computeActual,
  relLabel,
  daysBetween,
  todayStr,
  validate,
};
