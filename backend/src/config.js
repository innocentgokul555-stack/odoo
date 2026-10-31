const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  isProd,
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-in-production',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'odoo.db'),
  // Demo mode shows password-reset links on screen (no email server needed).
  // Turn it OFF in real production: DEMO_MODE=false
  demoMode: process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : !isProd,
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  company: process.env.COMPANY_NAME || 'Brightloop Software',
  currency: process.env.CURRENCY || 'USD',
  billingAutorun: process.env.BILLING_AUTORUN !== 'false',
  billingAutoConfirm: process.env.BILLING_AUTO_CONFIRM === 'true',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Brightloop Billing <billing@brightloop.test>',
  },
};
