// End-to-end tests of the business rules, run against a real (in-memory) database and real HTTP.
//   npm test
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/db');
const { createApp } = require('../src/app');
const { today, addDays, addMonths } = require('../src/util/dates');
const { addUser } = require('../src/seed/data');

let server; let base; const tokens = {};
const T = today();

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty */ }
  return { status: res.status, data };
}
const get = (p, t) => api('GET', p, { token: t });
const post = (p, body, t) => api('POST', p, { token: t, body });
const put = (p, body, t) => api('PUT', p, { token: t, body });

const ids = {};

test.before(async () => {
  init(':memory:');
  addUser({ name: 'Admin', email: 'admin@t.test', password: 'Admin@12345', role: 'admin' });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.admin = (await post('/auth/login', { email: 'admin@t.test', password: 'Admin@12345' })).data.token;

  // Catalogue set up by the admin
  const tax = (await post('/taxes', { name: 'Tax 10', rate: 10 }, tokens.admin)).data;
  const low = (await post('/taxes', { name: 'Tax 5', rate: 5 }, tokens.admin)).data;
  ids.tax = tax.id; ids.low = low.id;
  ids.term = (await post('/payment-terms', { name: 'Net 15', days: 15 }, tokens.admin)).data.id;
  const suite = (await post('/products', {
    name: 'Suite', type: 'software', sales_price: 400, cost_price: 100, tax_id: tax.id,
    variants: [{ attribute: 'Brand', value: 'Standard', extra_price: 0 }, { attribute: 'Brand', value: 'Odoo', extra_price: 560 }],
  }, tokens.admin)).data;
  ids.suite = suite.id; ids.suiteStd = suite.variants[0].id; ids.suiteOdoo = suite.variants[1].id;
  ids.seat = (await post('/products', { name: 'Seat', type: 'addon', sales_price: 25, cost_price: 8, tax_id: low.id }, tokens.admin)).data.id;
  ids.planMonthly = (await post('/plans', {
    name: 'Monthly', price: 100, billing_period: 'monthly', min_quantity: 1, closable: true, pausable: true, renewable: true, tax_id: tax.id,
  }, tokens.admin)).data.id;
  ids.planYearly = (await post('/plans', {
    name: 'Yearly', price: 0, billing_period: 'yearly', min_quantity: 1, auto_close: true, closable: false, pausable: false, renewable: true,
  }, tokens.admin)).data.id;
  ids.planMin = (await post('/plans', { name: 'Min5', price: 0, billing_period: 'monthly', min_quantity: 5, closable: true }, tokens.admin)).data.id;
});
test.after(() => server && server.close());

/* ---------------- Sign-up, passwords, roles ---------------- */
test('sign-up enforces the password rules and one account per email', async () => {
  const bad = ['short1!A', 'alllowercase!!', 'ALLUPPERCASE!!', 'NoSpecialChar1A'];
  for (const password of bad) {
    const r = await post('/auth/signup', { name: 'X', email: 'x@c.test', password });
    assert.equal(r.status, 400, `should reject ${password}`);
    assert.ok(r.data.fields.password);
  }
  // exactly 8 characters is NOT enough ("more than eight")
  assert.equal((await post('/auth/signup', { name: 'X', email: 'x@c.test', password: 'Abcdef!1' })).status, 400);
  const ok = await post('/auth/signup', { name: 'Cust One', email: 'one@c.test', password: 'Abcdefg!1' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.role, 'customer');
  const dup = await post('/auth/signup', { name: 'Again', email: 'ONE@c.test', password: 'Abcdefg!1' });
  assert.equal(dup.status, 409);
  tokens.cust1 = ok.data.token; ids.cust1 = ok.data.user.id;
  const two = await post('/auth/signup', { name: 'Cust Two', email: 'two@c.test', password: 'Abcdefg!1' });
  tokens.cust2 = two.data.token; ids.cust2 = two.data.user.id;
});

test('forgot password sends a reset link to the registered email and the link works once', async () => {
  const unknown = await post('/auth/forgot-password', { email: 'nobody@c.test' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.demo_reset_link, undefined);
  const r = await post('/auth/forgot-password', { email: 'one@c.test' });
  assert.equal(r.status, 200);
  assert.ok(r.data.demo_reset_link);
  const outbox = (await get('/outbox', tokens.admin)).data.data;
  assert.ok(outbox.some((m) => m.to_email === 'one@c.test' && /reset/i.test(m.subject)));
  const url = new URL(r.data.demo_reset_link);
  const token = url.searchParams.get('token');
  assert.equal((await post('/auth/reset-password', { token, email: 'one@c.test', password: 'weak' })).status, 400);
  assert.equal((await post('/auth/reset-password', { token, email: 'one@c.test', password: 'Brandnew!9x' })).status, 200);
  assert.equal((await post('/auth/reset-password', { token, email: 'one@c.test', password: 'Another!9xx' })).status, 400, 'link is single use');
  const login = await post('/auth/login', { email: 'one@c.test', password: 'Brandnew!9x' });
  assert.equal(login.status, 200);
  tokens.cust1 = login.data.token;
});

test('roles: only the admin adds staff; staff have limited access; customers see only the portal', async () => {
  assert.equal((await post('/staff', { name: 'S', email: 's@t.test', password: 'Staff@12345' }, tokens.cust1)).status, 403);
  const made = await post('/staff', { name: 'Sam Staff', email: 'sam@t.test', password: 'Staff@12345' }, tokens.admin);
  assert.equal(made.status, 201);
  assert.equal(made.data.role, 'staff');
  tokens.staff = (await post('/auth/login', { email: 'sam@t.test', password: 'Staff@12345' })).data.token;
  assert.equal((await post('/staff', { name: 'S2', email: 's2@t.test', password: 'Staff@12345' }, tokens.staff)).status, 403, 'staff cannot add staff');
  assert.equal((await post('/products', { name: 'P', type: 'addon', sales_price: 1, cost_price: 1 }, tokens.staff)).status, 403, 'staff cannot edit products');
  assert.equal((await post('/discounts', { name: 'D', type: 'fixed', value: 5, applies_to: 'subscription' }, tokens.staff)).status, 403, 'only admin creates discounts');
  assert.equal((await get('/products', tokens.staff)).status, 200, 'staff can read products');
  assert.equal((await get('/subscriptions', tokens.cust1)).status, 403, 'customers cannot use the team API');
  assert.equal((await get('/subscriptions')).status, 401);
});

/* ---------------- Products, plans ---------------- */
test('product variants add to the price (Odoo brand = +560)', async () => {
  const p = (await get(`/products/${ids.suite}`, tokens.admin)).data;
  const odoo = p.variants.find((v) => v.value === 'Odoo');
  assert.equal(p.sales_price + odoo.extra_price, 960);
});

test('plan validation: dates, minimum quantity', async () => {
  const bad = await post('/plans', { name: 'Bad', price: 1, billing_period: 'monthly', min_quantity: 1, available_from: '2026-05-01', available_to: '2026-04-01' }, tokens.admin);
  assert.equal(bad.status, 400);
  const bad2 = await post('/plans', { name: 'Bad', price: 1, billing_period: 'hourly', min_quantity: 1 }, tokens.admin);
  assert.equal(bad2.status, 400);
});

/* ---------------- Subscriptions ---------------- */
let subA; // monthly, with seats
test('quotation template -> subscription, with number, lines, taxes and status flow', async () => {
  const tpl = await post('/templates', {
    name: 'Tpl', plan_id: ids.planMonthly, validity_days: 10,
    lines: [{ product_id: ids.suite, variant_id: ids.suiteOdoo, quantity: 1 }, { product_id: ids.seat, quantity: 12 }],
  }, tokens.staff);
  assert.equal(tpl.status, 201);
  const created = await post('/subscriptions', {
    customer_id: ids.cust1, plan_id: ids.planMonthly, template_id: tpl.data.id, start_date: addMonths(T, -2), expiry_date: addMonths(T, 10), payment_term_id: ids.term,
  }, tokens.staff);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  subA = created.data;
  assert.match(subA.number, /^SUB-\d{6}$/);
  assert.equal(subA.status, 'draft');
  assert.equal(subA.lines.length, 2);
  assert.equal(subA.lines[0].unit_price, 960);
  assert.equal(subA.quote_validity_days, 10, 'template decides validity');
  // one cycle: plan 100 + 960 + 12*25 = 1360
  assert.equal(subA.totals.subtotal, 1360);
  assert.equal(subA.totals.tax_total, 10 + 96 + 15); // 10% on plan+suite, 5% on seats

  const flow = [['quote', 'quotation'], ['confirm', 'confirmed'], ['activate', 'active']];
  for (const [action, status] of flow) {
    const r = await post(`/subscriptions/${subA.id}/${action}`, {}, tokens.staff);
    assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.status, status);
  }
  assert.equal((await post(`/subscriptions/${subA.id}/quote`, {}, tokens.staff)).status, 409, 'cannot go backwards');
  const detail = (await get(`/subscriptions/${subA.id}`, tokens.staff)).data;
  assert.ok(detail.events.length >= 4, 'status history is recorded');
});

test('minimum quantity of the plan is enforced on lines', async () => {
  const r = await post('/subscriptions', {
    customer_id: ids.cust1, plan_id: ids.planMin, start_date: T, expiry_date: addMonths(T, 12),
    lines: [{ product_id: ids.seat, quantity: 2 }],
  }, tokens.staff);
  assert.equal(r.status, 400);
});

test('plan availability dates are enforced', async () => {
  const planId = (await post('/plans', { name: 'Limited', price: 5, billing_period: 'monthly', min_quantity: 1, available_from: addMonths(T, -6), available_to: addMonths(T, -3) }, tokens.admin)).data.id;
  const r = await post('/subscriptions', { customer_id: ids.cust1, plan_id: planId, start_date: T, expiry_date: addMonths(T, 12), lines: [] }, tokens.staff);
  assert.equal(r.status, 400);
});

/* ---------------- Billing ---------------- */
test('billing run: creates every due invoice once, never twice, never skips', async () => {
  const run1 = await post('/billing/run', {}, tokens.staff);
  assert.equal(run1.status, 200);
  // started 2 months ago, monthly: periods at -2, -1 and 0 months
  assert.equal(run1.data.invoices_created, 3);
  const run2 = await post('/billing/run', {}, tokens.staff);
  assert.equal(run2.data.invoices_created, 0, 'second run creates nothing');
  const list = (await get(`/invoices?subscription_id=${subA.id}&sort=invoice_date&dir=asc`, tokens.staff)).data;
  assert.equal(list.meta.total, 3);
  const starts = list.data.map((i) => i.period_start);
  assert.deepEqual(starts, [addMonths(T, -2), addMonths(T, -1), T].map((d) => d), 'no gaps');
  assert.equal(new Set(starts).size, 3, 'no duplicates');
  assert.ok(list.data.every((i) => i.status === 'draft'));
  ids.invoices = list.data.map((i) => i.id);
});

test('invoice has customer details, lines, automatic tax and a discount applied on its own', async () => {
  // Admin sets a discount rule AFTER the subscription exists: 10% off seats when buying 10+, max 2 uses
  const d = await post('/discounts', {
    name: 'Seats 10%', type: 'percentage', value: 10, min_quantity: 10, applies_to: 'products', product_ids: [ids.seat], usage_limit: 2,
  }, tokens.admin);
  assert.equal(d.status, 201);
  ids.discount = d.data.id;
  const inv = (await get(`/invoices/${ids.invoices[0]}`, tokens.staff)).data;
  assert.equal(inv.customer_name, 'Cust One');
  assert.equal(inv.customer_email, 'one@c.test');
  assert.equal(inv.lines.length, 3); // plan fee + suite + seats
  assert.equal(inv.discount_total, 0, 'invoices created before the rule exist unchanged');
  assert.equal(inv.due_date, addDays(inv.invoice_date, 15), 'payment terms set the due date');
});

test('discounts apply automatically to the next invoice, respect the usage limit and stop', async () => {
  // Make a new subscription so that new invoices are created while the rule is live
  const sub = (await post('/subscriptions', {
    customer_id: ids.cust2, plan_id: ids.planMonthly, start_date: addMonths(T, -3), expiry_date: addMonths(T, 9), payment_term_id: ids.term,
    lines: [{ product_id: ids.seat, quantity: 12 }, { product_id: ids.suite, variant_id: ids.suiteStd, quantity: 1 }],
  }, tokens.staff)).data;
  for (const a of ['quote', 'confirm', 'activate']) await post(`/subscriptions/${sub.id}/${a}`, {}, tokens.staff);
  const run = await post('/billing/run', {}, tokens.staff);
  assert.equal(run.data.invoices_created, 4); // -3, -2, -1, 0 months
  const invs = (await get(`/invoices?subscription_id=${sub.id}&sort=invoice_date&dir=asc`, tokens.staff)).data.data;
  const details = [];
  for (const i of invs) details.push((await get(`/invoices/${i.id}`, tokens.staff)).data);
  // limit is 2 uses: first two invoices get 10% of 300 = 30, the others none
  assert.deepEqual(details.map((d) => d.discount_total), [30, 30, 0, 0]);
  const first = details[0];
  const seatLine = first.lines.find((l) => l.description === 'Seat');
  assert.equal(seatLine.discount_amount, 30);
  assert.equal(seatLine.tax_amount, 13.5, 'tax is calculated on the discounted amount (270 x 5%)');
  assert.equal(first.discounts[0].name, 'Seats 10%');
  const rule = (await get('/discounts', tokens.admin)).data.data.find((x) => x.id === ids.discount);
  assert.equal(rule.times_used, 2);
  assert.equal(rule.state, 'used up');
  ids.subB = sub.id; ids.invoicesB = details.map((d) => d.id);
});

test('cancelling an invoice gives the discount use back', async () => {
  const before = (await get('/discounts', tokens.admin)).data.data.find((x) => x.id === ids.discount).times_used;
  const r = await post(`/invoices/${ids.invoicesB[0]}/cancel`, {}, tokens.staff);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'cancelled');
  const after = (await get('/discounts', tokens.admin)).data.data.find((x) => x.id === ids.discount).times_used;
  assert.equal(after, before - 1);
});

test('an expired discount is not applied', async () => {
  const d = await post('/discounts', { name: 'Old', type: 'fixed', value: 50, applies_to: 'subscription', start_date: addMonths(T, -12), end_date: addMonths(T, -10) }, tokens.admin);
  assert.equal(d.status, 201);
  assert.equal(d.data.state, 'expired');
});

/* ---------------- Invoices & payments ---------------- */
test('invoice moves Draft -> Confirmed -> Paid with partial payments tracked', async () => {
  const id = ids.invoices[0];
  const early = await post(`/invoices/${id}/payments`, { method: 'cash', amount: 10 }, tokens.staff);
  assert.equal(early.status, 409, 'cannot pay a draft');
  const conf = await post(`/invoices/${id}/confirm`, {}, tokens.staff);
  assert.equal(conf.data.status, 'confirmed');
  assert.equal((await post(`/invoices/${id}/confirm`, {}, tokens.staff)).status, 409);
  const total = conf.data.total;
  assert.equal(total, 1360 + 121 - 0, 'plan 100 + 960 + 300 + tax 121');

  const p1 = await post(`/invoices/${id}/payments`, { method: 'bank_transfer', amount: 500, paid_on: T, note: 'First part' }, tokens.staff);
  assert.equal(p1.status, 201);
  assert.equal(p1.data.invoice.status, 'confirmed');
  assert.equal(p1.data.invoice.balance, total - 500);
  assert.equal((await post(`/invoices/${id}/payments`, { method: 'card', amount: total, paid_on: T }, tokens.staff)).status, 400, 'cannot overpay');
  assert.equal((await post(`/invoices/${id}/payments`, { method: 'card', amount: 5, paid_on: addDays(T, 3) }, tokens.staff)).status, 400, 'no future dates');
  const p2 = await post(`/invoices/${id}/payments`, { method: 'card', amount: total - 500, paid_on: T }, tokens.staff);
  assert.equal(p2.data.invoice.status, 'paid');
  assert.equal((await post(`/invoices/${id}/cancel`, {}, tokens.staff)).status, 409, 'paid invoices cannot be cancelled');
  assert.equal(p2.data.invoice.payments.length, 2);
});

test('send marks the invoice as sent and emails the customer', async () => {
  const id = ids.invoices[1];
  const r = await post(`/invoices/${id}/send`, {}, tokens.staff);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'confirmed', 'sending a draft confirms it');
  assert.ok(r.data.sent_at);
  const outbox = (await get('/outbox?page_size=50', tokens.admin)).data.data;
  assert.ok(outbox.some((m) => m.to_email === 'one@c.test' && m.subject.includes(r.data.number)));
});

test('overdue invoices are found and reported', async () => {
  // invoice[1] is confirmed with a due date 15 days after "one month ago" -> overdue
  const overdue = (await get('/invoices?status=overdue', tokens.staff)).data;
  assert.ok(overdue.data.some((i) => i.id === ids.invoices[1]));
  assert.ok(overdue.data.every((i) => i.overdue && i.days_overdue > 0));
});

/* ---------------- Plan rules: pause, close, renew, auto close ---------------- */
test('the plan decides whether a subscription can be paused, closed early or renewed', async () => {
  // Yearly plan: not closable, not pausable, renewable, closes automatically
  const y = (await post('/subscriptions', {
    customer_id: ids.cust1, plan_id: ids.planYearly, start_date: addMonths(T, -13), expiry_date: addMonths(T, -1),
    lines: [{ product_id: ids.suite, quantity: 1 }],
  }, tokens.staff)).data;
  for (const a of ['quote', 'confirm', 'activate']) await post(`/subscriptions/${y.id}/${a}`, {}, tokens.staff);
  assert.equal((await post(`/subscriptions/${y.id}/close`, {}, tokens.staff)).status, 409, 'cannot close early');
  assert.equal((await post(`/subscriptions/${y.id}/pause`, {}, tokens.staff)).status, 409, 'cannot pause');
  const run = await post('/billing/run', {}, tokens.staff);
  assert.equal(run.data.closed >= 1, true, 'closes on its own when it ends');
  const after = (await get(`/subscriptions/${y.id}`, tokens.staff)).data;
  assert.equal(after.status, 'closed');
  assert.equal(after.close_reason, 'Expired');
  const invs = (await get(`/invoices?subscription_id=${y.id}`, tokens.staff)).data.data;
  assert.equal(invs.length, 1, 'only the one yearly period before expiry was billed');
});

test('pause stops billing, resume moves dates, renew extends the term, monthly plan can be closed early', async () => {
  const sub = (await post('/subscriptions', {
    customer_id: ids.cust2, plan_id: ids.planMonthly, start_date: T, expiry_date: addMonths(T, 6), lines: [{ product_id: ids.seat, quantity: 1 }],
  }, tokens.staff)).data;
  for (const a of ['quote', 'confirm', 'activate']) await post(`/subscriptions/${sub.id}/${a}`, {}, tokens.staff);
  await post('/billing/run', {}, tokens.staff);
  const paused = (await post(`/subscriptions/${sub.id}/pause`, {}, tokens.staff)).data;
  assert.equal(paused.is_paused, true);
  const run = await post('/billing/run', { as_of: addMonths(T, 3) }, tokens.staff);
  assert.equal((await get(`/invoices?subscription_id=${sub.id}`, tokens.staff)).data.meta.total, 1, 'nothing billed while paused');
  assert.ok(run.status === 200);
  const renewed = (await post(`/subscriptions/${sub.id}/renew`, {}, tokens.staff)).data;
  assert.equal(renewed.expiry_date, addDays(addMonths(T, 6), sub.term_days));
  const resumed = (await post(`/subscriptions/${sub.id}/resume`, {}, tokens.staff)).data;
  assert.equal(resumed.is_paused, false);
  const closed = (await post(`/subscriptions/${sub.id}/close`, {}, tokens.staff)).data;
  assert.equal(closed.status, 'closed');
});

/* ---------------- Portal ---------------- */
test('customers see only their own subscriptions and invoices, and can manage them', async () => {
  const mine = (await get('/portal/subscriptions', tokens.cust1)).data.data;
  assert.ok(mine.length >= 1);
  assert.ok(mine.every((s) => s.number));
  const other = (await get('/portal/subscriptions', tokens.cust2)).data.data;
  assert.equal(other.some((s) => s.id === subA.id), false);
  assert.equal((await get(`/portal/subscriptions/${subA.id}`, tokens.cust2)).status, 404, 'cannot open someone else\'s subscription');
  assert.equal((await post(`/portal/subscriptions/${subA.id}/close`, {}, tokens.cust2)).status, 404);
  const invs = (await get('/portal/invoices', tokens.cust1)).data.data;
  assert.ok(invs.length >= 1);
  assert.ok(invs.every((i) => ['confirmed', 'paid'].includes(i.status)), 'no drafts in the portal');
  assert.equal((await get(`/portal/invoices/${ids.invoicesB[1]}`, tokens.cust1)).status, 404, 'someone else\'s invoice');
  // customer pauses own subscription (monthly plan allows pausing)
  const p = await post(`/portal/subscriptions/${subA.id}/pause`, {}, tokens.cust1);
  assert.equal(p.status, 200);
  assert.equal(p.data.events, undefined, 'staff history is not shown to customers');
  assert.equal((await post(`/portal/subscriptions/${subA.id}/resume`, {}, tokens.cust1)).status, 200);
  const summary = (await get('/portal/summary', tokens.cust1)).data;
  assert.ok(summary.outstanding > 0);
});

/* ---------------- Reports ---------------- */
test('finance summary: active subscriptions, revenue, owed, overdue - with filters', async () => {
  const s = (await get('/reports/summary', tokens.admin)).data;
  assert.ok(s.subscriptions.active >= 2);
  assert.ok(s.recurring.mrr > 0);
  assert.equal(s.recurring.arr, Math.round(s.recurring.mrr * 12 * 100) / 100);
  assert.ok(s.payments.collected_total >= 1361 - 0.01, 'payments recorded above are counted');
  assert.ok(s.invoices.outstanding_total > 0);
  assert.ok(s.invoices.overdue_count >= 1);
  assert.equal(s.revenue_by_month.length, 12);
  const filtered = (await get(`/reports/summary?customer_id=${ids.cust2}`, tokens.admin)).data;
  assert.ok(filtered.invoices.invoiced_total < s.invoices.invoiced_total);
  assert.equal(filtered.payments.collected_total, 0);
  const ranged = (await get(`/reports/summary?from=${T}&to=${T}`, tokens.admin)).data;
  assert.ok(ranged.invoices.count <= s.invoices.count);
});

test('only an admin can remove a payment; removing it re-opens the invoice', async () => {
  const id = ids.invoices[0];
  const detail = (await get(`/invoices/${id}`, tokens.staff)).data;
  assert.equal(detail.status, 'paid');
  assert.equal((await api('DELETE', `/payments/${detail.payments[1].id}`, { token: tokens.staff })).status, 403);
  assert.equal((await api('DELETE', `/payments/${detail.payments[1].id}`, { token: tokens.admin })).status, 200);
  assert.equal((await get(`/invoices/${id}`, tokens.staff)).data.status, 'confirmed');
});

/* ---------------- Extra rules and edge cases ---------------- */
test('an unknown user and a wrong password both get a clean 401 (no server error)', async () => {
  assert.equal((await post('/auth/login', { email: 'ghost@c.test', password: 'Whatever!123' })).status, 401);
  assert.equal((await post('/auth/login', { email: 'one@c.test', password: 'Wrong!Pass123' })).status, 401);
  assert.equal((await post('/auth/login', { email: '', password: '' })).status, 400);
});

test('an expired quotation cannot be confirmed', async () => {
  const sub = (await post('/subscriptions', {
    customer_id: ids.cust2, plan_id: ids.planMonthly, start_date: addDays(T, 5), expiry_date: addMonths(T, 12), lines: [{ product_id: ids.seat, quantity: 1 }],
  }, tokens.staff)).data;
  await post(`/subscriptions/${sub.id}/quote`, {}, tokens.staff);
  require('../src/db').getDb().run('UPDATE subscriptions SET quote_valid_until = ? WHERE id = ?', addDays(T, -1), sub.id);
  const r = await post(`/subscriptions/${sub.id}/confirm`, {}, tokens.staff);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /expired/);
  assert.equal((await post(`/subscriptions/${sub.id}/to_draft`, {}, tokens.staff)).data.status, 'draft');
});

test('confirmed subscriptions are locked, drafts can be edited and deleted', async () => {
  const draft = (await post('/subscriptions', {
    customer_id: ids.cust2, plan_id: ids.planMonthly, start_date: addDays(T, 10), expiry_date: addMonths(T, 12), lines: [{ product_id: ids.seat, quantity: 1 }],
  }, tokens.staff)).data;
  const edited = await put(`/subscriptions/${draft.id}`, {
    customer_id: ids.cust2, plan_id: ids.planMonthly, start_date: addDays(T, 10), expiry_date: addMonths(T, 12), lines: [{ product_id: ids.seat, quantity: 7 }],
  }, tokens.staff);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.lines[0].quantity, 7);
  assert.equal(edited.data.totals.subtotal, 100 + 7 * 25);
  assert.equal((await api('DELETE', `/subscriptions/${draft.id}`, { token: tokens.staff })).status, 200);
  assert.equal((await get(`/subscriptions/${subA.id}`, tokens.staff)).data.status, 'active');
  const locked = await put(`/subscriptions/${subA.id}`, { notes: 'Only a note changes' }, tokens.staff);
  assert.equal(locked.status, 200);
  assert.equal(locked.data.notes, 'Only a note changes');
  assert.equal((await api('DELETE', `/subscriptions/${subA.id}`, { token: tokens.staff })).status, 409, 'only drafts can be deleted');
});

test('staff create a customer, who gets an email to set their own password', async () => {
  const r = await post('/customers', { name: 'Walk In', email: 'walkin@c.test', company: 'Walk In Ltd' }, tokens.staff);
  assert.equal(r.status, 201);
  assert.ok(r.data.demo_setup_link);
  assert.equal((await post('/customers', { name: 'Dup', email: 'walkin@c.test' }, tokens.staff)).status, 409);
  const list = (await get('/customers?search=Walk', tokens.staff)).data;
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].active_subscriptions, 0);
});

test('discount rules are validated (percentage max 100, dates, products required)', async () => {
  const base = { name: 'X', type: 'percentage', value: 10, applies_to: 'subscription' };
  assert.equal((await post('/discounts', { ...base, value: 150 }, tokens.admin)).status, 400);
  assert.equal((await post('/discounts', { ...base, start_date: '2026-05-01', end_date: '2026-04-01' }, tokens.admin)).status, 400);
  assert.equal((await post('/discounts', { ...base, applies_to: 'products', product_ids: [] }, tokens.admin)).status, 400);
  assert.equal((await post('/discounts', { ...base, type: 'fixed', value: 0 }, tokens.admin)).status, 400);
});

test('products: variants can be changed without breaking subscriptions that use them', async () => {
  const p = (await get(`/products/${ids.suite}`, tokens.admin)).data;
  // remove the Odoo variant, which subscription A still uses
  const kept = p.variants.filter((v) => v.value !== 'Odoo');
  const r = await put(`/products/${ids.suite}`, { ...p, tax_id: p.tax_id, variants: kept }, tokens.admin);
  assert.equal(r.status, 200);
  assert.equal(r.data.variants.some((v) => v.value === 'Odoo'), false, 'no longer offered');
  const still = (await get(`/subscriptions/${subA.id}`, tokens.staff)).data;
  assert.equal(still.lines[0].unit_price, 960, 'existing subscription keeps its price');
});

test('the invoice list can be filtered by status, text and date and is paginated', async () => {
  const page = (await get('/invoices?page_size=2&page=1', tokens.staff)).data;
  assert.equal(page.data.length, 2);
  assert.ok(page.meta.total > 2 && page.meta.total_pages > 1);
  const found = (await get('/invoices?search=Cust%20Two', tokens.staff)).data;
  assert.ok(found.data.length > 0 && found.data.every((i) => i.customer_name === 'Cust Two'));
  const none = (await get(`/invoices?from=${addDays(T, 100)}`, tokens.staff)).data;
  assert.equal(none.data.length, 0);
});
