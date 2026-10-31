const { HttpError } = require('./errors');
const { isValidDate } = require('./dates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "More than eight characters, with an uppercase letter, a lowercase letter and a special character."
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length <= 8) return 'Password must be more than 8 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain a special character (for example ! @ # $)';
  return null;
}

const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true';

/**
 * Tiny schema validator. schema = { field: { type, required, label, min, max, values, default } }
 * Types: string, email, password, number, int, bool, date, enum
 */
function validate(input, schema) {
  const out = {};
  const fields = {};
  const body = input && typeof input === 'object' ? input : {};
  for (const [key, rule] of Object.entries(schema)) {
    const label = rule.label || key.replace(/_/g, ' ');
    let v = body[key];
    if (typeof v === 'string' && rule.type !== 'password') v = v.trim();
    const empty = v === undefined || v === null || v === '';

    if (empty) {
      if (rule.type === 'bool') out[key] = rule.default !== undefined ? rule.default : false;
      else if (rule.required) fields[key] = `${label} is required`;
      else out[key] = rule.default !== undefined ? rule.default : null;
      continue;
    }

    switch (rule.type) {
      case 'string':
        v = String(v);
        if (rule.max && v.length > rule.max) fields[key] = `${label} must be at most ${rule.max} characters`;
        break;
      case 'email':
        v = String(v).toLowerCase();
        if (!EMAIL_RE.test(v) || v.length > 200) fields[key] = 'Enter a valid email address';
        break;
      case 'password': {
        const p = passwordProblem(v);
        if (p) fields[key] = p;
        break;
      }
      case 'number':
      case 'int': {
        const n = Number(v);
        if (!Number.isFinite(n) || (rule.type === 'int' && !Number.isInteger(n))) {
          fields[key] = `${label} must be a ${rule.type === 'int' ? 'whole ' : ''}number`;
        } else if (rule.min !== undefined && n < rule.min) fields[key] = `${label} must be at least ${rule.min}`;
        else if (rule.max !== undefined && n > rule.max) fields[key] = `${label} must be at most ${rule.max}`;
        v = n;
        break;
      }
      case 'bool':
        v = toBool(v);
        break;
      case 'date':
        if (!isValidDate(v)) fields[key] = `${label} must be a valid date (YYYY-MM-DD)`;
        break;
      case 'enum':
        if (!rule.values.includes(v)) fields[key] = `${label} must be one of: ${rule.values.join(', ')}`;
        break;
      default:
        break;
    }
    out[key] = v;
  }
  if (Object.keys(fields).length) throw new HttpError(400, 'Please fix the highlighted fields', fields);
  return out;
}

module.exports = { validate, passwordProblem, EMAIL_RE };
