/*
 * Demo data for Brightloop Software.
 *   npm run seed            -> fills an EMPTY database with sample data
 *   npm run seed -- --reset -> deletes the database first, then fills it again
 */
const fs = require('fs');
const config = require('../config');

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(config.dbPath + suffix); } catch (e) { /* not there - fine */ }
  }
}

const { seedDemo } = require('./demo');

seedDemo().then((r) => {
  if (!r.seeded) {
    console.log('The database already has data, so nothing was changed.');
    console.log('To start fresh with the demo data run:  npm run seed -- --reset');
    return;
  }
  console.log('');
  console.log('Demo data is ready:');
  console.log(`  ${r.customers} customers, ${r.subscriptions} subscriptions, ${r.invoices} invoices, ${r.payments} payments`);
  console.log('');
  console.log('  Sign in with:');
  console.log('    Admin     admin@brightloop.test      Admin@12345');
  console.log('    Staff     staff@brightloop.test      Staff@12345');
  console.log('    Customer  customer@brightloop.test   Customer@123');
  console.log('');
}).catch((e) => { console.error(e); process.exit(1); });
