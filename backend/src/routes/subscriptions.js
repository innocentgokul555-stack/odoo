const express = require('express');
const { getDb } = require('../db');
const { h, paging, meta, likeTerm } = require('../util/http');
const { validate } = require('../util/validate');
const { badRequest, notFound, conflict } = require('../util/errors');
const { requireRole } = require('../middleware/auth');
const { today, addDays, diffDays } = require('../util/dates');
const subs = require('../services/subscriptions');
const billing = require('../services/billing');

const router = express.Router();
const db = () => getDb();
router.use(requireRole('admin', 'staff'));

const schema = {
  customer_id: { type: 'int', required: true, label: 'Customer' },
  plan_id: { type: 'int', required: true, label: 'Plan' },
  template_id: { type: 'int' },
  start_date: { type: 'date', required: true },
  expiry_date: { type: 'date', required: true },
  payment_term_id: { type: 'int' },
  quote_validity_days: { type: 'int', min: 1, max: 365, default: 30, label: 'Quotation validity (days)' },
  notes: { type: 'string', max: 2000 },
};

// Shared by create + update: checks everything and returns the clean data.
function prepare(body) {
  const b = validate(body, schema);
  const customer = db().get("SELECT id, active FROM users WHERE id = ? AND role = 'customer'", b.customer_id);
  if (!customer) throw badRequest('Unknown customer', { customer_id: 'Choose a customer' });
  if (!customer.active) throw badRequest('That customer account is disabled', { customer_id: 'This customer is disabled' });
  const plan = subs.getPlan(b.plan_id);
  subs.assertPlanAvailable(plan, b.start_date);
  if (b.expiry_date <= b.start_date) throw badRequest('Check the dates', { expiry_date: 'Expiry must be after the start date' });
  if (b.payment_term_id && !db().get('SELECT id FROM payment_terms WHERE id = ?', b.payment_term_id)) {
    throw badRequest('Unknown payment term', { payment_term_id: 'Choose a payment term' });
  }

  let rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (b.template_id) {
    const tpl = db().get('SELECT * FROM quotation_templates WHERE id = ?', b.template_id);
    if (!tpl) throw badRequest('Unknown template', { template_id: 'Choose a template' });
    b.quote_validity_days = tpl.validity_days; // the template decides how long its quotation stays valid
    if (!rawLines || !rawLines.length) rawLines = db().all('SELECT product_id, variant_id, quantity FROM template_lines WHERE template_id = ? ORDER BY id', tpl.id);
  }
  if ((!rawLines || !rawLines.length) && plan.price <= 0) {
    throw badRequest('Add at least one product line', { lines: 'Add at least one product line' });
  }
  const lines = subs.normalizeLines(rawLines || [], plan);
  return { b, plan, lines };
}

router.get('/', h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = []; const params = [];
  const t = today();
  if (req.query.status === 'paused') where.push("s.status = 'active' AND s.paused_at IS NOT NULL");
  else if (req.query.status === 'expiring') { where.push("s.status = 'active' AND s.expiry_date BETWEEN ? AND ?"); params.push(t, addDays(t, 30)); }
  else if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.customer_id) { where.push('s.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.plan_id) { where.push('s.plan_id = ?'); params.push(Number(req.query.plan_id)); }
  if (req.query.search) {
    where.push("(s.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.company LIKE ? ESCAPE '\\')");
    const term = likeTerm(req.query.search);
    params.push(term, term, term);
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortable = { id: 's.id', number: 's.number', start_date: 's.start_date', expiry_date: 's.expiry_date', recurring_total: 's.recurring_total', customer: 'c.name' };
  const orderBy = `${sortable[req.query.sort] || 's.id'} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}`;
  const { total } = db().get(`SELECT COUNT(*) AS total FROM subscriptions s JOIN users c ON c.id = s.customer_id ${W}`, ...params);
  const rows = db().all(
    `SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date, s.billing_period, s.recurring_total, s.paused_at,
            s.customer_id, c.name AS customer_name, c.company AS customer_company, s.plan_id, p.name AS plan_name
       FROM subscriptions s JOIN users c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
       ${W} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  rows.forEach((r) => { r.is_paused = !!r.paused_at; });
  res.json({ data: rows, meta: meta(page, pageSize, total) });
}));

router.get('/:id', h((req, res) => res.json(subs.getDetail(Number(req.params.id)))));

router.post('/', h((req, res) => {
  const { b, plan, lines } = prepare(req.body);
  const id = subs.create(b, plan, lines, req.user.id);
  res.status(201).json(subs.getDetail(id));
}));

router.put('/:id', h((req, res) => {
  const id = Number(req.params.id);
  const sub = db().get('SELECT * FROM subscriptions WHERE id = ?', id);
  if (!sub) throw notFound('Subscription');

  if (!['draft', 'quotation'].includes(sub.status)) {
    // Once confirmed, the commercial terms are locked; only the internal note can change.
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() || null : sub.notes;
    db().run("UPDATE subscriptions SET notes = ?, updated_at = datetime('now') WHERE id = ?", notes, id);
    return res.json(subs.getDetail(id));
  }
  const { b, plan, lines } = prepare(req.body);
  db().transaction(() => {
    const snap = subs.planSnapshot(plan);
    db().run(
      `UPDATE subscriptions SET customer_id = ?, plan_id = ?, template_id = ?, start_date = ?, expiry_date = ?, term_days = ?, billing_period = ?,
              plan_price = ?, plan_tax_id = ?, plan_tax_name = ?, plan_tax_rate = ?, payment_term_id = ?, quote_validity_days = ?, notes = ?,
              updated_at = datetime('now') WHERE id = ?`,
      b.customer_id, b.plan_id, b.template_id, b.start_date, b.expiry_date, diffDays(b.start_date, b.expiry_date), snap.billing_period,
      snap.plan_price, snap.plan_tax_id, snap.plan_tax_name, snap.plan_tax_rate, b.payment_term_id, b.quote_validity_days, b.notes, id);
    db().run('DELETE FROM subscription_lines WHERE subscription_id = ?', id);
    subs.insertLines(id, lines);
    subs.recalcRecurring(id);
    subs.logEvent(id, 'Edited', sub.status, sub.status, req.user.id);
  })();
  return res.json(subs.getDetail(id));
}));

router.delete('/:id', h((req, res) => {
  const sub = db().get('SELECT status FROM subscriptions WHERE id = ?', req.params.id);
  if (!sub) throw notFound('Subscription');
  if (sub.status !== 'draft') throw conflict('Only a draft can be deleted. Close the subscription instead.');
  db().run('DELETE FROM subscriptions WHERE id = ?', req.params.id);
  res.json({ ok: true });
}));

// Bill this one subscription now if it is due (same rules as the billing run).
router.post('/:id/bill', h((req, res) => {
  const id = Number(req.params.id);
  const sub = db().get('SELECT status, paused_at, next_invoice_date FROM subscriptions WHERE id = ?', id);
  if (!sub) throw notFound('Subscription');
  if (sub.status !== 'active') throw conflict('Only active subscriptions are billed');
  if (sub.paused_at) throw conflict('This subscription is paused');
  if (sub.next_invoice_date > today()) throw conflict(`Nothing is due yet. The next invoice is due on ${sub.next_invoice_date}.`);
  const r = billing.billSubscription(id, today(), { autoConfirm: false });
  res.json({ invoices_created: r.invoices.length, invoices: r.invoices, subscription: subs.getDetail(id) });
}));

const ACTIONS = ['quote', 'to_draft', 'confirm', 'activate', 'close', 'pause', 'resume', 'renew'];
router.post('/:id/:action', h((req, res) => {
  if (!ACTIONS.includes(req.params.action)) throw notFound('Action');
  res.json(subs.applyAction(Number(req.params.id), req.params.action, req.user, { reason: req.body && req.body.reason }));
}));

module.exports = router;
