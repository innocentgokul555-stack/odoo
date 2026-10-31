const { getDb } = require('../db');
const { addDays, addPeriod, today } = require('../util/dates');
const { r2 } = require('../util/money');
const { conflict } = require('../util/errors');
const subs = require('./subscriptions');

const db = () => getDb();

/* ------------------------------------------------------------------ */
/*  Discounts - applied automatically, nobody has to remember them     */
/* ------------------------------------------------------------------ */

/**
 * Looks at every discount rule that is active on the invoice date, not used up,
 * and (if set) meant for this customer. A rule applies when its conditions are met:
 *   - scope "products": only the matching product lines count
 *   - scope "subscription": every line (including the plan fee) counts
 *   - min purchase is checked against the line amounts, min quantity against product quantities
 * The discount is then shared across the eligible lines so tax is calculated on the reduced amount.
 */
function applyDiscounts(lines, invoiceDate, customerId) {
  const candidates = db().all(
    `SELECT * FROM discounts
      WHERE active = 1
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date >= ?)
        AND (usage_limit IS NULL OR times_used < usage_limit)
        AND (customer_id IS NULL OR customer_id = ?)
      ORDER BY id`,
    invoiceDate, invoiceDate, customerId
  );
  const applied = [];
  for (const d of candidates) {
    let eligible = lines;
    if (d.applies_to === 'products') {
      const ids = new Set(db().all('SELECT product_id FROM discount_products WHERE discount_id = ?', d.id).map((r) => r.product_id));
      eligible = lines.filter((l) => l.product_id && ids.has(l.product_id));
    }
    if (!eligible.length) continue;

    const gross = r2(eligible.reduce((s, l) => s + l.amount, 0));
    const qty = eligible.filter((l) => l.product_id).reduce((s, l) => s + l.quantity, 0);
    if (gross < d.min_purchase || qty < d.min_quantity) continue;

    const net = r2(eligible.reduce((s, l) => s + (l.amount - l.discount_amount), 0));
    if (net <= 0) continue;

    let amount = d.type === 'percentage' ? r2((net * d.value) / 100) : d.value;
    amount = r2(Math.min(amount, net));
    if (amount <= 0) continue;

    let remaining = amount;
    eligible.forEach((l, i) => {
      const lineNet = r2(l.amount - l.discount_amount);
      let share = i === eligible.length - 1 ? remaining : r2((amount * lineNet) / net);
      share = r2(Math.min(share, lineNet, remaining));
      l.discount_amount = r2(l.discount_amount + share);
      remaining = r2(remaining - share);
    });
    const actual = r2(amount - remaining);
    if (actual > 0) applied.push({ discount_id: d.id, name: d.name, amount: actual });
  }
  return applied;
}

/* ------------------------------------------------------------------ */
/*  Creating one invoice for one billing period                        */
/* ------------------------------------------------------------------ */

function createInvoice(sub, plan, { autoConfirm = false } = {}) {
  const periodStart = sub.next_invoice_date;
  const nextStart = addPeriod(sub.billing_anchor, sub.billing_period, sub.periods_billed + 1);
  const periodEnd = addDays(nextStart, -1);
  const invoiceDate = periodStart;

  const customer = db().get('SELECT name, email, company, address FROM users WHERE id = ?', sub.customer_id);
  const term = sub.payment_term_id ? db().get('SELECT * FROM payment_terms WHERE id = ?', sub.payment_term_id) : null;
  const dueDate = addDays(invoiceDate, term ? term.days : 0);

  // Lines: plan fee first, then the subscription's product lines.
  const lines = [];
  if (sub.plan_price > 0) {
    lines.push({
      product_id: null, description: `${plan.name} - plan fee`, quantity: 1, unit_price: sub.plan_price,
      amount: r2(sub.plan_price), discount_amount: 0,
      tax_id: sub.plan_tax_id, tax_name: sub.plan_tax_name, tax_rate: sub.plan_tax_rate || 0,
    });
  }
  for (const l of db().all('SELECT * FROM subscription_lines WHERE subscription_id = ? ORDER BY id', sub.id)) {
    lines.push({
      product_id: l.product_id, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
      amount: l.amount, discount_amount: 0, tax_id: l.tax_id, tax_name: l.tax_name, tax_rate: l.tax_rate || 0,
    });
  }

  const discounts = applyDiscounts(lines, invoiceDate, sub.customer_id);

  // Taxes are worked out automatically from the tax rules, on the discounted amount.
  let subtotal = 0, discountTotal = 0, taxTotal = 0;
  for (const l of lines) {
    const taxable = r2(l.amount - l.discount_amount);
    l.tax_amount = r2((taxable * l.tax_rate) / 100);
    l.line_total = r2(taxable + l.tax_amount);
    subtotal += l.amount;
    discountTotal += l.discount_amount;
    taxTotal += l.tax_amount;
  }
  subtotal = r2(subtotal); discountTotal = r2(discountTotal); taxTotal = r2(taxTotal);
  const total = r2(subtotal - discountTotal + taxTotal);

  const number = db().nextNumber('invoice', 'INV');
  const { id } = db().run(
    `INSERT INTO invoices (number, subscription_id, customer_id, customer_name, customer_email, customer_company, customer_address,
        period_start, period_end, invoice_date, due_date, payment_term_name, status, subtotal, discount_total, tax_total, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    number, sub.id, sub.customer_id, customer.name, customer.email, customer.company, customer.address,
    periodStart, periodEnd, invoiceDate, dueDate, term ? term.name : 'Immediate', subtotal, discountTotal, taxTotal, total
  );
  for (const l of lines) {
    db().run(
      `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price, amount, discount_amount,
          tax_id, tax_name, tax_rate, tax_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, l.product_id, l.description, l.quantity, l.unit_price, l.amount, l.discount_amount,
      l.tax_id, l.tax_name, l.tax_rate, l.tax_amount, l.line_total
    );
  }
  for (const d of discounts) {
    db().run('INSERT INTO invoice_discounts (invoice_id, discount_id, name, amount) VALUES (?, ?, ?, ?)', id, d.discount_id, d.name, d.amount);
    db().run('UPDATE discounts SET times_used = times_used + 1 WHERE id = ?', d.discount_id);
  }
  if (autoConfirm) {
    if (total <= 0) db().run("UPDATE invoices SET status = 'paid', confirmed_at = datetime('now'), paid_at = ? WHERE id = ?", invoiceDate, id);
    else db().run("UPDATE invoices SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?", id);
  }
  subs.logEvent(sub.id, 'Invoice created', null, null, null, `${number} for ${periodStart} to ${periodEnd}`);
  return { id, number };
}

/* ------------------------------------------------------------------ */
/*  Billing one subscription (catches up on every missed period)       */
/* ------------------------------------------------------------------ */

/**
 * Creates an invoice for every billing period that is due up to `asOf`.
 * Billing is in advance: the invoice for a period is due on the period's first day.
 * Each period is invoiced at most once (guarded by next_invoice_date AND a unique database index),
 * and a subscription that was not billed for a while is caught up, so nothing is skipped.
 * Plans with "close automatically" are closed once their expiry date has passed;
 * other plans roll over into a new term.
 */
function billSubscription(id, asOf, { autoConfirm = false } = {}) {
  return db().transaction(() => {
    const sub = db().get('SELECT * FROM subscriptions WHERE id = ?', id);
    if (!sub || sub.status !== 'active' || sub.paused_at) return { invoices: [], closed: false, rolled: 0 };
    const plan = subs.getPlan(sub.plan_id);
    const invoices = [];
    let rolled = 0;
    let closed = false;
    let guard = 0;

    while (sub.next_invoice_date <= asOf && guard++ < 1000) {
      if (sub.next_invoice_date >= sub.expiry_date) {
        if (plan.auto_close) break;
        sub.expiry_date = addDays(sub.expiry_date, sub.term_days);
        rolled++;
        continue;
      }
      invoices.push(createInvoice(sub, plan, { autoConfirm }));
      sub.periods_billed += 1;
      sub.next_invoice_date = addPeriod(sub.billing_anchor, sub.billing_period, sub.periods_billed);
    }

    if (sub.expiry_date <= asOf) {
      if (plan.auto_close) closed = true;
      else {
        while (sub.expiry_date <= asOf) { sub.expiry_date = addDays(sub.expiry_date, sub.term_days); rolled++; }
      }
    }

    db().run(
      `UPDATE subscriptions SET periods_billed = ?, next_invoice_date = ?, expiry_date = ?, updated_at = datetime('now') WHERE id = ?`,
      sub.periods_billed, sub.next_invoice_date, sub.expiry_date, id
    );
    if (rolled) subs.logEvent(id, 'Renewed automatically', null, null, null, `New expiry date ${sub.expiry_date}`);
    if (closed) {
      db().run("UPDATE subscriptions SET status = 'closed', closed_at = ?, close_reason = 'Expired', updated_at = datetime('now') WHERE id = ?", asOf, id);
      subs.logEvent(id, 'Closed automatically', 'active', 'closed', null, 'The plan ended on its expiry date');
    }
    return { invoices, closed, rolled };
  })();
}

/* ------------------------------------------------------------------ */
/*  The billing run - "billing day"                                    */
/* ------------------------------------------------------------------ */

let running = false;

function runBilling({ asOf = today(), autoConfirm = false, user = null } = {}) {
  if (running) throw conflict('A billing run is already in progress');
  running = true;
  try {
    const summary = {
      as_of: asOf, activated: 0, subscriptions_billed: 0, invoices_created: 0,
      closed: 0, rolled_over: 0, errors: [], invoice_ids: [],
    };

    for (const { id } of db().all("SELECT id FROM subscriptions WHERE status = 'confirmed' AND start_date <= ?", asOf)) {
      try {
        subs.applyAction(id, 'activate', { id: user ? user.id : null });
        summary.activated++;
      } catch (e) { summary.errors.push({ subscription_id: id, error: e.message }); }
    }

    const due = db().all(
      "SELECT id FROM subscriptions WHERE status = 'active' AND paused_at IS NULL AND (next_invoice_date <= ? OR expiry_date <= ?)",
      asOf, asOf
    );
    for (const { id } of due) {
      try {
        const r = billSubscription(id, asOf, { autoConfirm });
        if (r.invoices.length) summary.subscriptions_billed++;
        summary.invoices_created += r.invoices.length;
        summary.invoice_ids.push(...r.invoices.map((i) => i.id));
        if (r.closed) summary.closed++;
        summary.rolled_over += r.rolled;
      } catch (e) { summary.errors.push({ subscription_id: id, error: e.message }); }
    }
    return summary;
  } finally {
    running = false;
  }
}

// How many subscriptions would be billed if the run happened now (shown before clicking "Run billing").
function previewBilling(asOf = today()) {
  const { due } = db().get(
    "SELECT COUNT(*) AS due FROM subscriptions WHERE status = 'active' AND paused_at IS NULL AND next_invoice_date <= ?", asOf);
  const { toActivate } = db().get("SELECT COUNT(*) AS toActivate FROM subscriptions WHERE status = 'confirmed' AND start_date <= ?", asOf);
  return { as_of: asOf, subscriptions_due: due, subscriptions_to_activate: toActivate };
}

module.exports = { runBilling, previewBilling, billSubscription, applyDiscounts };
