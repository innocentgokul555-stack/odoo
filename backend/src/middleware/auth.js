const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../db');
const { HttpError, forbidden } = require('../util/errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please sign in to continue'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = getDb().get(
      'SELECT id, name, email, role, company, phone, address, active FROM users WHERE id = ?',
      payload.sub
    );
    if (!user || !user.active) return next(new HttpError(401, 'Your session is no longer valid. Please sign in again'));
    req.user = user;
    return next();
  } catch (e) {
    return next(new HttpError(401, 'Your session has expired. Please sign in again'));
  }
}

// requireRole('admin') / requireRole('admin', 'staff')
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(forbidden());

module.exports = { signToken, authenticate, requireRole };
