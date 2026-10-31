const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { authenticate, requireRole } = require('./middleware/auth');
const { errorHandler } = require('./middleware/error');
const { HttpError } = require('./util/errors');
const catalog = require('./routes/catalog');
const people = require('./routes/people');
const finance = require('./routes/finance');
const { publicRouter, outbox } = require('./routes/misc');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', publicRouter);
  app.use('/api/auth', require('./routes/auth'));

  const team = [authenticate, requireRole('admin', 'staff')];
  app.use('/api/lookups', authenticate, catalog.lookups);
  app.use('/api/products', authenticate, catalog.products);
  app.use('/api/plans', authenticate, catalog.plans);
  app.use('/api/taxes', authenticate, catalog.taxes);
  app.use('/api/payment-terms', authenticate, catalog.terms);
  app.use('/api/templates', authenticate, catalog.templates);
  app.use('/api/discounts', authenticate, catalog.discounts);
  app.use('/api/customers', authenticate, people.customers);
  app.use('/api/staff', authenticate, people.staff);
  app.use('/api/subscriptions', authenticate, require('./routes/subscriptions'));
  app.use('/api/invoices', authenticate, finance.invoices);
  app.use('/api/payments', authenticate, finance.payments);
  app.use('/api/billing', authenticate, finance.billing);
  app.use('/api/reports', authenticate, finance.reports);
  app.use('/api/outbox', authenticate, outbox);
  app.use('/api/portal', authenticate, require('./routes/portal'));
  void team;

  app.use('/api', (req, res, next) => next(new HttpError(404, 'That API address does not exist')));

  // In production (npm start) the built React app is served from the same port.
  const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
