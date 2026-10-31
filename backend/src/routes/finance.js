// Invoices, payments, the billing run and the finance reports.
const express = require('express');
const { getDb } = require('../db');
const { h, paging, meta, likeTerm } = require('../util/http');
const { validate } = require('../util/validate');
const { badRequest } = require('../util/errors');
const { requireRole } = require('../middleware/auth');
const { today, isValidDate } = require('../util/dates');
const invoices = require('../services/invoices');
const billing = require('../services/billing');
const reports = require('../services/reports');

const db = () => getDb();
const team = requireRole('admin', 'staff');

/* ----------------------------- Invoices ---------------------------- */
const inv = express.Router();
inv.use(team);

function invoiceFilters(req) {
  const where = []; const params = [];
  const t = today();
  const st = req.query.status;
  if (st === 'overdue') { where.push("i.status = 'confirmed' AND i.due_date < ?"); params.push(t); }
  else if (st === 'outstanding') where.push("i.status = 'confirmed'");
  else if (st) { where.push('i.status = ?'); params.push(st); }
  if (req.query.customer_id) { where.push('i.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.subscription_id) { where.push('i.subscription_id = ?'); params.push(Number(req.query.subscription_id)); }
  if (req.query.from && isValidDate(req.query.from)) { where.push('i.invoice_date >= ?'); params.push(req.query.from); }
  if (req.query.to && isValidDate(req.query.to)) { where.push('i.invoice_date <= ?'); params.push(req.query.to); }
  if (req.query.search) {
    where.push("(i.number LIKE ? ESCAPE '\\' OR i.customer_name LIKE ? ESCAPE '\\' OR i.customer_company LIKE ? ESCAPE '\\')");
    const term = likeTerm(req.query.search);
    params.push(term, term, term);
  }
  return { W: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

inv.get('/', h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const { W, params } = invoiceFilters(req);
  const sortable = { id: 'i.id', invoice_date: 'i.invoice_date', due_date: 'i.due_date', total: 'i.total', number: 'i.number', customer: 'i.customer_name' };
  const orderBy = `${sortable[req.query.sort] || 'i.invoice_date'} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}, i.id DESC`;
  const { total, sum, owed } = db().get(
    `SELECT COUNT(*) AS total, COALESCE(SUM(i.total), 0) AS sum, COALESCE(SUM(i.total - i.amount_paid), 0) AS owed FROM invoices i ${W}`, ...params);
  const rows = db().all(
    `SELECT i.id, i.number, i.subscription_id, s.number AS subscription_number, i.customer_id, i.customer_name, i.customer_company,
            i.period_start, i.period_end, i.invoice_date, i.due_date, i.status, i.total, i.amount_paid, i.sent_at
       FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id ${W} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ data: rows.map(invoices.decorate), meta: { ...meta(page, pageSize, total), sum_total: Math.round(sum * 100) / 100, sum_balance: Math.round(owed * 100) / 100 } });
}));

inv.post('/bulk-confirm', h((req, res) => {
  let ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (req.body.all_drafts) ids = db().all("SELECT id FROM invoices WHERE status = 'draft'").map((r) => r.id);
  let confirmed = 0; const errors = [];
  for (const id of ids) {
    try { invoices.confirm(id); confirmed++; } catch (e) { errors.push({ id, error: e.message }); }
  }
  res.json({ confirmed, skipped: errors.length, errors });
}));

inv.get('/:id', h((req, res) => res.json(invoices.getDetail(Number(req.params.id)))));
inv.post('/:id/confirm', h((req, res) => res.json(invoices.confirm(Number(req.params.id)))));
inv.post('/:id/cancel', h((req, res) => res.json(invoices.cancel(Number(req.params.id), req.user))));
inv.post('/:id/send', h(async (req, res) => res.json(await invoices.send(Number(req.params.id), req.user))));

const paymentSchema = {
  method: { type: 'enum', required: true, values: invoices.METHODS },
  amount: { type: 'number', required: true, min: 0.01 },
  paid_on: { type: 'date', required: true, label: 'Payment date' },
  note: { type: 'string', max: 500 },
};
inv.post('/:id/payments', h((req, res) => {
  const b = validate({ paid_on: today(), ...req.body }, paymentSchema);
  const payment = invoices.recordPayment({ invoice_id: Number(req.params.id), ...b }, req.user);
  res.status(201).json({ payment, invoice: invoices.getDetail(Number(req.params.id)) });
}));

/* ----------------------------- Payments ---------------------------- */
const pay = express.Router();
pay.use(team);

pay.get('/', h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = []; const params = [];
  if (req.query.method) { where.push('p.method = ?'); params.push(req.query.method); }
  if (req.query.customer_id) { where.push('p.customer_id = ?'); params.push(Number(req.query.customer_id)); }
  if (req.query.invoice_id) { where.push('p.invoice_id = ?'); params.push(Number(req.query.invoice_id)); }
  if (req.query.from && isValidDate(req.query.from)) { where.push('p.paid_on >= ?'); params.push(req.query.from); }
  if (req.query.to && isValidDate(req.query.to)) { where.push('p.paid_on <= ?'); params.push(req.query.to); }
  if (req.query.search) {
    where.push("(i.number LIKE ? ESCAPE '\\' OR i.customer_name LIKE ? ESCAPE '\\' OR p.note LIKE ? ESCAPE '\\')");
    const term = likeTerm(req.query.search);
    params.push(term, term, term);
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total, sum } = db().get(`SELECT COUNT(*) AS total, COALESCE(SUM(p.amount), 0) AS sum FROM payments p JOIN invoices i ON i.id = p.invoice_id ${W}`, ...params);
  const rows = db().all(
    `SELECT p.*, i.number AS invoice_number, i.customer_name, u.name AS recorded_by_name
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.recorded_by
       ${W} ORDER BY p.paid_on DESC, p.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ data: rows, meta: { ...meta(page, pageSize, total), sum_total: Math.round(sum * 100) / 100 } });
}));

pay.post('/', h((req, res) => {
  const b = validate({ paid_on: today(), ...req.body }, { invoice_id: { type: 'int', required: true, label: 'Invoice' }, ...paymentSchema });
  res.status(201).json(invoices.recordPayment(b, req.user));
}));
pay.delete('/:id', requireRole('admin'), h((req, res) => res.json(invoices.deletePayment(Number(req.params.id)))));

/* ------------------------------ Billing ---------------------------- */
const bill = express.Router();
bill.use(team);
bill.get('/preview', h((req, res) => res.json(billing.previewBilling(isValidDate(req.query.as_of) ? req.query.as_of : today()))));
bill.post('/run', h((req, res) => {
  const asOf = req.body && req.body.as_of ? req.body.as_of : today();
  if (!isValidDate(asOf)) throw badRequest('Enter a valid date', { as_of: 'Use the format YYYY-MM-DD' });
  res.json(billing.runBilling({ asOf, autoConfirm: !!(req.body && req.body.auto_confirm), user: req.user }));
}));

/* ------------------------------ Reports ---------------------------- */
const rep = express.Router();
rep.use(team);
rep.get('/summary', h((req, res) => {
  const q = req.query;
  res.json(reports.summary({
    from: isValidDate(q.from) ? q.from : null,
    to: isValidDate(q.to) ? q.to : null,
    customer_id: q.customer_id ? Number(q.customer_id) : null,
    plan_id: q.plan_id ? Number(q.plan_id) : null,
  }));
}));

module.exports = { invoices: inv, payments: pay, billing: bill, reports: rep };
