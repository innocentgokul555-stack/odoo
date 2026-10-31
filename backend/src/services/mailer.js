const config = require('../config');
const { getDb } = require('../db');

let transport = null;
function getTransport() {
  if (!config.smtp.host) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transport;
}

/**
 * Every email is saved in the "outbox" table (visible to the admin in the app) and,
 * if an SMTP server is configured, also really sent. Without SMTP it is safe for demos.
 */
async function sendMail({ to, subject, text, link }) {
  const db = getDb();
  const { id } = db.run('INSERT INTO emails (to_email, subject, body, link) VALUES (?, ?, ?, ?)', to, subject, text, link || null);
  const t = getTransport();
  if (t) {
    try {
      await t.sendMail({ from: config.smtp.from, to, subject, text });
      db.run('UPDATE emails SET delivered = 1 WHERE id = ?', id);
    } catch (e) {
      console.error('Email delivery failed:', e.message);
    }
  } else if (process.env.NODE_ENV !== 'test') {
    console.log(`[email -> ${to}] ${subject}${link ? ` | ${link}` : ''}`);
  }
  return id;
}

module.exports = { sendMail };
