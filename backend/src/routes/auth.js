const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getDb } = require('../db');
const { h } = require('../util/http');
const { validate, passwordProblem } = require('../util/validate');
const { HttpError, badRequest, conflict } = require('../util/errors');
const { signToken, authenticate } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

const router = express.Router();
const db = () => getDb();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Very small login / reset throttle (per IP + email) to slow down password guessing.
const attempts = new Map();
function throttle(key, limit = 10, windowMs = 15 * 60 * 1000) {
  if (process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (rec.length >= limit) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  rec.push(now);
  attempts.set(key, rec);
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, company: u.company, phone: u.phone, address: u.address });

// A new customer creates an account (one account per email).
router.post('/signup', h(async (req, res) => {
  const b = validate(req.body, {
    name: { type: 'string', required: true, max: 120 },
    email: { type: 'email', required: true },
    password: { type: 'password', required: true },
    company: { type: 'string', max: 160 },
    phone: { type: 'string', max: 40 },
  });
  if (db().get('SELECT id FROM users WHERE email = ?', b.email)) {
    throw new HttpError(409, 'An account with this email already exists', { email: 'This email is already registered' });
  }
  const hash = await bcrypt.hash(b.password, 10);
  const { id } = db().run(
    'INSERT INTO users (name, email, password_hash, role, company, phone) VALUES (?, ?, ?, ?, ?, ?)',
    b.name, b.email, hash, 'customer', b.company, b.phone);
  const user = db().get('SELECT * FROM users WHERE id = ?', id);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', h(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!email || !password) throw badRequest('Enter your email and password');
  throttle(`login:${req.ip}:${email}`);
  const user = db().get('SELECT * FROM users WHERE email = ?', email);
  const ok = user ? await bcrypt.compare(password, user.password_hash) : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password');
  if (!user.active) throw new HttpError(403, 'This account has been disabled. Please contact support.');
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

// "Forgot password": a reset link is sent to the registered email.
router.post('/forgot-password', h(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!email) throw badRequest('Enter your email address', { email: 'Email is required' });
  throttle(`forgot:${req.ip}:${email}`, 5);
  const user = db().get('SELECT * FROM users WHERE email = ? AND active = 1', email);
  const out = { message: 'If that email is registered, a password reset link has been sent to it.' };
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    db().run('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE id = ?',
      sha(token), new Date(Date.now() + 60 * 60 * 1000).toISOString(), user.id);
    const link = `${config.appUrl}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
    await sendMail({
      to: user.email,
      subject: `Reset your ${config.company} password`,
      text: `Hello ${user.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
      link,
    });
    if (config.demoMode) out.demo_reset_link = link; // shown on screen in demo mode only
  }
  res.json(out);
}));

router.post('/reset-password', h(async (req, res) => {
  const { token, email, password } = req.body || {};
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem, { password: problem });
  const user = db().get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
  const valid = user && user.reset_token_hash && user.reset_expires && new Date(user.reset_expires) > new Date() &&
    crypto.timingSafeEqual(Buffer.from(sha(String(token || ''))), Buffer.from(user.reset_token_hash));
  if (!valid) throw badRequest('This reset link is invalid or has expired. Please request a new one.');
  db().run('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires = NULL WHERE id = ?',
    await bcrypt.hash(password, 10), user.id);
  res.json({ message: 'Your password has been changed. You can sign in now.' });
}));

router.post('/change-password', authenticate, h(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = db().get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!(await bcrypt.compare(String(current_password || ''), user.password_hash))) {
    throw badRequest('Your current password is not correct', { current_password: 'Not correct' });
  }
  const problem = passwordProblem(new_password);
  if (problem) throw badRequest(problem, { new_password: problem });
  db().run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(new_password, 10), user.id);
  res.json({ message: 'Password updated' });
}));

module.exports = router;
