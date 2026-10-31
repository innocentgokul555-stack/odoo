// Shared helpers for the seed scripts: creates the reference data (taxes, products, plans, ...).
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { addMonths } = require('../util/dates');

const db = () => getDb();

function addUser({ name, email, password, role, company, phone, address, hash }) {
  const ph = hash || bcrypt.hashSync(password, 10);
  return db().run(
    'INSERT INTO users (name, email, password_hash, role, company, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name, email, ph, role, company || null, phone || null, address || null).id;
}

function seedReference(today) {
  const ids = {};

  ids.admin = addUser({ name: 'Alice Admin', email: 'admin@brightloop.test', password: 'Admin@12345', role: 'admin', phone: '+1 555 0100' });
  ids.staff = addUser({ name: 'Sam Sales', email: 'staff@brightloop.test', password: 'Staff@12345', role: 'staff', phone: '+1 555 0101' });
  ids.finance = addUser({ name: 'Fiona Finance', email: 'finance@brightloop.test', password: 'Staff@12345', role: 'staff', phone: '+1 555 0102' });

  const tax = (name, rate, description) => db().run('INSERT INTO taxes (name, rate, description) VALUES (?, ?, ?)', name, rate, description).id;
  ids.taxStd = tax('Standard Tax 10%', 10, 'Applied to software and services');
  ids.taxLow = tax('Reduced Tax 5%', 5, 'Applied to add-ons');
  ids.taxZero = tax('Zero Rated 0%', 0, 'No tax');

  const term = (name, days) => db().run('INSERT INTO payment_terms (name, days) VALUES (?, ?)', name, days).id;
  ids.termNow = term('Immediate payment', 0);
  ids.term15 = term('Net 15 days', 15);
  ids.term30 = term('Net 30 days', 30);
  ids.term60 = term('Net 60 days', 60);

  const product = (name, type, sales, cost, notes, taxId, variants = []) => {
    const id = db().run('INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES (?, ?, ?, ?, ?, ?)', name, type, sales, cost, notes, taxId).id;
    const vids = variants.map(([attribute, value, extra]) =>
      db().run('INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, ?, ?, ?)', id, attribute, value, extra).id);
    return { id, vids };
  };
  ids.suite = product('Business Suite', 'software', 400, 150, 'All-in-one business software. Pick the brand you want.', ids.taxStd,
    [['Brand', 'Standard', 0], ['Brand', 'Odoo', 560], ['Brand', 'Zoho', 320]]);
  ids.seat = product('Extra User Seat', 'addon', 25, 8, 'One additional user licence.', ids.taxLow);
  ids.support = product('Premium Support', 'service', 120, 60, '24/7 priority support with a named engineer.', ids.taxStd);
  ids.inventory = product('Inventory Module', 'addon', 90, 30, 'Stock control and warehouse tools.', ids.taxLow,
    [['Edition', 'Basic', 0], ['Edition', 'Pro', 60]]);
  ids.analytics = product('Analytics Add-on', 'addon', 45, 12, 'Dashboards and scheduled reports.', ids.taxLow);
  ids.onboarding = product('Onboarding Package', 'service', 300, 140, 'Guided set-up and training.', ids.taxStd);

  const plan = (name, price, period, minQty, flags, taxId, description, from, to) => db().run(
    `INSERT INTO plans (name, price, billing_period, min_quantity, available_from, available_to, auto_close, closable, pausable, renewable, tax_id, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    name, price, period, minQty, from || null, to || null, flags.auto_close ? 1 : 0, flags.closable ? 1 : 0, flags.pausable ? 1 : 0, flags.renewable ? 1 : 0, taxId, description).id;
  ids.planStarter = plan('Starter Monthly', 29, 'monthly', 1, { closable: 1, pausable: 1, renewable: 1 }, ids.taxStd, 'For small shops. Pause or cancel any time.');
  ids.planBusiness = plan('Business Monthly', 99, 'monthly', 1, { closable: 1, pausable: 0, renewable: 1 }, ids.taxStd, 'For growing teams. Can be closed early, not paused.');
  ids.planYearly = plan('Business Yearly', 990, 'yearly', 1, { auto_close: 1, closable: 0, pausable: 0, renewable: 1 }, ids.taxStd, 'Annual contract. Ends by itself - renew to keep going.');
  ids.planWeekly = plan('Weekly Trial', 9, 'weekly', 1, { auto_close: 1, closable: 1, pausable: 1, renewable: 0 }, ids.taxStd, 'Short weekly trial that closes on its own.');
  ids.planDaily = plan('Daily Pass', 2, 'daily', 1, { auto_close: 1, closable: 1, pausable: 0, renewable: 0 }, ids.taxZero, 'Pay-per-day access for events.');
  ids.planSeasonal = plan('Spring Promo Monthly', 19, 'monthly', 1, { closable: 1, pausable: 1, renewable: 1 }, ids.taxStd, 'Promotional plan, only available for a limited time.',
    addMonths(today, -9), addMonths(today, -6));

  const template = (name, planId, validity, notes, lines) => {
    const id = db().run('INSERT INTO quotation_templates (name, plan_id, validity_days, notes) VALUES (?, ?, ?, ?)', name, planId, validity, notes).id;
    for (const [pid, vid, qty] of lines) db().run('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)', id, pid, vid, qty);
    return id;
  };
  ids.tplSmall = template('Small Shop Starter', ids.planStarter, 15, 'Quick offer for small shops.',
    [[ids.suite.id, ids.suite.vids[0], 1], [ids.seat.id, null, 2]]);
  ids.tplEnterprise = template('Enterprise Yearly Offer', ids.planYearly, 30, 'Large customers on a yearly contract.',
    [[ids.suite.id, ids.suite.vids[1], 1], [ids.support.id, null, 1], [ids.seat.id, null, 20]]);

  const discount = (d) => {
    const id = db().run(
      `INSERT INTO discounts (name, type, value, min_purchase, min_quantity, start_date, end_date, usage_limit, applies_to, customer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.name, d.type, d.value, d.min_purchase || 0, d.min_quantity || 0, d.start_date || null, d.end_date || null, d.usage_limit || null, d.applies_to, d.customer_id || null).id;
    for (const pid of d.products || []) db().run('INSERT INTO discount_products (discount_id, product_id) VALUES (?, ?)', id, pid);
    return id;
  };
  ids.discVolume = discount({ name: 'Volume seats: 10% off seats when buying 10 or more', type: 'percentage', value: 10, min_quantity: 10, applies_to: 'products', products: [ids.seat.id] });
  ids.discLoyalty = discount({ name: 'Annual loyalty: 100 off big invoices (first 5 uses)', type: 'fixed', value: 100, min_purchase: 1500, applies_to: 'subscription', usage_limit: 5, end_date: addMonths(today, 6) });
  ids.discSpring = discount({ name: 'Spring promotion: 5% off', type: 'percentage', value: 5, min_purchase: 400, applies_to: 'subscription', start_date: addMonths(today, -9), end_date: addMonths(today, -6) });
  return ids;
}

module.exports = { addUser, seedReference };
