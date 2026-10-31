const { getDb } = require('../db');
const { today, addDays, addMonths } = require('../util/dates');
const { r2 } = require('../util/money');
const invoices = require('./invoices');

const db = () => getDb();
const MRR_SQL = `CASE s.billing_period WHEN 'daily' THEN 30.0 WHEN 'weekly' THEN 52.0/12 WHEN 'monthly' THEN 1.0 ELSE 1.0/12 END`;

/**
 * The finance lead's single page: subscriptions, recurring revenue, invoices, payments and overdue.
 * Filters: from / to (invoice date and payment date), customer_id, plan_id.
 */
function summary({ from, to, customer_id, plan_id } = {}) {
  const t = today();

  // Subscriptions -----------------------------------------------------
  const sw = []; const sp = [];
  if (customer_id) { sw.push('s.customer_id = ?'); sp.push(customer_id); }
  if (plan_id) { sw.push('s.plan_id = ?'); sp.push(plan_id); }
  const sWhere = sw.length ? `WHERE ${sw.join(' AND ')}` : '';
  const byStatus = Object.fromEntries(
    db().all(`SELECT s.status, COUNT(*) AS n FROM subscriptions s ${sWhere} GROUP BY s.status`, ...sp).map((r) => [r.status, r.n]));
  const { paused } = db().get(
    `SELECT COUNT(*) AS paused FROM subscriptions s ${sWhere ? `${sWhere} AND` : 'WHERE'} s.status = 'active' AND s.paused_at IS NOT NULL`, ...sp);
  const subscriptions = {
    draft: byStatus.draft || 0, quotation: byStatus.quotation || 0, confirmed: byStatus.confirmed || 0,
    active: (byStatus.active || 0) - paused, paused, closed: byStatus.closed || 0,
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
  };
  const { mrr } = db().get(
    `SELECT COALESCE(SUM(s.recurring_total * ${MRR_SQL}), 0) AS mrr FROM subscriptions s
      ${sWhere ? `${sWhere} AND` : 'WHERE'} s.status = 'active' AND s.paused_at IS NULL`, ...sp);

  // Invoices ----------------------------------------------------------
  const iw = []; const ip = [];
  if (from) { iw.push('i.invoice_date >= ?'); ip.push(from); }
  if (to) { iw.push('i.invoice_date <= ?'); ip.push(to); }
  if (customer_id) { iw.push('i.customer_id = ?'); ip.push(customer_id); }
  if (plan_id) { iw.push('s.plan_id = ?'); ip.push(plan_id); }
  const iJoin = plan_id ? 'JOIN subscriptions s ON s.id = i.subscription_id' : '';
  const iWhere = iw.length ? `WHERE ${iw.join(' AND ')}` : '';
  const inv = db().get(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN i.status != 'cancelled' THEN i.total END), 0) AS invoiced_total,
            COALESCE(SUM(CASE WHEN i.status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
            COALESCE(SUM(CASE WHEN i.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_count,
            COALESCE(SUM(CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_count,
            COALESCE(SUM(CASE WHEN i.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
            COALESCE(SUM(CASE WHEN i.status = 'confirmed' THEN i.total - i.amount_paid END), 0) AS outstanding_total,
            COALESCE(SUM(CASE WHEN i.status = 'confirmed' AND i.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count,
            COALESCE(SUM(CASE WHEN i.status = 'confirmed' AND i.due_date < ? THEN i.total - i.amount_paid END), 0) AS overdue_total,
            COALESCE(SUM(CASE WHEN i.status = 'draft' THEN i.total END), 0) AS draft_total
       FROM invoices i ${iJoin} ${iWhere}`, t, t, ...ip);

  const aging = db().get(
    `SELECT COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 1 AND 30 THEN i.total - i.amount_paid END), 0) AS d30,
            COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 31 AND 60 THEN i.total - i.amount_paid END), 0) AS d60,
            COALESCE(SUM(CASE WHEN julianday(?) - julianday(i.due_date) > 60 THEN i.total - i.amount_paid END), 0) AS d90
       FROM invoices i ${iJoin} ${iWhere ? `${iWhere} AND` : 'WHERE'} i.status = 'confirmed' AND i.due_date < ?`, t, t, t, ...ip, t);

  // Payments ----------------------------------------------------------
  const pw = []; const pp = [];
  if (from) { pw.push('p.paid_on >= ?'); pp.push(from); }
  if (to) { pw.push('p.paid_on <= ?'); pp.push(to); }
  if (customer_id) { pw.push('p.customer_id = ?'); pp.push(customer_id); }
  if (plan_id) { pw.push('s.plan_id = ?'); pp.push(plan_id); }
  const pJoin = plan_id ? 'JOIN invoices i ON i.id = p.invoice_id JOIN subscriptions s ON s.id = i.subscription_id' : '';
  const pWhere = pw.length ? `WHERE ${pw.join(' AND ')}` : '';
  const pay = db().get(`SELECT COALESCE(SUM(p.amount), 0) AS collected_total, COUNT(*) AS count FROM payments p ${pJoin} ${pWhere}`, ...pp);
  const byMethod = db().all(
    `SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total FROM payments p ${pJoin} ${pWhere}
      GROUP BY p.method ORDER BY total DESC`, ...pp);

  // Monthly chart (last 12 months, or the chosen range) ---------------
  const endMonth = (to || t).slice(0, 7);
  let startMonth = from ? from.slice(0, 7) : addMonths(`${endMonth}-01`, -11).slice(0, 7);
  const months = [];
  for (let m = `${startMonth}-01`; m.slice(0, 7) <= endMonth && months.length < 36; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const invByMonth = Object.fromEntries(db().all(
    `SELECT substr(i.invoice_date, 1, 7) AS m, SUM(i.total) AS v FROM invoices i ${iJoin}
      ${iWhere ? `${iWhere} AND` : 'WHERE'} i.status != 'cancelled' AND substr(i.invoice_date, 1, 7) >= ? AND substr(i.invoice_date, 1, 7) <= ?
      GROUP BY m`, ...ip, months[0], endMonth).map((r) => [r.m, r.v]));
  const payByMonth = Object.fromEntries(db().all(
    `SELECT substr(p.paid_on, 1, 7) AS m, SUM(p.amount) AS v FROM payments p ${pJoin}
      ${pWhere ? `${pWhere} AND` : 'WHERE'} substr(p.paid_on, 1, 7) >= ? AND substr(p.paid_on, 1, 7) <= ?
      GROUP BY m`, ...pp, months[0], endMonth).map((r) => [r.m, r.v]));
  const revenue_by_month = months.map((m) => ({ month: m, invoiced: r2(invByMonth[m] || 0), collected: r2(payByMonth[m] || 0) }));

  // Lists on the dashboard -------------------------------------------
  const upcoming_renewals = db().all(
    `SELECT s.id, s.number, s.expiry_date, s.recurring_total, s.billing_period, c.name AS customer_name, p.name AS plan_name,
            p.auto_close, p.renewable
       FROM subscriptions s JOIN users c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
       ${sWhere ? `${sWhere} AND` : 'WHERE'} s.status = 'active' AND s.expiry_date BETWEEN ? AND ?
      ORDER BY s.expiry_date LIMIT 8`, ...sp, t, addDays(t, 30));
  const top_overdue = db().all(
    `SELECT i.id, i.number, i.customer_name, i.due_date, i.total, i.amount_paid, (i.total - i.amount_paid) AS balance
       FROM invoices i ${iJoin} ${iWhere ? `${iWhere} AND` : 'WHERE'} i.status = 'confirmed' AND i.due_date < ?
      ORDER BY i.due_date LIMIT 8`, ...ip, t).map(invoices.decorate);

  return {
    filters: { from: from || null, to: to || null, customer_id: customer_id || null, plan_id: plan_id || null },
    subscriptions,
    recurring: { mrr: r2(mrr), arr: r2(mrr * 12) },
    invoices: {
      count: inv.count, invoiced_total: r2(inv.invoiced_total), draft_count: inv.draft_count, draft_total: r2(inv.draft_total),
      confirmed_count: inv.confirmed_count, paid_count: inv.paid_count, cancelled_count: inv.cancelled_count,
      outstanding_total: r2(inv.outstanding_total), overdue_count: inv.overdue_count, overdue_total: r2(inv.overdue_total),
      aging: { d1_30: r2(aging.d30), d31_60: r2(aging.d60), d60_plus: r2(aging.d90) },
    },
    payments: { collected_total: r2(pay.collected_total), count: pay.count, by_method: byMethod.map((m) => ({ ...m, total: r2(m.total) })) },
    revenue_by_month, upcoming_renewals, top_overdue,
  };
}

module.exports = { summary };
