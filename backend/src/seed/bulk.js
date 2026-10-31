/*
 * Load-test data: thousands of customers, subscriptions, invoices and payments.
 *   npm run seed:bulk                       (5000 subscriptions)
 *   npm run seed:bulk -- --subs=20000
 * Safe to run on top of the demo data (it only adds). Use it to check that pages stay fast.
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { today, addDays, addMonths } = require('../util/dates');
const subs = require('../services/subscriptions');
const billing = require('../services/billing');
const { seedReference } = require('./data');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const SUBS = arg('subs', 5000);
const CUSTOMERS = arg('customers', Math.max(100, Math.round(SUBS / 3)));

const db = getDb();
const T = today();
let state = 987654321;
const rnd = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const t0 = Date.now();
const lap = (msg) => console.log(`  ${msg} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

if (db.get('SELECT COUNT(*) AS n FROM users').n === 0) {
  db.transaction(() => seedReference(T))();
  console.log('Empty database: created the catalogue and the admin/staff accounts first.');
}
const admin = db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
const plans = db.all("SELECT * FROM plans WHERE active = 1 AND billing_period IN ('monthly','yearly','weekly') AND available_from IS NULL");
const products = db.all('SELECT id FROM products WHERE active = 1');
const terms = db.all('SELECT id FROM payment_terms');
console.log(`Adding ${CUSTOMERS} customers and ${SUBS} subscriptions...`);

// 1) customers (one shared password hash so this stays fast)
const hash = bcrypt.hashSync('Customer@123', 8);
const first = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Casey', 'Jamie', 'Avery', 'Quinn', 'Drew', 'Blake'];
const last = ['Smith', 'Jones', 'Brown', 'Taylor', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Hall', 'Green'];
const biz = ['Trading', 'Studio', 'Foods', 'Labs', 'Retail', 'Logistics', 'Clinic', 'Works', 'Partners', 'Group'];
const baseCount = db.get('SELECT COUNT(*) AS n FROM users').n;
const customerIds = [];
db.transaction(() => {
  for (let i = 0; i < CUSTOMERS; i++) {
    const name = `${pick(first)} ${pick(last)}`;
    const n = baseCount + i;
    customerIds.push(db.run(
      'INSERT INTO users (name, email, password_hash, role, company, phone) VALUES (?, ?, ?, ?, ?, ?)',
      name, `bulk${n}@customers.test`, hash, 'customer', `${pick(last)} ${pick(biz)} ${n}`, `+1 555 ${String(1000 + (n % 9000))}`).id);
  }
})();
lap(`${CUSTOMERS} customers`);

// 2) subscriptions in all states
let counts = { active: 0, draft: 0, quotation: 0, confirmed: 0, closed: 0 };
db.transaction(() => {
  for (let i = 0; i < SUBS; i++) {
    const plan = rnd() < 0.05 ? plans.find((p) => p.billing_period === 'weekly') || pick(plans) : pick(plans.filter((p) => p.billing_period !== 'weekly'));
    const r = rnd();
    const future = r > 0.88 && r <= 0.96;
    const start = future ? addDays(T, 3 + Math.floor(rnd() * 40)) : addDays(T, -Math.floor(rnd() * 360));
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ product_id: pick(products).id, quantity: Math.max(1, plan.min_quantity) + Math.floor(rnd() * 8) }));
    const header = {
      customer_id: pick(customerIds), plan_id: plan.id, start_date: start, expiry_date: addMonths(start, 12),
      payment_term_id: pick(terms).id, quote_validity_days: 30,
    };
    const id = subs.create(header, plan, subs.normalizeLines(lines, plan), admin.id);
    let status = 'active';
    if (r > 0.96) status = 'draft';
    else if (r > 0.93 && future) status = 'quotation';
    else if (future) status = 'confirmed';
    else if (r > 0.82) status = 'closed';
    if (['active', 'closed'].includes(status)) {
      db.run("UPDATE subscriptions SET status = 'active', billing_anchor = start_date, next_invoice_date = start_date WHERE id = ?", id);
    } else if (status !== 'draft') {
      db.run('UPDATE subscriptions SET status = ? WHERE id = ?', status, id);
    }
    db.run('INSERT INTO subscription_events (subscription_id, event, to_status, user_id) VALUES (?, ?, ?, ?)', id, 'Bulk loaded', status, admin.id);
    counts[status] = (counts[status] || 0) + 1;
    if (status === 'closed') db.run("UPDATE subscriptions SET status = 'closed', closed_at = ?, close_reason = 'Closed early' WHERE id = ?", addDays(T, -Math.floor(rnd() * 100)), id);
  }
})();
lap(`${SUBS} subscriptions ${JSON.stringify(counts)}`);

// 3) one billing run bills every due period for every active subscription
const run = billing.runBilling({ asOf: T, autoConfirm: true });
lap(`billing run: ${run.invoices_created} invoices for ${run.subscriptions_billed} subscriptions (${run.errors.length} errors)`);

// 4) payments for most invoices older than 30 days (direct SQL for speed)
const methods = ['bank_transfer', 'card', 'online', 'cheque', 'cash'];
const due = db.all("SELECT id, customer_id, total, due_date, invoice_date FROM invoices WHERE status = 'confirmed' AND invoice_date < ?", addDays(T, -30));
let payments = 0;
db.transaction(() => {
  for (const inv of due) {
    if (rnd() < 0.2) continue;                     // 20% stay unpaid -> overdue
    const paidOn = addDays(inv.due_date, Math.floor(rnd() * 15) - 3);
    const when = paidOn > T ? T : paidOn < inv.invoice_date ? inv.invoice_date : paidOn;
    const full = rnd() < 0.9;
    const amount = full ? inv.total : Math.round(inv.total * 50) / 100;
    db.run('INSERT INTO payments (invoice_id, customer_id, method, amount, paid_on, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      inv.id, inv.customer_id, pick(methods), amount, when, 'Bulk loaded', admin.id);
    db.run(full ? "UPDATE invoices SET amount_paid = ?, status = 'paid', paid_at = ? WHERE id = ?" : 'UPDATE invoices SET amount_paid = ?, paid_at = NULL WHERE id = ?',
      ...(full ? [amount, when, inv.id] : [amount, inv.id]));
    payments++;
  }
})();
lap(`${payments} payments`);
db.exec('ANALYZE');

const n = (sql) => db.get(sql).n;
console.log('');
console.log(`Totals now: ${n("SELECT COUNT(*) n FROM users WHERE role='customer'")} customers, ${n('SELECT COUNT(*) n FROM subscriptions')} subscriptions, ` +
  `${n('SELECT COUNT(*) n FROM invoices')} invoices, ${n('SELECT COUNT(*) n FROM payments')} payments`);
