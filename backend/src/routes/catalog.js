// Products (with variants), plans, taxes, payment terms, quotation templates and discounts.
// Everyone on the team can read these; only the admin changes products, plans, taxes, terms and discounts.
const express = require('express');
const { getDb } = require('../db');
const { h, paging, meta, likeTerm } = require('../util/http');
const { validate } = require('../util/validate');
const { badRequest, notFound, conflict } = require('../util/errors');
const { requireRole } = require('../middleware/auth');

const db = () => getDb();
const admin = requireRole('admin');
const team = requireRole('admin', 'staff');
const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];
const PRODUCT_TYPES = ['software', 'addon', 'service', 'hardware', 'other'];

const activeFilter = (req, where, alias = '') => {
  if (req.query.active === 'true') where.push(`${alias}active = 1`);
  if (req.query.active === 'false') where.push(`${alias}active = 0`);
};

/* ----------------------------- Taxes ----------------------------- */
const taxes = express.Router();
const taxSchema = {
  name: { type: 'string', required: true, max: 80 },
  rate: { type: 'number', required: true, min: 0, max: 100, label: 'Rate (%)' },
  description: { type: 'string', max: 300 },
  active: { type: 'bool', default: true },
};
taxes.get('/', team, h((req, res) => res.json({ data: db().all('SELECT * FROM taxes ORDER BY name') })));
taxes.post('/', admin, h((req, res) => {
  const b = validate(req.body, taxSchema);
  const { id } = db().run('INSERT INTO taxes (name, rate, description, active) VALUES (?, ?, ?, ?)', b.name, b.rate, b.description, b.active ? 1 : 0);
  res.status(201).json(db().get('SELECT * FROM taxes WHERE id = ?', id));
}));
taxes.put('/:id', admin, h((req, res) => {
  if (!db().get('SELECT id FROM taxes WHERE id = ?', req.params.id)) throw notFound('Tax');
  const b = validate(req.body, taxSchema);
  db().run('UPDATE taxes SET name = ?, rate = ?, description = ?, active = ? WHERE id = ?', b.name, b.rate, b.description, b.active ? 1 : 0, req.params.id);
  res.json(db().get('SELECT * FROM taxes WHERE id = ?', req.params.id));
}));
taxes.delete('/:id', admin, h((req, res) => {
  const used = db().get('SELECT (SELECT COUNT(*) FROM products WHERE tax_id = ?) + (SELECT COUNT(*) FROM plans WHERE tax_id = ?) AS n', req.params.id, req.params.id).n;
  if (used) { db().run('UPDATE taxes SET active = 0 WHERE id = ?', req.params.id); return res.json({ ok: true, deactivated: true }); }
  db().run('DELETE FROM taxes WHERE id = ?', req.params.id);
  return res.json({ ok: true });
}));

/* -------------------------- Payment terms ------------------------- */
const terms = express.Router();
const termSchema = {
  name: { type: 'string', required: true, max: 80 },
  days: { type: 'int', required: true, min: 0, max: 365, label: 'Days until due' },
  active: { type: 'bool', default: true },
};
terms.get('/', team, h((req, res) => res.json({ data: db().all('SELECT * FROM payment_terms ORDER BY days, name') })));
terms.post('/', admin, h((req, res) => {
  const b = validate(req.body, termSchema);
  const { id } = db().run('INSERT INTO payment_terms (name, days, active) VALUES (?, ?, ?)', b.name, b.days, b.active ? 1 : 0);
  res.status(201).json(db().get('SELECT * FROM payment_terms WHERE id = ?', id));
}));
terms.put('/:id', admin, h((req, res) => {
  if (!db().get('SELECT id FROM payment_terms WHERE id = ?', req.params.id)) throw notFound('Payment term');
  const b = validate(req.body, termSchema);
  db().run('UPDATE payment_terms SET name = ?, days = ?, active = ? WHERE id = ?', b.name, b.days, b.active ? 1 : 0, req.params.id);
  res.json(db().get('SELECT * FROM payment_terms WHERE id = ?', req.params.id));
}));
terms.delete('/:id', admin, h((req, res) => {
  const used = db().get('SELECT COUNT(*) AS n FROM subscriptions WHERE payment_term_id = ?', req.params.id).n;
  if (used) { db().run('UPDATE payment_terms SET active = 0 WHERE id = ?', req.params.id); return res.json({ ok: true, deactivated: true }); }
  db().run('DELETE FROM payment_terms WHERE id = ?', req.params.id);
  return res.json({ ok: true });
}));

/* ----------------------------- Products ---------------------------- */
const products = express.Router();
const productSchema = {
  name: { type: 'string', required: true, max: 160 },
  type: { type: 'enum', required: true, values: PRODUCT_TYPES },
  sales_price: { type: 'number', required: true, min: 0 },
  cost_price: { type: 'number', required: true, min: 0 },
  notes: { type: 'string', max: 2000 },
  tax_id: { type: 'int' },
  active: { type: 'bool', default: true },
};
const withVariants = (p) => {
  if (p) p.variants = db().all('SELECT * FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY id', p.id);
  return p;
};

products.get('/', team, h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const where = []; const params = [];
  if (req.query.search) { where.push("(p.name LIKE ? ESCAPE '\\')"); params.push(likeTerm(req.query.search)); }
  if (req.query.type) { where.push('p.type = ?'); params.push(req.query.type); }
  activeFilter(req, where, 'p.');
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = db().get(`SELECT COUNT(*) AS total FROM products p ${W}`, ...params);
  const rows = db().all(
    `SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id ${W}
      ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  rows.forEach(withVariants);
  res.json({ data: rows, meta: meta(page, pageSize, total) });
}));

products.get('/:id', team, h((req, res) => {
  const p = db().get('SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?', req.params.id);
  if (!p) throw notFound('Product');
  res.json(withVariants(p));
}));

function readVariants(body) {
  const raw = Array.isArray(body.variants) ? body.variants : [];
  return raw.map((v, i) => {
    const c = validate(v, {
      id: { type: 'int' },
      attribute: { type: 'string', required: true, max: 60, label: `Variant ${i + 1} attribute (e.g. Brand)` },
      value: { type: 'string', required: true, max: 80, label: `Variant ${i + 1} value (e.g. Odoo)` },
      extra_price: { type: 'number', required: true, min: -1000000, label: `Variant ${i + 1} extra price` },
    });
    return c;
  });
}
function assertTax(taxId) {
  if (taxId && !db().get('SELECT id FROM taxes WHERE id = ?', taxId)) throw badRequest('Unknown tax', { tax_id: 'Choose a valid tax' });
}
// Keeps existing variant ids (they may already be used on subscriptions); removes or hides the ones no longer listed.
function saveVariants(productId, variants) {
  const keep = new Set();
  for (const v of variants) {
    if (v.id && db().get('SELECT id FROM product_variants WHERE id = ? AND product_id = ?', v.id, productId)) {
      db().run('UPDATE product_variants SET attribute = ?, value = ?, extra_price = ?, active = 1 WHERE id = ?', v.attribute, v.value, v.extra_price, v.id);
      keep.add(v.id);
    } else {
      keep.add(db().run('INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, ?, ?, ?)', productId, v.attribute, v.value, v.extra_price).id);
    }
  }
  for (const old of db().all('SELECT id FROM product_variants WHERE product_id = ? AND active = 1', productId)) {
    if (keep.has(old.id)) continue;
    const inUse = db().get(
      `SELECT (SELECT COUNT(*) FROM subscription_lines WHERE variant_id = ?) + (SELECT COUNT(*) FROM template_lines WHERE variant_id = ?) AS n`, old.id, old.id).n;
    if (inUse) db().run('UPDATE product_variants SET active = 0 WHERE id = ?', old.id);
    else db().run('DELETE FROM product_variants WHERE id = ?', old.id);
  }
}

products.post('/', admin, h((req, res) => {
  const b = validate(req.body, productSchema);
  assertTax(b.tax_id);
  const variants = readVariants(req.body);
  const id = db().transaction(() => {
    const { id: pid } = db().run(
      'INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      b.name, b.type, b.sales_price, b.cost_price, b.notes, b.tax_id, b.active ? 1 : 0);
    saveVariants(pid, variants);
    return pid;
  })();
  res.status(201).json(withVariants(db().get('SELECT * FROM products WHERE id = ?', id)));
}));

products.put('/:id', admin, h((req, res) => {
  if (!db().get('SELECT id FROM products WHERE id = ?', req.params.id)) throw notFound('Product');
  const b = validate(req.body, productSchema);
  assertTax(b.tax_id);
  const variants = readVariants(req.body);
  db().transaction(() => {
    db().run('UPDATE products SET name = ?, type = ?, sales_price = ?, cost_price = ?, notes = ?, tax_id = ?, active = ? WHERE id = ?',
      b.name, b.type, b.sales_price, b.cost_price, b.notes, b.tax_id, b.active ? 1 : 0, req.params.id);
    saveVariants(Number(req.params.id), variants);
  })();
  res.json(withVariants(db().get('SELECT * FROM products WHERE id = ?', req.params.id)));
}));

products.delete('/:id', admin, h((req, res) => {
  const id = req.params.id;
  const used = db().get(
    'SELECT (SELECT COUNT(*) FROM subscription_lines WHERE product_id = ?) + (SELECT COUNT(*) FROM template_lines WHERE product_id = ?) + (SELECT COUNT(*) FROM discount_products WHERE product_id = ?) AS n', id, id, id).n;
  if (used) { db().run('UPDATE products SET active = 0 WHERE id = ?', id); return res.json({ ok: true, deactivated: true }); }
  db().run('DELETE FROM products WHERE id = ?', id);
  return res.json({ ok: true });
}));

/* ------------------------------ Plans ------------------------------ */
const plans = express.Router();
const planSchema = {
  name: { type: 'string', required: true, max: 120 },
  price: { type: 'number', required: true, min: 0 },
  billing_period: { type: 'enum', required: true, values: PERIODS },
  min_quantity: { type: 'int', required: true, min: 1, label: 'Minimum quantity' },
  available_from: { type: 'date' },
  available_to: { type: 'date' },
  auto_close: { type: 'bool' },
  closable: { type: 'bool' },
  pausable: { type: 'bool' },
  renewable: { type: 'bool' },
  tax_id: { type: 'int' },
  description: { type: 'string', max: 1000 },
  active: { type: 'bool', default: true },
};
function readPlan(body) {
  const b = validate(body, planSchema);
  if (b.available_from && b.available_to && b.available_to < b.available_from) {
    throw badRequest('Check the availability dates', { available_to: 'Must be on or after the "available from" date' });
  }
  assertTax(b.tax_id);
  return b;
}
const planCols = (b) => [b.name, b.price, b.billing_period, b.min_quantity, b.available_from, b.available_to,
  b.auto_close ? 1 : 0, b.closable ? 1 : 0, b.pausable ? 1 : 0, b.renewable ? 1 : 0, b.tax_id, b.description, b.active ? 1 : 0];

plans.get('/', team, h((req, res) => {
  const where = []; activeFilter(req, where, 'p.');
  res.json({ data: db().all(
    `SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM plans p LEFT JOIN taxes t ON t.id = p.tax_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name`) });
}));
plans.post('/', admin, h((req, res) => {
  const b = readPlan(req.body);
  const { id } = db().run(
    `INSERT INTO plans (name, price, billing_period, min_quantity, available_from, available_to, auto_close, closable, pausable, renewable, tax_id, description, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...planCols(b));
  res.status(201).json(db().get('SELECT * FROM plans WHERE id = ?', id));
}));
plans.put('/:id', admin, h((req, res) => {
  if (!db().get('SELECT id FROM plans WHERE id = ?', req.params.id)) throw notFound('Plan');
  const b = readPlan(req.body);
  db().run(
    `UPDATE plans SET name = ?, price = ?, billing_period = ?, min_quantity = ?, available_from = ?, available_to = ?, auto_close = ?,
            closable = ?, pausable = ?, renewable = ?, tax_id = ?, description = ?, active = ? WHERE id = ?`, ...planCols(b), req.params.id);
  res.json(db().get('SELECT * FROM plans WHERE id = ?', req.params.id));
}));
plans.delete('/:id', admin, h((req, res) => {
  const used = db().get('SELECT (SELECT COUNT(*) FROM subscriptions WHERE plan_id = ?) + (SELECT COUNT(*) FROM quotation_templates WHERE plan_id = ?) AS n', req.params.id, req.params.id).n;
  if (used) { db().run('UPDATE plans SET active = 0 WHERE id = ?', req.params.id); return res.json({ ok: true, deactivated: true }); }
  db().run('DELETE FROM plans WHERE id = ?', req.params.id);
  return res.json({ ok: true });
}));

/* ------------------------ Quotation templates ---------------------- */
const templates = express.Router();
const templateSchema = {
  name: { type: 'string', required: true, max: 120 },
  plan_id: { type: 'int', required: true, label: 'Plan' },
  validity_days: { type: 'int', required: true, min: 1, max: 365, label: 'Valid for (days)' },
  notes: { type: 'string', max: 1000 },
  active: { type: 'bool', default: true },
};
const templateDetail = (id) => {
  const t = db().get('SELECT t.*, p.name AS plan_name FROM quotation_templates t JOIN plans p ON p.id = t.plan_id WHERE t.id = ?', id);
  if (!t) return t;
  t.lines = db().all(
    `SELECT l.*, p.name AS product_name, v.attribute, v.value FROM template_lines l JOIN products p ON p.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id WHERE l.template_id = ? ORDER BY l.id`, id);
  return t;
};
function readTemplate(body) {
  const b = validate(body, templateSchema);
  if (!db().get('SELECT id FROM plans WHERE id = ?', b.plan_id)) throw badRequest('Unknown plan', { plan_id: 'Choose a plan' });
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (!rawLines.length) throw badRequest('Add at least one product line', { lines: 'Add at least one product line' });
  b.lines = rawLines.map((l, i) => {
    const pid = Number(l.product_id);
    if (!db().get('SELECT id FROM products WHERE id = ?', pid)) throw badRequest(`Line ${i + 1}: choose a product`, { lines: `Line ${i + 1}: choose a product` });
    const vid = l.variant_id ? Number(l.variant_id) : null;
    if (vid && !db().get('SELECT id FROM product_variants WHERE id = ? AND product_id = ?', vid, pid)) {
      throw badRequest(`Line ${i + 1}: variant does not belong to the product`, { lines: `Line ${i + 1}: invalid variant` });
    }
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1) throw badRequest(`Line ${i + 1}: quantity must be 1 or more`, { lines: `Line ${i + 1}: quantity must be 1 or more` });
    return { product_id: pid, variant_id: vid, quantity: q };
  });
  return b;
}
function saveTemplateLines(id, lines) {
  db().run('DELETE FROM template_lines WHERE template_id = ?', id);
  for (const l of lines) db().run('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)', id, l.product_id, l.variant_id, l.quantity);
}
templates.get('/', team, h((req, res) => {
  const where = []; activeFilter(req, where, 't.');
  const rows = db().all(`SELECT t.id FROM quotation_templates t ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.name`);
  res.json({ data: rows.map((r) => templateDetail(r.id)) });
}));
templates.get('/:id', team, h((req, res) => {
  const t = templateDetail(req.params.id);
  if (!t) throw notFound('Template');
  res.json(t);
}));
templates.post('/', team, h((req, res) => {
  const b = readTemplate(req.body);
  const id = db().transaction(() => {
    const { id: tid } = db().run('INSERT INTO quotation_templates (name, plan_id, validity_days, notes, active) VALUES (?, ?, ?, ?, ?)', b.name, b.plan_id, b.validity_days, b.notes, b.active ? 1 : 0);
    saveTemplateLines(tid, b.lines);
    return tid;
  })();
  res.status(201).json(templateDetail(id));
}));
templates.put('/:id', team, h((req, res) => {
  if (!db().get('SELECT id FROM quotation_templates WHERE id = ?', req.params.id)) throw notFound('Template');
  const b = readTemplate(req.body);
  db().transaction(() => {
    db().run('UPDATE quotation_templates SET name = ?, plan_id = ?, validity_days = ?, notes = ?, active = ? WHERE id = ?', b.name, b.plan_id, b.validity_days, b.notes, b.active ? 1 : 0, req.params.id);
    saveTemplateLines(Number(req.params.id), b.lines);
  })();
  res.json(templateDetail(req.params.id));
}));
templates.delete('/:id', team, h((req, res) => {
  const used = db().get('SELECT COUNT(*) AS n FROM subscriptions WHERE template_id = ?', req.params.id).n;
  if (used) { db().run('UPDATE quotation_templates SET active = 0 WHERE id = ?', req.params.id); return res.json({ ok: true, deactivated: true }); }
  db().run('DELETE FROM quotation_templates WHERE id = ?', req.params.id);
  return res.json({ ok: true });
}));

/* ---------------------------- Discounts ---------------------------- */
// Only the admin can create discount rules. They then apply to invoices on their own.
const discounts = express.Router();
const discountSchema = {
  name: { type: 'string', required: true, max: 120 },
  type: { type: 'enum', required: true, values: ['fixed', 'percentage'] },
  value: { type: 'number', required: true, min: 0.01 },
  min_purchase: { type: 'number', min: 0, default: 0 },
  min_quantity: { type: 'int', min: 0, default: 0 },
  start_date: { type: 'date' },
  end_date: { type: 'date' },
  usage_limit: { type: 'int', min: 1, label: 'Usage limit' },
  applies_to: { type: 'enum', required: true, values: ['subscription', 'products'], label: 'Applies to' },
  customer_id: { type: 'int' },
  active: { type: 'bool', default: true },
};
const discountDetail = (id) => {
  const d = db().get('SELECT d.*, u.name AS customer_name FROM discounts d LEFT JOIN users u ON u.id = d.customer_id WHERE d.id = ?', id);
  if (!d) return d;
  d.products = db().all('SELECT p.id, p.name FROM discount_products dp JOIN products p ON p.id = dp.product_id WHERE dp.discount_id = ? ORDER BY p.name', id);
  d.product_ids = d.products.map((p) => p.id);
  const t = new Date().toISOString().slice(0, 10);
  d.state = !d.active ? 'inactive'
    : d.end_date && d.end_date < t ? 'expired'
      : d.usage_limit && d.times_used >= d.usage_limit ? 'used up'
        : d.start_date && d.start_date > t ? 'scheduled' : 'running';
  return d;
};
function readDiscount(body) {
  const b = validate(body, discountSchema);
  if (b.type === 'percentage' && b.value > 100) throw badRequest('A percentage cannot be more than 100', { value: 'Maximum is 100' });
  if (b.start_date && b.end_date && b.end_date < b.start_date) throw badRequest('Check the dates', { end_date: 'Must be on or after the start date' });
  if (b.customer_id && !db().get("SELECT id FROM users WHERE id = ? AND role = 'customer'", b.customer_id)) throw badRequest('Unknown customer', { customer_id: 'Choose a customer' });
  b.product_ids = [];
  if (b.applies_to === 'products') {
    b.product_ids = (Array.isArray(body.product_ids) ? body.product_ids : []).map(Number).filter(Boolean);
    if (!b.product_ids.length) throw badRequest('Choose at least one product', { product_ids: 'Choose at least one product' });
  }
  return b;
}
const discountCols = (b) => [b.name, b.type, b.value, b.min_purchase, b.min_quantity, b.start_date, b.end_date, b.usage_limit, b.applies_to, b.customer_id, b.active ? 1 : 0];
function saveDiscountProducts(id, ids) {
  db().run('DELETE FROM discount_products WHERE discount_id = ?', id);
  for (const pid of ids) db().run('INSERT OR IGNORE INTO discount_products (discount_id, product_id) VALUES (?, ?)', id, pid);
}
discounts.get('/', team, h((req, res) => {
  res.json({ data: db().all('SELECT id FROM discounts ORDER BY id DESC').map((r) => discountDetail(r.id)) });
}));
discounts.post('/', admin, h((req, res) => {
  const b = readDiscount(req.body);
  const id = db().transaction(() => {
    const { id: did } = db().run(
      `INSERT INTO discounts (name, type, value, min_purchase, min_quantity, start_date, end_date, usage_limit, applies_to, customer_id, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...discountCols(b));
    saveDiscountProducts(did, b.product_ids);
    return did;
  })();
  res.status(201).json(discountDetail(id));
}));
discounts.put('/:id', admin, h((req, res) => {
  if (!db().get('SELECT id FROM discounts WHERE id = ?', req.params.id)) throw notFound('Discount');
  const b = readDiscount(req.body);
  db().transaction(() => {
    db().run(
      `UPDATE discounts SET name = ?, type = ?, value = ?, min_purchase = ?, min_quantity = ?, start_date = ?, end_date = ?, usage_limit = ?,
              applies_to = ?, customer_id = ?, active = ? WHERE id = ?`, ...discountCols(b), req.params.id);
    saveDiscountProducts(Number(req.params.id), b.product_ids);
  })();
  res.json(discountDetail(req.params.id));
}));
discounts.delete('/:id', admin, h((req, res) => {
  const used = db().get('SELECT COUNT(*) AS n FROM invoice_discounts WHERE discount_id = ?', req.params.id).n;
  if (used) { db().run('UPDATE discounts SET active = 0 WHERE id = ?', req.params.id); return res.json({ ok: true, deactivated: true }); }
  db().run('DELETE FROM discounts WHERE id = ?', req.params.id);
  return res.json({ ok: true });
}));

/* ----------------------- Lookups for the forms ---------------------- */
const lookups = express.Router();
lookups.get('/', team, h((req, res) => {
  const products = db().all('SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE');
  products.forEach(withVariants);
  res.json({
    products,
    plans: db().all('SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM plans p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.active = 1 ORDER BY p.name'),
    taxes: db().all('SELECT * FROM taxes WHERE active = 1 ORDER BY name'),
    payment_terms: db().all('SELECT * FROM payment_terms WHERE active = 1 ORDER BY days, name'),
    templates: db().all('SELECT id FROM quotation_templates WHERE active = 1 ORDER BY name').map((r) => templateDetail(r.id)),
  });
}));

module.exports = { taxes, terms, products, plans, templates, discounts, lookups, PERIODS };
