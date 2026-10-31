/*
 * The demo data for Brightloop Software, as a function. Used by "npm run seed" and,
 * on a brand-new hosted copy, by the server itself when SEED_DEMO=true.
 */
const { getDb } = require('../db');
const { today, addDays, addMonths, diffDays } = require('../util/dates');
const subs = require('../services/subscriptions');
const billing = require('../services/billing');
const invoices = require('../services/invoices');
const { addUser, seedReference } = require('./data');

async function seedDemo({ log = console.log } = {}) {
  const db = getDb();
  if (db.get('SELECT COUNT(*) AS n FROM users').n > 0) return { seeded: false };
  const T = today();
  const system = { id: null };
  let seedState = 12345;
  const rnd = () => {
    seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
    return seedState / 0x7fffffff;
  };

  db.transaction(() => {
    const ref = seedReference(T);

    // Customers (the first one is the demo customer login) ---------------
    const customerData = [
      ['Carla Mendes', 'customer@brightloop.test', 'Acme Retail', '+1 555 0201', '12 Market Street, Springfield'],
      ['Ben Archer', 'ben@bluebird.test', 'Bluebird Cafe', '+1 555 0202', '4 Harbor Road, Riverton'],
      ['Chloe Park', 'chloe@cobalt.test', 'Cobalt Logistics', '+1 555 0203', '88 Freight Lane, Portsmouth'],
      ['Dev Patel', 'dev@deltadental.test', 'Delta Dental Clinic', '+1 555 0204', '9 Smile Avenue, Lakeview'],
      ['Eva Lindqvist', 'eva@evergreenbooks.test', 'Evergreen Books', '+1 555 0205', '31 Chapter Close, Oakdale'],
      ['Farid Haddad', 'farid@falconfitness.test', 'Falcon Fitness', '+1 555 0206', '5 Gym Street, Fairview'],
      ['Grace Okafor', 'grace@greenleaf.test', 'Greenleaf Organics', '+1 555 0207', '70 Farm Road, Meadowbrook'],
      ['Hiro Tanaka', 'hiro@horizontravels.test', 'Horizon Travels', '+1 555 0208', '2 Airport Way, Skyline'],
      ['Isla Murray', 'isla@ivylaw.test', 'Ivy Law Associates', '+1 555 0209', '16 Court Street, Bridgeton'],
      ['Jonas Weber', 'jonas@juniperstudio.test', 'Juniper Studio', '+1 555 0210', '23 Canvas Court, Artville'],
    ];
    const c = customerData.map(([name, email, company, phone, address]) =>
      addUser({ name, email, password: 'Customer@123', role: 'customer', company, phone, address })
    );

    // Subscriptions -------------------------------------------------------
    const make = ({ customer, plan, template, start, months, lines, term, quote }) => {
      const planRow = subs.getPlan(plan);
      const expiry = months ? addMonths(start, months) : addMonths(start, planRow.billing_period === 'yearly' ? 12 : 12);
      const header = {
        customer_id: customer,
        plan_id: plan,
        template_id: template || null,
        start_date: start,
        expiry_date: quote ? addMonths(start, 12) : expiry,
        payment_term_id: term,
        quote_validity_days: quote || 30,
      };
      return subs.create(header, planRow, subs.normalizeLines(lines, planRow), ref.admin);
    };
    const L = (pid, vid, qty) => ({ product_id: pid, variant_id: vid, quantity: qty });
    const suite = ref.suite;

    const A = make({
      customer: c[0],
      plan: ref.planBusiness,
      start: addMonths(T, -5),
      months: 12,
      term: ref.term15,
      lines: [L(suite.id, suite.vids[1], 1), L(ref.seat.id, null, 12), L(ref.analytics.id, null, 1)],
    });
    const B = make({
      customer: c[1],
      plan: ref.planStarter,
      template: ref.tplSmall,
      start: addMonths(T, -3),
      months: 12,
      term: ref.term30,
      lines: [L(suite.id, suite.vids[0], 1), L(ref.seat.id, null, 2)],
    });
    const C = make({
      customer: c[2],
      plan: ref.planYearly,
      template: ref.tplEnterprise,
      start: addMonths(T, -10),
      months: 12,
      term: ref.term30,
      lines: [L(suite.id, suite.vids[1], 1), L(ref.support.id, null, 1), L(ref.seat.id, null, 25)],
    });
    const D = make({
      customer: c[3],
      plan: ref.planYearly,
      start: addDays(addMonths(T, -12), 21),
      months: 12,
      term: ref.term30,
      lines: [L(suite.id, suite.vids[2], 1), L(ref.inventory.id, ref.inventory.vids[1], 2)],
    });
    const E = make({
      customer: c[4],
      plan: ref.planStarter,
      start: addMonths(T, -4),
      months: 12,
      term: ref.term15,
      lines: [L(suite.id, suite.vids[0], 1)],
    });
    const F = make({
      customer: c[5],
      plan: ref.planWeekly,
      start: addDays(T, -37),
      months: 3,
      term: ref.termNow,
      lines: [L(ref.seat.id, null, 3)],
    });
    const G = make({
      customer: c[6],
      plan: ref.planBusiness,
      start: addDays(T, 6),
      months: 12,
      term: ref.term30,
      lines: [L(suite.id, suite.vids[2], 1), L(ref.seat.id, null, 5)],
    });
    const H = make({
      customer: c[7],
      plan: ref.planYearly,
      template: ref.tplEnterprise,
      start: addDays(T, 14),
      term: ref.term60,
      quote: 30,
      lines: [L(suite.id, suite.vids[1], 1), L(ref.support.id, null, 1), L(ref.seat.id, null, 20)],
    });
    make({
      customer: c[8],
      plan: ref.planStarter,
      start: addDays(T, 20),
      months: 12,
      term: ref.term15,
      lines: [L(suite.id, suite.vids[0], 1), L(ref.onboarding.id, null, 1)],
    }); // stays Draft
    const J = make({
      customer: c[9],
      plan: ref.planSeasonal,
      start: addMonths(T, -8),
      months: 12,
      term: ref.term15,
      lines: [L(ref.analytics.id, null, 2)],
    });
    const K = make({
      customer: c[1],
      plan: ref.planDaily,
      start: addDays(T, -12),
      months: 1,
      term: ref.termNow,
      lines: [L(ref.analytics.id, null, 1)],
    });
    const M = make({
      customer: c[0],
      plan: ref.planStarter,
      start: addMonths(T, -2),
      months: 12,
      term: ref.term15,
      lines: [L(ref.onboarding.id, null, 1)],
    });

    const step = (id, ...actions) => actions.forEach((a) => subs.applyAction(id, a, { id: ref.staff }));
    [A, B, C, D, E, F, J, K, M].forEach((id) => step(id, 'quote', 'confirm', 'activate'));
    step(G, 'quote', 'confirm'); // confirmed, starts soon
    step(H, 'quote'); // quotation sent

    // Billing day, run twice: once "two months ago" so one customer can leave, then today.
    billing.runBilling({ asOf: addMonths(T, -2), autoConfirm: false, user: system });
    subs.applyAction(J, 'close', { id: ref.staff }, { reason: 'Customer left' });
    db.run('UPDATE subscriptions SET closed_at = ? WHERE id = ?', addMonths(T, -2), J);
    const run = billing.runBilling({ asOf: T, autoConfirm: false, user: system });

    // Confirm older invoices, record payments for most, leave some unpaid or part-paid -> overdue.
    const methods = ['bank_transfer', 'card', 'online', 'cheque', 'cash'];
    const all = db.all('SELECT id, invoice_date, due_date, total, customer_id FROM invoices ORDER BY id');
    let confirmed = 0,
      paid = 0,
      partial = 0;
    for (const inv of all) {
      const age = diffDays(inv.invoice_date, T);
      if (age <= 20) continue; // the newest invoices stay Draft
      invoices.confirm(inv.id);
      confirmed++;
      const detail = invoices.getDetail(inv.id);
      if (detail.status === 'paid') {
        paid++;
        continue;
      }
      const payOn = (offset) => {
        const d = addDays(inv.due_date, offset);
        return d < inv.invoice_date ? inv.invoice_date : d > T ? T : d;
      };
      const method = methods[Math.floor(rnd() * methods.length)];
      if (age > 45 && inv.id % 7 === 0) continue; // never paid -> overdue
      if (age > 30 && inv.id % 5 === 0) {
        // part paid
        invoices.recordPayment(
          { invoice_id: inv.id, method, amount: Math.round(inv.total * 0.5 * 100) / 100, paid_on: payOn(2), note: 'Part payment' },
          { id: ref.finance }
        );
        partial++;
        continue;
      }
      if (diffDays(inv.invoice_date, inv.due_date) <= age - 3) {
        // due date passed at least 3 days ago
        invoices.recordPayment(
          { invoice_id: inv.id, method, amount: inv.total, paid_on: payOn(Math.floor(rnd() * 12) - 3), note: 'Paid in full' },
          { id: ref.finance }
        );
        paid++;
      }
    }
    subs.applyAction(E, 'pause', { id: ref.staff });
    log(`Billing run created ${run.invoices_created} invoices. Confirmed ${confirmed}, fully paid ${paid}, part paid ${partial}.`);
    })();

  // Send a couple of invoices so the email outbox has examples
  const sendable = db.all("SELECT id FROM invoices WHERE status = 'confirmed' ORDER BY id DESC LIMIT 2");
  for (const row of sendable) await invoices.send(row.id, { id: db.get("SELECT id FROM users WHERE email = 'staff@brightloop.test'").id });

  const n = (sql) => db.get(sql).n;
  return {
    seeded: true,
    customers: n("SELECT COUNT(*) n FROM users WHERE role='customer'"),
    subscriptions: n('SELECT COUNT(*) n FROM subscriptions'),
    invoices: n('SELECT COUNT(*) n FROM invoices'),
    payments: n('SELECT COUNT(*) n FROM payments'),
  };
}

module.exports = { seedDemo };
