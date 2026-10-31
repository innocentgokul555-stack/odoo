const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { h, paging, meta } = require('../util/http');
const { requireRole } = require('../middleware/auth');

const publicRouter = express.Router();
publicRouter.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
publicRouter.get('/config', (req, res) => res.json({
  company: config.company,
  currency: config.currency,
  demo_mode: config.demoMode,
}));

// Admin-only: every email the system has sent (reset links, invoices). Handy when no email server is set up.
const outbox = express.Router();
outbox.use(requireRole('admin'));
outbox.get('/', h((req, res) => {
  const { page, pageSize, offset } = paging(req);
  const { total } = getDb().get('SELECT COUNT(*) AS total FROM emails');
  const rows = getDb().all('SELECT * FROM emails ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset);
  res.json({ data: rows, meta: meta(page, pageSize, total) });
}));

module.exports = { publicRouter, outbox };
