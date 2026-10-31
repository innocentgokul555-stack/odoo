// Database schema. Uses "IF NOT EXISTS" so it is safe to run on every start.
module.exports = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
  company TEXT, phone TEXT, address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  reset_token_hash TEXT, reset_expires TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 0,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payment_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  sales_price REAL NOT NULL DEFAULT 0,
  cost_price REAL NOT NULL DEFAULT 0,
  notes TEXT,
  tax_id INTEGER REFERENCES taxes(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  extra_price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL CHECK (billing_period IN ('daily','weekly','monthly','yearly')),
  min_quantity INTEGER NOT NULL DEFAULT 1,
  available_from TEXT, available_to TEXT,
  auto_close INTEGER NOT NULL DEFAULT 0,
  closable INTEGER NOT NULL DEFAULT 1,
  pausable INTEGER NOT NULL DEFAULT 0,
  renewable INTEGER NOT NULL DEFAULT 1,
  tax_id INTEGER REFERENCES taxes(id),
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  validity_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS template_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fixed','percentage')),
  value REAL NOT NULL,
  min_purchase REAL NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  start_date TEXT, end_date TEXT,
  usage_limit INTEGER,
  times_used INTEGER NOT NULL DEFAULT 0,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('subscription','products')),
  customer_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS discount_products (
  discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  PRIMARY KEY (discount_id, product_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  template_id INTEGER REFERENCES quotation_templates(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','quotation','confirmed','active','closed')),
  start_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  term_days INTEGER NOT NULL,
  billing_period TEXT NOT NULL,
  plan_price REAL NOT NULL DEFAULT 0,
  plan_tax_id INTEGER, plan_tax_name TEXT, plan_tax_rate REAL NOT NULL DEFAULT 0,
  payment_term_id INTEGER REFERENCES payment_terms(id),
  quote_validity_days INTEGER NOT NULL DEFAULT 30,
  quote_valid_until TEXT,
  billing_anchor TEXT,
  periods_billed INTEGER NOT NULL DEFAULT 0,
  next_invoice_date TEXT,
  paused_at TEXT,
  closed_at TEXT, close_reason TEXT,
  recurring_total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subs_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subs_due ON subscriptions(status, next_invoice_date);
CREATE INDEX IF NOT EXISTS idx_subs_expiry ON subscriptions(status, expiry_date);

CREATE TABLE IF NOT EXISTS subscription_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  tax_id INTEGER, tax_name TEXT, tax_rate REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sublines_sub ON subscription_lines(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  from_status TEXT, to_status TEXT,
  user_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_sub ON subscription_events(subscription_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT, customer_email TEXT, customer_company TEXT, customer_address TEXT,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  invoice_date TEXT NOT NULL, due_date TEXT NOT NULL,
  payment_term_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','paid','cancelled')),
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes TEXT,
  sent_at TEXT, confirmed_at TEXT, paid_at TEXT, cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- The guard that makes "nothing billed twice": one live invoice per subscription per period.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_period ON invoices(subscription_id, period_start) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_inv_status_due ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_inv_sub ON invoices(subscription_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  amount REAL NOT NULL,
  discount_amount REAL NOT NULL DEFAULT 0,
  tax_id INTEGER, tax_name TEXT, tax_rate REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invlines_inv ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  discount_id INTEGER NOT NULL REFERENCES discounts(id),
  name TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invdisc_inv ON invoice_discounts(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(paid_on);
CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer_id);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
