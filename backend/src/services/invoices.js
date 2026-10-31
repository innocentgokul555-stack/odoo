const { getDb } = require('../db');
const { badRequest, notFound, conflict } = require('../util/errors');
const { today } = require('../util/dates');
const { r2 } = require('../util/money');
const config = require('../config');
const subs = require('./subscriptions');
const { sendMail } = require('./mailer');

const db = () => getDb();

function decorate(inv) {
  if (!inv) return inv;
  inv.balance = r2(inv.total - inv.amount_paid);
  inv.overdue = inv.status === 'confirmed' && inv.due_date < today();
  inv.days_overdue = inv.overdue ? Math.round((Date.parse(today()) - Date.parse(inv.due_date)) / 86400000) : 0;
  return inv;
}

function getDetail(id) {
  const inv = db().get(
    `SELECT i.*, s.number AS subscription_number FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE i.id = ?`, id);
  if (!inv) throw notFound('Invoice');
  inv.lines = db().all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', id);
  inv.discounts = db().all('SELECT * FROM invoice_discounts WHERE invoice_id = ? ORDER BY id', id);
  inv.payments = db().all(
    `SELECT p.*, u.name AS recorded_by_name FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
      WHERE p.invoice_id = ? ORDER BY p.paid_on, p.id`, id);
  return decorate(inv);
}

function confirm(id) {
  return db().transaction(() => {
    const inv = db().get('SELECT * FROM invoices WHERE id = ?', id);
    if (!inv) throw notFound('Invoice');
    if (inv.status !== 'draft') throw conflict(`Only a draft invoice can be confirmed (this one is ${inv.status})`);
    if (inv.total <= 0) {
      db().run("UPDATE invoices SET status = 'paid', confirmed_at = datetime('now'), paid_at = ? WHERE id = ?", today(), id);
    } else {
      db().run("UPDATE invoices SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?", id);
    }
    return getDetail(id);
  })();
}

function cancel(id, user) {
  return db().transaction(() => {
    const inv = db().get('SELECT * FROM invoices WHERE id = ?', id);
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'cancelled') throw conflict('This invoice is already cancelled');
    if (inv.status === 'paid' || inv.amount_paid > 0) {
      throw conflict('This invoice already has payments. Remove the payments first if it really must be cancelled.');
    }
    db().run("UPDATE invoices SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?", id);
    // Give discount usages back, so a cancelled invoice does not use up a limited discount.
    db().run(
      'UPDATE discounts SET times_used = MAX(0, times_used - 1) WHERE id IN (SELECT discount_id FROM invoice_discounts WHERE invoice_id = ?)', id);
    subs.logEvent(inv.subscription_id, 'Invoice cancelled', null, null, user && user.id, inv.number);
    return getDetail(id);
  })();
}

async function send(id, user) {
  let inv = db().get('SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'cancelled') throw conflict('A cancelled invoice cannot be sent');
  if (inv.status === 'draft') confirm(id); // sending a draft confirms it first
  inv = getDetail(id);
  const link = `${config.appUrl}/portal/invoices/${id}`;
  const money = (n) => `${n.toFixed(2)} ${config.currency}`;
  const lines = inv.lines.map((l) => `  - ${l.description} x ${l.quantity}: ${money(l.line_total)}`).join('\n');
  await sendMail({
    to: inv.customer_email,
    subject: `Invoice ${inv.number} from ${config.company}`,
    text:
      `Hello ${inv.customer_name},\n\nHere is your invoice ${inv.number} for ${inv.period_start} to ${inv.period_end}.\n\n${lines}\n\n` +
      `Total: ${money(inv.total)}\nDue date: ${inv.due_date}\n\nView or print it here: ${link}\n\nThank you,\n${config.company}`,
    link,
  });
  db().run("UPDATE invoices SET sent_at = datetime('now') WHERE id = ?", id);
  subs.logEvent(inv.subscription_id, 'Invoice sent', null, null, user && user.id, `${inv.number} to ${inv.customer_email}`);
  return getDetail(id);
}

const METHODS = ['bank_transfer', 'card', 'cash', 'cheque', 'online', 'other'];

function recordPayment({ invoice_id, method, amount, paid_on, note }, user) {
  return db().transaction(() => {
    const inv = db().get('SELECT * FROM invoices WHERE id = ?', invoice_id);
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'draft') throw conflict('Confirm the invoice before recording a payment');
    if (inv.status === 'cancelled') throw conflict('This invoice is cancelled');
    if (inv.status === 'paid') throw conflict('This invoice is already fully paid');
    const balance = r2(inv.total - inv.amount_paid);
    if (amount > balance + 0.004) throw badRequest(`Amount is more than the outstanding balance of ${balance.toFixed(2)}`, { amount: `Maximum is ${balance.toFixed(2)}` });
    if (paid_on > today()) throw badRequest('Payment date cannot be in the future', { paid_on: 'Payment date cannot be in the future' });

    const { id } = db().run(
      'INSERT INTO payments (invoice_id, customer_id, method, amount, paid_on, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      inv.id, inv.customer_id, method, r2(amount), paid_on, note || null, user ? user.id : null);
    const paidNow = r2(inv.amount_paid + amount);
    if (r2(inv.total - paidNow) <= 0) {
      db().run("UPDATE invoices SET amount_paid = ?, status = 'paid', paid_at = ? WHERE id = ?", paidNow, paid_on, inv.id);
    } else {
      db().run('UPDATE invoices SET amount_paid = ? WHERE id = ?', paidNow, inv.id);
    }
    subs.logEvent(inv.subscription_id, 'Payment recorded', null, null, user && user.id, `${inv.number}: ${r2(amount).toFixed(2)} by ${method.replace('_', ' ')}`);
    return db().get('SELECT * FROM payments WHERE id = ?', id);
  })();
}

function deletePayment(id) {
  return db().transaction(() => {
    const p = db().get('SELECT * FROM payments WHERE id = ?', id);
    if (!p) throw notFound('Payment');
    const inv = db().get('SELECT * FROM invoices WHERE id = ?', p.invoice_id);
    const paid = Math.max(0, r2(inv.amount_paid - p.amount));
    db().run('DELETE FROM payments WHERE id = ?', id);
    db().run("UPDATE invoices SET amount_paid = ?, status = 'confirmed', paid_at = NULL WHERE id = ?", paid, inv.id);
    return { ok: true };
  })();
}

module.exports = { decorate, getDetail, confirm, cancel, send, recordPayment, deletePayment, METHODS };
