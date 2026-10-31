const config = require('./config');
const { getDb } = require('./db');
const { createApp } = require('./app');
const { runBilling } = require('./services/billing');
const { today } = require('./util/dates');

if (config.isProd && config.jwtSecret.startsWith('dev-only')) {
  console.error('\n  Refusing to start in production with the built-in JWT secret.');
  console.error('  Set a long random JWT_SECRET environment variable and start again.\n');
  process.exit(1);
}

async function main() {
  const db = getDb();

  // A brand-new hosted copy can fill itself with the demo data (set SEED_DEMO=true). Existing data is never touched.
  if (process.env.SEED_DEMO === 'true') {
    const { seedDemo } = require('./seed/demo');
    const r = await seedDemo({ log: () => {} });
    if (r.seeded) console.log(`  Demo data loaded: ${r.customers} customers, ${r.subscriptions} subscriptions, ${r.invoices} invoices.`);
  }

  createApp().listen(config.port, () => {
    console.log('');
    console.log(`  Odoo subscription API running on http://localhost:${config.port}  (database: ${db.driver})`);
    if (config.jwtSecret.startsWith('dev-only')) console.log('  Note: using the built-in development JWT secret. Set JWT_SECRET for real use.');
    console.log('');
  });

  // Billing day takes care of itself: check for due subscriptions on start and then every hour.
  // Every invoice period is created only once, so running this repeatedly is always safe.
  if (config.billingAutorun) {
    const tick = () => {
      try {
        const r = runBilling({ asOf: today(), autoConfirm: config.billingAutoConfirm });
        if (r.invoices_created || r.activated || r.closed) {
          console.log(`[billing] ${r.invoices_created} invoice(s) created, ${r.activated} activated, ${r.closed} closed`);
        }
      } catch (e) {
        console.error('[billing] run failed:', e.message);
      }
    };
    setTimeout(tick, 3000);
    setInterval(tick, 60 * 60 * 1000).unref();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
