const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb } = require('../db');
const { h, paging, meta, likeTerm } = require('../util/http');
const { validate } = require('../util/validate');
const { HttpError, notFound } = require('../util/errors');
const { requireRole } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

const db = () => getDb();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ---------------------------- Customers ---------------------------- */
const customers = express.Router();
const customerFields = {
  name: { type: 'string', required: true, max: 120 },
  email: { type: 'email', required: true },
  company: { type: 'string', max: 160 },
  phone: { type: 'string', max: 40 },
  address: { type: 'string', max: 400 },
  active: { type: 'bool', default: true },
};

customers.get('/', requireRole('admin', 'staff'), h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = ["u.role = 'customer'"];
  const params = [];
  if (req.query.search) {
    where.push('(u.name LIKE ? ESCAPE \'\\\' OR u.email LIKE ? ESCAPE \'\\\' OR u.company LIKE ? ESCAPE \'\\\')');
    const t = likeTerm(req.query.search);
    params.push(t, t, t);
  }
  if (req.query.active === 'true' || req.query.active === 'false') {
    where.push('u.active = ?');
    params.push(req.query.active === 'true' ? 1 : 0);
  }
  const W = `WHERE ${where.join(' AND ')}`;
  const { total } = db().get(`SELECT COUNT(*) AS total FROM users u ${W}`, ...params);
  const rows = db().all(
    `SELECT u.id, u.name, u.email, u.company, u.phone, u.address, u.active, u.created_at FROM users u ${W}
      ORDER BY u.name COLLATE NOCASE LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const subs = Object.fromEntries(db().all(
      `SELECT customer_id, COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND customer_id IN (${ph}) GROUP BY customer_id`, ...ids)
      .map((r) => [r.customer_id, r.n]));
    const owed = Object.fromEntries(db().all(
      `SELECT customer_id, SUM(total - amount_paid) AS s FROM invoices WHERE status = 'confirmed' AND customer_id IN (${ph}) GROUP BY customer_id`, ...ids)
      .map((r) => [r.customer_id, r.s]));
    for (const r of rows) { r.active_subscriptions = subs[r.id] || 0; r.outstanding = Math.round((owed[r.id] || 0) * 100) / 100; }
  }
  res.json({ data: rows, meta: meta(page, pageSize, total) });
}));

customers.post('/', requireRole('admin', 'staff'), h(async (req, res) => {
  const b = validate(req.body, customerFields);
  if (db().get('SELECT id FROM users WHERE email = ?', b.email)) {
    throw new HttpError(409, 'A customer with this email already exists', { email: 'This email is already registered' });
  }
  // The customer chooses their own password through a link sent to their email.
  const token = crypto.randomBytes(32).toString('hex');
  const { id } = db().run(
    `INSERT INTO users (name, email, password_hash, role, company, phone, address, active, reset_token_hash, reset_expires)
     VALUES (?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?)`,
    b.name, b.email, await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10), b.company, b.phone, b.address, b.active ? 1 : 0,
    sha(token), new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString());
  const link = `${config.appUrl}/reset-password?token=${token}&email=${encodeURIComponent(b.email)}`;
  await sendMail({
    to: b.email,
    subject: `Welcome to ${config.company} - set your password`,
    text: `Hello ${b.name},\n\nAn account has been created for you. Choose your password here (valid for 7 days):\n${link}`,
    link,
  });
  const created = db().get('SELECT id, name, email, company, phone, address, active, created_at FROM users WHERE id = ?', id);
  if (config.demoMode) created.demo_setup_link = link;
  res.status(201).json(created);
}));

customers.get('/:id', requireRole('admin', 'staff'), h((req, res) => {
  const c = db().get(
    "SELECT id, name, email, company, phone, address, active, created_at FROM users WHERE id = ? AND role = 'customer'", req.params.id);
  if (!c) throw notFound('Customer');
  res.json(c);
}));

customers.put('/:id', requireRole('admin', 'staff'), h((req, res) => {
  const c = db().get("SELECT id FROM users WHERE id = ? AND role = 'customer'", req.params.id);
  if (!c) throw notFound('Customer');
  const b = validate(req.body, customerFields);
  if (db().get('SELECT id FROM users WHERE email = ? AND id != ?', b.email, c.id)) {
    throw new HttpError(409, 'Another account already uses this email', { email: 'This email is already registered' });
  }
  db().run('UPDATE users SET name = ?, email = ?, company = ?, phone = ?, address = ?, active = ? WHERE id = ?',
    b.name, b.email, b.company, b.phone, b.address, b.active ? 1 : 0, c.id);
  res.json(db().get('SELECT id, name, email, company, phone, address, active, created_at FROM users WHERE id = ?', c.id));
}));

/* ------------------------------ Staff ------------------------------ */
// Only the admin can add (or manage) members of staff.
const staff = express.Router();
staff.use(requireRole('admin'));

staff.get('/', h((req, res) => {
  res.json({ data: db().all("SELECT id, name, email, role, phone, active, created_at FROM users WHERE role IN ('admin','staff') ORDER BY role, name") });
}));

staff.post('/', h(async (req, res) => {
  const b = validate(req.body, {
    name: { type: 'string', required: true, max: 120 },
    email: { type: 'email', required: true },
    password: { type: 'password', required: true },
    phone: { type: 'string', max: 40 },
  });
  if (db().get('SELECT id FROM users WHERE email = ?', b.email)) {
    throw new HttpError(409, 'An account with this email already exists', { email: 'This email is already registered' });
  }
  const { id } = db().run(
    "INSERT INTO users (name, email, password_hash, role, phone) VALUES (?, ?, ?, 'staff', ?)",
    b.name, b.email, await bcrypt.hash(b.password, 10), b.phone);
  res.status(201).json(db().get('SELECT id, name, email, role, phone, active, created_at FROM users WHERE id = ?', id));
}));

staff.put('/:id', h(async (req, res) => {
  const u = db().get("SELECT * FROM users WHERE id = ? AND role IN ('admin','staff')", req.params.id);
  if (!u) throw notFound('Staff member');
  const b = validate(req.body, {
    name: { type: 'string', required: true, max: 120 },
    phone: { type: 'string', max: 40 },
    active: { type: 'bool', default: true },
    password: { type: 'password' },
  });
  if (u.id === req.user.id && !b.active) throw new HttpError(409, 'You cannot disable your own account');
  db().run('UPDATE users SET name = ?, phone = ?, active = ? WHERE id = ?', b.name, b.phone, b.active ? 1 : 0, u.id);
  if (b.password) db().run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(b.password, 10), u.id);
  res.json(db().get('SELECT id, name, email, role, phone, active, created_at FROM users WHERE id = ?', u.id));
}));

module.exports = { customers, staff };
