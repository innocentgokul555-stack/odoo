const { getDb } = require('../db');
const { HttpError, badRequest, notFound, conflict } = require('../util/errors');
const { today, addDays, diffDays, addPeriod } = require('../util/dates');
const { r2 } = require('../util/money');

const db = () => getDb();

function getPlan(id) {
  const plan = db().get('SELECT * FROM plans WHERE id = ?', id);
  if (!plan) throw notFound('Plan');
  return plan;
}

function logEvent(subscriptionId, event, fromStatus, toStatus, userId, note) {
  db().run(
    'INSERT INTO subscription_events (subscription_id, event, from_status, to_status, user_id, note) VALUES (?, ?, ?, ?, ?, ?)',
    subscriptionId, event, fromStatus || null, toStatus || null, userId || null, note || null
  );
}

// Sum of the subscription lines + the plan fee = what one billing cycle costs before tax/discounts.
function recalcRecurring(subscriptionId) {
  const sub = db().get('SELECT plan_price FROM subscriptions WHERE id = ?', subscriptionId);
  const { s } = db().get('SELECT COALESCE(SUM(amount), 0) AS s FROM subscription_lines WHERE subscription_id = ?', subscriptionId);
  db().run('UPDATE subscriptions SET recurring_total = ?, updated_at = datetime(\'now\') WHERE id = ?', r2(s + sub.plan_price), subscriptionId);
}

function assertPlanAvailable(plan, startDate) {
  if (!plan.active) throw badRequest('That plan is not active', { plan_id: 'This plan is no longer offered' });
  if (plan.available_from && startDate < plan.available_from) {
    throw badRequest('Plan not available yet', { plan_id: `This plan is available from ${plan.available_from}` });
  }
  if (plan.available_to && startDate > plan.available_to) {
    throw badRequest('Plan no longer available', { plan_id: `This plan was available until ${plan.available_to}` });
  }
}

// Validates raw lines from the client and returns rows ready to insert.
function normalizeLines(rawLines, plan) {
  if (!Array.isArray(rawLines)) throw badRequest('Add at least one product line', { lines: 'Add at least one product line' });
  const minQty = Math.max(1, plan.min_quantity || 1);
  return rawLines.map((l, i) => {
    const product = db().get('SELECT * FROM products WHERE id = ?', Number(l.product_id));
    if (!product || !product.active) throw badRequest(`Line ${i + 1}: choose an active product`, { lines: `Line ${i + 1}: choose an active product` });
    let variant = null;
    if (l.variant_id) {
      variant = db().get('SELECT * FROM product_variants WHERE id = ? AND product_id = ? AND active = 1', Number(l.variant_id), product.id);
      if (!variant) throw badRequest(`Line ${i + 1}: that variant does not belong to the product`, { lines: `Line ${i + 1}: invalid variant` });
    }
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity < minQty) {
      throw badRequest(`Line ${i + 1}: minimum quantity for this plan is ${minQty}`, { lines: `Line ${i + 1}: minimum quantity for this plan is ${minQty}` });
    }
    const defaultPrice = r2(product.sales_price + (variant ? variant.extra_price : 0));
    const unit = l.unit_price === undefined || l.unit_price === null || l.unit_price === '' ? defaultPrice : Number(l.unit_price);
    if (!Number.isFinite(unit) || unit < 0) throw badRequest(`Line ${i + 1}: unit price must be 0 or more`, { lines: `Line ${i + 1}: invalid unit price` });
    const tax = product.tax_id ? db().get('SELECT * FROM taxes WHERE id = ? AND active = 1', product.tax_id) : null;
    return {
      product_id: product.id,
      variant_id: variant ? variant.id : null,
      description: variant ? `${product.name} (${variant.attribute}: ${variant.value})` : product.name,
      quantity,
      unit_price: r2(unit),
      tax_id: tax ? tax.id : null,
      tax_name: tax ? tax.name : null,
      tax_rate: tax ? tax.rate : 0,
      amount: r2(quantity * unit),
    };
  });
}

function insertLines(subscriptionId, lines) {
  for (const l of lines) {
    db().run(
      `INSERT INTO subscription_lines (subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id, tax_name, tax_rate, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      subscriptionId, l.product_id, l.variant_id, l.description, l.quantity, l.unit_price, l.tax_id, l.tax_name, l.tax_rate, l.amount
    );
  }
}

function planSnapshot(plan) {
  const tax = plan.tax_id ? db().get('SELECT * FROM taxes WHERE id = ?', plan.tax_id) : null;
  return {
    billing_period: plan.billing_period,
    plan_price: plan.price,
    plan_tax_id: tax ? tax.id : null,
    plan_tax_name: tax ? tax.name : null,
    plan_tax_rate: tax ? tax.rate : 0,
  };
}

// Price of one cycle including tax (used for previews).
function cycleTotals(sub, lines) {
  let subtotal = sub.plan_price;
  let tax = r2(sub.plan_price * (sub.plan_tax_rate || 0) / 100);
  for (const l of lines) {
    subtotal += l.amount;
    tax += r2(l.amount * (l.tax_rate || 0) / 100);
  }
  return { subtotal: r2(subtotal), tax_total: r2(tax), total: r2(subtotal + tax) };
}

function getDetail(id) {
  const sub = db().get(
    `SELECT s.*, c.name AS customer_name, c.email AS customer_email, c.company AS customer_company,
            p.name AS plan_name, p.closable, p.pausable, p.renewable, p.auto_close, p.min_quantity AS plan_min_quantity,
            pt.name AS payment_term_name, pt.days AS payment_term_days, t.name AS template_name
       FROM subscriptions s
       JOIN users c ON c.id = s.customer_id
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN payment_terms pt ON pt.id = s.payment_term_id
       LEFT JOIN quotation_templates t ON t.id = s.template_id
      WHERE s.id = ?`, id);
  if (!sub) throw notFound('Subscription');
  const lines = db().all('SELECT * FROM subscription_lines WHERE subscription_id = ? ORDER BY id', id);
  const events = db().all(
    `SELECT e.*, u.name AS user_name FROM subscription_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.subscription_id = ? ORDER BY e.id DESC`, id);
  const invoices = db().all(
    `SELECT id, number, period_start, period_end, invoice_date, due_date, status, total, amount_paid,
            (total - amount_paid) AS balance
       FROM invoices WHERE subscription_id = ? ORDER BY period_start DESC, id DESC`, id);
  sub.is_paused = !!sub.paused_at;
  sub.lines = lines;
  sub.events = events;
  sub.invoices = invoices;
  sub.totals = cycleTotals(sub, lines);
  sub.allowed_actions = allowedActions(sub);
  return sub;
}

// What can be done to this subscription right now (drives the buttons in the UI).
function allowedActions(sub) {
  const a = [];
  const paused = !!sub.paused_at;
  if (sub.status === 'draft') a.push('quote', 'close');
  if (sub.status === 'quotation') a.push('confirm', 'to_draft', 'close');
  if (sub.status === 'confirmed') a.push('activate', 'close');
  if (sub.status === 'active') {
    if (sub.closable) a.push('close');
    if (sub.pausable && !paused) a.push('pause');
    if (paused) a.push('resume');
    if (sub.renewable) a.push('renew');
  }
  return a;
}

/**
 * Moves a subscription along its life: Draft -> Quotation -> Confirmed -> Active -> Closed,
 * plus pause / resume / renew while it is active. The plan decides what is allowed.
 */
function applyAction(id, action, user, opts = {}) {
  return db().transaction(() => {
    const sub = getDetail(id);
    const from = sub.status;
    const need = (cond, msg) => { if (!cond) throw conflict(msg); };
    const t = today();

    switch (action) {
      case 'quote': {
        need(from === 'draft', 'Only a draft can be turned into a quotation');
        need(sub.lines.length > 0 || sub.plan_price > 0, 'Add at least one product line first');
        const until = addDays(t, sub.quote_validity_days);
        db().run('UPDATE subscriptions SET status = ?, quote_valid_until = ?, updated_at = datetime(\'now\') WHERE id = ?', 'quotation', until, id);
        logEvent(id, 'Quotation sent', from, 'quotation', user.id, `Valid until ${until}`);
        break;
      }
      case 'to_draft': {
        need(from === 'quotation', 'Only a quotation can go back to draft');
        db().run('UPDATE subscriptions SET status = ?, quote_valid_until = NULL, updated_at = datetime(\'now\') WHERE id = ?', 'draft', id);
        logEvent(id, 'Moved back to draft', from, 'draft', user.id);
        break;
      }
      case 'confirm': {
        need(from === 'quotation', 'Only a quotation can be confirmed');
        need(!sub.quote_valid_until || sub.quote_valid_until >= t,
          `This quotation expired on ${sub.quote_valid_until}. Move it back to draft and send a new quotation.`);
        db().run('UPDATE subscriptions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', 'confirmed', id);
        logEvent(id, 'Confirmed by customer', from, 'confirmed', user.id);
        break;
      }
      case 'activate': {
        need(from === 'confirmed', 'Only a confirmed subscription can be activated');
        db().run(
          `UPDATE subscriptions SET status = 'active', billing_anchor = start_date, periods_billed = 0,
                  next_invoice_date = start_date, updated_at = datetime('now') WHERE id = ?`, id);
        logEvent(id, 'Activated', from, 'active', user.id, `First invoice is due ${sub.start_date}`);
        break;
      }
      case 'close': {
        need(from !== 'closed', 'This subscription is already closed');
        if (from === 'active') need(sub.closable || opts.system, 'This plan does not allow closing early');
        db().run(
          `UPDATE subscriptions SET status = 'closed', closed_at = ?, close_reason = ?, paused_at = NULL,
                  updated_at = datetime('now') WHERE id = ?`,
          opts.closedOn || t, opts.reason || (from === 'active' ? 'Closed early' : 'Cancelled before activation'), id);
        logEvent(id, opts.system ? 'Closed automatically' : 'Closed', from, 'closed', user && user.id, opts.reason);
        break;
      }
      case 'pause': {
        need(from === 'active', 'Only an active subscription can be paused');
        need(sub.pausable, 'This plan cannot be paused');
        need(!sub.paused_at, 'Already paused');
        db().run('UPDATE subscriptions SET paused_at = ?, updated_at = datetime(\'now\') WHERE id = ?', t, id);
        logEvent(id, 'Paused', from, from, user.id, 'No invoices are created while paused');
        break;
      }
      case 'resume': {
        need(from === 'active' && sub.paused_at, 'This subscription is not paused');
        // The pause extends the term: billing dates and the expiry move forward by the paused days.
        const days = Math.max(0, diffDays(sub.paused_at, t));
        db().run(
          `UPDATE subscriptions SET paused_at = NULL, billing_anchor = ?, next_invoice_date = ?, expiry_date = ?,
                  updated_at = datetime('now') WHERE id = ?`,
          addDays(sub.billing_anchor, days), addDays(sub.next_invoice_date, days), addDays(sub.expiry_date, days), id);
        logEvent(id, 'Resumed', from, from, user.id, `Billing and expiry moved forward ${days} day(s)`);
        break;
      }
      case 'renew': {
        need(from === 'active', 'Only an active subscription can be renewed');
        need(sub.renewable, 'This plan cannot be renewed');
        const newExpiry = addDays(sub.expiry_date, sub.term_days);
        db().run('UPDATE subscriptions SET expiry_date = ?, updated_at = datetime(\'now\') WHERE id = ?', newExpiry, id);
        logEvent(id, 'Renewed', from, from, user.id, `New expiry date ${newExpiry}`);
        break;
      }
      default:
        throw new HttpError(404, `Unknown action: ${action}`);
    }
    return getDetail(id);
  })();
}

// Creates a draft subscription (with its lines) in one go. `b` holds the validated header fields.
function create(b, plan, lines, userId) {
  return db().transaction(() => {
    const snap = planSnapshot(plan);
    const number = db().nextNumber('subscription', 'SUB');
    const { id } = db().run(
      `INSERT INTO subscriptions (number, customer_id, plan_id, template_id, status, start_date, expiry_date, term_days, billing_period,
          plan_price, plan_tax_id, plan_tax_name, plan_tax_rate, payment_term_id, quote_validity_days, notes, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      number, b.customer_id, b.plan_id, b.template_id || null, b.start_date, b.expiry_date, diffDays(b.start_date, b.expiry_date), snap.billing_period,
      snap.plan_price, snap.plan_tax_id, snap.plan_tax_name, snap.plan_tax_rate, b.payment_term_id || null, b.quote_validity_days || 30, b.notes || null, userId || null);
    insertLines(id, lines);
    recalcRecurring(id);
    logEvent(id, 'Created', null, 'draft', userId, b.template_id ? 'Started from a quotation template' : null);
    return id;
  })();
}

module.exports = {
  create, getPlan, logEvent, recalcRecurring, assertPlanAvailable, normalizeLines, insertLines,
  planSnapshot, getDetail, allowedActions, applyAction, cycleTotals, addPeriod,
};
