// The customer portal: customers see and manage ONLY their own subscriptions and invoices.
const express = require('express');
const { getDb } = require('../db');
const { h, paging, meta } = require('../util/http');
const { validate } = require('../util/validate');
const { notFound } = require('../util/errors');
const { requireRole } = require('../middleware/auth');
const { today } = require('../util/dates');
const { r2 } = require('../util/money');
const subs = require('../services/subscriptions');
const invoices = require('../services/invoices');

const router = express.Router();
const db = () => getDb();
router.use(requireRole('customer'));

const own = (req, id) => {
  const s = db().get('SELECT id FROM subscriptions WHERE id = ? AND customer_id = ?', id, req.user.id);
  if (!s) throw notFound('Subscription');
  return s.id;
};
// Customers never see drafts or cancelled invoices.
const VISIBLE = "i.status IN ('confirmed','paid')";

router.get('/summary', h((req, res) => {
  const t = today();
  const s = db().get(
    `SELECT COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN status IN ('draft','quotation','confirmed') THEN 1 ELSE 0 END), 0) AS pending
       FROM subscriptions WHERE customer_id = ? AND NOT (status = 'draft')`, req.user.id);
  const i = db().get(
    `SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total - amount_paid END), 0) AS outstanding,
            COALESCE(SUM(CASE WHEN status = 'confirmed' AND due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count
       FROM invoices WHERE customer_id = ?`, t, req.user.id);
  res.json({ active_subscriptions: s.active, pending_subscriptions: s.pending, outstanding: r2(i.outstanding), overdue_count: i.overdue_count, paid_invoices: i.paid_count });
}));

router.get('/subscriptions', h((req, res) => {
  const rows = db().all(
    `SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date, s.billing_period, s.recurring_total, s.paused_at, p.name AS plan_name
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.customer_id = ? AND s.status != 'draft' ORDER BY s.id DESC`, req.user.id);
  rows.forEach((r) => { r.is_paused = !!r.paused_at; });
  res.json({ data: rows });
}));

router.get('/subscriptions/:id', h((req, res) => {
  const sub = subs.getDetail(own(req, Number(req.params.id)));
  if (sub.status === 'draft') throw notFound('Subscription');
  // Customers get the details they need, without internal staff notes or audit history.
  delete sub.notes; delete sub.events; delete sub.created_by;
  sub.invoices = sub.invoices.filter((i) => ['confirmed', 'paid'].includes(i.status));
  res.json(sub);
}));

// Customers manage their own subscription: pause, resume, close, renew (only where the plan allows it).
router.post('/subscriptions/:id/:action', h((req, res) => {
  const id = own(req, Number(req.params.id));
  if (!['pause', 'resume', 'close', 'renew'].includes(req.params.action)) throw notFound('Action');
  const sub = subs.applyAction(id, req.params.action, req.user, { reason: 'Closed by the customer' });
  delete sub.notes; delete sub.events;
  sub.invoices = sub.invoices.filter((i) => ['confirmed', 'paid'].includes(i.status));
  res.json(sub);
}));

router.get('/invoices', h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = [VISIBLE, 'i.customer_id = ?']; const params = [req.user.id];
  if (req.query.status === 'overdue') { where.push("i.status = 'confirmed' AND i.due_date < ?"); params.push(today()); }
  else if (req.query.status === 'outstanding') where.push("i.status = 'confirmed'");
  else if (req.query.status === 'paid') where.push("i.status = 'paid'");
  const W = `WHERE ${where.join(' AND ')}`;
  const { total } = db().get(`SELECT COUNT(*) AS total FROM invoices i ${W}`, ...params);
  const rows = db().all(
    `SELECT i.id, i.number, i.period_start, i.period_end, i.invoice_date, i.due_date, i.status, i.total, i.amount_paid
       FROM invoices i ${W} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ data: rows.map(invoices.decorate), meta: meta(page, pageSize, total) });
}));

router.get('/invoices/:id', h((req, res) => {
  const inv = invoices.getDetail(Number(req.params.id));
  if (inv.customer_id !== req.user.id || !['confirmed', 'paid'].includes(inv.status)) throw notFound('Invoice');
  res.json(inv);
}));

router.put('/profile', h((req, res) => {
  const b = validate(req.body, {
    name: { type: 'string', required: true, max: 120 },
    company: { type: 'string', max: 160 },
    phone: { type: 'string', max: 40 },
    address: { type: 'string', max: 400 },
  });
  db().run('UPDATE users SET name = ?, company = ?, phone = ?, address = ? WHERE id = ?', b.name, b.company, b.phone, b.address, req.user.id);
  res.json(db().get('SELECT id, name, email, role, company, phone, address FROM users WHERE id = ?', req.user.id));
}));

module.exports = router;
