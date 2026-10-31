// All dates are plain 'YYYY-MM-DD' strings handled in UTC, so results never
// depend on the server's time zone.
const pad = (n) => String(n).padStart(2, '0');

function parse(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fmt(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
const today = () => fmt(new Date());

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fmt(parse(s)) === s;
}
function addDays(d, n) {
  const dt = parse(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}
// Adds months but keeps the day-of-month where possible (Jan 31 + 1 month = Feb 28/29).
function addMonths(d, n) {
  const dt = parse(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return fmt(dt);
}
function addPeriod(d, period, n = 1) {
  switch (period) {
    case 'daily': return addDays(d, n);
    case 'weekly': return addDays(d, 7 * n);
    case 'monthly': return addMonths(d, n);
    case 'yearly': return addMonths(d, 12 * n);
    default: throw new Error(`Unknown billing period: ${period}`);
  }
}
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000); // b - a

module.exports = { today, isValidDate, addDays, addMonths, addPeriod, diffDays };
